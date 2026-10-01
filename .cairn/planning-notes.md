## Context

**Round 20 planning session (2026-09-30).**

**Round 19 is done.** Tasks #138–#142 shipped the following, and the user's "fixups and removing narration code" commit (e74f8f6) is in:
- the sweep keeps blocked tasks' `_tests.log`
- narration and ntfy are removed
- the doc fixes and the unpin step

`tasks.json` is empty and `nextTaskId` is 143. The binary is **unpinned** (`cairn.json` `healthCheck` is `bun run build`).

**`state.json` round is wrong.** It was committed at 19 and now reads **21**. `cairn plan` bumps the round on *every* launch (`bumpRound()` in `runPlan`, `src/commands/plan.ts`), so a planning session that was quit and re-run skipped round 20. No `reviews/round-20.md` exists. This round should be **20**, which is a manual reset; see the pre-round steps. Fixing the cause is goal 2.

**Things the user raised this session:**
1. **No visibility into `/cairn-run` task agents.** Under `cairn run`, the `claude -p` stream-json output was rendered live by `src/stream-filter.ts`. Under `/cairn-run`, the user only sees "handed to a background agent" and later the result.
   - **Probe:** Claude Code writes each subagent's transcript live to `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl`, plus `agent-<id>.meta.json`, e.g. `{"agentType":"post-task-reviewer","description":"Review #139",...}`.
   - The slug is the project root with non-alphanumerics replaced by `-`, e.g. `-Users-jhummel-Documents--Repos-cairn`.
   - Transcript lines have the same shape as stream-json: `{"type":"assistant","message":{"content":[{"type":"tool_use",...}]}}` and `{"type":"user",...tool_result...}`. So `fmtTool` / `fmtResult` can render them.
2. **Planning sessions go over the user's head.** Too many details, too much assumed knowledge, not enough learning about how concepts fit together. The user brought a draft slash command from another session (`~/Downloads/plan.md`, "Planning Session Mode"). It covers:
   - a re-entry briefing
   - defining terms and explaining the why before the how
   - one concept per message
   - a breadcrumb line, and one question at the end of each reply
   - understanding checks before locking a decision
   - steelmanning and challenging design decisions
   - a written trail and a "Concepts I've learned" glossary

   It wasn't written with Cairn in mind: it writes `docs/PLANNING_STATE.md` continuously. The user wants it integrated into Cairn without forcing it on other Cairn users. This session was run in that style from the midpoint as a trial, and the user responded well to it.

**Where instructions can live, and who reads them.** This is the key concept behind the `/teach` design:

| Location | Read by |
|---|---|
| `CLAUDE.local.md` | **every** session in the repo (planner, task agents, reviewer, normal sessions) |
| `.claude/agents/planner.md` | only `cairn plan`, but `cairn init`'s `installMdDir` overwrites it by filename |
| `buildDynamicContext()` (`--append-system-prompt`) | only `cairn plan`, built fresh per launch |
| slash command | only the session where it's typed |

The system prompt is fixed at launch. A slash command is a saved message that can be injected mid-session.

## Goals

1. **`cairn watch`:** a live, full-detail view of the running `/cairn-run` subagent in a second local terminal, close to the old `-p` experience.
2. **Move the round bump from `cairn plan` launch to task generation,** so quitting and re-running a planning session no longer skips round numbers.
3. **`/teach` learning mode:** an opt-in, toggleable planning style shipped with Cairn, adapted from the user's draft to fit Cairn's planner.
4. Docs for all of the above.

## Approach

### Decision log (this session)

| # | Decision | Why | Alternative rejected |
|---|---|---|---|
| 1 | Live view is a new `cairn watch` command | clearly a live view, distinct from the iteration log | `cairn logs -f` |
| 2 | On startup, replay the current agent's transcript, then follow | joining mid-task still shows what happened | tail-only; last-N lines |
| 3 | Learning mode is **off by default**, toggled **on** mid-session | user wants speed by default, depth on demand | on by default; a startup-only file layer |
| 4 | `/teach` ships with Cairn (`commands/teach.md`, installed by `cairn init`) | it must know about `planning-notes.md` and the planner's rules | personal `~/.claude/commands/teach.md` |
| 5 | Learning mode writes a **separate running log** as it goes. `planning-notes.md` is still written only at the end, with the user's OK. | keeps re-entry across breaks *and* keeps `/generate-tasks` from consuming a half-finished plan | end-only writes (trail lost on quit); continuously written `planning-notes.md` (quit → re-run → generate-tasks treats a draft as final) |
| 6 | The round-bump fix goes into this round | user has hit it before; quality of life, and `/teach` makes re-entry more common | open question for later |
| 7 | The round bump is a dedicated command, `cairn round new`, run by `/generate-tasks` | `cairn task next-id` is also called mid-round by task agents and review sessions, so piggybacking would bump mid-round and split reviews | bumping inside `next-id` |
| 8 | The glossary is **personal and gitignored** | it's the user's learning record, like `CLAUDE.local.md` | committed glossary |
| 9 | `cairn round new` deletes the running log | CLI code is tested and deterministic; a Markdown instruction to "remember to delete" can be skipped or lost to compaction | the planner deletes it after writing `planning-notes.md` |

