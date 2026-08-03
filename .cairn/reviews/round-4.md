## Task #31: src/brand.ts + dual-read discovery and config
Reviewed: 2026-08-03T00:00:00Z

### Coverage
Task Requirements
├── [DONE] src/brand.ts exports frozen BRAND with exact fields (name, displayName, dataDir, configFile, envPrefix, tempPrefix, socket)
├── [DONE] findProjectRoot() in src/utils.ts tries '.cairn/' first, falls back to '.ralph/' (via new findDataDir/dataDirNameAt helpers)
├── [DONE] loadConfig() in src/config.ts tries 'cairn.json' first, falls back to 'ralph.json' (via new findConfigFile)
├── [DONE] Each fallback emits a ONE-TIME legacy warning (warnLegacyOnce, keyed 'data-dir' / 'config-file', process-global)
├── [DONE] STANDING RULE documented (brand.ts header comment, CLAUDE.md new section, task notes)
├── [DONE] TDD — new tests in test/utils.test.ts / test/config.test.ts assert literal '.cairn' / 'cairn.json' strings rather than importing BRAND
└── [PARTIAL] "Rename nothing else in this task" — ralph.json's `healthCheck` value was changed out of scope (see Regression Risks)

### Files Changed
- src/brand.ts (new)
- src/utils.ts
- src/config.ts
- test/brand.test.ts (new, not in Expected Files but reasonable added coverage)
- test/utils.test.ts
- test/config.test.ts
- CLAUDE.md (new "Branding and the legacy layout" section + health-check note)
- ralph.json (`healthCheck` value changed — out of task scope)
- .ralph/tasks.json, .ralph/state.json, .ralph/planning-notes.md, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json, .ralph/.ralph_task_31_notes.md (tool-managed bookkeeping, not agent-authored content)

### Gaps
None on the core functional requirements — BRAND shape, dual-read discovery/config, one-time warnings, and TDD-literal test assertions are all implemented as specified and covered by tests (preference order, legacy fallback, nearest-root-wins, non-directory `.cairn`, warn-once, no-warn-on-modern-layout).

Minor nit (not a functional gap): `test/brand.test.ts` tests `brand.ts` itself by importing `BRAND` and comparing its fields to hardcoded literals. The task's TDD instruction says to assert literals "rather than importing BRAND" — this file does import it, though since the comparison values are hardcoded literals (not derived from BRAND), a wrong value in `brand.ts` would still fail the test, so the anti-tautology intent is preserved. Testing `brand.ts` without importing it isn't really possible, so this is a reasonable exception, not a defect.

