## Task #91: Extract post-iteration logic from run.ts into settleTask (src/settle.ts)
Reviewed: 2026-09-14T04:00:00Z

### Verification performed
- Ran `bun test test/settle.test.ts`: 15 pass, 0 fail, 59 expect() calls.
- Ran full `bun test`: 929 pass, 0 fail, 1910 expect() calls (includes `test/commands/run.test.ts`, untouched by this commit per `git show --stat e776a7f`).
- Ran `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`: compiles cleanly (110 modules bundled). Did not touch `dist/cairn`, `cairn.json`, or run `./install.sh`, per the round's pinned-binary instructions.
- Diffed `git show e776a7f^:src/commands/run.ts` region against the new `src/settle.ts` to confirm the moved logic (steps k/k2/k3/k4, `REVERT_BLOCK_THRESHOLD`, `STALL_BLOCK_THRESHOLD`, `summarizeFailure`) is a byte-for-byte behavioral match, just re-parameterized: `Map`-based locals became `GuardCounters.get/set/clear` calls, and `blockedByGuard.add(task.id)` moved to a returned boolean flag set by `runRun`.
- Confirmed via `grep` that no other file in `src/` or `test/` still references `REVERT_BLOCK_THRESHOLD`, `STALL_BLOCK_THRESHOLD`, or `summarizeFailure` outside `src/settle.ts` / `test/settle.test.ts` — no dangling duplicate definitions.
- Confirmed `test/commands/run.test.ts` still contains the pre-existing guard/corruption assertions this task's description required to survive: revert-block tests (`blocks a task after two consecutive validation reverts...`, `resets the consecutive-revert counter...`), stall-guard tests (5 tests around lines 1279-1460), and corruption-event tests (3 tests around line 2213+) — all passed in the full suite run above.
- Confirmed `SettleTaskDeps`'s injected function shapes (`validateTaskTests`, `readTasksFile`, `blockTask`, `appendFileSync`, `log`) match the corresponding `RunRunDeps` members exactly, and `runRun` forwards them 1:1 plus one `GuardCounters` instance created via `createInMemoryGuardCounters()` per run — matching the task's "one in-memory instance per run" design requirement.

### Coverage
Task Requirements
├── [DONE] Extract steps k/k2/k3/k4 (validateTaskTests, revert guard, re-read status, stall guard) into `src/settle.ts`
├── [DONE] Move `REVERT_BLOCK_THRESHOLD`, `STALL_BLOCK_THRESHOLD` (with doc comments) and `summarizeFailure` into `src/settle.ts`
├── [DONE] Export async `settleTask(input, deps)` with the specified input shape (task, selectedStatus, tasksFilePath, dataDir, projectRoot, iteration, iterationLogPath)
├── [DONE] Deps injected with same shapes as `RunRunDeps`, plus a `counters` object
├── [DONE] `GuardCounters` interface (`get`/`set`/`clear`, kind `'reverts' | 'stalls'`) plus exported in-memory Map-backed implementation (`createInMemoryGuardCounters`)
├── [DONE] `runRun` creates one in-memory counters instance per run, preserving today's per-run semantics
├── [DONE] Result object carries validation, updatedTaskStatus ('unknown' when unreadable), blockedByGuard, corrupted flag
├── [DONE] `runRun` calls `settleTask` then continues with step l (review) and step m (archive) in the same order — verified unchanged in the surrounding diff context
├── [DONE] `test/settle.test.ts` covers: passed validation resets reverts; failed validation increments/blocks at 2 with existing note text; stall increments only when selected-pending and still-pending, blocks at 3; other observed status resets stalls; unreadable tasks file leaves both guards neutral — all present and passing
├── [DONE] `test/commands/run.test.ts` stays green without weakened assertions — confirmed unmodified in this commit and passing in full suite
└── [DONE] TDD: task notes claim failing-test-first workflow; cannot independently verify intermediate red/green states post-hoc since only the final commit exists, but the delivered test file's structure (fake deps, no real processes, matching the exact spec'd scenarios) is consistent with that description having been followed. Noting this as unverifiable-after-the-fact rather than confirmed.

### Files Changed
- `.cairn/tasks.json` (task status update + incidental JSON reformatting from `cairn task complete`, pre-existing `writeTasksFile` behavior — not introduced by this task's code)
- `src/commands/run.ts` (guard/validation logic replaced with a `settleTask` call; `BlockTaskOpts` re-exported from `../settle` to avoid breaking any external import of that type name)
- `src/settle.ts` (new)
- `test/settle.test.ts` (new)

### Gaps
None detected against the task's stated scope. One minor unverifiable item noted above (TDD red-state not re-derivable after the fact — inherent to reviewing a finished commit, not a defect).

### Regression Risks
- None detected. The extracted logic is a verified line-for-line behavioral match (see Verification), all pre-existing guard/corruption tests in `run.test.ts` still pass unmodified, and no other module references the relocated constants/function under their old location.
- Note (not a regression, informational): `BlockTaskOpts` moved from `run.ts` to `settle.ts` to avoid an import cycle; `run.ts` re-exports the type (`export type { BlockTaskOpts } from '../settle'`) so any external consumer importing it from `run.ts` keeps working.
- Note (not a regression, pre-existing behavior unrelated to this task): `.cairn/tasks.json`'s dependency arrays were reformatted from single-line to multi-line and the file lost its trailing newline — this is `writeTasksFile`'s existing `JSON.stringify(data, null, 2)` behavior triggered by the `cairn task complete` call, not something this task's diff changed.

### Verdict
CLEAN

---

## Task #93: Persist guard counters in run state; cairn task set-status clears the attempt record
Reviewed: 2026-09-14T03:50:22Z

### Verification performed
- Ran `bun test test/settle.test.ts`: 19 pass, 0 fail, 69 expect() calls — includes the new `createRunStateGuardCounters` describe block and the "counters survive two separate settleTask calls" scenario the task spec explicitly asked for.
- Ran full `bun test`: 951 pass, 0 fail, 1956 expect() calls across 32 files.
- Ran `bun test test/commands/task.test.ts test/commands/run.test.ts` directly: 170 pass, 0 fail, 370 expect() calls.
- Ran `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck-review` (a throwaway outfile, not the pinned `/tmp/cairn-healthcheck` or `dist/cairn`): compiled cleanly, 111 modules bundled.
- `git show HEAD --stat` / `git status --short`: only the expected files were committed (`src/run-state.ts`, `src/settle.ts`, `src/commands/run.ts`, `src/commands/task.ts`, the three test files, plus routine `.cairn/tasks.json` / `tasks.completed.json` / iteration-log bookkeeping from `cairn task complete`). `cairn.json`'s pinned `healthCheck` value (`bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`) remains uncommitted and untouched by this commit — confirmed via `git diff cairn.json` and `git show HEAD -- cairn.json`. `install.sh` untouched.
- Read `src/run-state.ts`, `src/settle.ts`, and the relevant `src/commands/run.ts` / `src/commands/task.ts` regions in full and traced the attempt-record lifecycle by hand against the task's five numbered requirements (see Coverage below).
- Diffed against `git show da8e231:src/commands/run.ts` (task 92's HEAD) to confirm the "In-memory and per-run on purpose..." comment and its stall-guard counterpart were the actual prior text being replaced, and that `guardCounters` was previously `createInMemoryGuardCounters()`.
- Traced `cairn task set-status`'s CLI registration (`registerTaskCommands`) to confirm `dataDir()` is passed through in real usage, so the new clear-on-set-status behavior is reachable outside tests, not just exercised by injected opts.
- Read `src/task-archiver.ts` to confirm `archiveCompletedTasks` archives *all* `status === 'complete'` tasks from `tasks.json` on each call (not just the just-picked one), which is what makes runRun's post-archive `clearAttemptRecord()` on `updatedTaskStatus === 'complete'` reliably fire after the real archive step rather than racing it.

### Coverage
Task Requirements
├── [DONE] 1. Run-state-backed `GuardCounters` (`createRunStateGuardCounters`) reading/writing `attempts[id].reverts`/`.stalls` via short `updateRunState` calls; `runRun` now builds counters via `createRunStateGuardCounters(dataDir, deps.runState)`; `createInMemoryGuardCounters` kept only for the settle-test harness, doc comment updated to say so
├── [DONE] 2. Attempt record created at pick time in `cairn run`, before spawn, with `{ beforeSha: captureGitSha(...), iteration, reverts: 0, stalls: 0, incompletes: 0, phase: 'executing' }`; re-pick keeps the original `beforeSha` and updates `iteration`; the kept `beforeSha` is what's passed to `runPostTaskReview` — verified both in code (src/commands/run.ts ~597-614) and by the two new "at pick" / "re-pick" tests, which pass
├── [DONE] 3. Record lifecycle: cleared on `settled.blockedByGuard` and after `archiveCompletedTasks` when `updatedTaskStatus === 'complete'` — both paths covered by passing tests and match the task's "keep it simple, tasks 95/97 formalize" scope
├── [DONE] 4. `taskSetStatus` clears the attempt record strictly after `mutateTasksFile` returns (never inside its callback), skips when `opts.dataDir` is absent, and a clear failure warns to stderr but still returns 0 — verified in code and by tests 7c–7f, all passing
├── [DONE] 5. Comment at run.ts rewritten to describe run-state-file-backed, restart-surviving counters reset by `cairn task set-status`, still not a Task field; the matching "mid-run" phrasing in both settle.ts guard blocks (revert-clear and stall-clear) was also fixed
└── [DONE] TDD: task notes claim "7 failed, then implemented" — as with tasks 91/92, this can't be re-derived from the single final commit, but the delivered tests precisely match every spec'd scenario (persistence across two settleTask calls, pick-time record, re-pick beforeSha retention + review wiring, clear-on-block, clear-on-complete/archive, set-status 7c–7f), consistent with the claim. Noted as unverifiable-after-the-fact rather than a defect.

### Files Changed
- `src/run-state.ts` (adds `RunStateStore`, `fileRunStateStore`, `newAttemptRecord`)
- `src/settle.ts` (`createRunStateGuardCounters`; `counters` now optional on `SettleTaskDeps`, defaulting to the file-backed implementation; comment cleanup)
- `src/commands/run.ts` (`RunRunDeps.runState`; attempt-record-at-pick logic; guard-block and complete/archive clear sites; rewritten comment)
- `src/commands/task.ts` (`taskSetStatus` clears the attempt record post-mutate, best-effort)
- `test/settle.test.ts`, `test/commands/run.test.ts`, `test/commands/task.test.ts` (new coverage for all of the above)
- `.cairn/tasks.json`, `.cairn/tasks.completed.json`, `.cairn/.cairn_iterations.log` (routine task-lifecycle bookkeeping from `cairn task complete`, not code changes)

### Gaps
- Minor, explicitly descoped by the task itself: `archiveCompletedTasks` failing to read/write `tasks.json` (e.g. a `TasksFileError`) still lets `runRun` clear the attempt record on `updatedTaskStatus === 'complete'`, because the clear is gated on the task's *observed* status rather than on `archiveResult.archivedCount` actually including it. In the normal case this is moot (a `TasksFileError` here is already a rare, already-alarming failure mode, and this task's spec says "keep this simple and tested — tasks 95 and 97 formalize the lifecycle"), so this is noted for awareness rather than as a defect to fix now.
- No other gaps found against the five numbered CHANGES or the TESTS section.

### Regression Risks
- **Narrow race in the pick-time attempt-record logic** (src/commands/run.ts, the `priorAttempt` / `capturedSha` block): the code reads `deps.runState.read(dataDir)` *outside* any lock to decide whether to call `captureGitSha` at all, then separately re-checks existence *inside* the locked `deps.runState.update(...)`. Within a single sequential `cairn run` process this is safe (no `await` separates the two reads, so nothing else in-process can mutate the state between them). But if a concurrent `cairn task set-status <id> ...` (a scenario this very task explicitly wires up, and one a human is expected to run while a loop may be live, per the task's own "a human unblocking gets fresh attempts" framing) clears the record in the gap between the unlocked read and the locked update, the code takes the "record exists, keep going" branch outward (`capturedSha = null`) but then finds no record inside the lock and creates a fresh one via `newAttemptRecord(capturedSha, iteration)` — landing `beforeSha: null` on a genuinely new attempt instead of a freshly captured SHA. That silently narrows the eventual review's diff coverage for that attempt, which is the exact failure mode this task exists to prevent. The window is small (a few lines of synchronous code between two fs-lock operations), so this is unlikely to bite in practice, but it is a real TOCTOU gap introduced by this task's implementation, not a pre-existing one — worth a follow-up (e.g. always call `captureGitSha` unconditionally and let the single locked update decide whether to use it, since `captureGitSha` is cheap relative to the 60s stale-lock threshold).
- No removed exports, no deleted/weakened tests — `createInMemoryGuardCounters` is retained and still tested; all pre-existing guard/corruption tests in `run.test.ts` and `task.test.ts` were left in place and still pass (170 pass in the two touched test files, 951 in the full suite).
- `SettleTaskDeps.counters` becoming optional is backward compatible (existing callers that always pass `counters` are unaffected); the new default path (`createRunStateGuardCounters(input.dataDir)`) is itself covered by a dedicated persistence test, not just assumed correct.
- The counters' `get`/`set` pair inside the revert/stall guard logic in `settle.ts` (`counters.get(...) + 1` then `counters.set(...)`) is two separate short locked operations rather than one atomic read-increment-write — matching the task's explicit instruction ("settleTask reads and writes counters through short updateRunState calls"), but this means two truly concurrent `settleTask` calls for the same task/dataDir (not a scenario `cairn run`'s single sequential loop produces today) could race and lose an increment. Flagging only as a latent property of the chosen design, consistent with what the task asked for, not a new defect against this task's own scope.

### Verdict
HAS_RISKS

---

## Task #92: Run-state store (src/run-state.ts)
Reviewed: 2026-09-14T04:15:00Z

### Verification performed
- Ran `bun test test/run-state.test.ts`: 9 pass, 0 fail, 13 expect() calls — matches all 6 spec'd scenarios (empty default, round-trip, return value, corrupt file, lock gone after update, lock released on throw) plus 3 extra tests for `getAttempt`/`clearAttempt`.
- Ran full `bun test`: 938 pass, 0 fail, 1923 expect() calls. (Two unrelated `fatal: not a git repository` lines print to stderr from a pre-existing test that shells `git` from a non-repo temp dir; not caused by this change and the run still reports 0 fail.)
- Ran `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`: not re-run separately this pass, but the task notes report it succeeded and the full `bun test` run (which includes the build-adjacent suites) is green; `cairn.json`'s `healthCheck` and `dist/cairn`/`~/.local/bin/cairn` were left untouched (`git status` shows only `.cairn/.cairn_iterations.log` and the pre-existing uncommitted `cairn.json` change, consistent with the round's pinned-binary rule).
- `git show da8e231 --stat` confirms only the expected files changed: `src/run-state.ts` (new), `test/run-state.test.ts` (new), `src/commands/init.ts` (+2 lines), `test/commands/init.test.ts` (+2 lines), plus the routine `.cairn/tasks.json` / `tasks.completed.json` / iteration-log bookkeeping from `cairn task complete`. `src/file-lock.ts`, `src/utils.ts`, `src/tasks-file.ts` are unchanged (`git diff da8e231~1 da8e231 -- src/file-lock.ts src/utils.ts src/tasks-file.ts` is empty) — consistent with those being reference-only per the task ("Expected Files" lists them as patterns to mirror, not to edit).
- Read `src/file-lock.ts`: confirmed `acquireLock`'s stale-lock threshold is 60s (`LOCK_STALE_MS = 60000`) as the module header comment in `run-state.ts` claims, and that it returns a bare fd the caller must close/unlink — matching `updateRunState`'s `finally` block.
- Compared `writeRunState`'s tmp-path + rename pattern against `writeTasksFile` in `src/tasks-file.ts` (read via `Read`): same shape — unique tmp file (pid + random suffix vs. `tasks-file.ts`'s own `uniqueTmpPath`), `writeFileSync` then `renameSync`, with a `catch`-and-`unlinkSync`-then-rethrow cleanup path. Confirms the "mirroring writeTasksFile" requirement.
- Confirmed `tempFilePath(dataDir, 'run_state.json')` resolves through `BRAND.tempPrefix` (`.cairn_`) to `.cairn_run_state.json`, matching the spec'd filename and the paths asserted in the test file and in `TEMP_IGNORE_SUFFIXES`.
- `grep`'d `src/` for any caller of `readRunState`/`updateRunState`/`getAttempt`/`clearAttempt` outside `run-state.ts` itself: none found — correctly matches the task's explicit scope ("this task only builds and tests it"; wiring is tasks 93+).
- Verified the ignore-block order in `test/commands/init.test.ts`'s exact-array assertion (`.cairn_run_state.json`, `.cairn_run_state.json.lock` inserted between `.cairn_task_*_notes.md` and `.ralph_task_*_notes.md`) matches the literal insertion order in `TEMP_IGNORE_SUFFIXES` in `src/commands/init.ts` — both lists line up positionally.
- Confirmed `cairn.json` remains uncommitted (`git status --short` shows ` M cairn.json` untouched by this commit) and is not part of `git show da8e231 --stat` — the "stage only changed files" instruction was followed.

### Coverage
Task Requirements
├── [DONE] `src/run-state.ts` created, path via `tempFilePath(dataDir, 'run_state.json')`, never rebuilding from `BRAND.dataDir`
├── [DONE] Exported types `RunState`, `AttemptRecord`, `AttemptPhase` matching the spec'd shape exactly
├── [DONE] `readRunState(dataDir)` — missing file → `{ iteration: 0, attempts: {} }`; unparseable file tolerated, never throws
├── [DONE] `updateRunState(dataDir, fn)` — acquires `acquireLock(<statePath>.lock)`, read-modify-write, atomic write (unique tmp + rename), lock released in `finally` (fd closed + lockfile unlinked) even when `fn` throws; returns `fn`'s result
├── [DONE] Convenience helpers `getAttempt` and `clearAttempt`
├── [DONE] Module header documents both locking rules (short critical sections vs. 60s stale threshold / 120s test validation; lock ordering vs. `mutateTasksFile`'s `tasks.json.lock`) for later tasks to rely on
├── [DONE] Gitignore: `'run_state.json'` and `'run_state.json.lock'` added to `TEMP_IGNORE_SUFFIXES` in `src/commands/init.ts`; expected ignore-block array in `test/commands/init.test.ts` updated with matching order
├── [DONE] `test/run-state.test.ts` covers all six spec'd scenarios (empty default, round-trip, return value, corrupt-file tolerance, lock file gone after update, lock released on throw) — all in `fs.mkdtempSync` temp dirs
├── [DONE] TDD: task notes state the test was written first and observed failing (`Cannot find module '../src/run-state'`) before implementation; consistent with the delivered test file matching every spec'd scenario precisely, but — as with task #91 — this can't be independently re-derived from the single final commit alone
├── [DONE] TEMP DIRS ONLY: no `cairn init`/init-function calls found outside `fs.mkdtempSync` temp dirs in the new test file
└── [DONE] COMMIT: only the intended files staged; `cairn.json`'s uncommitted user change left alone

### Files Changed
- `src/run-state.ts` (new)
- `test/run-state.test.ts` (new)
- `src/commands/init.ts` (`TEMP_IGNORE_SUFFIXES`: +2 entries)
- `test/commands/init.test.ts` (expected gitignore entries: +2 lines)
- `.cairn/tasks.json`, `.cairn/tasks.completed.json`, `.cairn/.cairn_iterations.log` (routine task-lifecycle bookkeeping from `cairn task complete`, not code changes)

### Gaps
None detected against the task's stated scope. As with task #91, the TDD red-state claim is taken from the task notes and can't be re-derived after the fact from a single finished commit — noted as unverifiable-after-the-fact rather than a defect, since the delivered test suite's contents are consistent with the claim.

### Regression Risks
- None detected. This task adds a wholly new, self-contained module with no callers yet (confirmed via `grep`), so it cannot regress any existing behavior. `src/file-lock.ts`, `src/utils.ts`, and `src/tasks-file.ts` are unmodified.
- The two new gitignore-suffix entries are additive only; the existing exact-array assertion in `init.test.ts` was updated in the same commit, so no other test could have silently started failing and been missed — confirmed by the full `bun test` run (938 pass, 0 fail).
- One thing for a future reviewer to watch, not a regression today: `readRunState` does light shape-checking (`typeof data.attempts !== 'object'`) but does not validate the shape of individual `AttemptRecord`s inside `attempts`— a corrupt-but-parseable file with a malformed attempt entry would pass through un-repaired. The task only required "an unparseable file is treated as empty," which this satisfies; deeper per-record validation was out of scope and is reasonable to defer given runtime state is explicitly "disposable."

### Verdict
CLEAN

---

## Task #94: Incomplete guard (in-progress at settle, limit 3) and stall-note rewording
Reviewed: 2026-09-14T04:00:19Z

### Verification performed
- Ran `bun test test/settle.test.ts`: 23 pass, 0 fail, 95 expect() calls.
- Ran full `bun test`: 957 pass, 0 fail, 1991 expect() calls, across 32 files.
- Read the full resulting `src/settle.ts` and the relevant `src/commands/run.ts`
  section (not just the diff) to check control flow, not just the patch text.
- Traced `validateTaskTests` (`src/test-validator.ts`) to confirm the
  `validation.status !== 'failed'` exclusion in the incomplete guard is safe:
  a task left `in-progress` by the agent always re-reads as `status: 'skipped'`
  from `validateTaskTests` (it bails out before running any command once
  `fileTask.status !== 'complete'`), and the `'error'` status only occurs for
  tasks that stayed `'complete'`, which never satisfies the guard's
  `updatedTaskStatus === 'in-progress'` condition — so no live case can dodge
  the exclusion.
- Confirmed `cairn.json` is untouched by the task's commit (diff-checked;
  it shows modified in the working tree only as the pre-existing, still-
  uncommitted user change called out in the task) and `install.sh` was not run.
- Confirmed no other module references `GuardKind`, `retryMode`, or
  `RetryMode` yet (`grep`), consistent with the notes' claim that task 95
  is what consumes `retryMode`.
- Did not re-run the TDD red state myself (only one finished commit is
  available); the notes' claim of a failing run before implementation is
  consistent with the diff's shape (new export + new branches needed for the
  new assertions to type-check/pass) but is otherwise unverifiable after the
  fact, same caveat as prior tasks in this round.

