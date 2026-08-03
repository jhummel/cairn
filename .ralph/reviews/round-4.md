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
