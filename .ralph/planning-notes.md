## Context

Ralph's TypeScript rewrite is complete — all commands ported, 736 tests pass, post-task review and auto-review loop both shipped, two startup bugs fixed. The `ralph plan` command currently works but has a clunky multi-session flow: it spawns separate claude processes for planning, task generation, and review, with menu loops between each phase. This means 3-4 cold-start claude sessions with context loss between each.

## Goals

Collapse the planning flow into a single interactive claude session. Extract the task generation and review prompts into Claude Code slash commands (`.claude/commands/*.md`) that ship with ralph. The planning agent stays interactive for discussion, then the user triggers `/generate-tasks` and `/review-tasks` as slash commands that spawn fresh subagents (via Claude Code's Agent tool) for clean-context execution.

## Approach

### 1. Create slash command files in the ralph repo

Add a `commands/` directory at the ralph repo root containing:

- **`commands/generate-tasks.md`** — Instructs the agent to spawn a fresh general-purpose subagent (via the Agent tool) that reads `.ralph/planning-notes.md`, reads the codebase as needed, and writes `.ralph/tasks.json`. Contains the full tasks.json schema, task structure guidelines, directory guidelines, test command guidelines, and rules. All currently in `buildTaskGenPrompt()` in `src/commands/plan.ts`.

- **`commands/review-tasks.md`** — Instructs the agent to spawn a fresh general-purpose subagent that evaluates `.ralph/tasks.json` against `.ralph/planning-notes.md` on 5 dimensions (Coverage, Atomicity, Dependencies, Acceptance Criteria, Context Sufficiency). Reports findings back to the user conversationally. All currently in `buildReviewPrompt()` in `src/commands/plan.ts`.

The general-purpose subagent type inherits all parent tools (including Write/Edit), so subagents can write tasks.json and read any project files.

### 2. Update `ralph init` to install slash commands

In `src/commands/init.ts`, add a step that copies `commands/*.md` from the ralph repo into the target project's `.claude/commands/` directory. This should be unconditional (always install, not behind a prompt) since these commands are always useful. Follow the same pattern as `installNarrationHooks()` — create the directory, copy files, log what was created. On re-init, overwrite existing command files (they're ralph-managed, not user-edited — users can customize by editing after install).

The ralph repo root is available via `resolveRalphRoot()` from `src/utils.ts`.

### 3. Simplify `ralph plan`

The `runPlan()` function becomes:
1. Call `displayPreflight()` (keep — nice status overview)
2. Build a minimal system prompt with just project context (name, root, data dir, agents list) and the planning role/workflow/format instructions
3. Spawn one interactive `claude --append-system-prompt <prompt> --allowedTools Read,Glob,Grep,Write,Edit` session
4. When the user exits, ralph is done

The planning agent reads CLAUDE.md, README.md, package.json, etc. itself — no need to embed file contents in the system prompt. The system prompt just needs the role description, planning-notes.md format spec, and rules (the static parts of the current `buildPlanningPrompt()`).

### 4. Delete obsolete code from plan.ts

Remove:
- `buildTaskGenPrompt()` — moved to `commands/generate-tasks.md`
- `buildReviewPrompt()` — moved to `commands/review-tasks.md`
- `buildRegeneratorPrompt()` — no longer needed (user can ask conversationally or re-run `/generate-tasks`)
- `spawnReviewer()`, `spawnRegenerator()`, `runAutoReview()` — replaced by slash commands
- `parseReviewFeedback()`, `ReviewDimension`, `ReviewResult` interfaces — reviewer reports conversationally now
- `reviewNotesLoop()`, `reviewTasksLoop()` — replaced by natural conversation in the interactive session
- `launchPlanningSession()`, `launchTaskGeneration()` — collapsed into single session spawn
- All associated types: `LaunchPlanningSessionOpts`, `LaunchTaskGenerationOpts`, `SpawnReviewerOpts`, `SpawnReviewerDeps`, `SpawnRegeneratorOpts`, `SpawnRegeneratorDeps`, `RunAutoReviewOpts`, `ReviewTasksLoopOpts`, `ReviewNotesLoopOpts`, `RunPlanOpts` (will need a simpler replacement)
- The `tasksSchemaRaw` import — schema moves into the slash command file

### 5. Delete menu.ts

`src/menu.ts` and `test/menu.test.ts` — only consumer was plan.ts menu loops, which are gone.

### 6. Update tests