### Coverage
Task Requirements
├── [DONE] Incomplete guard: increments `incompletes` when status is 'in-progress'
│          at settle and NOT reverted by a failed validation this settle
├── [DONE] Exported `INCOMPLETE_BLOCK_THRESHOLD = 3` with doc comment matching the
│          style/reasoning of existing constants (early-vs-late blocking cost,
│          two legitimate sessions, fresh agent on the third attempt)
├── [DONE] At 3: `blockTask` with the specified note text, and attempt record
│          cleared (via the existing generic `clearAttemptRecord()` in run.ts,
│          triggered by `settled.blockedByGuard`)
├── [DONE] `retryMode` exposed on `SettleTaskResult`: incompletes 1→'continue',
│          2→'fresh', 3→'blocked'; stall→'fresh'; failed validation below
│          threshold→'continue'; verified against settle.test.ts assertions
├── [DONE] `selectedStatus` removed from `SettleTaskInput` and from the
│          run.ts caller, including the snapshot variable and its comment
├── [DONE] Resets: in-progress/complete/blocked reset stalls (single `else if
│          (updatedTaskStatus !== 'unknown')` branch covers all three);
│          in-progress does NOT reset incompletes (no such reset exists);
│          passed validation resets both reverts and incompletes
├── [DONE] Stall note reworded: no `permissions.deny` claim, keeps the required
│          phrasing, lists the three non-asserting causes from the spec
├── [DONE] `STALL_BLOCK_THRESHOLD` doc comment updated to drop the
│          permissions.deny claim
└── [DONE] No `deps.log` message in run.ts names permissions.deny (grep confirms
           none existed there to begin with — the only prior mention was in the
           note string that moved into settle.ts)

### Files Changed
- `src/settle.ts` — `INCOMPLETE_BLOCK_THRESHOLD`, incomplete guard, `RetryMode`/
  `retryMode`, `selectedStatus` removal, stall-note reword, stall guard no
  longer gated on a selection-time snapshot
- `src/commands/run.ts` — `selectedStatus` snapshot/comment removed, updated
  `settleTask` call and settle-step comment
- `test/settle.test.ts` — new `describe('incomplete guard')` block (1/2/3
  progression, completed-task exclusion, blockTask-failure path) plus
  updates to existing revert/stall tests for `retryMode` and the
  selectedStatus removal
- `test/commands/run.test.ts` — new end-to-end incomplete-guard block test,
  a revert-vs-incomplete disjointness test, and an update to the existing
  stall-guard test to assert the note's absence of `permissions.deny`
- `.cairn/tasks.json`, `.cairn/tasks.completed.json`,
  `.cairn/.cairn_iterations.log` — routine task-lifecycle bookkeeping from
  `cairn task complete`, not code changes

### Gaps
None detected against the task's stated scope.

### Regression Risks
- None detected that aren't already covered by the full green suite. The
  stall guard's behavior change (no longer gated on `selectedStatus`) is a
  deliberate, spec-required broadening — a task that looked in-progress at
  pick time but is pending at settle now correctly counts as a stall, and
  the removed test case (`'still pending but selected in-progress does not
  count as a stall'`) was replaced with a test asserting the new, intended
  behavior rather than silently dropped.
- The incomplete guard's exclusion of `validation.status !== 'failed'`
  (rather than checking `!== 'failed' && !== 'error'` explicitly) works only
  because of the current `validateTaskTests` control flow described above.
  It is not self-evidently safe from the guard's code alone — a future
  change to `validateTaskTests` that let an `'error'` result coexist with a
  re-read `'in-progress'` status would silently start counting infra errors
  as incompletes. Worth a one-line comment or a defensive
  `validation.status !== 'failed'` → `!['failed'].includes(...)` style note
  for the next person touching `test-validator.ts`, but not a defect today.

### Verdict
CLEAN

---

## Task #95: Settle verdict JSON, record-based idempotency, next hints, error types
Reviewed: 2026-09-14T04:09:29Z

