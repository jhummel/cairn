## Context

`.ralph/instructions.md` is supposed to be a personal-preferences file that steers every Ralph agent (e.g., "Always use TDD", "Be concise", "Prefer small commits"). Today it only reaches the **execution** agent:

- `src/commands/run.ts:84-92` reads `<dataDir>/instructions.md` and injects it as `PERSONAL INSTRUCTIONS:` into the system prompt. Verified working end-to-end (binary, tests, live prompt render all include the content).
- Every other Ralph-spawned agent ignores the file: `src/commands/plan.ts`, `src/commands/summarize.ts`, `src/post-task-reviewer.ts`, and the subagent prompts in `commands/generate-tasks.md` and `commands/review-tasks.md`.

Symptom the user hit: recent completed tasks #8–#11 were generated as `Refactor X` → `Update X tests` pairs — structurally anti-TDD — because the **task-generation** subagent never sees the TDD preference. By the time the execution agent runs, each task is already shaped non-TDD, and a single "Always use TDD" bullet in its system prompt can't undo that.

The `--agents`/`--agent` refactor from the previous round is done (tasks 1–14 in `tasks.completed.json`). All three Ralph-spawned agents (planner, summarizer, post-task-reviewer) now load their persona from `.claude/agents/*.md` via `buildAgentArgs()`, which means there's a clean seam to append dynamic context to each one.

## Goals

Feed `.ralph/instructions.md` into every Ralph-spawned agent — execution, planning, task generation, task review, summarization, and post-task review — so personal preferences apply uniformly. Keep the format and injection style consistent with what `run.ts` already does (`PERSONAL INSTRUCTIONS:` block). No new task-shape guidance in generate-tasks.md yet — just feed the file and observe whether TDD-shaped task splits emerge naturally.

## Approach

### Shared helper

Extract the instructions-loading logic into a single module: `src/personal-instructions.ts`, exporting `loadPersonalInstructions(dataDir: string): string`. Returns the fully-formatted block (`\nPERSONAL INSTRUCTIONS:\n<content>\n`) when the file exists and is non-empty; returns `''` otherwise. Matches the current behavior in `run.ts` exactly so the refactor is zero-diff in rendered output.

### Injection points

| Spawner | Where instructions go | Notes |
|---|---|---|
| `run.ts` (execution) | System prompt (already there) | Refactor to call the shared helper — no behavior change |
| `plan.ts` (planner) | Dynamic `--append-system-prompt` string built in `buildDynamicContext()` | Planner sees them alongside project name / paths / agents list |
| `summarize.ts` (summarizer) | User prompt via `buildUserPrompt()` | Summarize's dynamic context already flows through stdin; append block at the top |
| `post-task-reviewer.ts` | User prompt via `buildPostTaskReviewUserPrompt()` | Same pattern — prepend to the review context |
| `commands/generate-tasks.md` (subagent) | Step in the subagent prompt markdown | Subagent is spawned by Claude's Agent tool, not by Ralph — so the prompt text itself has to tell the subagent to read the file |
| `commands/review-tasks.md` (subagent) | Step in the subagent prompt markdown | Same as generate-tasks |

For the two slash-command subagents, the injection is a sentence like: *"If `.ralph/instructions.md` exists, read it first — it contains personal preferences that apply to this task."* The subagent reads the file using its Read tool at runtime.

### Why different injection points for different spawners

- TS-spawned agents (run, plan, summarize, post-task-review) have Ralph building their prompt — Ralph reads `instructions.md` once and splices it in. Guaranteed delivery.
- Slash-command subagents are spawned by Claude's Agent tool inside the planner session, so Ralph can't inject at spawn time. The next-best thing is to instruct the subagent (via the static markdown prompt that `install.sh` copies to `.claude/commands/`) to read the file itself.

### Rollout note

The updated `commands/*.md` files need to propagate to `<projectRoot>/.claude/commands/` for each project. `ralph init` already copies them via `installSlashCommands()`. Users with existing Ralph installs need to re-run `ralph init` in their project (or manually copy the updated files). Worth mentioning in the final commit message; no code change needed.

## Rejected Alternatives

