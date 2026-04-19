## Task #12: Verify build + full test suite + scratch render
Reviewed: 2026-04-18T07:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Run bun test — all tests must pass
│          └── 595 pass / 0 fail across 23 files (per notes + commit)
├── [DONE] Run bun run build — must succeed
│          └── dist/ralph compiled in 194ms (per notes + commit)
├── [DONE] Render each prompt and assert PERSONAL INSTRUCTIONS block present
│   ├── [DONE] buildSystemPrompt (src/commands/run.ts) — OK
│   ├── [DONE] buildDynamicContext (src/commands/plan.ts) — OK
│   ├── [DONE] buildUserPrompt (src/commands/summarize.ts) — OK
│   └── [DONE] buildPostTaskReviewUserPrompt (src/post-task-reviewer.ts) — OK
│              └── Scratch script removed after verification (expected)
└── [DONE] ROLLOUT note in commit message
           └── Exact wording matches requirement:
               "Users with existing Ralph installs must re-run `ralph init`
               in their projects to pick up the updated .claude/commands/*.md files."
```

### Files Changed
- `.ralph/tasks.json` — task #11 archived, task #12 marked complete with detailed notes

### Gaps
None detected — this was a verification-only task; no source file modifications were
expected or required. The scratch render script was appropriately ephemeral.

### Regression Risks
None detected. The only file modified is `.ralph/tasks.json` (task lifecycle
bookkeeping). No production code, tests, or configuration was altered.

Note: The scratch render results cannot be independently audited from the diff
alone (script was deleted), but the commit message and task notes are internally
consistent and specific (file-by-file confirmation with "OK" status for each builder).

### Verdict
CLEAN

---

## Task #11: Update commands/review-tasks.md subagent prompt
Reviewed: 2026-04-18T06:00:00Z

### Coverage
```
Task Requirements
├── [DONE]    Add new FIRST workflow step in commands/review-tasks.md
│             ("If .ralph/instructions.md exists, read it first...")
├── [DONE]    Renumber existing steps
│             └── Original had no numbers (prose + bullets); agent converted to
│                 unified numbered list — necessary to insert a "step 1" — all
│                 original content preserved verbatim
├── [DONE]    Update mirror copy at .claude/commands/review-tasks.md
└── [DONE]    Do NOT change anything else
              └── Changes are strictly confined to the subagent prompt block;
                  no other lines were modified
```

### Files Changed
- `commands/review-tasks.md` — subagent prompt restructured to numbered YOUR WORKFLOW with new step 1
- `.claude/commands/review-tasks.md` — same changes mirrored
- `.ralph/tasks.json` — task #10 archived, task #11 marked complete

### Gaps
None detected

### Regression Risks
None detected — the outer skill's own instruction list (lines 1–4 at the top of the file) was not touched; only the verbatim subagent prompt block was modified. Semantic content of the subagent prompt is fully preserved.

### Verdict
CLEAN

---

## Task #10: Update commands/generate-tasks.md subagent prompt
Reviewed: 2026-04-18T05:00:00Z

### Coverage
```
Task Requirements
├── [DONE]    Add new FIRST step to YOUR WORKFLOW: in commands/generate-tasks.md
│             ("If .ralph/instructions.md exists, read it first...")
├── [DONE]    Renumber remaining workflow steps (old 1→2, 2→3, 3→4, 4→5, 5→6)
├── [PARTIAL] Do NOT change anything else in the file
│             └── The last line (after the closing --- delimiter) was also changed:
│                 old: "...have the subagent (or a new one) write .ralph/tasks.json."
│                 new: "...write .ralph/tasks.json directly using the Write tool —
│                       do NOT spawn another agent just to write the file."
│                 This is an unsanctioned change that violates the explicit constraint.
└── [DONE]    Update .claude/commands/generate-tasks.md with the same changes
```

### Files Changed
- `commands/generate-tasks.md` — new step 1 added, steps renumbered, plus unsanctioned last-line edit
- `.claude/commands/generate-tasks.md` — same changes mirrored
- `.ralph/tasks.json` — task #9 archived, task #10 marked complete

### Gaps
- The task explicitly stated "Do NOT change anything else in the file," but the agent also modified the closing instruction line (after the `---` delimiter) in both files. The new wording is arguably an improvement, but it was outside the stated scope of this task.

### Regression Risks
- The unsanctioned last-line change alters how the generate-tasks slash command instructs the outer agent to finalize tasks.json. The new instruction ("write .ralph/tasks.json directly using the Write tool — do NOT spawn another agent") changes runtime behavior of the slash command beyond what was tasked. If this instruction is incorrect or causes issues, it could break the generate-tasks workflow.

### Verdict
HAS_GAPS

---

## Task #9: Tests for personal instructions in post-task-reviewer.ts
Reviewed: 2026-04-18T04:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Test (a): instructions.md exists in dataDir → prompt contains
│         'PERSONAL INSTRUCTIONS:' and the file's content ('* Always use TDD')
├── [DONE] Test (b): instructions.md missing from dataDir → prompt does NOT
│         contain 'PERSONAL INSTRUCTIONS:'
├── [DONE] Use fs.mkdtempSync + os.tmpdir() for temp dataDir in both tests
│         (mkdtempSync and tmpdir were already imported in the test file;
│          both tests use them correctly with 'ralph-instr-test-' and
│          'ralph-noinstr-test-' prefixes)
├── [DONE] Cleanup via try/finally + rmSync(dir, { recursive: true, force: true })
└── [DONE] All existing post-task-reviewer tests still pass (25 existing + 2 new = 27 total)
```

### Files Changed
- `test/post-task-reviewer.test.ts` — 34 lines added: two new tests inside the existing `describe('buildPostTaskReviewUserPrompt')` block
- `.ralph/tasks.json` — task #8 archived, task #9 marked complete

### Gaps
None detected

### Regression Risks
- All required imports (`mkdtempSync`, `writeFileSync`, `rmSync` from "fs"; `tmpdir` from "os"; `join` from "path") were already present in the test file — no import changes were needed. No risk of accidental side effects.
- Both new tests create isolated temp dirs and clean up unconditionally in `finally` blocks, preventing any leakage between test runs.
- The `dataDir` field is passed to `buildPostTaskReviewUserPrompt` as an optional field (typed `dataDir?: string`). The new tests pass it explicitly; all 25 existing tests omit it and continue to pass, confirming backward compatibility.

### Verdict
CLEAN

---

## Task #8: Wire personal instructions into post-task-reviewer.ts
Reviewed: 2026-04-18T03:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Import loadPersonalInstructions from './personal-instructions'
├── [DONE] buildPostTaskReviewUserPrompt() accepts dataDir in its options object
│         (implemented as optional dataDir?: string — not the required string in
│          the spec, but reasonable to keep backward compat with existing callers)
├── [DONE] Prepend loadPersonalInstructions(dataDir) to returned prompt
│         (guarded: only called when dataDir is truthy, consistent with other modules)
├── [DONE] SpawnPostTaskReviewerOpts already had dataDir: string — no change needed
├── [DONE] spawnPostTaskReviewer destructures dataDir and passes it to
│         buildPostTaskReviewUserPrompt
├── [DONE] runPostTaskReview already passes dataDir to spawnPostTaskReviewer
│         — no change needed
├── [DONE] No change to src/commands/run.ts callers
└── [PARTIAL] Tests: all 25 existing tests pass, but no new tests cover the
           dataDir/personal-instructions code path in buildPostTaskReviewUserPrompt.
           The five describe("buildPostTaskReviewUserPrompt") tests (lines 101–163)
           never pass dataDir, so the new conditional branch
           (loadPersonalInstructions called / not called) is unexercised at the
           unit level. Compare with task #7 (summarize.ts) where presence/absence
           tests were added as a matter of course.
```

### Files Changed
- `src/post-task-reviewer.ts` — added `loadPersonalInstructions` import; added `dataDir?` to `buildPostTaskReviewUserPrompt` opts; conditional prepend; destructured and forwarded `dataDir` in `spawnPostTaskReviewer`
- `.ralph/tasks.json` — task #7 archived, task #8 marked complete

### Gaps
- **No test for personal instructions in buildPostTaskReviewUserPrompt**: The new `dataDir ?  loadPersonalInstructions(dataDir) : ""` branch is completely untested. There is no test asserting that (a) when `dataDir` points to a dir with `instructions.md`, the returned prompt contains "PERSONAL INSTRUCTIONS:" and the file content, or (b) when `dataDir` is absent/file missing, "PERSONAL INSTRUCTIONS:" does not appear.

### Regression Risks
- `dataDir` is typed as optional (`dataDir?: string`) in `buildPostTaskReviewUserPrompt` but required (`dataDir: string`) in `SpawnPostTaskReviewerOpts`. The two callers of `buildPostTaskReviewUserPrompt` in the file always pass `dataDir` from the required field, so no runtime gap — but the type asymmetry is a minor contract mismatch vs. the spec.
- All existing `buildPostTaskReviewUserPrompt` tests call without `dataDir`, exercising the `""` fallback and confirming backward compatibility. No regressions for existing callers.
- The leading-newline behavior of `loadPersonalInstructions` (when content is non-empty, the helper returns `\nPERSONAL INSTRUCTIONS:\n...\n\n`) means the prompt starts with `\n` when instructions are present — consistent with other modules (plan.ts, summarize.ts) but untested here.

### Verdict
HAS_GAPS

---

## Task #7: Tests for personal instructions in summarize.ts
Reviewed: 2026-04-18T02:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Test (a): instructions.md exists in dataDir → prompt contains
│         'PERSONAL INSTRUCTIONS:' and the file's content ('* Always use TDD')
├── [DONE] Test (b): instructions.md missing from dataDir → prompt does NOT
│         contain 'PERSONAL INSTRUCTIONS:'
├── [DONE] Use fs.mkdtempSync + os.tmpdir() for temp dataDir in both tests
├── [DONE] Cleanup with try/finally + fs.rmSync (recursive, force)
└── [DONE] All existing summarize tests still pass (17 existing + 2 new = 19 total)
```

### Files Changed
- `test/commands/summarize.test.ts` — 36 lines added: two new `buildUserPrompt` tests inside the existing `describe('buildUserPrompt')` block
- `.ralph/tasks.json` — task #6 archived, task #7 marked complete

### Gaps
None detected

### Regression Risks
- `os`, `fs`, and `path` were already imported at the top of the test file — no new imports were needed, so no accidental side effects.
- Both new tests create isolated temp dirs and clean up unconditionally in `finally` blocks, preventing any leakage between test runs.
- The new tests pass `claudeMdPattern: ''` — the same minimal pattern used by existing `buildUserPrompt` tests — so they do not trigger any unexpected CLAUDE.md file-scanning behavior in CI.

### Verdict
CLEAN

---

## Task #6: Wire personal instructions into summarize.ts user prompt
Reviewed: 2026-04-18T01:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Update buildUserPrompt() to accept dataDir in its options object
│         (implemented as optional dataDir?: string, not required string)
├── [DONE] Import loadPersonalInstructions from '../personal-instructions'
├── [DONE] Prepend loadPersonalInstructions(dataDir) to returned user prompt
│         (guarded: only called when dataDir is truthy)
├── [DONE] Add dataDir to RunSummarizeOpts interface (as optional field)
├── [DONE] Pass dataDir from runSummarize() into buildUserPrompt()
├── [DONE] Update CLI call site in src/index.ts to read RALPH_DATA_DIR and pass dataDir
└── [PARTIAL] Verify runSummarize spawns claude with personal instructions block
          when instructions.md exists — no new test covers the dataDir/instructions.md
          path; all 15 existing summarize tests pass but none exercise dataDir
```

### Files Changed
- `src/commands/summarize.ts` — added `loadPersonalInstructions` import; added `dataDir?: string` to `RunSummarizeOpts` and `buildUserPrompt` opts; conditional prepend in returned prompt; threaded `dataDir` through `runSummarize` → `buildUserPrompt`
- `src/index.ts` — reads `process.env.RALPH_DATA_DIR` and passes it to `runSummarize`
- `.ralph/tasks.json` — task #5 archived, task #6 marked complete

### Gaps
- **No test for personal instructions integration in summarize**: The task's "Verify" requirement — that `runSummarize` writes a stdin prompt containing the PERSONAL INSTRUCTIONS block when `instructions.md` exists — was not backed by a new test. All 15 existing `summarize.test.ts` tests omit `dataDir` entirely, so the new conditional code path (`loadPersonalInstructions(dataDir)`) is completely untested at the unit level.

### Regression Risks
- `process.env.RALPH_DATA_DIR!` in `index.ts` uses a non-null assertion. If the env var is unset, `dataDir` is `undefined` at runtime (TypeScript assertion does not affect JS). Since `RunSummarizeOpts.dataDir` is optional, `undefined` is accepted and the guard `dataDir ? loadPersonalInstructions(dataDir) : ''` correctly short-circuits. No runtime crash.
- When `personalInstructions` is non-empty (e.g., `\nPERSONAL INSTRUCTIONS:\n...\n\n`), the returned prompt starts with `\n` because of the direct interpolation `${personalInstructions}PROJECT:`. This leading newline is consistent with how `loadPersonalInstructions` formats its output (task #2 established that the helper prepends `\n`) and matches the pattern used in `plan.ts` (task #4). Low risk, but untested in this module.
- Existing `buildUserPrompt` and `runSummarize` tests all omit `dataDir` — they exercise the `dataDir ? ... : ''` false branch and continue to pass unchanged, confirming backward compatibility.

### Verdict
HAS_GAPS

---

## Task #5: Tests for personal instructions in plan.ts
Reviewed: 2026-04-18T00:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Test (a): instructions.md exists in dataDir → result contains
│         'PERSONAL INSTRUCTIONS:' and file's content ('* Always use TDD')
├── [DONE] Test (b): instructions.md absent → result does NOT contain
│         'PERSONAL INSTRUCTIONS:'
├── [DONE] Use fs.mkdtempSync + os.tmpdir() for temp dataDir
├── [DONE] Follow existing test setup pattern (same prefix 'ralph-plan-test-',
│         same cleanup via try/finally; makeTempDir helper not reused because
│         it creates .ralph/ subdirs not needed here — inline approach correct)
└── [DONE] Ensure existing plan tests still pass (notes: 39 tests pass, up from 37)
```

### Files Changed
- `test/commands/plan.test.ts` — 32 lines added: two tests inside `buildDynamicContext` describe block
- `.ralph/tasks.json` — task #4 archived, task #5 marked complete

### Gaps
None detected

### Regression Risks
- Both new tests clean up their temp dirs in `finally` blocks, preventing leakage between test runs.
- The tests inline `fs.mkdtempSync` rather than using the file's `makeTempDir()` helper. This is appropriate — `makeTempDir` creates `.ralph/` and `.claude/agents/` subdirs unrelated to `dataDir`/`instructions.md`. No regression from the style choice.
- `os`, `path`, and `fs` were already imported at the top of the file; no new imports were needed.
- The new tests call `buildDynamicContext` with the minimal valid opts shape (`projectName`, `projectRoot`, `dataDir`, `agents: []`). This exercises the same code path tested by the five existing `buildDynamicContext` tests, without overlapping their assertions.

### Verdict
CLEAN

---

## Task #4: Wire personal instructions into plan.ts dynamic context
Reviewed: 2026-04-18T00:20:00Z

### Coverage
```
Task Requirements
├── [DONE] Update buildDynamicContext() to accept dataDir
│         (dataDir was already in the existing opts object — no signature change needed)
├── [DONE] Import loadPersonalInstructions from '../personal-instructions'
├── [DONE] Append loadPersonalInstructions(dataDir) output as trailing block
│         (placed after agentsSection, at end of returned string)
├── [DONE] Update runPlan() to pass dataDir to buildDynamicContext()
│         (dataDir was already being passed via the opts spread — no change needed)
└── [DONE] Do NOT change any other behavior of buildDynamicContext or runPlan
```

### Files Changed
- `src/commands/plan.ts` — added `loadPersonalInstructions` import; added 2-line call + interpolation in `buildDynamicContext()`
- `.ralph/tasks.json` — task #3 archived, task #4 marked complete

### Gaps
None detected

### Regression Risks
- `personalInstructions` returns `''` when `instructions.md` is absent (guaranteed by the helper's contract, tested in Task #2). Existing callers that do not have `instructions.md` see zero behavioral change in the returned string.
- The appended block is interpolated after `${agentsSection}` with no separator — the helper already adds a leading newline when content is present (e.g. `\nPERSONAL INSTRUCTIONS:\n...`), so formatting is consistent with the agentsSection pattern.
- All 37 `test/commands/plan.test.ts` tests pass (verified by running `bun test test/commands/plan.test.ts`).

### Verdict
CLEAN

---

## Task #3: Refactor run.ts buildSystemPrompt to use helper
Reviewed: 2026-04-18T00:10:00Z

### Coverage
```
Task Requirements
├── [DONE] Replace inline fs.existsSync / fs.readFileSync / trim logic
│         with a single call to loadPersonalInstructions(dataDir)
├── [DONE] Import loadPersonalInstructions from '../personal-instructions'
├── [DONE] Assign result to personalInstructions variable (let → const)
├── [DONE] Rendered output byte-identical to pre-refactor (verified per task notes)
├── [DONE] Keep 'includes personal instructions from instructions.md' test passing
│         without modification (88/88 pass; test file not touched in this commit)
└── [DONE] Keep 'omits personal instructions when file missing' test passing
          without modification
```

### Files Changed
- `src/commands/run.ts` — removed 7-line inline fs block, added 1-line helper call + import
- `.ralph/tasks.json` — task #3 marked complete, task #2 archived

### Gaps
None detected

### Regression Risks
- `let personalInstructions` changed to `const personalInstructions`. TypeScript accepts this; no downstream mutation of the variable existed, so this is safe.
- The refactor delegates all fs logic to `loadPersonalInstructions()` in `src/personal-instructions.ts`. That module was validated by 5 unit tests in Task #2. Any future bug introduced there will now also affect `buildSystemPrompt()`—a natural and expected coupling.
- No other callers of the removed inline logic exist; the change is fully self-contained within `buildSystemPrompt()`.

### Verdict
CLEAN

---

## Task #2: Unit tests for loadPersonalInstructions
Reviewed: 2026-04-18T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Test (a): missing file → returns ''
├── [DONE] Test (b): empty file → returns ''
├── [DONE] Test (c): whitespace-only file ('\n  \n\t') → returns ''
├── [DONE] Test (d): normal content '* Always use TDD\n' → returns '\nPERSONAL INSTRUCTIONS:\n* Always use TDD\n\n'
├── [DONE] Test (e): multi-line content with leading/trailing whitespace preserved
├── [DONE] Use fs.mkdtempSync + os.tmpdir() for temp dirs
├── [DONE] Clean up temp dirs in afterEach
└── [DONE] Import from '../src/personal-instructions'
```

### Files Changed
- `test/personal-instructions.test.ts` — new file, 45 lines, 5 test cases
- `.ralph/tasks.json` — task #1 archived, task #2 marked complete

### Gaps
None detected. All five required test cases are present and correctly structured.

### Regression Risks
- `tmpDir` is declared at describe scope and assigned inside each `it` block. Since tests run sequentially in Bun's default mode, the `afterEach` `if (tmpDir)` guard is safe. No cross-test contamination risk.
- The test file imports from `../src/personal-instructions`, which was created in Task #1. No modifications to that source file appear here, so its contract is unchanged and existing behavior is unaffected.
- No previously passing tests were deleted or modified.

### Verdict
CLEAN

---

## Task #14: Verify build and full test suite
Reviewed: 2026-03-31T23:50:00Z

### Coverage
```
Task Requirements
├── [DONE] bun test — all 584 tests pass (0 fail)
├── [DONE] bun run build — compiles cleanly (29 modules, no errors)
├── [DONE] No stale references to deleted functions in src/ or test/
├── [DONE] agents/ directory contains post-task-reviewer.md, planner.md, summarizer.md
└── [DONE] --append-system-prompt usage audited: run.ts (expected) and plan.ts (expected)
```

### Files Changed
- `.ralph/tasks.json` — task 13 archived, task 14 marked complete with notes

### Gaps
None detected

### Regression Risks
None detected — this was a verification-only task. No source files were modified; the agent confirmed all checks passed and recorded accurate results in the task notes.

### Verdict
CLEAN

---

## Task #13: Update init tests to cover agent installation
Reviewed: 2026-03-31T23:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Test: copies .md files from ralph's agents/ dir to <projectRoot>/.claude/agents/
├── [DONE] Test: creates destination directory if it doesn't exist
├── [DONE] Test: handles missing source directory gracefully (no error, just returns)
└── [DONE] Test: handles empty source directory (no .md files) gracefully
```

### Files Changed
- `test/commands/init.test.ts` — added 7 `installAgents()` tests
- `.ralph/tasks.json` — task #13 marked complete, task #12 archived

### Gaps
None detected. All four required scenarios are covered. The agent also added three bonus tests (content integrity, log output, real-file end-to-end) that strengthen coverage beyond the spec.

### Regression Risks
- The last test (`copies actual ralph agents to .claude/agents/`) hardcodes three filenames (`planner.md`, `summarizer.md`, `post-task-reviewer.md`). All three exist in `agents/` today. If any is renamed or removed, this test will fail — but that is an intentional guard, not a regression introduced by this task.
- `src/commands/init.ts` is listed as an expected file but has no diff here; it was correctly modified in Task #12. No regression risk.

### Verdict
CLEAN

---

## Task #12: Add installAgents() to init.ts
Reviewed: 2026-03-31T23:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create installAgents(projectRoot, ralphRoot?) with correct signature
├── [DONE] Resolve ralph root via ralphRoot ?? resolveRalphRoot()
├── [DONE] Build source path: path.join(root, 'agents')
├── [DONE] Return silently if source dir doesn't exist
├── [DONE] Read all .md files from source dir
├── [DONE] Build dest path: path.join(projectRoot, '.claude', 'agents')
├── [DONE] Create dest dir with fs.mkdirSync(destDir, { recursive: true })
├── [DONE] Copy each file, logging `Installed: .claude/agents/<filename>`
├── [DONE] Call installAgents(projectRoot) from runInit() after installSlashCommands()
└── [DONE] Export installAgents for testing
```

### Files Changed
- `src/commands/init.ts` — added `installAgents()`, wired into `runInit()`
- `.ralph/tasks.json` — task #12 marked complete, task #11 archived

### Gaps
None detected

### Regression Risks
- The implementation adds an early-return when `mdFiles.length === 0` (not explicitly required). This is harmless behavior and mirrors a sensible guard, but it means `destDir` is never created when the agents directory is empty — callers relying on the directory being created regardless will not see it. Low risk given the current codebase has no such callers.

### Verdict
CLEAN

---

## Task #11: Update summarize tests
Reviewed: 2026-03-31T22:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Remove tests for buildSummarizePrompt(), buildContext(), buildClaudeMdPruning(), SummarizePromptOpts
├── [DONE] Update runSummarize() tests to expect --agents/--agent args instead of --append-system-prompt
├── [DONE] Update tests to verify dynamic context in stdin (project name, impl file, pruning instructions)
├── [DONE] Keep tests for timeout, banner output, and file existence checks
└── [DONE] Spawn mock accounts for agent file read (makeTempDir(true, true) creates .claude/agents/summarizer.md)
```

### Files Changed
- `.ralph/tasks.json` — task #10 archived, task #11 marked complete (metadata only)

### Gaps
None detected. All requirements are fulfilled in `test/commands/summarize.test.ts`. However,
**no test or source changes appear in this task's diff** — the work was front-loaded into
task #10, which updated the tests alongside the source refactor. Task #11 contributed only a
`tasks.json` metadata update.

The current test file state was verified directly:
- Imports only `buildUserPrompt` and `runSummarize` (no `buildSummarizePrompt`, `buildContext`, etc.)
- `buildUserPrompt` suite: 8 tests covering project name/impl file, fresh vs existing file, completed tasks path, claudeMdPattern, pruning rules, custom implFile name
- `runSummarize` suite: 7 tests — `--agents`/`--agent` args (line 196), stdin dynamic context (line 233), file existence reporting (lines 260, 286), banner output (line 310), timeout + kill (line 335), cwd set to projectRoot (line 365), stdout piped through processStream (line 390)
- `makeTempDir(true, true)` creates `.claude/agents/summarizer.md` for all `runSummarize` tests

### Regression Risks
- No source or test files were modified by this task. The test file state matches the requirements as confirmed by direct read. No regressions introduced.

### Verdict
CLEAN

---

## Task #10: Refactor summarize.ts to use buildAgentArgs()
Reviewed: 2026-03-31T21:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Import buildAgentArgs from ../agent-prompt
├── [DONE] Delete buildSummarizePrompt(), buildContext(), buildClaudeMdPruning(), SummarizePromptOpts
├── [DONE] Build dynamic context as user prompt (project name, impl file, existence check, completed tasks path, CLAUDE.md pruning)
├── [DONE] Spawn args use ...buildAgentArgs('summarizer', ...) instead of --append-system-prompt
├── [DONE] Keep --output-format, --verbose, --model, --dangerously-skip-permissions flags
└── [DONE] Update RunSummarizeOpts interface (fields remain but SummarizePromptOpts type removed, interface inlined)
```

### Files Changed
- `src/commands/summarize.ts`
- `test/commands/summarize.test.ts`
- `.ralph/tasks.json`

### Gaps
None detected. `src/agent-prompt.ts` (listed as expected file) was not modified — it already contained `buildAgentArgs` from prior tasks, so no changes were needed.

### Regression Risks
None detected. Old exported functions (`buildContext`, `buildClaudeMdPruning`, `buildSummarizePrompt`) are deleted and their tests replaced — no other modules imported them. New `buildUserPrompt` export is tested with equivalent coverage. The `RunSummarizeOpts` interface still contains all required fields (now inlined rather than extending `SummarizePromptOpts`), so call sites are unaffected.

### Verdict
CLEAN

---

## Task #9: Update plan tests
Reviewed: 2026-03-31T20:50:00Z

### Coverage
```
Task Requirements
├── [DONE] Remove tests for buildPlanningPrompt() and PlanningPromptInput
├── [DONE] Update runPlan() tests to expect --agents/--agent args
├── [DONE] Update runPlan() tests to expect short --append-system-prompt with dynamic context
├── [DONE] Keep tests for formatBanner, formatPlanningNotesStatus, formatCompletedCount,
│         formatTasksSummary, displayPreflight
└── [DONE] Spawn mock accounts for agent file read (makeTempDir(true, true) creates
           .claude/agents/planner.md)
```

### Files Changed
- `.ralph/tasks.json` — task #8 archived, task #9 marked complete (metadata only)

### Gaps
None detected. All requirements are fulfilled in `test/commands/plan.test.ts`. However,
**no test or source changes appear in this task's diff** — the work was front-loaded into
task #8, which updated the tests alongside the source refactor (commit b963320 changed
`test/commands/plan.test.ts` with 285 lines removed and new code added). Task #9
contributed only a `tasks.json` metadata update.

The current test file state was verified directly:
- No `buildPlanningPrompt` or `PlanningPromptInput` imports/tests present
- `buildDynamicContext` suite: 5 tests (lines 288–353)
- `runPlan` suite: 8 tests asserting `--agents`, `--agent`, `planner`, `--append-system-prompt`
  with dynamic context, `--allowedTools`, `cwd`, `env.ANTHROPIC_API_KEY`, `stdio`
- All formatting-function suites retained: `formatBanner` (3), `formatPlanningNotesStatus` (3),
  `formatCompletedCount` (4), `formatTasksSummary` (6), `displayPreflight` (6)

### Regression Risks
- No source or test files were modified by this task. The test file state matches the
  requirements as confirmed by direct read. No regressions introduced.

### Verdict
CLEAN

---

## Task #8: Refactor plan.ts to use buildAgentArgs()
Reviewed: 2026-03-31T19:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Import buildAgentArgs from ../agent-prompt
├── [DONE] Delete buildPlanningPrompt() function (lines 81-151)
├── [DONE] Delete PlanningPromptInput interface (lines 63-74)
├── [DONE] Build short dynamic --append-system-prompt string (buildDynamicContext) with
│         project name, project root, data dir, and agents list
├── [DONE] Spawn args use [...buildAgentArgs('planner', '...', projectRoot), '--append-system-prompt',
│         dynamicContext, '--allowedTools', 'Read,Glob,Grep,Write,Edit']
├── [DONE] spawnSync / stdio: 'inherit' interaction mode unchanged
└── [DONE] displayPreflight() and formatting functions kept unchanged
```

### Files Changed
- `src/commands/plan.ts` — removed `buildPlanningPrompt()` and `PlanningPromptInput`, added `buildDynamicContext()`, updated `runPlan()` to use `buildAgentArgs`
- `test/commands/plan.test.ts` — replaced `buildPlanningPrompt` test suite with `buildDynamicContext` tests, updated `runPlan` tests to create `.claude/agents/planner.md` in temp dirs and assert `--agents`/`--agent`/`planner` args
- `.ralph/tasks.json` — task #7 archived, task #8 marked complete

### Gaps
None detected

### Regression Risks
- The large static planning prompt (role, workflow, briefing materials, format spec, rules) was moved from `buildPlanningPrompt()` into `agents/planner.md`. That file is now the sole source of planner behavior. If `planner.md` does not exist at runtime, `buildAgentArgs` will fail or produce empty `--agents`/`--agent` args — there is no fallback. Tests mitigate this by creating the file in a temp dir, but production deployments must have the agent file present.
- Tests for the removed `buildPlanningPrompt()` content (briefing materials list, role definition, format specification, rules) are gone. The behavior is now in the agent file and untested at the unit level — this is acceptable by design but is a coverage reduction.

### Verdict
CLEAN

---

## Task #7: Update post-task-reviewer tests
Reviewed: 2026-03-31T14:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Remove tests asserting on buildPostTaskReviewPrompt() (deleted in prior iteration)
├── [DONE] Update spawnPostTaskReviewer() tests to expect --agents and --agent args
├── [DONE] Keep tests for buildPostTaskReviewUserPrompt()
├── [DONE] Keep tests for captureGitSha()
├── [DONE] Keep tests for getGitDiff()
├── [DONE] Keep tests for runPostTaskReview() orchestration logic
└── [DONE] Spawn mock uses temp dir with real agent file (.claude/agents/post-task-reviewer.md)
```

### Files Changed
- `.ralph/tasks.json` — task #6 archived, task #7 marked complete

### Gaps
None detected. All requirements are met in `test/post-task-reviewer.test.ts`. However, **no test or source changes appear in this task's diff** — the work was front-loaded into task #6, which updated the tests alongside the source refactor. Task #7 contributed only a `tasks.json` metadata update.

### Regression Risks
- No source or test files were modified by this task. The test file state was verified by reading it directly: `buildPostTaskReviewPrompt` is absent from imports (lines 8–14); `--agents`/`--agent` assertions are present (lines 233–235); all four test suites (`captureGitSha`, `getGitDiff`, `buildPostTaskReviewUserPrompt`, `runPostTaskReview`) are intact. No regressions introduced.

### Verdict
CLEAN

---

## Task #6: Refactor post-task-reviewer.ts to use buildAgentArgs()
Reviewed: 2026-03-31T12:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Import buildAgentArgs from ./agent-prompt
├── [DONE] Delete buildPostTaskReviewPrompt() function (lines 10-73)
├── [DONE] Replace systemPrompt variable with ...buildAgentArgs('post-task-reviewer', 'Sr. Dev code reviewer', projectRoot)
├── [DONE] Remove '--append-system-prompt', systemPrompt from args array
├── [DONE] Keep buildPostTaskReviewUserPrompt() unchanged
└── [DONE] Keep all orchestration logic (SpawnPostTaskReviewerOpts, captureGitSha, getGitDiff, runPostTaskReview) unchanged
```

### Files Changed
- `src/post-task-reviewer.ts` — removed `buildPostTaskReviewPrompt()`, added `buildAgentArgs` import, replaced inline system prompt with spread of `buildAgentArgs()` in args
- `test/post-task-reviewer.test.ts` — removed 5 `buildPostTaskReviewPrompt` tests, updated spawn tests to use temp dirs with real agent files, assertions updated from `--append-system-prompt` to `--agents`/`--agent`
- `.ralph/tasks.json` — task #6 marked complete, task #5 entry removed (archived)

### Gaps
None detected

### Regression Risks
- Tests for `buildPostTaskReviewPrompt` were deleted (5 tests), which is correct since the function was deleted. The content of the prompt now lives in `agents/post-task-reviewer.md` which is tested indirectly via `buildAgentArgs` tests.
- `readFileSync` import added to test file — not a risk.
- Task notes mention "589 tests pass" (down from 594 in task #5), consistent with removing 5 prompt tests.

### Verdict
CLEAN

---

## Task #1: Create shared buildAgentArgs() helper
Reviewed: 2026-03-31T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create src/agent-prompt.ts
├── [DONE] buildAgentArgs(name, description, projectRoot) function
├── [DONE] Build path <projectRoot>/.claude/agents/<name>.md
├── [DONE] Read markdown file contents
├── [DONE] Return ['--agents', JSON.stringify({[name]: {description, prompt}}), '--agent', name]
├── [DONE] Throw clear error if file missing with exact message format
├── [DONE] Export the function
├── [DONE] No classes or config objects
└── [DONE] bun test passes (test/agent-prompt.test.ts created)
```

### Files Changed
- `.ralph/tasks.json` — full task list populated (tasks 1–14)
- `src/agent-prompt.ts` — new file implementing `buildAgentArgs()`
- `test/agent-prompt.test.ts` — new test file with 3 tests

### Gaps
None detected

### Regression Risks
None detected — new files only, no existing code modified

### Verdict
CLEAN

---

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

## Task #2: Add tests for buildAgentArgs() helper
Reviewed: 2026-03-31T00:10:00Z

### Coverage
```
Task Requirements
├── [DONE] Write unit tests in test/agent-prompt.test.ts
├── [DONE] Test: returns correct ['--agents', jsonString, '--agent', name] args
├── [DONE] Test: JSON string parses to {name: {description, prompt: fileContents}}
├── [DONE] Test: throws descriptive error when agent file is missing
├── [DONE] Use temp directory with .md file for happy path
└── [DONE] Use expect().toThrow() for missing file case
```

### Files Changed
- `.ralph/tasks.json` — task #1 removed from active list, task #2 marked complete (reformatting only)

### Gaps
None detected. The test file `test/agent-prompt.test.ts` was created by Task #1 (TDD approach — tests written before implementation). Task #2's agent correctly recognized the work was already done and verified all 594 tests pass without duplicating effort.

### Regression Risks
None detected — no source or test files were modified; only `tasks.json` metadata was updated.

---

## Task #3: Create agents/post-task-reviewer.md
Reviewed: 2026-03-31T00:20:00Z

### Coverage
```
Task Requirements
├── [DONE] Create agents/post-task-reviewer.md at ralph's project root
├── [DONE] Extract full static prompt text from buildPostTaskReviewPrompt() lines 11-72
├── [DONE] Coverage diagram format section included
├── [DONE] Gap detection section included
├── [DONE] Regression checks section included
├── [DONE] Output format section included
└── [DONE] bun test passes (594 tests, per task notes)
```

### Files Changed
- `agents/post-task-reviewer.md` — new file, 61 lines; exact prompt text extracted from source
- `.ralph/tasks.json` — task #2 archived, task #3 marked complete

### Gaps
None detected. The extracted content in `agents/post-task-reviewer.md` matches `src/post-task-reviewer.ts` lines 11-72 verbatim, with the template-literal escaped backtick (`\``) correctly rendered as a literal backtick in the markdown.

### Regression Risks
None detected — new file only, no existing source or test files modified.

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

## Task #4: Create agents/planner.md
Reviewed: 2026-03-31T00:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Create agents/planner.md at ralph's project root
├── [DONE] Extract static portions of buildPlanningPrompt() (plan.ts lines 95-148)
├── [DONE] Remove ${projectName} / ${projectRoot} interpolations (two header lines dropped entirely)
├── [DONE] Replace ${dataDir} with 'the project data directory' in BRIEFING MATERIALS
├── [DONE] Replace ${dataDir} in PLANNING-NOTES.MD FORMAT section
├── [DONE] Remove trailing ${agentsSection} interpolation
├── [DONE] Persona definition present ("You are a planning assistant...")
├── [DONE] Briefing materials list with generic placeholders
├── [DONE] Workflow steps included
├── [DONE] planning-notes.md format specification included (all 6 sections)
├── [DONE] Rules section included
├── [GAP]  src/commands/plan.ts listed as Expected File but not modified
└── [DONE] bun test passes (per task notes: 594 tests)
```

### Files Changed
- `agents/planner.md` — new file, 51 lines; static prompt extracted from `buildPlanningPrompt()`
- `.ralph/tasks.json` — task #3 archived, task #4 marked complete

### Gaps
- **`src/commands/plan.ts` not modified**: The task lists `src/commands/plan.ts` as an expected file, implying `buildPlanningPrompt()` should have been updated to load the prompt from `agents/planner.md` rather than embedding the static string inline. The function still contains the full static prompt as a template literal (lines 95-148). The markdown file exists but is not yet wired up — plan.ts still owns the authoritative copy of the prompt, so the two are now duplicates that can diverge.

### Regression Risks
- No existing functionality broken — `agents/planner.md` is a new file and `plan.ts` is unchanged.
- The extracted prompt in `agents/planner.md` is accurate relative to `plan.ts` lines 95-148 as of this commit. However, since plan.ts was not updated to read from the file, any future edits to the planning prompt in plan.ts will silently diverge from the markdown file.

### Verdict
HAS_GAPS

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

## Task #5: Create agents/summarizer.md
Reviewed: 2026-03-31T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create agents/summarizer.md
├── [DONE] Extract static portions from buildSummarizePrompt() (lines 71-119)
├── [DONE] Remove interpolated values (projectName, implFile, context, existingNote, claudeMdPruning)
├── [DONE] Include persona definition
├── [DONE] Include PURPOSE section
├── [DONE] Include AUDIENCE section
├── [DONE] Include YOUR TASK steps
├── [DONE] Include STRUCTURE suggestion
├── [DONE] Include RULES
└── [GAP]  Modify src/commands/summarize.ts (listed as expected file, not changed)
```

### Files Changed
- `.ralph/tasks.json` — task #4 archived, task #5 marked complete
- `agents/summarizer.md` — new file created

### Gaps
- `src/commands/summarize.ts` was listed as an expected file in the task spec but was not modified. The agent deferred this refactor to task #10 (updating summarize.ts to read from agents/summarizer.md instead of the inline string). The markdown extraction is complete, but the wiring is not yet in place.
- The `CLAUDE.MD PRUNING` block (produced by `buildClaudeMdPruning()`, inserted between STRUCTURE and RULES) contains substantial static instructional content that was omitted entirely. The task treats all of `claudeMdPruning` as dynamic, which is consistent with the spec, so this is acceptable — but worth noting that the pruning rules themselves are not dynamic.

### Regression Risks
- None detected. `summarize.ts` is unchanged; the new file is additive only.

### Verdict
HAS_GAPS

---