**Principle the user endorsed, worth applying elsewhere: "the CLI owns state."** Markdown instructions (slash commands, agent prompts) decide *when* to act. A tested `cairn` command performs the state change. `/cairn-run` with settle already follows this, and `cairn round new` extends it.

### `cairn watch`

**Discovery:**
- Config dir is `$CLAUDE_CONFIG_DIR`, defaulting to `~/.claude`. Then `projects/<slug>/`, where the slug is derived from the project root (every non-alphanumeric character becomes `-`).
- Pick the session whose `subagents/` dir changed most recently. `--session <id>` overrides.

**Filtering and labels:**
- By default, only `cairn-task-agent` and `post-task-reviewer` transcripts, read from `.meta.json` `agentType`. This skips planning and Explore subagents.
- `--all` shows every subagent.
- On each switch, print a header from `meta.description` plus the agent type, e.g. `── Task #143 · cairn-task-agent ──`.

**Following:**
- Poll every ~500ms for new lines and new agent files. Don't use `fs.watch`, which is unreliable on macOS.
- On startup, replay the current, newest matching agent's transcript from the beginning, then follow.
- When a newer matching transcript appears, finish draining the current one, then switch.
- If no session has subagents yet, wait. Run until Ctrl-C.

**Rendering:**
- Refactor `src/stream-filter.ts` so a per-event renderer is shared by `processStream` (stdin, `cairn run`) and the file tail.
- Full stream: assistant text blocks, tool calls and results.
- `cairn run`'s output must stay identical.

**Failure mode:**
- This depends on Claude Code's undocumented transcript layout.
- If the projects dir or slug dir is missing, fail **loudly**, naming the path it looked for. Never sit silently.
- Skip unparseable lines; don't crash on them.

**Read-only.** It never touches run state, the hook, settle or `/cairn-run`, and adds nothing to the run agent's context.

### Round bump moves to task generation

- Remove `bumpRound()` from `runPlan()`.
- Add `cairn round new`:
  - calls `bumpRound(dataDir)`
  - deletes the running session log, best-effort
  - prints one JSON object like the other `round` commands, e.g. `{ "verdict": "round-started", "round": N, "next": "..." }`
  - exits 0
- It lives under `round`, not `task`, for the same reason as `round next`/`settle`: task agents only know `cairn task`, so they can't bump the round.
- `commands/generate-tasks.md`: after the user approves and `cairn task next-id --count <n>` runs, run `cairn round new`.
- Add `Bash(cairn round new:*)` to the planner's `--allowedTools` in `plan.ts`. Without it, the planning session can't run the command headlessly-scoped.
- **Semantics change:** during a planning discussion, `state.json` now shows the *previous* round, and the bump happens when the plan becomes tasks. Anything that reads `getRound()` during planning should be checked. As far as found, only the reviewer reads it, at execution time.

### `/teach` learning mode (`commands/teach.md`)

Adapt `~/Downloads/plan.md` as follows.

**Keep:**
- defining terms on first use and explaining mechanism before naming it
- asking "have you worked with X?" before assuming
- why → mechanism → recommendation
- one concept per message, concrete traces over abstractions, no walls of text
- the `📍 Phase · Working on · Decided so far` breadcrumb
- ending each reply with exactly one question or action
- naming tangents and offering the way back
- understanding checks before locking decisions: one at a time, never self-answered, a plain correction if wrong
- steelmanning, naming trade-offs, asking the failure question, separating requirement from preference, holding position without a new argument, flagging scope creep
- not challenging trivia

**Drop:**
- "nothing gets implemented until 'let's build'". The planner never implements.

