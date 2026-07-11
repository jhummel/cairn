## Context

This round fixes the **post-task reviewer's output file**, which fails in two ways today:

1. **The file is too long.** All reviews append to a single `.ralph/review-post.md`, now 2,857 lines. The reviewer (Sonnet) must Read the whole file then Edit-append, so it burns context on old reviews and the append edit gets flakier as the file grows.
2. **Permission fragility.** The allowlist in `src/post-task-reviewer.ts:124-130` is a single-file rule — `Edit(/<root>/.ralph/review-post.md),Write(same)`. A code comment (dated 2026-07-11) documents reviews being silently denied/lost in `-p` mode when the rule stopped matching after the reviewer `cd`'d.

Key facts established during exploration:

- Nothing in the codebase reads `review-post.md` programmatically — it is write-only output for humans and the planner. Restructuring is low-risk.
- `ralph plan` (`src/commands/plan.ts:160`) launches **one** interactive planner session; task generation happens via the `/generate-tasks` slash command *inside* that session. The CLI has no "task generation finished" hook, so a round counter must be bumped by the CLI at a point it controls.
- The previous round shipped `state.json` with a lock-protected atomic read→modify→write (`src/task-counter.ts`, `src/file-lock.ts`). That is the natural home for a `round` field.
- **Gotcha:** `readState`/`writeStateAtomic` in `task-counter.ts` know only `{ nextTaskId }` — `reserveTaskIds` writes `{ nextTaskId: N }` wholesale and would **clobber a `round` field** on every ID reservation. State I/O must become field-preserving before `round` is added.
- Reviewer flow: `run.ts` → `runPostTaskReview` → `spawnPostTaskReviewer` (`src/post-task-reviewer.ts`), which builds the user prompt (`buildPostTaskReviewUserPrompt`) and spawns `claude -p` with `--allowedTools Read,Glob,Grep,Edit(<rule>),Write(<rule>)`, model sonnet.
- Task IDs are now monotonic and never reused (`state.json` / `ralph task next-id`), shipped last round.

Source-of-truth note (carried from prior sessions): agent definitions live in `agents/` (repo root) and slash commands in `commands/` (repo root); `ralph init` installs them into a target project's `.claude/`. Edits must target the `agents/`/`commands/` source dirs. This repo's own installed `.claude/agents/` copy should be synced as part of the change.

## Goals

1. Split post-task reviews into **per-planning-round files**: `.ralph/reviews/round-<N>.md` instead of one ever-growing `review-post.md`.
2. Fix the permission failure structurally: a **directory-scoped absolute allowlist rule** covering `.ralph/reviews/**`, so reviews are never silently denied again.
3. Track the planning round with a **CLI-owned counter** in `state.json` — no reliance on an LLM remembering to run a command.
4. **Delete** the legacy `.ralph/review-post.md` (git history preserves it) and scrub all references.

## Approach

- **Round counter in `state.json`.** Add a `round` field alongside `nextTaskId`, lazy-seeded to 1 when absent. `bumpRound(dataDir)` / `getRound(dataDir)` use the same `state.json.lock` + atomic temp-file-rename machinery as `reserveTaskIds`. Prerequisite: make state read/write field-preserving so `reserveTaskIds` and `bumpRound` never clobber each other's fields.
- **Bump trigger: `ralph plan` start.** `plan.ts` bumps `round` before launching the planner session. Fully CLI-owned and deterministic. Accepted cost: quitting a planning session without generating tasks consumes a round number and leaves that round's review file unused — harmless.
- **Keep the reviewer agent dumb.** `run.ts`/`spawnPostTaskReviewer` reads the current round, `mkdir -p`'s `.ralph/reviews/`, and injects the exact target file path into the reviewer's user prompt. The reviewer never computes the round or path.
- **Permission rule** becomes a directory glob with an absolute path: `Edit(/<root>/.ralph/reviews/**),Write(/<root>/.ralph/reviews/**)` — absolute so it survives the reviewer `cd`-ing into service dirs (the documented failure).
- **Within-round appends remain.** A round file holds ~10–20 reviews max (rounds have been 5–22 tasks), so the "too long" failure mode should not recur at that scale. Escape hatch if it ever does: per-task files inside per-round folders — deliberately not built now.
- **Reviewer prompt** (`agents/post-task-reviewer.md`): replace the hardcoded `.ralph/review-post.md` instruction with "append to the file path given in your user prompt"; keep the existing review format (coverage tree, gaps, regression risks, verdict).

Personal instruction: TDD within each task — write the test, watch it fail, make it pass. Do not split a unit of work into separate test/impl tasks.

## Rejected Alternatives