### Regression Risks
- **`ralph.json`'s `healthCheck` field was modified outside this task's stated scope**, changing it from `"bun run build"` to `"bun build --target=bun src/index.ts --outfile /tmp/cairn-healthcheck"`. This file/field is explicitly called out as user-managed for the duration of this round: task #34 (later in this same round) states *"do NOT modify ralph.json's healthCheck value... the user has pinned ~/.local/bin/ralph to a frozen binary copy and redirected the health check to a throwaway outfile... Both are user-managed and reverted manually after the loop finishes."* Task #31 already changed this field before task #34 could enforce that rule.
  - The new command also drops `--compile` (used by `bun run build`) in favor of a plain `bun build --target=bun ... --outfile`. If the manual pre-round pin described in `.ralph/planning-notes.md` (`bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`) had already been applied by the user, this diff overwrites it with a non-`--compile` variant, reducing the health check's fidelity to the actual `--compile` production build (a `--compile`-specific failure would no longer be caught by the health check for the rest of the round).
  - If the manual pre-round pin had *not* yet been applied when this task ran (the "before" value in the diff, `"bun run build"`, suggests it hadn't), the agent silently did part of the user's manual setup itself rather than surfacing the mismatch — worth flagging to the user since it means the actual pin state may not match what the planning notes assume, and the `~/.local/bin/ralph` binary-freeze half of that manual procedure may also not have happened.
  - Net effect: low probability of breaking this round in practice (the change is directionally consistent with what the round's safety plan intended), but it is an unrequested edit to a file/field explicitly flagged as off-limits for agents this round, and it should be verified against the user's actual manual setup before task #34 runs.

### Verdict
HAS_RISKS

---

## Task #32: Thread the resolved dataDir instead of reconstructing paths
Reviewed: 2026-08-03T01:05:00Z

### Coverage
Task Requirements
├── [DONE] src/index.ts:127 — completedTasksPath now built via join(dataDir, 'tasks.completed.json') using the resolved dataDir already in scope
├── [DONE] src/post-task-reviewer.ts:137 — reviewFileRule now derived from reviewsDir (built off the resolved dataDir), not a hardcoded '.ralph' reconstruction
├── [DONE] Root-caused the fix: setupProjectContext() (src/index.ts:38) now computes dataDir via findDataDir(projectRoot) instead of join(projectRoot, '.ralph') — without this, the two named sites would have been cosmetic no-ops, since RALPH_DATA_DIR (and every command downstream of it) would still resolve to a hardcoded '.ralph'
├── [DONE] TDD — allowlist-rule tests written first and confirmed failing pre-fix (legacy .ralph/ passed pre-fix as a regression guard; .cairn/ case failed pre-fix, got '.ralph' instead of '.cairn')
├── [DONE] Additional invariant test added (not required by the task but strengthens it): asserts the prompt's target round-<N>.md path is a prefix-match under the allowlist rule's directory glob, catching the *class* of grant/write-path divergence rather than one hardcoded instance
└── [DONE] Grant and write path structurally tied to the same reviewsDir variable — cannot silently diverge, which is exactly the dangerous failure mode the task called out

### Files Changed
- src/index.ts (setupProjectContext dataDir resolution + summarize action completedTasksPath)
- src/post-task-reviewer.ts (spawnPostTaskReviewer: absDataDir/reviewsDir/reviewFileRule)
- test/index.test.ts (new 'data dir resolution' and 'summarize action' describe blocks)
- test/post-task-reviewer.test.ts (3 new allowlist-rule tests)
- CLAUDE.md (agent-workflow paragraph updated to describe `<dataDir>/reviews/**` instead of hardcoded `.ralph/reviews/**`, and to explain why the rule must be derived from the resolved dir — not in Expected Files, but a low-risk accuracy fix to a paragraph this task's diff directly invalidated, unlike the out-of-scope ralph.json edit flagged in the task #31 review above)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json, .ralph/.ralph_task_32_notes.md (tool-managed bookkeeping)

### Gaps
None detected. Verified directly:
- `grep -rn "'\.ralph'" src/` and `grep -rn '"\.ralph"' src/` → only remaining literal is `LEGACY.dataDir: '.ralph'` in `src/brand.ts` (correct — that's the read-only fallback constant, not a reconstruction site) plus a comment referencing the old pattern for context.
- No `join(projectRoot, '.ralph', ...)` reconstructions remain anywhere in `src/`.
- `bun test` → 765 pass, 0 fail (matches the agent's reported count; independently re-run, not just trusted from notes).

### Regression Risks
- `getRound(dataDir)` in `src/post-task-reviewer.ts` (line 124) is still called with the original `dataDir` param, not the newly-introduced `absDataDir` — only `reviewsDir`/`reviewFilePath`/`reviewFileRule` were switched to the absolute-resolved variant. In production this is a non-issue: `dataDir` reaching this function always originates from `setupProjectContext()`'s `findDataDir(projectRoot)`, and `projectRoot` is always absolute (from `findProjectRoot()`), so `dataDir` is already absolute and `path.resolve` on it is a no-op. But if a future caller ever passes a relative `dataDir` (e.g. a test harness or a new entry point), `getRound()` would read `state.json` relative to `process.cwd()` while `reviewsDir` would correctly resolve relative to `projectRoot` — a silent split-brain on the round number specifically. Low likelihood given current call sites, but worth a one-line comment or a follow-up to route `getRound(absDataDir)` for full consistency, since this task's stated purpose is eliminating exactly this class of silent path divergence.
- Broadening `setupProjectContext()`'s `dataDir` resolution (beyond the two sites named in the task) changes behavior for `status`, `edit`, `logs`, `init`, `plan`, and `run` — not just `summarize`. For a brand-new project with neither `.cairn/` nor `.ralph/` present, `dataDir` now defaults to `.cairn/` instead of the previous hardcoded `.ralph/`. This is the intended end-state per the task 31 standing rule and is covered by tests ("defaults to .cairn/ when neither layout exists"), but it's a wider blast radius than the task description's "two sites" framing suggests — flagging for visibility, not as a defect, since it was necessary to make the two named fixes non-cosmetic and was pre-flagged as a known conversion site in task 31's carry-forward notes.
- No exports were removed, no test coverage was reduced (test count went up, 756 → 765), and no previously-passing test was altered to assert new behavior without also keeping legacy-path coverage (the legacy `.ralph/` case is asserted as a regression guard in both new test files).

### Verdict
HAS_RISKS

---

## Task #33: Stateful temp files: .cairn_ prefix with .ralph_ dual-read
Reviewed: 2026-08-03T01:15:00Z

### Coverage
Task Requirements
├── [DONE] Mechanism: `tempFilePath` (write, current prefix) / `findTempFilePath` (read, .cairn_ → .ralph_ fallback, warns once) / `allTempFilePaths` (both, for DI'd existence checks and cleanup sweeps) — src/utils.ts, mirrors the findDataDir() pattern from tasks 31/32
├── [DONE] LEGACY.tempPrefix = '.ralph_' added to src/brand.ts (BRAND.tempPrefix already existed)
├── [DONE] .ralph_completed_ids — read: task-selector.ts:11 via findTempFilePath; write: task-archiver.ts:66 via tempFilePath; forward-migration read (existingIdsFile) also uses findTempFilePath so legacy IDs are unioned into the new file
├── [DONE] .ralph_prev_notes — write: task-archiver.ts:87 via tempFilePath; stale legacy copy actively unlinked before every write/clear so it can't keep answering the dual-read
├── [DONE] .ralph_iterations.log — read: logs.ts:5 via findTempFilePath; write: run.ts:376 via tempFilePath (append-only, no read-side needed there)
├── [DONE] .ralph_tasks_snapshot.json — read: tasks-file.ts:133 via findTempFilePath (corruption-recovery path); write: tasks-file.ts:194 (snapshotTasksFile) via tempFilePath
├── [DONE] .ralph_complete — prompt-facing path (buildSystemPrompt, run.ts:49) via tempFilePath; loop existence check (run.ts:436) via allTempFilePaths(...).some(existsSync), correctly DI-safe; TEMP_FILES → TEMP_FILE_SUFFIXES, exit cleanup (run.ts:689) iterates allTempFilePaths for both prefixes
├── [DONE] Notes-sweep regex (run.ts:363, NOTES_TEMPFILE_RE) rebuilt from both BRAND.tempPrefix and LEGACY.tempPrefix, properly regex-escaped, matches both `.cairn_task_<id>_notes.md` and `.ralph_task_<id>_notes.md`, still rejects a missing `<id>`
├── [DONE] .ralph_task_*_notes.md left unrenamed — buildSystemPrompt still builds the notes path from `LEGACY.tempPrefix` with an explicit comment explaining why, per the task's explicit instruction not to touch it
└── [DONE] TDD — one fallback-read test per stateful file, confirmed present in all four required test files (task-selector.test.ts, task-archiver.test.ts, tasks-file.test.ts, commands/logs.test.ts), plus new mechanism-level tests in utils.test.ts (prefer-current, fallback, default-when-neither, warn-exactly-once)

### Files Changed
- src/brand.ts (LEGACY.tempPrefix)
- src/utils.ts (tempFilePath / findTempFilePath / allTempFilePaths)
- src/task-selector.ts, src/task-archiver.ts, src/tasks-file.ts, src/commands/logs.ts, src/commands/run.ts (conversion sites)
- src/commands/init.ts (GITIGNORE_CONTENT: added `.cairn_*` block, filled two entries — `tasks_snapshot.json`, `task_*_notes.md` — missing from both prefix lists)
- CLAUDE.md (new "temp-file prefix — a second naming tier" section)
- test/utils.test.ts, test/task-selector.test.ts, test/task-archiver.test.ts, test/tasks-file.test.ts, test/commands/logs.test.ts, test/commands/run.test.ts, test/commands/init.test.ts
- .ralph/.gitignore, .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json (tool-managed bookkeeping)

### Gaps
None detected against the task description. Independently verified, not just trusted from notes:
- `bun test` → 781 pass, 0 fail (matches notes exactly).
- `bun build --target=bun src/index.ts` → succeeds cleanly.
- `grep -rn '\.ralph_'` in `src/` → every remaining hit is either a comment, the `LEGACY.tempPrefix` constant definition, or the deliberate `LEGACY.tempPrefix`-built notes filename — no stray hardcoded `.ralph_` write/read site left uncovered.
- Read the full post-diff contents of run.ts, task-archiver.ts, task-selector.ts, logs.ts, tasks-file.ts (not just the diff hunks) to confirm no leftover unconverted call site and no now-unused import (`path` was fully removed from logs.ts and is no longer referenced there; `join` remains correctly used in task-selector.ts/task-archiver.ts for `tasks.completed.json`).

### Regression Risks
- **Asymmetric stale-file cleanup.** `prev_notes` actively unlinks the non-current-prefix file on every archive pass (task-archiver.ts:88-90), but `completed_ids` and `tasks_snapshot.json` do not — a legacy `.ralph_completed_ids` / `.ralph_tasks_snapshot.json` is left on disk indefinitely holding a stale, frozen snapshot of old data once the `.cairn_` file starts being written. Functionally harmless today (`findTempFilePath` always prefers the current prefix once it exists, so the stale file is never read again), but it's an inconsistency in an otherwise carefully-reasoned mechanism, and a future bug that deleted or renamed the `.cairn_` file would silently resurrect very stale state from the orphaned legacy file. Worth a one-line comment (as the author already did for the `iterations.log` decision) or a follow-up cleanup — not a functional defect today.
- **`.ralph_task_meta` / `.cairn_task_meta` left inconsistent.** `src/commands/init.ts`'s `GITIGNORE_CONTENT` lists both `.cairn_task_meta` and `.ralph_task_meta`, but no code in `src/` ever reads or writes a `task_meta` temp file via `tempFilePath`/`findTempFilePath` — appears vestigial from a removed or never-built feature, predating this task. Not introduced by this diff and not in scope per the task description (only four stateful files + `.ralph_complete` were named), but flagging since it sits right next to the lines this task touched and could be mistaken for a fifth stateful file that was missed.
- No exports were removed, no test coverage was reduced (test count only went up, 752/728→781/781 per the notes, independently confirmed at 781 pass/0 fail), and no previously-passing behavior was changed without a corresponding regression-guard test (legacy-only and both-exist cases are asserted alongside the current-prefix-only case at every converted read site).

### Verdict
HAS_GAPS

---

## Task #34: Dual-name build and install
Reviewed: 2026-08-03T01:20:00Z

### Coverage
Task Requirements
├── [DONE] package.json: "name" → "cairn"
├── [DONE] package.json: build outfile dist/ralph → dist/cairn
├── [DONE] install.sh: symlinks BOTH $PREFIX/bin/cairn and $PREFIX/bin/ralph to dist/cairn
├── [DONE] install.sh: RALPH_ROOT/RALPH_BIN → CAIRN_ROOT/CAIRN_BIN (grep-confirmed: zero remaining RALPH_ROOT/RALPH_BIN references anywhere outside the new test file, which asserts their absence)
├── [DONE] install.sh: echo messages updated to report both installed paths ("Building cairn...", "Installed: $PREFIX/bin/cairn -> ...", "Installed: $PREFIX/bin/ralph -> ...")
├── [DONE] No deprecation warning on the ralph symlink — comment frames it as a "long-lived compatibility name, kept working indefinitely"; grep for "deprecat" (case-insensitive) in install.sh returns nothing
├── [DONE] CRITICAL constraint: ./install.sh not run — confirmed no dist/cairn artifact exists on disk (only the stale pre-existing dist/ralph), and ~/.local/bin/ralph still resolves to the user's frozen binary copy (ralph-frozen), untouched
├── [DONE] CRITICAL constraint: ralph.json healthCheck not modified — `git log -1 -- ralph.json` shows the last touch was task #31, not this diff
└── [DONE] TDD — new test/install-script.test.ts written first per notes (5/6 failing pre-fix, confirmed against original files), 6 tests covering name, outfile, dual symlink, renamed vars, and no-deprecation-text; independently re-ran full suite: 787 pass, 0 fail

### Files Changed
- package.json (name, build outfile)
- install.sh (var rename, dual symlink, echo messages, header comment)
- test/install-script.test.ts (new, 6 tests)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json (tool-managed bookkeeping)

### Gaps
None detected against the task description or its file scope. Independently verified, not just trusted from notes:
- `bun test` → 787 pass, 0 fail (matches notes exactly, re-run standalone and as part of the full suite).
- Read the full post-diff `install.sh` and `package.json` (not just diff hunks) — no leftover `RALPH_ROOT`/`RALPH_BIN`/`dist/ralph` reference, PATH-check logic below the symlink block is untouched and still correct.
- `grep -rn "RALPH_ROOT\|RALPH_BIN"` and `grep -rn "dist/ralph"` across the repo (excluding `.ralph/`) → only remaining hits are: this task's own test assertions (expected), a pre-existing comment in `src/utils.ts:192` (explicitly flagged out-of-scope in the notes, correctly so — it's prose, not a resolution bug), and README.md/CLAUDE.md, which are stale relative to this change but are explicitly owned by a separate, not-yet-run task ("Docs: README, CLAUDE.md, RFC", id 41 in the pending list) — correctly out of this task's file scope, not a gap.

### Regression Risks
None detected.
- No exports were removed or renamed in any module other agents depend on — this task's blast radius is fully contained to `package.json`/`install.sh`, neither of which is imported by other source files.
- No test coverage was reduced; test count went up (781 → 787, +6, all new).
- `.claude/settings.local.json` still contains a stale permission grant referencing `dist/ralph` (`Bash(ln -sf .../dist/ralph ~/.local/bin/ralph)`) — harmless (an unused permission entry, not executable), pre-existing, and not part of this task's file scope; noting only for visibility since the underlying path it names no longer matches where `bun run build` will place the binary once the freeze lifts.

### Verdict
CLEAN

---

## Task #35: Env vars to CAIRN_* plus three-way API-key chain
Reviewed: 2026-08-03T01:30:00Z

### Coverage
Task Requirements
├── [DONE] setConfigEnvVars() (src/config.ts:159-170) — all 10 vars renamed to CAIRN_*
├── [DONE] Every other reader across src/ renamed: index.ts (PROJECT_ROOT, DATA_DIR, LIB_DIR, NARRATE_PYTHON, AGENTS_DIR, AGENTS_JSON), run.ts (TASK_CONTEXT, plus NARRATE_PYTHON/LIB_DIR call sites), task.ts (DATA_DIR), narrate.ts (NARRATE_PYTHON, LIB_DIR, NARRATION_VOICE), stream-filter.ts (TRUNCATE_TEXT), utils.ts (PROJECT_ROOT) — independently enumerated all 22 pre-existing `RALPH_[A-Z_]+` tokens via `git grep` diff (before vs. after) and confirmed only the two intentional exceptions plus the unrelated `RALPH_VERSION` local const remain in `src/`/`lib/`
├── [DONE] Stale `ralph_config.sh` comment at old src/config.ts:130 deleted — confirmed gone, replaced with an accurate one-liner
├── [DONE] Exception 1 (API key): `resolveAnthropicApiKeyChain()` implements CAIRN → legacy RALPH → plain ANTHROPIC_API_KEY, never normalizes onto plain `ANTHROPIC_API_KEY` (test explicitly asserts the input env object is untouched); `warnIfLegacyApiKey()` warns once via `warnLegacyOnce`; `lib/ralph_narrate_server.py` independently reimplements the same chain (correct — it's a subprocess reading its own inherited `os.environ`, not something the TS side can set for it) with a matching stderr message
├── [DONE] Exception 2 (`RALPH_NARRATE_SOCKET`): `ralph_narrate_server.py --socket` now checks `CAIRN_NARRATE_SOCKET` → `RALPH_NARRATE_SOCKET` → `DEFAULT_SOCKET`; README:158-161 updated to document the new primary name with the legacy fallback called out
├── [PARTIAL] `RALPH_FORCE_SHELL` deletion — verified independently (both pre- and post-diff `git grep` across src/lib find zero references) that it was already fully dead; nothing to delete in source. Correct call, but the task also names a stale `.claude/settings.local.json` permission entry as the var's only surviving trace — that file is confirmed untracked (`git ls-files` has no hit), so it's a local dev artifact outside the repo's scope, not something this task's diff could plausibly touch. Flagging only because the task description explicitly called it out as something to be aware of, not because it was missed.
└── [PARTIAL] TDD scope — `resolveAnthropicApiKeyChain`/`warnIfLegacyApiKey` are well covered as pure functions in test/config.test.ts (8 new tests: precedence order, empty-string CAIRN value falls through, never-normalizes assertion, warn-once, no-warn-on-cairn/plain/none). However, neither test/commands/narrate.test.ts nor test/commands/run.test.ts has any assertion that these two functions are actually *called* at the new call sites (narrate.ts:71, run.ts pre-`startNarrationServer`). Confirmed by grep — zero matches for `warnIfLegacyApiKey`/`resolveAnthropicApiKeyChain`/`ANTHROPIC_API_KEY` in either test file. The wiring only "proved itself" incidentally: running the suite on this machine (which has `RALPH_ANTHROPIC_API_KEY` set per the task's own description of the user's `~/.zshrc`) printed the legacy-warning line during `test/commands/run.test.ts`, but no test asserts on it — a CI environment without that var set would exercise this integration point in zero tests.

### Files Changed
- src/config.ts (setConfigEnvVars rename, new resolveAnthropicApiKeyChain/warnIfLegacyApiKey exports, stale comment removed)
- src/index.ts, src/utils.ts, src/commands/task.ts, src/commands/run.ts, src/commands/narrate.ts, src/stream-filter.ts (mechanical RALPH_* → CAIRN_* renames + two new call sites)
- lib/ralph_narrate.py, lib/ralph_narrate_server.py (env var renames; server implements its own 3-way key chain and 2-way socket fallback)
- README.md (CAIRN_NARRATE_SOCKET / CAIRN_PROJECT_ROOT documentation)
- test/config.test.ts (8 new tests), test/index.test.ts, test/utils.test.ts, test/stream-filter.test.ts, test/commands/run.test.ts, test/commands/narrate.test.ts (mechanical renames of existing assertions)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json, .ralph/state.json (tool-managed bookkeeping); .ralph/reviews/round-4.md (this file)

### Gaps
- No test exercises the actual call sites of `warnIfLegacyApiKey`/`resolveAnthropicApiKeyChain` in `narrate.ts` or `run.ts` — only the underlying pure functions are unit-tested. A regression that removed either call (e.g. accidentally deleting line 71 in narrate.ts) would not be caught by `bun test`.
- Everything else in the task description is fully addressed; see Coverage tree above for the two flagged PARTIALs, both minor.

### Regression Risks
None detected beyond the test-coverage gap above.
- Independently re-ran `bun test` → **795 pass, 0 fail** (matches notes exactly).
- Read full post-diff contents of `src/config.ts`, `src/commands/run.ts`, `src/commands/narrate.ts`, `lib/ralph_narrate_server.py` (not just diff hunks) — no leftover unconverted `RALPH_*` reads outside the two intentional exceptions, no broken imports, `BRAND.displayName` (used in the new warning message) exists and resolves correctly for both brand states.
- No exports removed; two new exports added (`resolveAnthropicApiKeyChain`, `warnIfLegacyApiKey`) are pure additions.
- Confirmed the `ANTHROPIC_API_KEY` blanking lines this task's description calls "load-bearing" (run.ts:208, plan.ts:170, summarize.ts:111, post-task-reviewer.ts:119) are all still present and untouched.
- Confirmed via `git grep` diff (before vs. after) that the full set of pre-existing `RALPH_[A-Z_]+` tokens is accounted for: renamed, deliberately kept as a fallback, or (for `RALPH_VERSION`) correctly identified as a non-env-var local const.
- One pre-existing (not introduced by this task) inaccuracy noted for visibility only: README:158 has always claimed "`ralph run` sets [the narrate socket var] automatically," but neither before nor after this diff does `run.ts` (or any hook script) actually set that env var — the hook scripts hardcode the socket path as a literal. Not a regression; the same gap existed with the `RALPH_` name pre-task, this diff only changed the var name in the sentence. Likely related to task #48 (already filed) about wiring `BRAND.socket` in properly.

### Verdict
HAS_GAPS

---

## Task #36: Internal identifiers to Cairn
Reviewed: 2026-08-03T01:35:00Z

### Coverage
Task Requirements
├── [DONE] RalphConfig -> CairnConfig (src/types.ts declaration; call sites updated in src/config.ts, src/commands/init.ts, src/commands/run.ts, src/post-task-reviewer.ts, and test/agent-prompt.test.ts, test/commands/run.test.ts, test/config.test.ts, test/post-task-reviewer.test.ts)
├── [DONE] resolveRalphRoot -> resolveCairnRoot (src/utils.ts; call sites updated in src/index.ts and src/commands/init.ts (installSlashCommands/installAgents), and test/utils.test.ts, test/commands/init.test.ts)
├── [DONE] local var/param ralphRoot -> cairnRoot (src/index.ts: setupProjectContext's returned field + local const, both call sites in createProgram's helpers; src/commands/init.ts: installSlashCommands/installAgents param + internal `root` assignment)
├── [DONE] RALPH_VERSION -> CAIRN_VERSION (src/index.ts:17, and both read sites: `.version()` call and the `ralph ${CAIRN_VERSION}` string)
├── [DONE] writeRalphJson -> writeCairnJson (src/commands/init.ts, plus its call site in runInit and all four call sites in test/commands/init.test.ts)
└── [DONE] Error message + doc comment in resolveCairnRoot updated ('Could not determine ralph repo root' -> '...cairn repo root'; JSDoc 'Find the ralph repo root...' -> '...cairn repo root...')

### Files Changed
- src/types.ts (RalphConfig -> CairnConfig, isValidConfig type guard)
- src/utils.ts (resolveRalphRoot -> resolveCairnRoot, error message, doc comment)
- src/config.ts, src/commands/run.ts, src/post-task-reviewer.ts (CairnConfig type import/usage)
- src/index.ts (CAIRN_VERSION, cairnRoot field/local)
- src/commands/init.ts (CairnConfig, resolveCairnRoot, cairnRoot params, writeCairnJson)
- test/agent-prompt.test.ts, test/commands/init.test.ts, test/commands/run.test.ts, test/config.test.ts, test/index.test.ts, test/post-task-reviewer.test.ts, test/utils.test.ts (mechanical rename of imports/usages)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json (tool-managed bookkeeping)

### Gaps
None detected. Independently re-grepped `src/` and `test/` for `RalphConfig|resolveRalphRoot|\bralphRoot\b|RALPH_VERSION|writeRalphJson` — zero hits, matching the task notes' own scope-check claim. The five identifiers named in the task description, plus their doc comment, are all renamed with every call site and test import updated in lockstep.

Two things intentionally left alone, and correctly so per the task's own scope:
- The `ralph.json` filename itself (still written by `writeCairnJson`) — renaming the function is separate from renaming the file, consistent with the documented dual-name current/legacy convention in CLAUDE.md; the task only asked to rename the function.
- The CLI's `.name('ralph')` and local test helper variable `fakeRalphRoot` in test/commands/init.test.ts — the former is user-facing branding out of scope for "internal identifiers," the latter is just a test's own descriptive local variable, not one of the five call-site identifiers the task named for renaming.

### Regression Risks
None detected.
- Independently re-ran `bun test` → **795 pass, 0 fail**, matching the task notes exactly — no tests added, removed, or skipped.
- Independently ran `bun build --target=bun src/index.ts --outfile ...` → succeeds, 108 modules, 0.43 MB — confirms no compile breakage from the rename.
- No exports removed that anything outside this diff's own updated call sites depends on: `resolveRalphRoot`/`writeRalphJson`/`RalphConfig` are gone, but every one of their importers was updated in the same diff (confirmed via repo-wide grep above finding zero stragglers).
- `ralphRoot` rename in `src/index.ts` correctly threads through `setupProjectContext`'s return type and both downstream uses (`CAIRN_LIB_DIR`, `CAIRN_NARRATE_PYTHON`) — no stale destructuring left behind.

### Verdict
CLEAN

---

## Task #37: Rename sweep: src/commands/init.ts
Reviewed: 2026-08-03T01:35:19Z

### Coverage
Task Requirements
├── [DONE] Data dir creation / console messages use BRAND, not literals — `initCoreFiles` and `createInstructionsFile` now derive `dirName = path.basename(dataDir)` instead of hardcoding `.ralph/`; `writeCairnJson`, `showNextSteps`, `runInit` banner, and `installNarrationHooks` message all switched to `BRAND.*`
├── [DONE] GITIGNORE_CONTENT lists both `.cairn_*` and legacy `.ralph_*` names — verified directly in current source (lines 10-27): 7 `.cairn_*` entries + 7 `.ralph_*` entries under an explicit "Legacy names" comment
├── [DONE] NARRATE_SH/SPEAK_SH/NOTIFY_SH SOCKET → `${BRAND.socket}` (resolves to `/tmp/cairn-tts.sock`); :307-area console message updated to "${BRAND.displayName} narration server at ${BRAND.socket}"
├── [DONE] writeCairnJson writes `BRAND.configFile` (`cairn.json`) instead of `ralph.json`
├── [DONE] getConfigDefaults uses the dual-read helper — verified directly in `src/config.ts`: `loadConfig` → `findConfigFile` checks `BRAND.configFile` first, falls back to `LEGACY.configFile` with a one-time warning. No code change was needed here and the notes correctly say so.
├── [DONE] showNextSteps() → "Run 'cairn plan'" via `` `Run '${BRAND.name} plan'` ``
└── [DONE] 'Initializing Ralph in:' banner → `` `Initializing ${BRAND.displayName} in: ...` ``

### Files Changed
- src/commands/init.ts (all 7 numbered task items; also updated several doc comments naming `ralph.json`/`.ralph/`/"ralph's commands" for consistency)
- test/commands/init.test.ts (existing tests retitled/repointed at `.cairn`/`cairn.json` literals; new tests added for `.cairn` dataDir paths, legacy-`ralph.json`-left-untouched, narration socket/message, and cairn.json defaults loading)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json, .ralph/reviews/round-4.md (tool-managed bookkeeping)

### Gaps
None detected. Independently re-grepped `src/commands/init.ts` for `ralph` (case-insensitive): the only 8 remaining hits are the intentional legacy `.ralph_*` gitignore lines (7) and one doc comment naming "legacy ralph.json" — exactly matching the task notes' own scope-check claim. Independently confirmed both claims the notes flagged as "no code change needed" (GITIGNORE_CONTENT already dual-named; getConfigDefaults already dual-read via `loadConfig`/`findConfigFile`) by reading the current source directly rather than trusting the notes.

### Regression Risks
None detected.
- Independently ran `bun test test/commands/init.test.ts` → **110 pass, 0 fail** (matches notes' claimed count).
- Independently ran full `bun test` → **804 pass, 0 fail** (matches notes' claimed count, +9 over task #36's 795).
- Independently ran `bun build --target=bun src/index.ts --outfile ...` → succeeds, 108 modules, 0.43 MB.
- `writeCairnJson`'s filename change (`ralph.json` → `cairn.json`) is a genuine behavior change, correctly called out as such in the notes and covered by a new test asserting a pre-existing legacy `ralph.json` is left untouched (not merged, not deleted) — no data-loss risk for projects with an existing legacy config.
- No exports removed that other modules depend on; `BRAND` import added cleanly, no naming collisions with existing imports.

### Verdict
CLEAN

---

## Task #38: src/commands/task.ts agent-facing usage strings
Reviewed: 2026-08-03T01:40:00Z

### Coverage
Task Requirements
├── [DONE] All ~20 agent-facing `ralph task <subcommand>: ...` stderr strings renamed to `cairn task <subcommand>: ...` — covers `start`, `complete`, `note`, `set-status`, `add` (including its two literal-string validation-failure messages), `show`, `next-id`
├── [DONE] Subcommand group description at (now) line 341 — `'Manage tasks in .ralph/tasks.json'` → `` `Manage tasks in ${BRAND.dataDir}/tasks.json` `` (renders `.cairn/tasks.json`), via new `BRAND` import
└── [DONE] TDD — test/commands/task.test.ts's existing `ralph task add` / `ralph task next-id` assertions updated in lockstep to the `cairn task` literal; one net-new test added (`registerTaskCommands` describe block) that wires a real `Command()`, calls `registerTaskCommands`, and asserts `task.description() === 'Manage tasks in .cairn/tasks.json'` — this is the only test in the suite that exercises the Commander wiring layer directly rather than the underlying `task*` functions, so it's genuine new coverage, not a rename of an existing assertion

### Files Changed
- src/commands/task.ts (BRAND import, ~20 stderr string renames, subcommand group description)
- test/commands/task.test.ts (3 renamed assertions, 1 new test)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json (tool-managed bookkeeping)

### Gaps
None detected. Independently verified, not just trusted from notes:
- `grep -n -i ralph src/commands/task.ts test/commands/task.test.ts` → the only remaining hit is the test file's `beforeEach` tmpdir prefix string (`'ralph-task-test-'`), a cosmetic local fixture name, not agent-facing and outside this task's scope.
- Read the full post-diff `registerTaskCommands` block (lines ~335-430) — the seven subcommand `.description()` calls (`start`, `complete`, `note`, `set-status`, `add`, `next-id`, `show`) never contained literal `'ralph task ...'` usage examples to begin with (they're generic phrases like "Mark a task as in-progress"), so the task description's framing ("usage strings... appear in command descriptions, help text") slightly overstates where the literals actually lived — but every instance that did exist (all in stderr error messages, plus the one group description) was found and renamed.

### Regression Risks
None detected.
- Independently ran `bun test test/commands/task.test.ts` → **32 pass, 0 fail, 96 expect() calls** (matches notes' claimed count).
- Independently ran full `bun test` → **805 pass, 0 fail, 1584 expect() calls** (matches notes' claimed count, +1 over task #38's own baseline of 804 from task #37).
- No exports removed or changed signature; `BRAND` import added cleanly with no naming collisions.
- Pure string-literal rename plus one description change — no control-flow, validation, or exit-code behavior touched, so no risk to callers (the orchestrator's `ralph task ...` CLI invocations still work identically; only the printed/described text changed).

### Verdict
CLEAN

---

## Task #39: Agent-facing prompts and reviewer allowlist
Reviewed: 2026-08-03T01:43:35Z

### Coverage
Task Requirements
├── [DONE] buildSystemPrompt() Step 1 — `ralph task start <id> --iteration N` → `cairn task start ...` (verified: source line, prior/new test both pass)
├── [DONE] buildSystemPrompt() Step 5(b) — `ralph task complete <id> --iteration ... --notes-file ...` → `cairn task complete ...`
├── [DONE] Discovered-task instruction — `use ralph task add --file <path>` → `use cairn task add --file <path>`
├── [DONE] Prohibition line — `Do NOT use Edit or Write on .ralph/tasks.json directly — the ralph task subcommands...` → `Do NOT use Edit or Write on ${tasksFile} directly — the cairn task subcommands...`, where `tasksFile = path.join(dataDir, 'tasks.json')` and `dataDir` is threaded from `input.dataDir` → `RunOpts.dataDir` → `findDataDir(projectRoot)` in `src/index.ts:38` (task 32's plumbing) — independently traced the call chain, confirmed no hardcoded literal
├── [DONE] src/agent-prompt.ts:13 — `` run `ralph init` to install default agents `` → `` run `cairn init` ``
├── [DONE] src/commands/run.ts:66 internal-agent warning — `[ralph] Agent '...'` → `` [${BRAND.name}] Agent '...' ``
└── [DONE] Reviewer allowlist (task title) — independently read `src/post-task-reviewer.ts:126-152`: `reviewFileRule = \`/${reviewsDir}/**\`` is already derived from `absDataDir` (the resolved data dir), confirming the notes' claim that no code change was needed here

### Files Changed
- src/commands/run.ts (4 string edits inside `buildSystemPrompt()`, all within the task's stated scope)
- src/agent-prompt.ts (1 string edit)
- test/agent-prompt.test.ts (1 updated assertion)
- test/commands/run.test.ts (4 updated assertions + 3 new tests)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json, .ralph/reviews/round-4.md (tool-managed bookkeeping)

### Gaps
None detected against this task's own scope. Independently verified rather than trusted:
- Re-derived the `dataDir` provenance chain myself (`src/index.ts:38` `findDataDir(projectRoot)` → `RunOpts.dataDir` → `buildSystemPrompt`'s `input.dataDir` → `tasksFile`) to confirm the "must come from resolved dataDir, not a hardcoded literal" requirement is actually satisfied, not just asserted in the notes.
- `grep -in ralph src/commands/run.ts src/agent-prompt.ts` after the diff → remaining hits (doc comments citing `ralph_execute.sh`/`ralph_narrate_server.py`, `'ralph plan'` error hint, `/tmp/ralph-tts.sock`, `Ralph Execution Loop Started/Completed` log lines, `Ralph - Complete`/`Ralph - Stopped` ntfy titles, the legacy notes-tempfile comment) are all outside the 3 items this task's description enumerated. Cross-checked `.ralph/tasks.json` directly: task #40 ("Remaining src/ rename sweep") explicitly names `src/commands/run.ts:367 ("ralph plan")`, and task #48 explicitly names `src/commands/run.ts` for the `/tmp/ralph-tts.sock` literal, so those two are tracked. Note: task #40's own `files` array does *not* list `src/commands/run.ts` even though its description text cites a `run.ts:367` line — a latent inconsistency in task #40's scoping, not something task #39 introduced or was responsible for catching (task #39's description didn't mention these strings at all). Flagging only for round-5 planning awareness, not as a gap in this task.

### Regression Risks
None detected.
- Independently ran `bun test test/agent-prompt.test.ts test/commands/run.test.ts` in isolation → 111 pass, 5 fail. Confirmed the 5 failures are the same pre-existing narration-related test-isolation flakiness called out in the notes (all in `runRun` narration describe blocks), not caused by this diff — the fix touches only string literals inside `buildSystemPrompt()`/`buildAgentArgs()`, nowhere near narration server lifecycle code.
- Independently ran full `bun test` → **808 pass, 0 fail, 1588 expect() calls**, exactly matching the notes' claimed count (net +3 over task #38's 805), and confirming the 5 narration tests pass when the full suite runs together.
- Independently ran `bun build --target=bun src/index.ts --outfile /tmp/task39-health-check` → succeeds, 108 modules, 0.43 MB.
- Pure string-literal edits inside prompt-building functions; no exports removed, no signature changes, no control flow touched. `BRAND` was already imported in `run.ts` (used by task #38 elsewhere), so no new-import collision risk.
- The 3 new tests are genuine regression guards, not renamed duplicates: the "resolved dataDir, not hardcoded" test would fail if a future edit reintroduced a `.ralph/`-literal ban string, and the brand-prefix warning test is the first coverage of that `console.warn` path at all.

### Verdict
CLEAN

---

## Task #40: Remaining src/ rename sweep
Reviewed: 2026-08-03T01:55:00Z

### Coverage
Task Requirements
├── [DONE] status.ts:25/:46 user-visible hints ("ralph init" / "ralph plan") → BRAND.name
├── [DONE] run.ts:367-ish "ralph plan" hint → BRAND.name (plus 3 adjacent branding strings taken as same-class work)
├── [DONE] edit.ts — usage string renamed; config-target resolution fixed to use findConfigFile() instead of a hardcoded ralph.json literal (real bug fix, not just cosmetic — verified findConfigFile() still defaults to creating BRAND.configFile when neither file exists, so "open editor to create new config" behavior is preserved)
├── [DONE] index.ts — program name, version string, init description → BRAND
├── [DONE] stream-filter.ts — ntfy titles → BRAND.displayName; dead doc-comment references to deleted lib/ralph_stream_filter.py removed rather than mis-renamed (verified the file no longer exists in the repo)
├── [DONE] file-lock.ts — lock-timeout error message → BRAND.name
├── [DONE] process.ts — stale "ported from ralph_execute.sh" doc comment removed (file confirmed deleted)
├── [DONE] tasks-file.ts, task-counter.ts — prose comments renamed (Ralph/ralph → Cairn/cairn)
├── [DONE] logs.ts, summarize.ts, plan.ts — verified independently via grep: zero remaining "ralph" hits, correctly left untouched
├── [DONE] task-selector.ts, task-archiver.ts — verified independently: only remaining hits are comments accurately describing the intentional `.ralph_` legacy-fallback behavior from tasks #32/#33, correctly left unchanged
├── [PARTIAL] narrate.ts — listed in both the task description's module list and the Expected Files list, but received zero changes. All four remaining "ralph" hits (DEFAULT_PID_FILE, DEFAULT_SOCKET_PATH, and two ralph_narrate*.py script-path literals) were deliberately deferred to tasks #41/#48, with a cross-task note attached to #48 flagging the pid-file coupling. This is a reasonable engineering call (tasks #41/#48 own the socket/script-path migration strategy and touching them here risks stepping on that work), but it means an explicitly-scoped file was fully skipped rather than partially covered — worth flagging even though the deferral rationale is sound.
└── [DONE] TDD — tests updated/added before source changes per task instructions; bun test confirms 814 pass / 0 fail (matches notes exactly, independently re-run for this review)

### Files Changed
- .ralph/tasks.json (task #40 marked complete + notes; task #48 annotated)
- src/commands/edit.ts
- src/commands/run.ts (not in Expected Files, but explicitly called out in task description for the "ralph plan" hint)
- src/commands/status.ts
- src/file-lock.ts
- src/index.ts
- src/process.ts
- src/stream-filter.ts
- src/task-counter.ts
- src/tasks-file.ts
- test/commands/edit.test.ts
- test/commands/run.test.ts
- test/commands/status.test.ts
- test/file-lock.test.ts
- test/index.test.ts
- test/stream-filter.test.ts

### Gaps
- src/commands/narrate.ts was explicitly named in scope (task description and Expected Files) but left entirely untouched. The deferral to tasks #41/#48 is defensible given those tasks explicitly own the socket-path/script-path strategy, but it should be tracked as intentional carry-over rather than silently absorbed — the note left on task #48 covers this adequately for now.

### Regression Risks
None detected. Independently verified:
- Full suite: `bun test` → 814 pass, 0 fail, 1603 expect() calls (matches task notes).
- Health check: `bun build --target=bun src/index.ts --outfile ...` succeeds (108 modules, 0.43 MB).
- `findConfigFile()` fallback chain (cairn.json → legacy ralph.json → default cairn.json) preserves prior edit.ts behavior of opening the editor on a not-yet-existing config path to create one, so `ralph/cairn edit config` is not broken for new projects.
- No exports removed, no test coverage reduction — net +6 tests, all additive (config-resolution edge cases, brand-name negative assertions, stopped/early-exit ntfy title, lock-timeout message).
- Exclusion list respected: no historical-record files (tasks.completed.json, .ralph_iterations.log, .ralph_tasks_snapshot.json, reviews/round-*.md, task-notes scratch, audit/) were touched.

### Verdict
HAS_GAPS

---

## Task #41: Python narration rename and socket
Reviewed: 2026-08-03T02:05:00Z

### Coverage
Task Requirements
├── [DONE] `git mv lib/ralph_narrate.py lib/cairn_narrate.py` — verified via `git show --stat` (rename, similarity 94%) and `git log --follow` walks through pre-rename history (Task #35, "rewrite", "Fix narration server dying after macOS sleep", etc.) — history genuinely preserved, not delete+add
├── [DONE] `git mv lib/ralph_narrate_server.py lib/cairn_narrate_server.py` — same verification, similarity 96%
├── [DONE] Default socket path `/tmp/ralph-tts.sock` → `/tmp/cairn-tts.sock` in both Python files — verified `DEFAULT_SOCKET = "/tmp/cairn-tts.sock"` at `lib/cairn_narrate_server.py:24`; independently confirmed `cairn_narrate.py` has no socket logic at all (standalone one-shot speaker), so "both files" correctly resolves to one code change
├── [DONE] `--socket` argparse default: `CAIRN_NARRATE_SOCKET` with `RALPH_NARRATE_SOCKET` fallback — verified at `lib/cairn_narrate_server.py:215`: `os.environ.get("CAIRN_NARRATE_SOCKET") or os.environ.get("RALPH_NARRATE_SOCKET", DEFAULT_SOCKET)`, exactly as required
├── [DONE] Delete stale `lib/__pycache__/` — verified directory no longer exists (`ls lib/`); confirmed via `.gitignore:3` (`lib/__pycache__/`) that it was never tracked, so its absence from the diff is correct, not a missed deletion
├── [DONE] Update script paths in `src/narration.ts` and `RALPH_LIB_DIR`/`RALPH_NARRATE_PYTHON` usage — independently read `src/narration.ts` in full: it holds no script-path literals at all (`scriptPath` is a caller-supplied parameter), so there was nothing to change there for this sub-item; `src/commands/narrate.ts` and `src/commands/run.ts` (the actual callers holding `'ralph_narrate_server.py'`/`'ralph_narrate.py'` literals) were correctly updated in all 3 call sites
└── [PARTIAL] Socket-path *value* consistency — `src/brand.ts:19` already defines `BRAND.socket = '/tmp/cairn-tts.sock'` (from an earlier task), but `src/narration.ts:5`, `src/commands/narrate.ts:11-12`, and `src/commands/run.ts:406` all still hardcode `/tmp/ralph-tts.sock`, and `run.ts` unconditionally passes this literal as the `--socket` flag to the newly-renamed Python server — meaning the Python server's new `DEFAULT_SOCKET` is currently unreachable dead code in normal operation (the caller always overrides it). This is a knowing, documented deferral to task #48 ("Wire BRAND.socket into the narration socket path"), not a silent miss — the task's own item 2 wording ("in both files") grammatically scopes to the two Python files named in item 1, and item 5 only mentions script paths, not the socket value. Marked PARTIAL rather than GAP because the letter of the task description is satisfied; flagged because the net runtime effect of "change the socket path" is currently zero until #48 lands.

### Files Changed
- lib/ralph_narrate.py → lib/cairn_narrate.py (git mv + docstring updates)
- lib/ralph_narrate_server.py → lib/cairn_narrate_server.py (git mv + socket/branding updates)
- src/commands/narrate.ts (2 script-path literals)
- src/commands/run.ts (2 script-path literals, both narration-server start call sites)
- test/commands/narrate.test.ts (2 assertion updates)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json (tool-managed bookkeeping)

### Gaps
- `test/narration.test.ts` was explicitly named in the task's TDD instruction ("update test/narration.test.ts and test/commands/narrate.test.ts") but received zero changes. It still contains two tests literally titled `'uses /tmp/ralph-tts.sock as default socketPath'` that pin the legacy value. The notes' claim that "it has no reference to the Python filenames" is true and explains why no *rename* edit was needed, but doesn't address that the file was called out by name for TDD attention specifically because of the socket-path change — which was deferred whole-cloth to #48. Not a code defect, but the task's own TDD instruction for this file was effectively a no-op.
- No test (Python or TS) exercises the new `CAIRN_NARRATE_SOCKET`/`RALPH_NARRATE_SOCKET` fallback logic in `cairn_narrate_server.py:215`, or the new `DEFAULT_SOCKET` value. This repo has no Python test infrastructure at all, so this is consistent with the rest of the codebase rather than a task-specific shortfall — noting for completeness only.
- Three-way socket-path inconsistency now exists across the repo (`BRAND.socket` = cairn-tts.sock, Python `DEFAULT_SOCKET` = cairn-tts.sock, but every actual TS call site still hard-codes and passes ralph-tts.sock). Tracked correctly via the existing note on task #48; no new task needed.

### Regression Risks
None detected. Independently verified:
- `git log --follow` on both renamed files walks cleanly through pre-rename commits — history genuinely preserved.
- Full suite: `bun test` → 814 pass, 0 fail, 1603 expect() calls (matches notes exactly; unchanged from task #40's count, consistent with a pure rename + inert default-value change).
- Health check: `bun build --target=bun src/index.ts --outfile ...` → succeeds, 108 modules, 0.43 MB.
- Runtime behavior is unchanged from pre-task state: since `run.ts`/`narrate.ts` still explicitly pass `/tmp/ralph-tts.sock` as `--socket`, the narration server (when enabled) continues listening on the same path it always did — the deferred socket-value work carries no behavioral regression risk, just an unrealized rename.
- No exports removed, no test coverage reduction (test count unchanged: the 2 touched assertions in `narrate.test.ts` are like-for-like literal swaps, not new coverage, but nothing was deleted either).
- Exclusion-list / legacy-fallback conventions from CLAUDE.md respected throughout.

### Verdict
HAS_GAPS

---

## Task #42: Agent and slash-command source files
Reviewed: 2026-08-03T02:10:00Z

### Coverage
Task Requirements
├── [DONE] `agents/planner.md` — "Ralph agentic loop system" → "Cairn agentic loop system"; verified via grep, zero `ralph` hits (case-insensitive) remain in the file
├── [DONE] `agents/post-task-reviewer.md` — `.ralph/tasks.json` → `.cairn/tasks.json` in the write-restriction sentence; verified this is the only line in the file that referenced `.ralph/` or "Ralph"
├── [DONE] `agents/summarizer.md` — independently re-read the full file end to end; confirmed zero references to "ralph"/"Ralph"/`.ralph/` exist, so no-op was correct, not a missed file
├── [DONE] `agents/audit-planner.md` — independently re-read the full file end to end; confirmed zero references, same as above
├── [DONE] `commands/generate-tasks.md` — all `.ralph/{planning-notes.md,tasks.json,instructions.md}` path references → `.cairn/`; both `ralph task next-id --count <n>` examples → `cairn task next-id --count <n>`; "Ralph agentic loop system" → "Cairn agentic loop system"; grep confirms zero remaining hits
├── [DONE] `commands/review-tasks.md` — same treatment, all four `.ralph/` path references and the "Ralph agentic loop system" line updated; zero remaining hits
└── [DONE] `commands/codebase-audit.md` — the one `.ralph/planning-notes.md` write-instruction reference → `.cairn/planning-notes.md`; zero remaining hits

### Files Changed
- agents/planner.md
- agents/post-task-reviewer.md
- commands/codebase-audit.md
- commands/generate-tasks.md
- commands/review-tasks.md
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/.ralph_iterations.log, .ralph/.ralph_tasks_snapshot.json, .ralph/reviews/round-4.md (tool-managed bookkeeping)

### Gaps
None detected. Independently verified via `grep -rni "ralph" agents/ commands/` that no repo-root file under either directory retains a "ralph"/"Ralph"/`.ralph/` reference, and `ls agents/ commands/` shows exactly the 7 files named in the task description exist — nothing in scope was missed, and nothing out of scope needed touching.

### Regression Risks
None detected. Independently verified:
- `git show --stat` on the task's commit confirms zero `.claude/` files appear in the diff — the CRITICAL instruction to leave installed artifacts untouched was honored exactly.
- `bun test` → 814 pass, 0 fail, 1603 expect() calls, 29 files — unchanged from the pre-task baseline, consistent with a markdown-only change with no unit tests targeting these files (as the task description itself notes).
- These are static prompt files read by agents at spawn time, not code — no exports, no runtime call sites, no risk of breaking a TypeScript consumer.
- The rationale given in the task notes (agent-facing prompt text uses the literal new brand/paths rather than a dynamic lookup, consistent with tasks #38/#39's precedent) is sound and consistently applied across all five edited files.

### Verdict
CLEAN

---

## Task #43: cairn migrate command - core moves
Reviewed: 2026-08-03T02:11:40Z

### Coverage
Task Requirements
├── [DONE] New `migrate` command: `src/commands/migrate.ts` (exports `runMigrate(cwd, io?)`) + registration in `src/index.ts`
├── [PARTIAL] Operates on CWD only, "resolve the root via the same dual-read discovery as everything else" — operates on cwd only (correct, no upward walk), but does NOT call the canonical `findDataDir()`/`findConfigFile()` (src/utils.ts, src/config.ts); instead hand-rolls `path.join(cwd, BRAND.dataDir)` / `path.join(cwd, LEGACY.dataDir)` existence probes — see Gaps
├── [DONE] Exits with a clear error if cwd is neither a Cairn nor a Ralph project — verified by test `errors when the cwd is neither a Cairn nor a Ralph project`
├── [DONE] Non-interactive, idempotent — verified by test `is idempotent — a second run changes nothing and exits 0`
├── [DONE] PREFLIGHT: refuse on any `in-progress` task — verified by test `refuses when a task is in-progress and changes nothing`
├── [DONE] PREFLIGHT: warn (not refuse) on dirty tree — verified by test `warns but proceeds when the working tree is dirty`
├── [DONE] `git mv` data dir (.ralph→.cairn) and config file (ralph.json→cairn.json), untracked/gitignored contents carried along — verified by tests `renames the data dir and the config file`, `stages the renames but never commits`
├── [DONE] Rename the four stateful temp files (.ralph_completed_ids, .ralph_prev_notes, .ralph_iterations.log, .ralph_tasks_snapshot.json → .cairn_*) — verified by test `renames the four stateful temp files, preserving content` (content-preservation asserted, not just existence)
├── [DONE] Leave `.ralph_task_*_notes.md` and all archive files (tasks.completed.json, reviews/round-*.md, audit/) untouched — verified by test `leaves task-notes scratch and all archive files untouched`
├── [DONE] Tolerate partial installs (no state.json, no reviews/, no config file) — verified by test `tolerates a partial install`
└── [DONE] Stages changes, never commits — verified by test `stages the renames but never commits` (commit count asserted unchanged)

### Files Changed
- src/commands/migrate.ts (new)
- src/index.ts (registers `migrate` command)
- test/commands/migrate.test.ts (new, 12 tests)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/state.json (tool-managed bookkeeping)

### Gaps
- **Discovery logic duplicates rather than reuses the canonical resolvers.** The task description explicitly says "Resolve the root via the same dual-read discovery as everything else," and CLAUDE.md states a standing rule verbatim in `src/brand.ts:6-10`: *"BRAND.dataDir / BRAND.configFile are for CREATING paths, never for RESOLVING them. Any path that points at an existing project's data must come from the value discovery actually found (`findDataDir()` in src/utils.ts, `findConfigFile()` in src/config.ts) — otherwise a project still on the legacy layout gets paths pointing at a directory that does not exist."* `migrate.ts` does exactly the pattern this rule warns against: `const currentDir = path.join(cwd, BRAND.dataDir)` / `const legacyDir = path.join(cwd, LEGACY.dataDir)`, then existence-probes both directly, rather than calling `findDataDir(cwd)` / `findConfigFile(cwd)`.
  - This is not a functional bug in the tested scenarios (both candidate paths are still checked, and `isDir`/`isFile` are used only for existence, never assumed-exists reads), and a literal call to `findDataDir()` couldn't fully satisfy migrate's needs unmodified — it silently resolves to one winner (preferring `.cairn` if both exist, defaulting to `.cairn` if neither exists) rather than surfacing the ambiguous/absent cases migrate needs to refuse on. Some custom logic was arguably unavoidable.
  - However, the task notes never acknowledge this tension or explain the deviation from the explicit instruction and the standing rule — there's no mention of why `findDataDir`/`findConfigFile` weren't reused or extended. That's a documentation/design gap on top of the literal instruction not being followed: the duplicated candidate-list logic (`[BRAND.dataDir, LEGACY.dataDir]` order, etc.) can silently drift from `dataDirNameAt()` in src/utils.ts if that function's resolution order or `CAIRN_PROJECT_ROOT` handling ever changes.

### Regression Risks
- **Likely spurious "dirty working tree" warning on the idempotent second run.** After a first successful migrate, changes are staged but not committed (by design). The dirty-tree check (`git status --porcelain` non-empty → warn) runs before any moves, and staged-but-uncommitted renames from the first run make `git status --porcelain` non-empty on a second invocation. So re-running `migrate` before committing would likely print "the git working tree is not clean" even though nothing the user did caused it — purely an artifact of the tool's own prior staged output. This isn't covered by the `is idempotent` test (which only asserts exit code, staged-diff stability, and the "nothing to do" message, not the absence/presence of the dirty warning). Low severity (cosmetic — still exits 0, still a correct no-op) but could confuse a user running migrate twice before committing. I could not empirically confirm this in this review session — the reviewer's sandbox restricts Bash/Write to `.ralph/reviews/**`, blocking the temp-directory repro I attempted — so this is reasoned from `move()`'s ordering and git semantics, not directly observed.
- No removed exports, no deleted/weakened tests, no reduction in existing coverage. `bun test` → 12/12 pass in the new file (confirmed independently in this review).

### Verdict
HAS_GAPS

---

## Task #49: migrate: refresh the data-dir .gitignore for .cairn_* temp names
Reviewed: 2026-08-03T02:18:01Z

### Coverage
Task Requirements
├── [DONE] In `src/commands/migrate.ts`, after the data-dir move, append missing `.cairn_*` ignore lines to `<dataDir>/.gitignore` — new exported `refreshDataDirGitignore(dataDir)`, called right after the stateful-temp-file rename loop and before the summary
├── [DONE] Keep the legacy `.ralph_*` lines (still read as a fallback) — `refreshDataDirGitignore` only appends via `fs.appendFileSync`; existing lines (legacy included) are never rewritten or removed. Verified by test `appends every missing .cairn_* name, keeping the legacy lines`
├── [DONE] Match the two-block layout already used by `GITIGNORE_CONTENT` in `src/commands/init.ts` (current names, then a `# Legacy names` block) — `init.ts` was refactored to expose `TEMP_IGNORE_SUFFIXES`, `GITIGNORE_CURRENT_HEADER`, `GITIGNORE_LEGACY_HEADER` and an `ignoreBlock()` helper that both `init.ts`'s `GITIGNORE_CONTENT` and `migrate.ts`'s `refreshDataDirGitignore` now share, so the two can't drift apart; verified byte-for-byte reconstruction of the old literal `GITIGNORE_CONTENT` string, and independently confirmed `bun test test/commands/init.test.ts` → 110/110 pass (untouched, no assertions needed updating)
├── [DONE] Idempotent: appending twice adds nothing — verified by test `is idempotent — a second run leaves the file byte-identical` and `never duplicates a .cairn_* name that is already listed`; achieved via whole-file `Set` membership, not a fragile "did we already touch this file" flag
├── [DONE] If `.gitignore` does not exist (partial install), do nothing — `refreshDataDirGitignore` returns `[]` immediately on `!isFile(gitignorePath)`; also gated at the call site by `if (dataDir)` so a config-only project (no data dir at all) never even attempts the check. Verified by test `creates no .gitignore when the data dir has none`
└── [DONE] Stage the edit, never commit — `git(['add', rel], cwd)` at the call site; verified by test `stages the .gitignore edit without committing`, which asserts both the commit count is unchanged and `git show :.cairn/.gitignore` (the index, not just the worktree) contains the new lines

### Files Changed
- src/commands/migrate.ts (new `refreshDataDirGitignore()` export + call site + updated summary messaging)
- src/commands/init.ts (refactored `GITIGNORE_CONTENT` into shared, exported building blocks — not in the task's "Expected Files" list, but a deliberate DRY choice to avoid two hand-maintained ignore-name lists drifting apart; explicitly called out in the task notes)
- test/commands/migrate.test.ts (+7 tests, new `migrate .gitignore refresh` describe block)
- .ralph/tasks.json, .ralph/tasks.completed.json, .ralph/reviews/round-4.md (tool-managed bookkeeping via `ralph task complete`, not direct edits)

### Gaps
None detected. All six literal requirements in the task description map to a [DONE] item above, each with an independent test assertion, and this review independently re-ran the suite rather than trusting the task notes' reported numbers.

### Regression Risks
None detected. Independently verified in this review session (not just trusting the task notes):
- `bun test test/commands/migrate.test.ts` → 19 pass, 0 fail (12 pre-existing + 7 new), 110 expect() calls.
- `bun test` (full suite) → 833 pass, 0 fail, 30 files — matches the task notes' reported count exactly, no discrepancy.
- `bun test test/commands/init.test.ts` → 110 pass, 0 fail — confirms the `GITIGNORE_CONTENT` refactor in `init.ts` is behavior-preserving; no existing init test needed to change, consistent with the byte-identical claim in the task notes.
- No exports were removed; `GITIGNORE_CONTENT` in `init.ts` keeps its existing (unexported, module-private) binding, and the newly exported symbols (`TEMP_IGNORE_SUFFIXES`, `GITIGNORE_CURRENT_HEADER`, `GITIGNORE_LEGACY_HEADER`, `ignoreBlock`, `refreshDataDirGitignore`) are additive.
- No deleted or weakened tests — the new describe block is purely additive to the existing `migrate.test.ts`.
- Minor, non-blocking: the `stagedNote` at migrate.ts:240 labels the gitignore append `(untracked)` whenever `git add` exits non-zero, but conflates two different causes — a genuinely untracked/gitignored `.gitignore` file vs. any other `git add` failure (e.g. a `rel` path computed wrong, or git not finding the file for an unrelated reason). Cosmetic only: the log line is informational, doesn't gate control flow, and isn't asserted on by any test.

### Verdict
CLEAN

---

## Task #44: cairn migrate - .claude refresh and git staging
Reviewed: 2026-08-03T02:30:00Z

### Coverage
Task Requirements
├── [DONE] Reuse `installAgents()`/`installSlashCommands()` from `init.ts`, installing the full current set even where `.claude/` never existed — `installMdDir()` now shared by both, `refreshClaudeArtifacts()` calls both unconditionally with `cairnRoot` defaulted; verified by test `installs the full agent and command set into a project that has none` (content diffed live against the repo's `agents/`/`commands/` dirs, not a hardcoded list)
├── [DONE] Non-destructive, overwrite-by-filename only — `installMdDir()` only ever `copyFileSync`s files named in the source dir, never lists or deletes destination-only files; verified by `overwrites a stale cairn-owned agent but leaves a custom one untouched` (custom `frontend-code-analyzer.md` and `commands/deploy.md` survive byte-identical and stay out of the staged set)
├── [DONE] Regenerate the three hooks only if hooks already exist; never create where there were none — `refreshClaudeArtifacts()` gates `writeNarrationHooks()` behind `NARRATION_HOOKS.some(h => isFile(...))`; verified by both `regenerates all three hooks... when hooks already exist` (one pre-existing hook triggers all three, matching the "hooks are already opted into" reading of the task) and `creates no hooks in a project that never had them`
├── [DONE] Rewrite the data-dir `.gitignore` with both prefixes, preserving custom lines — already implemented by task #49's `refreshDataDirGitignore()`; task #44 didn't need to re-touch this, it's exercised end-to-end through the same `runMigrate()` call path exercised by the new tests (e.g. `modified:\s+\.cairn\/\.gitignore` in the summary test)
├── [DONE] Explicitly `git add` every non-`git mv` output (gitignore, hooks, installed agents/commands) — the new loop over `refreshClaudeArtifacts()`'s return value calls `git add -- <rel>` per file and warns (without aborting) on failure; verified by `stages every newly installed agent and command file`, asserted against the git index via `git show :.claude/agents/planner.md`, not just the worktree
└── [DONE] Finish with a git-status-style summary of exactly what was staged — new `record()`/`stagedLines` accumulator, labelled via `git diff --cached --name-status -M` per path rather than guessed; verified by `prints a git-status style summary of what it staged`

### Files Changed
- src/commands/migrate.ts (new `refreshClaudeArtifacts()`, `STATUS_LABELS`, `record()`/`stagedLines` summary, `git add` loop over installed artifacts, updated "nothing to do" gate)
- src/commands/init.ts (`installSlashCommands`/`installAgents` refactored onto shared `installMdDir()`, now return `string[]` and accept `InstallOptions{skipUnchanged, log}`; new exported `NARRATION_HOOKS` + `writeNarrationHooks()`)
- src/index.ts (migrate's `--help` description text updated to mention the artifact refresh)
- test/commands/migrate.test.ts (+8 tests, new `migrate .claude refresh` describe block; fixture gained a `claude?` option)

### Gaps
None detected against the six numbered requirements in the task description — each maps to a [DONE] item above with an independent test assertion, verified by re-running the suite rather than trusting the task notes' reported counts (`bun test test/commands/migrate.test.ts` → 27/27; `bun test` → 841/841, matching the notes exactly).

### Regression Risks
None detected requiring action. Independently re-verified in this review session:
- `installSlashCommands`/`installAgents` signature changed from `void` to `string[]`, but no caller in the codebase assigns or awaits their return value (`grep`'d for `= install(Agents|SlashCommands)` — zero hits), so the change is additive in practice despite touching an exported signature.
- No exports were removed; `installMdDir` is a new private helper, `NARRATION_HOOKS`/`writeNarrationHooks`/`InstallOptions`/`refreshClaudeArtifacts` are additive exports.
- No deleted or weakened tests — new describe block is purely additive.
- Low-severity, non-blocking wording nit: when `moved === 0` but only the gitignore was refreshed (no `.claude` artifact changes — e.g. an already-migrated project whose artifacts are current but whose gitignore is stale), `runMigrate` now prints `Refreshed Cairn artifacts in <cwd>.` even though nothing under `.claude/` changed. The prior, more precise `.gitignore`-specific message from task #49 was replaced by this generic one. No test asserts the exact string either before or after, so nothing broke, but the message can now overstate what happened in that one narrow path.
- Low-severity, unconfirmed: `git diff --cached --name-status -M -- <rel>` uses rename detection (`-M`) scoped to a single-file pathspec purely to label install output as new/modified; in the extremely unlikely case a newly-added file is >50%-similar to some unrelated deleted path elsewhere in the repo, git could attribute it as a rename and it would print `renamed:` instead of `new file:`. Purely cosmetic (only affects the closing summary text, not what's staged), not covered by a test, and not a realistic scenario for `.md`/`.sh` installs in practice.

### Verdict
HAS_RISKS

---

## Task #45: Docs: README, CLAUDE.md, RFC
Reviewed: 2026-08-03T02:45:00Z

### Coverage
Task Requirements
├── [DONE] README.md rename sweep (72 refs) — title, prerequisites, API key section, install/quick-start, commands table (+ new `cairn migrate` row, `ralph` symlink note), workflow steps 1-4, push notifications, personal instructions, configuration, project-root detection, both file-structure trees, tips; verified by grepping the file post-change — every remaining `ralph` hit is a categorized compatibility/legacy mention, not a stale reference
├── [DONE] CLAUDE.md rename sweep (21 refs) — "What is Cairn" intro, Development section (`dist/cairn`, `cairn --version`, dual-symlink install note), per-project data layout tree (`.cairn/` with `.ralph/` fallback noted, `reviews/` dir present, `state.json`'s round field called out), Agent workflow section's `cairn task` subcommands (with `ralph task` compat note), and the direct-Edit/Write-forbidden paragraph — all present and updated
├── [DONE] docs/parallel-execution-rfc.md rename sweep (9 refs) — 7/9 renamed (byline, prose, both `ralph task`/`ralph run --parallel N` command citations, the proposed `.ralph/logs/` path); the 2 unchanged hits (`/tmp/ralph-tts.sock` at lines 52 and 213) are literal citations of the actual current socket constant — independently confirmed via grep that `src/narration.ts`, `src/commands/narrate.ts`, `src/commands/run.ts:406`, and all three `.claude/hooks/*.sh` scripts still hardcode `/tmp/ralph-tts.sock` today, so leaving these two as-is is correct, not a miss
├── [DONE] New mechanics: `cairn migrate` command documented in both CLAUDE.md (new section: cwd-only scope, stage-not-commit, refusal conditions, `.claude/` refresh, idempotency) and README.md (new "Migrating from Ralph" section, user-facing walkthrough)
├── [DONE] New mechanics: compatibility window (dual data layout, dual config file, dual binary, no scheduled `ralph` symlink removal) documented in both CLAUDE.md and README.md
├── [DONE] New mechanics: pin/unpin procedure for self-modifying rounds documented in CLAUDE.md as a standalone 4-step section, matching the institutional knowledge referenced in task #34 and this same review file's round-4 history
└── [PARTIAL] RALPH_NARRATE_SOCKET export instructions "so the new name and new socket path must both appear" — the new *name* (`CAIRN_NARRATE_SOCKET`) appears in both README locations, but the new *socket path* (`/tmp/cairn-tts.sock`) does not, because it genuinely isn't live yet: verified via grep that `BRAND.socket` in `src/brand.ts` is unused by any of the four hardcoded-path sites, and none of `cairn run`/`cairn narrate on` read the env var at all (they always pass `--socket` explicitly). Documenting the new path as directed would describe behavior that doesn't exist and silently no-ops if copy-pasted. The agent instead documented current (non-working) reality and pointed at pre-existing task #48, which owns the actual wiring. Judgment call is sound, but it is a literal deviation from the task's explicit instruction, not full compliance

### Files Changed
- README.md
- CLAUDE.md
- docs/parallel-execution-rfc.md

### Gaps
One partial item: the socket-path deviation above. Not a functional gap — the alternative (documenting a non-functional env var as if it worked) would be worse — but the task description's literal instruction ("the new socket path must both appear") was not followed. Flagging for visibility; no action needed unless task #48 lands and this README note isn't revisited (already called out in the task's own notes as follow-up work).

### Regression Risks
None detected. This is a docs-only change:
- `bun test` → 841 pass, 0 fail per task notes — no source files touched, so no test surface was at risk.
- `bun build --target=bun src/index.ts --outfile ...` reported clean per task notes.
- No exports, tests, or contracts touched. `.ralph/tasks.json` / `.ralph/tasks.completed.json` changes are the standard tool-managed archival (via `cairn task complete`), not direct edits.
- The two RFC lines left as `/tmp/ralph-tts.sock` are accurate to current code, not a doc/code drift regression.

### Verdict
HAS_GAPS

---

## Task #46: Verification sweep
Reviewed: 2026-08-03T02:53:42Z

### Coverage
Task Requirements
├── [DONE] Run `grep -rni ralph` sweep and fix misses from earlier tasks — found and fixed: stale `.claude/agents/*.md` + `.claude/commands/*.md` (independently reverified: `grep -rni ralph .claude/agents/ .claude/commands/` now returns nothing), `bun.lock`'s workspace `"name"` field (`"cairn"` confirmed by direct read), two dead `bin/ralph` provenance comments in `src/utils.ts`, and a stale `dist/ralph`/`bin/ralph` comment (confirmed no `dist/ralph` string remains anywhere under `src/`)
├── [DONE] Mark every category-1 fallback with `remove once all projects migrated` (or `TODO(#48)` for the two non-fallback socket/pid literals) — enforced by new `test/legacy-markers.test.ts`, which scans `src/**/*.ts`, `lib/*.py`, `agents/*.md`, `commands/*.md`, `install.sh` for exactly this; independently re-ran the full suite (not just trusting the task notes) and confirmed `844 pass, 0 fail, 31 files` — identical to the notes' claimed numbers
├── [DONE] `bun test` must pass — independently re-ran `bun test`: 844 pass, 0 fail, matches notes exactly. Also independently re-ran `bun build --target=bun src/index.ts --outfile /tmp/task46-review-healthcheck`: clean, 0.44 MB, 109 modules
└── [PARTIAL] Report the final tally (how many references remain + category breakdown) — the notes report **987** matching lines with a 7-bucket table that sums to 987. Independently re-running the exact command described (`grep -rni ralph`, excluding only `.git/`, `node_modules/`, `dist/`, `.venv/`) against the current tree returns **1305** matching lines, not 987 — a ~318-line discrepancy. Traced the gap: four sets of files that exist on disk today and match the grep are absent from every bucket in the reported table — `.ralph/.ralph_task_*_notes.md` (17 files, 264 lines — explicitly named as historical-record in the task's own category-2 list), `.ralph/.ralph_iterations.log` (31 lines — also explicitly named in category-2), `.ralph/.ralph_prev_notes` (16 lines), and `.ralph/.ralph_tasks_snapshot.json` (6 lines, at its state during this review). By contrast, the *other* three category-2 files (`tasks.completed.json`, `reviews/round-4.md`, `planning-notes.md`) *are* individually itemized in the table's "Historical record" bucket. So the omission isn't a deliberate, disclosed exclusion (like the `.claude/settings.local.json` row, which is explicitly called out as excluded and why) — these four just aren't accounted for anywhere, which means the categorization pass wasn't actually exhaustive over its own stated category-2 list, even though the underlying judgment (leave historical/scratch files alone) is correct

### Files Changed
- `.claude/agents/planner.md`, `.claude/agents/post-task-reviewer.md`, `.claude/commands/codebase-audit.md`, `.claude/commands/generate-tasks.md`, `.claude/commands/review-tasks.md` — stale installed copies refreshed to current templates
- `CLAUDE.md` — new "The removal marker" subsection
- `bun.lock` — workspace name `ralph` → `cairn`
- `install.sh`, `lib/cairn_narrate_server.py`, `src/brand.ts`, `src/commands/edit.ts`, `src/commands/init.ts`, `src/commands/migrate.ts`, `src/commands/narrate.ts`, `src/commands/run.ts`, `src/config.ts`, `src/index.ts`, `src/narration.ts`, `src/post-task-reviewer.ts`, `src/task-archiver.ts`, `src/task-selector.ts`, `src/tasks-file.ts`, `src/utils.ts` — `remove once all projects migrated` / `TODO(#48)` markers added at every fallback site, plus the `utils.ts` dead-comment fixes
- `test/legacy-markers.test.ts` — new, 3 tests
- ~25 other `test/**/*.ts` files — cosmetic `ralph-` → `cairn-` renames of temp-dir prefixes, local identifiers, and test titles (legacy-layout fixtures deliberately left alone, confirmed by spot-checking `test/commands/plan.test.ts` and `test/commands/migrate.test.ts`)
- `.ralph/.gitignore`, `.ralph/tasks.json`, `.ralph/tasks.completed.json`, `.ralph/reviews/round-4.md`, `.ralph/.ralph_iterations.log` — standard tool-managed task lifecycle files (archival, review log, iteration log), not direct edits

### Gaps
The final-tally partial item above: the reported 987-line tally and its category breakdown do not reconcile with an actual re-run of the described grep command against the current tree (1305 lines). The gap is entirely attributable to legitimately-excludable files (gitignored per-task scratch notes and the iterations log, both of which the task description itself names as category-2 historical record), so no remediation is needed — but the report's own internal checksum ("516 + 345 + 47 + 54 + 8 + 7 + 10 = 987 ✓") gives false confidence that the accounting is complete when it silently drops ~318 lines' worth of real, on-disk, still-matching content. Worth a corrective note if this round's numbers are ever cited again, but not worth reopening the task for.

### Regression Risks
None detected. Independently re-verified in this review session, not just trusting the task notes:
- `bun test` → 844 pass, 0 fail, 31 files (re-ran fresh).
- `bun build --target=bun src/index.ts --outfile ...` → clean, 0.44 MB, 109 modules (re-ran fresh).
- `healthCheck` in `ralph.json` remains pinned to the throwaway outfile (`/tmp/cairn-healthcheck`) per the pin/unpin procedure — confirmed untouched, as the notes claim.
- No exports removed; `test/legacy-markers.test.ts` is a net-new, purely additive test file (+3 tests), and no existing test was deleted or weakened.
- `.claude/agents/*.md` / `.claude/commands/*.md` overwrites were re-verified to be genuinely stale-content replacements — a direct grep confirms zero `ralph` references remain in either installed directory.
- Working tree is otherwise clean (`git status --short` shows only the expected `.ralph/.ralph_iterations.log` churn from this review's own `bun test` run).

### Verdict
HAS_GAPS