- **Add TDD-specific or task-shape guidance to `commands/generate-tasks.md`** — Rejected for this round. User wants to see if feeding the instructions file is enough first. Can add targeted guidance later if task shapes still come out non-TDD.
- **Have every agent read `instructions.md` itself (even TS-spawned ones)** — Rejected. For TS-spawned agents, Ralph already has the data in hand; making the agent re-read the file adds a tool call and introduces the risk that the agent skips the read. Splice-at-spawn is more reliable.
- **Inject personal instructions into the subagent prompt by having the planner pass them through dynamically** — Rejected. Would require the planner to read instructions.md and interpolate it into the Agent-tool spawn call, which adds fragility. Simpler: each subagent reads the file itself.
- **Pass instructions.md contents via a new CLI flag (`--instructions-file`)** — Rejected. We already have a well-defined convention (`.ralph/instructions.md` in the data dir); no need to add a flag. The file-based contract is simpler and matches existing patterns (`planning-notes.md`, `tasks.json`, etc.).
- **Use Anthropic TS SDK instead of shelling out to claude** (carried from prior session) — Rejected for now. Shelling out to `claude -p` gives us Claude Code's full tool suite, permissions model, and MCP support for free. Can revisit later.
- **Port narration to TypeScript** (carried from prior session) — Rejected for now. Kokoro TTS and sounddevice are Python-specific. Keep narration as a Python subprocess.
- **Skills instead of subagents for task generation/review** (carried from prior session) — Rejected. Clean context matters for task generation and review; subagents get fresh context while keeping full tool access.

## Rough Task Outline

1. Create `src/personal-instructions.ts` with `loadPersonalInstructions(dataDir)` — extracts and formats the `PERSONAL INSTRUCTIONS:` block. — `src/`
2. Add unit tests for `loadPersonalInstructions` (missing file, empty file, whitespace-only, normal content, trailing whitespace). — `test/`
3. Refactor `src/commands/run.ts` `buildSystemPrompt()` to call `loadPersonalInstructions()` instead of inline logic. Confirm rendered output is byte-identical for the TDD case. — `src/commands/`
4. Update `src/commands/plan.ts` `buildDynamicContext()` (or wherever the `--append-system-prompt` string is built) to include the personal-instructions block. — `src/commands/`
5. Update `test/commands/plan.test.ts` to assert personal instructions appear in the dynamic context when `instructions.md` exists and are absent otherwise. — `test/commands/`
6. Update `src/commands/summarize.ts` `buildUserPrompt()` to prepend the personal-instructions block. — `src/commands/`
7. Update `test/commands/summarize.test.ts` with the same presence/absence assertions. — `test/commands/`
8. Update `src/post-task-reviewer.ts` `buildPostTaskReviewUserPrompt()` to prepend the personal-instructions block. — `src/`
9. Update `test/post-task-reviewer.test.ts` with presence/absence assertions. — `test/`
10. Update `commands/generate-tasks.md`: add a step to the subagent workflow instructing it to read `.ralph/instructions.md` if present. — `commands/`
11. Update `commands/review-tasks.md`: same addition. — `commands/`
12. Verify build + full test suite + end-to-end render: run `bun test`, `bun run build`, then render the real `plan`/`summarize`/`review` prompts against the live `.ralph/instructions.md` and confirm the TDD line appears in each. — project root

Note for the generator: task #3 (run.ts refactor) is a pure extraction with no behavior change — write a snapshot/equality assertion against the current rendered prompt before changing it, so we catch any drift. Tasks #4, #6, #8 each follow the same pattern (add helper call → assert block appears in the right output) and can reuse the test structure from #5/#7/#9. Tasks #10 and #11 are markdown-only edits with no automated test — they're verified by task #12's end-to-end render or by re-running `ralph init` against a scratch project.

## Open Questions

- **Where exactly to place the block in each prompt?** In `run.ts` it currently sits between the project description and the DIRECTORY section. For plan/summarize/review, placement inside their dynamic context is fine as long as it's a prominent top-level section. Task generator should pick a consistent location (e.g., "right after the greeting / project identification block") and use the same `PERSONAL INSTRUCTIONS:` header everywhere.
- **Should the review-post.md output also incorporate personal instructions?** Probably yes via post-task-reviewer already getting them — no separate action needed.
