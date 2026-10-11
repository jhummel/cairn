# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Cairn

Cairn is an agentic task orchestration CLI that wraps Claude Code. It turns a planning conversation into a task list (`tasks.json`), then executes each task autonomously with fresh Claude agents — including health checks, test validation, dependency ordering, and archival of completed work.

## Development

Cairn is a TypeScript project built with Bun. The entry point is `src/index.ts`, compiled to `dist/cairn` via `bun run build`.

```bash
# Install (runs bun build, symlinks dist/cairn to ~/.local/bin/cairn)
./install.sh

# Build manually
bun run build

# Run tests
bun test

# Type-check (tsc --noEmit)
bun run typecheck

# Verify
cairn --version
```

`bun run typecheck` covers both `src/` and `test/` (`tsconfig.json`'s `include`; `rootDir` is deliberately unset so files outside `src/` are accepted — `bun build --compile` ignores `rootDir`/`outDir`, so this cannot affect the build). `tsconfig.json` sets `noEmit: true` in place of a former `outDir: "dist"`: with `outDir` and no `rootDir`/`noEmit`, a bare `tsc` invocation (not just `bun run typecheck`'s `tsc --noEmit`) would emit `dist/src/**` and `dist/test/**` into the same directory as the compiled `dist/cairn` binary that `install.sh` symlinks onto PATH. `noEmit: true` makes the safe behavior the tsconfig default rather than a property of how `tsc` happens to be invoked. Neither `bun build --compile` nor `bun test` type-checks, so a task's `tests` array should include `bun run typecheck` alongside `bun test`.

## Architecture

### Execution flow

