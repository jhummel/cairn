## Context

**Round 15.** Round 14 is finished: tasks #86–#90 are archived, `tasks.json` is empty, and `state.json` is at round 15. Round 14 shipped the stall guard (`STALL_BLOCK_THRESHOLD = 3`, `run.ts:399`), removed `cairn init`'s deny rules, stripped legacy deny blocks on re-run (`LEGACY_CAIRN_TASK_DENY_RULES`), added a regression test that the reviewer's `--allowedTools` grants no `cairn task` access, and corrected the enforcement story in CLAUDE.md and README.

`cairn run` launches its execution agents (`src/commands/run.ts:208`) and the post-task reviewer (`src/post-task-reviewer.ts`) as headless `claude -p` processes. Headless sessions can't be watched or steered through Remote Control, so a round can't be monitored or answered from a phone.

Claude Code now provides the process-runner layer natively:

- **Agent-tool subagents:** each starts with a fresh context, and only its final report returns.
- **SendMessage:** continues a subagent with its context intact.
- **PushNotification.**
- **Remote Control:** reaches any interactive session.

What those don't replace is Cairn's *method*: planning notes, approval gates, `tasks.json` with dependencies and tests, guards, one reviewer per task, round reviews, state in git. This round keeps the method and adds a second way to run a round, **`/cairn-run`**. It's an interactive session that drives the loop through two new CLI commands, `cairn round next` and `cairn round settle`, which hold all the deterministic logic.

The design was drafted in a separate discussion on 2026-09-13 and revised in this planning session. Line references were checked against the code.

### Code findings

- **Guard counters are in memory on purpose** (`run.ts:489-495`). That's reliable in a TS process and unreliable when the run agent is a model, which can be compacted, resumed, or simply lose track.
- **Unguarded case:** a task the agent leaves `in-progress` every iteration (timeouts, giving up) is re-picked until `maxIterations` runs out. `selectNextTask` returns in-progress tasks ahead of pending ones. The revert guard only counts failed validations of *complete* tasks. The stall guard only counts *pending* tasks, and seeing `in-progress` resets it (`run.ts:738`).
- **`beforeSha` is used only by the reviewer:** captured at `run.ts:638`; used for the null check and the no-commits check in `runPostTaskReview`, and for the diff range in `getGitDiff` (`post-task-reviewer.ts:215`).
- **Current order is review, then archive** (`run.ts` step l, then m). `settle` reverses this (archive, then review gate), which drives the idempotency design below.
- **`review.maxIterations` is dead config.** It's loaded at `config.ts:56` and asked for at init (`init.ts:140/195/209`), but nothing reads it. **And `isValidConfig` (`types.ts:66`) *rejects* a `review` block that lacks it.** There are about 40 references across `test/types.test.ts`, `test/config.test.ts`, `test/commands/init.test.ts`, `test/commands/run.test.ts` and `test/post-task-reviewer.test.ts`.
- **`instructions.md` reaches four agents**: execution (`run.ts:95`), reviewer (`post-task-reviewer.ts:41`), plan (`plan.ts:92`), summarize (`summarize.ts:36`). `README.md:207` says "execution agents only (not planning)" and is wrong.
- **The reviewer prompt embeds the full diff** (`buildPostTaskReviewUserPrompt`, `post-task-reviewer.ts:25`), and `agents/post-task-reviewer.md` tells it to re-run the declared tests, which validation has already run.
- **The stall-guard note (`run.ts:724`) blames a `permissions.deny` rule.** Init now strips those rules, and under `/cairn-run` a stall has other likely causes. Reword the note when it moves into `settle`.
- **Specialists are embedded in the prompt** (`run.ts:64-80`), not used as the agent's system prompt. Task `model` is `'opus' | 'sonnet'` (`types.ts`), which maps directly onto the Agent tool's `model` parameter.
- **`~/.local/bin/cairn` is a symlink to `dist/cairn`**, so not re-running `install.sh` pins nothing. CLAUDE.md's pin/unpin section now includes the exact commands (uncommitted as of this session).
- **`CLAUDE.local.md` is not gitignored in this repo.** The global ignore covers only `.claude/settings.local.json`.

### Probe results (this session, run as subagents from the interactive planner)

