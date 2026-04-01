## Task #3: Add slash command installation to ralph init
Reviewed: 2026-03-29T23:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Add installSlashCommands(projectRoot: string) to src/commands/init.ts
├── [DONE] Use resolveRalphRoot() from src/utils.ts to locate ralph repo root
├── [DONE] Read all .md files from <ralphRoot>/commands/
├── [DONE] Create .claude/commands/ with mkdirSync recursive
├── [DONE] Copy each file, overwriting if exists
├── [DONE] Log what was created/updated
├── [DONE] Unconditional call from runInit() after initCoreFiles()
├── [DONE] TDD: tests written in test/commands/init.test.ts
├── [DONE] Test: directory created
├── [DONE] Test: files copied
├── [DONE] Test: idempotent (re-run overwrites)
├── [DONE] Test: handles missing commands dir gracefully
├── [DONE] Optional ralphRoot override param for test isolation
└── [DONE] Existing runInit test updated (.claude/.hooks absence still asserted)
```

### Files Changed
- `src/commands/init.ts` — added `installSlashCommands()`, wired into `runInit()`
- `test/commands/init.test.ts` — 8 new tests for `installSlashCommands`, 2 updated `runInit` tests
- `.ralph/tasks.json` — task #3 marked complete, task #4 archived from active list

### Gaps
None detected.

### Regression Risks
- The existing `runInit` test that asserted `expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false)` was correctly updated to assert only `.claude/hooks` is absent. The `.claude/commands/` dir now always exists after `runInit`. The intent of the original test was to verify that hooks aren't installed by default — the updated assertion preserves that intent.
- `installSlashCommands` uses `resolveRalphRoot()` when no override is provided. In production use `resolveRalphRoot()` resolves via the installed binary path; tests pass an explicit `ralphRoot` override to avoid depending on the real commands directory (except the tests that intentionally verify real file copying).
- One test (`copied files have the same content`) uses `require('../../src/utils')` inside the test body rather than an import, which is a style inconsistency but not a bug.

### Verdict
CLEAN

---

## Task #4: Simplify buildPlanningPrompt()
Reviewed: 2026-03-29T22:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Keep role description (you are a planning assistant...)
├── [DONE] Keep planning-notes.md format spec (Context/Goals/Approach/Rejected Alternatives/Rough Task Outline/Open Questions)
├── [DONE] Keep rules/guidelines for the planning conversation
├── [DONE] Keep project context fields (projectName, projectRoot, dataDir)
├── [DONE] Keep specialist agents list (agentsSection still built and interpolated)
├── [DONE] REMOVE all tryReadFile()/fileSection() calls from buildPlanningPrompt
├── [DONE] Mention agent should read CLAUDE.md, README.md, etc. via tools
├── [DONE] Remove implementationFile from PlanningPromptInput interface
├── [DONE] TDD: update tests before implementation
├── [DONE] Remove tests asserting embedded file content (6 tests removed)
├── [DONE] Add tests verifying simplified prompt (3 new tests)
└── [DONE] Do NOT delete tryReadFile()/fileSection() — preserved at lines 92/100
```

### Files Changed
- `.ralph/tasks.json` — task #4 marked complete, task #2 archived
- `src/commands/plan.ts` — removed file embedding from `buildPlanningPrompt()`, removed `implementationFile` from `PlanningPromptInput`
- `test/commands/plan.test.ts` — replaced 6 embedding-assertion tests with 3 new behavioral tests

### Gaps
None detected.

### Regression Risks
- `implementationFile` was removed from `PlanningPromptInput` but the calling sites in `RunPlanOpts`/`LaunchPlanningSessionOpts` still carry it (intentionally left for Task 5). The call at line 784 was updated to drop it. TypeScript will silently accept the extra field at call sites — no runtime error, but the field is now a dead parameter in those opts structs until Task 5 cleans up.
- `.claude/agents/*.md` mention moved from conditional (only when `agents.length > 0`) to always-present in BRIEFING MATERIALS. Slight behavioral change but arguably correct — the agent should know to look for them even if none are registered at launch time.

