## Task #51: src/config.ts — drop ralph.json and RALPH_ANTHROPIC_API_KEY fallback legs
Reviewed: 2026-08-03T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] findConfigFile: delete LEGACY.configFile branch + warnLegacyOnce call, keep name/signature
├── [DONE] resolveAnthropicApiKeyChain: delete env.RALPH_ANTHROPIC_API_KEY leg
├── [DONE] Delete warnIfLegacyApiKey entirely
├── [DONE] Drop 'legacy' from AnthropicApiKeyResolution['source'] union
├── [DONE] Remove now-unused LEGACY / warnLegacyOnce imports from src/config.ts
├── [DONE] src/commands/narrate.ts — delete call + import
├── [DONE] src/commands/run.ts — delete call + import
├── [DONE] Do NOT normalize resolved key onto plain ANTHROPIC_API_KEY (doc comment + test preserved)
├── [DONE] TDD: test/config.test.ts legacy-fallback describes deleted, literal 'cairn.json' assertions
├── [DONE] TDD: test/commands/narrate.test.ts checked — correctly required no changes
├── [DONE] cairn.json healthCheck untouched, ./install.sh not run
└── [DONE] Historical files (tasks.completed.json, logs, reviews, audit/) untouched
```

### Files Changed
- src/config.ts — all 5 removal markers gone; verified zero remaining "ralph"/"RALPH" mentions and zero remaining "remove once all projects migrated" markers
- src/commands/narrate.ts — import and `warnIfLegacyApiKey(resolveAnthropicApiKeyChain())` call removed
- src/commands/run.ts — same removal; only the two lines tied to the deleted function touched, unrelated LEGACY/BRAND/tempFilePath imports (owned by later tasks 52/55) left intact
- test/config.test.ts — legacy-fallback describe blocks removed/rewritten, `resetLegacyWarnings` import dropped, assertions literal
- test/commands/edit.test.ts (out-of-scope fallout) — one test rewritten to reflect that `findConfigFile` no longer resolves `ralph.json`; previously this made `runEdit` hit its real `process.exit(1)`, which killed the whole `bun test` runner process. Now correctly mocks `process.exit`.
- test/commands/init.test.ts (out-of-scope fallout) — `getConfigDefaults` fixtures switched from `ralph.json` to `cairn.json`, plus one added negative test confirming a leftover `ralph.json` is ignored
- .cairn/tasks.json, .cairn/state.json — round-8 task list populated (tasks 51-66) and task 51 marked complete via `cairn task complete`; not a direct edit of tasks.json

### Gaps
None detected.

### Regression Risks
None detected. Verified independently rather than trusting the agent's self-reported numbers:
- `bun test test/config.test.ts test/commands/narrate.test.ts test/commands/edit.test.ts test/commands/init.test.ts` → 193 pass, 0 fail
- `bun test` (full suite) → 859 pass, 0 fail, 31 files — matches the number reported in the task notes exactly
- `bun build --target=bun src/index.ts --outfile <throwaway>` succeeds (healthCheck-equivalent build)
- `grep -n "resolveAnthropicApiKeyChain\|warnIfLegacyApiKey"` across src/ and test/ shows the function is now uncalled by any production code path (expected — this is the exact situation the agent flagged and filed as new task #66, not a regression)
- `grep "source === 'legacy'"` across src/ and lib/ returns nothing — no dead branch left matching the removed union member
- No AnthropicApiKeyResolution consumers outside src/config.ts / test/config.test.ts
- cairn.json's `healthCheck` field unchanged; confirmed still points at the pinned throwaway outfile
- The two out-of-scope test file edits (edit.test.ts, init.test.ts) were necessary fallout from the src/config.ts behavior change, not scope creep — both are pre-existing tests that would otherwise fail (or, in edit.test.ts's case, abort the whole test runner via an unmocked process.exit) — and the agent documented the reasoning clearly in its notes.

### Verdict
CLEAN

---

## Task #52: src/narration.ts — drop legacy socket and pid-file candidates
Reviewed: 2026-08-03T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Delete warnIfLegacySocket
├── [DONE] Delete warnIfLegacyPidFile
├── [PARTIAL] findNarrationSocketPath: collapse two-candidate probe to "a single existence
│            check on BRAND.socket" — actually implemented with NO existence check at all
│            (unconditionally returns BRAND.socket after the hook probe). Functionally
│            equivalent output (single candidate ⇒ exists-check can't change the answer),
│            and the agent disclosed + justified the deviation explicitly in its notes.
├── [PARTIAL] findNarrationPidFile: same deviation, same justification, for BRAND.pidFile
├── [DONE] KEEP .claude/hooks/narrate.sh HOOK_SOCKET_RE probe as step 1
├── [DONE] KEEP PathProbeDeps injection seam on both signatures (now unused internally;
│            doc comment on the interface updated to say so explicitly)
├── [DONE] Remove now-unused LEGACY / warnLegacyOnce imports
├── [DONE] Update header comment: compatibility-window framing dropped, hook-authority
│            rationale (silently-dead-narration explanation) kept
├── [DONE] All 5 removal markers gone from src/narration.ts
├── [DONE] TDD: test/narration.test.ts red (2 new expectations) then green
├── [DONE] cairn.json healthCheck untouched, ./install.sh not run
└── [DONE] Historical files (tasks.completed.json, logs, reviews, audit/) untouched
```