- **(a) Memory loading.** A `general-purpose` subagent and a custom `post-task-reviewer` subagent both had **CLAUDE.md and the auto-memory index (MEMORY.md)** loaded, quoting CLAUDE.md verbatim with no tool use. *This corrects the docs finding from the draft discussion, which said subagents don't load auto memory.*
- **(a′) `CLAUDE.local.md` is loaded into subagents.** The in-session probe was negative because the file was created after the parent session started. From a **new** session, a `general-purpose` subagent quoted `PROBE-MARKER: kestrel-7731.` from its loaded instructions before using any tools, and saw `CLAUDE.local.md` listed as private project instructions. Only `general-purpose` was tested this way. Custom agent types loaded the same CLAUDE.md and auto-memory as `general-purpose` in probe (a), so they very likely load it too, but that's unverified.
- **(b) Nesting works.** A subagent launched a nested subagent, and the nested one reported it also had the Agent tool, so nesting goes at least two levels deep.
- **Reviewer tool surface.** `post-task-reviewer` as a subagent gets **every tool**, including `Agent`, `Bash`, `Write` and all MCP tools, because its frontmatter has no `tools` field.

### Docs findings (Claude Code docs: `sub-agents.md`, `hooks.md`, `auto-mode-config.md`, `remote-control.md`)

- **Subagents follow the parent's permission mode.** If the parent is in `bypassPermissions`, `acceptEdits` or `auto`, the subagent's frontmatter `permissionMode` is ignored.
- Settings `permissions.allow` / `deny` rules apply to subagent tool calls.
- Frontmatter `tools` / `disallowedTools` take tool names only; path-scoped rules like `Edit(dir/**)` are not documented there.
- **PreToolUse hooks fire for subagent tool calls; hook input includes `agent_id` and `agent_type`** (both present only inside a subagent).
- An **`auto` permission mode** (classifier-based approval) is generally available.
- **`maxTurns`** in agent frontmatter caps a subagent; the output is marked partial and can be resumed.
- Approving permission prompts from the phone over Remote Control is **not documented** (only notifications about prompts are).
- `claude -p` loads the same memory files as interactive mode unless `--bare` is passed, so `cairn run`'s agents already load `CLAUDE.local.md` today.

## Goals

1. Run a full round from an interactive session that Remote Control can reach (`/cairn-run`).
2. One tested implementation of the post-iteration logic, shared by `cairn run` and `/cairn-run`.
3. Guards survive restart and compaction; close the in-progress gap.
4. Keep the run agent's context small enough for a round of up to 20 tasks without depending on compaction.
5. Mechanical containment under `/cairn-run`: a hook that execution agents have never had, and that restores the reviewer's scoping.
6. Cleanups: `instructions.md` → `CLAUDE.local.md`; delete `review.maxIterations`.
7. **`cairn run` keeps working throughout.** Nothing headless is removed until a real round succeeds through `/cairn-run`.

## Approach

### Shape

```
/cairn-run (run agent, interactive)
├─ cairn round next            → review pending? return it. Else pick + health check +
│                                attempt record + prompt file → { taskId, iteration, model, promptFile }
│                                or { verdict: "round-done" }
├─ Agent(cairn-task-agent)     → "Read <promptFile> and follow it": start → work → commit → complete
│                                returns ≤5-line report
├─ cairn round settle <id>     → validate, guards, archive → verdict JSON
├─ verdict:
│    review  → Agent(post-task-reviewer, reviewPromptFile) → cairn round settle <id> --reviewed
│    retry   → SendMessage same agent (continue) | fresh Agent → settle again
│    blocked → PushNotification
│    done    → —
└─ repeat
```

- **Agents run one after another, never nested,** even though nesting works (probe b). The run agent launches the task agent, then the reviewer. This keeps the reviewer independent, keeps the deterministic steps between the two, and leaves failure handling with the run agent.
- **The run agent never reads `tasks.json`**, diffs, or raw test output.
- **Every CLI verdict includes a `next` hint**, so each iteration only depends on the last command's output. A session that compacted, a resumed session and a fresh session all behave the same.
- **Prompt files, not inline prompts.** An inline prompt of about 3k tokens would land in the run agent's context twice (the tool result, then the Agent call), and a reviewer prompt has no size limit.

### Task agent: `cairn-task-agent`

- Init installs a generic `agents/cairn-task-agent.md` (`internal: true`) with **`maxTurns`**. The run agent always launches this type.
- **Specialist content stays in the prompt file**, as `run.ts:64-80` does today. The task's `agent` field never becomes `subagent_type`: that would make the specialist `.md` the subagent's whole system prompt and bring in its own model and tools.
- `model` comes from the task, or the specialist's model, exactly as `run.ts:564-568` resolves it.
- `maxTurns` partly replaces `iterationTimeout` (900s). It caps turns, not wall-clock time, and "partial, resumable" fits the `continue` retry.