Delete tests for all removed functions. Add tests for:
- The new simplified `runPlan()` (spawns claude with correct args, system prompt contains project context)
- The init command's slash command installation (files copied, directory created, idempotent)

Keep tests for functions that survive: `formatBanner()`, `formatPlanningNotesStatus()`, `formatCompletedCount()`, `formatTasksSummary()`, `displayPreflight()`, `buildPlanningPrompt()` (simplified version).

### 7. Update install.sh / build verification

Ensure `bun test` passes and `bun run build` compiles after all changes. The `commands/` directory is static markdown — it doesn't need to be compiled, just needs to be findable at runtime via `resolveRalphRoot()`.

## Rejected Alternatives

- **Use Anthropic TS SDK instead of shelling out to claude:** Rejected for now. Shelling out to `claude -p` gives us Claude Code's full tool suite, permissions model, and MCP support for free. Can revisit later.
- **Port narration to TypeScript:** Rejected for now. Kokoro TTS and sounddevice are Python-specific audio libraries. Keep narration as a Python subprocess spawned from TS.
- **Skills instead of subagents for task generation/review:** Considered having the slash commands execute within the same session context (no Agent tool, the planning agent just does the work). Rejected — clean context matters for task generation (avoids bias from conversational tangents) and review (independent evaluation). Subagents via Agent tool get fresh context while still having full tool access.
- **Dynamically generated slash commands:** Considered having ralph write `.claude/commands/` files at plan time with templated project-specific values. Rejected in favor of static files copied during `ralph init` — easier to version, edit, and customize. The subagent can read project context from files at runtime.
- **Regenerator as separate slash command:** Considered keeping a `/regenerate-tasks` command. Rejected — if the review finds issues, the user can ask the planning agent conversationally or just re-run `/generate-tasks`. Separate regenerator adds complexity without clear benefit.
- **Gating command installation behind a prompt:** Considered asking "Install planning slash commands?" during init. Rejected — these are always useful and non-invasive (they go in `.claude/commands/` which is standard Claude Code). Install unconditionally.
- **Post-task review blocks archival:** Considered having review failures revert task status or block archival. Rejected — this is informational only for now. Let the human read `review-post.md` and decide what to do. Can add blocking behavior later if the signal proves reliable.
- **Review using HEAD~1 instead of SHA capture:** Considered diffing against `HEAD~1` for simplicity. Rejected — agents may make multiple commits or amend, so `HEAD~1` wouldn't capture the full delta. Capturing SHA before the agent runs and diffing `<before>..HEAD` is more robust.

## Rough Task Outline

1. Create `commands/generate-tasks.md` — extract task gen prompt from `buildTaskGenPrompt()`, adapt for slash command format (instruct agent to use Agent tool to spawn subagent). Inline the tasks.json schema. — `commands/`
2. Create `commands/review-tasks.md` — extract review prompt from `buildReviewPrompt()`, adapt for slash command format (instruct agent to use Agent tool to spawn subagent). Include 5 dimensions and scoring. — `commands/`
3. Add slash command installation to `ralph init` — copy `commands/*.md` to target project's `.claude/commands/`, create dir if needed, log output. Unconditional, idempotent. — `src/commands/init.ts`, `test/commands/init.test.ts`
4. Simplify `buildPlanningPrompt()` — remove file embedding (tryReadFile/fileSection), keep role description, planning-notes format, and rules. Agent reads files itself. — `src/commands/plan.ts`, `test/commands/plan.test.ts`
5. Simplify `runPlan()` — replace multi-session orchestration with single interactive claude spawn. Remove menu loop calls. — `src/commands/plan.ts`, `test/commands/plan.test.ts`
6. Delete obsolete plan.ts code — remove `buildTaskGenPrompt`, `buildReviewPrompt`, `buildRegeneratorPrompt`, `spawnReviewer`, `spawnRegenerator`, `runAutoReview`, `parseReviewFeedback`, `reviewNotesLoop`, `reviewTasksLoop`, `launchPlanningSession`, `launchTaskGeneration`, and all associated types/interfaces. — `src/commands/plan.ts`, `test/commands/plan.test.ts`
7. Delete `menu.ts` — remove `src/menu.ts` and `test/menu.test.ts`. Remove import from plan.ts. — `src/menu.ts`, `test/menu.test.ts`
8. Verify build + full test suite — `bun test`, `bun run build`, smoke test `ralph plan --help`. — `/`

## Open Questions

None.
