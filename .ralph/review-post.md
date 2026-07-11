## Task #22: Update README and CLAUDE.md for the monotonic ID system
Reviewed: 2026-06-08T19:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Add .ralph/state.json to per-project data layout in CLAUDE.md
│           with { "nextTaskId": N } format description
├── [DONE] Add never-reused-id guarantee and lazy-seeding behavior
├── [DONE] Add `ralph task next-id [--count <n>]` to agent-workflow command list in CLAUDE.md
├── [DONE] Note that state.json is committed to git (not gitignored)
└── [DONE] Add state.json entry to README.md per-project data tree
```

### Files Changed
- `CLAUDE.md` — state.json added to data layout tree; next-id command added to command list; ID guarantee paragraph added
- `README.md` — state.json added to per-project data tree
- `.ralph/.ralph_task_22_notes.md` — task notes file (housekeeping)

### Gaps
None detected. All four documented requirements were addressed:
1. state.json in CLAUDE.md directory tree with `{ "nextTaskId": N }` and "committed to git" note
2. Lazy-seeding behavior and never-reused guarantee in the new paragraph
3. `ralph task next-id [--count <n>]` added to the command list
4. README.md entry includes "never reuses IDs (committed to git)"

### Regression Risks
None detected — documentation-only change; no source code or tests modified.

### Verdict
CLEAN

---

## Task #21: Rewrite the ID rule in commands/generate-tasks.md
Reviewed: 2026-06-08T19:12:00Z

### Coverage
```
Task Requirements
├── [DONE] Edit SOURCE commands/generate-tasks.md (repo root, not installed copy)
├── [DONE] Find and remove the "continue from the highest existing ID" rule (~line 149)
├── [DONE] New rule: run `ralph task next-id --count <n>` after user approves
├── [DONE] Never reuse archived IDs (explicitly stated in new text)
├── [DONE] Preserve already-complete tasks' IDs and all metadata unchanged
├── [DONE] Match output format from task 18 (one integer per line, referenced in both locations)
└── [DONE] Keep the rest of the prompt intact
```

### Files Changed
- `commands/generate-tasks.md` — two targeted edits: RULES section (line 149) and "After receiving" paragraph (line 159)
- `.ralph/tasks.json` — task 21 marked complete, task 20 archived
- `.ralph/.ralph_task_21_notes.md` — new notes file

### Gaps
None detected.

### Regression Risks
One minor ambiguity worth noting: the new text in the RULES section (which is part of the *subagent's* prompt) now says "run `ralph task next-id --count <n>`", but the subagent's role is to *propose* tasks, not to assign IDs — ID assignment is the parent agent's job after approval. The phrasing "only after user approval" within the subagent's RULES does signal the intent correctly, and the "After receiving" paragraph (which the parent agent reads) contains the actual step-by-step instruction. In practice the parent agent will follow the "After receiving" paragraph, so execution should be correct. The RULES entry is slightly misleadingly placed but not harmful. No existing functionality is affected — this is a prompt-only change.

### Verdict
CLEAN

---

## Task #20: ralph init seeds state.json
Reviewed: 2026-06-08T19:10:00Z

### Coverage
```
Task Requirements
├── [DONE] Create state.json in initCoreFiles if it does not already exist
├── [DONE] Write { nextTaskId: N } — 1 for fresh project, max+1 for re-init
├── [DONE] Reuse seedNextId from src/task-counter.ts (no duplication)
├── [DONE] state.json NOT added to GITIGNORE_CONTENT
├── [DONE] Print 'Created: .ralph/state.json' or 'state.json already exists.' matching surrounding style
├── [DONE] TDD: fresh init → { nextTaskId: 1 }
├── [DONE] TDD: re-init with archive max id 15 → { nextTaskId: 16 }
└── [DONE] TDD: existing state.json left untouched (5 tests added total)
```

### Files Changed
- `src/commands/init.ts` — imported `seedNextId`; added state.json block at end of `initCoreFiles`
- `test/commands/init.test.ts` — 5 new tests inside `initCoreFiles` describe block
- `.ralph/.ralph_task_20_notes.md` — agent notes (expected)
- `.ralph/tasks.completed.json` / `.ralph/tasks.json` — lifecycle bookkeeping (expected)

### Gaps
None detected.

### Regression Risks
None detected. The change is purely additive — a new block appended at the end of `initCoreFiles` with no modifications to existing logic. `GITIGNORE_CONTENT` is unchanged; `state.json` is correctly left unignored. `seedNextId` was already exported and tested in task #17; no new surface area introduced there. Full suite: 715 pass, 0 fail.

### Verdict
CLEAN

---

## Task #19: Auto-assign id in ralph task add
Reviewed: 2026-06-08T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Call reserveTaskIds(dataDir, 1) inside taskAdd
├── [DONE] Inject assignedId into payload before AJV validation
│   ├── [DONE] Overwrite any agent-supplied id unconditionally
│   └── [DONE] No schema relaxation needed (id present before validate)
├── [DONE] Print 'assigned id: <n>' to stdout on success
├── [DONE] Reserve id once before mutate callback (retry-safe)
├── [DONE] Update run.ts DISCOVER AND DOCUMENT executor prompt
│   ├── [DONE] Drop `id` from 'New tasks need at minimum' list
│   └── [DONE] Add note: CLI assigns and prints the id
└── [DONE] TDD — tests written first, three cases
    ├── [DONE] (8d) payload with no id → reserved id assigned + appended
    ├── [DONE] (8e) payload with supplied id → overwritten by reserved id
    └── [DONE] (8f) assigned id printed to stdout
```

### Files Changed
- `src/commands/task.ts` — id reservation, injection, stdout output, `dataDir` required, `stdout` injectable
- `src/commands/run.ts` — executor prompt DISCOVER AND DOCUMENT block updated
- `test/commands/task.test.ts` — three new tests (8d, 8e, 8f)
- `.ralph/.ralph_task_19_notes.md` — implementation notes (non-source)

### Gaps
None detected.

### Regression Risks
- `TaskAddOpts.dataDir` changed from optional (`string?`) to required (`string`). The one CLI call site at `src/commands/task.ts:407–411` already passes `dataDir: dataDir()`, and `bun run build` succeeds — so no live breakage. Any hypothetical external consumer of this interface would hit a compile error, but this is a project-internal type.
- Tests (8d) and (8e) do not pass a `stdout` override, so `assigned id: 3` leaks to the real console during `bun test` runs (visible as three stray lines in test output). Harmless but mildly noisy; a future cleanup could add `stdout` capture to those two tests as well.
- When `reserveTaskIds` succeeds but AJV validation subsequently fails, the reserved id is consumed without being used. The task notes this as intentional and ids are non-contiguous-tolerant, so no functional impact.

### Verdict
CLEAN

---

## Task #9: Task-id-labeled stream output
Reviewed: 2026-05-31T23:38:00Z