### `cairn round next`

1. If any attempt record is in `awaiting-review`, return that review first. Reviews can't be lost to a crash.
2. `selectNextTask`. If none is ready, return `round-done`.
3. Run the health check. A failure is included in the prompt, as today.
4. Attempt record: create it with `beforeSha = HEAD` only if none exists. On a re-pick, keep the original SHA so the review covers every attempt.
5. Increment the iteration counter on disk. It feeds `cairn task start --iteration`.
6. Write the task agent's prompt (system prompt + iteration prompt) to a prompt file.
7. Return `{ taskId, iteration, model, promptFile, next }`.

### `cairn round settle <id> [--reviewed] [--before-sha <sha>] [--test-timeout <sec>]`

0. Take the lock (`acquireLock`, `src/file-lock.ts`), read `tasks.json` with repair and recovery, load the attempt record. `--before-sha` overrides the recorded SHA.
1. **Idempotency is based on the attempt record, not on whether the task is archived** (this session's fix). Archiving happens *before* the review gate, so a status-based check would turn the `--reviewed` call into `already-settled`.
   - `--reviewed`: requires a record in `awaiting-review` → clear the record, return `done`.
   - No `--reviewed`, record in `awaiting-review` → **return `review` again** (rewrite the prompt file if it's missing). This covers a second call after compaction.
   - No record and task archived → `already-settled`.
   - No record and task not archived → create the record now, with `beforeSha` from the `Task #<id>:` commit-message fallback.
2. **Branch on the task's current status:**

| Status | Action | Verdict |
|---|---|---|
| `pending` | `stalls += 1`, block at **3** (reworded note) | `retry` (`fresh`) or `blocked` |
| `in-progress` | **New:** `incompletes += 1`, block at **3** | 1 → `retry` (`continue`); 2 → `retry` (`fresh`); 3 → `blocked` |
| `blocked` (the agent set it) | Clear the record; the reason comes from the task notes | `blocked` |
| `complete` | Step 3 | — |

3. **Validate** with `validateTaskTests`:
   - `skipped` or `passed` → continue (`passed` resets `reverts`).
   - `error` → continue with a warning.
   - `failed` → `reverts += 1`, block at **2** (reuse the note at `run.ts:680`), otherwise `retry` (`continue`). A failed validation counts only as a revert, never as an incomplete.
4. **Archive** (`archiveCompletedTasks`).
5. **Review gate**, same conditions as `runPostTaskReview`. If it passes: `phase = awaiting-review`, write the reviewer prompt file, return `review`. Otherwise: clear the record and return `done` with the reason (`review-disabled` / `no-commits` / `no-before-sha`).
6. Append a line to the iterations log and print the verdict JSON.

**Exit codes:** 0 for every verdict, including `blocked`. Non-zero only when settle itself couldn't run (unreadable `tasks.json`, lock timeout, unknown ID); for the run agent that means stop and send a notification.

**Retry `mode`:**
- `continue` means SendMessage to the same agent, which knows its diff.
- `not-started` (stall) is always `fresh`.
- If the agent's ID is lost, fall back to `fresh`.

**Why `incompletes` is 3, with the retry mode changing:** blocking too early costs one human unblock (dependents wait, the rest of the round continues). Blocking too late costs one extra agent session. A limit of 2 would never try a fresh agent on a stuck task. The third attempt uses a fresh agent in case the first agent's own context was the problem, so it tests something different instead of repeating. A large task timing out twice under `cairn run`'s 900s limit is realistic.

**Thresholds stay fixed** (stalls 3, incompletes 3, reverts 2), same reasoning as `run.ts:386`/`:399`.

### Run state

A gitignored runtime file in the data dir that follows the existing temp-file convention (`tempFilePath`, added to init's `TEMP_IGNORE_SUFFIXES`). New paths are created with `BRAND` and read back through discovery, per CLAUDE.md.

```json
{ "iteration": 14,
  "attempts": { "42": { "beforeSha": "abc…", "iteration": 14,
                        "reverts": 0, "stalls": 0, "incompletes": 0,
                        "phase": "executing" } } }
```

- **When a record is cleared:** `done`, `--reviewed`, a block, or `cairn task set-status` on the task (a human unblocking gets fresh attempts, matching `run.ts:689`).
- **No `selectedStatus` field:** a task still pending at settle time is treated as a stall.
- `cairn run` shares `settle`, so it also creates attempt records at pick time. Restarting `cairn run` no longer resets counters; `set-status` is the reset.

### Test output

- `settle` writes the full test output to a per-task log file.
- The reviewer gets a **summary** (command, pass/fail/skipped/error, counts and duration when parseable) plus the log path.
- A `retry` verdict's `failure` is the **last ~40 lines**. The existing 200-character slice stays as the task note.
- A task never reaches review with failing tests, so raw output is never useful to the reviewer.

### Prompt changes

**Task agent** (the `buildSystemPrompt` variant for subagents):
- Drop the completion-flag step (`run.ts:131`); `next` returns `round-done`.
- State the working directory explicitly. A subagent inherits the run agent's working directory, not `spawnClaude`'s `cwd` (`run.ts:202`).
- Report contract: return ≤5 lines; details go to `--notes-file`.
- **Keep SUBAGENT STRATEGY** (nesting works, probe b) and **keep "root CLAUDE.md is already loaded"** (probe a).
- Specialist section embedded as today.

**Reviewer** (both modes):
- Remove "run the declared tests" from `agents/post-task-reviewer.md`. `settle` has already validated, and the reviewer gets the summary.
- **Add `tools: Read, Grep, Glob, Bash, Edit, Write`** to its frontmatter. Today it gets every tool as a subagent, including `Agent` and all MCP tools.
- Return a single line (`PASS` or `CONCERNS: n, see round-N.md`).
- In subagent mode, the prompt file carries the diff *range*. The reviewer runs `git diff` itself; its git inspection grants already allow that.
- Headless `--allowedTools`: the reviewer's grant no longer needs `buildTestCommandRules(task.tests)`. Init's permission seeding keeps using `buildCommandRules` for the project's own commands.

Edit the repo-root `agents/` and `commands/`. `cairn init` copies them into projects (`installAgents` / `installSlashCommands`, `init.ts:442-464`).

### Enforcement in `/cairn-run`

Subagents follow the interactive session's permission mode, so per-agent `--allowedTools` scoping doesn't carry over, and frontmatter can't express path scopes. Replace both with one **PreToolUse hook that checks `agent_type`**:

- **Implemented as `cairn hook pre-tool-use`** (JSON on stdin), not a shell script, so the decision logic is TypeScript with tests. Init seeds it into `.claude/settings.local.json` (round 13 rejected writing to the committed `settings.json`), with a matcher limited to `Edit|Write|Bash`.
- **Rule 1:** a call from any subagent (`agent_id` present) to `Edit`/`Write` on `tasks.json` → deny. **Generate-tasks runs in the main session with no `agent_id`, so it is exempt automatically.** This replaces the draft's "deny only while a round is live" heuristic, which a crashed round's stale `executing` record would have broken.
- **Rule 2:** when `agent_type == post-task-reviewer`, allow `Edit`/`Write` only under the resolved `reviews/` dir, and Bash only for `GIT_INSPECTION_RULES` (shared from `src/claude-settings.ts`). This rebuilds, mechanically, the scoping the headless reviewer gets from `--allowedTools`.
- **No effect on headless `cairn run`:** its agents are main sessions (no `agent_id`), so the hook is a no-op for them. It can't cause a round-13-style incident against the existing loop.
- **Fail open.** Any internal error (unparseable input, data dir not found, binary problem) exits without blocking. Only a deliberate deny blocks. The hook runs on every matching tool call in every session in the project, so it must also be fast: exit immediately when `agent_id` is absent.

**Permission mode for `/cairn-run` sessions:** the user picks it at launch; the skill can't set it.
- **Documented default: `bypassPermissions` + hook.** An unattended round never stalls. Containment is the same as today's execution agents, plus the hook, which is a strict gain.
- **Try `auto` + hook in the validation round.** The classifier adds a layer but could wrongly deny normal actions (`git commit`, `bun test`, `cairn task …`).
- **`default`/`acceptEdits` + allowlist is rejected** for unattended rounds (see Rejected Alternatives).

### Cleanups

- **`instructions.md` → `CLAUDE.local.md`.**
  - `cairn init` offers to move the content and makes sure `CLAUDE.local.md` is gitignored.
  - For one release the loader still reads `instructions.md` and prints a deprecation warning; after that, delete `personal-instructions.ts` and its four call sites.
  - `CLAUDE.local.md` applies to *all* sessions in the project, not only agents Cairn launches.
  - It reaches `/cairn-run`'s subagents (probe a′, `general-purpose`), and headless `cairn run` agents load it too. Confirm for `cairn-task-agent` in the validation round; the one-release fallback to `instructions.md` covers the gap until then.
- **Delete `review.maxIterations`** from `types.ts` (interface and `isValidConfig`: stop requiring the key, still accept it), `config.ts:56`, init (`:140`, `:195`, `:209`) and this repo's `cairn.json`. Existing configs that still have the key must load and validate cleanly.

### Self-modifying round

- This round rewrites `run.ts` and adds commands to the binary the loop depends on. **The binary is pinned** (`~/.local/bin/cairn` is a regular file, built 2026-09-13 17:37) and `healthCheck` points at `/tmp/cairn-healthcheck`.
- The pinned binary runs this round, so `run.ts` changes don't affect the round in progress. They do have to keep `test/commands/run.test.ts` green.
- `/cairn-run` can't run this round. Its first real use is the validation round afterwards.
- The hook seeding must never be exercised against the project root mid-round. A half-built hook pointing at the pinned binary, which doesn't have `cairn hook`, would be a no-op at best.

## Rejected Alternatives

**This session (round 15):**

- **Workflow scripts for the loop.** Rejected: rounds are under 20 tasks, users have reported Workflows eating token budgets, and it's unclear how much a running Workflow can be redirected from a phone. Revisit if rounds grow large.
- **Task agent launches its own reviewer (nesting).** Rejected even though nesting works (probe b): the reviewer loses independence, the deterministic steps get skipped, and failure handling ends up inside a subagent.
- **Run agent reads `tasks.json` and picks tasks itself.** Rejected: costs context and moves tested selection logic into prompt prose.
- **Guard counters kept by the run agent.** Rejected: compaction or restart miscounts, which leads either to the 60-iteration livelock or to blocking too early.
- **`--before-sha` passed only as a flag.** Would work nearly always; rejected only because the attempt record exists anyway. Kept as an override.
- **Finding the review range from `Task #<id>:` commit messages as the primary method.** Rejected because the message format is enforced only by the prompt. Kept as the **fallback** when the record is missing, instead of skipping the review.
- **A `selectedStatus` field.** Rejected: "still pending at settle" is enough.
- **Putting `next`/`settle` under `cairn task`.** Rejected: task agents use `cairn task`, and one calling `settle` would archive and skip its own review.
- **Returning prompts inline from `next`/`settle`.** Rejected in favor of prompt files.
- **Passing full test output to the reviewer.** Rejected: passing output has nothing to review. Summary plus log path instead.
- **Pausing the loop with AskUserQuestion on a block.** Rejected: it stalls unattended rounds. Notify and move on; the user can step in from the phone.
- **Moving `instructions.md` into the project `CLAUDE.md`.** Rejected: that file is committed, and the content is personal.
- **Multiple independent reviewers (`review.maxIterations`).** Deferred, config deleted. Sketch if revived: focused lenses (spec / correctness / coverage) or mixed models rather than copies; reviewers *return* findings; a `review-merger` agent writes one section (consensus / unique / conflicts); config `review.reviewers` with a per-task override.
- **Removing headless `cairn run` this round.** Rejected: stability during the transition.
- **Idempotency keyed on archived status** ("task archived → `already-settled`"). Rejected: `settle` archives before the review gate, so the `--reviewed` call would be swallowed. Keyed on the attempt record instead.
- **Mapping the task's `agent` field to `subagent_type`.** Rejected: the specialist `.md` would replace the whole system prompt and bring its own model and tools, diverging from `cairn run`. Always launch `cairn-task-agent`; embed the specialist in the prompt file.
- **Using built-in `general-purpose` as the task agent type.** Rejected: it can't set `maxTurns`.
- **Hook denies `tasks.json` edits only while a round is live** (run state holds an `executing` record). Rejected: a crashed round leaves a stale record that blocks generate-tasks. `agent_type`/`agent_id` in hook input distinguishes subagents directly.
- **Shell-script hook.** Rejected in favor of `cairn hook pre-tool-use`: tested TS logic, and it can reuse `GIT_INSPECTION_RULES` and discovery.
- **`default`/`acceptEdits` mode + allowlist for `/cairn-run`.** Rejected for unattended rounds: task agents run unpredictable commands, every unlisted one prompts, and phone approval over Remote Control isn't documented.
- **`incompletes` limit of 2.** Rejected: never tries a fresh agent on a stuck task, and large tasks can legitimately need two sessions.
- **Dropping SUBAGENT STRATEGY from the subagent-mode prompt.** Rejected: nesting works (probe b).

**Corrected from earlier rounds:**

- ~~"Guard counters are in memory and per-run on purpose; a livelock only matters within a single run"~~ (`run.ts:489` comment; round 14). That held only while the run agent was a TS process. Counters move to run state. They are still **not** a `Task` field, so that rejection stands.
- ~~"Persisting the revert counter as a `Task` field — rejected; a livelock only matters within a single run."~~ The conclusion stands; the reason is now "counters are runtime state, not task data, and live in the gitignored run-state file."
- ~~"Dropping test execution from the reviewer's remit — moot once the deny rules are gone"~~ (round 14). **Now adopted**, for a different reason: `settle` validates before the review gate, so the reviewer re-running tests is duplicated work.
- ~~"Subagents do not load the parent's auto memory"~~ (draft docs finding). Probe (a) showed both `general-purpose` and custom subagents have MEMORY.md loaded.
- **"Skills instead of subagents"** stays rejected as worded: the skill is the *run agent*, and all work still happens in fresh-context subagents.

**Carried forward from round 14:**

- **Per-agent deny via `--settings`** (inline JSON on reviewer and planner spawns). Proven to work, but headless mode is already deny-by-default. Rejected as machinery preserving a guarantee we get for free. Revive only if headless defaults change.
- **Keeping the deny rules and exempting the loop some other way.** Rejected: a deny wins when rules merge, and there's no carve-out mechanism.
- **Manual removal only, no init migration.** Rejected: repos initialized during the round-13 window would stay silently broken.
- **A `cairn doctor` command** for known-bad config states. Deferred; revisit if a second such state appears.
- **Halting the entire run on a same-task stall.** Rejected in favor of block-and-continue.
- **Grant broad `Bash(*)` with targeted denies.** Rejected: the reviewer needs no breadth. (The original reason, "denies are bypassed under `--dangerously-skip-permissions`", was false.)
- **Blanket `Bash(cairn task:*)` deny.** Rejected: it would break `cairn task next-id` / `show`, which planning and review require.
- **Grant `Bash(find:*)`, `Bash(cat:*)`, `Bash(ls:*)`, `Bash(rg:*)`, `Bash(grep:*)`, `Bash(head:*)`, `Bash(wc:*)`.** Rejected: redundant with `Read`/`Glob`/`Grep`, and `find` is not read-only.
- **Write rules to `.claude/settings.json` (committed, team-wide).** Rejected: Cairn should not edit a git-tracked file that affects every teammate's plain `claude` sessions. (This applies to the hook too, which goes in `settings.local.json`.)
- **Cairn writes to global git excludes.** Rejected: reaching outside the repo is too invasive for an init step.
- **Truly runtime-configurable brand name.** Rejected: bootstrap trap, since discovery walks up looking for the data dir.
- **Renaming `.ralph_task_*_notes.md`.** Rejected permanently.
- **Declaring task `tests` root-relative everywhere.** Rejected: manifest-driven commands behave better from the task directory.
- **Try-then-fall-back cwd for test validation.** Rejected: runs the suite twice and can't tell "wrong cwd" from "real failure."
- **An explicit per-task `testCwd` field.** Rejected: burdens task generation and does nothing for existing task files.
- **Giving `healthCheck` the per-directory resolver.** Rejected: it's a single project-wide string.
- **Never normalize a resolved API key onto plain `ANTHROPIC_API_KEY`.** The loop blanks that name per-spawn to force Max-plan usage.
- **`BRAND` constants in test assertions.** Rejected as partly tautological.
- **Splitting a self-modifying round into batches with stop/rebuild/restart.** Rejected: many manual cycles, and every boundary is a chance to get ordering wrong.
- **Rewriting archives during a sweep.** Rejected: falsifies history.
- **Per-task review files (`reviews/task-<id>.md`).** Not adopted; escape hatch if per-round files grow too long.
- **Agent-managed `state.json`.** Rejected: no atomicity guarantee.
- **Store `nextTaskId` inside `tasks.json`.** Rejected: a separate `state.json` survives rewrites.
- **Audit agent writes `planning-notes.md` directly.** Rejected: the planner owns formatting.
- **Separate `audit` CLI command instead of a slash command.** Rejected: keeps the user in the planner session.
- **Anthropic TS SDK instead of shelling out to `claude`.** Rejected: shelling out gives tools, permissions and MCP for free.
- **Port narration to TypeScript.** Rejected: Kokoro TTS and sounddevice are Python-specific.
- **Change storage format (SQLite / per-task files / JSONL).** Rejected: CLI subcommands get ~95% of the benefit.
- **Pre-commit to git worktrees for parallel execution.** Deferred to the RFC round.

## Rough Task Outline

**MANUAL pre-round (user), in this order:**

1. **Commit** the CLAUDE.md pin/unpin commands. Do **not** commit `cairn.json`'s redirected `healthCheck` or `CLAUDE.local.md`.
2. **Pin: already done.** Re-verify with `ls -la ~/.local/bin/cairn` (a regular file, not a symlink) right before `cairn run`.
3. **Remaining probes**, before generating tasks:
   - **(a′) Done:** subagents load `CLAUDE.local.md`. Remove the marker line from `CLAUDE.local.md`.
   - **(c)** Hook behavior:
     - Does PreToolUse input from a subagent call actually include `agent_id` / `agent_type`, and are they absent for main-session calls?
     - Does a hook deny still block under `bypassPermissions`?
     - Which exit code / JSON output blocks, and does a crashing hook command block or pass? This decides how to fail open.

**Round tasks** (each TDD: write the test, watch it fail, then implement). No project specialist agents apply; all tasks use the generalist prompt.

1. **Extract `settleTask`** (`src/`, `src/commands/`, `test/`): `src/settle.ts`, a pure extraction of `run.ts:665-765` with injected dependencies; `run.ts` calls it; counters passed through an interface. `test/settle.test.ts`; `test/commands/run.test.ts` stays green. *First: everything else builds on it.*
2. **Run-state store** (`src/`, `src/commands/init.ts`, `test/`): `src/run-state.ts` (read/write under `acquireLock`), path via `tempFilePath`, ignore suffix added to `TEMP_IGNORE_SUFFIXES`. Tests in temp dirs.
3. **Persist guard counters** (`src/`, `src/commands/run.ts`, `src/commands/task.ts`, `test/`):
   - `settle` uses run state, and `cairn run` creates the attempt record at pick time.
   - Update the `run.ts:489` comment.
   - `cairn task set-status` clears the record.
   - Test: counters survive two separate `settle` calls. *Deps: 1, 2.*
4. **Incomplete guard and stall-note rewording** (`src/`, `test/`): `in-progress` at settle → `incompletes`, limit 3, retry mode continue → fresh → blocked. Reword the stall note so it no longer blames only `permissions.deny`. *Deps: 3.*
5. **Verdict JSON, record-based idempotency, exit codes** (`src/`, `test/`): `already-settled` only when there's no record and the task is archived; record created lazily when missing; retry `mode`; `next` hints. *Deps: 3.*
6. **Test log and summary** (`src/`, `test/`): full output to a per-task log; summary returned; 40-line `failure` tail. `src/test-validator.ts`, `test/test-validator.test.ts`. *Deps: 1.*
7. **Review phase** (`src/`, `test/`): `awaiting-review`, `--reviewed`, re-emitting `review` on a repeat call, `beforeSha` from the record with the commit-message fallback. *Deps: 3, 5.*
8. **`cairn round next`** (`src/`, `src/commands/`, `test/`): pending review first, select, health check, attempt record (keeps the original SHA), iteration counter, prompt file, `round-done`. *Deps: 3, 7.*
9. **`cairn round settle` CLI and command group** (`src/commands/`, `src/index.ts`, `test/commands/`): register in `src/index.ts`; `test/commands/round.test.ts`. *Deps: 4, 5, 6, 7.* ⚠️ Touches `index.ts`.
10. **Subagent variant of the task prompt** (`src/commands/run.ts` or `src/agent-prompt.ts`, `test/`): `buildSystemPrompt` mode with no completion flag, explicit working directory, ≤5-line report contract, specialist section embedded, SUBAGENT STRATEGY and "CLAUDE.md already loaded" kept.
11. **Reviewer prompt and agent** (`src/post-task-reviewer.ts`, `agents/`, `test/`):
    - Test summary in `buildPostTaskReviewUserPrompt`, plus a diff-range variant.
    - In `agents/post-task-reviewer.md`: remove the "run the declared tests" step, add the `tools:` frontmatter, require a one-line return.
    - Drop `buildTestCommandRules` from the reviewer's headless grant, and update the existing regression test.
    - `test/post-task-reviewer.test.ts`. *Deps: 6.*
12. **`agents/cairn-task-agent.md`** (`agents/`, `test/commands/`): generic internal task agent with `maxTurns`; test that init installs it and that its frontmatter parses; make sure it isn't offered as a specialist.
13. **`cairn hook pre-tool-use`** (`src/commands/`, `src/claude-settings.ts`, `test/commands/`):
    - A pure decision function covering the `tasks.json` subagent deny, the reviewer's `reviews/**` scope and the reviewer's git-only Bash.
    - Fail open on any error; exit immediately when `agent_id` is absent.
    - Reuse `GIT_INSPECTION_RULES` and discovery.
    - *Deps: probe (c).* ⚠️ Touches `index.ts`.
14. **Init seeds the hook** (`src/commands/init.ts`, `src/claude-settings.ts`, `test/commands/init.test.ts`): idempotent merge into `settings.local.json` with an `Edit|Write|Bash` matcher, leaving user hooks intact. ⚠️ **Temp dirs only; never exercise init against the project root** (same hazard as round 14). *Deps: 13.*
15. **`/cairn-run` skill** (`commands/`): `commands/cairn-run.md`.
    - The loop over verdicts, always launching `cairn-task-agent` with `model`.
    - PushNotification on `blocked` / `round-done` / non-zero exit; fresh-agent fallback.
    - A permission-mode note (bypass recommended).
    - Installed by `cairn init`. *Deps: 8, 9, 10, 11, 12.*
16. **`instructions.md` → `CLAUDE.local.md`** (`src/`, `src/commands/init.ts`, `README.md`, `test/`): init migration offer plus a `CLAUDE.local.md` gitignore entry, deprecation warning in the loader, README section fixed (including the wrong "execution agents only" row). `test/personal-instructions.test.ts`, `test/commands/init.test.ts`. The README can say `CLAUDE.local.md` reaches Cairn's headless agents and `/cairn-run` subagents (probe a′).
17. **Delete `review.maxIterations`** (`src/types.ts`, `src/config.ts`, `src/commands/init.ts`, `cairn.json`, `test/`): `isValidConfig` stops requiring the key and still accepts it; about 40 test references updated. ⚠️ Edits `cairn.json`: touch **only** the `review` block.
18. **Docs** (repo root `CLAUDE.md`, `README.md`):
    - Two ways to run a round; run state; `cairn round` commands; `cairn-task-agent`.
    - The `/cairn-run` enforcement story: subagents follow the session's permission mode, and the hook checks `agent_type`, is fail-open, and is a no-op for headless agents.
    - Recommended permission mode.
    - The reviewer no longer runs tests.
    - *Last.*

⚠️ **Every task description touching `run.ts`, `index.ts`, `package.json`, `install.sh` or `cairn.json`** must say: do NOT modify `healthCheck` or run `./install.sh`; the binary is pinned and the health check redirected to a throwaway outfile.

Directories: `src/`, `src/commands/`, `test/`, `test/commands/`, `agents/`, `commands/`, plus repo-root `CLAUDE.md` / `README.md`. No cross-service work.

**MANUAL post-round:**

1. Unpin (`./install.sh`) and restore `healthCheck` to `bun run build`.
2. `cairn init` in this repo to install `/cairn-run`, `cairn-task-agent`, the updated reviewer and the hook.
3. **Validation round:** a small real round run through `/cairn-run` from the phone, in `bypassPermissions`; try `auto` for part of it. Compare against a `cairn run` round. Only after that, consider removing any headless code.

## Open Questions

- **Do custom agent types (`cairn-task-agent`, `post-task-reviewer`) load `CLAUDE.local.md`?** Confirmed only for `general-purpose` (probe a′). Very likely, since custom types loaded the same memory files in probe (a). Check with `cairn-task-agent` in the validation round, before the `instructions.md` fallback is deleted.
- **Probe (c): hook specifics.** Confirm `agent_id`/`agent_type` presence, that a deny blocks under `bypassPermissions`, and the exit-code semantics for failing open. If a hook deny does *not* bind under bypass, the default mode recommendation flips to `auto`.
- **Right value for `maxTurns` on `cairn-task-agent`**, and whether the reviewer also gets one. Pick during task generation; no data yet.
- **Should `cairn run` also switch to prompt files,** or keep inline prompts? The reviewer changes (no test runs, test summary) apply to both modes because `settle` is shared. Sharing is simpler; keeping the prompt path separate is lower-risk mid-transition.
- **Concurrent loops:** should `cairn round next` refuse when another loop (`cairn run` or a second `/cairn-run`) is live? The lock protects files, not the round's logic.
- **Does `auto` mode wrongly deny routine Cairn actions** (`git commit`, `bun test`, `cairn task complete`)? Answer in the validation round.
- **Can the phone approve permission prompts over Remote Control?** Not documented. Only matters if the bypass/auto recommendation changes.