### Files Changed
- src/narration.ts — all 5 markers gone; `LEGACY`/`warnLegacyOnce` no longer imported; `existsSync` import retained and still genuinely used by `startNarrationServer`/`stopNarrationServer`/`checkNarrationHealth`, so no dead import left behind
- test/narration.test.ts — `resetLegacyWarnings`/`LEGACY` import and its `beforeEach`/`afterEach` calls removed; legacy-fallback tests replaced with "ignores a stale ralph-tts.{sock,pid}" tests; hook-probe tests switched from the legacy path to a neutral `/tmp/custom-tts.sock` fixture

### Gaps
- Minor, disclosed: the task's literal wording ("collapse... to a single existence check on BRAND.socket") was not implemented literally — the existence check was dropped entirely rather than kept as a single-candidate check. The agent's notes flag this as a deliberate call (`exists(BRAND.socket) ? BRAND.socket : BRAND.socket` would be dead code) rather than an oversight. I agree with the reasoning, but flagging since it's technically a deviation from the description's literal text.
- Minor test-quality nit, not in the task's own list: `'returns the current brand socket when it is already live'` (line 327) and `'returns the current brand pid file when it exists'` (line 382) now pass an `exists` callback that the implementation never consults (`_deps` is unused). The tests still pass and the assertion is correct, but the title implies liveness-conditioned behavior that isn't actually exercised — a reader skimming test names could be misled into thinking the exists-check still gates the result.

