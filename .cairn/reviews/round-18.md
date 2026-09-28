# Round 18 — post-task reviews

## Task #131: Round-scoped temp-file sweep: /cairn-run leaves every prompt, review prompt, tests log and notes file behind
Reviewed: 2026-09-19T00:00:00Z

### Coverage
```
Task #131 Requirements
├── [DONE] Extract run.ts's sweep into one shared helper (no duplicated regex)
│   ├── [DONE] New module src/temp-sweep.ts exporting sweepRoundTempFiles(dataDir, deps?)
│   ├── [DONE] run.ts's private TEMP_FILE_SUFFIXES / NOTES_TEMPFILE_RE / escapeRegExp removed,
│   │          not copied (verified: no second copy of the regex remains in src/)
│   └── [DONE] Both notes prefixes kept in the alternation (NOTES_TEMP_PREFIX + BRAND.tempPrefix),
│              with the load-bearing comment carried over verbatim
├── [DONE] Widen to <tempPrefix>task_<id>_prompt.md / _review_prompt.md / _tests.log
│          (TASK_SCOPED_TEMPFILE_RE; names cross-checked against settle.ts's
│          taskPromptFilePath/reviewPromptFilePath and test-validator.ts's testLogPath —
│          all three are tempFilePath(dataDir, `task_<id>_...`), so the regex matches
│          exactly what the code writes)
├── [DONE] Call it from `cairn round next`'s round-done branch, before the JSON verdict
│          (src/commands/round.ts:123, inside pickNext's `!task` branch, after the blocked
│          count and before the returned object; the CLI handler prints afterwards)
├── [DONE] Keep run.ts's call-site behaviour identical
│          (same injected deps.existsSync/unlinkSync/readdirSync are threaded through, so the
│          existing mocked-fs tests and the "readdirSync failure is swallowed" test still apply)
├── [DONE] MUST-NOT-sweep list protected
│   ├── [DONE] By construction: both regexes require `task_<digits>_` after a literal prefix,
│   │          so run_state.json(.lock), iterations.log, tasks_snapshot.json, hook_errors.log,
│   │          .gitignore, state.json, tasks.json, tasks.completed.json, planning-notes.md and
│   │          reviews/ can never match
│   └── [DONE] Explicit negative tests in BOTH suites — round.test.ts writes the real protected
│              files (plus reviews/round-1.md) into a real temp dataDir and asserts survival;
│              run.test.ts asserts none of them is ever passed to unlinkSync
├── [DONE] Sweep only at round-done, never per-task
│          (no call in the `review` or `task` branches of pickNext, none in settle.ts;
│          reasoning recorded in the call-site comment and the module docblock)
└── [DONE] Best-effort throughout — every unlink and the readdir are individually
           try/caught, the function returns void and cannot throw, so no verdict or exit
           code can change
```

### Files Changed
- `src/temp-sweep.ts` (new) — `sweepRoundTempFiles`, `NOTES_TEMPFILE_RE`, `TASK_SCOPED_TEMPFILE_RE`
- `src/commands/run.ts` — inline sweep replaced by a call to the shared helper
- `src/commands/round.ts` — sweep call added to the round-done branch
- `test/commands/round.test.ts` — +2 tests (positive sweep, negative MUST-NOT list) against a real temp dataDir
- `test/commands/run.test.ts` — +2 tests (new per-task suffixes, negative MUST-NOT list) with mocked fs
- `.cairn/tasks.json` — task #131 marked complete with notes (CANARY-17 present, per CLAUDE.local.md)

Verification performed: inspected `b3af80c..HEAD` with `git diff`/`git log`; read the post-change
`round.ts`, `temp-sweep.ts`, `settle.ts`, `test-validator.ts`, `task-selector.ts`, `task-archiver.ts`
and `utils.ts` to confirm the swept names match the written names and that nothing else reads the
swept files. Test validation was run by cairn before this review (not re-run here):
`bun run typecheck` passed [480ms], `bun test` passed (1221 pass, 0 fail) [8616ms].
Not verifiable from here: the completion note's claim that six narration tests fail in isolation
on main as well — I did not run the suite, so that pre-existing-failure claim is unconfirmed.

### Gaps
None detected.

### Regression Risks
1. **Post-round diagnostics for blocked tasks are now deleted** (low severity, and explicitly
   mandated by the task description). Sweeping `<tempPrefix>task_<id>_tests.log` means that when a
   round ends with `blocked > 0` — precisely the verdict whose `next` tells the human "blocked
   task(s) need attention" — the full validation output that explains the block is removed in the
   same call, both under `/cairn-run` (round-done) and under `cairn run` (loop exit, where the log
   previously survived indefinitely). What survives is the task note's `summarizeFailure` line
   (last failing command, output truncated to 300 chars) and `settle`'s `failureTail`. If that
   turns out to be too thin in practice, the cheap fix is to skip `_tests.log` for tasks that are
   currently `blocked` while still sweeping the rest.

Checked and found NOT to be risks:
- `.cairn_completed_ids` is now deleted on the `/cairn-run` path too, but `loadCompletedIds()`
  falls back to `tasks.completed.json`, so settle's `already-settled` detection and
  `selectNextTask`'s dependency resolution are unaffected.
- Deleting `_prompt.md` / `_review_prompt.md` cannot strand a retry or a review: round-done is
  only reachable when `selectNextTask` returns null (no pending/in-progress task, so no retry is
  outstanding), and both `roundNext`'s review branch and `settleTask`'s awaiting-review branch
  rewrite the review prompt file when it is missing.
- No exports were removed that other modules import: `NOTES_TEMPFILE_RE`/`TEMP_FILE_SUFFIXES` were
  module-private in `run.ts` and are not referenced elsewhere; `tempFilePath` and
  `NOTES_TEMP_PREFIX` are still used in `run.ts` (iteration log path, system-prompt notes path).
- No tests were deleted or weakened; the existing "readdirSync failure must be swallowed" test
  still exercises the new code path through the injected deps.
- `cairn.json`'s pinned `healthCheck` and `install.sh` were left untouched, per the self-modifying
  round procedure; the only uncommitted `cairn.json` change predates this task.

### Verdict
HAS_RISKS

---

## Task #132: cairn init: gitignore merge must not abort init, and must respect a user's ! negation
Reviewed: 2026-09-20T00:30:00Z