**Change:**
- **Running log.** Instead of `docs/PLANNING_STATE.md`, write a gitignored scratch log in the data dir, e.g. `.cairn/.cairn_planning_session.md`. Its template:
  - Goal
  - Current phase / focus
  - Decision log (#, decision, why, alternative rejected, open concerns)
  - Open questions
  - Parked ideas
  - Next step

  Update it as decisions land, with a one-line "Logged decision #N" mention. `/generate-tasks` never reads it.
- **Re-entry briefing.**
  - If the running log exists, give the four-line briefing ("Where we are / Last decided / Open question / Suggested next step") from it.
  - Otherwise, give it from `planning-notes.md`.
  - Then ask "Does this match what you remember?"
- **Glossary.** A gitignored `.cairn/concepts.md`, cumulative across rounds:
  - **Read it at the start** so known terms aren't re-explained.
  - Append terms as they're covered.
  - When the user re-asks something covered, point them to where it lives.
- **`planning-notes.md` rules are unchanged:**
  - written only when the user says yes
  - same format, with Rejected Alternatives carried forward
  - The decision log may feed its Approach and Rejected Alternatives.
- **"Stopping" handoff.** Update the running log and give a three-line handoff.
- **Turning it off.** `/teach off`, or "back to normal mode," returns to the standard planner style. The command text should say that a later instruction overrides the earlier one.
- **Compaction.** If the style seems lost after compaction, re-run `/teach`.
- **Scope.** Meant for `cairn plan` sessions, but harmless elsewhere.

**Gitignore.** Add both filenames to `GITIGNORE_CONTENT` in `src/commands/init.ts`:
- `planning_session.md` via `TEMP_IGNORE_SUFFIXES`, which yields `.cairn_planning_session.md`
- `concepts.md`

Re-init merges them into existing projects append-only. Note that `temp-sweep` never touches either file, by construction: its regexes require `task_<id>_`. That's correct, because the running log must survive quitting.

### Run mode for this round

**Pinned, under `/cairn-run`.** The round edits `plan.ts`, `round.ts`, `stream-filter.ts`, `init.ts` and `index.ts`, so the CLAUDE.md pin procedure applies.

`cairn watch` can't be tried during this round, because the pinned binary predates it. Try it on round 21.

## Rejected Alternatives

**This session (round 20):**

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

1. **Set `.cairn/state.json` `round` to 20** by hand. It currently reads 21 because of the double bump. This round's `/generate-tasks` runs the *old* command file, which doesn't call `cairn round new`, so 20 stays put for the round.
2. **Commit** `state.json` along with this `planning-notes.md`.
3. **Pin** (CLAUDE.md procedure):
   - `bun run build`
   - copy `dist/cairn` over `~/.local/bin/cairn`, and verify it's a regular file
   - set `healthCheck` to `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`
4. **Generate tasks** (`/generate-tasks`), then launch a fresh `claude --permission-mode bypassPermissions` and run `/cairn-run`.

**Round tasks** (IDs from #143). Every task is TDD, with tests = `bun run typecheck` + `bun test`. No specialist agents apply. Every task says: *don't modify `cairn.json`, `install.sh` or `package.json`'s `build` script (the binary is pinned); never run `cairn round`/`cairn hook`/`cairn init`/`cairn watch` against the project root; temp dirs only.*

1. **Stream filter: extract a shared per-event renderer** (`src/`, `test/`)
   - In `src/stream-filter.ts`, split `processStream`'s per-line handling into an exported function that takes one parsed event and returns the rendered line(s). `processStream` already renders `tool_use`, `tool_result` and assistant `text` blocks (checked at planning time), so this is a pure extraction: `processStream`'s output must be **unchanged**.
   - Tests: the existing stream-filter tests stay green; add per-event tests for `tool_use`, `tool_result` and text events in transcript shape (`{"type":"assistant","message":{...}}`).
   - *No deps.*
2. **Transcript discovery module** (`src/`, `test/`)
   - New `src/transcripts.ts`:
     - slug derivation from the project root
     - config dir (`CLAUDE_CONFIG_DIR` ?? `~/.claude`)
     - newest session with a `subagents/` dir, or an explicit `--session`
     - list agent transcripts with parsed `.meta.json` (`agentType`, `description`), sorted by mtime
     - filter to `cairn-task-agent` / `post-task-reviewer` unless `all`
   - Missing dirs return a descriptive error result that names the path.
   - All fs is injectable or temp-dir based. Fixture `.jsonl` and `.meta.json` files go in tests.
   - *No deps.*
3. **`cairn watch` command** (`src/commands/`, `src/index.ts`, `test/commands/`)
   - New `src/commands/watch.ts`, registered in `index.ts`, with `--session <id>` and `--all`.
   - Behavior:
     - poll at ~500ms with an injectable clock and sleep
     - replay the current agent's transcript, then follow appended lines (track the byte offset)
     - drain and switch when a newer matching transcript appears, printing a `── <description> · <agentType> ──` header
     - wait quietly while no subagents exist; fail loudly if the projects or slug dir is missing
     - skip unparseable lines
   - Tests drive the loop with fake time and temp dirs:
     - replay, then follow
     - switching agents
     - the filter
     - the missing-dir error
   - *Deps: 1, 2.*
4. **Move the round bump to `cairn round new`** (`src/commands/`, `commands/`, `test/`)
   - Remove `bumpRound()` from `runPlan()`.
   - Add a `cairn round new` subcommand in `src/commands/round.ts`:
     - `bumpRound` + best-effort delete of `.cairn/.cairn_planning_session.md`
     - one JSON verdict on stdout, exit 0
   - Add `Bash(cairn round new:*)` to `plan.ts`'s `--allowedTools`.
   - In `commands/generate-tasks.md`, after approval and `next-id`, run `cairn round new` (both places that describe the approval step: around lines 149 and 159).
   - Tests:
     - `runPlan` no longer changes `state.json`'s round
     - `round new` increments it, deletes the log if present, succeeds if absent, and prints valid JSON
     - the planner's allowed tools include the new rule
   - *No deps.*
5. **Gitignore entries for learning mode** (`src/commands/`, `test/commands/`)
   - Add `planning_session.md` to `TEMP_IGNORE_SUFFIXES` and `concepts.md` to `GITIGNORE_CONTENT` in `src/commands/init.ts`.
   - Tests: a fresh init writes both, and re-init on an existing `.gitignore` appends both without reordering.
   - *No deps.*
6. **`/teach` slash command** (`commands/`, `test/`)
   - Write `commands/teach.md` per the Approach section, adapting the user's draft at `/Users/jhummel/Downloads/plan.md`. Read it; if it's unavailable, the Approach section is the spec.
   - Write it in the draft's voice (second person, short sections).
   - It must reference the real paths: `.cairn/.cairn_planning_session.md`, `.cairn/concepts.md`, `.cairn/planning-notes.md`.
   - It must state that `planning-notes.md` is still written only on the user's OK, and how to turn it off.
   - Test: `cairn init` into a temp dir installs `.claude/commands/teach.md`, and it contains those three paths. `installMdDir` copies all of `commands/*.md`, so this is a guard, not new code.
   - Optional: `cairn plan`'s preflight prints a one-line tip that `/teach` exists, which helps discoverability for other users.
   - *Deps: 4, 5* (the filenames must match).
7. **Docs** (repo root: `CLAUDE.md`, `README.md`)
   - CLAUDE.md:
     - add `watch` and `round new` to the command list
     - `cairn round` section: a `new` verdict, and why it lives under `round`
     - the `state.json` description: the round is bumped by `/generate-tasks` via `cairn round new`, not by `cairn plan`
     - the data layout: `concepts.md` and `.cairn_planning_session.md`
     - a short note that `cairn watch` depends on Claude Code's undocumented subagent transcript layout
   - README: `cairn watch` usage, and `/teach`.
   - Verify every claim against the shipped code.
   - *Deps: 1–6. Last.*

Directories: `src/`, `src/commands/`, `test/`, `test/commands/`, `commands/`, plus the repo-root `CLAUDE.md` and `README.md`. No cross-service work.

**MANUAL post-round:**

1. **Unpin** (`./install.sh`) and set `healthCheck` back to `bun run build`.
2. **Run `cairn round next` once from the repo root** (round-end sweep with the fresh binary).
3. **Re-run `cairn init`** in this repo to install `teach.md`, the updated `generate-tasks.md`, and the new gitignore entries.
4. **Try it:** start the next `cairn plan` and type `/teach`. During round 21, run `cairn watch` in a second terminal.
5. `cairn summarize`, then commit the round bookkeeping.

## Open Questions

- **Double `/generate-tasks` in one session.** If tasks are regenerated or edited after approval, `cairn round new` would bump twice. Possible guards:
  - only bump if the current round has had activity, e.g. archived tasks or a `reviews/round-<N>.md`
  - record `generatedForRound` in `state.json`

  Decide at task generation, or accept and document it.
- **First round in a fresh project.** `state.json` has no round (round 1 by default). The first `/generate-tasks` would bump to 2, so round 1 never has tasks. Consider having `cairn round new` set an *absent* round to 1 rather than 2.
- **Should headless `cairn run` be removed or demoted?** The user chose to leave this open in round 20. Arguments:
  - `/cairn-run` has run rounds 17–19 successfully
  - the user misses `cairn run`'s live view, which `cairn watch` aims to replace
  - revisit after using `cairn watch` for a round
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
