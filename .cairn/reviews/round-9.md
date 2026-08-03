## Task #69: Broaden isCantRunError so a command that ran no tests is never a real failure
Reviewed: 2026-08-03T22:30:00Z

### Coverage
```
Task Requirements
├── [DONE] (1) Add `filenotfound` and `file not found` to CANT_RUN_PATTERNS
├── [DONE] (2) Add bun's non-matching-filter signal, verified via actual run
│             ("did not match any test files" — matches measured output)
├── [PARTIAL] (3) ZERO-TESTS-RAN check "regardless of exit code"
│   ├── [DONE] Regex patterns added (ZERO_TESTS_PATTERNS) and wired into isCantRunError
│   └── [GAP] Only reachable when exitCode !== 0 — validateTaskTests (test-validator.ts:135)
│             does `if (exitCode === 0) continue;` BEFORE isCantRunError is ever called,
│             so a command that exits 0 with zero tests executed is still classified
│             'passed', never 'error'/can't-run
├── [DONE] IMPORTANT clause: runCommand widened to capture stdout+stderr, both fed
│             to the classifier
└── [PARTIAL] TDD: failing cases written and confirmed red before green, but the
              "zero tests ran" test case exercises only the exit-1 variant — the
              exit-0 variant (which the implementer's own notes document as the
              *actual* bun behavior for a zero-test suite) is never exercised
```

### Files Changed
- src/test-validator.ts
- test/test-validator.test.ts
- .cairn/tasks.json / .cairn/.cairn_tasks_snapshot.json (task bookkeeping only)

### Gaps
- **Requirement (3) is not actually "regardless of exit code."** `src/test-validator.ts:131-135`:
  ```
  for (const cmd of task.tests) {
    const { exitCode, stdout, stderr } = await runCommand(cmd, cwd, timeoutMs);
    const output = `${stdout}\n${stderr}`;

    if (exitCode === 0) continue;
    ...
    if (isCantRunError(output, exitCode)) { ... }
  ```
  `isCantRunError` — and therefore the new `ZERO_TESTS_PATTERNS` check — is only ever invoked
  after the `exitCode === 0` early-continue. The task description's own measured example is
  exactly the case this misses: the implementer's completion notes state "Zero-test suite
  (exit 0), stderr: `Ran 0 tests across 1 file. [7.00ms]`" — i.e. real bun output for a
  file that matched the filter but contained no test cases exits **0**, not non-zero. That
  exact scenario hits `continue` at line 135 and is silently treated as `'passed'`, never
  reaching the zero-tests classifier at all.
  Practically: a task whose test command exits 0 but ran zero tests (e.g. an empty/broken
  test file, a typo that emptied a describe block, a misconfigured build) is validated as
  fully passing with no note and no error — worse than being classified can't-run, since
  nothing in the task's notes or status signals that no tests actually ran. This directly
  contradicts the bolded instruction "classify as can't-run **regardless of exit code**."
- **Untested as a result**: the new test "returns error when zero tests ran, even on a
  non-zero exit code" (test/test-validator.test.ts) only covers the exit-1 variant of this
  signal. No test exercises the exit-0 case, so the gap above shipped without a failing test
  to catch it — despite the implementer having personally verified and documented the exit-0
  wording in the same notes.

### Regression Risks
- None found. No exports removed, no existing tests deleted or weakened (5 new cases added
  to the existing 'infrastructure errors (cant run)' block; the old behavior for the
  `exitCode !== 0` path is a strict superset of before). `runCommand`'s return shape changed
  (`stderr` → `{ stdout, stderr }`), but it's an internal, non-exported helper with a single
  call site inside the same file, so no external caller can break.
- Pre-existing, acknowledged trade-off (not a new regression): the broadened
  `CANT_RUN_PATTERNS` substrings (`filenotfound`, `file not found`) can misclassify a real
  test-assertion failure that happens to contain that text as infrastructure rather than a
  real failure. The author flagged this bias explicitly in the task notes as intentional and
  in the safer direction; noting it here only for completeness.

### Verdict
HAS_GAPS

---

## Task #70: Per-command cwd resolution in test-validator.ts
Reviewed: 2026-08-03T22:45:00Z