### Coverage
```
Task #132 Requirements
├── [DONE] 1. Changed failure contract — a bad .cairn/.gitignore must not abort init
│   ├── [DONE] try/catch added at the call site in initCoreFiles (src/commands/init.ts:145-154),
│   │          so the merge failure is contained before tasks.json/state.json are written
│   │          (verified by reading the post-change file: both creations follow at :160-178)
│   ├── [DONE] Failure reported, not thrown — message names the file and the manual fix
│   │          ("Could not update <dir>/.gitignore (<err>). Fix or remove it by hand — the
│   │          rest of init will continue.")
│   ├── [DONE] Shape mirrors installClaudeSettings's unusable-settings handling (read it at
│   │          :730-742: try/catch around the merge, report, continue). No third error style
│   │          invented; the one deliberate difference is noted under Gaps below.
│   └── [DONE] mergeGitignoreEntries itself still throws, with the contract documented in its
│              docstring ("the caller decides whether that should abort") — the only call site
│              in src/ is initCoreFiles (confirmed via `git log -S`: the symbol was introduced
│              by #117 and has no other src/ user)
├── [DONE] 2. `!` negation respected
│   ├── [DONE] negatedEntries set built from trimmed lines starting with `!` (slice(1).trim(),
│   │          so `! entry` is handled too); an entry present in EITHER existingLines or
│   │          negatedEntries counts as present (init.ts:104-111)
│   └── [DONE] Everything else from #117 unchanged — same append-only block under the same
│              GITIGNORE_MERGE_HEADER, same position-independent trimmed exact match, early
│              `return 0` when nothing is missing (no write, not even a newline fix), no
│              reorder/rewrite/removal anywhere in the function
├── [DONE] Test 1: unreadable .gitignore → stderr message, init still creates tasks.json/state.json
│          (test/commands/init.test.ts, chmod 0o000 + console.error spy, asserts both files exist;
│          perms restored in a finally so afterEach's rmSync still cleans up; self-skips as root)
├── [DONE] Test 2: `!.cairn_iterations.log` left byte-identical and not re-added, while other
│          missing entries are still appended in the same run (asserts startsWith(userContent),
│          no `^\.cairn_iterations\.log$` line, and three other entries present)
├── [DONE] Existing #117 tests kept green and unmodified — the test diff is additions only
│          (no `-` lines); legacy `.ralph_*` fixture, mid-file fixture, second-init no-op and
│          untouched-root-.gitignore all still present verbatim
└── [PARTIAL] TDD (CLAUDE.local.md: test first, see it fail)
           Both tests exist and pass, but the work landed as one commit (f4ec1a4), so red-then-green
           ordering is not verifiable from history; the completion note states this openly. Same
           situation the round-17 reviewer flagged for #117 — noted, not counted as a gap.
```

### Files Changed
- `src/commands/init.ts` — `mergeGitignoreEntries` now skips `!<entry>` opt-outs; `initCoreFiles` wraps the merge in try/catch and reports on stderr; docstrings updated to state the throw/catch contract
- `test/commands/init.test.ts` — +2 tests (unreadable `.gitignore` does not abort init; `!` negation preserved), additions only
- `.cairn/tasks.json` / `.cairn/tasks.completed.json` — task #132 marked complete with notes (CANARY-17 present, per CLAUDE.local.md); the archive move is uncommitted working-tree state from settle, which is expected

