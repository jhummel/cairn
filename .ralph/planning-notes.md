## Context

This round addresses a single focused defect: **Ralph reuses task IDs across planning rounds.** The `generate-tasks` subagent prompt (`commands/generate-tasks.md:149`) tells it to "continue from the highest existing ID" — but it only inspects the *current* `.ralph/tasks.json`, and by the time you re-plan, completed tasks have been archived *out* of `tasks.json` into `tasks.completed.json` (`src/task-archiver.ts:89-105` appends them to the archive and removes them from the active file). So each fresh `ralph plan` round sees a near-empty `tasks.json` and restarts IDs at 1.

Confirmed empirically: grepping every `"id":` in `.ralph/tasks.completed.json` shows IDs reset to 1 roughly a dozen times — one block per planning round (`1..7`, `1..5`, `1..12`, `1..15`, `1..9`, ...). IDs are already being reused heavily.

Important correction to the initial "tail the file to get the last id" idea: because each round resets to 1, **the last entry in the archive is not the highest id ever used.** The file currently *ends* at id 9, but an earlier round reached id 15 — so "tail + 1" would hand out 10 and collide. The true requirement is the **maximum id across the whole archive + the active `tasks.json`**, which can be computed cheaply (extract just the `"id":` numbers, take the max) without reading the whole 3,286-line file into context.

Two distinct code paths hand out IDs today, and both must draw from the counter to truly guarantee no reuse:
1. **`generate-tasks`** writes the entire `tasks.json` and picks IDs for the whole batch.
2. **Executor agents mid-run** call `ralph task add --file <path>` (`run.ts:132`). `taskAdd` (`task.ts:218-253`) does *not* assign an id — the agent supplies its own `id` in the payload (schema requires it), so those IDs are agent-chosen and also ignore the archive.

Relevant prior context: the previous round shipped concurrency-safe `tasks.json` writes — `tasks-file.ts` now has a cross-process `O_EXCL` advisory lock (`acquireLock`, `tasks-file.ts:204`) with stale-lock break + bounded retry/backoff, plus `uniqueTmpPath()` and atomic temp-file rename (`writeTasksFile`). The counter will reuse these proven primitives.

Source-of-truth note (carried from prior sessions): agent definitions live in `agents/` (repo root) and slash commands in `commands/` (repo root); `ralph init` installs them into a target project's `.claude/`. Edits must target the `agents/`/`commands/` source dirs, not the installed `.claude/` copies.

## Goals

1. **Never reuse a task ID.** Once an id has been used (in any planning round, whether the task is active, complete, or archived), it must never be handed out again.
2. Cover **both** ID-assigning paths — `generate-tasks` batch creation and mid-run `ralph task add` — from a single source of truth.
3. Require **no manual migration** for existing projects (this repo included): the mechanism seeds itself from existing data on first use.

## Approach

A **CLI-owned monotonic counter** persisted in a new `.ralph/state.json` file (`{ "nextTaskId": N }`). All ID assignment routes through the CLI, consistent with Ralph's existing "all `tasks.json` mutations go through the CLI, atomic + lock-protected" ethos.

Key design decisions:
- **Counter storage:** a separate `.ralph/state.json`, not a field inside `tasks.json` — it survives `tasks.json` rewrites by `generate-tasks` and is conceptually distinct runtime state. **Committed to git** (like `tasks.json` already is) so the high-water mark survives clones and machine switches — not gitignored.
- **Lazy seeding (the migration story):** on the first reserve, if `state.json` is missing, compute `seed = max(all ids in tasks.completed.json + active tasks.json) + 1` (floor of 1). This makes existing projects Just Work — this repo will start at 16 automatically with zero manual steps.
- **Atomicity:** reserves go through the same cross-process lock primitive as `mutateTasksFile`. To avoid duplication, extract the lock helper from `tasks-file.ts` into a shared `src/file-lock.ts` and have both the counter and `mutateTasksFile` use it.
- **CLI surface:** `ralph task next-id [--count <n>]` reserves N contiguous IDs atomically (read → increment by N → write), printing the reserved id(s). `generate-tasks` reserves a block sized to the number of *new* tasks; `ralph task add` reserves a single id internally.
- **`ralph task add` auto-assign:** inject the reserved id into the payload before validation, make `id` optional for the add path, and print the assigned id so the agent knows it. Update the executor prompt (`run.ts:132`) so agents no longer supply an id.
- **`generate-tasks` prompt:** replace the "continue from the highest existing id in `tasks.json`" rule with: after user approval, reserve a contiguous block via `ralph task next-id --count <n>` and assign those IDs sequentially to new tasks; never reuse archived IDs; preserve any already-complete tasks' existing IDs and metadata unchanged.
- **`ralph init`:** create `state.json` — seeded to 1 for a fresh project, or from `max(existing) + 1` on re-init of an existing project (lazy seeding also covers this, but init makes it explicit).

Personal instruction: TDD within each task — write the test, watch it fail, make it pass. Do not split a unit of work into separate test/impl tasks.

## Rejected Alternatives

