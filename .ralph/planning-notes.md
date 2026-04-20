## Context

Two intertwined problems this round.

### Problem 1 (carried from prior session): `tasks.json` corruption

Recurring bug — `tasks.json` becomes malformed mid-run, then the next iteration's `validateTaskTests` crashes at `JSON.parse(readFileSync(tasksFilePath, 'utf-8'))` (`src/test-validator.ts:70`). Confirmed example: a task ended up with

```
"notes": "…adequately. | Post-iteration: test commands could not execute…"
"files": [ … ]
```

The missing comma after `notes` is the signature of a botched surgical `Edit` whose `old_string` ended with `"…",` and whose `new_string` dropped the terminating comma.

**Root cause.** `src/commands/run.ts:119` tells the worker agent to use `Edit` to mutate fields on the task object in `tasks.json`. `Edit` is a surgical string replacement with no understanding of JSON structure; any off-by-one boundary, missing comma, unescaped quote, or embedded newline can produce malformed JSON. Ralph-owned mutators (`task-archiver.ts`, `test-validator.ts`) are safe because they round-trip through `JSON.parse → mutate → JSON.stringify`. Only agents touch the file as raw text.

**Likely mutators (in order of suspicion).**

1. The next iteration's worker agent, when it `Edit`s tasks.json to set its own task's status to `in-progress`.
2. The post-task reviewer — its allowlist (`src/post-task-reviewer.ts:124`) is `"Read,Glob,Grep,Edit,Write"`. Its prompt directs it to `review-post.md`, but the allowlist permits any file.
3. The current iteration's agent appending notes after `validateTaskTests` ran (less likely — it's already marked complete and committing).

**Secondary bug.** `src/task-archiver.ts:27-31` swallows `JSON.parse` errors silently and returns `{ archivedCount: 0, prevNotes: null }`. If tasks.json was already corrupted when archival ran, the loop reports success and moves on. This hides the original damage.

### Problem 2 (new this session): infinite loop on "write failing tests" tasks

The prior plan split most work into paired `write tests` / `implement` tasks (TDD). Ralph's post-iteration validator (`src/test-validator.ts`) re-runs `task.tests` after the agent marks the task complete; if they fail, it reverts the task to `in-progress`. A "write failing tests" task by definition ends with failing tests, so the validator reverts it every iteration — observed 11 identical `[ralph] Task #2: Unit tests for readTasksFile` commits between 03:22–03:32 before the loop was interrupted.

A mid-run agent tried to patch this by adding a `tddGate: true` field to task #2 and a check in `src/test-validator.ts:75-78` that skips the revert. But `dist/ralph` was rebuilt AFTER the loop started, so the running process held the old validator in memory — the "fix" was a no-op for this run, and a hack regardless.

**Real root cause.** The user's personal instruction (`instructions.md`: *"Always use TDD across all task execution"*) was read by the task-generator subagent and interpreted as *"make every task either tests or implementation,"* baking a personal execution preference into plan structure. That's wrong. TDD is how executor agents work *within* a task, not a directive for how tasks are split. With that reinterpretation, the `tddGate` flag isn't needed — tasks always end with passing tests because the executor writes, fails, fixes, passes, all inside one task.

## Goals

1. **Regenerate the task list** against an updated task-generator that explicitly forbids splitting work into test/impl pairs. Each task is one atomic unit; executor agents use TDD internally.
2. **Tighten `.ralph/instructions.md`** to make intra-task TDD unambiguous.
3. **Rip out the mid-run `tddGate` hack** from `src/test-validator.ts` and the tddGate field from task #2 — it exists to solve a problem we're fixing at the source.
4. **Ship the corruption-defense work** carried forward from last session (this was the original goal and nothing about it changes — only the plan structure does).

Non-goals: switching storage format; squashing the 11 duplicate `Task #2` commits (user accepted leaving git history as-is); adding a `tddGate`/`expectedOutcome` schema field to Ralph; adding a retry cap to the run loop.

## Approach

### 0. Prework — unblock + prevent re-occurrence

Before any corruption-defense work, these go into the new task list as the first few tasks:

- **Revert the tddGate hack.** Remove the `if ((fileTask as any).tddGate) return { status: 'skipped' };` block from `src/test-validator.ts:75-78`. Remove the `tddGate: true` field from task #2 (will be re-emitted by regeneration anyway). No schema change — the field was never formalized.
- **Tighten `instructions.md`.** Replace `"Always use TDD across all task execution"` with something like `"Use TDD within each task — write the test, see it fail, then make it pass. Do not split a single unit of work into separate test-writing and implementation tasks."` Defense-in-depth against future planners misreading it.
- **Update `commands/generate-tasks.md` (and `.claude/commands/generate-tasks.md` mirror).** Add explicit guidance: each task is one atomic unit of work; do not create paired `write tests for X` / `implement X` tasks; if TDD is desired, the executor agent practices it within the task.
- **Update `commands/review-tasks.md` (and `.claude/commands/review-tasks.md` mirror).** Add a check: paired test/impl tasks against the same files are a FAIL finding under Atomicity.