`src/index.ts` is the entry point. It uses [Commander](https://github.com/tj/commander.js) to parse CLI arguments and dispatch to command handlers in `src/commands/*.ts`:

- **plan** → `src/commands/plan.ts` — Launches a single interactive `claude` session with `--append-system-prompt` and restricted `--allowedTools`. The planning discussion writes `planning-notes.md`; `/generate-tasks` in that same session then writes `tasks.json`.
- **run** → `src/commands/run.ts` — The headless loop. For each iteration: picks highest-priority pending task (respecting dependencies), runs a health check, spawns `claude -p` with a per-task system prompt, then calls `settleTask()` (`src/settle.ts`) to validate tests, apply the guards, archive, and gate for review; when the gate asks for a review it runs the headless reviewer (`src/post-task-reviewer.ts`) and settles again with `reviewed: true`. Agents run with `--dangerously-skip-permissions` and `--output-format stream-json`.
- **round** → `src/commands/round.ts` — `cairn round next` and `cairn round settle <id> [--reviewed] [--before-sha <sha>] [--test-timeout <seconds>]`, the CLI half of the interactive `/cairn-run` slash command (`commands/cairn-run.md`), together with `cairn round review-settle` (no arguments), which settles a post-round review pass that `round next` handed out with a `round-review` verdict (see [Post-round review](#post-round-review)); plus `cairn round new`, run once by `/generate-tasks` to bump `state.json`'s round and delete the `/teach` log `.cairn_planning_session.md` (`{ verdict: 'round-started', round, next }`). Each prints exactly one JSON verdict on stdout. See [Two ways to run a round](#two-ways-to-run-a-round) and [Planning rounds](#planning-rounds-cairn-round-new).
- **watch** → `src/commands/watch.ts` (+ `src/transcripts.ts`) — `cairn watch [--session <id>] [--all]`, a read-only live view of the running `/cairn-run` subagent's transcript, meant for a second terminal. It picks the Claude Code session whose `subagents/` dir was modified most recently (or the one `--session` pins), replays the newest matching subagent transcript from byte 0, then follows appended bytes, switching (with a `── <description> · <agentType> ──` header) when a newer transcript appears. By default it follows only `cairn-task-agent`, `post-task-reviewer` and `post-round-reviewer` (`DEFAULT_AGENT_TYPES` in `src/transcripts.ts`); `--all` shows every subagent. It **polls** every 500ms (`WATCH_POLL_MS`) rather than using `fs.watch`, which is unreliable on macOS, runs until Ctrl-C, and never touches run state, `tasks.json`, the hook or settle. See [cairn watch and the transcript layout](#cairn-watch-and-the-transcript-layout).
- **hook** → `src/commands/hook.ts` — `cairn hook pre-tool-use`, the PreToolUse containment hook for `/cairn-run` subagents. See [Enforcement under /cairn-run](#enforcement-under-cairn-run).
- **task** → `src/commands/task.ts` — the `cairn task` subcommands agents use to mutate `tasks.json` (see [Agent workflow](#agent-workflow)).
- **summarize** → `src/commands/summarize.ts` — Spawns a Sonnet agent to read the codebase and write/update `IMPLEMENTATION.md`.
- **init**, **status**, **edit**, **logs** — `src/commands/*.ts`.

### Key design patterns

- **Fresh agents per task**: Each execution iteration spawns a new `claude -p` process with no memory of previous iterations. Cross-iteration context is passed via `notes` fields in `tasks.json` and a `PREV_NOTES` mechanism.
- **System prompt construction**: `buildSystemPrompt()` in `src/commands/run.ts` generates per-task prompts based on directory and project config. The agent is told its task via the user prompt, not by reading `tasks.json`.
- **Task lifecycle**: pending → in-progress (set by agent) → complete (set by agent) → archived (moved to `tasks.completed.json` by settle). Post-iteration test validation can revert a task to in-progress.
- **Settle**: `settleTask()` in `src/settle.ts` is the one implementation of "what did this attempt do", shared by `cairn run` and `cairn round settle`. Order is **validate → archive → review gate**: validate the task's tests, apply the revert/incomplete/stall guards, re-read the task's status, and — only for a completed task — archive it, then open a review phase if `review.postTask` is on, a beforeSha is known, and HEAD has moved. The reviewer therefore never runs tests; it gets `formatTestSummary()` output plus the test log path.

### Two ways to run a round

1. **Headless `cairn run`** — the loop above: one fresh `claude -p` process per task, and the headless reviewer as another `claude -p`. Nothing is interactive; you watch the stream.
2. **Interactive `/cairn-run`** — a slash command (`commands/cairn-run.md`, installed into `.claude/commands/` by `cairn init`) run inside a normal interactive Claude Code session, so it can be driven or watched remotely via Remote Control. The session is the *run agent*: it runs `cairn round next`, launches a `cairn-task-agent` subagent (`agents/cairn-task-agent.md`) with `Read <promptFile> and follow it`, runs `cairn round settle <id>`, launches the `post-task-reviewer` subagent when settle returns `review`, then `cairn round settle <id> --reviewed`, and loops. When no ready task remains, `round next` returns `round-review` instead of `round-done`: the session launches the `post-round-reviewer` subagent (`agents/post-round-reviewer.md`) on the verdict's `promptFile`, runs `cairn round review-settle`, and loops again (see [Post-round review](#post-round-review)). Agents run **one after another, never nested** — the run agent launches both reviewers, a task agent never does (subagents cannot launch subagents). The CLI owns all decisions; every verdict carries a `next` hint so a compacted or resumed session behaves identically to a fresh one.

Both modes go through the same `settleTask()`. They differ only in who launches the agents and how the reviewer gets its prompt: `cairn run` passes `inlineReview: true` and builds the reviewer prompt in-process; `cairn round settle` writes it to `.cairn_task_<id>_review_prompt.md`. **Headless `cairn run` has no post-round review**: its round end is unchanged (loop exit, then the temp-file sweep), and it never reads or writes the `roundReview` state.

`cairn round next` verdicts: `review` (an open review phase in run state — picked up first, lowest task id first, so a crash between settle and the reviewer never loses a review), `round-review` (`{ verdict, pass: 'triage'|'closing', promptFile, next }` — a post-round review pass for the `post-round-reviewer` agent), `task` (runs the health check, bumps the run-state iteration, writes `.cairn_task_<id>_prompt.md` = `buildSystemPrompt({ mode: 'subagent' })` + the iteration prompt), or `round-done` (`{ verdict, blocked, unresolved, roundReviewFailed?, next }`: the `blocked` task count; `unresolved`, the number of review-file task sections the round review left open, always present and 0 when there is no review file; and `roundReviewFailed: true`, present only when the round review's phase is `failed`). `pickNext()` decides in this order: (1) a pending per-task review; (2) a round-review pass that was handed out and has not settled, handed out again; (3) task selection; (4) with no ready task, a fresh `triage` or `closing` pass, else `round-done`. It also adds a `warnings` array when `.cairn_hook_errors.log` is non-empty. `cairn round settle` verdicts: `retry` (`mode: continue|fresh`, `reason: validation-failed|stalled|incomplete|status-unknown`, optional `failure` tail, plus the task agent's `promptFile` and resolved `model`, both also named in the verdict's `next`, so the run agent never relies on remembered values for a relaunch), `blocked`, `review`, `done` (`reason: review-disabled|no-before-sha|no-commits|reviewed`), `already-settled`. Settle is idempotent — keyed on the attempt record, not archived status. `cairn round review-settle` verdicts: `round-review-settled` (`{ verdict, pass, phase: 'fixing'|'done', fixTasks, next }`), `round-review-failed` (`{ verdict, pass, reason: 'append-only-violated'|'snapshot-missing', next }`), `no-round-review` (`{ verdict, phase, next }` — the phase is not a pending `triage` or `closing`, nothing is changed; this is what makes a repeat call idempotent). Every one of them has `next: "Run: cairn round next"`.

**Exit codes**: `round next`, `round settle` and `round review-settle` exit **0 for every verdict**, `blocked`, `already-settled`, `round-review-failed` and `no-round-review` included. Non-zero (1, one line on stderr) means the command itself could not run: unreadable `tasks.json` after repair/recovery (`TasksFileError`), a lock timeout (`FileLockError`), a task id in neither `tasks.json` nor `tasks.completed.json` (`SettleError`), or an invalid id/option. For `review-settle` that is an unreadable `tasks.json` or a `state.json` lock timeout; the phase is then still pending and the call can be repeated.

**Why `round`, not `task`**: task execution agents are told to use `cairn task`. Settle archives a completed task and opens its review; a task agent that called it on itself would archive its own task and skip its own review. Keeping the driver commands in a separate group keeps them out of the task agent's vocabulary. `review-settle` is under `round` for the same reason: no task agent can settle a round-review pass.

### Post-round review

Under `/cairn-run`, a round does not end at the last task. When no ready task remains, `cairn round next` hands out a round-level review of everything the per-task reviewer wrote to `.cairn/reviews/round-<N>.md`. The `post-round-reviewer` agent triages every finding, creates fix tasks with `cairn task add --file <path>`, the normal loop runs those tasks (each settled and per-task reviewed like any other), and a closing pass records what happened. The shared logic — phases, the append-only check, both prompts, the settle step, the unresolved count — lives in `src/round-review.ts`, mode-neutral (no Commander, no `process.exit`), so a headless version can be added later; today only `src/commands/round.ts` calls it.

**When it runs.** It is skipped — `round next` goes straight to `round-done` — when `review.postRound` is `false`, or when the current round has no review file. The second case is also what happens when `review.postTask` is off, since only the per-task reviewer creates that file. `review.postRound` is on when absent: `loadConfig()` defaults it to `true`, `isPostRoundReviewEnabled()` (`src/config.ts`) treats everything except an explicit `false` as on, and `cairn init` prompts for it ("Enable post-round review?", default yes) right after the post-task prompt. Note the asymmetry: `review.postTask` defaults to `false`.

**Two passes**, each one launch of `post-round-reviewer` on `.cairn/.cairn_round_review_prompt.md` (`writeRoundReviewPromptFile()`), each followed by `cairn round review-settle`. The agent's blocks go inside a task section, after that section's `### Verdict` value and before its closing `---`:

- **Triage** reads every finding in every section (CLEAN ones included), checks it against the current tree, de-duplicates, and decides fix or leave. For each fix it writes a task JSON to `.cairn/reviews/.cairn_round_review_fix_<n>.json` and runs `cairn task add --file` on it. It writes a `### Round Triage` block under each section that has findings, and where nothing in a section needs a fix also `### Round Verdict` with `ACCEPTED`. The prompt lists the round's tasks from the review file's `## Task #<id>:` headings (archived tasks carry no round number) and the distinct test commands those tasks declared, which every fix task's `tests` must repeat.
- **Closing** runs after the fix tasks. For every section with a `### Round Triage` and no `### Round Verdict` it writes `### Round Outcome` and then `### Round Verdict`: `RESOLVED` (the fix landed) or `UNRESOLVED` (the fix task is blocked, missing or incomplete, or its own review raised concerns). It creates no tasks. It learns what happened from evidence, not from the triage plan: for each fix task id the prompt carries the task's status and completion notes (from `tasks.completed.json`, else a plain read of `tasks.json`, else `missing`) and the commits `findTaskCommits()` (`src/settle.ts`) finds — the `Task #<id>:` commit-message search, oldest first.

The value line after `### Round Verdict` is exactly one of `RESOLVED | UNRESOLVED | ACCEPTED`.

**Phases** (`RoundReviewPhase`): `triage` (handed out, not settled), `fixing` (triage settled and created fix tasks), `closing` (handed out, not settled), `done`, `failed` (the append-only check failed; terminal), and an implicit `none` that is never written. The record is `{ round, phase, baselineTaskIds, fixTaskIds }`, stored in `state.json` under the top-level key `roundReview` via `readStateValue()` / `updateStateValue()` (`src/task-counter.ts`, under the `state.json.lock`, preserving every other field). It is **one record that carries its round number**, not a map keyed by round: a record whose `round` is not the current round, or that is malformed, reads as `none`, and the next advance overwrites it. The round number is not the only guard: `cairn round new` also **removes the record** (`startNewRound()`), because with no `round` key in `state.json` the current round reads as 1 and the first bump also yields 1, so a finished round-1 record would otherwise read as the new round's and that round's review would be skipped. **Why `state.json` and not the run-state file**: an unparseable run-state file reads as empty, which would re-run triage on a review file that already has triage blocks and duplicate the fix tasks.

- **Forward only.** `advanceRoundReview()` never moves to the same or a lower rank (`done` and `failed` share the top rank); skipping forward is allowed, and `triage` goes straight to `done` when it created no fix tasks. This is the **one-fix-pass-per-round cap**: concerns the per-task reviewer raises against a fix task never start a second triage. The closing pass reads those sections as evidence and reports them as `UNRESOLVED`.
- **A handed-out pass is re-handed before any task runs.** If the phase is `triage` or `closing` when `round next` runs (crash, compaction), the same pass is returned again ahead of task selection, so fix tasks never run before triage has settled and an interrupted triage is never followed by a second one. The prompt file is rewritten, but the **original snapshot is kept** — re-snapshotting would bless whatever the interrupted agent already wrote. (Only if the snapshot file is gone and the review file exists is a new one taken.) The triage prompt tells the agent to continue from existing `### Round Triage` blocks and fix tasks rather than duplicate them.
- **A fresh pass is not an iteration.** Handing one out runs no health check, bumps no iteration and sweeps nothing. The snapshot and prompt are written before the phase advances.
- `fixing` with no review file left goes to `round-done`, not `closing`.

**Append-only check.** The review file is a record; the reviewer may only add lines. `round next` copies the file to `.cairn/.cairn_round_review_snapshot.md` at hand-out, and `review-settle` runs `checkAppendOnly()`, which writes nothing: every snapshot line must still be present, in the same order (`isAppendOnly()` — the snapshot's lines must be a subsequence of the current lines). Insertions anywhere pass, not just at the end, which is what lets the agent add blocks inside earlier task sections. On a violation — a changed, removed or reordered line, or a missing review file — it acts in this order: the phase becomes `failed`, then the rejected content is kept in `.cairn/.cairn_round_review_rejected.md` (when there was any) and the file is restored from the snapshot (`restoreReviewFile()`), and the verdict is `round-review-failed` with `reason: append-only-violated`. **The phase is recorded before the restore** because a restored file passes the check against its own snapshot: if the `state.json` update throws (lock timeout, exit 1), the violating file is untouched and a repeated `review-settle` finds the violation again. In the opposite window — a crash after `failed` is recorded and before the restore — the failure is still reported (`roundReviewFailed: true`), but the restore is not retried: the review file keeps the violating content, no rejected copy is written, and the snapshot stays until `round-done` removes it. (`verifyAppendOnly()` is the check and the restore in one step, with no phase update between them; settle does not use it.) A snapshot that cannot be read fails the same way with `reason: snapshot-missing`, with nothing to restore from. There is **no retry**: triage may already have created fix tasks, so handing it out again would duplicate them. Fix tasks that were already created stay in `tasks.json` and **run as ordinary tasks**, with no closing pass; the round then ends with `roundReviewFailed: true`. On a successful settle the snapshot is deleted, after the phase has advanced. Each settle appends `Round review <pass>: <verdict>` to `.cairn_iterations.log`.

**Fix-task ids** are not reported by the agent. When a fresh triage is handed out, the ids of every task then in `tasks.json` are stored as `baselineTaskIds`; at triage settle, `fixTaskIds` is every task in `tasks.json` whose id is not in that baseline, sorted. So anything added to `tasks.json` between the two — by anyone — counts as a fix task.

**`unresolved`** is parsed from the review file at `round-done`, not taken from the agent's final line: `countUnresolved()` counts task sections (`## Task #<id>:`) that have a `### Round Verdict` of `UNRESOLVED`, or a `### Round Triage` with no `### Round Verdict` at all (the round review did not finish for that section — e.g. it failed before closing). It counts sections, not findings; an unreadable or absent file counts 0.

**Scratch files.** `.cairn_round_review_prompt.md`, `.cairn_round_review_snapshot.md`, `.cairn_round_review_rejected.md` and `reviews/.cairn_round_review_fix_<n>.json` are covered by one `.cairn/.gitignore` pattern, `.cairn_round_review_*` (no slash, so it also matches inside `reviews/` while `reviews/round-<N>.md` stays tracked). `cleanupRoundReviewScratch()` removes the prompt, the snapshot and the fix JSON files at `round-done`; the rejected copy is kept for the user (and overwritten by a later violation).

**Accepted limitation.** A project upgraded mid-round whose current round already has a review file gets one triage at that round's end: phase `none` plus an existing review file is exactly the trigger, and there is no guard for "this round started before the feature existed". Set `review.postRound: false` in `cairn.json` to turn it off.

### Planning rounds (`cairn round new`)

`cairn round new` prints `{ "verdict": "round-started", "round": N, "next": "..." }`. It is run exactly once by `/generate-tasks` (`commands/generate-tasks.md`), after `cairn task next-id` and before `tasks.json` is written. It bumps `state.json`'s `round` under the `state.json.lock`, with an absent or non-numeric round becoming 1, and in the same write removes the previous round's `roundReview` record, so the new round's post-round review always starts from phase `none` (`startNewRound()` in `src/round-review.ts`, which calls `bumpRound()` in `src/task-counter.ts` with `clear: ['roundReview']`; every other field is preserved). It then best-effort deletes the `/teach` running log `.cairn/.cairn_planning_session.md`; a missing file or failed unlink never changes the verdict. It exits 1 (one stderr line) only when `state.json` cannot be updated, e.g. on a lock timeout.

- **Why `/generate-tasks` and not `cairn plan`**: a planning session that is quit and re-run would otherwise skip a round number. As a result, during a planning discussion `state.json` still shows the *previous* round. The round only advances when tasks are generated.
- **Why under `round`, not `task`**: task agents only know `cairn task`, so they cannot bump the round mid-round. This is the same reason settle lives under `round`.
- **The CLI owns state.** The Markdown slash command decides *when* the round starts, and a tested CLI command performs the state change. The prompt never edits `state.json` itself. The `cairn plan` session's `--allowedTools` grants `Bash(cairn round new:*)` for that reason.
- **Accepted limitation**: each run bumps the round, so running `/generate-tasks` twice for one plan (or re-running `cairn round new` in the same session) bumps twice. `generate-tasks.md` tells the session to run it only once per approved generation.

### `cairn watch` and the transcript layout

`cairn watch` depends on Claude Code's **undocumented** subagent transcript layout: `$CLAUDE_CONFIG_DIR` (default `~/.claude`)`/projects/<slug>/<session>/subagents/agent-<id>.jsonl`, plus a sibling `agent-<id>.meta.json` that supplies `agentType` and `description`. The slug is the absolute project root with every non-alphanumeric character replaced by `-` (`projectSlug()`). If that layout changes, `findSession()` fails loudly and names the missing path (projects dir, slug dir, or — for `--session` — the session's `<session>.jsonl` / `<session>/`), and the command exits 1. Claude Code writes `<session>.jsonl` from the start but creates `<session>/subagents/` only when the first subagent launches, so a session with no `subagents/` yet is not an error, pinned or not; watch just keeps polling. A `--session` value must be a plain name (`[A-Za-z0-9_-]+`) so it cannot resolve outside the slug dir.

Rendering reuses `renderEvent()` from `src/stream-filter.ts`. It shows assistant text and tool calls but **not tool results**, which matches the old `cairn run` view, and it prints **no final Done line** because subagent transcripts contain no `result` event.

### Run state

Round runtime state lives in `.cairn/.cairn_run_state.json` (gitignored; `src/run-state.ts`), written under a lock with atomic rename: `{ iteration, attempts: { "<taskId>": { beforeSha, iteration, reverts, stalls, incompletes, phase } } }`, with `phase` either `executing` or `awaiting-review`.

- **It is on disk, not in memory.** Guard counters and attempt records survive `cairn run` restarts, separate `cairn round settle` invocations, and `/cairn-run` session compaction or resume. (The top-level `iteration` counter is bumped by `cairn round next`; `cairn run` numbers iterations with its own per-invocation loop counter and stamps that onto the attempt record.)
- A re-pick of a task keeps the **first** attempt's `beforeSha`, so the eventual review covers every attempt. With no record at all, settle recovers `beforeSha` from git: the parent of the oldest commit whose message contains `Task #<id>:`. Picking records the sha **under the lock**: `cairn round next` creates or updates the attempt record — pre-task `beforeSha` (HEAD at pick time) and the iteration — in one short locked update.
- Settle **clears** the record on `done` and on every block, and **keeps** it on `retry` and `review`. Orphans — `executing` records whose task is no longer in `tasks.json` — are pruned by `cairn round next` (never `awaiting-review` ones, since their task is archived by design) and cleared by a settle that returns `already-settled`. `cairn task set-status` also clears the task's record (after the tasks.json write, best-effort) — that is how a human unblocking a task gives it fresh attempts.
- **Thresholds are fixed, not configurable**: `REVERT_BLOCK_THRESHOLD` 2 (consecutive failed validations), `STALL_BLOCK_THRESHOLD` 3 (task still `pending` — the agent never ran `cairn task start`), `INCOMPLETE_BLOCK_THRESHOLD` 3 (task left `in-progress` without a failed validation). An incomplete retry escalates from `continue` to `fresh` on its second consecutive occurrence; a stall always retries `fresh`.
- **Locking**: critical sections must be short (`acquireLock` breaks locks older than 60s, test validation can run 120s per command), so the run-state lock is never held across validation, agents, or health checks. The run-state lock may be taken before the `tasks.json` lock, never inside a `mutateTasksFile` callback.
- An unparseable run-state file reads as empty rather than throwing — unlike `tasks.json`, it is disposable.
- **Round-scoped temp-file sweep**: `sweepRoundTempFiles()` (`src/temp-sweep.ts`) is shared by `cairn run`'s loop-exit sweep and `cairn round next`'s round-done branch, so the two paths can't drift the way they once did. It removes the flat `.cairn_complete` / `.cairn_prev_notes` / `.cairn_completed_ids` files, plus every per-task `..._notes.md` (both the permanent pre-rename `.ralph_` spelling, `NOTES_TEMP_PREFIX`, which is the one the prompt hands out, and the defensive `.cairn_` spelling — `BRAND.tempPrefix`, the current prefix, covered only in case an agent spells the file that way), `..._prompt.md`, `..._review_prompt.md`, and `..._tests.log` scratch file in the data dir. **Blocked-log exception**: a `_tests.log` whose task has status `blocked` in `tasks.json` is kept, since it is the only full diagnostic for the block (the task's note carries just a short failure summary); that task's `_prompt.md`, `_review_prompt.md` and notes scratch are still swept. Blocked status comes from a plain read and parse of `<dataDir>/tasks.json` — never `readTasksFile`, which can repair/restore/write — and if that file is missing, unreadable, unparseable, or has no `tasks` array, status is unknown and **every** `_tests.log` is kept. A kept log goes at the first round end after its task stops being blocked (or is overwritten by validation if the task re-runs first). The never-sweep list is the load-bearing half: `.cairn_run_state.json(.lock)`, `.cairn_iterations.log`, `.cairn_tasks_snapshot.json`, `.cairn_hook_errors.log`, `.gitignore`, `state.json`, `tasks.json`, `tasks.completed.json`, `planning-notes.md`, and `reviews/` are never candidates, by construction — both regexes require a literal `task_\d+_` segment none of those names contain. Best-effort throughout: a failed unlink or an unreadable data dir is swallowed, never thrown, so a sweep can never change a caller's verdict or exit code. It only ever runs at round end, never per-task — a `retry` relaunch re-reads a task's `_prompt.md` verbatim, and the reviewer's prompt names its `_tests.log`, so removing either mid-round would break the settle/retry/review cycle. The post-round review's scratch files (`.cairn_round_review_prompt.md`, `.cairn_round_review_snapshot.md`, `.cairn_round_review_rejected.md`, `reviews/.cairn_round_review_fix_<n>.json`) are **not** swept by `sweepRoundTempFiles()` — none has a `task_\d+_` segment. `cleanupRoundReviewScratch()` (`src/round-review.ts`) removes them instead, in `cairn round next`'s round-done branch only, just before the sweep; it keeps the rejected copy. `cairn run`'s loop exit does not call it, since headless has no round review.
- **Stream filtering**: `src/stream-filter.ts` parses `stream-json` output from Claude and renders colored one-line summaries of tool calls and results.
- **Config loading**: `src/config.ts` reads `cairn.json`, exports config values, and auto-detects health checks from `package.json`/`Cargo.toml`/`Makefile`. The `review` block has two flags with opposite defaults: `review.postTask` (absent = **off**) and `review.postRound` (absent = **on**; ask `isPostRoundReviewEnabled(config)`, never the raw field — it also treats a missing `review` block as on). `cairn init` prompts for both.
- **Branding**: `src/brand.ts` is the single source of truth for the project's name and paths (`BRAND` — `dataDir`, `configFile`, `envPrefix`, `tempPrefix`), frozen and not user-configurable. It also exports `NOTES_TEMP_PREFIX`, a deliberately separate constant — see [Conventions](#conventions).

### Per-project data layout (created by `cairn init` in the target project)

```
target-project/
├── .cairn/
│   ├── tasks.json              # Active task list
│   ├── tasks.completed.json    # Archive of completed tasks
│   ├── state.json              # Monotonic task-ID counter + planning round { "nextTaskId": N, "round": R } — committed to git; round bumped by `cairn round new` (run by /generate-tasks), not by `cairn plan`. Also holds `roundReview`, the post-round review's phase record for the current round
│   ├── reviews/
│   │   ├── round-<N>.md        # Per-planning-round post-task review logs, plus the post-round review's Round Triage / Outcome / Verdict blocks (append-only)
│   │   └── .cairn_round_review_fix_<n>.json  # Fix-task JSON the post-round reviewer feeds to `cairn task add --file` (gitignored)
│   ├── planning-notes.md       # Output from planning discussions
│   ├── concepts.md             # Personal /teach glossary, cumulative across rounds (gitignored)
│   ├── .cairn_planning_session.md  # /teach running log (gitignored; deleted by `cairn round new`, never swept by temp-sweep)
│   ├── .gitignore              # Written by cairn init; on re-init, appends any entries missing from an existing file (never reorders/removes), skips one you've un-ignored with `!`, and reports rather than aborts init if the file can't be read
│   ├── .cairn_run_state.json   # Iteration counter + per-task attempt records (gitignored)
│   ├── .cairn_task_<id>_tests.log          # Full post-iteration test validation output (gitignored)
│   ├── .cairn_task_<id>_prompt.md          # Task agent prompt written by `cairn round next` (gitignored)
│   ├── .cairn_task_<id>_review_prompt.md   # Reviewer prompt written by `cairn round settle` (gitignored)
│   ├── .cairn_round_review_prompt.md       # Post-round reviewer prompt written by `cairn round next` (gitignored)
│   ├── .cairn_round_review_snapshot.md     # Copy of the review file taken at hand-out, for the append-only check (gitignored)
│   ├── .cairn_round_review_rejected.md     # Review-file content rejected by the append-only check; kept at round end (gitignored)
│   ├── .cairn_hook_errors.log  # Fail-open errors from `cairn hook pre-tool-use` (gitignored)
│   └── .cairn_iterations.log   # Iteration + settle log (gitignored)
├── .claude/
│   ├── settings.local.json     # Seeded by cairn init: allow rules + the PreToolUse hook (gitignored by you)
│   ├── agents/                 # cairn-task-agent.md, post-task-reviewer.md, post-round-reviewer.md, ... (installed by cairn init)
│   └── commands/               # cairn-run.md, generate-tasks.md, teach.md, ... (installed by cairn init)
├── CLAUDE.local.md             # Personal agent instructions (replaces .cairn/instructions.md)
└── cairn.json                  # Project configuration (optional)
```

## Conventions

- All source lives in `src/`.
- Task selection logic lives in `src/task-selector.ts`, prompt building and loop control in `src/commands/run.ts`, test validation in `src/test-validator.ts`, post-iteration settlement (guards, archive, review gate) in `src/settle.ts`, run state in `src/run-state.ts`, the post-round review (phases, append-only check, prompts, settle, unresolved count) in `src/round-review.ts`, the `/cairn-run` CLI commands in `src/commands/round.ts`, and the containment hook in `src/commands/hook.ts`. Guard counters are never kept in memory by real callers — they live on the run-state attempt records (`createInMemoryGuardCounters` exists only for unit tests).
- Personal instructions go in `CLAUDE.local.md` at the project root, which Claude Code loads natively into every session (headless agents and `/cairn-run` subagents included). `.cairn/instructions.md` is deprecated for one release: `loadPersonalInstructions()` (`src/personal-instructions.ts`) still injects it into the execution, reviewer, `plan`, and `summarize` prompts but warns on stderr, and `cairn init` offers to migrate it into `CLAUDE.local.md` and delete it.
- `/teach` (`commands/teach.md`, installed into `.claude/commands/` by `cairn init`) is an opt-in learning-mode planning style. It is off by default, turned on with `/teach`, and turned off with `/teach off`. It keeps the running log `.cairn/.cairn_planning_session.md` and the cumulative glossary `.cairn/concepts.md` (both gitignored). It is a slash command on purpose. In `CLAUDE.local.md`, every session would load it, task agents included, and they would stall waiting for a confirmation nobody gives. In `agents/planner.md`, `cairn init` would overwrite it.
- Paths are kept absolute internally; task `directory` fields in `tasks.json` are relative to the project root.
- No external runtime dependencies beyond Bun and the `claude` CLI.
- The health check must use the `--compile` form (`bun build --compile src/index.ts --outfile ...`), matching `package.json`'s `build` script (`bun run build` → `bun build --compile src/index.ts --outfile dist/cairn`). `--compile` is what exercises the same standalone-executable compile step that produces the shipped binary; a plain bundle build (e.g. `--target=bun`) skips that step, so a compile-stage failure would pass the check and only surface later at install time.
- BRAND.dataDir / BRAND.configFile are for CREATING paths, never for RESOLVING them. Any path pointing at something expected to already exist must come from `findDataDir()` (`src/utils.ts`) or `findConfigFile()` (`src/config.ts`) — otherwise the path is built from what the name *should* be rather than from what discovery actually found on disk.
- `cairn hook <event>` subcommands skip `index.ts`'s preAction (`setupProjectContext`): they fire on every tool call in every session, so they must start fast and must not crash on a malformed `cairn.json`. They resolve their own context lazily and fail open (exit 1, never 2) with errors appended to `.cairn/.cairn_hook_errors.log`, which `cairn round next` surfaces as a warning.
- The per-task notes scratch file is named `.ralph_task_<id>_notes.md` (prefix `NOTES_TEMP_PREFIX` in `src/brand.ts`), not `.cairn_...`. This is a deliberate permanent exception, not a leftover: the file is write-and-sweep scratch that's never read back, so renaming it would only churn every project's committed `.gitignore` history for zero behavioral gain.

## Agent workflow

Agents **must** use the `cairn task` subcommand group for every mutation of `.cairn/tasks.json`:

```
cairn task start <id> --iteration <n>
cairn task complete <id> --iteration <n> [--notes "..."]
cairn task note <id> "message"
cairn task set-status <id> <status>
cairn task add --file <path>
cairn task next-id [--count <n>]
cairn task show <id>
```

`cairn task add` takes only `--file <path>`: a JSON file holding one task, validated before it is merged. The file carries no `id` — the CLI assigns one and prints `assigned id: <n>`.

`cairn round next` / `cairn round settle` / `cairn round review-settle` are **not** agent commands: only the `/cairn-run` session driving the round calls them (see [Two ways to run a round](#two-ways-to-run-a-round)). A task agent that settled its own task would archive it and skip its own review.

Task IDs are allocated by `cairn task next-id`, which reads and increments `state.json`. IDs are never reused — once allocated, an ID remains reserved even if the task is deleted or archived. `state.json` is seeded lazily on first call and is committed to git alongside `tasks.json`. `state.json` also tracks the current planning round; `cairn round new` (run once by `/generate-tasks` after the user approves the tasks, before `tasks.json` is written — not by `cairn plan`, so a quit-and-rerun planning session never skips a number) bumps the round counter, an absent round becoming 1. During a planning discussion `state.json` therefore still shows the previous round, and running `/generate-tasks` twice for one plan bumps twice (an accepted, documented limitation; see [Planning rounds](#planning-rounds-cairn-round-new)). The post-task reviewer writes its findings to `.cairn/reviews/round-<N>.md` for the active round.

Direct `Edit` or `Write` on `tasks.json` is **forbidden** — for *execution agents mutating a live task list mid-round*. That scoping matters: task generation is exempt, and `commands/generate-tasks.md` deliberately instructs the planning session to write `.cairn/tasks.json` with the `Write` tool. The two are not in conflict. The ban protects a task list that a running `cairn run` loop is concurrently reading and mutating through the CLI; task generation authors the file wholesale *between* rounds, when no loop is live and there is no state to race with.

Under headless `cairn run`, the ban is enforced two ways, and only two (`/cairn-run` adds a third layer for its subagents — see [Enforcement under /cairn-run](#enforcement-under-cairn-run); it changes nothing below):

1. **The per-agent system prompt** explicitly bans it. For `cairn run`'s execution agents this is the **only** constraint there is — they are spawned with `--dangerously-skip-permissions`, so no allowlist or denylist reaches them and nothing mechanical stops an execution agent from opening `tasks.json` in `Write`. That has always been true; earlier revisions of this file obscured it by listing permission rules alongside the prompt as if they also bound execution agents.
2. **Per-agent `--allowedTools` scoping**, which covers the *non*-execution agents — the post-task reviewer and the planner — and works precisely *because* headless mode is deny-by-default (see below), not because of any deny list. The post-task reviewer's only Edit/Write grant is `<dataDir>/reviews/**`, which excludes `tasks.json`. (Its Bash grants are narrow too: only the enumerated read-only git subcommands — `diff`, `log`, `show`, `status`, `rev-parse` — never `Bash(git:*)`. It has **no** test-command rules: settle validates the task's tests before the review and hands the reviewer the summary and log path, so the reviewer never runs them.) The git list (`GIT_INSPECTION_RULES`) lives in `src/claude-settings.ts` and is shared with `cairn init`'s permission seeding and with the `/cairn-run` hook's reviewer Bash scope, so the grants cannot drift apart; `buildCommandRules` there derives `cairn init`'s health-check and test-command allow rules. That reviews-directory allowlist rule is derived from the same resolved `reviewsDir` the reviewer's prompt targets (`src/post-task-reviewer.ts`), so the grant and the write path can never name different data dirs — if they did, every reviewer write would be *silently* denied. (This `--allowedTools` grant is not the whole headless reviewer story — see "Headless reviewer containment" below, which layers a `--disallowedTools` denylist on top to close a hole the allow-prefix rule can't.)

### The governing rule

In headless `claude -p`, **anything with side effects is denied by default unless it is allowlisted** — there is no interactive session to prompt for approval, so an un-granted side-effecting call has no path to approval and is simply refused. Only side-effect-free commands pass without a grant. This is why an `--allowedTools` list is a complete containment story on its own for headless agents, and why a denylist adds nothing.

Three empirical probes established this; record them here so it is never re-derived from intuition:

- **(a)** A project-level `permissions.deny` rule blocked a command **even under `--dangerously-skip-permissions`**. That flag does not bypass a project deny.
- **(b)** A Bash command that was not on the allowlist and wrote **inside the working directory** was blocked — proximity to the cwd earns nothing.
- **(c)** A `Write` outside the granted `Edit(...)` scope was blocked, and the agent reported that the session was non-interactive so it could not prompt for approval.

One trap to know: a bare `echo` **does** run without any grant. It is side-effect-free, so it proves nothing about commands that write. Do not use it to conclude that Bash is ungated.

`cairn init` no longer seeds `permissions.deny` rules for the mutating `cairn task` subcommands. Per probe (a), a project-wide deny binds *every* Claude session in the project, including `cairn run`'s own execution agents — a stale version of this file once claimed such rules were bypassed by `--dangerously-skip-permissions`. That false claim caused a real incident: a run loop executed 60 iterations without ever recording a completion, because the deny rule silently blocked every agent's `cairn task start`/`complete` call. The rules were also redundant, per the governing rule above: the reviewer's scoped `--allowedTools` already prevented task-state mutation without any deny list.

A blanket `Bash(cairn task:*)` deny fails for a second reason too: `cairn task next-id` and `cairn task show` are read-only and **must stay reachable** — planning and review sessions call them to allocate IDs and inspect task state. Any deny broad enough to cover the mutating subcommands takes those two down with it.

Not seeding them is not enough on its own: a project initialized by the older version still carries that deny block, and `.claude/settings.local.json` is gitignored, so the breakage is invisible in `git status`. Re-running `cairn init` therefore *removes* the five legacy rules — `LEGACY_CAIRN_TASK_DENY_RULES` (`src/commands/init.ts`) fed to `removeSettingsRules()` (`src/claude-settings.ts`), matched by `canonicalizeRule` so the spaced spelling is caught too. Removal takes out only those five, drops the `deny` key when that empties it, and leaves any user-authored deny rule alone.

### Enforcement under /cairn-run

Everything above describes headless agents and stays true. `/cairn-run` is different: its task agent and reviewer are **subagents of an interactive session**, and subagents follow that session's permission mode. There is no `claude -p` spawn, so no per-agent `--allowedTools` reaches them, and agent frontmatter cannot express path scopes (the reviewer's frontmatter `tools:` list — `Read, Grep, Glob, Bash, Edit, Write` — limits which tools it has, not where they write). Nor does the deny-by-default governing rule apply: an interactive session in `bypassPermissions` allows everything.

The containment layer is therefore a **PreToolUse hook**, `cairn hook pre-tool-use` (`src/commands/hook.ts`), registered by `cairn init` into `.claude/settings.local.json` (matcher `Edit|Write|Bash`, never the committed `.claude/settings.json`) under the same prompt as the permission baseline. It reads the hook payload's `agent_id` / `agent_type`:

- **No `agent_id`** → allow immediately, with no project lookup. That covers main sessions, `generate-tasks`, and every headless `cairn run` agent — the hook is a no-op for all of them, which is why seeding it project-wide is safe.
- **Any subagent** `Edit`/`Write` whose resolved `file_path` is the data dir's `tasks.json` → deny, pointing at the `cairn task` subcommands.
- **`agent_type: post-task-reviewer`** → `Edit`/`Write` only inside `<dataDir>/reviews/`; `Bash` only when every subcommand starts with a `GIT_INSPECTION_RULES` prefix, and never contains redirection (`<`, `>`), backticks, or a `$` **anywhere** — deliberately broad, subsuming `$(...)` command substitution, `${VAR}` brace expansion, bare `$VAR`, and `$'...'` ANSI-C quoting, closing a hole where `git log --output${X}=/tmp/f` survived token-stripping (matching neither `--output` nor `--output=`) and bash then expanded `${X}` to nothing at execution time. `hasOutputOption()` keeps its exact-token `--output` / `--output=<file>` check as a second layer (it no longer strips `$` from tokens itself, since any `$` is already denied outright), guarding against a write primitive hidden inside an allowed read-only command.
- **`agent_type: post-round-reviewer`** → the same scope with one addition (`REVIEWER_SCOPES` in `src/commands/hook.ts`). `Edit`/`Write` only inside `<dataDir>/reviews/` — the review file and its `.cairn_round_review_fix_<n>.json` scratch files, which is why those live in `reviews/`. `Bash` only when every subcommand is a `GIT_INSPECTION_RULES` prefix **or exactly `cairn task add --file <path>`**: one path argument, bare or fully single- or double-quoted, nothing after it (`TASK_ADD_FILE_RE`). The match must hold for the argv bash delivers, not just the command text: a bare path may not contain `{`, `}`, `*`, `?`, `[`, `]` or `~` (brace expansion would turn `{a.json,--title,X}` into three words; globs and a tilde expand too), while the quoted forms may, since bash expands none of them inside quotes; and no form, quoted or not, may start with `-`, so the argument after `--file` is never read as another option. `--file=<path>`, extra flags or arguments, every other `cairn task` subcommand, and `cairn round` / `cairn hook` all fail the match. The addition only widens the per-subcommand prefix test: the bans on `$`, backticks and redirection and the `--output` check apply to every subcommand unchanged, which is workable because the task's text lives in the JSON file and never reaches the command line. `post-task-reviewer`'s scope is unchanged — it cannot run `cairn task add`.
- Everything else → allow.

The hook resolves the project it contains from the **payload's own `cwd`**, walking up for a `.cairn/` directory and ignoring `CAIRN_PROJECT_ROOT` (`findProjectRoot(cwd, { ignoreEnv: true })`) — a `/cairn-run` session started from a shell that `cairn` launched inherits that env var, which would otherwise point the hook's `tasksFilePath` and `reviewsDir` at the launching project instead of the one being worked on. Only when the payload has no usable `cwd` does it fall back to the ordinary resolution (env var, then `process.cwd()`). The **decision** uses that resolver alone; the **fail-open error log** gets its own, more forgiving destination (`resolveHookErrorLogDir`): if the cwd-resolved project has no `.cairn/` there is nowhere to append, so the log — and only the log — falls back to the ordinary resolution, otherwise a hook that has silently stopped containing anything would look identical to a healthy one. A deny and its log still can never name different projects: the log diverges only when no data dir was found, and a deny requires one. If no candidate has a data dir the hook still exits 1 and never 2. `findProjectRoot`'s default is unchanged — every other command relies on the env var winning.

A deny is **exit 0 with JSON** on stdout: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..." } }`. The hook is **fail-open**: any internal error (unparseable stdin, data dir not found, …) exits **1** — never a deny, never exit 2 — and is appended to `.cairn/.cairn_hook_errors.log`, which `cairn round next` surfaces in its `warnings` array. `cairn hook` skips `index.ts`'s preAction so it starts fast and a malformed `cairn.json` cannot crash it.

**Headless reviewer containment.** `cairn run`'s reviewer is contained by `--allowedTools` prefix rules (`Bash(git diff:*)` etc.), which cannot exclude an argument — so on their own a headless reviewer could still run `git diff --output=<file>`. `spawnPostTaskReviewer` (`src/post-task-reviewer.ts`) now also passes `--disallowedTools` with `REVIEWER_DISALLOWED_BASH_RULES` (defined beside `GIT_INSPECTION_RULES` in `src/claude-settings.ts`): `Bash(*--output*)`, `Bash(*--out*)`, `Bash(*$*)`, `` Bash(*") ``, `Bash(*')`. A planning-round probe established that, unlike an `--allowedTools` prefix rule, a **deny wildcard does match an argument mid-command**: with only `Bash(git log:*)` allowed and no deny, `git log --output=/tmp/f` ran and wrote the file; adding `Bash(*--output*)` blocked that and the `--output${X}=` variable form; adding `Bash(*$*)` plus the quote patterns also blocked the split-quoting form `git log --out"put"=/tmp/f`, while `git log --oneline -3` still ran unaffected. The residual, accepted limit: a deny pattern matches raw command **text**, while the `/cairn-run` hook (above) parses the command structurally — so the hook stays the stronger layer; this closes the headless gap as defense in depth against a trusted agent, not as a sandbox.

Hook probe facts — established empirically; record them here so they are never re-derived:

- A hook `deny` **binds under `bypassPermissions`**. That is what makes the hook a real containment layer when the permission mode is not.
- **Exit 1 or 127** (e.g. `cairn` not on PATH) **lets the call through silently**. Exit 2 surfaces as a noisy "hook error"; exit 0 + JSON shows the agent only the reason — hence the JSON form for denies, and hence the error log, since a failing hook is otherwise invisible.
- Main-session calls carry **neither** `agent_id` nor `agent_type`. Subagent calls carry both (`agent_type` is the frontmatter `name` for custom agents, `general-purpose` for the built-in). **Internal Claude Code helpers send `agent_id` without `agent_type`** — normal, not an error; they get only the `tasks.json` rule.

#### Recommended permission mode for /cairn-run

The slash command cannot set the mode; the user picks it when launching the session.

- **`bypassPermissions` + the hook** — recommended. Unattended rounds need no prompts, and the hook still contains the subagents.
- **`auto`** may be tried, but its classifier can wrongly deny routine actions (`git commit`, `bun test`, `cairn task ...`), which show up as stalled or blocked tasks.
- **`default` / `acceptEdits`** stall an unattended round on the first permission prompt nobody answers.

The CLI routes all writes through `writeTasksFile()`, which performs atomic temp-file replacement and validates JSON on every write — making corruption structurally impossible via this path.

## Pin/unpin procedure for self-modifying rounds

This section is permanent, generic guidance for *any* self-modifying round — it is not tied to the historical Ralph→Cairn rename, and does not get removed once a given round ends.

Cairn's own health check (`cairn.json`'s `healthCheck` field) is `bun build --compile src/index.ts --outfile dist/cairn`, and it runs before *every* iteration of `cairn run`. That is a problem specifically when a planning round's own task list is modifying this tool: the loop is executing changes to the same binary it uses to build and check itself, mid-round, with no atomicity between "task N edits `src/`" and "the next iteration's health check builds `src/`".

The fix used during past self-modifying rounds — worth reusing for any future one:

1. **Freeze the installed binary before starting the round.** `install.sh` installs `~/.local/bin/cairn` as a **symlink** to `dist/cairn` (`ln -sf`), so merely not re-running `./install.sh` pins nothing: any `bun run build` mid-round — including the health check itself — rewrites `dist/cairn` and with it the binary on PATH. Pinning means replacing the symlink with a real copy of a known-good build. Agents are explicitly told not to run `./install.sh` themselves.
2. **Redirect the health check to a throwaway outfile.** Point `healthCheck` at `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` instead of the real `dist/cairn` output, so a build-outfile-path task doesn't corrupt the binary developers are actively using.
3. **Tell agents both values are user-managed for the round.** Any task whose file scope could plausibly touch `install.sh`, `package.json`'s build script, or `healthCheck` should say so explicitly in its description (e.g. "do NOT modify `cairn.json`'s `healthCheck` value — the user has pinned the binary and redirected the health check to a throwaway outfile"). Without that, an unrelated task can innocently "fix" the health check back to the real outfile and re-introduce the self-modification hazard mid-round.
4. **Revert both manually once the round finishes.** Un-pin the binary (re-run `./install.sh`) and restore `healthCheck` to its real value. Neither is done automatically — both are explicitly user-managed for the duration of the round.

**Never run `cairn round …` or `cairn hook …` (or `bun src/index.ts round|hook …`) against the project root during a self-modifying round** — only in temp dirs. `round next` and `round settle` write `.cairn/.cairn_run_state.json` and prompt files in the real project, and round 15 left stale run state behind that way. `round next` and `round review-settle` now also write the committed `.cairn/state.json` (the `roundReview` phase record) and the review-file snapshot, and `review-settle` can overwrite `reviews/round-<N>.md` itself when it restores from that snapshot.

### Commands

Pin, from the repo root, before the round:

```bash
# Build a known-good binary from the committed state
bun run build

# Replace the symlink with a real copy (mv swaps the link out atomically)
cp dist/cairn ~/.local/bin/cairn.tmp && mv ~/.local/bin/cairn.tmp ~/.local/bin/cairn

# Verify: a regular file (-rwx), not a symlink (lrwx ... -> dist/cairn)
ls -la ~/.local/bin/cairn && cairn --version
```

Then in `cairn.json`:

```json
"healthCheck": "bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck"
```

Unpin, from the repo root, after the round:

```bash
# Rebuilds dist/cairn; ln -sf restores the symlink over the pinned copy
./install.sh

# Verify: ~/.local/bin/cairn -> .../dist/cairn again
ls -la ~/.local/bin/cairn

# Reinstall the agents, slash commands and .cairn/.gitignore entries the round may have changed
# (cairn init is interactive and prompts, so do not paste this block as a whole)
cairn init

# Run round-end behavior once with the unpinned binary: start an interactive Claude Code
# session in the repo root and run /cairn-run there (do not run `cairn round next` from a shell).
# tasks.json empty -> round-review if the round has a review file, else round-done
```

The `cairn round next` step matters because round-end behavior added *during* a round never runs at that round's end: the pinned binary that drove the round predates it. Running `cairn round next` once from the repo root after unpinning makes that behavior (e.g. the temp-file sweep) actually run and gets it a live check. This is safe because it happens after unpinning: the ban on running `cairn round` in the project root covers only the round itself.

With `tasks.json` empty that step returns `round-done` only when the round has no review file (or `review.postRound` is `false`). Otherwise it returns a **`round-review`** verdict, and something has to launch the `post-round-reviewer` agent — so run this step as `/cairn-run` in an interactive session rather than as a bare shell command. A bare `cairn round next` would advance the phase to `triage` and leave the pass pending; nothing is lost (the next `round next` hands the same pass out again), but the round has not ended. Re-run `cairn init` first, as above, so `.claude/agents/post-round-reviewer.md`, the updated `.claude/commands/cairn-run.md` and the `.cairn_round_review_*` gitignore entry are installed; a session started before that will not know the agent or the `round-review` verdict.

Then restore `cairn.json`'s normal value:

```json
"healthCheck": "bun run build"
```

While pinned, agents may still run `bun run build` — it updates `dist/cairn`, but the `cairn` on PATH stays on the pinned copy.