This round:
- **Per-task review files (`.ralph/reviews/task-<id>.md`).** Recommended by the planner (kills the append pattern entirely; monotonic IDs make names collision-free) but the user chose per-round grouping. Remains the escape hatch if round files ever grow too long.
- **Per-run files (`.ralph/reviews/run-<timestamp>.md`).** Rejected — a long run recreates the growing-append problem within a session, and timestamps are less meaningful than planning rounds.
- **Prompt-driven round bump (`ralph round next` called by the generate-tasks prompt).** Rejected — same LLM-reliability class rejected for ID assignment last round.
- **Lazy bump when `run.ts` detects tasks.json was rewritten.** Rejected — most machinery, trickiest edge cases (mid-run `ralph task add` also modifies tasks.json).
- **Keep or archive the old `review-post.md`.** Rejected — delete it; git history preserves it.

Carried from prior sessions (still relevant):
- **Tail `tasks.completed.json` for the last id, then +1** — rejected; IDs reset each round historically, so the tail is not the global max.
- **Prompt-only fix for ID reuse** — rejected in favor of the CLI counter; doesn't cover `ralph task add` or give atomicity.
- **Agent-managed `state.json`** — rejected; no atomicity guarantee.
- **CLI counter for `generate-tasks` only** — rejected; both ID-assigning paths must share the counter.
- **Store `nextTaskId` inside `tasks.json`** — rejected; separate `state.json` survives `tasks.json` rewrites.
- **Audit agent writes `planning-notes.md` directly** — rejected; the planner owns formatting.
- **Configurable audit lenses per invocation** — kept fixed (security + SOLID) for simplicity.
- **Separate `ralph audit` CLI command instead of a slash command** — rejected; slash command keeps the user in the planner session.
- **Use the Anthropic TS SDK instead of shelling out to `claude`** — shelling out gives the full tool suite/permissions/MCP for free.
- **Port narration to TypeScript** — Kokoro TTS and sounddevice are Python-specific.
- **Skills instead of subagents for task generation/review** — subagents get fresh context with full tool access.
- **Change storage format (SQLite / per-task files / JSONL)** — CLI-subcommand approach gets ~95% of the benefit at far lower cost.
- **Pre-commit to git worktrees as the parallel-execution isolation model** — deferred to the parallel-execution RFC round.

## Rough Task Outline

In rough priority order. Each is one agent-sized (~5 min) unit; TDD within each. Dependency flow: 1 → 2 → 3 → {4, 5}.

1. **Field-preserving `state.json` I/O + round counter.** In `src/task-counter.ts`: generalize `readState`/`writeStateAtomic` so unknown/other fields are preserved on write (verify `reserveTaskIds` no longer clobbers `round`); add `getRound(dataDir)` (lazy-seed 1, does not write) and `bumpRound(dataDir)` (atomic increment under `state.json.lock`, preserves `nextTaskId`). Tests in `test/task-counter.test.ts`: lazy seed, bump increments, cross-field preservation both directions. — `src/`, `test/`
2. **`ralph plan` bumps the round.** `plan.ts` calls `bumpRound(dataDir)` at session start, before spawning claude. Test in `test/commands/plan.test.ts`. Depends on #1. — `src/commands/`, `test/commands/`
3. **Reviewer targets `reviews/round-<N>.md`.** In `src/post-task-reviewer.ts` + `src/commands/run.ts`: read round via `getRound`, `mkdir -p` `.ralph/reviews/`, compute the target path, inject it into `buildPostTaskReviewUserPrompt` output, and replace the single-file permission rule with `Edit(/<root>/.ralph/reviews/**),Write(/<root>/.ralph/reviews/**)`. Update `test/post-task-reviewer.test.ts`. Depends on #1. — `src/`, `src/commands/`, `test/`
4. **Rewrite reviewer agent prompt.** In the **source** `agents/post-task-reviewer.md` (not the installed `.claude/` copy): output goes to the file path given in the user prompt; remove all `review-post.md` mentions; keep the review format. Also sync this repo's installed `.claude/agents/post-task-reviewer.md`. Depends on #3. — `agents/`, `.claude/agents/`
5. **Delete legacy file + docs.** `git rm .ralph/review-post.md`; update CLAUDE.md (agent-description line, allowlist paragraph, per-project data layout tree — add `reviews/` and the `round` field in `state.json`) and README; scrub any remaining `review-post.md` references in `test/commands/init.test.ts`, `test/commands/plan.test.ts`, `test/agent-prompt.test.ts` if present. Depends on #3. — project root, `test/`

## Open Questions

1. **Does `ralph init` need to pre-create `.ralph/reviews/`?** Leaning no — `spawnPostTaskReviewer` mkdir's it on demand (task #3), which also covers existing projects. Confirm during #3; add to init only if something else needs the dir to exist earlier.
2. **`getRound` before any `ralph plan` has run** — reviews written before the first post-change plan session land in `round-1.md` (lazy seed). Acceptable; confirm no off-by-one surprise in #3's tests.
3. **`state.json` schema docs** — CLAUDE.md currently documents `state.json` as `{ "nextTaskId": N }`; task #5 must update it to include `round`.