Verification performed: inspected `4610bc0..HEAD` with `git diff`/`git log --oneline`/`--name-only`;
read the post-change `src/commands/init.ts` (merge function, `initCoreFiles`, and
`installClaudeSettings` at :706-777 to check the "mirror its shape" instruction against the real
code); read the new tests and the test file's imports/`beforeEach`/`afterEach` to confirm the spies
and chmod restore are sound; `git log -S mergeGitignoreEntries -- src/` to confirm there is no
second call site. Test validation was run by cairn before this review and not re-run here — I read
`.cairn/.cairn_task_132_tests.log` directly: `bun run typecheck` exit 0 [623ms], `bun test` exit 0,
1223 pass / 0 fail across 35 files [8925ms] (1221 → 1223 = the two new tests, nothing removed).
Not verifiable from here: the TDD ordering claim above, and the behaviour on a *directory* named
`.cairn/.gitignore` (the description's other example) — that path is covered by the same catch by
construction (EISDIR from `readFileSync`), but no test exercises it.

### Gaps
None detected. Two deliberate, in-spec deviations worth recording rather than counting as gaps:
- **Error channel differs from the function it mirrors.** `installClaudeSettings` reports through
  its injectable `log` (stdout by default); the new handler uses `console.error` (stderr).
  `initCoreFiles` takes no `log` injection, and the task's own Test 1 specifies stderr, so this is
  what was asked for — but the two "unusable file" messages now land on different streams.
- **Negation matching is exact-string, like the positive matching #117 shipped.** `!/.cairn_iterations.log`
  (leading-slash spelling, valid gitignore) is not recognised as an opt-out, so init would still
  append the positive entry. The description scoped the fix to `!<entry>` exactly, and this is the
  same pre-existing limitation as the positive side, so it is out of scope here.

### Regression Risks
None detected.

Checked and found NOT to be risks:
- No exports removed or signatures changed: `mergeGitignoreEntries(gitignorePath): number` is
  byte-identical in signature and is still exported; `initCoreFiles` is unchanged in signature.
- No behaviour change for the common paths: a missing `.gitignore` still gets `GITIGNORE_CONTENT`
  verbatim; a file already containing every entry still returns 0 and is not rewritten; a file
  missing entries still gets exactly the #117 append block.
- The new catch cannot swallow a real init failure it should not: it wraps only the
  `mergeGitignoreEntries` call, not the `tasks.json`/`state.json` writes below it.
- The chmod-0 test cannot leave a poisoned temp dir behind (perms restored in `finally` before
  `afterEach`'s recursive `rmSync`), and self-skips under root where `chmod 0` proves nothing.
- No tests deleted or weakened — the test-file diff contains no removals, and total suite count
  rose by exactly the two added tests.
- `cairn.json`'s pinned `healthCheck` and `install.sh` untouched, per the self-modifying-round
  procedure; the only uncommitted `cairn.json` change predates this task.

### Verdict
CLEAN

---

## Task #133: Hook: a fail-open error must still reach .cairn_hook_errors.log when the payload cwd has no .cairn/
Reviewed: 2026-09-20T00:35:00Z

### Coverage
```
Task #133 Requirements
├── [DONE] Split the ERROR LOG destination from the DECISION resolver
│   ├── [DONE] New exported `resolveHookErrorLogDir(payloadCwd, fallbackCwd): string | null`
│   │          (src/commands/hook.ts:51-86): candidate 1 = findDataDir(findProjectRoot(payloadCwd,
│   │          { ignoreEnv: true })) when a payload cwd exists, candidate 2 = findDataDir(
│   │          findProjectRoot(fallbackCwd)) (ordinary resolution: CAIRN_PROJECT_ROOT, then cwd);
│   │          first candidate that exists on disk wins, else null
│   └── [DONE] Catch block now `dataDir ?? resolveHookErrorLogDir(payloadCwd, fallbackCwd)` and
│              appends only when non-null (hook.ts:270-273), replacing the old
│              `findDataDir(resolveProjectRoot())` + existsSync
├── [DONE] DECISION still resolved from the payload cwd with ignoreEnv (#119 not undone)
│          — hook.ts:235-236/248 are unchanged; verified against `git show f4ec1a4:src/commands/hook.ts`,
│          the only diff hunks are the new helper, the comments, the opts docstring and the catch line.
│          The env-var-vs-payload-cwd deny tests (tasks.json target, reviewer reviews/ scope,
│          no-cwd-falls-back-to-env) are untouched and still pass.
├── [DONE] Fail-open contract absolute when no candidate has a data dir: exit 1, never 2, never a deny
│          — every resolution and existsSync inside the helper is individually try/caught, the whole
│          logging attempt stays wrapped, and the new test "no data dir anywhere → still exit 1,
│          never a deny, never a crash" asserts code 1, empty stdout and both temp dirs left empty
├── [DONE] Code comment says explicitly why the split is safe (hook.ts:51-67 and 226-233): the log
│          diverges only when no data dir was found, and a deny requires one
├── [DONE] CLAUDE.md sentence asserting the stronger claim updated (the "Enforcement under
│          /cairn-run" paragraph now describes the split, the reason, and why the deny/log invariant
│          survives). `git log -S"same resolver serves the fail-open"` confirms CLAUDE.md was the only
│          doc carrying the stale claim (the other hits are the round-17 review log and the task
│          records, which are historical and correctly left alone).
├── [DONE] Fast path not regressed: `isFastPathAllow(input)` still runs before any project
│          resolution (hook.ts:246) and touches no filesystem; the "main session is allowed without
│          resolving any context (no data dir needed)" test is unmodified
├── [DONE] Expected files match exactly (src/commands/hook.ts, test/commands/hook.test.ts) plus the
│          CLAUDE.md edit the description itself requested
└── [PARTIAL] TDD (CLAUDE.local.md: write the failing test first, see it fail)
           The specified test exists and is precisely the one asked for — payload cwd = bare dir,
           CAIRN_PROJECT_ROOT = a real project, asserts exit 1 (not 2), empty stdout (call allowed),
           bare dir untouched, and exactly one timestamped line in the fallback project's log
           containing "data dir not found" and the bare path. But the work landed as a single commit
           (49f8144), so red-then-green ordering is not verifiable from history; the completion note
           claims it openly. Same situation as #131/#132 this round — noted, not counted as a gap.
```

### Files Changed
- `src/commands/hook.ts` — new exported `resolveHookErrorLogDir()`; catch block uses it; comments on the decision/log split; `PreToolUseHookCommandOpts.cwd` docstring updated
- `test/commands/hook.test.ts` — +3 tests (fallback log destination end-to-end, no-data-dir-anywhere, two `resolveHookErrorLogDir` ordering unit tests), the old "error log follows the payload cwd project" test rewritten because it asserted the defect, and "data dir not found →" tightened with an explicit `cwd: projectRoot`
- `CLAUDE.md` — the "Enforcement under /cairn-run" resolver paragraph
- `.cairn/tasks.json` — #133 marked complete with notes (CANARY-17 present, per CLAUDE.local.md); `.cairn/tasks.completed.json` archive move is uncommitted working-tree state from settle, as expected

Verification performed: inspected `f4ec1a4..HEAD` with `git log --oneline`, `git diff --stat` and `git diff` per path; read the post-change `src/commands/hook.ts` (:200-279) and `src/utils.ts` `findProjectRoot`/`findDataDir` to confirm the helper's candidate semantics (findProjectRoot never throws — it falls through git-root to cwd — so the helper's null result comes from the existsSync check, which is what the code relies on); read the whole changed region of `test/commands/hook.test.ts` (:236-484) including the outer `beforeEach`/`afterEach` that saves and clears `CAIRN_PROJECT_ROOT`; `git log -S` to confirm no other doc repeats the stale invariant and that `IMPLEMENTATION.md` never described the hook error log. Test validation was run by cairn before this review and not re-run here: per the settle summary, `bun run typecheck` passed [502ms] and `bun test` passed 1226 pass / 0 fail [8687ms] (1223 → 1226 = exactly the three added tests; nothing removed). Confirmed via `git status --ignored .cairn` that the suite left no `.cairn/.cairn_hook_errors.log` in this repo — i.e. no test with a fail-open path escaped into the real project. Not verifiable from here: the TDD ordering claim above, and real `/cairn-run` hook behaviour under an actual Claude Code session (all evidence is unit-level).

### Gaps
None detected. Two in-spec observations recorded rather than counted as gaps:
- **The log can now name a different project than the tool call.** That is precisely what the task asked for, and the logged line always contains the failing path (`data dir not found: <bare>`), so a reader of project A's log can tell the failure came from elsewhere. Worth remembering when triaging a `cairn round next` warning.
- **Both candidates are resolved eagerly** before the existsSync loop, so `findProjectRoot(fallbackCwd)` runs (and may spawn `git rev-parse`) even when the payload-cwd candidate will win. This is the error path only, and the hook has already failed by then, so it costs nothing that matters — but it is a small departure from "stop at the first hit".

### Regression Risks
None detected.

Checked and found NOT to be risks:
- **No exports removed or signatures changed.** `hookErrorLogPath`, `reviewerBashPrefixes`, `decidePreToolUse`, `preToolUseHookCommand` and `PreToolUseHookCommandOpts` are all unchanged; `resolveHookErrorLogDir` is purely additive.
- **#119's containment is intact.** The decision still resolves from the payload cwd with `ignoreEnv: true`; the deny path never consults the new helper (it is reached only inside the catch), and the three env-var-vs-payload-cwd deny tests are unmodified and green.
- **The fast path still does no project lookup.** `isFastPathAllow` is evaluated before `resolveProjectRoot()` and is pure; headless `cairn run` agents and main sessions are unaffected.
- **Fail-open is still absolute.** The helper cannot throw out of the catch block (each candidate's resolution and existsSync is individually guarded, and the whole append is still wrapped), so no path can produce exit 2 or a deny from an internal error.
- **A test was rewritten, not weakened.** The old assertion `expect(fs.existsSync(hookErrorLogPath(envDataDir))).toBe(false)` encoded the defect being fixed; its still-valid half (payload-cwd project wins when it has a data dir) is now covered by a direct `resolveHookErrorLogDir(projectRoot, envRoot) === dataDir` unit test. Net test count rose by three; the diff has no other removals.
- **Tests cannot pollute the real repo's log.** Every test that triggers a fail-open either passes an explicit temp `cwd` (`303`, `316`, `322`, `341`, `478`) or runs with `CAIRN_PROJECT_ROOT` pointed at a temp project (`454`); the outer `beforeEach` deletes any inherited `CAIRN_PROJECT_ROOT`. Confirmed empirically — no `.cairn_hook_errors.log` exists in this repo after the validation run. The completion note flags this trap for future editors.
- **`cairn.json`'s pinned `healthCheck` and `install.sh` untouched**, per the self-modifying-round procedure; no `cairn round`/`cairn hook` invocation against the project root appears in the change.

### Verdict
CLEAN

---

## Task #134: Pin REVIEWER_DISALLOWED_BASH_RULES content in a test; re-probe --out for false positives
Reviewed: 2026-09-20T00:42:00Z

### Coverage
```
Task #134 Requirements
├── [DONE] Content assertion for REVIEWER_DISALLOWED_BASH_RULES in test/claude-settings.test.ts
│   ├── [DONE] New `describe('REVIEWER_DISALLOWED_BASH_RULES')` with a single test,
│   │          `expect(REVIEWER_DISALLOWED_BASH_RULES).toEqual([...])`, all five patterns
│   │          written out as literals ('Bash(*--output*)', 'Bash(*--out*)', 'Bash(*$*)',
│   │          `Bash(*")`, "Bash(*')")
│   ├── [DONE] Literals match the shipped constant exactly, in order
│   │          (src/claude-settings.ts:137-143) — compared character by character, quote
│   │          styles included; the `Bash(*")` entry uses a template literal in both places
│   └── [DONE] The test genuinely fails on the scenarios the task named: emptying the array or
│              dropping 'Bash(*--output*)' both break `toEqual` (structural, not a self-comparison
│              against the imported constant the way #121's wiring test is)
├── [DONE] #121's wiring test kept as-is
│          — test/post-task-reviewer.test.ts is absent from this commit's file list, and
│            `git log -1 -- test/post-task-reviewer.test.ts` still points at 8a4ebd1 (task #121);
│            `git show 8a4ebd1` confirms the surviving assertion is still
│            `spawnArgs[indexOf("--disallowedTools") + 1] === REVIEWER_DISALLOWED_BASH_RULES.join(",")`
├── [PARTIAL] Re-probe `Bash(*--out*)` for false positives, then record the result
│   ├── [DONE] Result recorded in the constant's doc comment with the date
│   │          (src/claude-settings.ts:123-135): commands exercised, the temp-dir-only caveat,
│   │          the "two hyphens" reasoning, and the `git log --output=<file>` control that was
│   │          still denied
│   ├── [DONE] Clean-result branch taken, so no rule narrowing and no counter-example test —
│   │          consistent with the recorded outcome, and GIT_INSPECTION_RULES untouched
│   └── [PARTIAL] The probe ITSELF is unverifiable from here: it left no artifact (temp dir
│                 deleted, no transcript, no test), and this reviewer's Bash scope is limited to
│                 read-only git, so the `claude -p --disallowedTools ...` run cannot be repeated
│                 to confirm. The doc comment is a claim I can check for internal consistency
│                 only. Its reasoning does hold for every command in the reviewer's vocabulary:
│                 none of `git diff|log|show|status|rev-parse` with the flags the reviewer prompt
│                 uses contains the literal two-hyphen substring the rule matches.
├── [DONE] Doc line: `Bash(*--out*)` strictly subsumes `Bash(*--output*)`, both ship deliberately,
│          narrower one for readability (src/claude-settings.ts:118-121)
├── [DONE] GIT_INSPECTION_RULES and every other export of src/claude-settings.ts untouched
│          — the file's only diff hunk is +19 comment lines inside the REVIEWER_DISALLOWED_BASH_RULES
│            docblock; zero executable lines changed anywhere in src/
├── [DONE] Expected files: src/claude-settings.ts + test/claude-settings.test.ts changed;
│          test/post-task-reviewer.test.ts correctly left alone (the task told the agent to keep
│          that test as-is, so "listed but unchanged" is the right outcome, and the notes say so)
├── [DONE] Probe run in a temp dir, not the repo root — no run-state, prompt-file or other round
│          artifact churn appears in the commit or the working tree
└── [DONE] Tests: `bun run typecheck` passed [545ms]; `bun test` 1227 pass / 0 fail [8692ms]
           (per cairn's validation summary, not re-run here). 1226 → 1227 matches exactly one
           added test.
```

### Files Changed
- `src/claude-settings.ts` (+19, comment-only: the subsumption line and the 2026-09-19 re-probe record)
- `test/claude-settings.test.ts` (+21: the import and the new content-pinning describe/test)
- `.cairn/tasks.json`, `.cairn/tasks.completed.json` (task bookkeeping; #133 archived, #134 marked complete)

### Gaps
- **The `--out` probe is recorded but not reproducible.** The task's second item was "verify, then record", and the record exists with a date and a control case — but the verification left nothing behind that a future reader (or this review) can re-run or re-check. The doc comment is now the sole evidence, the same shape of evidence planning-notes.md line 70 objected to ("Any shipped rule needs a test") for the rules themselves. Marked [PARTIAL] rather than [GAP] because the task explicitly prescribed the doc-comment record for a clean result and prescribed a test only for a failing probe — the agent followed the instruction it was given. Making this durable would need a probe harness, which is outside this task's scope.
- **Only `Bash(*--out*)` was probed in isolation**, per the doc comment, not the five shipped rules together. The task asked specifically about `--out`, and the other four were probed in round 17, so no combined-list false-positive check exists for the shipped set as a whole. Low risk — the patterns are independent substring matches, so a union can only deny more, and round 17 covered the `$` and quote patterns.

### Regression Risks
- **`toEqual` on the whole array makes any future rule addition fail this test** (the test is even named "…and nothing else"). That is a deliberate, load-bearing trade-off — the task offered `toContain`-per-pattern as the looser alternative and listed `toEqual` first — and the failure mode is a loud, obvious test edit rather than a silent regression. Recorded so the next person to add a deny rule expects it, not as a defect.

Checked and found NOT to be risks:
- **No production behaviour changed at all.** `src/claude-settings.ts`'s only hunk is inside a `/** */` block; `GIT_INSPECTION_RULES`, `REVIEWER_DISALLOWED_BASH_RULES`'s values, `splitSubcommands`, `bashRulePrefix`, `buildCommandRules`, `mergeClaudeSettings`, `mergeHookSettings` and `removeSettingsRules` are byte-identical to `49f8144`. The shared consumers (`cairn init` seeding, the hook's reviewer Bash scope, `spawnPostTaskReviewer`) cannot have drifted.
- **No exports removed and none added.** The test file adds only an import of an already-exported constant.
- **No tests deleted or weakened.** The test-file diff is pure addition (+21, zero removals), and the suite total rose by exactly one.
- **#121's wiring test survives.** Both assertions now exist and are complementary: wiring (flag present, right position, sourced from the constant) in `test/post-task-reviewer.test.ts`, content (the five literals) in `test/claude-settings.test.ts`.
- **Self-modifying-round procedure respected.** `cairn.json` and `install.sh` are untouched by the commit (the working-tree `cairn.json` modification predates this task — it is the user's pinned `healthCheck`), and no round/hook invocation against the project root appears in the change or left state behind. The only dirty files are the two task JSONs that settle rewrites post-commit.

### Verdict
HAS_GAPS

---

## Task #135: tsconfig: a bare tsc would emit into dist/ alongside the compiled binary
Reviewed: 2026-09-20T00:50:00Z

### Coverage
```
Task #135 Requirements
├── [DONE] Set `"noEmit": true` in tsconfig.json's compilerOptions
│          — read the post-change file: compilerOptions is
│            target/module/moduleResolution/strict/skipLibCheck/**noEmit: true**/types,
│            `include: ["src","test"]` unchanged. The safe behaviour is now a property of the
│            config, not of how tsc happens to be invoked, which was the whole point.
├── [DONE] Decide about `outDir`, and state which and why in the notes
│          — `outDir: "dist"` was DROPPED (the diff hunk is a one-line swap of `"outDir": "dist"`
│            for `"noEmit": true`). The completion notes give the rationale: under `noEmit` the
│            field is inert, keeping it would mislead a reader into thinking tsc still emits to
│            dist/, and keeping it *with a comment* would have meant converting a comment-free
│            JSON file to JSONC for one dead line. Both branches the task allowed were considered
│            and the choice is argued, as asked.
├── [DONE] Do NOT reintroduce `rootDir`
│          — absent from the post-change file; `git log -S"rootDir" -- tsconfig.json` shows the
│            last touch is still #122's removal (0d60b13), not this commit. The typecheck gate
│            over `test/` is intact: the validation run's `tsc --noEmit` exited 0 with
│            `include: ["src","test"]` still in place, which only passes if test/ is accepted.
├── [DONE] Verify `bun run typecheck` still exits 0 over src/ and test/
│          — confirmed from cairn's validation summary (not re-run here): `bun run typecheck`
│            passed [549ms], log line `$ tsc --noEmit`, exit code 0.
├── [PARTIAL-VERIFIED] Verify `bun run build` still produces a working dist/cairn
│          — the agent's notes claim `./dist/cairn --version` → `cairn 0.1.0`. I cannot re-run a
│            build (reviewer Bash scope is read-only git, and a build during a pinned round is
│            exactly what the pin exists to avoid), so this is taken on the notes. It is
│            structurally safe regardless: `package.json`'s build is
│            `bun build --compile src/index.ts --outfile dist/cairn` — an explicit outfile that
│            neither `outDir` nor `noEmit` can influence, and install.sh only ever calls
│            `bun run build` + `ln -sf` (read both files to confirm).
├── [DONE] A bare tsc now emits nothing, and no stray files left in the real dist/
│          — `noEmit: true` overrides a command-line `--outDir`, as the notes state. Verified the
│            outcome directly rather than the claim: `dist/src/index.js` and
│            `dist/test/tsconfig.test.js` do not exist, and `git status --porcelain
│            --ignored=matching -uall dist` reports only the wholesale-ignored `dist/` with no
│            new tracked/untracked entries anywhere in the tree.
├── [DONE] Regression test asserting noEmit true and rootDir absent, with a comment naming the
│          review finding
│   ├── [DONE] New file `test/tsconfig.test.ts` (25 lines): parses the real tsconfig.json via
│   │          `readFileSync(join(import.meta.dir, "..", "tsconfig.json"))`, so it pins the
│   │          shipped file rather than a fixture
│   ├── [DONE] `expect(tsconfig.compilerOptions.noEmit).toBe(true)` and
│   │          `expect(tsconfig.compilerOptions.rootDir).toBeUndefined()` — two tests, one per
│   │          property, each named for the property it protects
│   └── [DONE] Leading comment names the finding precisely: round-17 review,
│              '## Task #122' > 'Regression Risks', first bullet, and restates the dist/-pollution
│              failure mode so the test's purpose survives without the review log
├── [DONE] Do NOT touch package.json's build script or cairn.json's healthCheck
│          — neither file is in commit e088a76 (`git show HEAD --stat`: only
│            .cairn/tasks.completed.json, .cairn/tasks.json, test/tsconfig.test.ts, tsconfig.json).
│            The uncommitted `cairn.json` change is the user's own pin
│            (`healthCheck` → `/tmp/cairn-healthcheck`) and predates this task.
└── [DONE] Expected files match exactly: tsconfig.json + test/tsconfig.test.ts
```

### Files Changed
- `tsconfig.json` — `"outDir": "dist"` → `"noEmit": true` (net one line; `rootDir` still absent, `include` unchanged)
- `test/tsconfig.test.ts` — new, 25 lines: 2 tests + the comment citing the round-17 finding
- `.cairn/tasks.json` / `.cairn/tasks.completed.json` — task bookkeeping (#134 archived, #135 marked complete with notes; CANARY-17 present per CLAUDE.local.md)

Verification performed: inspected `d46ab41..HEAD` with `git log --oneline`, `git diff` and `git show --stat`; read the post-change `tsconfig.json`, `package.json`, `install.sh` and `test/tsconfig.test.ts`; used `git log -S"outDir"` across `tsconfig.json` and the docs to find every other place the option is named; probed for stray emit by attempting to read `dist/src/index.js` and `dist/test/tsconfig.test.js` (both absent) and by `git status --porcelain --ignored=matching -uall dist`. Test validation was run by cairn before this review and deliberately not re-run: `bun run typecheck` passed [549ms], `bun test` passed 1229 pass / 0 fail [8639ms] across 36 files — 1227 → 1229 is exactly the two tests added here, and the file count rise matches the one new test file, so nothing was removed. Not verifiable from here: the `bun run build` / `./dist/cairn --version` claim and the `npx tsc --outDir /tmp/...` probe (no build or general Bash grant, and a build during a pinned round is discouraged) — the absence of emitted files in `dist/` is the closest independent evidence I could gather; and TDD red-then-green ordering (CLAUDE.local.md), since the work landed as one commit — same situation as #131-#134 this round, and for a config-assertion test the pre-change red state is trivially implied by the old tsconfig lacking `noEmit`.

### Gaps
None detected against the task description. Every item — `noEmit`, the stated `outDir` decision, no `rootDir`, the regression test with the finding named in a comment, the untouched build script and healthCheck — is present and checked above.

### Regression Risks
- **CLAUDE.md now names a tsconfig option that no longer exists (documentation drift, low severity).** The Development section still reads: "`rootDir` is deliberately unset so files outside `src/` are accepted — `bun build --compile` ignores `rootDir`/`outDir`, so this cannot affect the build" (added by #122, unchanged by this commit). The sentence is not false — bun does ignore both — but `outDir` is gone from the file and the newly load-bearing `noEmit: true` is undocumented. The concrete risk is that a future reader or agent, seeing CLAUDE.md discuss `outDir` as if it were configured, re-adds it (harmless while `noEmit` holds) or removes `noEmit` as redundant (which reopens exactly the hole this task closed). `test/tsconfig.test.ts` would catch the second case loudly, which is why this is low and not a blocker. The task's file scope was tsconfig.json + the test, so the agent did not overstep by leaving it; it is worth a one-line doc fix in a follow-up.

Checked and found NOT to be risks:
- **No exports, signatures or runtime code changed.** The commit touches no file under `src/`; the only production artifact is `tsconfig.json`.
- **The typecheck gate over `test/` is not undone.** `rootDir` stays absent and `include` is still `["src","test"]`; `tsc --noEmit` exited 0 in validation, which it could not do if test/ had fallen outside the program.
- **`noEmit` cannot break the shipped binary.** `bun build --compile ... --outfile dist/cairn` names its output explicitly and does not consult tsc's emit options; `install.sh` calls only `bun run build` and then symlinks `dist/cairn`. Neither file was modified.
- **`tsc --noEmit` in `package.json`'s typecheck script is now redundant but not conflicting** — the flag and the config setting agree, so no behaviour change, and leaving the flag means the script stays correct even if invoked against a different config.
- **No tests deleted or weakened.** The diff is pure addition on the test side (+25, zero removals) and the suite total rose by exactly two.
- **Self-modifying-round procedure respected.** No `cairn round`/`cairn hook` invocation against the project root, no run-state or prompt-file churn, `cairn.json`'s pinned `healthCheck` and `install.sh` untouched by the commit, and the bare-tsc probe was run with a throwaway `/tmp` outDir per the task's instruction — with `dist/` confirmed clean afterwards.
- **One brittleness note, not a risk today:** `test/tsconfig.test.ts` uses `JSON.parse`, so if anyone later converts `tsconfig.json` to JSONC (comments are legal there), the test throws a parse error rather than a clear assertion failure. The file is comment-free today, and the notes explain that avoiding JSONC was part of the `outDir` decision.

### Verdict
HAS_RISKS

---

## Task #136: Cleanups: shared cast helper in test/, log-mock arg join, unused mergeGitignoreEntries export
Reviewed: 2026-09-20T00:55:00Z

### Coverage
```
Task #136 Requirements
├── [DONE] Item 1 — CAST STYLE: pick one form, add a one-line helper for the repeated
│          `config.review` case, preserve the assertions exactly
│   ├── [DONE] One form picked: the direct `as { shape } | undefined` cast. Verified that the
│   │          `as unknown as Record<string, unknown>` spelling is now gone from
│   │          test/commands/init.test.ts — `git diff a640d7a~1..a640d7a` shows task #120
│   │          introduced exactly two such sites, and both are converted in this commit
│   │          (`git log -S"as unknown as Record"` lists 7cdb77f as the last commit to touch it).
│   ├── [DONE] Helper added: `reviewMaxIterations(config: CairnConfig)` at test/config.test.ts:15-18,
│   │          replacing all four inline casts in that file (diff shows 4 call sites converted,
│   │          which matches the "all four sites" the task named).
│   ├── [DONE] Assertions preserved exactly — all four `toBeUndefined()` checks still read
│   │          `config.review?.maxIterations` at runtime through the helper; the cast is erased at
│   │          runtime, so a reintroduced `review.maxIterations: 5` would still be a number and the
│   │          assertions would still genuinely fail. Same for init.test.ts's two
│   │          `.reviewMaxIterations` checks: the added `?.` is inert (`getConfigDefaults` never
│   │          returns undefined) and the property read is unchanged.
│   └── [NOTE, not a gap] The helper is file-local to config.test.ts, so init.test.ts's single
│              `config.review` site (promptForConfig, ~line 905) keeps an inline cast of the same
│              shape rather than importing it. The task asked for a helper on "the repeated
│              `config.review` case" — the repetition was the four config.test.ts sites; one
│              occurrence in another file is not repetition. The completion notes state and argue
│              this choice, which the task explicitly allows.
├── [DONE] Item 2 — LOG MOCKS: make the assertion robust to extra args OR record the first arg only
│   ├── [DONE] Chose "record the first argument only": the three mocks at run.test.ts:1815, 1859
│   │          and 2389 now push `String(args[0])` instead of `args.map(String).join(' ')`.
│   ├── [DONE] Scope is exactly the three sites #122 retyped — verified against
│   │          `git diff 0d60b13~1..0d60b13`: that commit changed exactly these three
│   │          (`(msg: string) => logs.push(String(msg))` / `logs.push(msg)` → the joining form);
│   │          the joining mock at ~2302 is a context line there, i.e. pre-existing, and correctly
│   │          left alone. The new form restores byte-for-byte what was recorded before #122.
│   └── [DONE] The assertion the task named — `expect(logs).toContain('Cairn Execution Loop
│              Completed')` (run.test.ts:2394) — is now immune to a future second argument. Read
│              src/commands/run.ts:732-748: every summary `deps.log(...)` call is a single template
│              string today, so the change alters nothing that currently runs (and cairn's
│              validation confirms 0 failures).
├── [DONE] Item 3 — UNUSED EXPORT: add a direct unit test OR drop the export, not both
│   ├── [DONE] Chose the preferred option: `mergeGitignoreEntries` is now imported directly in
│   │          test/commands/init.test.ts (import list diff) and exercised by a new
│   │          `describe('mergeGitignoreEntries')` block of 5 tests. The export is retained and
│   │          untouched — not both.
│   └── [DONE] Tests checked against the implementation (src/commands/init.ts:102-118), not just
│              read: append-under-header + returned count, idempotent second merge returning 0 with
│              byte-identical content, `!`-negation treated as present (with a `^\.cairn_iterations
│              \.log$` multiline negative assertion that would fail if the negation branch were
│              dropped), no duplication of an already-present line, and the
│              missing-trailing-newline path (`existing.endsWith('\n')` branch). Each maps to a
│              real branch of the function, so these would genuinely fail on a regression.
├── [DONE] Do item 3 after #132 lands — #132 is f4ec1a4, three commits before this one; the tests
│          target the post-#132 shape (negation set + merge header), which is what is in HEAD.
├── [DONE] Strictly no behaviour change in src/ beyond item 3's export decision
│          — `git diff e088a764..HEAD -- src/` is EMPTY; `git show HEAD --stat` lists only
│            test/commands/init.test.ts, test/commands/run.test.ts, test/config.test.ts and the two
│            task JSONs. Nothing under src/ changed at all.
├── [DONE] Suite count must not drop — 1229 pass (task #135's log) → 1234 pass (task #136's log),
│          0 fail both times, 36 files both times. +5 is exactly the five new
│          mergeGitignoreEntries tests; expect() calls rose 2689 → 2700.
└── [DONE] Expected files: all three test files touched; src/commands/init.ts deliberately not
           touched because item 3's chosen branch (keep the export, add a test) requires no edit —
           stated in the notes.
```

### Files Changed
- `test/config.test.ts` — added the `reviewMaxIterations(config)` helper; 4 inline casts routed through it (net +13/-8)
- `test/commands/init.test.ts` — imports `mergeGitignoreEntries`; new 5-test `describe` block; 3 casts converted to the direct-cast form (+83/-4)
- `test/commands/run.test.ts` — 3 log mocks record `String(args[0])` instead of joining every arg (+3/-3)
- `src/commands/init.ts` — listed in the task's file scope but correctly unchanged (export kept, test added)
- `.cairn/tasks.json` / `.cairn/tasks.completed.json` — bookkeeping (#135 archived, #136 marked complete with notes; CANARY-17 present per CLAUDE.local.md)

Verification performed: inspected `e088a764..HEAD` with `git log --oneline`, `git diff --stat`, `git diff` (per-path, including `-- src/` to prove src/ is untouched) and `git show HEAD --stat`; read the post-change `src/commands/init.ts:75-118` to check each new test against the real merge/negation/trailing-newline branches; read `src/commands/run.ts:700-795` to confirm every summary `log()` call is single-argument; read `test/commands/run.test.ts:1780-1890` and `2380-2396` to check the assertions sitting over the three changed mocks; used `git diff 0d60b13~1..0d60b13` and `git diff a640d7a~1..a640d7a` plus `git log -S` pickaxes to confirm the scope claims about #122's three mocks and #120's two casts. Test validation was run by cairn before this review and deliberately not re-run: `bun run typecheck` passed [509ms], `bun test` passed 1234 pass / 0 fail [8694ms]; compared against `.cairn/.cairn_task_135_tests.log` (1229 pass, 36 files) to confirm the suite grew by exactly the five added tests. Not verifiable from here: TDD red-then-green ordering (CLAUDE.local.md), since the work landed as a single commit — for pure test-side cleanups of already-passing behaviour the notion barely applies, and the five new tests are characterization tests over code that already existed.

### Gaps
None detected. All three items were addressed on the branch the task preferred or allowed, the two "must" constraints (no src/ behaviour change; suite count must not drop) are both satisfied and independently verified, and the one place the agent departed from a literal reading — the helper being file-local rather than shared across test files — is argued in the completion notes and consistent with the description's own wording ("the repeated `config.review` case").

### Regression Risks
None detected.

Checked and found NOT to be risks:
- **No production code changed.** `git diff e088a764..HEAD -- src/` is empty: no export removed, no signature changed, no contract touched. `mergeGitignoreEntries` stays exported and is now *more* pinned than before, not less.
- **Recording only `args[0]` does not weaken any live assertion.** The negative checks that sit over these mocks (`logs.some(l => l.includes('ALL TASKS COMPLETE'))` at 1827, `'Tasks blocked'` at 1837, `'Ralph'` at 2395) scan a narrower string than they did yesterday, but every summary `deps.log(...)` in run.ts is a single-argument template literal, so nothing is being missed today — and this is exactly the breadth these assertions had from d0ab1cc until #122 retyped them four commits ago. It is a restoration of the long-standing baseline, not a new reduction.
- **Style is now consistent where it matters, and the remaining divergence is pre-existing.** Seven other `log` mocks in run.test.ts still join every argument; they were written that way in earlier rounds and were explicitly out of this task's scope ("the three retyped log mocks"). Worth a one-line follow-up if anyone wants the file uniform, but touching them here would have exceeded scope.
- **No tests deleted or weakened.** The test-side diff is pure addition plus in-place cast/mock rewrites; the four `review.maxIterations` pins and the two `reviewMaxIterations` pins still read the same runtime property and still fail if round 16's removal is undone. Suite total rose 1229 → 1234, file count unchanged at 36.
- **The new `mergeGitignoreEntries` tests are not tautological.** Each targets a distinct branch of the function as written after #132 (missing-entry append, `missing.length === 0` early return, the `negatedEntries` set, the `existingLines` set, and the `endsWith('\n')` base fixup), and the negation test asserts the entry is absent as a positive line, which is the assertion that would fail if the negation handling regressed.
- **Self-modifying-round procedure respected.** The commit touches no `cairn.json`, `install.sh` or `package.json`; no `cairn round`/`cairn hook` invocation against the project root appears, and the only dirty files remain the user's pinned `cairn.json` plus the two task JSONs settle rewrites post-commit. The new tests all write into `mkdtempSync(os.tmpdir(), ...)` dirs and clean up in `afterEach`, so they cannot touch the repo's own `.gitignore`.

### Verdict
CLEAN

---

## Task #137: Docs: close the reviewer-containment drift in README and CLAUDE.md, then document round-18's changes
Reviewed: 2026-09-20T01:05:00Z

### Coverage
```
Task #137 Requirements
├── PART A — the drift #123 missed
│   ├── [DONE] A1 README ~164: `--disallowedTools` now named
│   │          — the line reads "a scoped `--allowedTools` list plus a `--disallowedTools` denylist
│   │            that closes the one hole an allow-prefix rule can't exclude — `git diff
│   │            --output=<file>` and its `$`/quote-splitting variants", and the following sentence
│   │            was corrected from "don't get `--allowedTools`" to "don't get either flag".
│   │            Verified against the shipped code, not the description: `spawnPostTaskReviewer`
│   │            (src/post-task-reviewer.ts) passes `--disallowedTools
│   │            REVIEWER_DISALLOWED_BASH_RULES.join(",")` = `Bash(*--output*)`, `Bash(*--out*)`,
│   │            `Bash(*$*)`, `Bash(*")`, `Bash(*')` (src/claude-settings.ts, added by #121/#134).
│   │            The README clause's scope ("`$`/quote-splitting variants") matches those five.
│   ├── [DONE] A2 CLAUDE.md enforcement point 2 no longer reads as contradicting line ~178
│   │          — appended: "(This `--allowedTools` grant is not the whole headless reviewer story —
│   │            see 'Headless reviewer containment' below, which layers a `--disallowedTools`
│   │            denylist on top to close a hole the allow-prefix rule can't.)" The named heading
│   │            exists verbatim at CLAUDE.md:178, so the cross-reference resolves.
│   ├── [DONE] A3 "Remaining headless gap" paragraph completeness — premise was already stale
│   │          — `git diff 7cdb77f..HEAD -- CLAUDE.md` shows that region untouched, and the text at
│   │            HEAD:178 ALREADY covers the `--output${X}=` shell-expansion variant, `Bash(*$*)`,
│   │            the split-quoting form and the probe that validated them. It was rewritten by #123
│   │            (`git log -S'Headless reviewer containment' -- CLAUDE.md` → 8ff433c, then 3652c7f
│   │            only for A2's new mention). Nothing to do; the agent said so in its notes rather
│   │            than editing for the sake of it, which is the right call. Independently verified
│   │            the paragraph against src/claude-settings.ts:REVIEWER_DISALLOWED_BASH_RULES — all
│   │            five patterns and the probe narrative match the code comment exactly.
│   ├── [DONE] A4 no "only redirection / backticks / `$(`" claim survives in either file
│   │          — CLAUDE.md:171 says "never contains redirection (`<`, `>`), backticks, or a `$`
│   │            **anywhere**"; README:167 says "denying redirection, backticks, or a `$` anywhere
│   │            in the command (which subsumes command substitution, `${VAR}` expansion, bare
│   │            `$VAR`, and `$'...'` quoting) plus git's file-writing `--output` option as a
│   │            second, exact-token check". Both pre-dated this commit (context lines in the diff);
│   │            the requirement was to VERIFY, and the verification holds.
│   └── [DONE] A5 re-init appends to an existing `.cairn/.gitignore` is documented
│              — already present at README:105, README:383 and CLAUDE.md:93 (#117/#123). #137
│                extended those same lines with round 18's new behaviour instead of duplicating
│                the note, which is the better outcome.
├── PART B — round-18 changes
│   ├── [PARTIAL] Round-done temp-file sweep, with the never-sweep list
│   │   ├── [DONE] Both files updated (CLAUDE.md "Run state" bullet; README "Run state" paragraph)
│   │   ├── [DONE] Callers correct: `sweepRoundTempFiles(dataDir)` in `cairn round next`'s
│   │   │          round-done branch (src/commands/round.ts:120) and in `runRun`'s loop-exit
│   │   │          `finally` (src/commands/run.ts) — verified in `git show 4610bc0`
│   │   ├── [DONE] Removal list correct: `TEMP_FILE_SUFFIXES = ['complete','prev_notes',
│   │   │          'completed_ids']` through `tempFilePath()` (= `.cairn_` + suffix, src/utils.ts),
│   │   │          plus NOTES_TEMPFILE_RE and TASK_SCOPED_TEMPFILE_RE
│   │   ├── [DONE] Never-sweep list correct and load-bearing reasoning intact: both regexes require
│   │   │          a literal `task_\d+_` segment, which none of `.cairn_run_state.json(.lock)`,
│   │   │          `.cairn_iterations.log`, `.cairn_tasks_snapshot.json`, `.cairn_hook_errors.log`,
│   │   │          `.gitignore`, `state.json`, `tasks.json`, `tasks.completed.json`,
│   │   │          `planning-notes.md` or `reviews/` contains. Best-effort/never-throws and
│   │   │          round-end-only (retry re-reads `_prompt.md`, reviewer prompt names `_tests.log`)
│   │   │          also match src/temp-sweep.ts.
│   │   └── [PARTIAL] One factual inversion in the new CLAUDE.md bullet — see Gaps: it calls
│   │              `.cairn_` "the legacy spelling" of the notes file. `.cairn_` is BRAND.tempPrefix,
│   │              the CURRENT brand prefix kept defensively; `.ralph_` (NOTES_TEMP_PREFIX) is the
│   │              pre-rename spelling that is permanently retained.
│   ├── [DONE] `cairn init` gitignore merge: `!` negation honoured, unreadable file doesn't abort
│   │          — verified against `git show f4ec1a4 -- src/commands/init.ts`: `negatedEntries`
│   │            (lines starting `!`, `!` stripped and trimmed) excluded from `missing`, and
│   │            `initCoreFiles` wraps `mergeGitignoreEntries` in try/catch that `console.error`s
│   │            "…the rest of init will continue". README:105 and CLAUDE.md:93 now say exactly
│   │            that, including the "rather than re-adding (and thereby silently reversing) it"
│   │            rationale the source comment gives.
│   ├── [DONE] Hook's decision/error-log resolver split and WHY the invariant was relaxed
│   │          — no new text was needed: CLAUDE.md:174 (written by #133 itself, 49f8144) already
│   │            describes `resolveHookErrorLogDir`, the ignoreEnv-pinned decision resolver, the
│   │            reason ("a hook that has silently stopped containing anything would look identical
│   │            to a healthy one") and why deny-and-log can still never name different projects.
│   │            I checked that paragraph line-by-line against `git show 49f8144 -- src/commands/
│   │            hook.ts` (candidate order, existsSync-first-hit, null result, exit 1 never 2) and
│   │            it is accurate. README is not updated, but README documents no hook project
│   │            resolution at all, so there is nothing there to contradict.
│   └── [DONE] `tsconfig.json`'s `noEmit`, with the reason
│              — CLAUDE.md's Development paragraph now explains `noEmit: true` replacing
│                `outDir: "dist"` and that a BARE `tsc` (not just `tsc --noEmit`) would otherwise
│                emit `dist/src/**` and `dist/test/**` beside the `dist/cairn` binary `install.sh`
│                symlinks onto PATH. Matches the shipped tsconfig.json (noEmit true, no outDir, no
│                rootDir, include ["src","test"]) and closes the exact documentation-drift risk
│                this log recorded against #135.
└── RULES
    ├── [DONE] Docs-only — `git show 3652c7f --stat`: CLAUDE.md, README.md and the two task JSONs
    │          only. No `src/`, `test/`, `package.json`, `tsconfig.json` or `cairn.json` change.
    ├── [DONE] `cairn.json`'s pinned `healthCheck` and `install.sh` untouched — the only
    │          working-tree `cairn.json` diff is the user's own pin to `/tmp/cairn-healthcheck`,
    │          which predates this task and was correctly left alone (and not committed).
    └── [DONE] Claims verified against shipped code before writing — spot-checked every new
               sentence against src/temp-sweep.ts, src/utils.ts, src/brand.ts, src/commands/init.ts,
               src/commands/hook.ts, src/claude-settings.ts, src/post-task-reviewer.ts and
               tsconfig.json; one inversion found (above), everything else accurate.
```

### Files Changed
- `README.md` (+3/-2 over 3 hunks) — the `.cairn/.gitignore` merge sentence (negation + continue-on-error), the `--disallowedTools` clause in "Containment under /cairn-run", and a new round-end sweep paragraph under "Run state"
- `CLAUDE.md` (+4/-3 over 4 hunks) — the `noEmit` explanation in Development, a new sweep bullet under "Run state", the `.cairn/.gitignore` line in the per-project data tree, and the cross-reference appended to enforcement point 2
- `.cairn/tasks.json` / `.cairn/tasks.completed.json` — bookkeeping (#136 archived, #137 marked complete; CANARY-17 present in the notes per CLAUDE.local.md)

Verification performed: `git log --oneline`, `git diff --stat` and `git diff --unified=0` over `7cdb77f..HEAD` (whole range and per path) to establish that the docs diff is only these four hunks per file and that everything the agent reported as "already correct" really was context, not an edit; `git log -S'Headless reviewer containment' -- CLAUDE.md` and `git log -S'resolveHookErrorLogDir' -- CLAUDE.md` to attribute the pre-existing paragraphs to #123 and #133; `git show 4610bc0`, `git show f4ec1a4 -- src/commands/init.ts`, `git show 49f8144 -- src/commands/hook.ts` and `git show 8a4ebd1` to check each Part B claim against the commit it describes; read `src/temp-sweep.ts`, `src/brand.ts`, `tsconfig.json` and the post-change README/CLAUDE regions in full; `git log -L :tempFilePath:src/utils.ts` to confirm the flat files really are spelled `.cairn_complete` / `.cairn_prev_notes` / `.cairn_completed_ids`. Test validation was run by cairn before this review and deliberately not re-run: per the settle summary `bun run typecheck` passed [594ms] and `bun test` passed 1234 pass / 0 fail [9008ms] — identical to #136's log, as expected for a docs-only change (no test added, none removed). Not verifiable from here: nothing material; this reviewer's Bash scope is read-only git, so no build or grep was run, but every claim above was checked by reading the files themselves.

### Gaps
- **CLAUDE.md's new sweep bullet inverts the two notes-file prefixes.** It says the sweep removes "every per-task `..._notes.md` (both the current `NOTES_TEMP_PREFIX` and the legacy `.cairn_` spelling)". `.cairn_` is `BRAND.tempPrefix` — the *current* brand prefix, and src/temp-sweep.ts keeps it in the alternation *defensively* ("an agent that spells the file with the current prefix instead must not leave scratch behind"); `.ralph_` (`NOTES_TEMP_PREFIX`) is the *pre-rename* spelling, deliberately kept forever, and is the one the prompt actually hands out. src/brand.ts calls it "a PERMANENT exception, NOT a compatibility fallback", and CLAUDE.md's own Conventions section says the same. Calling `.cairn_` "legacy" is the one claim in this change that the code contradicts — minor in consequence (the sweep matches both either way), but this task existed specifically to stop docs asserting things the source doesn't, so it is counted rather than waved through. A one-word fix ("the defensive `.cairn_` spelling").

Observations, not gaps:
- Part B item 3 (the hook resolver split) and Part A items 2–4 were satisfied by text already on disk from #123/#133; this commit adds no new prose for them. I verified that text against the shipped code rather than accepting the agent's "already correct" claim, and it holds — so the end state meets the requirement even though the task's premise about #123's leftovers was partly stale.
- README gets the sweep, the `--disallowedTools` clause and the gitignore behaviour, but not the `noEmit` reasoning or the hook resolver split. Both omissions are argued in the completion notes as dev-internal detail README doesn't otherwise cover (README has no tsconfig or hook-resolution section), which matches the file's actual scope.

### Regression Risks
None detected.

Checked and found NOT to be risks:
- **Docs-only, no code touched.** `git show 3652c7f --stat` lists no file under `src/`, `test/`, and no `package.json`/`tsconfig.json`/`cairn.json`. No export, signature or contract could have changed; no test was deleted or weakened, and the suite is byte-for-byte the same 1234 tests as after #136.
- **No new contradiction introduced between the two docs.** README:164/167 and CLAUDE.md:142/171/178 now tell the same story about the reviewer's headless containment (allowlist + denylist) and the same `$`-anywhere hook rule; the cross-reference added to enforcement point 2 points at a heading that exists.
- **The claim that the sweep never touches live state is true by construction**, not by enumeration — both regexes require `task_\d+_`, so the never-sweep list in the docs cannot silently fall out of date if a new state file is added, as long as its name has no such segment.
- **No claim was made about the `.ralph_`-spelled flat files.** `findTempFilePath`/`allTempFilePaths` still dual-read `.ralph_complete` etc., and `sweepRoundTempFiles` only unlinks the `.cairn_` spelling of those three — so a project carrying pre-rename flat files keeps them. The docs name the `.cairn_` spellings exactly and never claim otherwise, so this is a pre-existing code nuance (from #131/#33), not doc drift and not a regression from this task.
- **#135's recorded documentation-drift risk is now closed**, and closed accurately: CLAUDE.md no longer discusses `outDir` as if it were configured, and it explains why removing `noEmit` as "redundant" would reopen the hole `test/tsconfig.test.ts` guards.
- **Self-modifying-round procedure respected.** No `cairn round`/`cairn hook` invocation against the project root appears in the change, no run-state or prompt-file churn is in the commit, and the pinned `healthCheck` / `install.sh` are untouched.

### Verdict
HAS_GAPS

---
