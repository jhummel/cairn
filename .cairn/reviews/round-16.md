## Task #109: Type-check gate: skipLibCheck, typecheck script, typescript devDependency, fix the two src/ type errors
Reviewed: 2026-09-19T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] 1. tsconfig.json: add "skipLibCheck": true (strict + include: ["src"] unchanged)
├── [DONE] 2. package.json: "typecheck": "tsc --noEmit" script; build/test scripts untouched
├── [DONE] 2. typescript devDependency, pinned ("7.0.2", not "latest"); bun.lock updated
├── [DONE] 3. Widen description to optional in buildPostTaskReviewUserPrompt (line ~52) and SpawnPostTaskReviewerOpts (line ~147)
├── [DONE] 3. Missing description renders "(no description)" placeholder, never "undefined"
├── [DONE] 4. `bun run typecheck` exits 0 (both settle.ts:239 and post-task-reviewer.ts:325 errors resolved)
├── [DONE] TESTS: no-description prompt has no 'undefined' and renders the placeholder; existing tests stay green
├── [DONE] Commit hygiene: only the 5 intended files committed; cairn.json's uncommitted healthCheck change left untouched
└── [DONE] Pinned-binary constraints: cairn.json healthCheck not committed, install.sh not run
```

Verification actually performed:
- `bun test test/post-task-reviewer.test.ts` → 52 pass, 0 fail.
- `bun run typecheck` (`tsc --noEmit`) → printed only `$ tsc --noEmit`, no diagnostics, and the run reported no failure (the tool did not permit me to echo `$?` in the same command, so exit 0 is inferred from a clean run rather than read directly).
- `bun test` (full suite) → 1154 pass, 0 fail across 34 files (the pre-task baseline was 1153, so the +1 is the new test).
- `git show --stat HEAD` → the commit touches only bun.lock, package.json, src/post-task-reviewer.ts, test/post-task-reviewer.test.ts and tsconfig.json.
- `git diff HEAD -- cairn.json` → shows the uncommitted user change (`healthCheck` → /tmp/cairn-healthcheck), so it was not swept into the commit.
- I did not independently re-run the test in a pre-fix state to watch it fail (TDD red step). I could not verify that from the diff alone. The assertion (`"### Description\n(no description)"`) would necessarily fail against the old `${task.description}` template, so I consider it credible.

### Files Changed
- tsconfig.json
- package.json
- bun.lock
- src/post-task-reviewer.ts
- test/post-task-reviewer.test.ts

### Gaps
None detected. Minor notes:
- `src/settle.ts` is listed under Expected Files but was not modified. That is correct: once the parameter type is widened, the `Task` passed at settle.ts:239 type-checks unchanged, and `bun run typecheck` is clean. No gap.
- The template uses `||`, so an empty-string description also renders "(no description)". That is sensible behavior, but only the `undefined` case is tested, not `""`.

### Regression Risks
None detected. Observations:
- Widening `description` to optional is purely permissive for callers, and the only other caller (settle.ts) is now type-correct. Tasks that have a description render exactly as before.
- The typescript devDependency resolves to 7.0.2, which is the native-port major version and pulls in many platform-specific optional packages in bun.lock. It is pinned and dev-only, so it does not affect the compiled binary or runtime dependencies. It is worth a quick check on any CI or contributor platform that is not in the lockfile's list.
- `include: ["src"]` still excludes test/, as the task intended, so the ~43 known test type errors are not surfaced by this gate.

### Verdict
CLEAN

---

## Task #110: ensureAttemptRecord: decide the attempt record's beforeSha under the lock (close the silent review-skip race)
Reviewed: 2026-09-19T19:45:00Z

### Coverage
```
Task Requirements
├── run-state.ts
│   ├── [DONE] Export pure upsertAttemptRecord(state, taskId, iteration, headSha): creates newAttemptRecord if missing, else keeps beforeSha/counters and sets iteration, returns the record
│   └── [DONE] Export ensureAttemptRecord(dataDir, taskId, iteration, headSha, store): one store.update wrapping upsert (returns a shallow copy)
├── Callers
│   ├── [DONE] runRun captures HEAD unconditionally outside the lock, then calls ensureAttemptRecord; beforeSha for the review is read from the returned record
│   ├── [DONE] roundNext captures HEAD unconditionally, then calls upsertAttemptRecord inside the existing iteration-bumping store.update (single locked pass)
│   ├── [DONE] Both unlocked existence checks removed (priorAttempt in run.ts, state.attempts[attemptKey] in round.ts)
│   └── [DONE] No shell-out inside the lock (captureGitSha runs before store.update in both callers)
├── Behavior preserved
│   └── [DONE] A re-pick keeps the first attempt's beforeSha; the existing round test was updated only for the sha-call count (0 to 1), and its beforeSha assertion is unchanged
├── Tests
│   ├── [DONE] run-state.test.ts: upsert creates with the sha; keeps beforeSha and counters and updates iteration; null-head case; ensureAttemptRecord file-store round-trip, second-call keep, recreate after clear
│   ├── [DONE] round.test.ts: store whose read() shows the record and whose update() state lacks it ends up with the captured HEAD, not null
│   ├── [DONE] run.test.ts: same stale-read/empty-update fake, asserting the record seen at spawn time has the captured sha
│   └── [PARTIAL] TDD red step: cannot be verified after the fact. The race tests would necessarily fail against the old code, since it wrote capturedSha = null, but I did not run them against the pre-change tree.
├── [DONE] bun run typecheck exits 0 (observed: `tsc --noEmit` printed nothing, then my chained echo ran)
├── [DONE] Live-repo hazard: tests use temp dirs and injected store/deps; no `cairn round|hook` was run against the repo root (nothing in the diff does)
└── [DONE] cairn.json not touched; ./install.sh not run; the commit stages only the expected src/test files plus .cairn/state.json and .cairn/tasks.json
```

### Verification performed
- `bun test test/run-state.test.ts test/commands/round.test.ts test/commands/run.test.ts` → 206 pass, 0 fail.
- `bun run typecheck` → clean, exit 0.
- `bun test` (full suite) → 1162 pass, 0 fail across 34 files.
- `git show d2e79f4 --stat` → the commit touches exactly the 6 expected files plus .cairn/state.json and .cairn/tasks.json. cairn.json is not in the commit.
- grep of src/: no remaining unlocked existence check on `attempts[...]` in run.ts or round.ts, and captureGitSha is only called outside store.update in both callers.

### Files Changed
- src/run-state.ts
- src/commands/run.ts
- src/commands/round.ts
- test/run-state.test.ts
- test/commands/run.test.ts
- test/commands/round.test.ts
- .cairn/state.json (task-ID counter bumped by task generation)
- .cairn/tasks.json (new round-16 task list; committed as cairn does each round)

### Gaps
None detected. Minor notes:
- The TDD red step is not verifiable from the diff.
- `ensureAttemptRecord` returns a shallow copy, while `upsertAttemptRecord` returns the live record. This is deliberate and documented in the notes, and it is safe because runRun only reads `beforeSha` from the result.
- The unlocked `state` read at roundNext entry is still used for the pending-review check. That is correct and out of scope, but task 112's orphan-pruning must not reuse that stale snapshot to decide anything under the lock.

### Regression Risks
None detected. Observations:
- Behavior change: captureGitSha (`git rev-parse`) now runs on every pick, including re-picks. The cost is small. Any test or fake that asserts zero sha calls on a re-pick would break, and the one such round test was updated (0 to 1). The full suite is green.
- If `captureGitSha` returns null (e.g. no git repo or an unborn HEAD), a new record still gets `beforeSha: null`, exactly as before. The fix closes the stale-read path but not the genuinely-no-HEAD case, which settle handles by recovering the sha from git or returning `no-before-sha`.
- `upsertAttemptRecord` takes a numeric taskId, and both callers pass `task.id`. Type-checks clean.

### Verdict
CLEAN

---

## Task #111: Self-sufficient retry verdicts: carry promptFile and model; assert the failure tail
Reviewed: 2026-09-19T19:50:00Z

### Coverage
```
Task Requirements
├── [DONE] 1. retry Verdict variant gains promptFile + model; `next` names both (continue fallback + fresh)
│      (src/settle.ts; also covers status-unknown retries, since they go through the same helper)
├── [DONE] 2. Import cycle avoided
│   ├── [DONE] taskPromptFilePath moved into settle.ts beside reviewPromptFilePath; re-exported from round.ts
│   └── [DONE] resolveTaskModel moved into task-selector.ts; re-exported from run.ts; round.ts imports it from task-selector
│      (settle.ts imports only task-selector, not commands/*)
├── [DONE] 3. SettleTaskInput.agents?: AgentInfo[] (defaults to [])
│   ├── [DONE] roundSettleCommand takes `agents` and passes it to settleTask; the CLI action passes loadRoundContext()'s agents
│   └── [DONE] cairn run passes its agents into settleInput
├── [DONE] 4. commands/cairn-run.md: retries use the verdict's promptFile/model
│   ├── [DONE] continue fallback and fresh both use them; agent id is still remembered for SendMessage
│   ├── [DONE] the "run cairn round next if you don't know the prompt file" fallback was removed (now redundant)
│   └── [DONE] a content test was added to init.test.ts (there was no old wording assertion to update)
├── [DONE] 5. failure-tail coverage gap (#96)
│   ├── [DONE] test/settle.test.ts asserts failureTail → failure, and that failure is omitted when there is no tail
│   └── [DONE] test/commands/round.test.ts retry case asserts failure: 'boom'
└── [DONE] TESTS: validation-failed/continue, stalled/fresh and incomplete continue→fresh carry promptFile and model
    ├── [DONE] model resolution covers task.model, a specialist agent's model, and the opus default
    └── [DONE] `next` naming is asserted in settle and round tests
```

Verification actually run:
- `bun test test/settle.test.ts test/commands/round.test.ts test/commands/init.test.ts`: 278 pass, 0 fail.
- `bun run typecheck`: exit 0.
- `bun test`: 1168 pass, 0 fail across 34 files.
- A grep confirmed that the old import sites (`resolveTaskModel` from commands/run in test/commands/round.test.ts, `taskPromptFilePath` from round) still resolve through the re-exports. A grep for "same prompt file" / "same model" across commands/, agents/, src/ and CLAUDE.md found nothing stale.
- Not verifiable: the TDD red step (only the final commit is visible).

### Files Changed
- commands/cairn-run.md
- CLAUDE.md (verdict summary updated; not in Expected Files, but it is appropriate doc upkeep)
- src/settle.ts
- src/task-selector.ts (hosts resolveTaskModel; the task allowed this module)
- src/commands/round.ts
- src/commands/run.ts
- test/settle.test.ts
- test/commands/round.test.ts
- test/commands/init.test.ts
- .cairn/tasks.json (task status/notes bookkeeping)

Not touched: src/types.ts (AgentInfo already existed and is only imported), cairn.json, install.sh.

### Gaps
None detected. Minor notes:
- src/types.ts is listed in Expected Files but needed no change.
- The `promptFile` in a retry verdict is computed, not checked for existence. Under /cairn-run, `cairn round next` always wrote it earlier. Under `cairn run` the field is ignored. Settle does not verify the file, which is acceptable, but a deleted prompt file would make the relaunch fail.
- The round.test.ts retry test uses `agents` only in one new case. Coverage of the default-agents path relies on the opus expectation in the existing case. This is adequate.

### Regression Risks
None detected. Observations:
- The `retry` Verdict shape gained two required fields, and `next` wording changed (it now contains the model and path). Any external consumer that matches the old `next` text verbatim would break. In-repo, the only such assertions were the settle.test.ts constants, which were updated. The full suite is green.
- `resolveTaskModel` and `taskPromptFilePath` keep their old export paths, so no importer broke. The `export { X }` statements in run.ts and round.ts sit mid-file after imports. That is stylistic only.
- settle.ts now depends on task-selector.ts. task-selector imports only utils/types, so no cycle is introduced.

### Verdict
CLEAN

---
## Task #112: Prune orphaned executing run-state records (never awaiting-review)
Reviewed: 2026-09-19T19:55:00Z

### Coverage
```
Task Requirements
├── [DONE] 1. roundNext prunes executing records whose task is not in tasks.json
│   ├── [DONE] Task path: pruneOrphanedAttempts runs inside the existing single store.update (iteration bump + upsertAttemptRecord); it runs after the health check, so the lock is not held across it
│   ├── [DONE] Round-done path: one short update only when orphanedAttemptKeys(snapshot) is non-empty; otherwise no write
│   └── [DONE] awaiting-review is never pruned (orphanedAttemptKeys filters on phase === 'executing'; the pending-review return happens before any prune)
├── [DONE] 2. settle.ts: already-settled clears a leftover executing record
│   ├── [DONE] The clear is a short store.update that re-checks phase === 'executing' under the lock
│   └── [DONE] An awaiting-review record returns 'review' earlier and is never touched
├── [DONE] 3. Locking: no run-state lock is taken inside a mutateTasksFile callback; none is held across the health check or validation
├── [DONE] TESTS: round.test.ts
│   ├── [DONE] Task-path prune in exactly one update, with a live sibling record untouched
│   ├── [DONE] Round-done prune, with no iteration bump
│   ├── [DONE] Round-done with no orphans makes 0 updates
│   └── [DONE] awaiting-review survives and is returned first; it also survives both prune passes when the snapshot misses it
├── [DONE] TESTS: settle.test.ts
│   ├── [DONE] already-settled clears an executing record (sibling kept, no validation run)
│   ├── [DONE] awaiting-review for an archived task returns 'review' and the record is kept
│   └── [DONE] The lock re-check keeps a record that turned awaiting-review
├── [DONE] `bun run typecheck` exits 0
├── [DONE] Live-repo hazard: the new tests use injected stores/deps and the existing temp-dir harness
└── [DONE] cairn.json untouched and not committed; install.sh not run
```

Verification actually performed:
- `bun test test/commands/round.test.ts test/settle.test.ts` → 112 pass, 0 fail.
- `bun run typecheck` → printed only `$ tsc --noEmit`, and my chained `&& echo TYPECHECK_OK` fired, so exit 0 is confirmed.
- `bun test` (full suite) → 1176 pass, 0 fail across 34 files.
- `git show --stat HEAD` → the commit touches .cairn/tasks.json, CLAUDE.md, src/commands/round.ts, src/run-state.ts, src/settle.ts, test/commands/round.test.ts and test/settle.test.ts. cairn.json is not in the commit, and `git diff HEAD -- cairn.json` still shows the uncommitted user change.
- I read src/commands/round.ts `pickNext` and the src/settle.ts idempotency block in the working tree to confirm the prune ordering and lock placement.
- Not verifiable: the TDD red step (only the final commit is visible). The new tests would necessarily fail against the old code, since nothing removed the records.

### Files Changed
- src/commands/round.ts
- src/run-state.ts (new `orphanedAttemptKeys` / `pruneOrphanedAttempts` helpers)
- src/settle.ts
- test/commands/round.test.ts
- test/settle.test.ts
- CLAUDE.md (one line in the run-state section; not in Expected Files, but appropriate doc upkeep)
- .cairn/tasks.json (task status/notes bookkeeping)

### Gaps
None detected. Minor notes:
- The task-path prune uses `liveTaskIds` from the tasks.json read taken before the health check. A task added to tasks.json in that window whose record was created by another path would look orphaned. Records are only created for tasks already in tasks.json, so this is very unlikely, and the next `round next` recreates the record with a `git`-recovered beforeSha anyway.
- While a review is pending, `roundNext` returns before reading tasks.json, so orphans are not pruned until the review is done. This is intentional and noted in the task notes.
- The round-done decision uses the entry-time snapshot. That is fine because the actual deletion re-evaluates phase against live state under the lock. The test with a stale-snapshot store covers awaiting-review surviving.

### Regression Risks
None detected. Observations:
- Deleting `executing` records for tasks absent from tasks.json also discards guard counters (reverts/stalls/incompletes) for a task that was temporarily removed from tasks.json, for example by a human hand-editing the file. That is the requested behavior; `set-status` already clears records the same way.
- The public contract is unchanged: the verdict shapes are the same, and `already-settled` still has no other side effects. The new exports in run-state.ts are additive.
- The task path adds one loop over the attempts under the lock, which is negligible.

### Verdict
CLEAN

---

## Task #113: Reviewer hook: deny git --output (a write primitive hidden in read-only git commands)
Reviewed: 2026-09-19T13:55:00-06:00

### Coverage
Task Requirements
├── [DONE] Deny reviewer Bash when any token of any subcommand is `--output` or `--output=...` after quote stripping (`hasOutputOption`, checked per subcommand in `isInspectionOnly`)
├── [DONE] Do NOT deny `--output-indicator-*` (exact-token / `--output=` prefix match; tested as allow)
├── [DONE] Deny reason mentions `--output` is not allowed
├── [DONE] Scope respected: src/post-task-reviewer.ts untouched; only the two expected files committed (cairn.json not staged)
├── [DONE] Tests: deny `git diff --output=x`, `git log --output x`, `git show HEAD --output=/tmp/y`, `git diff "--output=x"`, `git status && git log --output=z` (plus an extra single-quoted case)
├── [DONE] Tests: allow `git diff --output-indicator-new=+ HEAD~1`, `git log --oneline -5`; existing allow cases still pass
├── [DONE] `bun test test/commands/hook.test.ts`: observed 53 pass / 0 fail
├── [DONE] `bun run typecheck`: observed, tsc --noEmit clean
└── [DONE] `bun test`: observed 1185 pass / 0 fail across 34 files

### Files Changed
- src/commands/hook.ts
- test/commands/hook.test.ts

### Gaps
None detected against the task's stated requirements. The TDD red step can't be verified after the fact, because the single commit contains both the test and the implementation.

### Regression Risks
- Residual bypass (PLAUSIBLE, found by reading the code; I could not run a probe because writing a scratch script was denied): `hasOutputOption` strips quote, backslash and dollar characters from tokens but leaves braces. The pre-check regex only rejects backticks, `<`, `>` and `$(`, so brace-style variable expansion is not blocked. A token like `--output` followed by a brace-wrapped unset variable and `=/tmp/f` becomes `--output{X}=/tmp/f` after stripping. That neither equals `--output` nor starts with `--output=`, so it passes the hook. Bash then expands the variable to empty, git receives `--output=/tmp/f`, and the file is written. Suggested hardening: deny reviewer Bash containing any `$`, rather than stripping it. This goes beyond the task's literal spec (surrounding-quote stripping only), so it is a residual hole, not a regression.
- The extra stripping of backslash and dollar is harmless for legitimate inspection commands; no existing allow case changed.
- The headless `cairn run` reviewer remains unprotected against `--output` by design (documented as out of scope).

### Verdict
HAS_RISKS

---

## Task #114: Settle fixes: persist a --before-sha override on a repeat awaiting-review call; pin the incomplete guard's validation-status rule
Reviewed: 2026-09-19T20:00:00Z

### Coverage
```
Task Requirements
├── 1. --before-sha on a repeat awaiting-review call (#97)
│   ├── [DONE] Override that differs from record.beforeSha is saved via a short store.update (guarded on the record still existing)
│   ├── [DONE] Review prompt file rewritten even when it already exists (skipped under inlineReview)
│   ├── [DONE] Same/absent override: unchanged (rewrite only if missing)
│   └── [DONE] settleTask doc comment updated
├── 2. Incomplete guard (#94)
│   ├── [DONE] Comment at the guard explains the dependency on validateTaskTests
│   └── [DONE] Table-driven test over passed/failed/skipped/error × re-read in-progress (asserts incompletes, reverts, retry reason)
├── TESTS (test/settle.test.ts)
│   ├── [DONE] Different override persists + rewrites existing file (fake harness + real-fs test asserting `sha-override..HEAD` in the file and the old sha gone)
│   ├── [DONE] Same/absent override leaves existing file untouched
│   ├── [DONE] Incomplete-guard status table
│   └── [DONE] Extra: inlineReview override persists without writing a file; later no-flag call keeps the persisted override
├── [DONE] `bun run typecheck` exits 0
└── [DONE] Commit hygiene: only src/settle.ts, test/settle.test.ts and the .cairn task files were committed; cairn.json and install.sh not touched
```

Verification actually performed:
- `bun test test/settle.test.ts` → 72 pass, 0 fail.
- `bun test` (full suite) → 1193 pass, 0 fail across 34 files.
- `bun run typecheck` → printed only `$ tsc --noEmit`, no diagnostics. I could not read `$?` directly (the tool blocked a compound command), so exit 0 is inferred from the clean output.
- `git show --stat HEAD` confirms the commit touches only .cairn/tasks*.json, src/settle.ts and test/settle.test.ts.
- Read src/test-validator.ts (~lines 289-315): `skipped` for no tests or a non-complete task, and `error` when tasks.json is unreadable. That matches the new comment, and the implementer's note that `error` can also arise from an unreadable tasks.json regardless of task status is correct.
- I did not re-run the new tests against the pre-fix code. The implementer reports 3 review tests failed before the fix and the status table passed immediately, which fits a table that pins existing behavior.

### Files Changed
- src/settle.ts
- test/settle.test.ts
- .cairn/tasks.json (task marked complete, and the completed task #112 and #113 entries moved out of it)
- .cairn/tasks.completed.json (archive of tasks #109-#113)

### Gaps
None detected. src/test-validator.ts is listed under Expected Files but was correctly left unchanged, since only a comment in settle.ts was required.

### Regression Risks
None detected.
- Minor observation: the override update guards on `if (r)`, so a record cleared between the read and the update gets no write, but the prompt file is still rewritten with the override sha. That is a harmless race, since settle clears records on done or block anyway.
- Minor observation: the `.cairn/tasks.json` diff also removes tasks #112 and #113, which are archived in tasks.completed.json. This is the normal archive flow and is unrelated to #114.

### Verdict
CLEAN

---

## Task #115: Cleanups: shared CLI writer module; remove review.maxIterations from test fixtures
Reviewed: 2026-09-19T00:00:00Z

### Coverage
```
Task Requirements
├── 1. Shared writers (#99)
│   ├── [DONE] New src/cli-io.ts exporting Writer, defaultStdout, defaultStderr (bodies identical to the removed copies)
│   ├── [DONE] src/commands/task.ts: local copies removed, imports from ../cli-io
│   ├── [DONE] src/commands/round.ts: local copies removed, imports from ../cli-io
│   ├── [DONE] Behavior identical (raw process.stdout/stderr.write passthrough, no newline changes)
│   └── [DONE] No test imported Writer/defaultStd* from task.ts/round.ts (grep confirmed), so no re-export needed
├── 2. maxIterations fixtures (#107)
│   ├── [DONE] test/settle.test.ts REVIEW_ON (line 84) key removed
│   ├── [DONE] test/settle.test.ts review-disabled case (line ~903) key removed
│   ├── [DONE] test/commands/round.test.ts review object (line 704) key removed
│   ├── [DONE] Unrelated runRun/buildIterationPrompt maxIterations test (round.test.ts:445) untouched
│   └── [DONE] types.test.ts / config.test.ts legacy-key tests and cairn.json untouched
├── [DONE] TESTS: optional cli-io test added (test/cli-io.test.ts, verbatim passthrough for stdout/stderr via spyOn)
├── [DONE] TYPECHECK: `bun run typecheck` printed only `$ tsc --noEmit` and my `&&` chain reached TYPECHECK_OK, i.e. exit 0
└── [DONE] Commit hygiene: commit touches only the 6 intended files; cairn.json's uncommitted change remains unstaged
```

Verification actually performed:
- `bun test test/commands/task.test.ts test/commands/round.test.ts test/settle.test.ts test/cli-io.test.ts` → 158 pass, 0 fail.
- `bun run typecheck` → exit 0 (confirmed via `&&` chain).
- `bun test` (full suite) → 1195 pass, 0 fail across 35 files.
- Grep of `defaultStdout|defaultStderr|type Writer` across *.ts: only cli-io.ts defines them; task.ts and round.ts import them. Grep of `maxIterations` in settle.test.ts and round.test.ts leaves only the intentionally retained runRun test at round.test.ts:445.
- Not verified: I did not run the compiled `cairn` binary (live-repo hazard for round/hook commands).

### Files Changed
- src/cli-io.ts (new)
- src/commands/task.ts
- src/commands/round.ts
- test/cli-io.test.ts (new; not listed in Expected Files but permitted by the "add a small test only if worthwhile" clause)
- test/commands/round.test.ts
- test/settle.test.ts

### Gaps
None detected. Note: test/commands/task.test.ts was listed as an expected file but needed no change (nothing imports the writers from it) — appropriate.

### Regression Risks
None detected. Minor observation (out of scope, not a regression): src/commands/hook.ts:30 still has its own `type Writer = { write: (chunk: string) => void }` copy. The task only named task.ts and round.ts, so this was correctly left alone, but it could be folded into cli-io.ts in a later cleanup.

### Verdict
CLEAN

---

## Task #116: Docs: CLAUDE.md and README.md for the round-16 changes
Reviewed: 2026-09-19T00:00:00Z

### Coverage
Task Requirements
├── [DONE] 1. Development: `bun run typecheck` added to CLAUDE.md command block; note that it covers src/ only, test/ has ~43 pre-existing errors, and `bun build --compile` / `bun test` don't type-check so `tests` arrays should include it (README has no Development/equivalent section — verified by grep, nothing to add)
├── [DONE] 2. Pin/unpin: rule against running `cairn round …` / `cairn hook …` (or `bun src/index.ts round|hook …`) on the project root added after the numbered steps; rest of section untouched
├── [DONE] 3. `retry` verdict carries `promptFile` + `model`, named in `next` (CLAUDE.md + README); matches round.ts / settle.ts
├── [DONE] 4. Run state: pick records beforeSha under lock (first sha kept on re-pick); `round next` prunes `executing` orphans, never `awaiting-review`; `already-settled` clears leftover record
├── [DONE] 5. Hook `--output` / `--output=` denial documented (matches hook.ts exact-token check) + "Remaining headless gap" paragraph; README hook bullet updated
└── [DONE] 6. README layout label reworded to "add to .gitignore yourself — `cairn init` only warns" (matches init.ts warning-only behavior)

### Files Changed
- CLAUDE.md
- README.md

### Gaps
None detected. Minor nit: the two new Run-state bullets ("Picking records the sha under the lock", "Orphan pruning") partly repeat the existing "Settle clears…/Orphans…" bullet and the re-pick bullet directly above; harmless redundancy, but could be consolidated.

### Regression Risks
None detected. Docs only; commit 19504af touches exactly CLAUDE.md and README.md (cairn.json's uncommitted change was not staged; it remains modified in the working tree). Verified: `bun run typecheck` passes (tsc --noEmit, no errors); `bun test` → 1195 pass, 0 fail. Doc claims spot-checked against src/commands/hook.ts (--output token check, denial reason), src/commands/round.ts (promptFile, `next`, pruneOrphanedAttempts, upsertAttemptRecord at pick) and src/commands/init.ts (warns only, never edits .gitignore). I did not separately re-verify the settle.ts `already-settled` clearing or the retry-verdict `model` field beyond grep hits.

### Verdict
CLEAN

---
