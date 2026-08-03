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