### Verdict
CLEAN

---

## Task #1: Fix narration startup retry loop (TDD)
Reviewed: 2026-03-29T21:35:00Z

### Coverage
```
Task Requirements
├── [DONE] Add test: retry succeeds on Nth attempt
├── [DONE] Add test: early exit on first success
├── [DONE] Add test: throws after all retries exhausted
├── [DONE] Replace single health check with retry loop (10 retries, 1s intervals)
├── [DONE] Return PID on first successful PONG
├── [DONE] Throw only after all 10 retries exhausted
└── [DONE] Run bun test test/narration.test.ts (confirmed passing per task notes)
```

### Files Changed
- `src/narration.ts` — added `StartNarrationDeps` interface, injected `checkHealth` and `sleep` deps, replaced single-check with 10-retry loop
- `test/narration.test.ts` — added 3 new tests; updated existing tests to inject `noopSleep`
- `.ralph/tasks.json` — task metadata updated (status, notes, task list restructured)

### Gaps
None detected

### Regression Risks
- Existing `startNarrationServer` tests updated to pass `deps: { sleep: noopSleep }` — consistent with new interface, no breakage.
- The retry loop always sleeps *before* checking health (sleep-then-check), meaning there's a minimum 1s wait even on first attempt in production. This matches the old behavior (1s wait then check) and is intentional, but the early-exit test verifies only 1 health check call, not 1 sleep call — not a bug, just worth noting.
- `checkHealth` is called up to 10 times maximum, verified by the exhaustion test asserting `callCount === 10`.

### Verdict
CLEAN

---