### Coverage
```
Task Requirements
├── [DONE] Per-COMMAND (not per-task) resolution — resolveCommandCwd() called
│             inside the `for (const cmd of task.tests)` loop, once per command
├── [DONE] Default cwd = <projectRoot>/<task.directory> — resolveTaskDir()
├── [DONE] Pre-flight redirect to root only when a path-shaped token resolves
│             at root but not at the task dir — no try-then-fallback (verified:
│             runCommand is called exactly once per test entry)
├── [DONE] Path-shaped-argument rule explicitly settled and documented in a
│   │         comment block above the helpers
│   ├── [DONE] Included shapes tested: slash-bearing (`test/config.test.ts`),
│   │             bare filename with extension (`config.test.ts`)
│   └── [DONE] Excluded shapes tested: flag with embedded path (`--outfile=...`),
│                 scoped package (`@scope/pkg`), bare extensionless word (`build`),
│                 dotted non-alphabetic-extension token (`1.2.3`)
├── [DONE] Resolver kept private — tokenizeCommand/isPathShaped/resolveTaskDir/
│             resolveCommandCwd are all unexported
├── [DONE] src/health-check.ts untouched, stays root-only (not in diff)
├── [DONE] Preserves directory '/' → projectRoot behavior (dedicated test retained)
├── [DONE] Mixed-command case: cwd decided per command within one task
│             ("decides cwd per command, not per task, for a mixed command list")
└── [DONE] TDD: old root-only-contract tests rewritten to the new contract rather
              than deleted (one flips its expected outcome, matching the task's
              explicit call-out); new cases added for path-shape rule and mixed
              commands; `bun test test/test-validator.test.ts` → 36 pass (was 27,
              net +9, no coverage removed); full suite → 813 pass, 0 fail
```

Verified independently (not just from the notes): ran `bun test test/test-validator.test.ts` (36 pass/0 fail) and `bun test` (813 pass/0 fail) directly, and `bun build --target=bun src/index.ts --outfile /tmp/...` to confirm the throwaway-outfile health check still builds clean. Traced the only production call site (`src/commands/run.ts:602`) — it passes `{ task, tasksFilePath, projectRoot }` with no other assumptions about cwd, so no caller-side breakage. Manually re-derived the regex/tokenizer behavior against the task's own examples (`test/config.test.ts`, `--outfile=dist/cairn`, `@scope/pkg`, `1.2.3`, `config.test.ts`) and confirmed each classifies as the tests assert.

### Files Changed
- src/test-validator.ts
- test/test-validator.test.ts
- .cairn/tasks.json / .cairn/tasks.completed.json / .cairn/.cairn_tasks_snapshot.json / .cairn/state.json (task bookkeeping only)

### Gaps
None that violate the task's explicit requirements. One unrequested edge case worth flagging for awareness, not a shipped defect:

- **Output-redirection targets aren't excluded from "path-shaped."** A command like `bun test > out.log` would treat `out.log` as a path-shaped candidate. In practice this is inert unless a stray `out.log` happens to exist at the project root but not the task dir, in which case the command would be redirected to root for a token that was never meant to be an input path. The task description only required excluding flags (`--outfile`, `-p`) and scoped packages (`@scope/pkg`) as the "too broad" examples to guard against — output redirects weren't named, and the failure mode requires a coincidental stray file, so this is a minor edge case rather than a missed requirement.