### Coverage
Task Requirements
├── [DONE] Exported `Verdict` union (retry/blocked/done/already-settled), each with `next`
│   ├── [DONE] retry: { verdict, taskId, mode, reason, failure?, next } — `failure` present as
│   │     optional, deliberately unset (task 96's job); verified by reading the type and the
│   │     "retry/continue after a failed validation" test
│   ├── [DONE] blocked: { verdict, taskId, reason, next } — both guard-block and agent-set-block
│   │     paths produce it (`verdicts` describe block, two dedicated tests)
│   ├── [DONE] done: { verdict, taskId, reason?, next } — reason omitted for now (task 97 adds
│   │     values), matches spec note
│   └── [DONE] already-settled: { verdict, taskId, next }
├── [DONE] `next` hint text matches the spec's wording exactly for all four branches
│   (done/blocked/already-settled → "Run: cairn round next"; retry/continue and retry/fresh
│   strings checked verbatim against `NEXT_CONTINUE`/`NEXT_FRESH` in the test file and the
│   literal spec text, including the "if that agent's id is lost, launch a fresh
│   cairn-task-agent" clause)
├── [DONE] Retry mode mapping: stall → fresh; incompletes 1 → continue, 2 → fresh; failed
│   validation below revert threshold → continue (verified by the `verdicts` describe block's
│   four mapping tests, and by reading the `retry(...)` call sites in settle.ts)
├── [DONE] Idempotency keyed on the attempt record, not archived status
│   ├── [DONE] no record + task absent from tasks.json but present in tasks.completed.json →
│   │     already-settled, no side effects (test: "a second call after done...")
│   ├── [DONE] no record + task present in tasks.json → record created lazily, beforeSha null,
│   │     iteration from run state (test: "a missing record with the task present creates the
│   │     record lazily from run state" — asserts the exact record shape)
│   └── [DONE] unknown id in neither file → throws SettleError (test: "an unknown task id
│         throws SettleError")
├── [DONE] Record lifecycle: cleared on done and every block, kept on retry (asserted across
│   the `verdicts` tests; also exercised end-to-end via the updated run.test.ts case)
├── [DONE] settleTask keeps runRun working, ignoring retry modes (run.ts's settle call site
│   and the full `bun test` run confirm no regression; runRun no longer references the old
│   `retryMode` field at all)
├── [DONE] One iterations-log line per settle: `Settle #<id>: <verdict> (<reason>)` — verified
│   against the appended-content assertions in several `verdicts` tests, including the
│   already-settled and default-log-path cases
└── [DONE] Error types for the exit-code contract — `SettleError` newly added here;
      `TasksFileError` (src/tasks-file.ts) and `FileLockError` (src/file-lock.ts) already
      existed from earlier tasks, so nothing else needed to be added in this task. The CLI
      mapping itself is explicitly task 99's job, not this one's.

### Files Changed
- src/settle.ts — Verdict union, SettleError, idempotency lookup/record-creation, next-hint
  builder, record-lifecycle clearing, iterations-log append; old `RetryMode`/`retryMode` result
  field removed
- src/commands/run.ts — settle call site updated to the new `{ taskId, task, ... }` input
  shape and new deps (`loadCompletedIds`, `runState`); its own duplicate `clearAttemptRecord`
  calls removed (settle now owns that)
- test/settle.test.ts — new `verdicts` describe block (13 tests) plus harness additions
  (memory run-state store, `completedIds`, `readCalls`, `setNotes`); existing `retryMode`
  assertions converted to `verdict` assertions
- test/commands/run.test.ts — one test renamed/reworked to assert settle clears the record
  before archive while the review still gets the captured beforeSha
- src/run-state.ts — listed as an expected file but has no diff; task 94 already added
  everything (`RunState`, `RunStateStore`, `newAttemptRecord`) that this task needed, so this
  is a correctly-empty "expected" file rather than a gap
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log — task-lifecycle
  bookkeeping, not reviewed as code

### Gaps
None detected against this task's own scope. One pre-declared deferral, explicitly called out
in both the task description and the task's own notes, not a gap: `failure?` on the retry
verdict is declared but never populated — task 96 is the one that wires `failureTail` from
`validateTaskTests` into it.

One minor spec-vs-implementation wrinkle worth flagging (not scored as a gap because behavior
is correct and tested either way): the description says idempotency is "keyed on the ATTEMPT
RECORD", suggesting the lookup should trigger only when a record is absent. The actual condition
is `if (!record || !task)` — it also re-reads tasks.json on every call where the caller didn't
pass a `task`, even if a record already exists. This only matters for a hypothetical future
caller that has a record but no task handle; the `cairn run` path (task passed + record always
pre-created in step i) never hits it, and the task description's own phrasing elsewhere ("the
`cairn run` path, which has both, adds no extra read") matches what's implemented, so this
looks like an intentional conflation of "idempotency check" and "task lookup" rather than a bug.

### Regression Risks
- `SettleTaskResult.retryMode` and the old `RetryMode` type (`'continue'|'fresh'|'blocked'|null`)
  from task 94 were removed outright rather than deprecated. Searched the full src/ and test/
  tree for any remaining reference to `.retryMode` or the old `RetryMode` export — none found
  outside this task's own diff, so nothing else in the codebase (or task 99, which hasn't landed
  yet) currently depends on the removed shape. Flagging only because it's a breaking change to a
  field introduced just one task ago.
- `SettleTaskInput.selectedStatus` doesn't appear here (already removed in task 94); confirmed
  no reintroduction.
- No exports were removed that other *landed* modules depend on — `grep` for `settleTask(`,
  `SettleTaskInput`, `SettleTaskDeps` call sites outside settle.ts/run.ts/the test files turned
  up nothing.
- No test coverage was deleted; test/settle.test.ts grew (191 lines added) and
  test/commands/run.test.ts had one test reworded/strengthened rather than removed.
- `bun test test/settle.test.ts` → 35 pass, 0 fail (run directly, not just read from the diff).
  `bun test` (full suite) → 969 pass, 0 fail (run directly). Both match the task's own claimed
  verification numbers.
- COMMIT hygiene verified directly: `git show --stat HEAD` lists only the seven files in the
  "Changed Files" list above (no `cairn.json`); `git status --short` still shows `cairn.json` as
  locally modified and untracked-review-file only, confirming the pinned-binary/uncommitted-user-
  change rule was respected. `cairn.json`'s `healthCheck` is still the pinned throwaway-outfile
  value, and `install.sh` was not re-run (binary pin verification blocked by sandboxing on
  `~/.local/bin`, but cairn.json's value is the primary signal and it's intact).

### Verdict
CLEAN

---

## Task #96: Test validation writes a per-task log and returns a summary plus failure tail
Reviewed: 2026-09-14T04:16:52Z

### Verification performed
- Ran `bun test test/test-validator.test.ts`: 46 pass, 0 fail, 96 expect() calls
  (matches the task notes' claim of 46, up from 36 pre-task).
- Ran full `bun test`: 979 pass, 0 fail, 2054 expect() calls across 32 files
  (matches the task notes' claim of 979, up from 969 pre-task).
- Read `src/test-validator.ts` in full to confirm the log-write, summary-parsing,
  failureTail, and `formatTestSummary` logic against the spec, not just the diff
  text: `logPath` is built via `tempFilePath(dataDir, 'task_<id>_tests.log')`
  (→ `.cairn_task_<id>_tests.log`); `finalize()` writes the log and stamps
  `logPath`/`summary` immediately before every `return` from inside the command
  loop, while the pre-loop skip branches (no tests declared, task not complete,
  unreadable tasks.json) are untouched and still return bare
  `{status: 'skipped'}`/`{status:'error', message}` — exactly matching the
  pre-existing exact-`toEqual` classification tests that the task required to
  stay unchanged.
- Read `src/settle.ts` around the `retry()` helper and the `validation-failed`
  branch to confirm `validation.failureTail` is threaded into the retry
  verdict's `failure` field, spread in only when truthy so existing fixtures
  without a `failureTail` are unaffected.
- Read `src/commands/init.ts` and `test/commands/init.test.ts` directly and
  confirmed `'task_*_tests.log'` was inserted into `TEMP_IGNORE_SUFFIXES`
  immediately after `'task_*_notes.md'`, and the exact ordered `entries` array
  asserted in the gitignore-content test was updated with `.cairn_task_*_tests.log`
  in the matching position — no other init.test.ts assertions needed changes.
- Confirmed `run.ts`'s end-of-loop cleanup list (`TEMP_FILE_SUFFIXES =
  ['complete', 'prev_notes', 'completed_ids']`) is a separate, hardcoded, short
  list never derived from `TEMP_IGNORE_SUFFIXES`, so the new per-task tests log
  is correctly left on disk for the reviewer without any exclusion edit needed —
  confirmed by reading run.ts directly, not just trusting the task notes' claim.
- Grepped `src/` for `formatTestSummary` and `validateTaskTests(` call sites:
  `formatTestSummary` is exported but not yet called anywhere (consistent with
  the task notes' own "Notes for next iteration" — reviewer-prompt wiring is
  out of scope here); `validateTaskTests` has a single caller, `src/settle.ts`.
- Did not re-run `cairn init` or any init/claude-settings function against the
  repo root; relied on the existing `fs.mkdtempSync`-based test harness, which
  passed as run above (temp-dirs-only constraint honored).
- Could not verify the TDD red-state (test written and observed failing before
  implementation) beyond the task notes' narrative — the round's workflow
  squashes each task into a single commit with no intermediate commits to
  inspect; noted as unverifiable-after-the-fact, consistent with every other
  task reviewed this round, not a defect specific to this one.

### Coverage
Task Requirements
├── [DONE] Log file: full combined stdout+stderr per command, header (command, cwd,
│   exit code, duration), written to `tempFilePath(dataDir, 'task_<id>_tests.log')`
│   — verified path construction and header format directly in source
├── [DONE] Overwrite on each validation run — dedicated test asserts stale content
│   ('first run') is gone and new content ('second run') is present after a
│   second call
├── [DONE] A log-write failure must not change the validation outcome — dedicated
│   test occupies the log path with a directory (forcing the write to throw) and
│   asserts `status: 'passed'` is still returned; `writeTestLog` swallows the error
├── [DONE] Log excluded from run.ts's end-of-loop cleanup — confirmed `TEMP_FILE_SUFFIXES`
│   in run.ts is unrelated and unmodified; no exclusion edit was needed or made
├── [DONE] `ValidationResult` extended with `logPath?`, `summary?`, `failureTail?`;
│   existing `status`/`message` semantics preserved (message still the 200-char
│   tail slice used in the task note)
├── [DONE] `summary` counts parsed leniently from bun-style ` N pass`/` N fail`/
│   ` N skip` lines (last occurrence wins), left undefined when unparseable —
│   covered by both a parse-success and a lenient-undefined test
├── [DONE] `failureTail` = last ~40 lines, set for failed and error results —
│   covered by a 60-line-stderr test (asserts ≤40 lines, contains the tail,
│   excludes the head), an infra-error test, and a passing-result-has-none test
├── [DONE] `formatTestSummary(result)` exported: per-command command/status/counts/
│   duration lines plus the log path; distinct message for a skipped validation —
│   covered by two dedicated tests
├── [DONE] settleTask threads `failureTail` into the retry verdict's `failure`
│   field (Verdict type from task 95 already exists, so the "otherwise expose on
│   settle result" fallback path wasn't needed) — confirmed correct by reading
│   src/settle.ts directly. **Not exercised by any settle.test.ts test** — see Gaps.
└── [DONE] GITIGNORE: `TEMP_IGNORE_SUFFIXES` and the init.test.ts expected-entries
    array both updated in the matching position — confirmed by reading both files

### Files Changed
- src/test-validator.ts
- src/settle.ts
- src/commands/init.ts
- test/test-validator.test.ts
- test/commands/init.test.ts
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log
  (routine task-lifecycle bookkeeping from `cairn task complete`, not code changes)

### Gaps
- No test in test/settle.test.ts exercises the settle.ts wiring change (item 4:
  `validation.failureTail` → `Verdict.retry.failure`). The task's own TESTS
  section only mandated test-validator.test.ts and init.test.ts updates, so this
  is not a spec violation, but the settle.ts half of this task shipped with zero
  automated coverage of its own. Verified correct by static inspection instead
  (traced the `retry()` helper's optional-spread and the `validation-failed`
  branch) — it's a one-line, low-risk change and reads correctly, but a future
  refactor of `retry()` or of that branch order would not be caught by `bun test`.
- `formatTestSummary` is not yet called from anywhere (self-reported in the task
  notes too) — reviewer-prompt integration is explicitly out of this task's
  Expected Files, so not a gap against #96's own scope, but flagging it so a
  later round task is known to pick it up.

### Regression Risks
- None detected. The two pre-existing `toEqual({status:'passed'})` exact-match
  assertions that needed updating (now that passing results carry
  `logPath`/`summary`) were updated appropriately; every other pre-existing
  classification assertion (can't-run, zero-tests, timeout, cwd resolution) was
  left untouched and still passes, since none of them did an exact top-level
  `toEqual`.
- No exports were removed; `ValidationResult`'s new fields are all optional and
  purely additive. `Verdict`'s retry variant already declared `failure?: string`
  from task 95, so no type-contract change was needed in settle.ts beyond
  passing the value through.
- No test coverage was deleted; test/test-validator.test.ts grew by 10 tests and
  test/commands/init.test.ts gained one array entry in an existing test.

### Verdict
HAS_GAPS

---

## Task #97: Review phase in settle: archive then review gate, awaiting-review, --reviewed, beforeSha fallback
Reviewed: 2026-09-14T04:31:58Z

### Verification performed
- `bun test test/settle.test.ts` — 55 pass, 0 fail, 206 expect() calls (matches the
  task's declared "Expected Tests").
- `bun test` (full suite) — 1000 pass, 0 fail, 2141 expect() calls.
- `bun test test/post-task-reviewer.test.ts` — 46 pass, 0 fail (checks the
  `resolveReviewFilePath` extraction didn't regress the spawner).
- `bun run build` (`bun build --compile src/index.ts --outfile dist/cairn`) —
  succeeds; confirms no TypeScript/compile errors from the new null-narrowing
  around `beforeSha` in the review-gate branches. Did not run `./install.sh` or
  touch `cairn.json` (pinned-binary rule honored — `git show --stat 752c043`
  confirms `cairn.json` is not part of this task's commit).
- Read `src/run-state.ts`, `src/task-archiver.ts`, `src/post-task-reviewer.ts` in
  full to confirm `AttemptRecord.phase` (task 95), `loadArchivedTask`'s
  `{tasks:[...]}` shape assumption against `archiveCompletedTasks`'s actual write
  format, and that `resolveReviewFilePath`'s extraction is behavior-preserving.
- Traced the full `settleTask` control flow by hand against every rule in the
  task description (gate order, idempotency via phase, beforeSha precedence,
  archive-once guarantee) rather than trusting the diff/tests alone; also
  exercised `git log --grep` fixed-string matching semantics indirectly via the
  `findTaskBaseSha` describe block's real temp-repo tests (all pass).
- Confirmed no other module imports removed/renamed `settle.ts` exports
  (`grep` for `settleTask`/`Verdict` outside settle.ts turns up only
  `src/commands/run.ts`, and `test/settle.test.ts` is the only test importer).

### Coverage
Task Requirements
├── [DONE] Archive-then-review-gate reorder in settleTask (complete status →
│   archiveCompletedTasks → same gate conditions as runPostTaskReview: postTask
│   enabled, beforeSha non-null, HEAD ≠ beforeSha) — verified against
│   post-task-reviewer.ts's own gate, same order, same reasons
├── [DONE] `review` verdict: phase → 'awaiting-review', prompt file written
│   (unless `inlineReview`), `next` hint matches spec text exactly
├── [DONE] `writeReviewPromptFile` exported; writes
│   `.cairn_task_<id>_review_prompt.md` using `buildPostTaskReviewUserPrompt` +
│   `getGitDiff(projectRoot, beforeSha)` + `resolveReviewFilePath`'s round path;
│   task read from tasks.completed.json via new `loadArchivedTask`
├── [DONE] Idempotency: `--reviewed` clears an awaiting-review record → done
│   ('reviewed'); no such record → already-settled if archived, else
│   SettleError; a repeat call while awaiting-review → review again, no
│   re-validation/re-archive, prompt file rewritten only if missing
├── [DONE] beforeSha resolution: explicit `input.beforeSha` overrides the
│   record; a lazily-created record derives beforeSha via `findTaskBaseSha`
│   (oldest `Task #<id>:` commit's parent, git access injected via
│   `SettleTaskDeps.git`); null on no match/root commit/git failure — all
│   confirmed with real temp-repo git tests, not just mocks
├── [DONE] `cairn run` adopts the new order: settle now archives and gates;
│   on `review` verdict runs the existing inline-prompt `runPostTaskReview`,
│   then settles again with `reviewed: true`; inline prompts preserved
│   (`inlineReview: true` skips the prompt-file write); step m's archive
│   reuses `settled.archive` to avoid a double archive
├── [DONE] Gitignore: `'task_*_prompt.md'` added to `TEMP_IGNORE_SUFFIXES`
│   with the required comment noting it covers both this task's file and
│   task 98's; `test/commands/init.test.ts`'s exact ordered assertion updated
│   to match
└── [DONE] All TESTS enumerated in the task description are present and
    green: complete+passed→archived/review/awaiting-review; repeat call→review
    again no second archive; reviewed→done+cleared; disabled/no-commits/
    null-sha→done with matching reason; commit-message fallback; beforeSha
    override; run.test.ts archive-before-review + reviewed-settle-follows

### Files Changed
- src/settle.ts
- src/post-task-reviewer.ts (extracted `resolveReviewFilePath`, shared by
  `spawnPostTaskReviewer` and `writeReviewPromptFile`)
- src/task-archiver.ts (new `loadArchivedTask`)
- src/commands/run.ts
- src/commands/init.ts
- test/settle.test.ts
- test/commands/run.test.ts
- test/commands/init.test.ts
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log
  (routine task-lifecycle bookkeeping from `cairn task complete`, not code)
- `src/task-counter.ts` is in the task's Expected Files list but was not
  modified — correctly so: the description only needed `getRound` (already
  exported) *consumed* from it, not changed.

### Gaps
None detected. Every item in the task description is implemented and has
passing test coverage; the one explicitly-deferred piece (task 101's
diff-range + test-summary prompt variant, and the `cairn round settle` CLI
itself) is called out by the task description and the implementer's own notes
as out of scope for this task, not a silent omission.

### Regression Risks
- None detected as bugs, but worth recording: a repeat, non-`--reviewed` call
  while a record is `awaiting-review` uses `input.beforeSha ?? record.beforeSha`
  for that call only — if a caller passed a *different* `--before-sha` on a
  repeat call than on the call that opened the review phase, the new value
  would be used for that one prompt-file rewrite but is not persisted back to
  the record (only the initial gate-pass branch persists `r.beforeSha =
  beforeSha`). No test exercises this combination and it's an unlikely CLI
  usage pattern (the CLI wiring for `--before-sha`/`--reviewed` doesn't exist
  yet per the task's own scope), so this is a latent inconsistency to keep in
  mind for whichever task wires up `cairn round settle`, not a defect in this
  task's delivered surface.
- Verified no exports were removed or narrowed in an incompatible way:
  `Verdict`'s `done.reason` narrowed from `string?` to `DoneReason?` (a
  superset-safe narrowing, and the only consumer, `src/commands/run.ts`, never
  read `.reason`); `SettleTaskResult` gained `archive` (additive). No test
  coverage was deleted — test/settle.test.ts grew from ~30 to 55 tests, and
  the run.test.ts test that previously asserted "clears the attempt record on
  done" was replaced by a strictly more thorough test (asserts call order,
  record state at each step, and the reviewed-settle follow-up) rather than
  weakened.
- Confirmed the archive-before-review reorder cannot double-archive: `settle`
  only calls `archiveCompletedTasks` from the `complete`-status branch, and
  `cairn run`'s step m reuses `settled.archive` when non-null instead of
  calling it again; the second (`reviewed: true`) settle call in `cairn run`
  never archives (it short-circuits via the `--reviewed` phase check before
  reaching the archive branch).

### Verdict
CLEAN

---

## Task #100: Subagent mode for buildSystemPrompt
Reviewed: 2026-09-14T04:36:49Z

### Coverage
Task Requirements
├── [DONE] Add optional `mode?: 'headless' | 'subagent'` to SystemPromptInput, default 'headless'
├── [DONE] 1. Drop completion-flag workflow step + its CRITICAL RULES line in subagent mode; renumber steps (6 skipped, git-commit step becomes 6 instead of 7)
├── [DONE] 2. State working directory as absolute path (path.join(projectRoot, taskDir) or projectRoot) + cd/absolute-paths instruction in subagent mode
├── [DONE] 3. Report contract: ≤5 lines (task id, outcome, commit sha, blocking); notes go via --notes-file; in-progress/blocked-note fallback for genuine external blocker
├── [DONE] 4. Keep SUBAGENT STRATEGY section verbatim in both modes
├── [DONE] 4. Keep "root CLAUDE.md ... do NOT re-read it" line verbatim in both modes
├── [DONE] 5. Specialist section embedded identically regardless of mode; task's `agent` field never becomes subagent type
├── [DONE] 6. tasks.json Edit/Write ban and `cairn task` subcommand instructions kept in both modes
├── [DONE] Tests: subagent mode has no complete-flag text, absolute working dir, 5-line report contract, SUBAGENT STRATEGY, CLAUDE.md line, specialist section
├── [DONE] Tests: default/headless output identical to explicit `mode: 'headless'`, existing assertions kept green
└── [DONE] TDD: failing test added first, watched fail, then implemented (per task notes and diff structure)

### Files Changed
- src/commands/run.ts — `SystemPromptInput.mode`, `buildSystemPrompt` branches on `isSubagent` for dirLabel/dirCdInstruction, workflowSteps array, reportSection, criticalRules array
- test/commands/run.test.ts — new nested `describe('subagent mode', ...)` with 10 tests inside `describe('buildSystemPrompt', ...)`
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log — routine task-lifecycle bookkeeping via `cairn task` CLI

### Verification (actually run, not just read from diff)
- `bun test test/commands/run.test.ts` → **147 pass, 0 fail** (matches notes' claim of 137→147, +10 new subagent-mode tests, all green).
- `bun test` (full suite) → **1010 pass, 0 fail**.
- `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck-review100` → compiled cleanly (bundle + compile steps both succeeded), confirming no TS/build regressions from this change.
- `git show c801137 --stat` → commit only touches `.cairn/.cairn_iterations.log`, `.cairn/tasks.completed.json`, `.cairn/tasks.json`, `src/commands/run.ts`, `test/commands/run.test.ts` — matches "stage only files you changed" instruction; `cairn.json` and `install.sh` untouched (confirmed via `git diff HEAD~1 -- cairn.json install.sh`, whose only hunk is the pre-existing pinned-healthCheck line already present before this task, still showing as the user's uncommitted local change in `git status`, not part of the task's commit).
- Read the full post-change `buildSystemPrompt` (src/commands/run.ts lines 1–196) directly: confirmed by inspection that in headless mode (`isSubagent = false`) every branch collapses back to the pre-existing literal text (dirLabel falls back to `taskDir || 'project root'`, workflowSteps push the completion-flag step and use step-7 numbering for the git commit, reportSection is `''`, criticalRules includes the "BEFORE creating" line) — i.e. the refactor is structurally a no-op for headless callers, consistent with the `defaultPrompt === headlessPrompt` test and all 137 pre-existing tests passing unmodified.
- Did not independently re-verify byte-for-byte equality against the pre-task version of headless output via a saved golden file (no snapshot test exists for the full string) — relied on (a) the passing pre-existing exact/`toContain` assertions and (b) direct code reading of the conditional branches, both of which are strong but not an exhaustive diff-the-full-string check.

### Gaps
None detected against the stated scope. Two things explicitly out of scope per the task description and the implementer's own notes, not gaps:
- Nothing yet wires `mode: 'subagent'` into an actual caller (`cairn round next` / `/cairn-run`) — task description's Expected Files are only `src/commands/run.ts` and `test/commands/run.test.ts`, so this is correctly deferred to a future task.
- No CLI/round-command changes — same reasoning.

### Regression Risks
None detected.
- No exports were removed; `SystemPromptInput` only gained an optional field, so all existing call sites (e.g. `buildIterationPrompt`/`spawnClaude` call paths in run.ts, and any other internal callers found via grep) remain source-compatible without changes.
- No existing tests were deleted or weakened — all 137 pre-existing `buildSystemPrompt`-related tests still pass unmodified, and 10 were added.
- Full 1010-test suite is green, so no cross-module regression from the refactor of the workflow-steps/critical-rules construction into arrays.

### Verdict
CLEAN

---

## Task #98: roundNext(): pending review first, select, health check, attempt record, prompt file
Reviewed: 2026-09-14T04:44:17Z

### Coverage
Task Requirements
├── [DONE] `roundNext()` in new src/commands/round.ts; no CLI command registered in src/index.ts (confirmed: no `round` reference in src/index.ts)
├── [DONE] Step 1: awaiting-review record returned first (`{verdict:'review', taskId, reviewPromptFile, next}`), rewriting the prompt file only when missing and beforeSha is non-null (reuses settle's `writeReviewPromptFile`/`reviewVerdict`)
├── [DONE] Step 2: `readTasksFile` (repair/recovery) + `selectNextTask`; `round-done` with blocked count and a next that says notify-and-stop
├── [DONE] Step 3: health check via `config.healthCheck`/projectRoot; failure output prepended to the iteration prompt byte-for-byte the same way `runRun` does (`${output}\n\n---\n\n${iterPrompt}`)
├── [PARTIAL] Step 4: new record gets beforeSha=HEAD only when absent; re-pick keeps the original beforeSha — correct in the common sequential-invocation case, but the "record exists?" check reads from a `state` snapshot taken at the very top of the function (before task selection, mkdir, and the health check), not re-read immediately before the decision the way `runRun`'s equivalent step does (`priorAttempt = deps.runState.read(dataDir).attempts[attemptKey]`, read right before capture). See Gaps.
├── [DONE] Step 5: `iteration` incremented via one short `store.update` and stored on the record; run-state lock proven not held during the health check (dedicated test using a lock-file-existence probe passes)
├── [DONE] Step 6: prompt file = subagent-mode `buildSystemPrompt` + `\n\n---\n\n` + `buildIterationPrompt`, written to `tempFilePath(dataDir, 'task_<id>_prompt.md')`; maxIterations/totalRemaining derivation is tested and matches `runRun`'s own formula for totalRemaining
├── [DONE] Step 7: `{verdict:'task', taskId, title, iteration, model, promptFile, next}` with the launch-then-settle hint; JSON-serializability asserted in a test
├── [DONE] MODEL: `resolveTaskModel(task, agents)` extracted and exported from src/commands/run.ts, `runRun` now calls it, behavior-preserving (verified by reading the diff and by the full suite staying green)
├── [DONE] GITIGNORE: no new suffix added; confirmed `'task_*_prompt.md'` already in `TEMP_IGNORE_SUFFIXES` (src/commands/init.ts) and asserted in test/commands/init.test.ts (`.cairn_task_*_prompt.md`)
├── [DONE] LOCKING: health check runs outside `store.update`; test explicitly verifies the lock file is absent during the health check call
├── [DONE] TESTS: all 8 listed scenarios present in test/commands/round.test.ts (awaiting-review-first, round-done+blocked, new-record HEAD sha, re-pick keeps sha, iteration incrementing, prompt file contents, health-check-failure prepend, resolveTaskModel cases) — 22 tests total, all passing
└── [DONE] TDD: task notes state the failing-test-first sequence; diff structure (round.ts is new, test file is new, added in the same commit) is consistent with that claim, though the TDD intermediate failing-run output itself isn't independently reproducible after the fact

### Files Changed
- src/commands/round.ts (new) — `roundNext()`, `RoundNextResult`, `RoundNextInput`, `RoundNextDeps`, `taskPromptFilePath()`
- src/commands/run.ts — new exported `resolveTaskModel(task, agents)`; `runRun` now calls it instead of inlining the resolution
- src/settle.ts — `reviewVerdict()` made exported (return type narrowed to the review variant) so `roundNext` reuses it verbatim
- test/commands/round.test.ts (new) — 22 tests
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log — routine task-lifecycle bookkeeping via `cairn task` CLI

### Verification (actually run, not just read from diff)
- `bun test test/commands/round.test.ts` → **22 pass, 0 fail**, 48 expect() calls.
- `bun test` (full suite) → **1032 pass, 0 fail**.
- `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck-review98` → bundled and compiled cleanly, confirming no TS/build regressions.
- `git show 2e17616 --stat` → commit touches exactly `.cairn/.cairn_iterations.log`, `.cairn/tasks.completed.json`, `.cairn/tasks.json`, `src/commands/round.ts`, `src/commands/run.ts`, `src/settle.ts`, `test/commands/round.test.ts`; `git show 2e17616 -- cairn.json install.sh` is empty — confirmed neither was touched, matching the pinned-binary and stage-only-changed-files instructions.
- Read src/run-state.ts, src/settle.ts (full), src/task-selector.ts, and src/health-check.ts directly (not just the diff) to check round.ts's use of `readTasksFile`, `selectNextTask`, `buildIterationPrompt`, `reviewVerdict`/`writeReviewPromptFile`, `newAttemptRecord`, and the run-state locking contract — all call sites match the real signatures and the documented locking rules ("critical sections must be SHORT... never hold the run-state lock across health checks").
- Cross-checked the health-check-failure prepend format and the `totalRemaining`/`maxIterations` derivation against `runRun`'s own code (src/commands/run.ts ~602-620) — byte-for-byte identical formatting and the same `totalRemaining` filter (`status === 'pending' || 'in-progress'`).
- Confirmed `resolveTaskModel` is logically equivalent to the inlined code it replaced (`task.model ?? (specialist agent's model) ?? 'opus'`) and that `runRun`'s `taskModel` binding site has no other reassignment that the extraction could have broken.

### Gaps
- Step 4's "does a record already exist for this task" check (`state.attempts[attemptKey]` at the top of `roundNext`, used to decide whether to call `captureGitSha`) reads from a `state` snapshot taken before task selection, `mkdirSync`, and the health check — a window that can be seconds to (per the run-state module's own documented worst case) minutes long, unlike `runRun`'s equivalent step, which re-reads `runState.read(dataDir)` immediately before making the same decision. In the actual interactive single-driver `/cairn-run` model this is very unlikely to bite (no concurrent writer normally exists), and the implementer's own notes already flag the closely-related "settle clears a record mid-window" race as a known edge case for later tasks — but the window here is wider than described (it starts at function entry, not just before the health check), and a one-line fix (re-read `state.attempts[attemptKey]` right before computing `capturedSha`, mirroring `runRun`) would close most of it for free. Not covered by any test since it requires a genuinely concurrent second writer to observe. Rated low severity given the single-driver design, but worth a follow-up note or task.

### Regression Risks
None detected.
- `reviewVerdict` changing from a private function to an exported one with a narrowed return type (`Extract<Verdict, {verdict:'review'}>`) is additive; all existing settle.ts call sites still compile and the full suite (including test/settle.test.ts, not just round.test.ts) is green.
- `resolveTaskModel` extraction is behavior-preserving; verified by direct comparison against the pre-change inline logic and by `runRun`'s existing model-resolution tests still passing.
- No exports were removed and no existing tests were deleted or weakened.

### Verdict
HAS_GAPS

---

## Task #99: Register the cairn round command group (next, settle) in the CLI
Reviewed: 2026-09-14T04:54:21Z

### Coverage
Task Requirements
├── [DONE] 1. `registerRoundCommands(program)` exported from src/commands/round.ts (mirrors `registerTaskCommands`), called from `createProgram()` in src/index.ts
├── [DONE] 2. `cairn round next` prints `roundNext`'s result as a single JSON object on stdout, exit 0 — `roundNextCommand()` writes `JSON.stringify(result) + '\n'` and returns 0 on success
├── [DONE] 3. `cairn round settle <id> [--reviewed] [--before-sha <sha>] [--test-timeout <sec>]` resolves projectRoot/dataDir from CAIRN_PROJECT_ROOT/CAIRN_DATA_DIR, loads config (loadConfig + autoDetectHealthCheck) and agents via `loadRoundContext()`, calls `settleTask`, prints verdict JSON on stdout
├── [DONE] 4. Exit codes: 0 for every verdict including 'blocked' and 'already-settled'; 1 only for TasksFileError / FileLockError / SettleError / invalid id or option, each with a one-line stderr message — verified by both reading the code and running the tests that exercise every branch
├── [DONE] 5. `--test-timeout` validated as a positive integer (seconds) and converted to ms, applied on top of whichever `validateTaskTests` is injected (`baseValidateTaskTests` wrapping), confirmed by a passing test asserting `receivedTimeoutMs === 30000` for `testTimeoutSec: 30`
├── [DONE] 6. stdout carries only the JSON verdict/result line; settle's own log output (e.g. "test validation errored ... settling anyway") is routed to stderr via the `log` dep default — confirmed no stray `console.log`/`console.error` in test-validator.ts, task-archiver.ts, settle.ts, round.ts, tasks-file.ts, or run-state.ts, and by the passing "log output ... routed to stderr, never stdout" test
├── [DONE] 7. Testable handler functions (`roundNextCommand`, `roundSettleCommand`) take `stdout`/`stderr` writers and return an exit code, matching src/commands/task.ts's `Writer` / `defaultStdout` / `defaultStderr` pattern (duplicated locally rather than imported — see Gaps)
├── [DONE] TESTS: test/commands/round.test.ts — 22 pre-existing (task 98) + 16 new tests (`roundNextCommand`, `roundSettleCommand`, `registerRoundCommands` describe blocks) covering every verdict (retry, blocked, review, done, already-settled) and every error type (invalid id, invalid --test-timeout, TasksFileError, FileLockError, SettleError), plus the stdout-is-clean-JSON guarantee
└── [DONE] TESTS: test/index.test.ts — 2 new tests confirming `round` is registered with `next`/`settle` subcommands and that `settle` carries `--reviewed`, `--before-sha`, `--test-timeout`

### Files Changed
- src/commands/round.ts — adds `roundNextCommand`, `roundSettleCommand`, `defaultBlockTask`, `loadRoundContext`, `registerRoundCommands`, and the `Writer`/`defaultStdout`/`defaultStderr` helpers, on top of task 98's `roundNext`
- src/index.ts — imports and calls `registerRoundCommands(program)` right after `registerTaskCommands(program)`
- test/commands/round.test.ts — 16 new tests appended to the existing file
- test/index.test.ts — 2 new tests appended
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log — routine task-lifecycle bookkeeping via `cairn task` CLI
- src/settle.ts — **not modified in this commit** (task notes correctly say so: everything round.ts needed — `SettleError`, `defaultGitAccess`, `settleTask`, `SettleTaskDeps`, `BlockTaskOpts`, `writeReviewPromptFile`, `reviewVerdict` (exported in task 98) — already existed)

### Verification (actually run, not just read from diff)
- `bun test test/commands/round.test.ts` → **38 pass, 0 fail**, 100 expect() calls (matches the commit notes' claimed count).
- `bun test` (full suite) → **1050 pass, 0 fail**, 2270 expect() calls across 33 files.
- `git show 0899fe6 --stat` → confirms exactly the 7 files listed in "Changed Files" above were touched, and the stat list not mentioning `cairn.json`/`install.sh` confirms neither was touched — matches the pinned-binary instruction.
- `git show 2e17616:src/commands/round.ts | grep 'export function\|export async function'` → before task 99's commit, round.ts exported only `taskPromptFilePath` and `roundNext` — confirms `roundNextCommand`/`roundSettleCommand`/`registerRoundCommands` genuinely did not exist yet, so the TDD claim ("watched it fail with `SyntaxError: Export named 'roundSettleCommand' not found`") is plausible, not just asserted.
- Read src/settle.ts in full to verify `settleTask`'s contract (verdict union, exit-worthy error types, the `writeReviewPromptFile`/`reviewVerdict` reuse) matches what `roundSettleCommand` assumes — confirmed: `SettleError` is thrown only for "task not found in neither file" and "reviewed without an awaiting-review record", both exit-1-worthy per the spec; every `Verdict` variant (`retry`, `blocked`, `review`, `done`, `already-settled`) resolves to exit 0.
- Confirmed `defaultBlockTask` in round.ts is byte-for-byte equivalent to `commands/run.ts`'s inline `blockTask` default (same `mutateTasksFile` call, same status/notes-concatenation logic) — the intentional duplication the task notes call out, not a divergent reimplementation.
- Confirmed `FileLockError` (src/file-lock.ts) and `TasksFileError` (src/tasks-file.ts) are genuinely exported classes, matching the test imports and the spec's named error types.
- Grepped for stray `console.log`/`console.error`/`console.warn` in every dependency `settleTask` touches (test-validator, task-archiver, settle.ts, round.ts, tasks-file.ts, run-state.ts) — none found, so nothing bypasses the `log` dep to leak onto stdout independent of the CLI's own routing.
- `tsc --noEmit` could not be run in this review session (the sandbox required interactive approval that wasn't available here) — noting this as unverified rather than assuming it's clean; the task notes' claim of "no new errors" was not independently re-confirmed by this reviewer.

### Gaps
- Minor duplication, not a functional gap: the `Writer` type and `defaultStdout`/`defaultStderr` helpers in src/commands/round.ts are copy-pasted from src/commands/task.ts rather than imported/shared. Harmless (identical, trivial implementations) but is exactly the kind of small drift the codebase's shared-helper conventions (e.g. `GIT_INSPECTION_RULES`, `buildCommandRules`) elsewhere try to avoid; worth folding into a shared module in a later cleanup task.
- `round settle`'s CLI action calls `loadRoundContext()` and destructures out `agents`, which is loaded (parsed from `CAIRN_AGENTS_JSON`) but never used by `settleTask` — harmless per the task notes' own admission ("kept for parity ... in case a future settle path needs them"), but it is a small amount of dead computation on every `round settle` invocation.
- Could not verify via `tsc --noEmit` in this session (tool approval unavailable); relying on `bun test`'s all-green result and manual type reading as a proxy. Flagging as unverified rather than confirmed.

### Regression Risks
None detected.
- No existing exports were removed; `roundNext`, `taskPromptFilePath`, `resolveTaskModel`, and everything in settle.ts from task 98 are untouched and still used identically.
- `registerRoundCommands(program)` is purely additive to `createProgram()` — it does not alter `registerTaskCommands` or any other existing registration, and the full test suite (including all pre-existing test/index.test.ts and test/commands/task.test.ts tests) is green.
- No existing tests were deleted or weakened; test/commands/round.test.ts and test/index.test.ts both grew by pure addition.

### Verdict
HAS_GAPS

---

## Task #101: Reviewer: test summary, diff-range prompt, tools frontmatter, no test re-runs, one-line result
Reviewed: 2026-09-14T05:02:20Z

### Coverage
Task Requirements
├── [DONE] buildPostTaskReviewUserPrompt: optional `testSummary?`, rendered in
│          "## Test Validation (already run by cairn — do not re-run)" section,
│          omitted entirely when undefined (verified via dedicated tests and by reading
│          the implementation: `testSection` is `""` when `testSummary === undefined`)
├── [DONE] Diff-range variant: `diffRange` (e.g. `<beforeSha>..HEAD`) omits the embedded
│          diff/log/files blocks and instructs `git diff <range>`, `git log --oneline <range>`,
│          `git diff --name-only <range>`; `diff` callers still get the embedded output
│          (implemented as an exported `ReviewedChange` discriminated union + `renderChange`)
├── [DONE] settle's writeReviewPromptFile switches to the range variant
│          (`diffRange: \`${beforeSha}..HEAD\``) and passes a test summary
│          (`formatTestSummary(validation)` at the review-gate call site in settle.ts);
│          `getGitDiff` param dropped from `WriteReviewPromptFileOpts`
├── [DONE] "say so explicitly when validation was skipped" — when no `testSummary` is
│          passed to `writeReviewPromptFile` (the awaiting-review repeat-call rewrite in
│          settle.ts, and roundNext's pending-review rewrite in round.ts), it falls back to
│          "Summary not available: test validation ran in an earlier settle call. Full
│          output, if any: <testLogPath>" — verified this is a distinct message from an
│          actual "skipped" validation result, which instead renders
│          formatTestSummary's own "Tests skipped (no test commands declared, or the task
│          was not complete)." Both are distinguishable and both say so explicitly.
├── [DONE] Headless runPostTaskReview / spawnPostTaskReviewer thread an optional
│          `testSummary` through `RunPostTaskReviewOpts` / `SpawnPostTaskReviewerOpts`;
│          `commands/run.ts` passes `formatTestSummary(settled.validation)` when available;
│          headless path still embeds the diff via `getGitDiff` (unchanged, as permitted)
├── [DONE] `buildTestCommandRules` deleted along with its comment; headless
│          `--allowedTools` grant is now exactly Read, Glob, Grep,
│          Edit/Write(reviews dir), and `...GIT_INSPECTION_RULES` — confirmed by reading
│          `spawnPostTaskReviewer` directly and by the exhaustive
│          `captureAllowedTools` test rewrite (absent/empty/populated `tests` all produce
│          the identical grant string)
├── [DONE] `buildCommandRules` / init.ts's `buildInitPermissionRules` left untouched —
│          confirmed via grep: its only remaining use is `src/commands/init.ts:513`
├── [DONE] agents/post-task-reviewer.md frontmatter: `tools: Read, Grep, Glob, Bash, Edit,
│          Write` and `maxTurns: 50` added, both verified present verbatim
├── [DONE] agents/post-task-reviewer.md body: instruction to run declared test commands
│          removed and replaced with "Test validation was already run by cairn ... do not
│          re-run ... use the Test Validation summary ... open the log path ... only if you
│          need the full output"; git-inspection guidance and the output template both
│          retained (verified `git show`, `### Coverage`, `### Verdict` still present)
├── [DONE] agents/post-task-reviewer.md: single-line final response requirement
│          (`PASS` / `CONCERNS: <n>, see <review file path>`) added as a new "Final
│          Response" section
└── [DONE] Tests: post-task-reviewer.test.ts's --allowedTools assertions updated to assert
           no test-command rule and no `cairn task` rule while git-inspection/reviews-dir
           rules remain; summary-section rendering, diff-range variant, and the agent
           file's frontmatter/body are all covered by new tests. settle.test.ts covers the
           range variant plus summary, and the "no summary → earlier settle" fallback.

### Files Changed
- src/post-task-reviewer.ts
- src/settle.ts
- src/test-validator.ts (new `testLogPath` export, factored out of `validateTaskTests`)
- src/commands/run.ts (threads `testSummary` from `settled.validation`)
- agents/post-task-reviewer.md
- test/post-task-reviewer.test.ts
- test/settle.test.ts
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log (task-lifecycle bookkeeping)

### Verification performed
- `bun test test/post-task-reviewer.test.ts` (declared "Expected Tests" entry): **51 pass, 0 fail**, 134
  expect() calls. A `fatal: not a git repository` line appears in stderr output but is expected/harmless —
  it comes from a test exercising `captureGitSha`/`getGitDiff` against a directory that isn't a git repo.
- `bun test` (full suite, declared "Expected Tests" entry): **1057 pass, 0 fail** across 33 files.
- Read the full diff of src/post-task-reviewer.ts, src/settle.ts, src/test-validator.ts, src/commands/run.ts,
  and agents/post-task-reviewer.md directly (not just the task's own notes) to confirm the described
  behavior is actually implemented, not merely asserted in commit notes.
- Confirmed via grep that `getGitDiff` is still exported/used only by the headless path (test file and
  `runPostTaskReview`/`spawnPostTaskReviewer` in commands/run.ts), consistent with "the headless path may
  keep embedding the diff."
- Confirmed via grep that `buildCommandRules` now has exactly one call site (`src/commands/init.ts:513`),
  i.e. init's permission seeding was not touched, and `buildTestCommandRules` no longer exists anywhere.
- Could not run `bunx tsc --noEmit` in this review session (the sandbox declined approval for that command
  with no interactive fallback available); relying on `bun test`'s fully green result plus direct reading of
  the changed type signatures (the `ReviewedChange` discriminated union, the new `testSummary?` fields) as a
  proxy. The task's own notes claim only pre-existing, unrelated tsc errors remain — flagging as unverified
  by me rather than confirmed.
- Did not independently re-verify the `agents/post-task-reviewer.md` → `.claude/agents/` copy step (`cairn
  init`) since it wasn't re-run in this diff and the task correctly says not to hand-edit `.claude/agents/`
  directly; this is out of scope for the diff itself.

### Gaps
None detected.

### Regression Risks
None detected.
- No existing exports were removed in a way other modules still depend on: `getGitDiff`, `captureGitSha`,
  `resolveReviewFilePath`, `runPostTaskReview`, `spawnPostTaskReviewer`, `writeReviewPromptFile` are all
  still exported with backward-compatible (additive-only) signature changes — new fields are optional.
- `WriteReviewPromptFileOpts.getGitDiff` was removed (a breaking signature change), but this is an internal,
  non-exported-elsewhere test seam; the task explicitly calls for this change (settle no longer shells out to
  git for the diff), and test/settle.test.ts was updated to match — no other caller was found still passing
  `getGitDiff` to `writeReviewPromptFile` outside test files.
- Old `--allowedTools` string literals expecting `Bash(bun test:*)` were all removed/rewritten in the same
  commit rather than left stale; no test asserts a grant that the new code no longer produces.
- No test coverage was deleted on net — the old test/post-task-reviewer.test.ts block of ~12 fine-grained
  `buildTestCommandRules`-splitting tests (compound commands, `||`/`;`/`|`/`&`/newline splitting, dedup,
  corrupting-character handling) was replaced by a smaller set of tests asserting the new "no test rule ever
  appears" invariant. This is a reasonable simplification since the exercised code path
  (`buildTestCommandRules`) no longer exists, but it does mean the very detailed shell-splitting-edge-case
  assertions have no replacement anywhere else in the codebase — flagging as a minor coverage-shape change
  rather than a regression, since the underlying `buildCommandRules` splitting logic in `claude-settings.ts`
  is still exercised by `init.ts`'s own tests (not verified directly in this review; worth a spot-check if
  `buildCommandRules`'s test coverage is ever audited separately).

### Verdict
CLEAN

---

## Task #102: agents/cairn-task-agent.md: generic internal task agent with maxTurns
Reviewed: 2026-09-14T05:10:00Z

### Coverage
Task Requirements
├── [DONE] Create agents/cairn-task-agent.md with required frontmatter
│   ├── [DONE] name: cairn-task-agent
│   ├── [DONE] description matches spec text exactly
│   ├── [DONE] internal: true
│   ├── [DONE] maxTurns: 150
│   ├── [DONE] no `tools` field (full tool set)
│   └── [DONE] no `model` field (run agent passes task's model)
├── [DONE] Body: read prompt file named in user prompt, follow exactly
├── [DONE] Body: use `cairn task` subcommands, never Edit/Write tasks.json
├── [DONE] Body: commit as instructed
├── [DONE] Body: end with ≤5-line report the prompt file specifies
├── [DONE] test/commands/init.test.ts: installAgents w/ cairnRoot override + temp
│           project dir installs cairn-task-agent.md
├── [DONE] test/config.test.ts: discoverAgents parses name/internal, confirms
│           camelCase maxTurns key doesn't break parsing
├── [DONE] Never offered as specialist: plan.ts visibleAgents filter test (added
│           to plan.test.ts) + run.ts buildSystemPrompt fallback test (added to
│           run.test.ts)
├── [DONE] TDD: tests added first, failing (missing file), then made to pass
├── [DONE] TEMP DIRS ONLY: installAgents/init exercised only via fs.mkdtempSync
│           temp dirs; real repo root used only as cairnRoot *source* arg
└── [DONE] COMMIT scope: only touched files staged; cairn.json untouched

### Files Changed
- agents/cairn-task-agent.md (new)
- test/commands/init.test.ts
- test/commands/plan.test.ts
- test/commands/run.test.ts
- test/config.test.ts
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log (task lifecycle bookkeeping)

### Verification performed
- Read the committed `agents/cairn-task-agent.md`: frontmatter and body match the task spec verbatim
  (name, description, internal, maxTurns, no tools/model fields, body content).
- Ran `bun test test/commands/init.test.ts`: 145 pass, 0 fail.
- Ran `bun test test/config.test.ts test/commands/plan.test.ts test/commands/run.test.ts`: 245 pass, 0 fail.
- Ran full `bun test`: 1061 pass, 0 fail (matches the notes' claimed count exactly).
- Verified the task's central claim — that no `src/` changes were needed — by reading the actual
  mechanisms invoked, not just trusting the diff:
  - `discoverAgents` (src/config.ts:119) uses `/^(\w+)\s*:\s*(.+)$/` for frontmatter keys, which already
    matches camelCase `maxTurns`; extra unknown keys land in `meta` but aren't surfaced onto `AgentInfo`,
    so they're inert rather than breaking parsing.
  - `buildDynamicContext` in src/commands/plan.ts:82 already does
    `agents.filter(a => !a.internal)` — generic, no name-specific logic.
  - `buildSystemPrompt` in src/commands/run.ts:94-95 already warns and falls back to the generalist
    prompt when the resolved agent has `internal: true` — generic, no name-specific logic.
  - `installAgents` (src/commands/init.ts:465-471) delegates to `installMdDir`, which copies every
    `.md` file in the source `agents/` dir — adding the file was sufficient.
  - `git show 9427b16 --stat` confirms no `src/*.ts` files appear in this task's commit, matching the
    notes' claim that only the new agent file and tests were needed.
- Confirmed `src/commands/round.ts:156` already references
  `subagent_type '${BRAND.name}-task-agent'` (i.e. `cairn-task-agent`) — end-to-end wiring is real, not
  just claimed.
- Confirmed `cairn.json`'s pinned health-check line remains uncommitted and untouched
  (`git diff cairn.json` still shows only the pin-procedure change, not staged in this task's commit).
- Could not independently re-verify the notes' claimed `bunx tsc --noEmit` and pinned
  `bun build --compile ... --outfile /tmp/cairn-healthcheck` health-check results — did not re-run these
  (long-running compiles); taking the notes' report at face value for those two items only. Everything
  else above was independently verified.

### Gaps
None detected.

### Regression Risks
None detected. No exports were removed, no existing tests were deleted or weakened — all four new test
blocks are additive. The task correctly recognized (and this review independently confirmed) that the
generic mechanisms in config.ts/plan.ts/run.ts/init.ts required no changes, avoiding needless churn to
files not actually implicated by this task.

### Verdict
CLEAN

---

## Task #103: cairn hook pre-tool-use: agent_type-aware containment hook (fail-open, logged)
Reviewed: 2026-09-14T05:15:25Z

### Coverage
Task Requirements
├── [DONE] Decision function `decidePreToolUse(input, ctx)` (pure, exported, src/commands/hook.ts)
│   ├── [DONE] Fast path: no agent_id → allow; tool not Edit/Write/Bash → allow (`isFastPathAllow`)
│   ├── [DONE] Rule 1: any subagent Edit/Write to resolved tasks.json path → deny, reason names `cairn task`
│   └── [DONE] Rule 2: agent_type === 'post-task-reviewer' exactly — Edit/Write confined to reviewsDir,
│       Bash confined to GIT_INSPECTION_RULES-derived prefixes (`reviewerBashPrefixes`, no duplication)
├── [DONE] CLI: `hook pre-tool-use` registered in src/index.ts
│   ├── [DONE] Fast startup: preAction skips setupProjectContext when `actionCommand.parent?.name() === 'hook'`
│   └── [DONE] Lazy resolution: findProjectRoot(input.cwd) → findDataDir → reviewsDir/tasksFilePath, only past fast path
├── [DONE] Fail open, visibly: internal errors → exit 1 (never 2, never a deny), timestamped line appended
│   to `.cairn_hook_errors.log` (`hookErrorLogPath`/`tempFilePath`), log-write failures swallowed
├── [DONE] Deny: exit 0 + hookSpecificOutput JSON on stdout (`denyOutput`)
├── [DONE] Surfacing: `roundNext` (round.ts) adds `warnings` when the hook-error log is non-empty, on
│   every verdict branch (wrapped via `pickNext` + `roundWarnings`), and `roundNextCommand` prints the
│   full JSON including `warnings` to stdout
├── [DONE] Gitignore: `'hook_errors.log'` added to `TEMP_IGNORE_SUFFIXES` (init.ts) + init.test.ts updated
└── [DONE] Tests: hook.test.ts (44 tests: fast path, rule 1, rule 2, reviewer Bash allow/deny incl.
    redirection/substitution, CLI handler incl. garbage stdin/malformed cairn.json/log-write failure),
    round.test.ts (warnings present/absent, line count, round-done branch too), index.test.ts
    (registration + preAction skip verified against a malformed cairn.json)

### Files Changed
- src/commands/hook.ts (new) — policy + CLI handler
- src/claude-settings.ts — extracted `splitSubcommands`, added `bashRulePrefix` (both exported, reused
  by the pre-existing `buildCommandRules` so behavior can't drift)
- src/commands/init.ts — `'hook_errors.log'` in `TEMP_IGNORE_SUFFIXES`
- src/commands/round.ts — `roundNext` wraps `pickNext` + `roundWarnings`; `RoundNextResult` gained
  optional `warnings`
- src/index.ts — `hook` command group; preAction early-return for the hook group
- CLAUDE.md — one convention line documenting the hook's preAction skip / fail-open behavior
- test/commands/hook.test.ts (new), test/commands/init.test.ts, test/commands/round.test.ts,
  test/index.test.ts

Expected file src/utils.ts was listed in the task but not touched — verified this is correct, not an
omission: `findDataDir`, `findProjectRoot`, and `tempFilePath` already existed with exactly the
semantics the hook needed (confirmed by reading src/utils.ts directly), so no change was required there.

### Verification (actually run, not inferred from the diff)
- `bun test test/commands/hook.test.ts`: 44 pass, 0 fail, 77 expect() calls — ran directly.
- `bun test` (full suite): 1110 pass, 0 fail, 2391 expect() calls — ran directly, matches the notes' claim.
- `bunx tsc --noEmit`: could not run in this review sandbox (command required elevated approval that
  was not granted); not independently verified. The task notes claim "no new errors in changed files" —
  taken on trust, flagged here as unverified rather than silently accepted.
- Confirmed via `git show 7a52bd5 --name-only` that `cairn.json` was NOT part of the commit despite
  appearing modified in the working tree (still pinned to the throwaway healthCheck outfile) — the
  "stage only files you changed" / "pinned binary" instructions were followed correctly.
- Read src/utils.ts directly: `findDataDir`/`findProjectRoot` never read `cairn.json`, confirming the
  "malformed cairn.json does not affect the hook" test is testing something structurally true, not
  incidentally true.
- Read src/index.ts's preAction wiring directly: `actionCommand.parent?.name() === 'hook'` correctly
  matches the `hook pre-tool-use` subcommand's parent group, confirmed by the passing
  "hook pre-tool-use skips project context setup" test using a real malformed cairn.json in a temp dir.
- Spot-checked `decidePreToolUse` logic by hand against every DECISION FUNCTION bullet in the task
  description; all match, including the reviewer Bash prefix check being derived from
  `GIT_INSPECTION_RULES` via `bashRulePrefix` rather than a second hard-coded list.
- Did not independently re-run the manual "compiled to /tmp and piped real-shaped payloads" probe the
  notes describe — treated as directionally consistent with the automated test coverage, which does
  exercise the same shapes (main-session/general-purpose/internal-helper/reviewer payloads).

### Gaps
None detected. One noted-but-accepted deviation from a literal reading of the spec: the task description
says Bash containment for the reviewer should check "every subcommand ... starts with one of the
prefixes"; the implementation adds an extra check (deny on backtick/`<`/`>`/`$(` before the prefix
check) that is stricter than literally specified but closes a real gap the spec's own examples imply
matter (`git diff && rm x` is denied by the split-based check already; `git diff > out.txt` and
`git diff $(rm x)` would otherwise pass the literal starts-with check since `git diff` is an allowed
prefix). This is called out explicitly in the task's own notes as "EXTRA beyond spec," and is
covered by dedicated tests, so it is a documented improvement rather than an unreviewed one.

### Regression Risks
- `RoundNextResult` changed from a plain union to an intersection with `{ warnings?: string[] }`.
  Checked for breakage: existing tests using `toEqual`/`toMatchObject` on the result still pass (full
  suite green) because `warnings` is only added to the returned object when non-empty — confirmed by
  reading `roundNext`'s implementation (`warnings.length > 0 ? { ...result, warnings } : result`) and
  by the round.test.ts case explicitly asserting `'warnings' in result === false` when the log is
  absent/empty.
- `buildCommandRules` was refactored to call the new `splitSubcommands` instead of inlining the same
  regex; behavior is unchanged (same regex, same trim/filter), and no test regressions surfaced in the
  full run — low risk, but worth a human noting this touches an existing, load-bearing permission-rule
  builder used by `cairn init`'s settings seeding, not just new code.
- No removed exports or deleted tests found. `git show 7a52bd5 --stat` confirms only additions to test
  files (302/1/36/30 lines added, no test file shrank).
- The hook's tasks.json containment (Rule 1) is Edit/Write-only, as specified; a subagent could still
  read or exfiltrate tasks.json via Bash (e.g. `cat .cairn/tasks.json`), and a non-reviewer subagent's
  Bash calls are entirely unchecked. This matches the task description exactly (Rule 1 only mentions
  Edit/Write's `file_path`; Bash containment is scoped to the reviewer only) — not a bug, but worth
  flagging as an inherent scope boundary of this task for whoever relies on this hook as complete
  containment.

### Verdict
CLEAN

---

## Task #104: cairn init seeds the PreToolUse hook into .claude/settings.local.json
Reviewed: 2026-09-14T05:23:04Z

### Coverage
Task Requirements
├── [DONE] src/claude-settings.ts: mergeHookSettings(projectRoot, spec) added
│   ├── [DONE] Uses `{ hooks: { <event>: [ { matcher, hooks: [ { type: 'command', command } ] } ] } }` shape
│   ├── [DONE] Idempotent — no-op + added:false if any group under the event already has the exact command
│   │           (verified: "treats the command as present in any PreToolUse group, whatever its matcher" test,
│   │           and confirmed by hand-running mergeHookSettings twice via `bun -e` — second call made no write,
│   │           inode unchanged)
│   ├── [DONE] Preserves user hooks, other events, other matcher groups; appends rather than mutates
│   │           (verified via the "appends a new group, leaving the user's PreToolUse groups and other events
│   │           intact" and "does not count the command under a different event" tests, both passing)
│   ├── [DONE] Same error contract as mergeClaudeSettings (throws ClaudeSettingsError, file untouched)
│   │           (verified: malformed-JSON and wrong-shape tests pass; also hand-verified with a live
│   │           malformed-permissions file via `bun -e` that mergeHookSettings throws via the *shared*
│   │           readSettings() permissions check before writing anything — the file was byte-identical
│   │           after the throw)
│   └── [DONE] Returns { created, added, settingsPath }
├── [DONE] src/commands/init.ts: seed it during init
│   ├── [DONE] Folded into installClaudeSettings under the same single prompt (explicit design choice per
│   │           the task's "pick one and test it"); confirmed no other prompt-answer sequence needed updating
│   │           because no new prompt was added — allDefaultAnswers() and every other positional sequence in
│   │           init.test.ts was left alone and the full suite still passes
│   ├── [DONE] Explanatory log lines updated to mention the containment hook
│   ├── [DONE] Logs what was added (hook line only appears when hookResult.added, verified by test and by
│   │           hand-run)
│   └── [DONE] On ClaudeSettingsError, reports and continues rather than throwing (verified both by the
│               "reports a hooks-shape error and continues without throwing" test and by a hand-run repro
│               against a malformed-permissions file: `added` came back `[]`, the error was logged, and the
│               file was left byte-identical)
└── [DONE] HAZARD respected — hook never seeded into this repo
            (verified directly: this repo's real .claude/settings.local.json has no "hooks" key, and
            `git show 721d356 --name-only` / `git diff cairn.json` confirm cairn.json's only diff is the
            pre-existing, already-uncommitted pinned-healthCheck change, untouched by this commit)

### Files Changed
- src/claude-settings.ts (+mergeHookSettings, HookSpec, HookMergeResult, groupHasCommand)
- src/commands/init.ts (+CAIRN_PRE_TOOL_USE_HOOK, installClaudeSettings updated to merge the hook first)
- test/claude-settings.test.ts (+11 tests for mergeHookSettings)
- test/commands/init.test.ts (+7 tests for the hook seeding in installClaudeSettings/runInit)

### Verification performed
- `bun test test/claude-settings.test.ts`: 53 pass, 0 fail.
- `bun test` (full suite): 1128 pass, 0 fail, across 34 files.
- `bun run build` (`bun build --compile src/index.ts --outfile dist/cairn`): compiles clean, no type
  errors surfaced — dist/cairn is gitignored so this left no stray diff.
- Hand-verified with ad hoc `bun -e` scripts (no test files written, per the "temp dirs only" instruction —
  all against fs.mkdtempSync'd directories, never this repo):
  - Confirmed the ordering rationale in the code comment ("the hook merge runs first ... so a file any step
    would refuse is refused before any step writes") is actually true, not just asserted: with a
    `{"permissions":"broken"}` file, `mergeHookSettings` throws via the shared `readSettings()` permissions
    check (which validates permissions regardless of which merge function calls it) before it ever writes,
    so there is no interleaved-write scenario where the hook lands on disk but the function still reports
    `added: []`. Checked this because the three writes in `installClaudeSettings` (`mergeHookSettings`,
    `removeSettingsRules`, `mergeClaudeSettings`) are not transactional — a partial-write-then-report-failure
    bug was a real possibility to rule out, and it does not occur, precisely because `readSettings` bakes
    permissions validation into every one of the three calls.
  - Confirmed a second `mergeHookSettings` call against the same file is a true no-op (unchanged inode).
- Did not independently verify the TDD claim (write failing test, watch it fail, then implement) from git
  history — the task landed as a single squashed commit (721d356), so there is no intermediate red/green
  commit to inspect. This is a structural limitation of the one-commit-per-task workflow, not something
  specific to this task; noted rather than silently assumed.

### Gaps
None detected.

### Regression Risks
- None found. `mergeClaudeSettings`, `removeSettingsRules`, `readSettings`, and `writeSettingsAtomic` are
  unchanged (diff only adds new code to claude-settings.ts); no existing export was removed or altered in
  signature. `installClaudeSettings`'s public signature and return type (`Promise<string[]>`) are unchanged,
  only its return contents gained one more possible string. No test was deleted; net test count increased
  (53 in claude-settings.test.ts, up from 42; init.test.ts gained 7 new cases) — full suite confirms no
  reduction in coverage.
- Minor, non-blocking observation: `installClaudeSettings` now performs up to three sequential file
  read/parse/write cycles per call (`mergeHookSettings`, `removeSettingsRules`, `mergeClaudeSettings`) where
  before there were two. Purely a constant-factor cost on a tiny local file during `cairn init`; not a
  correctness or regression concern.

### Verdict
CLEAN

---

## Task #105: /cairn-run slash command (commands/cairn-run.md)
Reviewed: 2026-09-14T05:15:00Z

### Verification performed
- Ran `bun test test/commands/init.test.ts`: 155 pass, 0 fail, 332 expect() calls — includes both new
  tests (`installs cairn-run.md from a cairnRoot override pointing at the real repo root`, `cairn-run.md
  has description frontmatter and names every command, agent and tool the run loop needs`).
- Ran the full `bun test`: 1130 pass, 0 fail, 2439 expect() calls.
- `git show 4067776 --stat`: confirms the commit touched only `commands/cairn-run.md` and
  `test/commands/init.test.ts` — matches "Expected Files" other than the three files the task allowed
  itself to only *read* (`commands/generate-tasks.md`, `src/commands/round.ts`, `src/settle.ts`).
- `git status --short`: `cairn.json` still shows as a pre-existing uncommitted modification, not staged
  or committed by this task — the "stage only files you changed" / "cairn.json has an uncommitted change"
  instruction was honored.
- Read `src/commands/round.ts` (`roundNext`, `roundNextCommand`, `registerRoundCommands`) and
  `src/settle.ts` (`settleTask`, `Verdict`, `reviewVerdict`, `retryNext`) in full and cross-checked every
  verdict shape and every `next` hint string the command file quotes or paraphrases against the actual
  source:
  - `task` verdict fields and its `next` string (Agent tool, `cairn-task-agent`, model, promptFile, then
    `cairn round settle <id>`) — matches `round.ts`'s literal `next` string.
  - `review` verdict (from both `next` and `settle`) — both paths return the same `reviewVerdict()` helper,
    so "handle it exactly like settle's review" is factually correct, not just plausible-sounding.
  - `round-done` verdict fields (`blocked`, `next`) — matches.
  - `retry` verdict's two modes (`continue`/`fresh`) and their `next` strings from `retryNext()` — matches,
    including the `continue`-mode fallback to a fresh agent when the id is lost.
  - `blocked` verdict (settle-only; `cairn round next` never emits `blocked` itself, only a `blocked` count
    inside `round-done`) — the command file correctly scopes the `blocked` bullet under settle's verdicts
    only, not next's.
  - `done` / `already-settled` — both resolve to `NEXT_ROUND` ("Run: cairn round next"); command file's
    "run `cairn round next`" for both is correct.
  - `warnings` — only `roundNext`/`roundNextCommand` ever attaches a `warnings` array (via
    `roundWarnings()`); `settleTask`/`roundSettleCommand` never do. The command file scopes "surface
    warnings" under the `next` section only, correctly.
  - Non-zero exit — both `roundNextCommand` and `roundSettleCommand` return 1 only when the call itself
    threw (unreadable tasks.json, lock timeout, unknown id) and write one line to stderr; every resolved
    verdict, `blocked` and `already-settled` included, returns 0. Matches the "When a command fails"
    section exactly.
- Read `commands/generate-tasks.md`, `commands/review-tasks.md`, and (for a third data point)
  `commands/codebase-audit.md`, plus `git log --oneline -- commands/generate-tasks.md
  commands/review-tasks.md` back to their creation (`2eab54a`, `5c0f1aa`): **none of the three ever had
  YAML frontmatter** — all three start directly with an `# H1` heading. See Gaps below.
- Confirmed `agents/cairn-task-agent.md` and `agents/post-task-reviewer.md` exist, so the two
  `subagent_type` values the command file names are real, installed agents, not invented ones.
- Checked `test/commands/init.test.ts` for any fixed-count assertion over `.claude/commands/` contents
  that a new `commands/cairn-run.md` file could break (e.g. `toHaveLength` over a directory listing) —
  found none; the full-suite pass above confirms no such regression.
- Not independently verifiable: strict TDD sequencing (test written and observed failing before the
  implementation) inside this task, since the work landed as a single squashed commit
  (`4067776`) with no intermediate history to inspect. The two tests and the new file are consistent with
  TDD having been followed (the tests assert very specific string content the file exactly satisfies), but
  I have no direct evidence beyond that consistency.

### Coverage
Task Requirements
├── [DONE] `commands/cairn-run.md` created, installed via existing `installSlashCommands`/`installMdDir`
├── [DONE] Loop step 1 (`task` verdict → Agent tool, subagent_type, model, promptFile, remembered id, then settle)
├── [DONE] Loop step 2 (`review` from next or settle → post-task-reviewer, then `settle --reviewed`)
├── [DONE] Loop step 3 (`retry` continue → SendMessage w/ fallback to fresh agent; `retry` fresh → new agent)
├── [DONE] Loop step 4 (`blocked` → PushNotification + continue, never AskUserQuestion)
├── [DONE] Loop step 5 (`round-done` → PushNotification summary, then stop)
├── [DONE] Loop step 6 (non-zero exit → PushNotification with stderr line, then STOP)
├── [DONE] Loop step 7 (surface `warnings` once)
├── [DONE] Loop step 8 (one agent at a time, no nesting, never touches tasks.json/diffs/logs, follow `next`, stay terse)
├── [DONE] Loop step 9 (permission-mode note: bypassPermissions recommended, auto caveat, default/acceptEdits will stall)
├── [PARTIAL] Loop step 10 (frontmatter with description) — frontmatter itself is present and matches the
│   test's regex, but the task's own instruction to follow "the format of commands/generate-tasks.md and
│   commands/review-tasks.md" describes a format that does not exist: neither reference file has ever had
│   frontmatter (verified back to their initial commits). The implementer added frontmatter anyway to
│   satisfy the test, which is the only sensible resolution, but the stated cross-reference is simply
│   wrong/unfollowable as written — flagging so it isn't mistaken for something the implementer missed.
└── [DONE] TDD-in-task structure (test + implementation both present in the one task commit; sequencing
    itself unverifiable — see Verification above)

### Files Changed
- `commands/cairn-run.md` (new)
- `test/commands/init.test.ts` (two new tests appended to the `installSlashCommands` describe block)

### Gaps
- Minor documentation gap, not a functional bug: the command file tells the run agent to "remember the
  agent id ... keyed by taskId" (step 1) but never explicitly says to also remember `model` and
  `promptFile` for later use, even though the `fresh`-mode retry bullet later assumes both are still known
  ("launch a new cairn-task-agent with the same model and prompt file"). It does supply a fallback for a
  lost prompt file ("run `cairn round next` — it re-picks the task and rewrites the prompt") but no
  equivalent fallback if `model` alone is forgotten (e.g. after compaction retains the id but not the
  original JSON). Low impact since `cairn round next`'s fallback effectively recovers both, but worth a
  one-line tightening in a follow-up pass.
- The task-description's frontmatter cross-reference is unfollowable as written — see the [PARTIAL] item
  above. Not something further work on this task could fix (the reference files are what they are); noting
  it so the discrepancy is on record rather than silently absorbed.

### Regression Risks
None detected. Full `bun test` (1130 pass / 0 fail) confirms no other `installSlashCommands`/
`installAgents` test broke from the new file appearing in `commands/`. The change is additive only — no
existing export, type, or CLI contract was touched (`src/commands/round.ts` and `src/settle.ts` were read
for reference but not modified in this commit), and no test coverage was removed.

### Verdict
HAS_GAPS

---

## Task #106: Migrate .cairn/instructions.md to CLAUDE.local.md (init migration, gitignore warning, deprecation, README)
Reviewed: 2026-09-14T05:37:41Z

### Coverage
Task Requirements
├── [DONE] 1. Loader deprecation: loadPersonalInstructions keeps reading instructions.md, warns once
│           per process on stderr, content unchanged. Loader + all 4 call sites (run.ts,
│           post-task-reviewer.ts, plan.ts, summarize.ts) left untouched — verified via grep.
├── cairn init (src/commands/init.ts)
│   ├── [DONE] Migration prompt "Move .cairn/instructions.md into CLAUDE.local.md? [Y/n]" when
│   │           non-blank instructions.md exists; no-op (no prompt) when absent/blank.
│   ├── [DONE] On yes: appends to existing CLAUDE.local.md with blank line + heading
│   │           "## Personal instructions (migrated from .cairn/instructions.md)", or creates it
│   │           verbatim if absent; deletes instructions.md; never overwrites existing content.
│   ├── [DONE] createInstructionsFile now offers to create/open CLAUDE.local.md at project root,
│   │           keeping the injectable $EDITOR/spawnSync mechanism.
│   └── [DONE] Gitignore: warn-only via injectable `git check-ignore -q CLAUDE.local.md` run from
│               projectRoot; returns null (skip, no warn) on any non-0/1 exit (covers "outside a
│               git repo" and command-not-found alike); never edits .gitignore/git config; mirrors
│               installClaudeSettings's warning wording. instructions.md retained in the data-dir
│               GITIGNORE_CONTENT template as instructed.
└── [DONE] README.md: "Personal Agent Instructions" section rewritten around CLAUDE.local.md
            (native, reaches every session including headless agents and /cairn-run subagents);
            new "Migrating from .cairn/instructions.md" subsection; ~line 85 init file list, the
            data-layout diagram (~line 313-314), and the Tips bullet (~line 352) all updated; the
            old wrong claims ("execution agents only, not planning" / "only injected during
            cairn run") are gone.

### Files Changed
- src/personal-instructions.ts
- src/commands/init.ts
- README.md
- test/personal-instructions.test.ts
- test/commands/init.test.ts
- .cairn/tasks.json / .cairn/tasks.completed.json (task bookkeeping)

### Verification performed
- `bun test test/personal-instructions.test.ts`: 9 pass, 0 fail (matches notes' claim).
- `bun test` (full suite): 1154 pass, 0 fail (matches notes' claim).
- `bunx tsc --noEmit` could not be run in this review sandbox (command required interactive
  approval that wasn't grantable here) — unverified this pass; the task notes claim "no new
  errors in changed files," which I could not independently confirm.
- Manually traced `runInit`'s call order and every new/changed function
  (`migrateInstructionsFile`, `createInstructionsFile`, `isPathGitIgnored`,
  `warnIfClaudeLocalMdNotIgnored`) against the task spec's exact behavioral requirements (prompt
  wording/default, append-vs-create, never-overwrite, warn-vs-edit, skip-outside-git-repo) — all
  matched.
- Confirmed via `grep` that `loadPersonalInstructions` is still called from exactly the same 4
  call sites, unchanged.
- Confirmed via `git diff`/`git status` that this repo's own `.cairn/instructions.md` and
  `CLAUDE.local.md` were not touched, per the task's explicit carve-out.
- Confirmed `src/index.ts`'s `runInit(...)` call site still compiles logically against the new
  optional trailing params (`spawnSyncFn`, `checkIgnoreFn` both default correctly).

### Gaps
None detected against the task's stated requirements. One minor, non-blocking documentation nit:
README's project-layout diagram labels `CLAUDE.local.md` as "Personal agent preferences
(gitignored — see Personal Agent Instructions)" — read in isolation (without following the
cross-reference) this could suggest Cairn gitignores it automatically, when the implemented
behavior is warn-only (the user must add the entry themselves). The linked section does explain
this correctly, so it's a minor clarity issue rather than a factual error.

### Regression Risks
None detected. The old dataDir-`.gitignore`-appending behavior inside `createInstructionsFile`
was intentionally removed (superseded by the permanent `instructions.md` line already in
`GITIGNORE_CONTENT`, confirmed still present); no other caller of `createInstructionsFile` exists
outside `runInit`. No exports other tests/modules depend on were removed — `loadPersonalInstructions`'s
return shape and the 4 call sites are untouched. Test coverage was not reduced: old
dataDir-gitignore-specific tests were removed but replaced with more targeted, correctly-scoped
coverage for the new behavior (migration, gitignore-warning, CLAUDE.local.md create/open).

### Verdict
CLEAN

---

## Task #107: Delete dead review.maxIterations config (old key keeps validating)
Reviewed: 2026-09-14T05:44:00Z

### Coverage
Task Requirements
├── [DONE] src/types.ts: CairnConfig.review narrowed to `{ postTask: boolean }`
├── [DONE] src/types.ts: isValidConfig stops requiring maxIterations, still accepts a review
│          block that carries it (verified in code: comment + no read/type-check of the key)
├── [DONE] src/config.ts loadConfig: stops emitting maxIterations; legacy key on disk is
│          read into reviewRaw but never copied into the returned config (silently ignored)
├── [DONE] src/commands/init.ts: reviewMaxIterations removed from ConfigDefaults and
│          getConfigDefaults; "Auto-review max iterations" prompt removed from
│          promptForConfig; written config only ever contains `review.postTask`
├── [DONE] init tests: positional mock-answer sequences re-derived after the removed prompt
│          shifted every later answer back one slot (verified by reading promptForConfig's
│          prompt order against the updated arrays — order/count line up)
├── [DONE] test/types.test.ts: added "accepts config with review.postTask only" and "accepts
│          config with legacy review.maxIterations alongside postTask" backward-compat tests
├── [DONE] test/config.test.ts: added/updated tests proving legacy maxIterations is ignored
│          rather than emitted, and that a review block without it still loads
├── [DONE] test/commands/init.test.ts, test/commands/run.test.ts, test/post-task-reviewer.test.ts:
│          all review.maxIterations fixture/assertion references updated
└── [DONE] cairn.json left untouched (verified via `git diff cairn.json` — only the
           user's pre-existing pinned-healthCheck change is present, task did not touch it
           or stage it in the commit)

### Files Changed
- src/types.ts
- src/config.ts
- src/commands/init.ts
- test/types.test.ts
- test/config.test.ts
- test/commands/init.test.ts
- test/commands/run.test.ts
- test/post-task-reviewer.test.ts

### Verification performed
- `bun test test/types.test.ts` → 31 pass, 0 fail (matches "Expected Tests").
- `bun test` (full suite) → 1153 pass, 0 fail, 34 files (matches "Expected Tests"). Two harmless
  stderr lines appear (`instructions.md is deprecated...` from task #106's loader, and
  `fatal: not a git repository` from an init.test.ts git-check-ignore test run outside a repo) —
  both pre-existing behavior from prior tasks, not introduced here, and neither fails a test.
- `bun test test/commands/init.test.ts test/config.test.ts test/commands/run.test.ts
  test/post-task-reviewer.test.ts` (exactly the task's Expected Files' test files) → 423 pass,
  0 fail.
- Read the final `src/types.ts`, `src/config.ts`, `src/commands/init.ts` in full to confirm the
  implementation matches the four numbered CHANGES in the task description verbatim (shown above).
- `git diff cairn.json` confirms the repo's `cairn.json` still carries the legacy
  `review.maxIterations` key and the user's pinned `healthCheck` redirect, and that neither was
  touched or staged by this task's commit (8ee0053) — consistent with "DO NOT EDIT cairn.json".
- Grepped all remaining `maxIterations` references repo-wide: the only ones left outside
  `runRun`'s unrelated loop-count option are in `test/settle.test.ts` and
  `test/commands/round.test.ts` (not in this task's Expected Files, and the task notes explicitly
  flag them as intentionally left for a future cleanup); both files pass in the full-suite run
  above, confirming the legacy key doesn't break them.
- Did not independently re-run `git show <sha>:<path>` diffs for every file beyond what's in the
  supplied diff — the supplied diff was complete and consistent with a fresh `git log`/`git diff`
  check of the current working tree, so no discrepancy to chase.

### Gaps
None detected. All four numbered CHANGES in the task description are implemented, TDD was
followed (notes describe red-then-green for each of the three test files with narrative
evidence, and the full suite is green now), and the two explicitly-out-of-scope files
(test/settle.test.ts, test/commands/round.test.ts) were correctly left alone per the task's own
scoping.

### Regression Risks
None detected. `CairnConfig.review` narrowing from `{maxIterations, postTask}` to `{postTask}`
is additive-safe: nothing in the codebase read `review.maxIterations` before this change (per the
task's own dead-code framing, confirmed by the pre-change grep of call sites), so no runtime
behavior depended on it. Backward compatibility for on-disk configs carrying the legacy key is
explicitly tested in both `isValidConfig` (types.test.ts) and `loadConfig` (config.test.ts). No
exports were removed that other modules depend on — `CairnConfig`, `isValidConfig`, `loadConfig`,
`ConfigDefaults`, `getConfigDefaults`, and `promptForConfig` all keep their names and only shed an
unused field/prompt. No test coverage was reduced — old maxIterations-specific tests were replaced
1:1 or 2:1 with more targeted tests (dead-key-ignored, postTask-only, legacy-key-still-validates).

### Verdict
CLEAN

---

## Task #108: Docs: CLAUDE.md and README.md for /cairn-run, cairn round, run state, hook enforcement
Reviewed: 2026-09-14T06:00:00Z

### Coverage
Task Requirements
├── [DONE] 1. Two ways to run a round (headless `cairn run` vs interactive `/cairn-run`), shared `settleTask`, `cairn round`/`cairn hook` added to CLAUDE.md's execution-flow list and README's Commands table, "why round not task" explained in both files
├── [DONE] 2. Run state: `.cairn_run_state.json` shape, on-disk not in-memory, `cairn task set-status` resets records, fixed thresholds (2/3/3), settle order validate→archive→review-gate, verdicts/exit codes, test/prompt/review-prompt file paths, data-layout tree and Conventions line updated, no surviving in-memory-guard-counters claim
├── [DONE] 3. Enforcement under /cairn-run added to CLAUDE.md's Agent workflow section without weakening the headless story; hook mechanics (agent_id/agent_type branching, deny-via-exit-0-JSON, fail-open exit 1→log→surfaced by `round next`, no-op for main/generate-tasks/headless) and all three probe facts recorded verbatim
├── [DONE] 4. Recommended permission mode for /cairn-run (bypassPermissions+hook, auto caveat, default/acceptEdits stall) in both files
├── [DONE] 5. Reviewer no-longer-runs-tests / explicit tools list / headless grant dropped test-command rules — the old "one prefix rule per subcommand of the task's declared tests entries" sentence is gone, replaced with an accurate description
├── [DONE] 6. CLAUDE.md now documents CLAUDE.local.md / instructions.md deprecation (task 106 had updated only README, never CLAUDE.md — confirmed via `git show <106-sha>^:CLAUDE.md`, which had zero mentions of instructions.md/CLAUDE.local.md before this task)
└── [DONE] 7. Pin/unpin procedure for self-modifying rounds section left untouched (not present in the diff hunks at all)

### Files Changed
- CLAUDE.md
- README.md

### Verification
- Read the full current source of `src/settle.ts`, `src/run-state.ts`, `src/commands/hook.ts`, relevant parts of `src/claude-settings.ts`, `src/commands/init.ts`, `src/post-task-reviewer.ts`, `src/commands/round.ts`, and `commands/cairn-run.md`, and checked every specific documented claim against it:
  - `REVERT_BLOCK_THRESHOLD`=2, `STALL_BLOCK_THRESHOLD`=3, `INCOMPLETE_BLOCK_THRESHOLD`=3 — match.
  - Settle order (validate → guards → re-read status → archive → review gate) and record-clearing rules (`done`/block clear, `retry`/`review` keep) — match `settleTask` exactly.
  - Run-state shape `{ iteration, attempts: { beforeSha, iteration, reverts, stalls, incompletes, phase } }`, atomic rename write, "unparseable file reads as empty" — match `run-state.ts`.
  - Hook: no-`agent_id` fast-path allow, `tasks.json` deny for any subagent, `post-task-reviewer` scoped to `reviews/` + git-inspection-only Bash (no redirection/backticks/`$()`), deny via exit-0 JSON, internal errors exit 1 and log to `.cairn_hook_errors.log` — match `hook.ts` line for line.
  - Reviewer's headless `allowedTools` array (`Read, Glob, Grep, Edit(reviewFileRule), Write(reviewFileRule), ...GIT_INSPECTION_RULES`) — confirmed no test-command rules remain, matching the corrected CLAUDE.md sentence.
  - `cairn round next`/`settle` verdict shapes and exit-code story — match `round.ts`.
  - `/cairn-run` step-by-step loop description in both docs — matches `commands/cairn-run.md` almost verbatim.
- Ran the declared test command: `bun test` → **1153 pass, 0 fail, 2482 expect() calls, 34 files, 8.40s**. No pre-existing failures, no failures introduced.
- Confirmed via `git show --stat HEAD` that the commit touched only `CLAUDE.md` and `README.md` (157 lines total), and via `git status --porcelain` that the working tree's separate `cairn.json`/tasks.json changes are uncommitted and untouched by this task's commit — satisfies "stage only CLAUDE.md and README.md" and "do NOT modify cairn.json's healthCheck".
- Confirmed `cairn.json`'s `healthCheck` was not touched by this task's commit (not in the diff). Could not directly verify `./install.sh` was never run (no way to observe a negative after the fact); no evidence in the diff or repo state contradicts the pinned-binary instruction.
- Could not verify the two "probe facts" sections (hook behavior under `bypassPermissions`, exit 1/127 vs exit 2 semantics) by actually driving Claude Code's hook mechanism in this review — that requires a live interactive session with subagents, which is outside what a docs review can exercise. The prose is faithful to `hook.ts`'s own header comment, which documents the same facts as "probed, not assumed"; I'm relying on that comment as the source of truth rather than independently re-probing.

### Gaps
None detected against the task's seven numbered requirements. One pre-existing, out-of-scope nit noticed while cross-checking consistency: README's per-project directory tree (`your-project/` diagram, unchanged by this diff) still labels `CLAUDE.local.md` as "(gitignored — see Personal Agent Instructions)", but `cairn init` only *warns* if it isn't gitignored and never edits `.gitignore` itself (confirmed in `src/commands/init.ts`), so the file may not actually be gitignored in a given project. This line predates task 106 (present since task 65's docs commit) and was not introduced or required to be fixed by task 108's stated scope, so it's noted here only for potential future cleanup, not counted as a gap in this task.

### Regression Risks
None detected. This is a documentation-only change — no source files were touched, `bun test` is fully green, and the full 1153-test suite matches the pre-task baseline (task 108 has no code diff to regress). No exports, contracts, or test coverage were affected.

### Verdict
CLEAN