This round:
- **Tail `tasks.completed.json` for the last id, then +1.** Rejected — IDs reset to 1 each planning round, so the tail is not the global max and "+1" collides with earlier rounds. We compute the max across all IDs instead.
- **Prompt-only fix (instruct the subagent to grep the max id from both files).** Rejected in favor of the CLI counter. Prompt-only relies on the LLM running the right command every time and doesn't cover the `ralph task add` path or give atomicity.
- **Agent-managed `state.json` (generate-tasks reads/writes it directly, no CLI command).** Rejected — no atomicity guarantee and doesn't cover mid-run `task add`. The CLI-owned counter is the right fit for Ralph's mutation-routing model.
- **CLI counter for `generate-tasks` only (leave `task add` picking its own id).** Rejected — leaves a residual collision window where a mid-run discovered task could grab an id a future round also hands out. Both paths must share the counter.
- **Store `nextTaskId` as a field inside `tasks.json`.** Rejected — a separate `state.json` survives `tasks.json` rewrites cleanly and keeps runtime counter state distinct from the task list.

Carried from prior sessions (still relevant):
- **Audit agent writes `planning-notes.md` directly** — rejected; the audit agent is a recon specialist that returns findings, and the planner (with conversational context) owns formatting.
- **Configurable audit lenses per invocation** — kept fixed (security + SOLID) for simplicity; extensible later.
- **Separate `ralph audit` CLI command instead of a slash command** — rejected; the slash command runs inside the planner session so the user can keep chatting.
- **Use the Anthropic TS SDK instead of shelling out to `claude`** — shelling out gives Claude Code's full tool suite, permissions model, and MCP support for free.
- **Port narration to TypeScript** — Kokoro TTS and sounddevice are Python-specific.
- **Skills instead of subagents for task generation/review** — clean context matters; subagents get fresh context while keeping full tool access.
- **Change storage format (SQLite / per-task files / JSONL)** — structurally solves corruption but a much larger change with migration cost; the CLI-subcommand approach gets ~95% of the benefit.
- **Pre-commit to git worktrees as the parallel-execution isolation model** — left as the central question for the parallel-execution RFC (deferred round), weighed against directory-disjoint scheduling.

## Rough Task Outline

In rough priority order. Each is one agent-sized (~5 min) unit; TDD applied within each task that touches code. Dependency flow: 1 → 2 → {3, 4, 5}; 6 depends on 3; 7 last.

1. **Extract shared file-lock helper.** Pull `acquireLock`/`sleepSync`/stale-break logic out of `src/tasks-file.ts` into a new `src/file-lock.ts`, export it, and refactor `mutateTasksFile` to consume it (behavior unchanged). Test in `test/file-lock.test.ts`. — `src/`, `test/`
2. **Task counter module.** New `src/task-counter.ts`: lazy-seed `nextTaskId` from `max(ids in tasks.completed.json + active tasks.json) + 1` (floor 1) when `state.json` is missing; `reserveTaskIds(dataDir, count)` performs an atomic read→increment→write under the shared file-lock and returns the reserved id(s); persists `.ralph/state.json`. Test: seed-from-archive, single + block reserve, lazy-seed-when-missing, sequential reserves don't overlap. Depends on #1. — `src/`, `test/`
3. **`ralph task next-id` CLI command.** Wire `next-id [--count <n>]` into `src/commands/task.ts` + `src/index.ts`; prints the reserved id(s). Depends on #2. Test in `test/commands/task.test.ts`. — `src/commands/`, `src/`, `test/`
4. **Auto-assign id in `ralph task add`.** Inject a reserved id into the payload before validation (ignore/omit any supplied id), make `id` optional for the add path, print the assigned id; update the executor prompt at `run.ts:132` so agents don't supply an id. Depends on #2. Test in `test/commands/task.test.ts`. — `src/commands/`, `test/`
5. **`ralph init` seeds `state.json`.** Create `.ralph/state.json` — `{ "nextTaskId": 1 }` for a fresh project, seeded from `max(existing) + 1` on re-init. Depends on #2. Test in `test/commands/init.test.ts`. — `src/commands/`, `test/`
6. **Rewrite the ID rule in `commands/generate-tasks.md`.** Replace the "continue from the highest existing id in `tasks.json`" instruction with: after approval, reserve a contiguous block via `ralph task next-id --count <n>` and assign IDs sequentially to new tasks; never reuse archived IDs; preserve already-complete tasks' existing IDs and metadata. Edit the **source** `commands/generate-tasks.md`, not the installed `.claude/` copy. Doc change. Depends on #3. — `commands/`
7. **Docs.** Update README and CLAUDE.md to document `.ralph/state.json`, the monotonic-id (never-reused) guarantee, the `ralph task next-id` command, and that `state.json` is committed (not gitignored). — project root

## Open Questions

1. **Command naming** — defaulting to `ralph task next-id [--count <n>]`. A separate `ralph task reserve <n>` was considered; folding count into `next-id` keeps the surface smaller. Reconfirm at implementation if a clearer verb emerges.
2. **`state.json` git tracking** — decided: committed (matches `tasks.json`). Confirm `.ralph/.gitignore` doesn't accidentally exclude it; task #7/#5 should verify.
3. **Supplied-id handling in `task add`** — leaning toward always ignoring any agent-supplied id and auto-assigning. Alternative (honor a supplied id if present, only reserve when omitted) reopens the collision risk, so default is ignore-and-reserve. Confirm in task #4.