### 1. CLI subcommands for task mutations (prevention) — from prior session

Add a `ralph task` command group in `src/commands/task.ts`, dispatched from `src/index.ts`:

- `ralph task start <id> [--iteration N]` — sets `status: 'in-progress'`. Idempotent.
- `ralph task complete <id> --iteration N [--notes "…" | --notes-file PATH]` — sets `status`, `completedAt` (fresh ISO 8601), `completedBy: iteration-N`, and `notes`. `--notes-file -` means stdin.
- `ralph task note <id> [--append | --replace] "…" | --notes-file PATH` — default append (` | `-separated), matching `test-validator.appendNote` semantics.
- `ralph task set-status <id> <pending|in-progress|complete|blocked>` — escape hatch.
- `ralph task show <id>` — prints the task as formatted JSON (read-only).
- `ralph task add --file PATH` — validates the payload against `src/tasks-schema.json` before merging; **refuses** on validation failure.

All mutating subcommands use a `mutateTasksFile(path, fn)` helper that does `JSON.parse → fn(data) → JSON.stringify(data, null, 2)` atomically (write to `<file>.tmp` then `rename`). Unknown fields on the task object are preserved.

### 2. Rewrite the execution prompt to use the CLI

In `buildSystemPrompt` (`src/commands/run.ts:42`), replace the "Update tasks.json … Use Edit to set these fields" instructions:

- Step 1 becomes: `ralph task start <id> --iteration <N>`
- Step 5 becomes: agent writes notes to `<dataDir>/.ralph_task_<id>_notes.md`, then calls `ralph task complete <id> --iteration <N> --notes-file <...>`. Tempfile path is supplied in the prompt.
- Explicit ban: *"Do NOT use Edit or Write on `.ralph/tasks.json` directly — the CLI subcommands are the only supported path."*
- DISCOVER-AND-DOCUMENT block: use `ralph task add --file <path>`.

The post-task reviewer prompt (`agents/post-task-reviewer.md`) also gets a line: *"Do not touch `.ralph/tasks.json`. You only write to `.ralph/review-post.md`."*

### 3. Defensive tasks.json I/O helper

