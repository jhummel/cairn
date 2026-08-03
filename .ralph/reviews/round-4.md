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