## Task #3: Verify build and full test suite
Reviewed: 2026-03-29T22:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Run bun test — all tests must pass
├── [DONE] Run bun run build — must produce dist/ralph without errors
└── [DONE] Diagnose and fix if anything fails
```

### Files Changed
- `.ralph/tasks.json` — task #3 marked complete; task #2 archived from active list

### Gaps
None detected

### Regression Risks
- The only diff is a metadata update to `tasks.json` (status: pending → complete, notes added, task #2 removed from active list). No source code was changed.
- Notes report 736 tests passing and a clean build in 126ms, but no source or test files are in the diff to verify independently. The agent's self-reported pass counts are trusted but unverifiable from the diff alone.

### Verdict
CLEAN

---
## Task #1: Create commands/generate-tasks.md slash command
Reviewed: 2026-03-29T22:35:00Z

### Coverage
```
Task Requirements
├── [DONE] Create commands/ directory at repo root
├── [DONE] Add commands/generate-tasks.md
├── [DONE] Instruct planning agent to spawn subagent via Agent tool
├── [DONE] Subagent reads .ralph/planning-notes.md and codebase
├── [DONE] Subagent writes .ralph/tasks.json
├── [DONE] Inline full tasks.json schema from src/tasks-schema.json
├── [DONE] Task structure guidelines (id, priority, title, description, directory, status, files, dependencies, tests, model, agent)
├── [DONE] Directory guidelines table
├── [DONE] Test command guidelines (prefer npm scripts over direct invocations)
├── [DONE] Rules: never modify completed tasks, unique/sequential IDs, ~5 min scope, dependencies, specific file paths
├── [DONE] Model selection guidance (sonnet vs opus)
├── [DONE] Agent selection from .claude/agents/
├── [DONE] Preserve tasks with status 'complete' and metadata (completedAt, completedBy, notes)
└── [DONE] Present proposed tasks to user BEFORE writing tasks.json
```

### Files Changed
- `commands/generate-tasks.md` — new file, 153 lines; full slash command implementation
- `.ralph/tasks.json` — task #1 marked complete; tasks #2–7 added for the broader refactoring plan

### Gaps
None detected

### Regression Risks
- `src/commands/plan.ts` and `src/tasks-schema.json` are listed as expected files in the task spec — these are reference-only (the agent was meant to consult them, not modify them), and the diff correctly shows no changes to those files.
- The tasks.json diff replaces the previously completed task #3 with a heavily rewritten entry and adds tasks #2–7. Prior completed tasks (#1, #2, #3 from the old session) are **not preserved** in the new tasks.json — the new entry retains only the new Task #1 as `complete`. This is expected since the tasks represent a new planning session, but worth flagging in case the old completed entries were intended to persist.
- The slash command instructs the planning agent to "relay feedback and iterate" after subagent returns, but the mechanism for iterating (spawning a second subagent vs re-prompting the same one) is left implicit — minor UX ambiguity, not a functional gap.

### Verdict
CLEAN

---

## Task #2: Create commands/review-tasks.md slash command
Reviewed: 2026-03-29T22:45:00Z

### Coverage
```
Task Requirements
├── [DONE] Create commands/review-tasks.md in commands/ directory
├── [DONE] Instruct planning agent to use Agent tool to spawn subagent
├── [DONE] Subagent reads .ralph/tasks.json
├── [DONE] Subagent reads .ralph/planning-notes.md
├── [DONE] Evaluate on 5 dimensions: Coverage, Atomicity, Dependencies,
│          Acceptance Criteria, Context Sufficiency
├── [DONE] Score each dimension PASS/WARN/FAIL with issue bullets
├── [DONE] Overall verdict: PASS or NEEDS_WORK
├── [DONE] Subagent reports findings conversationally (no file writes)
└── [DONE] Explicit constraint: do NOT write review-feedback.md or any files
```

### Files Changed
- `commands/review-tasks.md` — new file, 91 lines; full slash command implementation
- `.ralph/tasks.json` — task #2 marked complete; task #1 entry archived from active list

### Gaps
None detected

### Regression Risks
- `src/commands/plan.ts` is listed under Expected Files — this is a reference-only annotation (the task says "replace" as future intent), not a required modification in this task. The diff correctly shows no changes to `src/commands/plan.ts`.
- The task `completedAt` timestamp (`2026-03-29T22:15:00Z`) predates the task #1 `completedAt` (`2026-03-29T22:30:00Z`), which is inconsistent with sequential execution order. Cosmetic metadata issue only.

### Verdict
CLEAN

---

## Task #5: Simplify runPlan() and delete obsolete code
Reviewed: 2026-03-29T23:10:00Z

### Coverage
```
Task Requirements
├── [DONE] New runPlan(): displayPreflight → buildPlanningPrompt → single spawnSync claude
├── [DONE] Delete buildTaskGenPrompt() + tests
├── [DONE] Delete buildReviewPrompt() + tests
├── [DONE] Delete buildRegeneratorPrompt() + tests
├── [DONE] Delete spawnReviewer() + tests
├── [DONE] Delete spawnRegenerator() + tests
├── [DONE] Delete runAutoReview() + tests
├── [DONE] Delete parseReviewFeedback() + tests
├── [DONE] Delete reviewNotesLoop() + tests
├── [DONE] Delete reviewTasksLoop() + tests
├── [DONE] Delete launchPlanningSession() + tests
├── [DONE] Delete launchTaskGeneration() + tests
├── [DONE] Delete all associated types/interfaces
├── [DONE] Delete tryReadFile(), fileSection() helpers
├── [DONE] Delete computeGitStatus(), defaultEditFn() helpers
├── [DONE] Remove tasksSchemaRaw import
├── [DONE] Remove menu.ts import (menu.ts not deleted — deferred to task 6)
├── [DONE] Simplify RunPlanOpts to {projectName, projectRoot, dataDir, agents, spawnSyncFn?}
├── [DONE] runPlan is now synchronous (void, not Promise<void>)
├── [DONE] index.ts updated to match new sync interface (removed rl/readline plumbing)
└── [DONE] New tests for simplified runPlan written and passing (~8 targeted tests)
```

### Files Changed
- `src/commands/plan.ts` — ~680 lines deleted; new 43-line runPlan implementation
- `src/index.ts` — plan command action simplified from async+readline to sync
- `test/commands/plan.test.ts` — ~2100 lines of obsolete tests removed, ~140 lines of new runPlan tests added
- `.ralph/tasks.json` — task #3 archived, task #5 marked complete

### Gaps
None detected — all specified deletions, type removals, and helper removals were carried out.

### Regression Risks
- **Narration/ntfy hooks dropped**: The old `launchPlanningSession` fired `sendToNarrate` and `sendNtfy` at session start/end. The new `runPlan` omits these entirely. Users with narration configured will see no plan-session notifications. Intentional per task design.
- **`implementationFile` still in `PlanningPromptInput`**: The `PlanningPromptInput` interface retains `implementationFile?` even though `RunPlanOpts` no longer exposes it and `runPlan` never passes it. Dead field — harmless but not cleaned up by this task.
- No broken exports, no removed test coverage for surviving functionality, no circular deps introduced.

### Verdict
CLEAN

---

## Task #2: Guard auto-review feedback read (TDD)
Reviewed: 2026-03-29T22:10:00Z

### Coverage
```
Task Requirements
├── [DONE] Add test: missing-file scenario returns NEEDS_WORK with warning
├── [DONE] Add existsSyncFn to RunAutoReviewOpts deps interface
├── [DONE] Add existence check before readFileSync in runAutoReview()
├── [DONE] Log warning "Reviewer did not produce feedback file; treating as NEEDS_WORK"
├── [DONE] Set lastResult to NEEDS_WORK with explanatory summary
├── [DONE] continue to next pass (or fall through on last iteration)
└── [DONE] Update makeOpts helper to default existsSyncFn to () => true
```

### Files Changed
- `src/commands/plan.ts` — added `existsSyncFn` to `RunAutoReviewOpts` deps, wired `doExistsSync` default, added guard block before `readFileSync`
- `test/commands/plan.test.ts` — added `existsSyncFn: () => true` to `makeOpts`, added new test for missing-file scenario
- `.ralph/tasks.json` — task #2 marked complete; task #1 archived from active list

### Gaps
None detected

### Regression Risks
- `makeOpts` helper updated to pass `existsSyncFn: () => true` — all existing tests now route through the guard without behavioral change. No regressions expected.
- The `continue` on the last iteration exits the loop immediately, so `lastResult` is the NEEDS_WORK sentinel and that value is returned — correct behavior, covered by the new test (`maxIterations: 1`).

### Verdict
CLEAN

---

## Task #7: Verify build and full test suite
Reviewed: 2026-03-30T04:35:00Z

### Coverage
```
Task Requirements
├── [DONE] Run `bun test` — all tests must pass
├── [DONE] Run `bun run build` — must compile without errors
├── [DONE] Run `./dist/ralph plan --help` — smoke test
├── [DONE] Verify commands/generate-tasks.md and commands/review-tasks.md exist
└── [DONE] Fix any issues found (none were found)
```

### Files Changed
- `.ralph/.ralph_iterations.log` — iteration 6 completion + iteration 7 start logged
- `.ralph/tasks.completed.json` — Task #6 archived here
- `.ralph/tasks.json` — Task #6 removed, Task #7 marked complete with notes
- `LOG_imapsync/2026_03_29_22_29_01_423_...txt` — unrelated imapsync log appended (background process, not part of this task)

### Gaps
None detected. This was a verification-only task; no source changes were expected or made. The agent's notes confirm: 591 tests pass, build produces 28 modules cleanly, `plan --help` smoke test passes, and both command markdown files exist.

### Regression Risks
- The imapsync log file change is entirely unrelated to this task — it appears to be a background process writing to a tracked file. No regression risk from this task's actual work.
- No source files were modified, so no regressions are possible from this task's changes.

### Verdict
CLEAN

---