New module `src/tasks-file.ts` (stub already committed as archived task #1 from prior session) exporting:

- `readTasksFile(path, opts?) → { data, repaired, restored, error? }` — tries `JSON.parse`, falls back to `jsonrepair`, falls back to `<dataDir>/.ralph_tasks_snapshot.json`. On every failure path appends a structured JSONL entry to `<dataDir>/corruption.log` (timestamp, stage, error, sha256 of corrupted bytes, first 500 bytes). Throws a typed `TasksFileError` only if all three paths fail.
- `writeTasksFile(path, data)` — atomic tempfile-then-rename.
- `snapshotTasksFile(path, dataDir)` — copies to `<dataDir>/.ralph_tasks_snapshot.json` (single overwriting file). Called after every successful Ralph-owned write.

Callsites to migrate:
- `src/commands/run.ts:445` (main-loop read)
- `src/commands/run.ts:571` (post-task review status re-read)
- `src/test-validator.ts:70` (pre-validation read)
- `src/task-archiver.ts:28` (pre-archival read) — *also* drop the silent catch.
- All the new CLI subcommands.

### 4. Stop silent archival failures

`src/task-archiver.ts:27-31` currently returns `{ archivedCount: 0, prevNotes: null }` on any parse error. Change to: call `readTasksFile`, which either succeeds (possibly repaired/restored) or throws `TasksFileError`. On `TasksFileError`, log to the iteration log and `corruption.log`, return `archivedCount: 0` so the loop can still exit gracefully — but the user sees it.

### 5. Corruption-log surfacing

At the end of `ralph run`, the final summary (`src/commands/run.ts:610-619`) adds `⚠ N corruption events recovered this run — see <dataDir>/corruption.log` when N > 0 (silent when zero). Implementation: track a `corruptionEvents` counter in `runRun`, increment whenever `readTasksFile` returns `repaired: true` or `restored: true`. Forward to the ntfy notification when configured.

### 6. Notes tempfile location

Agent-facing notes tempfile lives at `<dataDir>/.ralph_task_<id>_notes.md`, not `/tmp/`. Reuses the existing `TEMP_FILES` cleanup in `src/commands/run.ts:345` by adding a glob-matching sweep (`.ralph_task_*_notes.md`) at run end.

### 7. Snapshot cadence

- After each CLI subcommand's successful write.
- After `validateTaskTests` writes.
- After `archiveCompletedTasks` writes.
- At the start of each `ralph run` iteration, after the main-loop read succeeds.

Keeps the snapshot always ≤ one mutation behind the live file.

### 8. Post-task-reviewer scope tightening (hard enforcement)

Claude Code's path-scoped `--allowedTools` syntax is fully supported and strictly enforced (verified April 2026, https://code.claude.com/docs/en/permissions.md).

Two layers:

1. **Hard enforcement.** Change the reviewer's allowlist in `src/post-task-reviewer.ts:119-129` from `"Read,Glob,Grep,Edit,Write"` to `"Read,Glob,Grep,Edit(.ralph/review-post.md),Write(.ralph/review-post.md)"`. Covered by a unit test that asserts the exact `--allowedTools` string.
2. **Prompt-level belt-and-suspenders.** Update `agents/post-task-reviewer.md` with an explicit "You may only write to `.ralph/review-post.md`" rule.

### 9. Rollout

- `bun run build` to produce a new `dist/ralph`.
- `install.sh` already re-symlinks; no change needed.
- Existing projects' agent prompts will start using the new CLI on their next iteration because prompts are built fresh per iteration from Ralph's code.
- `ralph init` copies `commands/*.md` into each project's `.claude/commands/` — projects will need to re-run `ralph init` to pick up the updated generate-tasks / review-tasks guidance.

## Rejected Alternatives

- **Add a `tddGate` / `expectedOutcome: fail` flag to the task schema.** Considered and rejected this round. Bakes a personal execution preference (TDD) into Ralph's official data model; solves a problem that only exists because the task-generator misinterpreted `instructions.md`. Fixing the interpretation removes the need for the flag entirely.
- **Retry cap on duplicate task iterations.** Would have caught the 11-iteration loop, but it's a workaround for a plan-shape bug that we're fixing at the root. Reconsider only if we see runaway loops from a cause other than "task designed to end with failing tests."
- **Manually merge each test/impl task pair in the existing `tasks.json`.** Faster in the short term, but error-prone across 8 pairs, and leaves the task-generator free to make the same mistake next time. Regenerating against an updated generate-tasks.md fixes the root cause.
- **Change storage format (SQLite / per-task files / JSONL).** Structurally solves corruption but a much larger change with migration cost. CLI-subcommand approach gets 95% of the benefit with ~1/10 the churn.
- **Hook-based validation of agent tool calls.** Intercept `Edit` on tasks.json via a Claude Code PreToolUse hook. Complicated, environment-dependent, still a band-aid over agents touching raw JSON.
- **Permission-based block on the worker agent (deny Edit on tasks.json).** Worker needs broad Edit/Write across the codebase; path-denying one file is syntax-fragile. The CLI-subcommand + prompt-ban combo is cleaner. (We *are* using path-scoped allowlists on the post-task reviewer because its write scope is naturally narrow — one file.)
- **Rotated snapshot history** (e.g., last-N snapshots). Single overwriting snapshot is sufficient — it's only consulted when parse + jsonrepair both fail, and we only need the most recent parseable version. Git already provides multi-step history via `git log -- .ralph/tasks.json`.
- **Re-parse-and-rewrite shim after the agent exits.** Would normalize formatting but not fix missing-comma corruption (the parse still fails). Subsumed by `readTasksFile`.
- **Use Anthropic TS SDK instead of shelling out to claude** (carried) — shelling out gives us Claude Code's full tool suite, permissions model, and MCP support for free.
- **Port narration to TypeScript** (carried) — Kokoro TTS and sounddevice are Python-specific.
- **Skills instead of subagents for task generation/review** (carried) — clean context matters; subagents get fresh context while keeping full tool access.

## Rough Task Outline

Each task is atomic — one agent-sized unit. The executor agent practices TDD *within* each task (writes test, sees it fail, writes code, sees it pass). No separate test-writing tasks.

**CRITICAL FOR TASK GENERATOR:** Do not split any of the work below into separate `write tests` / `implement` pairs. Each bullet is one task.

1. Revert the mid-run `tddGate` hack. Delete the `if ((fileTask as any).tddGate)` block from `src/test-validator.ts:75-78`. Remove the `tddGate: true` field from task #2 (if present after regeneration) — not needed. — `src/`
2. Tighten `.ralph/instructions.md`. Replace the existing line with: *"Use TDD within each task — write the test, see it fail, then make it pass. Do not split a single unit of work into separate test-writing and implementation tasks."* — `.ralph/`
3. Update `commands/generate-tasks.md` and `.claude/commands/generate-tasks.md` with explicit "tasks are atomic; do not split TDD across tasks" guidance. — `commands/`, `.claude/commands/`
4. Update `commands/review-tasks.md` and `.claude/commands/review-tasks.md` to flag paired test/impl tasks against the same files as a FAIL finding under Atomicity. — `commands/`, `.claude/commands/`
5. Implement `readTasksFile`, `writeTasksFile`, `snapshotTasksFile`, `TasksFileError`, and `corruption.log` append in `src/tasks-file.ts`; write covering tests (valid / missing-comma / unescaped-quote / trailing-garbage / empty / missing-file / snapshot-recovery / double-corrupted). Tests + impl in one task. — `src/`, `test/`
6. Implement `mutateTasksFile(path, fn, opts?)` in `src/tasks-file.ts` with atomic tempfile+rename + snapshot call; write atomicity tests (tempfile-during-write, rename-on-success, cleanup-on-throw, unknown-field preservation, snapshot called). — `src/`, `test/`
7. Implement `src/commands/task.ts` with the full `ralph task` subcommand group (`start`, `complete`, `note`, `set-status`, `add`, `show`); wire into `src/index.ts`. Use ajv for `add` schema validation (add via `bun add ajv`). Full covering tests per subcommand. Run `bun run build` at end. — `src/commands/`, `src/`, `test/commands/`
8. Rewrite `buildSystemPrompt()` in `src/commands/run.ts` to use the `ralph task` CLI (start, complete with --notes-file, tempfile at `<dataDir>/.ralph_task_<id>_notes.md`). Add explicit ban on Edit/Write to `.ralph/tasks.json`. Update DISCOVER-AND-DOCUMENT to use `ralph task add --file`. Extend prompt tests to assert the new strings present and the old `"Use Edit to set these fields"` absent. — `src/commands/`, `test/commands/`
9. Migrate `src/test-validator.ts` to use `readTasksFile` + `writeTasksFile` + `snapshotTasksFile`. Add tests covering the repair/restore paths and the `TasksFileError` graceful-failure contract. Preserve appendNote semantics. — `src/`, `test/`
10. Migrate `src/task-archiver.ts` to use `readTasksFile` + `writeTasksFile` + `snapshotTasksFile`; stop silently swallowing parse errors (log to iteration log + `corruption.log`). Extend archiver tests to cover the TasksFileError path. — `src/`, `test/`
11. Migrate the two reads in `src/commands/run.ts` (main-loop at :445, post-task-review status re-read at :571) to `readTasksFile`; add per-iteration snapshot after main-loop read; track `corruptionEvents` counter; surface in final summary with `⚠ N corruption events recovered this run — see <dataDir>/corruption.log` when > 0; forward to ntfy when configured; extend TEMP_FILES cleanup to glob-sweep `.ralph_task_*_notes.md`. Extend run.ts tests to cover all new behavior. — `src/commands/`, `test/commands/`
12. Tighten post-task-reviewer allowlist in `src/post-task-reviewer.ts:119-129` from `"Read,Glob,Grep,Edit,Write"` to `"Read,Glob,Grep,Edit(.ralph/review-post.md),Write(.ralph/review-post.md)"`. Add test asserting the exact `--allowedTools` string. — `src/`, `test/`
13. Add explicit "You may only write to `.ralph/review-post.md` — never modify `.ralph/tasks.json`" rule near the top of `agents/post-task-reviewer.md`. Preserve the existing Output Format and Coverage Diagram sections verbatim. — `agents/`
14. Add a short note to `CLAUDE.md` Conventions section: agent workflow uses `ralph task` subcommands; direct Edit/Write on `.ralph/tasks.json` is forbidden and caught by prompt ban + post-task reviewer path-scoped allowlist. 4–6 lines. — project root
15. Final verification: `bun test` green; `bun run build` clean; manual smoke test on a scratch project exercising `ralph task start/complete/note`; deliberately break tasks.json and verify `readTasksFile` recovers via jsonrepair with a `corruption.log` entry; delete both tasks.json and snapshot and verify `TasksFileError` is surfaced; trigger a post-task review in a scratch repo and verify Edit on tasks.json is denied by the path-scoped allowlist. Record results in task notes. — project root

Specialist-agent note: none of the available specialist agents (`planner`, `post-task-reviewer`, `summarizer`) map to these tasks — they're all straight engineering. The generalist is fine. (`post-task-reviewer` is still used by the run loop post-iteration — that's separate.)

## Open Questions

(none — all decisions captured in Approach)