### Regression Risks
- None found. `src/health-check.ts` is untouched, matching the task's explicit "stays root-only" constraint. The resolver helpers are new, unexported, and single-call-site, so nothing external can depend on their absence. The old `cwd resolution` describe block's coverage was rewritten in place (4 tests → 13), not deleted — including the one test guarding the #68 regression (`runs from projectRoot when a path argument resolves only there`), which still passes.
- `cairn.json`'s `healthCheck` was not modified in this diff and `./install.sh` was not run, consistent with the round's pin/unpin constraint (confirmed via `git diff HEAD~1 -- cairn.json` showing that file's only change predates this commit).

### Verdict
CLEAN

---

## Task #71: Consecutive-revert guard plus blocked-aware run summary
Reviewed: 2026-08-03T22:50:00Z

### Coverage
```
Task Requirements
├── [DONE] In-memory, per-run, per-task counter of consecutive validation
│             reverts — `consecutiveReverts: Map<number, number>` scoped inside
│             runRun(), not a Task field, not persisted
├── [DONE] At threshold (2) → status set to 'blocked' with an explanatory note
│   │         — REVERT_BLOCK_THRESHOLD = 2, no cairn.json knob added
│   ├── [DONE] Note says why (repeated post-iteration validation failure)
│   └── [DONE] Note says which command failed — summarizeFailure(validation.message)
│                 embeds the failing command, collapsed to one line, capped at 300 chars
├── [DONE] Loop continues to other work after blocking — verified end-to-end via
│             makeGuardDeps: task 1 blocked after 2 reverts, loop then picks up
│             and completes task 2 (spawnClaude asserted called exactly 3×)
├── [DONE] Counter resets on clean validation — 'passed' deletes the map entry;
│             fail→pass→fail sequence test proves it never reaches threshold
├── [DONE] Counter also reset after blocking fires — so a human unblocking the
│             task mid-run gets a fresh pair of attempts (not in the task's
│             literal ask, but directly serves "let the loop continue" intent)
├── [DONE] Works standalone from tasks #69/#70 — reads deps.validateTaskTests's
│             return value directly, no assumption either layer landed
├── [DONE] 'blocked' write routed through mutateTasksFile (same locked/atomic/
│             snapshotted path as `cairn task` mutations) — new `blockTask` dep,
│             not a direct tasks.json write
├── [DONE] Completion-flag / summary fix — blockedCount computed from a FRESH
│   │         tasks.json read (catches agent-blocked tasks too, not just this
│   │         run's own guard), gated via `allClear = completedByFlag && blockedCount === 0`
│   ├── [DONE] "Tasks blocked: N" line, "NO ACTIONABLE TASKS REMAIN" status text
│   │             specifically inside the completedByFlag branch (as required)
│   ├── [DONE] Blocked also counted/logged on the no-flag stop path
│   └── [DONE] ntfy tags 'warning' + title 'Cairn - Blocked' instead of 'tada'/'Complete'
│                 when blocked and not all-clear
└── [DONE] TDD — 8 new tests in test/commands/run.test.ts covering single-revert
              (no block), two-consecutive-reverts (blocks + loop moves on),
              reset-on-clean, iteration-log entry, and all four summary/ntfy
              variants; notes claim 5 red before implementation (not independently
              re-run, but the test bodies match the described assertions exactly)
```

Verified independently: read the actual diff hunks in `src/commands/run.ts` (guard block ~:645-675, summary block ~:723-784) and `src/tasks-file.ts`'s `mutateTasksFile` (confirms lock/read/write/snapshot semantics match the "same path every `cairn task` mutation takes" claim). Confirmed the `t.notes ? \`${t.notes} | ${note}\` : note` append pattern matches the existing convention used in `src/commands/task.ts:142` and `src/test-validator.ts:263` — not a one-off format. Traced through the new `makeGuardDeps`/`makeSummaryDeps` test helpers by hand against the guard and summary logic to confirm the assertions (e.g. exactly 3 `spawnClaude` calls) follow from the wiring rather than being coincidentally true.

### Files Changed
- src/commands/run.ts
- test/commands/run.test.ts
- .cairn/tasks.json / .cairn/tasks.completed.json / .cairn/.cairn_tasks_snapshot.json (task bookkeeping only)

### Gaps
None detected against the task's explicit requirements. Two things worth noting for awareness, neither a violation:

- `'skipped'` and `'error'` validation statuses are deliberately left as no-ops on the counter (neither increment nor reset), per the in-code comment and task notes: `'error'` (isCantRunError/timeout) doesn't revert the task, so it can't contribute to the livelock the guard exists to catch. This wasn't explicitly specified by the task ("reset on clean validation" only), so the choice is a reasonable interpretation rather than a gap.
- The task said "the loop continue to other work" without specifying whether the counter should reset after blocking; the implementation resets it (`consecutiveReverts.delete(task.id)` right after `blockTask`). This is arguably safer than not resetting (avoids instant re-block if unblocked) but is an unrequested behavior addition — flagged for visibility, not a defect.

### Regression Risks
None detected. `validateTaskTests`'s return value is now consumed (`const validation = await ...`) instead of discarded, which is the intended contract change and matches the existing `ValidationResult` shape used elsewhere in the codebase (`status`/`message`). The `blockTask` dep is additive to `RunRunDeps` — existing `defaultDeps()` callers get a working default implementation, and `makeRunDeps` in the test harness was updated with a mock, so no other test in the file was left with a missing/undefined dep. The final-summary rewrite is purely additive branching (`allClear` gates the existing "ALL TASKS COMPLETE" path without changing its original all-clear behavior — confirmed by the passing "still reports ALL TASKS COMPLETE when nothing is blocked" test). `cairn.json`'s `healthCheck` was not touched and `./install.sh` was not run, consistent with the round's pin/unpin constraint.

### Verdict
CLEAN

---

## Task #72: Rewrite the tests-field description in commands/generate-tasks.md
Reviewed: 2026-08-03T22:31:00Z

### Coverage
```
Task Requirements
├── [DONE] Read src/test-validator.ts AS TASK 70 LEFT IT (not restated from the description, not guessed)
├── [DONE] Describe default: commands run from the task's directory
├── [DONE] Describe escape hatch: root instead when a path arg doesn't resolve under task dir but does under root — "either form works"
├── [DONE] Note manifest-driven commands (npm test, bun test, cargo test) correctly pick up the service's own manifest in a multi-service repo
├── [DONE] Include task 70's exact definition of a path-shaped argument
├── [PARTIAL] Keep length in proportion to neighboring bullets
├── [DONE] Docs-only change — no src/ or test/ files touched
└── [DONE] cairn.json healthCheck untouched, ./install.sh not run
```

### Files Changed
- commands/generate-tasks.md (single bullet, line 120)
- .cairn/tasks.json / .cairn/tasks.completed.json / .cairn/.cairn_tasks_snapshot.json (task bookkeeping only)

### Gaps
Verified the new bullet against `src/test-validator.ts` as task 70 actually left it (read directly, not taken on faith):

- `resolveCommandCwd` (test-validator.ts:184-193): default is `taskDir`; for each path-shaped token, if it resolves under `taskDir` the command stays there, if it fails to resolve under `taskDir` but resolves under `projectRoot` the command runs from `projectRoot`, first qualifying token wins. Doc text matches this exactly, including the "only if" framing (the redirect is the exception, not a per-command coin flip).
- `isPathShaped` (test-validator.ts:160-164) + `BARE_FILENAME_RE`: non-`-`-prefixed, non-`@`-prefixed token that either contains `/` or matches a bare filename with a letter-leading extension. Doc's parenthetical reproduces this precisely, including the letter-leading-extension detail that a slash-only rule would miss (`bun test config.test.ts`).
- Manifest-driven commands carry no path-shaped token at all, so `resolveCommandCwd`'s loop never triggers a redirect and they stay at `taskDir` — matches the doc's claim they "always run from the task's directory."

One real, if minor, shortfall: the task explicitly said "keep the length in proportion to its neighbors." Every other bullet in the list (lines 112-122) is a single clause, roughly 5-20 words. The new bullet is a ~100-word, three-clause paragraph — by far the longest line in the guidelines section, more than 5x its immediate neighbors. Some length growth was unavoidable given the task also demanded the path-shaped-argument definition be included verbatim, and the content itself is accurate and necessary; but no attempt was made to trim (e.g., by moving the path-shaped-argument definition into a nested sub-point or shortening the manifest-command clause) to narrow the gap with the surrounding one-liners. This is a real, explicitly-stated requirement that was only partially honored — flagged as [PARTIAL], not a fabricated nitpick.

### Regression Risks
None detected. Change is confined to a single bullet's text in a markdown file; no code, schema, or test file touched. Grepped `commands/generate-tasks.md` for other copies of the old "(run from the task's directory)" wording — none found, so no stale duplicate was left behind elsewhere in the file.

### Verdict
HAS_GAPS