### Coverage
```
Task Requirements
├── [DONE] Add taskId?: number to ProcessStreamOptions (~line 163)
│         (added at line 168, immediately after taskContext?)
├── [DONE] Prefix each emitted output line with [#<id>] when taskId is set
│   ├── [DONE] writeLine helper: prefix = options?.taskId != null ? `[#${options.taskId}] ` : ''
│   ├── [DONE] Non-JSON passthrough: writeLine(line + '\n')
│   ├── [DONE] system/init event: writeLine(`  ${DIM}[init]...`)
│   ├── [DONE] assistant/tool_use: writeLine(`  > ${fmtTool(block)}\n`)
│   ├── [DONE] assistant/text (truncated): writeLine(`  ${YELLOW}${firstLine}${RESET}\n`)
│   ├── [DONE] assistant/text (multi-line, each tline): writeLine(`  ${YELLOW}${tline}${RESET}\n`)
│   └── [DONE] result event: writeLine(`  ${fmtResult(e)}\n`)
├── [DONE] When taskId unset, output byte-for-byte unchanged (serial mode no-regression)
│         (prefix = '' when taskId is null/undefined; writeLine ≡ output.write)
└── [DONE] TDD: failing tests written first, then implementation
    ├── [DONE] Test: prefixes every output line with [#<id>] when taskId is provided
    │         (covers init, tool_use, result events; asserts every line matches /^\[#5\] /)
    └── [DONE] Test: does not prefix lines when taskId is omitted — byte-for-byte unchanged
              (compares no-options vs {} options; asserts out1() === out2() and no '[#' in output)
```

### Files Changed
- `src/stream-filter.ts` — `taskId?: number` added to `ProcessStreamOptions`; `writeLine` helper introduced; all 6 `output.write(...)` calls replaced with `writeLine(...)`
- `test/stream-filter.test.ts` — new `describe('processStream taskId prefix')` block with 2 tests appended before the narration suite
- `.ralph/` bookkeeping files (tasks.json, tasks.completed.json, notes)

### Gaps
None detected.

Notes:
- The "byte-for-byte unchanged" test compares `undefined` vs `{}` options rather than a
  pre-recorded historical baseline. This is correct: both paths produce `prefix = ''`, and
  the 57 pre-existing passing tests already serve as the behavioral baseline. The extra
  `expect(out1()).not.toContain('[#')` assertion confirms no stray prefix.
- `taskId: 0` edge case: `options?.taskId != null` evaluates `0 != null` as `true`, so
  `[#0] ` is correctly applied. No test covers this but the implementation is correct by
  construction and not required by the spec.
- TDD sequence is sound: notes confirm 58 pass/1 fail before implementation. The
  byte-equality test passed even before the fix (both paths produce no-prefix output),
  while the prefix-existence test failed — consistent with correct red-green flow.

### Regression Risks
None detected.
- The `writeLine` helper is a strict identity to `output.write` when `prefix === ''`,
  preserving all existing call-site behavior for serial-mode callers that pass no `taskId`.
- All 6 `output.write` call sites were replaced (non-JSON passthrough, init, tool_use,
  truncated text, multi-line text, result). No write path was missed.
- No existing exports were removed or renamed.
- Test count went from 57 to 59 (2 new). All 59 pass post-implementation.
- `bun run build` succeeded with no TypeScript errors.

### Verdict
CLEAN

---

## Task #8: Plural ready-set selector
Reviewed: 2026-05-31T23:36:00Z

### Coverage
```
Task Requirements
├── [DONE] Add selectReadyTasks(tasks, completedIds, opts?) to src/task-selector.ts
├── [DONE] Keep selectNextTask unchanged for serial mode
├── [DONE] Return pending tasks with ALL dependencies satisfied
├── [DONE] Use same active+archived complete-id logic as selectNextTask (~lines 51-54)
├── [DONE] Sort by priority ascending
├── [DONE] Cap at opts.limit
├── [DONE] Conflict-filter: no two tasks share the same non-empty directory
├── [DONE] Decide AND document in-progress task interaction in a code comment
│   └── [DONE] In-progress tasks treat their dirs as occupied; pending tasks
│             sharing that dir are excluded before the sort even begins
└── [DONE] TDD: failing tests added first, then implementation
    ├── [DONE] Dependency gating (unsatisfied dep excluded)
    ├── [DONE] Dep satisfied via active complete tasks
    ├── [DONE] Dep satisfied via completedIds set
    ├── [DONE] Dep satisfied via union of both sources
    ├── [DONE] Priority ordering
    ├── [DONE] Limit capping
    ├── [DONE] Directory-conflict exclusion (batch-internal)
    ├── [DONE] In-progress dir occupation (cross-task conflict)
    ├── [DONE] Empty directory is not a conflict
    ├── [DONE] In-progress tasks excluded from result entirely
    ├── [DONE] Blocked/complete tasks ignored
    ├── [DONE] Empty result when all pending tasks unsatisfied
    └── [DONE] Empty input returns empty array
```

### Files Changed
- `src/task-selector.ts` — new `selectReadyTasks` export added after `selectNextTask`
- `test/task-selector.test.ts` — import updated to include `selectReadyTasks`; 13 new tests added in `describe('selectReadyTasks', ...)`
- `.ralph/` bookkeeping files (tasks.json, tasks.completed.json, snapshots, logs, notes)

### Gaps
None detected. The agent's notes claimed 11 new tests; 13 were actually added — a surplus, not a deficit.

### Regression Risks
None detected.
- `selectNextTask` is byte-for-byte unchanged.
- `buildIterationPrompt` is untouched.
- `loadCompletedIds` is untouched.
- The test-file import change is purely additive (`selectReadyTasks` appended to the existing import list).
- All 38 pre-existing tests remain intact; new tests are purely additive.
- The pre-existing import mismatch (`getNextTask`/`isTaskReady`) noted in Task #7's notes was already fixed before this task ran — the test file already imports `selectNextTask` correctly.

### Verdict
CLEAN

---

## Task #7: Concurrency-safe tasks.json writes
Reviewed: 2026-05-31T23:35:00Z

### Coverage
```
Task Requirements
├── [DONE] (a) Per-process unique tmp path via uniqueTmpPath()
│   ├── [DONE] Incorporates process.pid + crypto.randomBytes(6) hex suffix
│   ├── [DONE] writeTasksFile() uses uniqueTmpPath() — no more shared ${filePath}.tmp
│   └── [DONE] writeTasksFile() self-cleans its own tmp on failure (catch + unlinkSync)
│             (mutateTasksFile's old finally-cleanup replaced by writeTasksFile self-cleanup)
├── [DONE] (b) Cross-process O_EXCL lockfile around read->modify->write in mutateTasksFile
│   ├── [DONE] acquireLock() uses fs.openSync(lockPath, 'wx') — O_CREAT|O_EXCL
│   ├── [DONE] Bounded retry/backoff: 15–30ms jitter, 15s max (LOCK_MAX_WAIT_MS)
│   ├── [DONE] Stale-lock breaking: locks older than 60s (LOCK_STALE_MS) auto-removed
│   ├── [DONE] Released in finally: closeSync(fd) + unlinkSync(lockPath)
│   └── [DONE] Clear TasksFileError if lock can't be acquired, with recovery instructions
├── [DONE] Existing snapshot-after-write behavior preserved
│         (snapshotTasksFile call moved inside the lock — strictly better)
└── [DONE] TDD: failing concurrent-writer test (m-g) written FIRST, then implementation
    ├── [DONE] 5 real OS subprocesses via Bun.spawn, each incrementing own counter 30×
    ├── [DONE] Asserts all processes exit 0 (no failures)
    ├── [DONE] Asserts valid JSON (no corruption)
    ├── [DONE] Asserts every counter == 30 (no lost updates)
    └── [DONE] Asserts no leftover .tmp* or .lock files
```

### Files Changed
- `src/tasks-file.ts` — added `uniqueTmpPath()`, `sleepSync()`, `acquireLock()`; refactored `writeTasksFile()` and `mutateTasksFile()` for concurrency safety
- `test/tasks-file.test.ts` — added test (m-g); updated (m-a) prefix match, (m-b) readdirSync check, (m-c) lock-release verification

### Gaps
None detected.

### Regression Risks
- **Advisory lock only**: `acquireLock` is only called by `mutateTasksFile`. Direct callers of `writeTasksFile` (task-archiver, test-validator) bypass the lock. The notes acknowledge this explicitly — those callers run in the serial loop, not concurrently with agents. Documented design boundary, not a regression.
- **`unlinkSpy` in (m-c) calls through**: `spyOn(fs, 'unlinkSync')` without `.mockImplementation()` passes through to the real implementation. This is correct — the test verifies the lock IS released (call recorded + no lock file on disk).
- **Stale lock TOCTOU**: If a stale lock is removed by one process and immediately claimed by another before the original retries, the original loops and tries again — expected advisory-lock behavior, not a correctness hazard.
- No removed exports, no deleted tests, no changed public API. 18/18 targeted tests pass; full suite (670) green per agent notes (pre-existing task-selector import mismatch is unrelated, noted as task #101).

### Verdict
CLEAN

---

## Task #5: Gate the planner's write in planner.md
Reviewed: 2026-05-31T23:40:00Z

### Coverage
```
Task Requirements
├── [DONE] Replace WORKFLOW step 5 with an explicit user-go-ahead gate
│         (old: "When the discussion feels complete, write planning-notes.md"
│          new: ask user → wait for explicit yes → then write)
├── [DONE] Planner must NOT write based on its own judgment ("feels complete")
│         — "never decide on your own that the discussion 'feels complete.'"
├── [DONE] Planner MAY ask user whether they are ready to capture the plan
│         — "ask the user if they are ready to capture the plan"
├── [DONE] Must only write AFTER user explicitly gives go-ahead
│         — "Do NOT write planning-notes.md until the user explicitly says yes."
├── [DONE] Assume there may always be more to discuss
│         — "Assume there may always be more to discuss"
├── [DONE] Keep existing constraint (~line 47) that it only ever writes planning-notes.md
│         — Line 47 ("ONLY write to planning-notes.md...") is untouched
└── [DONE] No code or tests (prompt/documentation edit only)
```

### Files Changed
- `agents/planner.md` — WORKFLOW step 5 rewritten with explicit user-go-ahead gate
- `.ralph/.ralph_task_5_notes.md` — task notes replaced with description of this task's work (bookkeeping only)

### Gaps
None detected.

### Regression Risks
None detected. Pure prompt text change — no code, no tests, no exports. The
existing RULES constraint at line 47 ("ONLY write to planning-notes.md") is
untouched and still in force. The new wording is additive in behavioral
restriction (stricter gating) rather than loosening anything.

### Verdict
CLEAN

---

## Task #4: Rewrite AGENT SELECTION in generate-tasks.md
Reviewed: 2026-05-31T23:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Rewrite AGENT SELECTION section (~lines 140-143) in commands/generate-tasks.md
├── [DONE] State plainly that post-task review runs AUTOMATICALLY after every task
│         (gated on config) — new first bullet: "Post-task code review runs
│         **automatically** after every task (gated on project config)"
├── [DONE] Task-generation agent must NEVER create "review code" / "review the work" tasks
│         — explicit "do NOT create 'review code', 'review the work', or similar
│           review tasks" in the new bullet
├── [DONE] Must NEVER assign `post-task-reviewer` (or any internal agent) to `agent` field
│         — explicit "do NOT assign `post-task-reviewer` or any other internal agent
│           to a task's `agent` field" in the new bullet
├── [DONE] Keep legitimate guidance that specialist executor agents may be assigned
│         — second bullet retained (wording sharpened: "executor" added for clarity)
├── [DONE] Keep guidance that most tasks use the default generalist
│         — third bullet unchanged
└── [DONE] No code changes, no tests (prompt/documentation edit only)
```

### Files Changed
- `commands/generate-tasks.md` — one bullet prepended to AGENT SELECTION block; "executor" added to second bullet
- `.ralph/.ralph_task_4_notes.md` — task notes updated to describe this task's work (bookkeeping only)

### Gaps
None detected.

### Regression Risks
None detected. The change is purely additive — one new bullet prepended before the two
existing bullets. The minor word addition of "executor" to "specialist agents" is a
clarification that restricts the scope of that guidance to executor agents only (correct,
since internal agents like `post-task-reviewer` are not executor agents). No code paths,
exports, tests, or contracts were altered.

### Verdict
CLEAN

---

## Task #3: Filter internal agents from the planner's agent list
Reviewed: 2026-05-31T23:20:00Z

### Coverage
```
Task Requirements
├── [DONE] Filter agents where internal=true before building AVAILABLE SPECIALIST AGENTS section
│         (src/commands/plan.ts line 81: `const visibleAgents = agents.filter(a => !a.internal)`)
├── [DONE] If all agents filtered out, omit section entirely
│         (guard changed from `agents.length > 0` to `visibleAgents.length > 0`)
├── [DONE] Map over visibleAgents instead of all agents
│         (line 83: `visibleAgents.map(a => { ... })`)
└── TDD: test/commands/plan.test.ts
    ├── [DONE] Test added first (red phase confirmed in notes)
    ├── [DONE] "excludes internal agents while keeping normal agents"
    │         — mixed array: asserts post-task-reviewer absent, specialist present,
    │           AVAILABLE SPECIALIST AGENTS header still present
    └── [DONE] "omits agent section entirely when all agents are internal"
              — all-internal array: asserts neither agent name nor section header appear
```

### Files Changed
- `src/commands/plan.ts` — one filter line added; guard and map updated to use `visibleAgents`
- `test/commands/plan.test.ts` — two new tests in `describe('buildDynamicContext')` block
- `.ralph/.ralph_task_3_notes.md` — task notes updated (bookkeeping only)

### Gaps
None detected.

### Regression Risks
None detected. The filter uses `!a.internal`, so agents without the `internal` field (`undefined` is falsy) pass through unchanged — preserving all prior behavior for normal agents. The `AgentInfo.internal?: boolean` type and the frontmatter parsing in `src/config.ts` were both established in Task #1. Full suite went from 662 to 669 tests (7 total additions, 2 from this task). No exports removed, no contracts changed.

### Verdict
CLEAN

---

## Task #2: Executor guard in buildSystemPrompt
Reviewed: 2026-05-31T23:10:00Z

### Coverage
```
Task Requirements
├── [DONE] Guard agentInfo?.internal in buildSystemPrompt specialist-injection block
├── [DONE] Emit console.warn naming the internal agent when skipped
├── [DONE] Fall back to generalist prompt (specialistSection left empty)
├── [DONE] Non-internal agents inject exactly as before (else branch unchanged)
└── TDD: test/agent-prompt.test.ts
    ├── [DONE] Test added first (red phase documented in notes)
    ├── [DONE] Assert prompt DOES contain body for normal specialist
    ├── [DONE] Assert prompt does NOT contain body for internal agent
    ├── [DONE] Assert SPECIALIST INSTRUCTIONS: absent for internal agent
    └── [DONE] Assert console.warn called once with agent name
```

### Files Changed
- `src/commands/run.ts` — specialist-injection block wrapped in `if (agentInfo.internal)` / `else`
- `test/agent-prompt.test.ts` — two new tests in `describe("buildSystemPrompt")`, imports for `buildSystemPrompt`, `SystemPromptInput`, `AgentInfo`, `RalphConfig`, `spyOn`
- `.ralph/.ralph_task_2_notes.md` — task notes updated (non-source, bookkeeping only)

### Gaps
None detected.

### Regression Risks
None detected. The `else` branch preserves the original file-read path verbatim; the only new code path is the early `console.warn` + return-empty for `internal: true`. The `internal` field is `optional` in `AgentInfo` (confirmed in `src/types.ts:39`), so existing agents without the flag are unaffected.

### Verdict
CLEAN

---

## Task #1: Add `internal` agent flag to discovery
Reviewed: 2026-05-31T23:02:41Z

### Coverage
```
Task Requirements
├── [DONE] (a) Add YAML frontmatter to agents/post-task-reviewer.md
│   ├── [DONE] name: post-task-reviewer
│   ├── [DONE] description field present
│   ├── [DONE] internal: true
│   └── [DONE] Existing body prose preserved verbatim below closing ---
├── [DONE] (b) Parse boolean `internal` field in discoverAgents (src/config.ts)
│   └── [DONE] Coerces meta.internal === 'true' to boolean true
├── [DONE] (c) Add `internal?: boolean` to AgentInfo interface (src/types.ts)
└── [DONE] TDD: failing tests written first, then implementation
    ├── [DONE] Test: internal: true frontmatter yields agent.internal === true
    ├── [DONE] Test: agent without internal field yields falsy
    └── [DONE] Test: agent with no frontmatter yields falsy
```

### Files Changed
- `agents/post-task-reviewer.md` — YAML frontmatter block prepended
- `src/config.ts` — spread `{ internal: true }` when `meta.internal === 'true'`
- `src/types.ts` — `internal?: boolean` added to `AgentInfo` interface
- `test/config.test.ts` — 3 new tests covering internal flag parsing
- `.ralph/.ralph_task_1_notes.md` — task notes updated (housekeeping)

### Gaps
None detected

### Regression Risks
None detected — the change is purely additive: a new optional field on `AgentInfo` and a new frontmatter key in one agent file. No existing callers of `discoverAgents` are broken; absent `internal` key leaves the field `undefined` (falsy), matching prior behavior. All 42 config tests pass.

### Verdict
CLEAN

---

## Task #11: Migrate run.ts reads + snapshot + corruption counter + tempfile cleanup
Reviewed: 2026-04-20T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] (a) main-loop read goes through readTasksFile (with dataDir opt)
├── [DONE] (b) post-task-review re-read goes through readTasksFile
├── [DONE] (c) corruptionEvents counter init to 0, increments on repaired:true or restored:true
│   ├── [DONE] increments on repaired:true
│   ├── [DONE] increments on restored:true
│   └── [DONE] accumulates across main-loop + post-review reads
├── [DONE] (d) final summary emits '⚠ N corruption events recovered this run — see <dataDir>/corruption.log' only when N > 0
│   └── [DONE] line absent when N === 0
├── [DONE] (e) ntfy body includes corruption count when ntfyTopic is set
│   └── [DONE] ntfy body omits corruption when N === 0
├── [DONE] (f) snapshotTasksFile called after successful main-loop read (per-iteration snapshot)
└── [DONE] (g) TEMP_FILES cleanup extended with readdirSync-based glob sweep for .ralph_task_<id>_notes.md
    ├── [DONE] only matches pattern with numeric <id>
    ├── [DONE] does not unlink non-matching files (other.md, tasks.json, .ralph_task_notes.md without id)
    └── [DONE] does not crash when readdirSync throws
```

### Files Changed
- `src/commands/run.ts` — replaced readFileSync dep with readTasksFile/snapshotTasksFile/readdirSync; added corruptionEvents counter; updated summary/ntfy; added per-iteration snapshot; added notes-tempfile sweep in finally block
- `test/commands/run.test.ts` — migrated 5 existing tests from readFileSync → readTasksFile shape; added 12 new tests covering all 7 requirements
- `.ralph/tasks.json` — task #10 archived, task #11 marked complete

### Gaps
None detected. All seven sub-requirements are explicitly tested and implemented. The cleanup sweep is placed at the end of the `finally` block rather than adjacent to the TEMP_FILES constant at line ~345, but this is functionally equivalent (both run at exit) and arguably cleaner since the notes sweep must happen after the iteration loop finishes.

### Regression Risks
- `readFileSync` was removed from `RunRunDeps`. Any caller that constructed `RunRunDeps` manually (outside the test harness) and passed a `readFileSync` field would silently lose that override — but this is a DI interface change that's fully encapsulated within run.ts and its tests. No other files import `RunRunDeps` with a `readFileSync` field based on the diff context.
- The `summaryMsg` construction was refactored into `baseSummary + summaryMsg`; the string value is preserved exactly for the zero-corruption path, and the new path is test-covered.
- `snapshotTasksFile` is called inside a try/catch that swallows errors silently — snapshot failures are intentionally non-fatal, which is correct per the design note in the task.

### Verdict
CLEAN

---

## Task #6: Implement mutateTasksFile with atomicity tests
Reviewed: 2026-04-19T08:45:00Z

### Coverage
```
Task Requirements
├── [DONE] Tests for mutateTasksFile
│   ├── [DONE] (a) tempfile written BEFORE rename — spies on writeFileSync + renameSync (test m-a)
│   ├── [DONE] (b) rename happens on successful fn (test m-a verifies ordering; m-b verifies result)
│   ├── [DONE] (c) tempfile cleaned up via unlinkSync on fn throw; original untouched (test m-c)
│   ├── [DONE] (d) unknown/extra fields preserved across round-trip (test m-d)
│   └── [PARTIAL] (e) snapshotTasksFile called when opts.dataDir provided — spec said "spy on it";
│             agent used filesystem observation (snapshot file exists with new content) instead.
│             Justified by ESM module-binding limitation making export spying ineffective;
│             behavioural check is arguably stronger, but deviates from spec wording.
├── [DONE] Implementation of mutateTasksFile in src/tasks-file.ts
│   ├── [DONE] calls readTasksFile(path, opts)
│   ├── [DONE] calls fn(data), supports both void (in-place) and returning new object
│   ├── [DONE] calls writeTasksFile(path, result) for atomic write
│   ├── [DONE] calls snapshotTasksFile when opts.dataDir provided
│   ├── [DONE] try/finally ensures unlinkSync cleanup on throw
│   └── [DONE] unknown fields preserved (readTasksFile returns raw parsed object, no projection)
└── [DONE] Bonus tests: m-e2 (no snapshot without dataDir), m-f (in-place void mutation)
```

### Files Changed
- `src/tasks-file.ts` — added `mutateTasksFile` export (32 lines)
- `test/tasks-file.test.ts` — added 7 `mutateTasksFile` tests (163 lines); imported `writeTasksFile`, `mutateTasksFile`, `spyOn`
- `.ralph/tasks.json` — task #5 archived, task #6 marked complete

### Gaps
- Test (e) deviates from spec: task asked for a spy on `snapshotTasksFile`; agent used filesystem-level assertion (checks `.ralph_tasks_snapshot.json` content) instead. The agent's rationale (ESM binding prevents intercepting internal calls) is sound, and the behavioural check is equally valid — but the spec's intent was to verify the *function call* specifically, not just its side-effect. Minor gap.

### Regression Risks
- None detected. No existing functions were modified; `mutateTasksFile` is a pure addition. The `renamed` flag guards cleanup correctly: if `fn` throws before `writeTasksFile` is called, no `.tmp` exists (ENOENT from `unlinkSync` is swallowed); if `writeTasksFile` partially succeeds (writes `.tmp` but rename fails), `renamed` stays false and the `.tmp` is cleaned. `snapshotTasksFile` runs post-`try/finally`, so a snapshot failure cannot undo a successful write. Task 5 tests unaffected (17/17 pass, full suite 612/612 green per agent notes).

### Verdict
HAS_GAPS

---

## Task #1: Stub src/tasks-file.ts + install jsonrepair
Reviewed: 2026-04-19T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create src/tasks-file.ts
│   ├── [DONE] readTasksFile(path, opts?) → { data: TasksFile, repaired: boolean, restored: boolean, error?: string }
│   │         stub throws 'Not implemented' (via new Error('Not implemented'))
│   ├── [DONE] writeTasksFile(path, data) stub throws 'Not implemented'
│   ├── [DONE] snapshotTasksFile(path, dataDir) stub throws 'Not implemented'
│   ├── [DONE] TasksFileError class extending Error (with name = 'TasksFileError')
│   └── [DONE] TasksFile interface defined as { project?: string; tasks: Task[] } and exported
│             (Task imported from './types', re-exported via interface)
├── [DONE] Add jsonrepair as runtime dependency (bun add jsonrepair → ^3.14.0)
│   ├── [DONE] package.json updated
│   └── [DONE] bun.lock updated
└── [DONE] Verify bun run build produces dist/ralph without errors (confirmed in task notes)
```

### Files Changed
- `src/tasks-file.ts` — new file, 28 lines; all required stubs and types exported
- `package.json` — jsonrepair added under `dependencies`
- `bun.lock` — jsonrepair@3.14.0 entry added
- `.ralph/tasks.json` — full task list (tasks 1–17) populated; task #1 marked complete

### Gaps
None detected. All scaffolding requirements are fully addressed. The stubs correctly
throw `new Error('Not implemented')` rather than the string `'Not implemented'` —
this is the proper TypeScript idiom and behaves identically when caught.

### Regression Risks
None detected. This task is purely additive: a new source file plus a new runtime
dependency. No existing source files were modified. The jsonrepair package is a
runtime dep (not devDep), which is correct since it will be used in production
readTasksFile logic in task #3.

### Verdict
CLEAN

---

## Task #12: Tighten post-task-reviewer path-scoped allowlist
Reviewed: 2026-04-20T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Step 1: Add failing test assertion to test/post-task-reviewer.test.ts
│   ├── [DONE] Used existing mock-spawn pattern
│   ├── [DONE] Found the 'spawns claude with correct args' test
│   └── [DONE] Asserted args[indexOf('--allowedTools') + 1] === exact scoped string
├── [DONE] Step 2: Change --allowedTools in src/post-task-reviewer.ts
│   └── [DONE] 'Read,Glob,Grep,Edit,Write' → 'Read,Glob,Grep,Edit(.ralph/review-post.md),Write(.ralph/review-post.md)'
├── [DONE] No other changes to src/post-task-reviewer.ts
└── [DONE] No regressions in other post-task-reviewer tests (658 tests green)
```

### Files Changed
- `src/post-task-reviewer.ts` — `--allowedTools` value updated at line 123
- `test/post-task-reviewer.test.ts` — assertion updated to expect path-scoped string
- `.ralph/tasks.json` — task #11 archived, task #12 marked complete

### Gaps
None detected. The diff is minimal and precisely targeted: one line changed in production code, one string updated in the corresponding test assertion. The TDD sequence (write failing test → verify failure → fix production code → verify pass) is confirmed by the agent notes ("confirmed it failed against the old value before the fix").

### Regression Risks
None detected. The change is a string substitution in a single argument position within an existing args array. The path-scoped syntax `Edit(.ralph/review-post.md)` is a strict superset restriction — it reduces what the reviewer agent can write, not what the orchestration code does. No callers of `spawnPostTaskReviewer` were modified, and the function signature is unchanged.

### Verdict
CLEAN

---

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

## Task #3: Update generate-tasks.md (both copies) with atomicity guidance
Reviewed: 2026-04-19T06:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Add atomicity rule to commands/generate-tasks.md
│         → ATOMICITY RULE section inserted after task-structure fields, before
│           TEST COMMAND GUIDELINES (lines 124-126 in the updated file)
├── [DONE] Add atomicity rule to .claude/commands/generate-tasks.md (mirror copy)
│         → Identical insertion; both files share the same git object (49d9000→742deff)
├── [DONE] Rule content: atomic unit, no paired write-tests/implement tasks,
│         TDD within one task (write, fail, pass)
├── [DONE] Rule placed under task-structure section
└── [DONE] diff confirms files are identical (noted in task notes; git object IDs match)
```

### Files Changed
- `commands/generate-tasks.md` — ATOMICITY RULE block added (4 lines)
- `.claude/commands/generate-tasks.md` — identical ATOMICITY RULE block added
- `.ralph/tasks.json` — task #2 archived, task #3 marked complete with notes

### Gaps
None detected. Both files received the same change (confirmed by matching pre/post git object hashes `49d9000..742deff` in the diff), and the inserted rule text faithfully captures all three required elements: atomic unit, no paired tasks, TDD-within-task workflow.

### Regression Risks
None detected. This is a documentation-only change to markdown slash command files. No source code, tests, or configuration was modified. The change is purely additive — inserting a new guidance section into an existing document. Existing generate-tasks behavior is unaffected.

### Verdict
CLEAN

---

## Task #2: Tighten .ralph/instructions.md
Reviewed: 2026-04-19T05:15:00Z

### Coverage
```
Task Requirements
├── [DONE] Replace single line in .ralph/instructions.md with the specified wording
│         File now contains exactly:
│         '* Use TDD within each task — write the test, see it fail, then make it
│          pass. Do not split a single unit of work into separate test-writing and
│          implementation tasks.'
├── [DONE] Preserve leading '* ' bullet marker
└── [DONE] Mark task complete in tasks.json with explanatory notes
```

### Files Changed
- `.ralph/tasks.json` — task #2 marked complete with notes; task #1 archived
- `.ralph/instructions.md` — updated with new wording (untracked/gitignored; not in diff)

### Gaps
None detected. `.ralph/instructions.md` is not tracked by git (confirmed via
`git ls-files`), so the file change is invisible in the diff. The file was read
directly and contains exactly the required line verbatim, including the `* ` prefix.
The agent's notes ("Single-line replacement applied") are consistent with this outcome.

### Regression Risks
None detected. This is a content-only change to an untracked data file. No source
code, tests, or configuration was modified. The new wording is strictly more precise
than the old wording — it explicitly forbids splitting TDD across separate tasks,
which is the structural defense against the infinite-loop pattern from the prior run.

### Verdict
CLEAN

---

## Task #4: Update review-tasks.md (both copies) to flag paired test/impl
Reviewed: 2026-04-19T00:10:00Z

### Coverage
```
Task Requirements
├── [DONE] Update commands/review-tasks.md
│         → FAIL (automatic) bullet added under Atomicity check section,
│           after the existing FAIL bullet for poorly-scoped tasks
├── [DONE] Update .claude/commands/review-tasks.md (mirror copy)
│         → Identical insertion confirmed; both diffs are byte-for-byte identical
├── [DONE] Content: paired test/impl tasks = FAIL finding, reject the plan
│         → "Flag every such split as a FAIL finding and reject the plan" present
└── [DONE] diff confirms files are identical (noted in task notes)
```

### Files Changed
- `commands/review-tasks.md` — one line added under Atomicity FAIL bullet
- `.claude/commands/review-tasks.md` — same line added (mirror)
- `.ralph/tasks.json` — task #3 archived, task #4 marked complete with notes

### Gaps
None detected. Both copies received the identical insertion. The added text covers all three required elements: (1) paired test/impl tasks as a FAIL finding, (2) each task must be atomic, and (3) the reviewer should reject plans that split work this way.

### Regression Risks
None detected. This is a documentation-only change to markdown slash command files. No source code, tests, or configuration was modified. The change is purely additive — inserting a new `FAIL (automatic)` bullet into the existing Atomicity dimension of the review rubric.

### Verdict
CLEAN

---

## Task #5: Implement readTasksFile + writeTasksFile + snapshotTasksFile + corruption.log
Reviewed: 2026-04-19T01:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Confirm TDD red: tests fail against stubs before implementation
│         (noted in task description; stubs threw 'Not implemented')
├── [DONE] readTasksFile(path, opts?) implementation
│   ├── [DONE] Path 1: JSON.parse → { data, repaired: false, restored: false }
│   ├── [DONE] Path 2: jsonrepair on failure → { data, repaired: true, restored: false }
│   │         └── [DONE] trimTrailingGarbage() helper for trailing-garbage fixtures
│   │         └── [DONE] isTasksFileShape() guard to reject over-lenient jsonrepair results
│   ├── [DONE] Path 3: snapshot recovery → { data, repaired: false, restored: true }
│   ├── [DONE] Throw TasksFileError if all three paths fail
│   └── [DONE] corruption.log JSONL entries on every failure path
│       ├── [DONE] stage: 'parse' on JSON.parse failure
│       ├── [DONE] stage: 'jsonrepair' on jsonrepair failure
│       ├── [DONE] stage: 'snapshot' on snapshot failure (and when snapshot absent)
│       ├── [DONE] ts: ISO8601 timestamp
│       ├── [DONE] error: string message
│       ├── [DONE] sha256: hex via crypto.createHash('sha256')
│       └── [DONE] preview: bytes.slice(0,500).toString('utf-8')
├── [DONE] writeTasksFile(path, data) — writes to .tmp then renames atomically
├── [DONE] snapshotTasksFile(path, dataDir) — copies to <dataDir>/.ralph_tasks_snapshot.json
├── [DONE] All 10 tasks-file.test.ts tests pass
├── [DONE] Full suite (605 tests) still green — no regressions
└── [DONE] mutateTasksFile NOT implemented (correctly deferred to task #6)
```

### Files Changed
- `src/tasks-file.ts` — stubs replaced with full implementations; added helpers `trimTrailingGarbage()`, `isTasksFileShape()`, `logCorruption()`
- `.ralph/tasks.json` — task #4 archived, task #5 marked complete with detailed notes

### Gaps
None detected. All specified behavior is implemented and covered by the pre-existing test suite. The agent added two notable defensive helpers beyond the spec minimum — `trimTrailingGarbage()` to handle the trailing-garbage fixture (which jsonrepair alone cannot parse), and `isTasksFileShape()` to reject over-lenient repair results that pass jsonrepair but aren't valid TasksFile shapes (e.g., bare strings repaired to quoted strings). Both are well-motivated by the test cases.

### Regression Risks
None detected. The implementation fills in previously-throwing stubs — no existing functionality was altered. The `logCorruption()` helper is wrapped in a try/catch ("best-effort") so disk errors on the log file never surface as observable failures to callers. The snapshot-missing case logs a synthetic error entry and falls through to `TasksFileError`, matching test #5 expectations.

### Verdict
CLEAN

---

## Task #7: Implement ralph task subcommand group + wire into index.ts
Reviewed: 2026-04-20T06:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Step 1: test/commands/task.test.ts with failing tests for all subcommands
│   ├── [DONE] (1) task start <id> --iteration N — sets in-progress, idempotent (tests 1a, 1b, 1c)
│   ├── [DONE] (2) task complete --notes "..." — sets status/completedAt/completedBy/notes (test 2)
│   ├── [DONE] (3) task complete --notes-file PATH — reads from file (test 3)
│   ├── [DONE] (4) task complete --notes-file - — reads from stdin via readStdin injection (test 4)
│   ├── [DONE] (5) task complete with no notes flag — leaves notes untouched (tests 5, 5b)
│   ├── [DONE] (6) task note <id> "x" — appends via ' | '; --replace overwrites (tests 6a, 6b, 6c)
│   ├── [DONE] (7) task set-status — accepts all 4 valid statuses; rejects invalid with exit 1 (tests)
│   ├── [DONE] (8) task add --file PATH — validates via ajv; refuses with exit 1 + exact stderr
│   │             contract; leaves tasks.json untouched on failure (tests 8a, 8b, 8c)
│   └── [DONE] (9) task show <id> — prints formatted JSON; read-only (tests 9a, 9b, 9c)
│         └── [DONE] tmp tasks.json per test (beforeEach/afterEach with mkdtempSync)
├── [DONE] Step 2: bun add ajv — package.json + bun.lock updated (ajv@8.18.0)
├── [DONE] Step 3: src/commands/task.ts — Commander subcommand group
│   ├── [DONE] Mirrors style of run.ts/plan.ts (Writer injection, Commander actions)
│   ├── [DONE] All mutating subcommands go through mutateTasksFile
│   └── [DONE] Refuse-to-merge contract: exit 1, correct stderr format, tasks.json untouched
├── [DONE] Step 4: wire registerTaskCommands into src/index.ts
├── [DONE] Step 5: bun run build confirms binary compiles (105 modules, dist/ralph produced)
└── [DONE] src/tasks-schema.json — already existed from task #5; used correctly for ajv validation
```

### Files Changed
- `src/commands/task.ts` — new file, 380 lines; 6 exported functions + `registerTaskCommands()`
- `src/index.ts` — added `registerTaskCommands` import and call in `createProgram()`
- `test/commands/task.test.ts` — new file, 354 lines; 22 tests across 5 describe blocks
- `package.json` — ajv added under `dependencies`
- `bun.lock` — ajv@8.18.0 + 4 transitive deps added
- `.ralph/tasks.json` — task #6 archived, task #7 marked complete

### Gaps
None detected. All 9 subcommand behaviors are covered by tests and implemented. The `src/tasks-schema.json` listed as an Expected File already existed from task #5; it was correctly imported and used for per-task validation. The 22 new tests pass and the full suite is 634/634 green.

### Regression Risks
- `registerTaskCommands` uses `process.env.RALPH_DATA_DIR!` with a non-null assertion for both `tasksPath()` and `dataDir()`. If `RALPH_DATA_DIR` is unset at runtime, the functions return `undefined` typed as `string`, leading to an ENOENT at the `mutateTasksFile` call. This is consistent with how other commands use env vars in ralph (no unique regression).
- `taskItemSchema` is extracted from the full schema via a type cast (`schema as { properties: { tasks: { items: object } } }`). If `tasks-schema.json` changes its shape (e.g. renaming the `tasks` key), the cast silently passes while `taskItemSchema` becomes `undefined`, and all `task add` calls would accept any payload. Moderate risk if schema evolves.
- `{strict: false, logger: false}` passed to `new Ajv()` silences the `date-time` format warning from the schema. If future schema additions require format validation (uri, email, etc.), the `strict: false` flag will suppress those errors too. Low risk given current usage.
- No existing exports were removed, no existing tests were deleted.

### Verdict
CLEAN

---

## Task #1: Revert the tddGate hack
Reviewed: 2026-04-19T05:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Remove the tddGate guard block from src/test-validator.ts
├── [DONE] Remove preceding comment line about intentionally failing tests
├── [DONE] Do not add any replacement logic
├── [DONE] Do not add tddGate to any schema
└── [DONE] Run existing test-validator tests (17 pass, per task notes)
```

### Files Changed
- `src/test-validator.ts` — removed 4-line tddGate block (comment + guard + blank line)
- `.ralph/tasks.json` — task renumbering, removed tddGate field from prior entry, restructured plan

### Gaps
None detected

### Regression Risks
None detected. The removal is surgical: exactly the lines called out in the task description were deleted with no surrounding logic altered. The status check guard immediately above the removed block is intact, and the for loop that follows is unchanged. Task notes confirm all 17 pre-existing test-validator tests passed after the change.

### Verdict
CLEAN

---
## Task #10: Migrate task-archiver.ts + stop silent swallowing
Reviewed: 2026-04-20T07:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Step 1 – TDD: write failing tests first
│   ├── [DONE] (a) archiver uses readTasksFile so corrupted tasks.json can be
│   │         repaired and archival proceeds normally — malformed JSON (missing comma)
│   │         recovered via jsonrepair; archival completes; snapshot written
│   ├── [DONE] (b) when readTasksFile throws TasksFileError, archiver returns
│   │         { archivedCount: 0, prevNotes: null, warnings: [<string>] } AND
│   │         appends entry to corruption.log AND appends line to iteration log
│   └── [DONE] Guard test: omitting iterationLogPath does not crash
├── [DONE] Step 2 – migrate src/task-archiver.ts
│   ├── [DONE] Add 'warnings: string[]' to ArchiveResult type
│   ├── [DONE] Add optional 'iterationLogPath?' to archiveCompletedTasks opts
│   ├── [DONE] Replace try/catch at lines 27-31 with tasksFileModule.readTasksFile call
│   ├── [DONE] On TasksFileError: push descriptive message to warnings
│   ├── [DONE] On TasksFileError: appendFileSync to iterationLogPath (if provided)
│   ├── [DONE] On TasksFileError: return { archivedCount: 0, prevNotes: null, warnings }
│   ├── [PARTIAL] Replace every JSON.stringify+writeFileSync pair with writeTasksFile
│   │         + snapshotTasksFile — only the tasks.json write was migrated.
│   │         .ralph_completed_ids (line 78) and tasks.completed.json (line 101)
│   │         still use raw JSON.stringify+writeFileSync.
│   │         Agent's justification: those are not TasksFile-shape data, so
│   │         writeTasksFile/snapshotTasksFile are semantically inappropriate.
│   │         Justification is sound but the task wording said "every" pair.
│   └── [DONE] Document choice of warnings[] over onError callback (in task notes)
├── [DONE] Update src/commands/run.ts to add iterationLogPath? to interface and
│         pass iterationLogPath at call site (run.ts:594)
└── [DONE] Make new tests pass without regressing existing archiver tests
          (643 → 646 tests, 3 added, 0 regressed)
```

### Files Changed
- `src/task-archiver.ts` — replaced try/catch with readTasksFile, added warnings field, atomic write+snapshot for tasks.json only
- `test/task-archiver.test.ts` — added `defensive I/O` describe block with 3 new tests; existing `toEqual` assertions refactored to `expectEmptyResult()` helper
- `src/commands/run.ts` — `archiveCompletedTasks` dep interface updated; `iterationLogPath` passed at call site
- `.ralph/tasks.json` — task #9 archived, task #10 marked complete

### Gaps
- **"replace every JSON.stringify+writeFileSync pair"** — the task says to replace all such pairs with `writeTasksFile + snapshotTasksFile`, but two pairs remain: `.ralph_completed_ids` (line 78) and `tasks.completed.json` (line 101). The agent's rationale (non-TasksFile shapes; snapshotTasksFile would clobber the tasks.json snapshot) is architecturally sound, but this is a deviation from the literal task spec.
- **archiveResult.warnings not surfaced in run.ts** — the warnings returned from `archiveCompletedTasks` are silently discarded at the call site (`run.ts:600`). The task required warnings to be "surfaced" as part of stopping silent swallowing. Agent deferred this to task #11. Whether the task intended run.ts to display warnings is implicit — the archiver contract is correct; the caller plumbing is incomplete.
- **test/commands/run.test.ts mocks missing warnings field** — four mock return values for `archiveCompletedTasks` in `test/commands/run.test.ts` (lines 666, 818, 911, 1503) now violate the `ArchiveResult` type contract (missing required `warnings: string[]`). Bun transpiles without type-checking so tests still pass at runtime, but TypeScript compilation would flag these.

### Regression Risks
- `test/commands/run.test.ts` mock objects return `{ archivedCount, prevNotes }` without `warnings`. If a `bun run build` with strict type checking or a `tsc --noEmit` pass is added to CI, these four mocks will produce type errors. No runtime regression since `run.ts` never reads `archiveResult.warnings`.
- The `existsSync` short-circuit (lines 26-28) preserves the prior "missing file = silent zero" behavior. This is documented in task notes as intentional (missing ≠ corruption), but it means a race condition where tasks.json is deleted between iterations will silently return zero rather than surfacing a warning. Low risk, consistent with prior behavior.
- Tasks.completed.json and .ralph_completed_ids still use raw `writeFileSync` — these remain vulnerable to mid-write crashes, consistent with pre-migration state. No new regression introduced.

### Verdict
HAS_GAPS

---

## Task #9: Migrate test-validator.ts to defensive I/O
Reviewed: 2026-04-19T12:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Step 1 – TDD: write failing tests first
│   ├── [DONE] (a) malformed tasks.json (missing comma) recovered via readTasksFile;
│   │         validateTaskTests runs the test command and still writes back via writeTasksFile
│   ├── [DONE] (b) when readTasksFile throws TasksFileError, validateTaskTests returns
│   │         { status: 'error', message } rather than crashing — ValidationResult shape preserved
│   └── [DONE] (c) snapshotTasksFile called after each write — spy verified on
│             tasksFileModule.snapshotTasksFile; filePathArg and dataDirArg asserted
├── [DONE] Step 2 – migrate src/test-validator.ts
│   ├── [DONE] Replace JSON.parse(readFileSync(...)) with tasksFileModule.readTasksFile(tasksFilePath, { dataDir })
│   │         wrapped in try/catch; TasksFileError → { status: 'error', message }; non-TasksFileError rethrows
│   ├── [DONE] Replace all three writeFileSync calls (timeout / cant-run / revert paths)
│   │         with writeAndSnapshot() helper calling writeTasksFile + snapshotTasksFile
│   ├── [DONE] appendNote semantics preserved exactly (' | ' separator unchanged)
│   ├── [DONE] ValidationResult enum unchanged
│   └── [DONE] CANT_RUN_PATTERNS list unchanged
└── [DONE] Full suite: 640 → 643 (3 added, 0 regressed)
```

### Files Changed
- `src/test-validator.ts` — removed bare `readFileSync`/`writeFileSync` imports; added `path`, `* as tasksFileModule`, `TasksFileError`, `TasksFile` imports; added `writeAndSnapshot()` helper; wrapped readTasksFile in try/catch; replaced all three write sites
- `test/test-validator.test.ts` — added `spyOn` import; added `import * as tasksFileModule`; added 3-test `defensive I/O` describe block
- `.ralph/tasks.json` — task #8 archived, task #9 marked complete

### Gaps
None detected.

Notes on implementation choices that are correct:
- `writeTasksFile(tasksFilePath, [task])` in test (c) is the local helper (not `tasksFileModule`), which is appropriate for test fixture setup — it's not part of the code under test.
- `tasksFileModule.readTasksFile(tasksFilePath, { dataDir })` correctly matches the API signature `readTasksFile(filePath: string, opts?: { dataDir?: string })`.
- `path.dirname(tasksFilePath)` as `dataDir` is consistent with the convention in `run.ts` (tasks.json and snapshot live in the same directory).
- Namespace-style `import * as tasksFileModule` enables `spyOn(tasksFileModule, 'snapshotTasksFile')` to intercept the call from `writeAndSnapshot()` — the same spy pattern used elsewhere in the test suite.

### Regression Risks
None detected. The `readFileSync`/`writeFileSync` imports were removed along with their usage — no other code in `test-validator.ts` depended on them. The `writeAndSnapshot` helper de-duplicates the three write sites and guarantees snapshot-after-write ordering. All 643 tests pass (`bun test` verified).

### Verdict
CLEAN

---

## Task #8: Rewrite buildSystemPrompt() to use ralph task CLI
Reviewed: 2026-04-19T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Add failing tests: 'ralph task start' with iteration placeholder
├── [DONE] Add failing tests: 'ralph task complete' with '--iteration' and '--notes-file'
├── [DONE] Add failing tests: notes-tempfile path '<dataDir>/.ralph_task_<id>_notes.md'
├── [DONE] Add failing tests: 'ralph task add --file' in DISCOVER-AND-DOCUMENT block
├── [DONE] Add failing tests: explicit ban 'Do NOT use Edit or Write on' + 'tasks.json'
├── [DONE] Add failing test: NOT contain 'Use Edit to set these fields'
├── [DONE] Keep existing assertions intact (2 updated to match new phrasing)
├── [DONE] Replace step 1 with 'ralph task start <id> --iteration <N>'
├── [DONE] Replace step 5 with (a) Write notes file + (b) ralph task complete --notes-file
├── [DONE] Add explicit ban in CRITICAL RULES block
└── [DONE] Update DISCOVER-AND-DOCUMENT to use 'ralph task add --file <path>'
```

### Files Changed
- `.ralph/tasks.json` — Task #7 archived (removed from active list), Task #8 marked complete
- `src/commands/run.ts` — `buildSystemPrompt()` rewritten per spec
- `test/commands/run.test.ts` — 6 new tests added, 2 existing tests updated to match new phrasing

### Gaps
None detected. All six new assertions are present and verify the correct substrings/patterns. The two existing tests that checked old step-1/step-5 phrasing were appropriately updated since those strings are now gone from the implementation.

### Regression Risks
Minor: The CRITICAL RULES section still contains two stale-feeling lines that were explicitly preserved per "Keep all other prompt structure unchanged":
1. `"Set status to 'in-progress' BEFORE starting implementation"` — now the mechanism is `ralph task start`, not direct editing; vague enough not to be wrong, but slightly misleading.
2. `"Mark the task complete in ${tasksFile} BEFORE creating ${completeFlag}"` — still references `tasksFile` directly, even though direct editing is now banned by the new line immediately below. Creates a mildly contradictory signal for the executing agent.

Neither causes a test failure (640/640 pass) and the task description explicitly instructed these lines be left unchanged, so this is an accepted trade-off rather than a defect. A future task could tighten these rule lines.

### Verdict
CLEAN

---

## Task #13: Tighten post-task-reviewer prompt (belt-and-suspenders)
Reviewed: 2026-04-20T00:00:00Z

### Coverage
Task Requirements
├── [DONE] Add explicit rule near top of agents/post-task-reviewer.md
├── [DONE] Rule states 'You may only write to .ralph/review-post.md — never modify .ralph/tasks.json.'
├── [DONE] Placed near top (line 5, immediately after job description sentence)
├── [DONE] Preserve '## Coverage Diagram' section verbatim
├── [DONE] Preserve '## Output Format' section verbatim
└── [DONE] Smoke-read confirms coherent prompt (no orphaned fragments, no broken headers)

### Files Changed
- `agents/post-task-reviewer.md` — two lines inserted (blank line + rule) after the job description sentence
- `.ralph/tasks.json` — task #12 archived, task #13 marked complete

### Gaps
None detected.

### Regression Risks
None detected. The change is purely additive — two lines inserted, no existing content modified. All sections (Coverage Diagram, Gap Detection, Regression Checks, Output Format) are byte-for-byte identical to the pre-change state. No source code or tests were touched.

### Verdict
CLEAN

---

## Task #14: Document ralph task workflow in CLAUDE.md
Reviewed: 2026-04-20T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Add section to CLAUDE.md (new 'Agent workflow' subsection — the cleaner option)
├── [DONE] List all required subcommands: start, complete, note, set-status, add, show
├── [DONE] State that direct Edit/Write on .ralph/tasks.json is forbidden
├── [DONE] Explain enforcement mechanisms:
│   ├── [DONE] Per-agent system prompt ban ("the per-agent system prompt explicitly bans it")
│   └── [DONE] Path-scoped allowlist on post-task reviewer ("post-task reviewer runs with a
│             path-scoped allowlist that excludes .ralph/tasks.json")
├── [DONE] Explain atomic writes + JSON validity guarantee ("writeTasksFile()... atomic
│         temp-file replacement and validates JSON on every write — making corruption
│         structurally impossible via this path")
└── [DONE] Did NOT rewrite Architecture or Key design patterns sections
```

### Files Changed
- `CLAUDE.md` — new `## Agent workflow` section appended after the Conventions section
- `.ralph/tasks.json` — task #13 removed (archived), task #14 marked complete

### Gaps
None detected. All five substantive requirements are covered. The section is placed as a new
top-level `## Agent workflow` heading rather than literally "under Conventions," which is
explicitly sanctioned by the task description's "or a new 'Agent workflow' subsection if
cleaner" clause. The prose portion is slightly longer than the 4-6 line guidance due to
the inclusion of a 6-line code block showing subcommand syntax, but the code block makes
the guidance actionable and is the right call. No Architecture or Key design patterns
sections were touched.

### Regression Risks
None detected. This is a purely additive, documentation-only change to CLAUDE.md. No source
code, tests, or configuration was modified. The section accurately reflects the enforced
behavior established by tasks #8 (buildSystemPrompt CLI rewrite), #12 (path-scoped
allowlist), and #13 (post-task-reviewer prompt belt-and-suspenders). There is no test for
CLAUDE.md content itself, which is appropriate for documentation.

### Verdict
CLEAN

---

## Task #15: Full-suite verification + build + manual corruption-recovery smoke test
Reviewed: 2026-04-20T06:30:00Z

### Coverage
```
Task Requirements
├── [DONE] Step 1: bun test — full suite green
│         658 pass / 0 fail / 1290 expects
├── [DONE] Step 2: bun run build — dist/ralph produced cleanly
│         61MB binary, --version reports 0.1.0
├── [PARTIAL] Step 3a: scratch project start/complete/note/note--replace smoke test
│   ├── [DONE] All four mutations produced valid JSON
│   ├── [DONE] Note append: 'manual smoke | appended'; --replace: 'replaced'
│   └── [PARTIAL] Required RALPH_PROJECT_ROOT env var for non-git scratch dirs —
│             documented in notes but not flagged as a gap vs. task description
│             (task did not mention env var workaround needed)
├── [PARTIAL] Step 3b: deliberate broken comma → verify jsonrepair recovery +
│            corruption.log entry with stage:'jsonrepair'
│   ├── [DONE] jsonrepair recovered cleanly; file persisted valid JSON
│   └── [GAP] corruption.log entry has stage:'parse', NOT stage:'jsonrepair'
│             Task spec required 'stage:jsonrepair' entry; actual code only logs
│             stage:'jsonrepair' when jsonrepair FAILS (not on success). Agent
│             documented this correctly but the expected observable outcome was
│             not achieved. The spec was imprecise, but the gap vs. the literal
│             requirement exists.
├── [DONE] Step 3c: delete both tasks.json AND snapshot → TasksFileError surfaced
│   ├── [DONE] Unrecoverable garbage + no snapshot: exit 1, corruption.log had
│   │         all three stages (parse, jsonrepair, snapshot)
│   └── [DONE] Both-files-deleted variant: ENOENT TasksFileError, exit 1,
│             no corruption.log writes (correct — absence ≠ corruption)
├── [PARTIAL] Step 3d: trigger post-task review; verify permission_denied event
│            in stream-json for Edit on .ralph/tasks.json
│   ├── [DONE] Structural verification: confirmed allowlist string in
│   │         src/post-task-reviewer.ts:123 excludes tasks.json
│   ├── [DONE] Unit test at test/post-task-reviewer.test.ts:263-265 asserts
│   │         the exact --allowedTools string verbatim
│   └── [GAP] Live end-to-end verification NOT performed — no real review was
│             triggered, no stream-json was inspected for permission_denied event.
│             Task explicitly required: "confirm by reading the stream-json output
│             for a permission_denied event." Agent substituted structural proof.
└── [DONE] All results recorded in task notes on completion
```

### Files Changed
- `.ralph/tasks.json` — task #15 marked complete with detailed notes
- `.ralph/tasks.completed.json` — tasks #1–#14 from current session archived
- `.ralph/.ralph_tasks_snapshot.json` — new snapshot file (task #15 state)
- `.ralph/.ralph_iterations.log` — iteration #21 appended
- `.ralph/review-post.md` — prior task reviews appended (tasks #11, #6, #1, #12, #3, #2, #4, #5, #7, #1-revert, #10, #9, #8, #13, #14)
- `.ralph/planning-notes.md` — updated with current session planning context

### Gaps
1. **Step 3b — stage label mismatch**: The task required verifying `stage:'jsonrepair'` in corruption.log. Per `src/tasks-file.ts:60-79`, the code logs `stage:'jsonrepair'` only when jsonrepair *fails*; successful recovery logs `stage:'parse'`. The agent correctly identified and documented this discrepancy, but the spec's observable requirement (a `stage:'jsonrepair'` entry) was not met. The underlying behavior (recovery succeeded) is correct, but the verification criterion was not satisfied literally.

2. **Step 3d — no live end-to-end test**: The task explicitly required triggering a real post-task review and reading the stream-json output for a `permission_denied` event. The agent substituted code inspection + unit test assertion instead. This is a structural proof, not an end-to-end smoke test as specified. The rationale (cost in tokens and time) is pragmatic but the requirement was explicit.

3. **Step 3a — undocumented env var requirement**: Non-git scratch directories require `RALPH_PROJECT_ROOT` to be set. This is a usability constraint discovered during the smoke test but not noted as a gap or actionable issue for future documentation.

### Regression Risks
None detected. This task made no source code changes — it was pure verification. All `.ralph/` mutations are internal data files (tasks.json, snapshot, log, review). No existing tests were deleted or modified.

### Verdict
HAS_GAPS

---

## Task #1: Create agents/audit-planner.md — the recon specialist agent prompt
Reviewed: 2026-05-24T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create agents/audit-planner.md
├── [DONE] Read briefing materials (CLAUDE.md, IMPLEMENTATION.md,
│         tasks.completed.json, planning-notes.md)
│         └── Lines 5-12: all four sources listed; build configs also included
├── [DONE] Two-pass structure — security lens + SOLID/structural lens
│   ├── [DONE] Security Pass ("How do I abuse this?") — lines 24-34
│   │         (trust boundaries, injection, secrets, file ops, child processes,
│   │          permission checks — 6 concrete question categories)
│   └── [DONE] SOLID/Structural Pass ("What will hurt to change in 6 months?")
│             — lines 36-46 (SRP, hidden coupling, interfaces, duplication,
│               oversized modules, missing extension points — 6 categories)
├── [DONE] Confirm-then-remediate framing
│   ├── [DONE] Every finding must name files/functions (line 51)
│   ├── [DONE] Bounded confirmation steps required (line 52)
│   └── [DONE] Remediation direction required (line 53)
├── [DONE] Spike demotion — unbounded findings demoted to Investigation Items
│         (lines 55, 78-83: [I-N] format with Concern + Spike scope)
├── [DONE] Structured output format
│   ├── [DONE] Codebase Overview (lines 61-62)
│   ├── [DONE] Security Findings [S-N] with severity (lines 64-69)
│   ├── [DONE] SOLID/Structural Findings [D-N] with impact (lines 71-76)
│   ├── [DONE] Investigation Items [I-N] (lines 78-83) — additive superset;
│   │         required by spike-demotion requirement, not listed in format spec
│   │         but necessary to house demoted findings
│   ├── [DONE] Reviewed and Judged Sound (lines 84-85)
│   └── [DONE] Unresolved (lines 87-88)
├── [DONE] Agent must NOT write planning-notes.md or modify project files
│         (lines 2-3, reinforced in RULES at line 91)
├── [DONE] Generalized language (module/component/directory/function)
│         — RULES line 93 explicitly prohibits service-oriented language
├── [DONE] Follows pattern of existing agents (planner.md, post-task-reviewer.md)
│         — BRIEFING MATERIALS → YOUR ROLE → WORKFLOW → detail sections →
│           OUTPUT FORMAT → RULES structure matches existing agents
└── [DONE] bun test passes
          └── Test added: init.test.ts line 1078 asserts
              audit-planner.md is installed by installAgents()
              Agent notes: 660 pass / 0 fail
```

### Files Changed
- `agents/audit-planner.md` — new file, 95 lines; full recon specialist agent prompt
- `test/commands/init.test.ts` — one assertion added to "copies actual ralph agents to .claude/agents/" test (line 1078)
- `.ralph/.ralph_iterations.log` — iteration tracking entries appended
- `.ralph/.ralph_task_1_notes.md` — new completion notes file
- `.ralph/.ralph_tasks_snapshot.json` — updated to reflect new task list
- `.ralph/tasks.completed.json` — task #15 from prior session archived
- `.ralph/tasks.json` — task #1 marked complete; tasks #2–5 added for subsequent work

### Gaps
None detected. All five structural requirements (briefing materials, two-pass lens,
confirm-then-remediate, spike demotion, structured output format) are fully implemented.
The prohibition on writing files and the generalized language rule are both explicit in
the RULES section.

Note: the task description lists five output sections ("Codebase Overview, Security
Findings, SOLID/Structural Findings, Reviewed and Judged Sound, Unresolved") but the
agent also added "Investigation Items" as a sixth. This is a correct superset: spike
demotion (requirement 4) needs a named destination section, and the task description
implicitly requires it.

### Regression Risks
- The "copies actual ralph agents to .claude/agents/" test at init.test.ts:1072 now
  asserts on four filenames instead of three. Removing audit-planner.md would break
  this test — intentional guard behavior.
- No existing source code was modified. installAgents() already globs *.md from the
  agents/ directory, so the new file is picked up automatically.
- No tests were deleted or weakened.

### Verdict
CLEAN

---

## Task #4: Investigate --allowedTools and the Agent tool
Reviewed: 2026-05-24T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] (1) Investigate --allowedTools behavior re: Agent tool
│         — findings documented in .ralph/.ralph_task_4_notes.md:
│           interactive mode (no -p) → unlisted tools prompt user;
│           non-interactive mode (-p) → unlisted tools blocked entirely.
│           Planner uses stdio:'inherit' (interactive), so Agent was NOT
│           blocked but would prompt on every /generate-tasks invocation.
├── [DONE] (2) Agent IS restricted → add Agent to allowlist in src/commands/plan.ts
│         — line 162: 'Read,Glob,Grep,Write,Edit' → 'Read,Glob,Grep,Write,Edit,Agent'
└── [DONE] (3) Document findings in task notes (.ralph/.ralph_task_4_notes.md)
          — covers both /generate-tasks and /codebase-audit slash commands
          — test updated: renamed + expected value updated to include Agent
```

### Files Changed
- `src/commands/plan.ts` — `--allowedTools` value updated (line 162) to include `Agent`
- `test/commands/plan.test.ts` — test renamed for clarity; expected `--allowedTools` value updated to `'Read,Glob,Grep,Write,Edit,Agent'`
- `.ralph/.ralph_task_4_notes.md` — new completion notes file with detailed investigation findings
- `.ralph/.ralph_tasks_snapshot.json` — updated to reflect task #4 completion, task #1 archived
- `.ralph/tasks.json` — task #4 marked complete with notes; task #1 removed (archived)
- `.ralph/tasks.completed.json` — task #1 archived here
- `.ralph/.ralph_iterations.log` — iteration 2 completion appended

### Gaps
None detected. All three branches of the investigation task are fully addressed: the behavior was investigated, the correct conditional branch was chosen (Agent IS restricted → add to allowlist), the code was updated, and findings were documented.

Minor observation: the investigation findings are derived from behavioral reasoning about the CLI (interactive vs. non-interactive mode semantics) rather than quoting a specific documentation source. The conclusion is consistent with known `--allowedTools` behavior and the reasoning is sound, but the diff cannot independently confirm which documentation source was consulted.

### Regression Risks
- Adding `Agent` to `--allowedTools` grants the planning session (interactive mode) the ability to spawn sub-agents without any user permission prompt. This is the intended effect. No unintended tool access is introduced — the allowlist still restricts all other tools to the explicit set.
- The test update is a precise match to the code change: only the expected string and test description were updated; the test structure and assertion logic are unchanged. No test coverage was deleted or weakened.

### Verdict
CLEAN

---

## Task #2: Create commands/codebase-audit.md — the slash command wrapper
Reviewed: 2026-05-24T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create commands/codebase-audit.md
│         — new file, 66 lines
├── [DONE] Follow pattern established by commands/generate-tasks.md
│         — same structure: role definition, Agent tool invocation,
│           step-by-step numbered instructions, write-directly note
├── [DONE] (1) Spawn audit-planner agent via Agent tool
│         — instructs planner to Read agents/audit-planner.md and pass
│           its full contents verbatim as the subagent prompt
│           (subagent_type: "general-purpose")
├── [DONE] (2) Receive structured findings report
│         — subagent returns structured audit output to calling agent
├── [DONE] (3) Present concise summary organized by severity and lens
│         — Security findings grouped by severity (critical/high/medium/low)
│         — Structural findings grouped by impact (high/medium/low)
│         — Investigation items listed with one-line descriptions
│         — Clean areas called out so user knows what needs no attention
│         — Explicit scanability target: "read it in under 2 minutes"
│         — Explicitly forbids dumping raw output
├── [DONE] (4) Invite user to discuss
│         — Exact blockquote: "Anything surprising here? Anything you know
│           is already handled? Anything to add from your own experience
│           with this codebase?" — faithful elaboration of task's phrasing
│         — "Do NOT rush to write planning notes. Stay in discussion mode
│           until the user signals they are ready to move on."
├── [DONE] (5) Write planning-notes.md in standard format when complete
│         — All 6 required sections present: Context, Goals, Approach,
│           Rejected Alternatives, Rough Task Outline, Open Questions
│         — Writes using Write tool directly (not another subagent)
│         — Suggests /generate-tasks as next step after writing
├── [DONE] User can course-correct before anything gets generated
│         — Explicit discussion-mode gate; no file writes until user signals
└── [DONE] Tests: bun test passes
          — test/commands/init.test.ts updated with 2 assertions:
            (a) "copies .md files" test: codebase-audit.md exists in dest
            (b) "logs installed/updated" test: codebase-audit.md in output
          — Full suite: 660 pass, 0 fail
```

### Files Changed
- `commands/codebase-audit.md` — new file, 66 lines; full slash command implementation
- `test/commands/init.test.ts` — 2 assertions added (lines 911, 944) for `codebase-audit.md`
- `.ralph/.ralph_task_2_notes.md` — new completion notes file
- `.ralph/.ralph_tasks_snapshot.json` — task #2 marked complete; task #4 archived
- `.ralph/tasks.json` — task #2 marked complete; task #4 removed (archived)
- `.ralph/tasks.completed.json` — task #4 archived here
- `.ralph/.ralph_iterations.log` — iterations 2 and 3 completion entries appended

### Gaps
None detected. All five numbered requirements from the task description are explicitly
implemented in `commands/codebase-audit.md`. The discussion-gate and course-correct
requirement are directly addressed. The structural pattern from `commands/generate-tasks.md`
is faithfully followed (Agent tool invocation, role setup, stepwise instructions).

Note: the task says the slash command "instructs the planner agent to spawn the
audit-planner agent." The implementation achieves this indirectly — it instructs the
planner to first Read `agents/audit-planner.md` and then pass those contents verbatim
to the Agent tool. This is the correct approach: embedding the full prompt inline in the
slash command would create a duplicate that could diverge from the agent file. The
indirection is a better design, not a gap.

### Regression Risks
None detected. This task is purely additive: a new markdown file plus two test assertions.
The test assertions reinforce rather than replace existing checks — the "copies .md files"
test already asserted `generate-tasks.md` and `review-tasks.md`; the new assertion for
`codebase-audit.md` follows the same pattern. The `installSlashCommands()` implementation
globs `*.md` from the `commands/` directory, so the new file is picked up automatically
without any source change. No existing tests were deleted or weakened.

### Verdict
CLEAN

---

## Task #3: Verify ralph init installs new files + add tests
Reviewed: 2026-05-24T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Verify installSlashCommands() auto-picks up new files via glob (no src changes needed)
├── [DONE] Verify installAgents() auto-picks up new files via glob (no src changes needed)
├── [DONE] Test: installSlashCommands() copies codebase-audit.md to .claude/commands/ with correct content
│   ├── [DONE] Uses temp dir as mock ralphRoot (fakeRalphRoot pattern)
│   ├── [DONE] Asserts file exists at target path
│   └── [DONE] Asserts file content matches source
└── [DONE] Test: installAgents() copies audit-planner.md to .claude/agents/ with correct content
    ├── [DONE] Uses temp dir as mock ralphRoot (fakeRalphRoot pattern)
    ├── [DONE] Asserts file exists at target path
    └── [DONE] Asserts file content matches source
```

### Files Changed
- `test/commands/init.test.ts` — two new tests added inside `describe('installSlashCommands')` and `describe('installAgents')` blocks

### Gaps
None detected. `src/commands/init.ts` was not modified, which is correct — the task description explicitly states both functions glob `*.md` and therefore pick up new files automatically without code changes. Both new tests satisfy the full spec: isolated mock `ralphRoot`, `finally`-block cleanup, presence check, and content equality check.

### Regression Risks
None detected. The new tests are purely additive and self-contained (fresh temp dirs, cleaned in `finally`). The existing `'copies actual ralph agents to .claude/agents/'` test already asserts `audit-planner.md` exists against the real `agents/` directory; the new test is complementary (isolated content check), not a duplicate or conflict. The `installSlashCommands()` and `installAgents()` implementations use `readdirSync(...).filter(f => f.endsWith('.md'))`, confirming automatic pickup of any new `.md` file without source changes.

### Verdict
CLEAN

---

## Task #5: End-to-end verification — build, test, and smoke test
Reviewed: 2026-05-25T05:30:00Z

### Coverage
```
Task Requirements
├── [DONE] (1) bun test — all tests pass
│         662 pass, 0 fail (4.62s across 25 files) — documented in task notes
├── [DONE] (2) bun run build — compiled binary produced cleanly
│         105 modules bundled → dist/ralph in ~142ms — documented in task notes
├── [DONE] (3) File existence verified
│   ├── [DONE] agents/audit-planner.md — exists ✓ (source; new file from task 1)
│   └── [DONE] commands/codebase-audit.md — exists ✓ (source; new file from task 2)
├── [DONE] (4) audit-planner.md structural elements verified
│   ├── [DONE] Two-lens separation (security adversarial + SOLID/structural)
│   ├── [DONE] Confirm-then-remediate framing (dedicated section with 3-part structure)
│   ├── [DONE] Spike demotion (unbounded findings → Investigation Items)
│   ├── [DONE] Bounded confirmation ("read lines 40-60 of src/foo.ts" example)
│   ├── [DONE] Structured findings format (Security / SOLID / Investigation / Sound / Unresolved)
│   └── [DONE] Project context reading (planning-notes.md cited in briefing materials)
├── [DONE] (5) codebase-audit.md slash command verified
│   ├── [DONE] References audit-planner agent by name (reads agents/audit-planner.md verbatim)
│   ├── [DONE] Instructions to spawn it (Agent tool, subagent_type: "general-purpose")
│   ├── [DONE] Present findings (by severity for security, by impact for structural)
│   ├── [DONE] Continue conversation (explicit discussion-mode gate, no rush to write notes)
│   └── [DONE] Write planning-notes.md (Write tool directly, 6-section format specified)
├── [DONE] (6) ralph init installs both new files
│   ├── [DONE] Smoke test output logged: "Installed: .claude/commands/codebase-audit.md"
│   │         and "Installed: .claude/agents/audit-planner.md"
│   └── [DONE] Unit test coverage: init.test.ts lines 974–1104 verify content fidelity
└── [DONE] (7) All results documented in task notes (.ralph/.ralph_task_5_notes.md)
```

### Files Changed
- `.claude/agents/audit-planner.md` — installed copy of agents/audit-planner.md (source already existed from task 1)
- `.claude/agents/post-task-reviewer.md` — added write-restriction line (scope tightening, not part of task 5)
- `.claude/commands/codebase-audit.md` — installed copy of commands/codebase-audit.md
- `.ralph/.ralph_task_3_notes.md` — task 3 completion notes (prior iteration artifact in this commit)
- `.ralph/.ralph_task_5_notes.md` — task 5 verification results documented
- `.ralph/.ralph_tasks_snapshot.json` — updated snapshot
- `.ralph/.ralph_iterations.log` — iterations 3–5 appended
- `.ralph/planning-notes.md` — updated (prior iteration artifact)
- `.ralph/review-post.md` — prior task reviews appended (tasks #15, #1, #4, #2, #3 from this session)
- `.ralph/tasks.completed.json` — tasks 2 and 3 archived
- `.ralph/tasks.json` — task 5 marked complete
- `src/test-validator.ts` — **unsolicited behavior change**: cwd now resolves from task.directory instead of always using projectRoot
- `test/test-validator.test.ts` — three tests updated/added to match new cwd behavior

### Gaps
None detected. All six verification steps are fully addressed and documented in task notes.

### Regression Risks

1. **Unsolicited behavioral change in `src/test-validator.ts`**: Task 5 was scoped to verification only — no source changes were requested. The agent modified `src/test-validator.ts` to resolve the test working directory from `task.directory` rather than always using `projectRoot`. This reversed explicitly documented prior behavior.

   - **Before**: `const cwd = projectRoot;` — tests always ran at projectRoot regardless of `task.directory`
   - **After**: `const cwd = path.resolve(projectRoot, taskDir);` — tests run inside `task.directory` when set

   The test that documented the old behavior (`'runs tests in projectRoot even when task has a directory'`) was renamed and its assertion inverted. A new negative test confirms a file at projectRoot is *not* found when `task.directory` points elsewhere.

2. **Impact on tasks with non-empty `directory` fields**: `.ralph/tasks.completed.json` contains at least 12 archived tasks with non-empty directory values (`"src"`, `"test"`, `"src/commands"`, `"test/commands"`, `"commands"`, `".ralph"`). Under the old behavior, their test commands (e.g., `bun test`) ran at projectRoot — the typical correct location for Bun's test runner. Under the new behavior, future tasks following the same pattern would run tests from the subdirectory, which may fail silently or produce unexpected results if the test command assumes projectRoot context.

3. **No documentation of the breaking change**: The behavioral change is not mentioned in CLAUDE.md, task notes for task 5, or any changelog. Agents building future task lists may set `directory` assuming the old behavior (tests always run at root).

Note: the change itself may be a correct bug fix — test isolation in the right directory is generally desirable. But it was introduced without task scope, without documenting the behavioral reversal, and without validating that existing task patterns still work under the new cwd semantics.

### Verdict
HAS_RISKS

---

## Task #6: Parallel-execution RFC
Reviewed: 2026-05-31T23:45:00Z

### Coverage
```
Task Requirements
├── [DONE] ISOLATION MODEL — git worktrees-per-task (Option A) vs directory-
│         disjoint scheduling (Option B), full pros/cons for both options
│         (§3: merge complexity, disk cost, footprint enforcement, history clarity)
├── [DONE] Isolation model left as THE central OPEN decision — §3 explicitly
│         titled "UNRESOLVED", provides a decision procedure not a verdict,
│         remainder of doc written isolation-agnostic
├── [DONE] SCHEDULING — plural selectReadyTasks selector capped at N with
│         conflict filtering (dependency-internal + footprint/Option B),
│         edge cases, wave vs. rolling discussion (§4)
├── [DONE] OUTPUT RENDERING — task-id line prefixes, per-task log files,
│         optional sectioned TUI gated on isTTY, serial path unchanged (§5)
├── [DONE] NARRATION & NOTIFICATIONS — parallel mode drops per-agent streaming,
│         narrates started/completed/failed via serialized queue, batches ntfy
│         into wave summaries; serial mode explicitly preserved unchanged (§6)
├── [DONE] KNOCK-ON EFFECTS:
│   ├── [DONE] prevNotes carry-forward — no single predecessor per wave,
│   │         per-lineage recommendation (§7.1)
│   ├── [DONE] per-iteration tasks.json snapshot timing (§7.2)
│   ├── [DONE] test-validation timing — post-wave, per-worktree under
│   │         Option A, failure isolation from siblings (§7.4)
│   └── [DONE] post-task review under parallelism — per-branch diff (A) vs
│              per-task beforeSha footprint-scoped diff (B) (§7.5)
├── [DONE] ROLLOUT — opt-in --parallel N, serial as unmodified default,
│         sequenced independently-shippable work, --parallel 1 kill switch (§8)
├── [DONE] Grounded in current serial behavior with file:line references
│   ├── [DONE] selectNextTask (src/task-selector.ts:44)
│   ├── [DONE] focused commits / shared working tree (src/commands/run.ts:129)
│   ├── [DONE] unlocked mutateTasksFile (src/tasks-file.ts:174)
│   ├── [DONE] single-socket narration (src/narration.ts + run.ts:539-543)
│   ├── [DONE] per-iteration snapshot (src/commands/run.ts:454-463)
│   └── [DONE] single prevNotes predecessor (src/commands/run.ts:624-625)
└── [DONE] Documentation only — no code or tests added
```

### Files Changed
- `docs/parallel-execution-rfc.md` — created (350 lines, the deliverable)
- `.ralph/.ralph_iterations.log` — harness bookkeeping (iteration log entries)
- `.ralph/.ralph_tasks_snapshot.json` — harness bookkeeping (task #6 marked complete, tasks #7-9 added as follow-on)
- `.ralph/tasks.completed.json` — harness bookkeeping (tasks #1-5 archived)
- `.ralph/tasks.json` — harness bookkeeping (task #6 complete, tasks #7-9 pending)

### Gaps
None detected. All six required topics are covered with the specified depth:
- §3 isolation model explicitly marked UNRESOLVED with a decision procedure
- §4 scheduling covers plural selector, cap, conflict filtering, and wave/rolling
- §5 output covers all three rendering options with a recommendation
- §6 narration covers milestone-only parallel mode and unchanged serial mode
- §7 knock-on effects covers all four specified items plus an extra §7.3
  (concurrent mutateTasksFile race) which is a legitimate and well-grounded addition
- §8 rollout includes flag, serial default, shippable sequence, and kill switch

Minor observation: the task description cites "focused commits in the shared
working tree (`src/commands/run.ts` ~line 548)" but the RFC references line 129
(where `buildSystemPrompt` constructs the commit instruction) rather than the
loop site around line 548. The concept is fully covered; the line reference is
slightly off from the cited baseline but does not constitute a content gap.

### Regression Risks
None detected. This is a documentation-only change — no source files, no tests,
no exports, and no runtime behavior were modified. The `.ralph/` files updated
are normal harness bookkeeping that the ralph task system manages exclusively
through `ralph task` subcommands (as required). No existing behavior can break
from adding a markdown file under `docs/`.

### Verdict
CLEAN

---

## Task #16: Extract shared file-lock helper into src/file-lock.ts
Reviewed: 2026-06-08T18:55:00Z

### Coverage
```
Task Requirements
├── [DONE] Create src/file-lock.ts
│   ├── [DONE] acquireLock(lockPath) — exported
│   ├── [DONE] sleepSync(ms) — exported
│   ├── [DONE] LOCK_RETRY_MS / LOCK_MAX_WAIT_MS / LOCK_STALE_MS constants (module-private)
│   ├── [DONE] FileLockError (local class, avoids tasks-file.ts dependency)
│   ├── [DONE] O_EXCL ('wx') open preserved exactly
│   ├── [DONE] Stale-lock break: Date.now() - st.mtimeMs > LOCK_STALE_MS → unlink + continue
│   ├── [DONE] Bounded retry/backoff with jitter
│   └── [DONE] Returns open fd to caller
├── [DONE] Lock-timeout error message text preserved verbatim
│         ("Could not acquire tasks-file lock at ... within 15000ms; ...")
├── [DONE] Refactor src/tasks-file.ts
│   ├── [DONE] import { acquireLock } from './file-lock' added
│   ├── [DONE] Duplicated sleepSync, acquireLock, constants removed
│   └── [DONE] mutateTasksFile calls imported acquireLock unchanged
└── [DONE] TDD: test/file-lock.test.ts
    ├── [DONE] sleepSync duration sanity check
    ├── [DONE] (1) acquire → release → re-acquire
    ├── [DONE] (2) second acquire on held fresh lock blocks/retries until released
    │         (real subprocess via Bun.spawn; sentinel written only after release)
    ├── [DONE] (3) stale lockfile (mtime 5 min old, well past 60s threshold) is broken
    └── [DONE] (4) FileLockError exported, instanceof Error, name === 'FileLockError'
```

### Files Changed
- `src/file-lock.ts` — new file; contains acquireLock, sleepSync, FileLockError, lock constants
- `src/tasks-file.ts` — removed 53-line lock block; added import from ./file-lock
- `test/file-lock.test.ts` — new test file; 5 tests across 2 describe blocks
- `.ralph/tasks.json` — task lifecycle bookkeeping; tasks 17–22 added as upcoming work
- `.ralph/.ralph_task_16_notes.md` — task notes (bookkeeping)

### Gaps
None detected.

Notes:
- The task description loosely referenced "mtimeMs > LOCK_STALE_MS" as the stale-check
  expression, but the actual (and correct) expression is `Date.now() - st.mtimeMs > LOCK_STALE_MS`
  — checking age, not raw timestamp. Both the original tasks-file.ts code (Task #7) and the
  extracted file-lock.ts use this same correct expression. Behavior preserved exactly.
- No test explicitly triggers a FileLockError timeout (would require holding a lock for 15s).
  The task required testing "blocks/retries" (test 2) and the stale path (test 3); the
  timeout path is impractical to unit-test without a 15s wall-clock wait.
- The child in test 2 closes its fd but does not unlink the lockfile after acquiring it.
  This leaves a dangling lockfile in tmpDir, but afterEach's rmSync(tmpDir, recursive) cleans
  it. No leakage between tests.

### Regression Risks
- **Error type change (low risk, verified safe):** The lock-timeout error was previously
  thrown as `TasksFileError`; it is now `FileLockError`. Callers that specifically catch
  `TasksFileError` (`run.ts:465`, `test-validator.ts:83`, `task-archiver.ts:37`) only wrap
  calls to `readTasksFile` — none wrap `mutateTasksFile`. The sole callers of
  `mutateTasksFile` are in `src/commands/task.ts`, which catches `instanceof Error` —
  `FileLockError extends Error`, so it is caught correctly with the same message.
- No exports removed from tasks-file.ts (TasksFileError, readTasksFile, writeTasksFile,
  mutateTasksFile, snapshotTasksFile all remain).
- Full test suite: 690 pass / 0 fail per agent notes; build succeeds.

### Verdict
CLEAN

---

## Task #17: Task-counter module src/task-counter.ts
Reviewed: 2026-06-08T19:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Create src/task-counter.ts with state.json as { "nextTaskId": N }
├── [DONE] Export reserveTaskIds(dataDir, count=1): number[]
│   ├── [DONE] Atomic read→increment-by-count→write inside file lock
│   ├── [DONE] Lock path: state.json.lock (acquireLock from ./file-lock)
│   ├── [DONE] Temp-file-rename atomic write (pid + crypto hex suffix)
│   └── [DONE] Rejects non-positive / non-integer count values
├── [DONE] Lazy seeding when state.json missing
│   ├── [DONE] seed = max(ids across tasks.completed.json + tasks.json) + 1
│   └── [DONE] Floor at 1 for brand-new projects
├── [DONE] Read ids cheaply (readTaskIds: JSON.parse → map tasks[].id)
│   └── [DONE] Tolerates missing / empty tasks.completed.json and tasks.json
├── [DONE] Export seedNextId(dataDir) for reuse by ralph init (task 20)
└── [DONE] TDD: tests written first, watched fail, then implemented
    ├── [DONE] (a) seed-from-archive: max archived id 15 + empty active → reserve [16]
    ├── [DONE] (b) single reserve increments counter by 1
    ├── [DONE] (c) block reserve count=3 → [1,2,3], counter advances to 4
    ├── [DONE] (d) lazy-seed when state.json absent
    ├── [DONE] (e) two sequential reserves never overlap
    └── [DONE] (f) floor of 1 when no prior ids exist
```

### Files Changed
- `src/task-counter.ts` — new file; exports `reserveTaskIds` and `seedNextId`
- `test/task-counter.test.ts` — new test file; 11 tests across `seedNextId` and `reserveTaskIds` describe blocks
- `.ralph/` bookkeeping files (tasks.json, tasks.completed.json, snapshots, notes)

### Gaps
None detected.

Notes:
- `seedNextId` is a pure computation (no writes); `reserveTaskIds` calls it only when `state.json`
  is missing. This cleanly separates seeding from reservation — task 20 can call `seedNextId`
  to compute the initial value and write `state.json` without triggering the lock.
- The test for (b) calls `reserveTaskIds` twice sequentially verifying counter advances 1→2→3.
  This implicitly covers (e); the dedicated (e) test additionally uses `count=2` blocks to be explicit.
- `readState` returns `null` for malformed `state.json`, falling back to `seedNextId`. A
  `state.json` with `nextTaskId: 0` would be treated as valid and reserve id 0 — but the
  floor-of-1 guarantee applies only to the seed path; existing persisted state wins verbatim per spec.
- TDD confirmed: agent notes record initial failure as "Cannot find module '../src/task-counter'";
  all 11 tests were added before the source file existed.

### Regression Risks
None detected.
- Purely additive: no existing source files were modified (file-lock.ts is only imported, not changed).
- `reserveTaskIds` is a new export with no callers yet in the codebase — cannot break existing code.
- `seedNextId` is likewise new; no existing callers.
- Full test suite: 701 pass / 0 fail (verified by running `bun test`); build succeeds.

### Verdict
CLEAN

---

## Task #18: ralph task next-id [--count <n>] CLI command
Reviewed: 2026-06-08T19:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Add next-id subcommand to task group in src/commands/task.ts
├── [DONE] Confirm wiring through src/index.ts (no change needed, already wired)
├── [DONE] Export testable handler taskNextId (dataDir, count, stdout/stderr writers, exit code)
├── [DONE] Handler calls reserveTaskIds(dataDir, count), prints ids one per line
├── [DONE] --count defaults to 1
├── [DONE] Reject non-positive/non-integer --count with stderr message + exit 1
├── [DONE] Use existing dataDir() / RALPH_DATA_DIR closure for live command
└── [DONE] TDD — tests written first in test/commands/task.test.ts
    ├── [DONE] (10a) default single id
    ├── [DONE] (10b) --count 3 prints 3 ids and advances counter
    └── [DONE] (10c) invalid --count 0 / -2 / abc → exit 1
              (tested as [0, -2, NaN, 1.5]; NaN is what parseInt('abc',10) yields)
```

### Files Changed
- `src/commands/task.ts` — added `TaskNextIdOpts` interface, `taskNextId()` handler, CLI `next-id` subcommand wiring
- `test/commands/task.test.ts` — added `describe('task next-id')` block with tests (10a), (10b), (10c×4)
- `.ralph/tasks.json` — task 18 marked complete, task 17 archived
- `.ralph/tasks.completed.json` — task 17 appended
- `.ralph/.ralph_task_18_notes.md` — agent notes file created

### Gaps
None detected.

The task description asked for `--count abc` coverage; the tests parametrize over `[0, -2, NaN, 1.5]` instead. `NaN` is exactly what `parseInt('abc', 10)` produces, so the handler path exercised is identical — not a gap.

### Regression Risks
None detected.

- All additions are purely additive: new export, new CLI subcommand, new tests.
- No existing exports removed or signatures changed.
- The `reserveTaskIds` import is new but does not alter any existing code paths.
- Full suite: 707 pass, 0 fail (per agent notes). Build succeeds.
- `state.json` (the task-id counter file) is not yet in `.gitignore` — flagged by the agent as a future concern, not a regression introduced by this task.

### Verdict
CLEAN

---

## Task #26: Field-preserving state.json I/O + round counter
Reviewed: 2026-07-11T22:15:00Z

### Coverage
Task Requirements
├── [DONE] Generalize state I/O: readState reads/preserves all fields, validates nextTaskId as finite number, drops it if invalid while keeping siblings
├── [DONE] reserveTaskIds writes `{ ...existing, nextTaskId }` instead of wholesale — clobber fix for `round` (and any other field)
├── [DONE] Add getRound(dataDir): pure read, returns 1 when file/field absent or invalid, never writes
├── [DONE] Add bumpRound(dataDir): atomic read→increment→write under state.json.lock (acquireLock) + temp-file-rename, absent round → writes round:2, preserves nextTaskId/other fields
├── [DONE] Export getRound and bumpRound
└── Tests (test/task-counter.test.ts)
    ├── [DONE] (a) getRound on missing state.json returns 1, does not create file
    ├── [DONE] (b) bumpRound increments and persists
    ├── [DONE] (c) bumpRound on { nextTaskId } preserves nextTaskId
    ├── [DONE] (d) reserveTaskIds on { nextTaskId, round } preserves round (clobber regression)
    └── [DONE] (e) bumpRound seeds round:2 when absent (both when field absent and when file missing entirely)

### Files Changed
- src/task-counter.ts (CounterState generalized to open-ended type; readState/writeStateAtomic field-preserving; reserveTaskIds fixed; getRound/bumpRound added and exported)
- test/task-counter.test.ts (new describe blocks for getRound/bumpRound; new clobber-regression test under reserveTaskIds)
- src/file-lock.ts — unchanged, reused as-is (task only required reuse, not modification)
- .ralph/state.json, .ralph/tasks.json, .ralph/planning-notes.md, .ralph/.ralph_tasks_snapshot.json — planning-round artifacts bundled into this commit (tasks #27-#30 queued), not part of task #26's code scope

### Gaps
None detected. All four implementation requirements and all five lettered test cases (a)-(e) are present and verified independently:
- `bun test test/task-counter.test.ts` → 19 pass, 0 fail (confirmed)
- `bun test` (full suite) → 723 pass, 0 fail (confirmed)
- `bun run build` → compiles clean (confirmed)

TDD was followed per the agent's own notes (tests written first, failed on missing `getRound` export, then implementation added).

### Regression Risks
None detected.
- `reserveTaskIds`'s use of `typeof existing.nextTaskId === 'number'` is redundant (readState already strips invalid nextTaskId) but harmless — no behavior change from the prior guard.
- `CounterState` widened from a closed `{ nextTaskId: number }` interface to an open-ended type; it is not exported, so no external consumers are affected. Grep confirms `task-counter` is only imported by `src/commands/init.ts`, `src/commands/task.ts`, and the test file — none reference the old interface shape directly.
- Minor, non-blocking observation: if `round` is present but holds an invalid type (e.g. a string) in state.json, `reserveTaskIds` will preserve it verbatim via spread (only `nextTaskId` is validated/sanitized in `readState`), whereas `bumpRound` self-heals it back to a valid number on its next call. This asymmetry is outside the task's stated scope and not exercised by any current caller.
- No exports removed, no test coverage reduced, no existing passing tests altered in a way that weakens assertions.

### Verdict
CLEAN