### Regression Risks
None detected. Verified independently:
- `bun test test/narration.test.ts test/legacy-markers.test.ts test/commands/narrate.test.ts test/commands/run.test.ts` → 163 pass, 0 fail
- `bun test` (full suite) → 859 pass, 0 fail, 31 files — identical to the #51 baseline, matching the task notes exactly
- `grep -n "remove once all projects migrated\|ralph" src/narration.ts` → no matches
- Checked all production callers of `findNarrationSocketPath`/`findNarrationPidFile` (`src/commands/narrate.ts`, `src/commands/run.ts`) and the `RunRunDeps.findNarrationSocketPath` seam (`test/commands/run.test.ts:1434`) — all still call through unchanged signatures, seam intact
- `src/brand.ts` still defines `LEGACY.socket`/`LEGACY.pidFile` (out of this task's scope — task #63 owns their deletion); nothing in this diff touches `brand.ts`
- `cairn.json`'s `healthCheck` unchanged, still points at a throwaway outfile

### Verdict
HAS_GAPS

---

## Task #53: src/commands/init.ts — drop legacy gitignore block, KEEPING the notes-scratch line
Reviewed: 2026-08-03T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Delete GITIGNORE_LEGACY_HEADER from init.ts
├── [DONE] Rewrite GITIGNORE_CONTENT — no longer calls ignoreBlock(LEGACY.tempPrefix)
├── [DONE] CRITICAL: keep exactly one surviving legacy line, emitted as
│            `${LEGACY.tempPrefix}task_*_notes.md\n` via LEGACY.tempPrefix (not a bare
│            '.ralph_' literal) — verified in src/commands/init.ts:41
├── [DONE] Drop the other legacy TEMP_IGNORE_SUFFIXES entries from the gitignore output
├── [DONE] Strip 'legacy ralph.json' caveat from getConfigDefaults doc comment (~line 120)
├── [DONE] All 3 removal markers gone — grep for "ralph"/"remove once all projects
│            migrated" (case-insensitive) over src/commands/init.ts returns zero matches
├── [DONE] TDD: .gitignore content test rewritten to an exact ordered-list assertion,
│            plus a new test pinning the permanent notes-scratch exception
├── [DONE] TDD: hook-socket test updated (renamed, dropped the now-nonsensical
│            not.toContain('/tmp/ralph-tts.sock') assertion)
├── [DONE] TDD: 'does not touch an existing legacy ralph.json' test removed, with a
│            documented reason (assertion became meaningless after #51 removed the
│            ralph.json fallback from src/config.ts; the adjacent 'overwrites an
│            existing cairn.json' test still covers writeCairnJson's actual contract)
├── [DONE] 'ralph.json-defaults block' (test/commands/init.test.ts:400, 'ignores a
│            leftover ralph.json when deriving defaults') correctly left untouched —
│            it tests config-layer behavior settled by #51, not this task's gitignore/
│            doc-comment changes, and still passes
├── [DONE] Left the ~70 cosmetic .ralph fixture-path references alone (task 54's scope)
├── [DONE] cairn.json healthCheck untouched, ./install.sh not run
└── [DONE] Historical files (tasks.completed.json, logs, reviews, audit/) untouched
```

### Files Changed
- src/commands/init.ts — all 3 removal markers gone; verified zero remaining "ralph" mentions (case-insensitive grep). `GITIGNORE_CONTENT` now emits current-prefix lines + the single permanent `${LEGACY.tempPrefix}task_*_notes.md` exception + `instructions.md`, with a comment explaining the exception (deliberately not spelling out `.ralph_` literally, to avoid tripping legacy-markers on a comment line). `getConfigDefaults` doc comment no longer mentions ralph.json.
- src/commands/migrate.ts (out-of-scope, but necessary fallout) — `GITIGNORE_LEGACY_HEADER` was imported here for `refreshDataDirGitignore`; deleting the export from init.ts without a home for migrate.ts's consumer would have broken the build. The agent moved the constant into migrate.ts as a module-private const with a doc comment explaining why it lives there (a fresh `cairn init` no longer emits a legacy block; migration, which starts from a pre-rename project, still needs one). Confirmed `refreshDataDirGitignore`'s output is byte-identical (migrate tests pass unchanged), and the existing marker at migrate.ts's file header (~line 17) plus the marker embedded in the moved constant's own string (line 33) both keep `test/legacy-markers.test.ts` green.
- test/commands/init.test.ts — gitignore-content test rewritten to an exact ordered `toEqual` over non-comment lines (closes a real hole: substring `toContain` checks couldn't have caught `.ralph_complete` surviving as a substring of `.ralph_completed_ids`); new test pins the permanent notes-scratch exception and asserts no other `.ralph_`-prefixed line survives; `does not touch an existing legacy ralph.json` test deleted with justification; hook-socket test renamed and its dead assertion dropped.
- .cairn/tasks.json — task 53 marked complete via `cairn task complete` (not a direct edit); task 52's completed entry also removed from this diff view, consistent with archival to tasks.completed.json between rounds (out of this review's scope).

### Gaps
None detected. The one explicit instruction that appears unaddressed at first glance — "update ... the ralph.json-defaults block" — turns out not to require any code change: that test (`getConfigDefaults` ignoring a leftover `ralph.json`) exercises `src/config.ts`'s fallback removal from task #51, not anything this task's diff touches, and it still passes as-is. Treating "update" as "verify and touch only if needed" rather than "must produce a diff" is the correct reading here.

### Regression Risks
None detected. Verified independently rather than trusting the agent's self-reported numbers:
- `bun test test/commands/init.test.ts test/commands/migrate.test.ts test/legacy-markers.test.ts` → 143 pass, 0 fail
- `bun test` (full suite) → 859 pass, 0 fail, 31 files — matches the task notes exactly (net zero: one test deleted, two added)
- `grep -n "ralph|remove once all projects migrated" -i src/commands/init.ts` → no matches (all 3 markers confirmed gone)
- `grep` confirms migrate.ts's marker coverage is intact: the pre-existing file-header marker (~line 17) still covers the `.ralph/` mention at line 15, and the relocated `GITIGNORE_LEGACY_HEADER` constant carries the marker phrase within its own string, so no unmarked "ralph" line was introduced
- The out-of-scope edit to src/commands/migrate.ts (not in Expected Files) is low-risk: it's a pure relocation of an unchanged string constant with no behavioral change, confirmed by migrate.test.ts passing unchanged and `refreshDataDirGitignore`'s output being byte-identical per the agent's notes
- `TEMP_IGNORE_SUFFIXES`, `GITIGNORE_CURRENT_HEADER`, and `ignoreBlock()` remain exported and unchanged — migrate.ts's other imports of these are unaffected
- cairn.json's `healthCheck` field unchanged; ./install.sh not run

### Verdict
CLEAN

---

## Task #54: test/commands/init.test.ts — cosmetic .ralph -> .cairn fixture rename
Reviewed: 2026-08-03T00:00:00Z

### Coverage
```
Task Requirements
├── [DONE] Rename incidental '.ralph' fixture paths/test names to '.cairn' across the file
├── [DONE] No source file changes (git diff confirms src/ untouched in this commit)
├── [DONE] No assertion-semantics changes for the renamed cases
├── [DONE] Assertions stay literal ('.cairn'), never BRAND.dataDir
├── [DONE] Behavioral renames that broke tests left as-is and reported, not force-edited:
│            - line 245 negative assertion (not.toContain('Created: .ralph/')) reverted
│            - createInstructionsFile block's shared `.ralph` beforeEach fixture (13 lines)
│              reverted to avoid EEXIST collision with its dedicated '.cairn' sub-test
├── [DONE] Left the legacy notes-scratch exception literal (.ralph_task_*_notes.md, 4
│            lines) untouched — real behavior pinned by task 53, not a fixture name
├── [DONE] Left the ralph.json config-file test (lines 400/402) untouched — config-file
│            name, not data-dir, out of this task's scope
├── [PARTIAL] Self-reported "22 lines total still say .ralph, all confirmed behavioral or
│            explicitly out of scope" — itemizes only 21 (7 listed + 1 reverted spot + 13
│            reverted block). Line 1038 (`expect(output).not.toContain('Ralph narration
│            server')`, a pre-existing negative regression guard, untouched by this
│            commit) is in the actual remaining set but missing from the tally
├── [DONE] cairn.json healthCheck untouched, ./install.sh not run
└── [DONE] Historical files (tasks.completed.json, logs, reviews, audit/) untouched
```

### Files Changed
- test/commands/init.test.ts — 47 lines net changed (61 `.ralph`→`.cairn` renames, 14 reverted after breaking tests). All renames confined to `initCoreFiles` and `runInit` describe blocks where the constant is purely a `dataDir` parameter value with no behavioral bearing.
- .cairn/tasks.json, .cairn/.cairn_tasks_snapshot.json, .cairn/.cairn_iterations.log, .cairn/tasks.completed.json — task 54 archived/marked complete via `cairn task complete`, round-8 task list (55-66) populated; not a direct edit of tasks.json.

### Gaps
- Minor, cosmetic: the completion notes' line-count tally ("22 lines total") omits line 1038 (`'Ralph narration server'` negative assertion) from its itemized breakdown even though the grep total it reports is consistent with including it. No functional impact — line 1038 is correctly untouched either way, it's a pre-existing regression guard unrelated to this task's fixture-path scope. Purely a documentation completeness nit in the task notes, not the code.

### Regression Risks
None detected. Verified independently rather than trusting the agent's self-reported numbers:
- `bun test test/commands/init.test.ts` → 111 pass, 0 fail — matches notes exactly
- `bun test` (full suite) → 859 pass, 0 fail, 31 files — matches notes exactly, identical to the #53 baseline
- `git diff HEAD~1 HEAD -- src/` → empty; confirmed no source files touched in this commit
- `git diff HEAD~2 HEAD -- test/commands/init.test.ts` around the createInstructionsFile block and line 245 shows those regions back to their pre-task-54 state, consistent with the notes' claim of a revert-after-red rather than never having been touched
- `grep -ni ralph test/commands/init.test.ts` → 22 lines, all confirmed either (a) the permanent `.ralph_task_*_notes.md` scratch exception, (b) the out-of-scope `ralph.json` config test, (c) the reverted line-245/createInstructionsFile spots, or (d) the untallied line 1038 regression guard — none are unaddressed cosmetic renames
- `test/legacy-markers.test.ts` unaffected (no source touched)
- cairn.json's `healthCheck` field unchanged; ./install.sh not run

### Verdict
HAS_GAPS

---

## Task #55: src/commands/run.ts — collapse completion-flag probe and temp-file cleanup
Reviewed: 2026-08-03T16:39:03.658Z

### Coverage
```
Task Requirements
├── [DONE] ~line 444: allTempFilePaths(...).some(existsSync) -> existsSync(tempFilePath(...)),
│            legacy comment (incl. its marker) deleted — verified at src/commands/run.ts:439
├── [DONE] ~line 700: TEMP_FILE_SUFFIXES cleanup loop collapsed from allTempFilePaths to a
│            single tempFilePath() call — verified at src/commands/run.ts:695
├── [DONE] Drop the allTempFilePaths import — `import { tempFilePath } from '../utils'` only;
│            grep confirms zero remaining allTempFilePaths references in run.ts
├── [DONE] CRITICAL: NOTES_TEMPFILE_RE (now line 365) and its doc comment/marker (line 363)
│            untouched — verified directly
├── [DONE] CRITICAL: notes-sweep comment + marker (now line 708) untouched — verified directly
├── [DONE] CRITICAL: buildSystemPrompt's notesFile (line 51) still hands agents
│            `.ralph_task_<id>_notes.md` — untouched
├── [DONE] Exactly 2 of 3 markers removed — grep for "remove once all projects migrated"
│            in run.ts now returns exactly lines 363 and 708, matching the task's "2 of 3" ask
├── [DONE] TDD: only the completion-flag and cleanup-sweep test cases touched; both were
│            inverted (legacy-honoring -> legacy-ignoring) rather than deleted, red observed
│            first per notes, all other tests in the file left alone
├── [DONE] cairn.json healthCheck untouched, ./install.sh not run
└── [DONE] Historical files (tasks.completed.json, logs, reviews, audit/) untouched by direct
             edit — all changes to them are `cairn task complete`/archival bookkeeping, not
             Edit/Write on the forbidden paths
```

### Files Changed
- src/commands/run.ts — import trimmed to `tempFilePath` only; completion-flag probe collapsed to a single `existsSync(tempFilePath(dataDir, 'complete'))` with the legacy two-line comment and its marker deleted; cleanup loop's inner `for` over `allTempFilePaths` collapsed to one `const filePath = tempFilePath(dataDir, suffix)`; the `TEMP_FILE_SUFFIXES` doc comment's second line ("Cleanup covers BOTH prefixes...") dropped as it was no longer accurate — this line carried no marker, so it doesn't affect `test/legacy-markers.test.ts`. All CRITICAL no-touch items (`NOTES_TEMPFILE_RE`, its doc comment, the notes-sweep comment/marker, `notesFile`) verified untouched by direct inspection of the current file, not just the diff.
- test/commands/run.test.ts — exactly the two named cases inverted: `'breaks loop when only the legacy .ralph_complete flag exists'` → `'does not break loop when only a legacy .ralph_complete flag exists'` (now asserts `spawnClaude` **is** called, with `selectNextTask` and `maxIterations` fixed up so the assertion tests the right thing rather than an unrelated no-task-selected exit); `'cleans up legacy-prefixed temp files on exit'` → `'does not sweep legacy-prefixed temp files on exit'` (same fixture, assertions flipped to `false`). The adjacent current-prefix cases and the unrelated `.ralph_task_<id>_notes.md` sweep test (which goes through `NOTES_TEMPFILE_RE`, not `allTempFilePaths`) were correctly left alone.
- .cairn/tasks.json, .cairn/.cairn_tasks_snapshot.json, .cairn/.cairn_iterations.log, .cairn/tasks.completed.json — task 55 archived/marked complete via `cairn task complete`; not a direct edit of any forbidden path.

### Gaps
None detected.

### Regression Risks
None detected. Verified independently rather than trusting the agent's self-reported numbers:
- `bun test test/commands/run.test.ts` → 114 pass, 0 fail — matches notes exactly
- `bun test` (full suite) → 859 pass, 0 fail, 31 files — matches notes exactly, identical to the #54 baseline
- `bun test test/legacy-markers.test.ts` → 5 pass, 0 fail
- `grep -n "remove once all projects migrated" src/commands/run.ts` → exactly lines 363, 708 (both preserved, matching the task's "remove 2 of 3" instruction)
- `grep -n "NOTES_TEMPFILE_RE\|notesFile"` confirms `NOTES_TEMPFILE_RE` (365), its use in the sweep (712), and `notesFile` (51, still `${LEGACY.tempPrefix}task_<id>_notes.md`) are all present and unmodified
- `allTempFilePaths` remains exported from `src/utils.ts` and is still consumed by `src/task-archiver.ts` (stale `prev_notes` sweep) and internally by `findTempFilePath` — confirmed the helper was correctly left in place rather than deleted wholesale, since `run.ts` was the only file this task owned
- cairn.json's `healthCheck` field unchanged; ./install.sh not run

### Verdict
CLEAN

---

## Task #56: Migrate temp-file read callers to tempFilePath (4 files)
Reviewed: 2026-08-03T16:44:01.207Z

### Coverage
```
Task Requirements
├── [DONE] src/task-selector.ts:12 (loadCompletedIds) — findTempFilePath -> tempFilePath,
│            dual-read comment + marker removed — verified at src/task-selector.ts:8
├── [DONE] src/tasks-file.ts:134 (snapshot recovery) — findTempFilePath -> tempFilePath,
│            dual-read comment + marker removed — verified at src/tasks-file.ts:131
├── [DONE] src/task-archiver.ts:68 — existingIdsFile deleted, idsFile used for both the
│            existence check and the read — verified at src/task-archiver.ts:64-79
├── [DONE] src/task-archiver.ts:90 — allTempFilePaths stale-copy sweep loop for prev_notes
│            deleted entirely (2 markers) — verified at src/task-archiver.ts:82-88
├── [DONE] src/commands/logs.ts:5 — unmarked caller migrated to tempFilePath (would have
│            broken task 58's build otherwise) — verified at src/commands/logs.ts:2,5
├── [DONE] Imports fixed in all four files — grep for findTempFilePath/allTempFilePaths
│            across src/ (excluding utils.ts) returns zero matches; both resolvers are
│            now unreferenced outside src/utils.ts, exactly as task 58 requires
├── [DONE] TDD: test/task-selector.test.ts, test/tasks-file.test.ts,
│            test/task-archiver.test.ts, test/commands/logs.test.ts all updated; the named
│            'falls back to the legacy .ralph_iterations.log' test at ~line 66 of
│            logs.test.ts is gone, along with 6 sibling legacy-fallback tests (7 total)
├── [DONE] Do NOT run ./install.sh — no evidence it was run; dist/cairn unaffected
└── [RISK]  Do NOT modify cairn.json's healthCheck — see Regression Risks. The value did
             change within this task's own commit (1c619af), contradicting both the task's
             explicit instruction and the agent's own notes ("Did not modify cairn.json's
             healthCheck").
```

### Files Changed
- src/task-selector.ts — `loadCompletedIds`'s `idsFile` now built via `tempFilePath(dataDir, 'completed_ids')`; dual-read comment and its marker removed.
- src/tasks-file.ts — `readTasksFile`'s snapshot-recovery `snapshotPath` now `tempFilePath(dataDir, 'tasks_snapshot.json')`; dual-read comment and its marker removed.
- src/task-archiver.ts — completed-IDs merge collapsed to a single `idsFile` read/write path (`existingIdsFile` deleted); the `allTempFilePaths(dataDir, 'prev_notes')` stale-copy sweep loop deleted outright; import trimmed to `tempFilePath` only. Confirmed `unlinkSync` (still used at line 87 for the no-notes case) remains a live import, not dead code.
- src/commands/logs.ts — the one unmarked caller; `findTempFilePath` → `tempFilePath` for `logFile`.
- test/task-selector.test.ts, test/tasks-file.test.ts, test/task-archiver.test.ts, test/commands/logs.test.ts — 7 legacy-fallback tests deleted across the four files, matching the 852-vs-859 delta.
- .cairn/tasks.json, .cairn/.cairn_tasks_snapshot.json, .cairn/.cairn_iterations.log, .cairn/tasks.completed.json — task 56 archived/marked complete via `cairn task complete`; not a direct edit of a forbidden path.
- .cairn/planning-notes.md — substantially rewritten (soak marked done, manual pre-round pinning marked done, task ordering corrected, outline expanded from 12 to 15 tasks). Unrelated to this task's stated scope; almost certainly working-tree state from a concurrent/prior `cairn plan` session that the harness's per-iteration commit swept in alongside task 56's own changes, not something the task-56 agent authored. Not itself a regression, but see below re: cairn.json.
- cairn.json — **`healthCheck` changed** from `"bun run build"` to `"bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck"` inside this commit. See Regression Risks.

### Gaps
None detected in the task's own file-migration scope. All five call sites named in the description were migrated, imports cleaned, and the four named test files updated with red-then-green TDD (per the agent's notes: source migrated first, tests run to confirm exactly 5 legacy-assertion failures, then those tests deleted).

### Regression Risks
- **cairn.json's `healthCheck` was committed as part of this task's commit, despite the task explicitly saying "Do NOT modify cairn.json's healthCheck."** Verified directly: `git show af5d66a:cairn.json` (task 55's commit) and `git show 51d10b2:cairn.json` (task 54's commit) both still show `"healthCheck": "bun run build"`; `git show 1c619af -- cairn.json` (this task's commit) shows the line changing to the pinned throwaway-outfile value. So the round's pre-round manual pin — documented in CLAUDE.md and this round's planning notes as a **deliberate, uncommitted, round-only** override — got baked into permanent git history for the first time inside task 56's commit, one iteration later than the planning notes claim it happened ("ALL COMPLETE" before Phase C started). This directly contradicts the task-56 agent's own notes, which state "Did **not** modify `cairn.json`'s `healthCheck`." Most likely explanation: the value was sitting dirty in the working tree from a manual/external pin and the per-iteration commit step swept in all dirty state (it also swept in the unrelated `planning-notes.md` rewrite), rather than the task-56 agent itself editing the line — but from a review standpoint the outcome is the same: an override the round's design explicitly requires to stay revertible-by-discard is now committed, so the documented post-round step ("restore `healthCheck` to `bun run build`") will need a new commit rather than a clean revert, and a future `git bisect`/archaeology pass would misattribute this change to "Task #56." Recommend either amending this commit split (extracting cairn.json's line back out) or explicitly noting the discrepancy so the post-round restoration isn't skipped on the assumption it was never committed.
- Everything else checked out clean:
  - `bun test test/task-selector.test.ts test/tasks-file.test.ts test/task-archiver.test.ts test/commands/logs.test.ts` → 96 pass, 0 fail — matches notes exactly.
  - `bun test` (full suite) → 852 pass, 0 fail, 31 files — matches notes exactly, consistent with the 859→852 delta (7 deleted tests, no other regressions).
  - `grep -rn "findTempFilePath\|allTempFilePaths" src/ --include="*.ts"` → only `src/utils.ts`; confirmed the two resolvers have zero remaining production callers outside it, so task 58's planned deletion is unblocked.
  - `grep -rn "remove once all projects migrated" src/task-selector.ts src/tasks-file.ts src/task-archiver.ts src/commands/logs.ts` → no matches; all 4 named markers gone (task-selector.ts 1, tasks-file.ts 1, task-archiver.ts 2).
  - `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` (the current, pinned health check) succeeds.
  - `unlinkSync` in `src/task-archiver.ts` confirmed still live (used for the no-notes prev_notes cleanup), not an orphaned import after the sweep-loop deletion.

### Verdict
HAS_RISKS
