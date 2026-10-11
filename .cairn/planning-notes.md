## Context

**Round 21 planning session (2026-10-10).**

**Round 20 is done.** Tasks #143–#149 shipped `cairn watch`, `cairn round new` (the round bump moved from `cairn plan` to `/generate-tasks`), the `/teach` learning mode and their docs. `tasks.json` is empty, `nextTaskId` is 150, and `state.json` round is 20. The binary is **unpinned** (`~/.local/bin/cairn` is a symlink to `dist/cairn`, and `cairn.json` `healthCheck` is `bun run build`). The next `/generate-tasks` runs `cairn round new`, so this round becomes **21** automatically.

**What prompted this round.** After round 20 the user fixed the review concerns by hand in commit `ae95f0a` ("Fix round-20 review concerns"). Comparing that commit with `.cairn/reviews/round-20.md` shows what a round-level pass has to do that a per-task reviewer cannot:

- **Deduplicate.** The `cairn watch --session` exit-1 problem appears in three task reviews (#144, #145, #149) as one underlying issue.
- **Drop what later tasks resolved.** #147's review noted the CLAUDE.md layout tree was missing two files; the docs task later in the round covered it.
- **Read past the verdicts.** The `--session` path-escape the user fixed was a "minor note" under a CLEAN verdict on #144. Filtering on `HAS_GAPS` / `HAS_RISKS` would miss it.
- **Decline some findings.** The user left the loose `toContain` assertion, the mtime tie ordering and the drain window alone.

A per-task reviewer only sees its own commit range. A round reviewer sees the final state of the tree.

**Relevant code as it stands:**

- `cairn round next` (`pickNext()` in `src/commands/round.ts`) returns `review`, `task` or `round-done`. The `round-done` branch prunes orphans, runs `sweepRoundTempFiles()` and returns the `blocked` count.
- The per-task reviewer (`agents/post-task-reviewer.md`) appends a `## Task #<id>: <title>` section ending in `### Verdict` (`CLEAN | HAS_GAPS | HAS_RISKS`) and `---` to `.cairn/reviews/round-<N>.md`. The path comes from `resolveReviewFilePath()` (`src/post-task-reviewer.ts`).
- The hook (`src/commands/hook.ts`) scopes `agent_type: post-task-reviewer` to writes inside `<dataDir>/reviews/` and read-only git commands with no `$`, backticks or redirection.
- `cairn task add` takes `--file <path>` pointing at a JSON task file, and assigns the id itself (`taskAdd()` in `src/commands/task.ts`). CLAUDE.md's Agent workflow block shows a stale `--title/--description` form.
- `review.postTask` is the existing config flag (`src/types.ts`); an absent value means per-task review is off.
- Headless `cairn run` ends its round by breaking out of a `for` loop when no task is ready, then sweeping (`src/commands/run.ts`).

**Also raised this session, settled without work:** Claude Code's prompt suggestions pre-fill answers to `/teach` understanding checks. A slash command cannot switch them off mid-session; the documented controls are the `/config` "Prompt suggestions" toggle, the `promptSuggestionEnabled` setting, and the `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` env var. The user will use `/config`.

## Goals

1. **A post-round review** that runs at round end under `/cairn-run`: it triages every finding in the round's review file, turns the ones that still apply into fix tasks, lets the normal loop run them, then records the outcome.
2. **The review file stays append-only.** The original per-task sections are never changed; the round reviewer only adds blocks beneath them. This is enforced by the CLI, not only by the prompt.
3. **A config flag,** `review.postRound`, on by default.
4. Docs for the above.

## Approach

### Decision log (this session)

| # | Decision | Why | Alternative rejected |
|---|---|---|---|
| 1 | Still-applicable findings become **fix tasks** run by the normal loop | fixes get test validation and their own per-task review | triage-only report; the reviewer fixing code directly |
| 2 | **One fix pass per round** | fix tasks' own review concerns must not start another triage | repeating until clean |
| 3 | The round reviewer **only adds** to the review file | the per-task record stays as written | rewriting or annotating original sections in place |
| 4 | **Two passes:** triage at round end, closing after the fix tasks settle | "explains the fix" and a final verdict are only true once the fix has run | a single pass |
| 5 | The triage pass **writes its dispositions immediately** | if the round dies between passes, the file still shows what was decided | writing everything in the closing pass |
| 6 | A changed fix is **appended as an outcome**, never edited into the plan | the file shows both what was intended and what was done | updating the planned-fix text |
| 7 | **`/cairn-run` only** for now, with mode-neutral logic in a shared module | headless needs loop-control changes, a second spawner and a second containment story | building both modes now |
| 8 | Config flag `review.postRound`, **on by default** | the user wants it as standard behaviour | off by default; no flag |
| 9 | Start with the fix/leave rubric below, held in the agent prompt | it mirrors the user's round-20 choices and is cheap to adjust | deciding the rubric later |

### What gets written to the review file

Under each task section that has findings, the round reviewer adds blocks after that section's existing `### Verdict`. The triage pass writes the first block; the closing pass writes the other two.

```markdown
### Verdict
HAS_RISKS

### Round Triage
Reviewed: <timestamp>
1. `--session` exits 1 before the first subagent: still applies. Planned fix (task #150): wait when `<session>.jsonl` exists.
2. Drain window on switch: not fixing, subagents run one after another.

### Round Outcome
Reviewed: <timestamp>
1. Fixed by #150 (abc1234). Differs from plan: also rejects session ids that aren't plain names.

### Round Verdict
RESOLVED
```

- **Round verdicts:** `RESOLVED` (fix landed, as planned or differently, with any difference stated), `UNRESOLVED` (fix task blocked, or its own review raised concerns; left for the user), `ACCEPTED` (nothing needed fixing).
- When nothing in a task section needs a fix, the **triage pass writes the `### Round Verdict` itself** and that task gets no outcome block.
- A task section with no findings at all gets no blocks.
- A `### Round Triage` with no `### Round Verdict` after it means the round review did not finish. That is visible in the file without extra state.
- The closing pass learns what happened from the fix task's diff, its completion notes and its own `## Task #<id>` review section, not from the triage plan.

### Triage rubric (lives in the agent prompt)

| Fix | Leave, with a stated reason |
|---|---|
| Behaviour that contradicts the task's spec | Theoretical or very unlikely cases |
| Docs that state something false | Test-quality nits |
| Anything touching safety or containment, even if minor | Process notes that can't be acted on (e.g. "TDD claim unverifiable") |
| | Findings already resolved by a later task |

The triage pass reads every finding, including "minor notes" under a CLEAN verdict, and deduplicates findings that share one underlying issue across task sections.

### Phases and the one-pass cap

The CLI records a forward-only phase for the round review:

1. **Triage.** No ready tasks remain, the flag is on, the round's review file exists and no round review has run: `cairn round next` hands out the triage prompt instead of `round-done`.
2. **Fixing.** Fix tasks are ordinary tasks. The existing loop runs, settles and reviews them.
3. **Closing.** No ready tasks remain again and triage already happened: `cairn round next` hands out the closing prompt.
4. **Done.** `round-done` as today, plus a count of `UNRESOLVED` items for the notification.

The phase never moves backwards, so concerns raised against a fix task cannot start a second triage. If triage creates no fix tasks, the round goes straight to done with no closing pass.

The round review is skipped when the flag is off or the round has no review file (which is also the case when `review.postTask` is off).

### CLI surface (`/cairn-run` only)

- **`cairn round next`** gains a verdict, e.g. `{ verdict: 'round-review', pass: 'triage'|'closing', promptFile, next }`, checked before the `round-done` branch. `round-done` gains an `unresolved` count.
- **A settle step for the round review** (name to be fixed at task generation, e.g. `cairn round review-settle`): runs the append-only check, advances the phase and prints one JSON verdict with a `next` hint. Like the other `round` commands it exits 0 for every verdict.
- **Append-only check.** `cairn round next` snapshots the review file when it hands out a round-review pass. The settle step verifies every snapshot line is still present, in order, and restores the snapshot if not. Inserting blocks mid-file passes; changing or deleting an original line fails.
- **Shared module.** The phase logic, both prompt builders and the append-only check go in a new module (the way `settleTask()` is shared), so headless can be added later with only loop and spawner work.
- **Scratch files.** The round-review prompt file and the snapshot are not matched by `sweepRoundTempFiles()` (its regexes require `task_<id>_`), so they need their own cleanup on the done phase and their own `.gitignore` entries.

### The new agent: `post-round-reviewer`

- A new agent file `agents/post-round-reviewer.md`, installed by `cairn init` like the others, separate from `post-task-reviewer`.
- **Hook scope** for `agent_type: post-round-reviewer`: writes only inside `<dataDir>/reviews/`, the same read-only git commands as the per-task reviewer, plus `cairn task add --file <path>`. The existing ban on `$`, backticks and redirection in its Bash commands stays; task text goes in the JSON file, so it never appears on the command line.
- **Creating fix tasks.** The agent writes each fix task as a JSON file and runs `cairn task add --file`. One task per underlying issue, with small related fixes in the same area grouped, since each fix task costs a task agent run plus a per-task review.
- **Fix task tests.** The triage prompt carries the test commands the round's original tasks declared, so fix tasks are validated the same way.
- **Blocked tasks.** The round review still runs on whatever completed and does not try to unblock anything.
- Its final response is one line, like the per-task reviewer's.

### `/cairn-run` and headless

- `commands/cairn-run.md` gets the new verdict: launch `post-round-reviewer` with `Read <promptFile> and follow it`, run the settle step, follow `next`. The `round-done` notification mentions `unresolved` when non-zero.
- Headless `cairn run` is unchanged: round end behaves as it does today.

### Run mode for this round

**Pinned, under `/cairn-run`.** The round edits `round.ts`, `hook.ts`, `init.ts`, `types.ts` and the run-state code, and the hook is live in the session, so the CLAUDE.md pin procedure applies.

The pinned binary predates the feature, so the round review will not run at this round's own end. After unpinning, the documented `cairn round next` step will return the triage verdict for `reviews/round-21.md`. That is the first live test, and it must be run **from inside a `/cairn-run` session** so something can launch the agent.

## Rejected Alternatives

**This session (round 21):**

- **Triage-only round review** (a report the user then fixes or delegates). Rejected: the user wants the fixes carried out, with the normal validation and review.
- **The round reviewer fixing code directly.** Rejected: the fixes would skip settle, test validation and per-task review, and the hook deliberately limits reviewer writes to `reviews/`.
- **More than one fix pass per round.** Rejected: fix tasks can raise their own concerns, and an unattended round must end. Leftovers are marked `UNRESOLVED` for the user.
- **Editing or annotating the original per-task review sections.** Rejected: the round reviewer only adds.
- **Rewriting the planned-fix text when the fix turns out differently.** Rejected: the outcome block states the difference; the triage block stays as the record of intent.
- **Writing everything in the closing pass.** Rejected: a round that dies between passes would leave no trace of the triage.
- **Enforcing append-only by prompt alone.** Rejected: the hook cannot tell an insert from a rewrite, so the CLI checks against a snapshot.
- **Filtering triage on `HAS_GAPS` / `HAS_RISKS` verdicts.** Rejected: round 20's path-escape fix came from a minor note under CLEAN.
- **Building the round review for headless `cairn run` too.** Rejected for now: not trivial, and the user runs rounds through `/cairn-run`. The shared module keeps it possible.
- **`cairn plan` setting `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`, or a `cairn plan --teach` flag.** Rejected: the user will use the `/config` toggle.
- **`/teach` editing `.claude/settings.local.json` to turn suggestions off.** Rejected: mid-session effect is undocumented, it outlives the session, and it breaks "the CLI owns state".

**Round 20:**

- **`cairn logs -f` as the live view.** Rejected for `cairn watch`: a live agent stream is different from the iteration/settle log.
- **Hook-written activity log** (widen the PreToolUse matcher or add a PostToolUse hook that appends one-line summaries). Rejected:
  - it spawns `cairn` on every tool call
  - it shows tool calls only, no agent text
  - the transcript files already exist
- **Progress fed into the `/cairn-run` session (Monitor on a milestone feed).** Rejected: the user watches locally, and every line costs the run agent's context, which conflicts with the "stay terse" rule.
- **Putting the learning-mode instructions in `CLAUDE.local.md`.** Rejected: every session loads it, including task agents.
  - A task agent told to wait for "let's build" ends its turn.
  - Settle sees a `pending` task (stall) or an `in-progress` one (incomplete), retries fresh, and blocks after 3 attempts.
  - The reviewer never runs, since there's no completed task.
- **Editing `.claude/agents/planner.md` in place.** Rejected: `cairn init` overwrites it by filename.
- **Learning mode on by default / a startup-file layer appended via `buildDynamicContext`.** Rejected for now: the user wants it off by default.
  - Revisit if `/teach` ends up being typed at the start of nearly every session. The optional-file-via-`buildDynamicContext` mechanism is the way to add a default.
- **A personal `~/.claude/commands/teach.md`.** Rejected: it must know Cairn's files and rules.
- **Writing `planning-notes.md` continuously in learning mode.** Rejected: quit → re-run → `/generate-tasks` would treat a draft as final.
- **End-only writes in learning mode.** Rejected: the re-entry trail is lost on quit.
- **The draft's `docs/PLANNING_STATE.md`.** Replaced by the gitignored running log in the data dir.
- **Bumping the round inside `cairn task next-id`.** Rejected: task agents and review sessions call `next-id` mid-round.
- **Committed glossary.** Rejected: personal.
- **The planner deleting the running log after writing notes.** Rejected: the CLI owns state, so `cairn round new` deletes it.

**Round 19:**

- **Moving ntfy to its own `notifications.ntfyTopic` key.** Rejected: Claude Code now has built-in notifications, and ntfy fired only under headless `cairn run`, not `/cairn-run`.
- **Keeping ntfy under the `narration` key.** Rejected: it leaves a misleadingly named config block behind.
- **An `init` migration that deletes old narration hook scripts in other projects.** Rejected: they exit when the socket is missing, so they're inert. Unlike the round-13 deny rules, they break nothing.
- **Building "record the red run" into Cairn's task prompt.** Rejected: TDD is the user's personal convention, not a Cairn feature. The line went into `CLAUDE.local.md`.
- **Having the reviewer stop checking TDD order.** Rejected in favor of agents recording the evidence.
- **A probe harness for `REVIEWER_DISALLOWED_BASH_RULES`.** Rejected: the dated doc comment is enough.
- **A new cleanup command, or cleaning `.cairn/` at a different point.** Rejected: the round-end sweep (#131) already does it. The leftovers came from the pinned binary predating #131, which the unpin step fixes.
- **Keeping every blocked task's scratch files (prompt and notes too).** Rejected: only `_tests.log` explains a block.
- **Deleting a blocked task's `_tests.log` when `tasks.json` can't be read.** Rejected: when the status is unknown, keep the diagnostics.

**Round 17:**

- **Unpinned validation round.** Rejected once the hook tasks were in scope: the hook is live in the session, and a mid-round rebuild would change the containment layer while the round runs.
- **Strip `${` / braces in `hasOutputOption` instead of denying `$`.** Rejected: patching one expansion form at a time is the pattern that produced the hole. The reviewer never needs `$`.
- **Only documenting the `CAIRN_PROJECT_ROOT` behavior.** Rejected: the fix is small, and the tool call's `cwd` is the true answer for the session the hook guards.
- **Changing `findProjectRoot`'s default to prefer `cwd` over the environment variable.** Rejected: every CLI command spawned by cairn relies on the environment variable winning.
- **Rewriting an existing `.cairn/.gitignore` from `GITIGNORE_CONTENT`.** Rejected: it would drop user additions and the legacy block. Append-only merge.
- **One task for all 38 `test/` type errors.** Rejected in favor of two batches.
- **A small side project for the validation round.** Rejected: this repo had real, low-risk work queued, and the pin makes self-modification safe.

**Round 16:**

- **Type-check in `healthCheck`.** Rejected: it runs before every iteration, and a type error would block the *next* task's health check instead of failing the task that introduced it.
- **Type-check as a script only, with no gate.** Rejected: agents' self-reported "no new tsc errors" isn't reliable.
- **Relying on `defaultTestCommand` alone for the gate.** Doesn't work: it's a prompt hint, not something validation runs. The gate goes into each task's declared `tests`.
- **Hook blocks subagent Bash writes to `tasks.json`** (redirection, `sed -i`, `mv`, `cp`, `tee`). Rejected: pattern matching is easy to get around and goes beyond what headless enforces.
- **Fixing the #105 gap only in `cairn-run.md` wording.** Rejected: the run agent's memory is exactly what compaction loses. The verdict carries the fields.
- **Re-reading the record right before the SHA decision.** Rejected in favor of capture-unconditionally-then-decide-under-lock.
- **Pruning `awaiting-review` records for archived tasks.** Rejected: those are pending reviews.
- **Making the concurrent counter `get`/`set` atomic** (#93). Deferred until concurrent loops are on the table.

**Round 15:**

- **Workflow scripts for the loop.** Rejected: rounds are under 20 tasks, Workflows eat token budgets, and it's unclear how much a running Workflow can be redirected from a phone. Revisit if rounds grow large.
- **Task agent launches its own reviewer (nesting).** Rejected: the reviewer loses independence, the deterministic steps get skipped, and failure handling ends up inside a subagent.
- **Run agent reads `tasks.json` and picks tasks itself.** Rejected: costs context and moves tested logic into prompt prose.
- **Guard counters kept by the run agent.** Rejected: compaction or restart miscounts.
- **`--before-sha` passed only as a flag.** Rejected: the attempt record exists anyway. Kept as an override.
- **Finding the review range from `Task #<id>:` commit messages as the primary method.** Rejected. Kept as the fallback.
- **A `selectedStatus` field.** Rejected: "still pending at settle" is enough.
- **Putting `next`/`settle` under `cairn task`.** Rejected: a task agent calling `settle` would archive its own task and skip its own review.
- **Returning prompts inline from `next`/`settle`.** Rejected in favor of prompt files.
- **Passing full test output to the reviewer.** Rejected: summary plus log path instead.
- **Pausing the loop with AskUserQuestion on a block.** Rejected: it stalls unattended rounds.
- **Moving `instructions.md` into the project `CLAUDE.md`.** Rejected: that file is committed, and the content is personal.
- **Multiple independent reviewers (`review.maxIterations`).** Deferred, config deleted. Sketch if revived: focused lenses or mixed models; reviewers *return* findings; a `review-merger` agent writes one section.
- **Removing headless `cairn run`.** Rejected until a real round succeeds through `/cairn-run`. That condition has been met since round 17. The user chose to **leave it open** in round 20, and the user also misses the `-p` live view; see Open Questions.
- **Idempotency keyed on archived status.** Rejected: keyed on the attempt record.
- **Mapping the task's `agent` field to `subagent_type`.** Rejected: always launch `cairn-task-agent` and embed the specialist in the prompt file.
- **Built-in `general-purpose` as the task agent type.** Rejected: it can't set `maxTurns`.
- **Hook denies `tasks.json` edits only while a round is live.** Rejected: a crashed round's stale record would block generate-tasks.
- **Shell-script hook.** Rejected in favor of `cairn hook pre-tool-use`.
- **`default`/`acceptEdits` mode plus an allowlist for `/cairn-run`.** Rejected for unattended rounds.
- **`incompletes` limit of 2.** Rejected: it never tries a fresh agent on a stuck task.
- **Dropping SUBAGENT STRATEGY from the subagent-mode prompt.** Rejected: nesting works.

**Corrected from earlier rounds:**

- ~~"Guard counters are in memory and per-run on purpose."~~ Counters live in run state.
- ~~"Dropping test execution from the reviewer's remit — moot."~~ Adopted in round 15.
- ~~"Subagents do not load the parent's auto memory."~~ They do.
- **"Skills instead of subagents"** stays rejected as worded.

**Carried forward from round 14 and earlier:**

- **Per-agent deny via `--settings`.** Rejected: headless mode is already deny-by-default.
- **Keeping the deny rules and exempting the loop some other way.** Rejected: a deny wins when rules merge.
- **Manual removal only, no init migration** (for the legacy deny rules). Rejected.
- **A `cairn doctor` command.** Deferred; revisit if a second known-bad state appears.
- **Halting the entire run on a same-task stall.** Rejected in favor of block-and-continue.
- **Grant broad `Bash(*)` with targeted denies.** Rejected.
- **Blanket `Bash(cairn task:*)` deny.** Rejected: breaks `cairn task next-id` / `show`.
- **Grant `Bash(find|cat|ls|rg|grep|head|wc:*)`.** Rejected.
- **Write rules or the hook to `.claude/settings.json` (committed).** Rejected.
- **Cairn writes to global git excludes.** Rejected.
- **Truly runtime-configurable brand name.** Rejected: bootstrap trap.
- **Renaming `.ralph_task_*_notes.md`.** Rejected permanently.
- **Declaring task `tests` root-relative everywhere.** Rejected.
- **Try-then-fall-back cwd for test validation.** Rejected.
- **An explicit per-task `testCwd` field.** Rejected.
- **Giving `healthCheck` the per-directory resolver.** Rejected.
- **Never normalize a resolved API key onto plain `ANTHROPIC_API_KEY`.**
- **`BRAND` constants in test assertions.** Rejected as partly tautological.
- **Splitting a self-modifying round into stop/rebuild/restart batches.** Rejected.
- **Rewriting archives during a sweep.** Rejected: falsifies history.
- **Per-task review files.** Not adopted; escape hatch if per-round files grow too long.
- **Agent-managed `state.json`.** Rejected.
- **Store `nextTaskId` inside `tasks.json`.** Rejected.
- **Audit agent writes `planning-notes.md` directly.** Rejected.
- **Separate `audit` CLI command.** Rejected.
- **Anthropic TS SDK instead of shelling out to `claude`.** Rejected.
- **Change storage format (SQLite / per-task files / JSONL).** Rejected.
- **Pre-commit to git worktrees for parallel execution.** Deferred to the RFC round.

## Rough Task Outline

**MANUAL pre-round (user), in this order:**

1. **Commit** this `planning-notes.md`.
2. **Pin** (CLAUDE.md procedure):
   - `bun run build`
   - copy `dist/cairn` over `~/.local/bin/cairn`, and verify it's a regular file
   - set `healthCheck` to `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`
3. **Generate tasks** (`/generate-tasks`, which now runs `cairn round new` and makes this round 21), then launch a fresh `claude --permission-mode bypassPermissions` and run `/cairn-run`.

**Round tasks** (IDs from #150). Every task is TDD, with tests = `bun run typecheck` + `bun test`. No specialist agents apply. Every task says: *don't modify `cairn.json`, `install.sh` or `package.json`'s `build` script (the binary is pinned); never run `cairn round`/`cairn hook`/`cairn init`/`cairn watch` against the project root; temp dirs only.*

1. **Config flag `review.postRound`** (`src/`, `test/`)
   - Add the optional boolean to the `review` config type and its validation in `src/types.ts`; absent means on. Add a small helper that answers "is the round review enabled".
   - `cairn init` (`src/commands/init.ts`) writes it alongside `postTask`.
   - Tests: absent, `true` and `false` values; a non-boolean value fails validation; init output.
   - *No deps.*
2. **Append-only check** (`src/`, `test/`)
   - In a new shared round-review module: snapshot a review file, verify that every snapshot line is still present in order, and restore the snapshot on failure.
   - Tests: blocks inserted mid-file pass; a changed line, a deleted line and reordered lines fail and restore; a missing snapshot is reported, not thrown.
   - *No deps.*
3. **Round-review phase tracking** (`src/`, `test/`)
   - Forward-only phase for the current round (triage, fixing, closing, done), with read and advance functions and a decision function: given the flag, the phase, whether the review file exists and whether ready tasks remain, what happens next.
   - Where it is stored is an open question below; resolve it before this task is written.
   - Tests: every transition; the phase never moves back; flag off and missing review file both skip; no fix tasks created goes straight to done.
   - *Deps: 1.*
4. **Prompt builders for the two passes** (`src/`, `test/`)
   - Triage prompt: the review file path, the round's task ids and declared test commands (from `tasks.completed.json`), the rubric, the block format, and how to create fix tasks with `cairn task add --file`.
   - Closing prompt: the review file path, the fix task ids with their commit ranges, the outcome and verdict format.
   - Both written to a prompt file in the data dir.
   - Tests: the prompts name the resolved review path, carry the test commands and never tell the agent to edit existing lines.
   - *Deps: 3.*
5. **`post-round-reviewer` agent definition** (`agents/`, `test/`)
   - New `agents/post-round-reviewer.md`: role, the append-only rule, the block formats and verdict vocabulary, the one-line final response.
   - Test: `cairn init` into a temp dir installs it (`installMdDir` copies all of `agents/*.md`, so this is a guard).
   - *Deps: 4* (formats must match the prompts).
6. **Hook scope for `post-round-reviewer`** (`src/commands/`, `test/commands/`)
   - In `src/commands/hook.ts`: writes only inside `<dataDir>/reviews/`; Bash limited to the `GIT_INSPECTION_RULES` prefixes plus `cairn task add --file <path>`, with the existing bans on `$`, backticks, redirection and `--output` kept.
   - Share the scope code with the per-task reviewer where it is the same.
   - Tests: allowed and denied cases for each rule; `cairn task add` with other subcommands or flags is denied; `post-task-reviewer` behaviour is unchanged.
   - *No deps.*
7. **`cairn round next`: the round-review verdict** (`src/commands/`, `test/commands/`)
   - Before the `round-done` branch in `pickNext()`: when the decision function says triage or closing, take the snapshot, write the prompt file and return the `round-review` verdict with a `next` hint.
   - `round-done` gains an `unresolved` count read from the review file, and cleans up the round-review prompt file and snapshot.
   - Tests: triage handed out once; fixing phase returns ordinary `task` verdicts; closing handed out after the fix tasks; flag off returns `round-done` as before; a crash between verdict and settle hands the same pass out again.
   - *Deps: 2, 3, 4.*
8. **Round-review settle command** (`src/commands/`, `src/index.ts`, `test/commands/`)
   - New `cairn round` subcommand: runs the append-only check, advances the phase, prints one JSON verdict with a `next` hint, exits 0 for every verdict.
   - Tests: a clean pass advances; a violated check restores the file and returns the verdict agreed in the open question below; idempotent on a repeat call.
   - *Deps: 2, 3, 7.*
9. **Gitignore entries for the round-review scratch files** (`src/commands/`, `test/commands/`)
   - Add the prompt-file and snapshot suffixes to `TEMP_IGNORE_SUFFIXES` in `src/commands/init.ts`.
   - Tests: fresh init writes them; re-init appends them without reordering.
   - *Deps: 7* (filenames must match).
10. **`/cairn-run` instructions** (`commands/`, `test/`)
    - `commands/cairn-run.md`: the `round-review` verdict (launch `post-round-reviewer`, run the settle step, follow `next`) and `unresolved` in the round-done notification.
    - Test: the installed command file names the agent type and the settle command.
    - *Deps: 7, 8.*
11. **Docs** (repo root: `CLAUDE.md`, `README.md`)
    - CLAUDE.md: the new verdict and settle command, the phases and one-pass cap, the append-only check, the `post-round-reviewer` hook scope, `review.postRound`, the new scratch files in the data layout, and that headless `cairn run` has no round review.
    - Fix the stale `cairn task add --title/--description` line in the Agent workflow block; the command takes `--file <path>`.
    - Unpin procedure: the post-unpin `cairn round next` can now return a round-review verdict, so run it from a `/cairn-run` session.
    - README: a short section on the post-round review and the flag.
    - Verify every claim against the shipped code.
    - *Deps: 1–10. Last.*

Directories: `src/`, `src/commands/`, `test/`, `test/commands/`, `agents/`, `commands/`, plus the repo-root `CLAUDE.md` and `README.md`. No cross-service work.

**MANUAL post-round:**

1. **Unpin** (`./install.sh`) and set `healthCheck` back to `bun run build`.
2. **Re-run `cairn init`** in this repo to install `post-round-reviewer.md`, the updated `cairn-run.md` and the new gitignore entries.
3. **First live test:** start a `/cairn-run` session in this repo. `cairn round next` should return the triage verdict for `reviews/round-21.md`; let it run through fix tasks and the closing pass.
4. Check `reviews/round-21.md`: original sections unchanged, triage, outcome and round verdict blocks present.
5. `cairn summarize`, then commit the round bookkeeping.

## Open Questions

**New this round (resolve at task generation):**

- **Where the round-review phase is stored.** Options:
  - `.cairn_run_state.json`: fits "round runtime state", but an unparseable file reads as empty, which would re-run triage on a file that already has triage blocks.
  - `state.json`: committed and keyed by round number, so it survives, but it adds round bookkeeping to a file that so far holds only counters.
  - Derive it from the review file itself (triage blocks present, verdicts present), with no stored phase.
- **What the settle step does when the append-only check fails.** Restore and hand the same pass out once more, or restore, mark the round review as failed and report it in `round-done`.
- **How `round-done` counts `UNRESOLVED`.** Parsing `### Round Verdict` lines from the review file is deterministic; the alternative is trusting the closing agent's final line.
- **Model for `post-round-reviewer`.** The headless per-task reviewer uses Sonnet; triage is a judgement call across the whole round and may warrant a stronger model.
- **How the closing pass learns each fix task's commit range.** The attempt record is cleared on `done`, so the fallback is the `Task #<id>:` commit-message search that settle already uses.
- **Review files from before this feature.** After upgrading, `cairn round next` in a project whose current round already has a review file would start a triage. That is wanted for round 21 here; decide whether other projects need a guard.

**Carried forward:**

- **Should headless `cairn run` be removed or demoted?** Left open in round 20. `/cairn-run` has run rounds 17–20, and this round adds a feature only `/cairn-run` has. `cairn watch` exists now; revisit after using it for a round.
- **Round-17 validation results were never recorded.** Answerable from experience:
  - Does `auto` mode wrongly deny routine actions?
  - Does Remote Control approve prompts?
  - Is `maxTurns` 150 right?
  - Does a compacted or resumed run agent behave identically?
- **Should `cairn run` switch to prompt files?** Moot if it's removed.
- **Headless reviewer raw-text matching:** is there an escaping form of the `--disallowedTools` patterns worth chasing? Low priority.
- **Should `cairn round next` refuse when another loop is running?** (carried from round 15)
- **`--before-sha` on a repeat call:** save the override, or reject a value that differs? Revisit only if it causes confusion.
- **Should `cairn run` stamp `promptFile` / `model` into its log?** Moot if `cairn run` is removed.
- **The per-task reviewer reported that the hook blocked `grep` and `git grep`** in round 20, so it could not search for stale doc claims. It has the Grep tool; check whether its prompt should point it there, or whether `git grep` belongs in `GIT_INSPECTION_RULES`.
