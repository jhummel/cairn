## Context

Round 8 renamed Ralph → Cairn in this repo and shipped the compatibility surface (dual-read discovery, dual symlink, `cairn migrate`). **This session completed the follow-up: all five consuming projects are migrated and committed.**

| Project | Commit | Completed tasks | Notes |
|---|---|---|---|
| karaoke-kiosk | `95b133a` | 156 | `review-post.md` deleted |
| karaoke-remote | `aff1537` | 92 | `review-post.md` deleted (a third copy, not in round 8's survey) |
| karaoke-reservation | `7414f73` | 427 | 2 doc refs; hooks → `/tmp/cairn-tts.sock` |
| lyrical-pitch-reservations | `81d0cb6` | 80 | gained 4 agents + 3 commands (first install); custom `frontend-code-analyzer.md` byte-identical after |
| karaoke-platform | `3e0a8c3b` | 951 | on `main` (user fast-forwarded from `staging` mid-session); root `.gitignore`, `.dockerignore`, scenario comment, dead permission rule |

All six repos (including cairn itself) are on `.cairn/`, trees clean. **Nothing on this machine reads `.ralph/` anymore** — the compatibility surface is now dead weight, which is the precondition the removal round was gated on.

Round 8's post-round manual steps were all verified done: both symlinks point at `dist/cairn`, `healthCheck` is back to `bun run build`, `ralph-frozen` is gone, `~/.zshrc` is on `CAIRN_ANTHROPIC_API_KEY`, repo folder renamed.

### Facts established this session

- **`CAIRN_PROJECT_ROOT` is priority #1 in `findProjectRoot`** (`src/utils.ts:156`), above the upward walk. `cairn plan` exports it, so every shell spawned from a planning session resolves to *that* project regardless of cwd. Verification of another project must clear it (`env -u CAIRN_PROJECT_ROOT -u CAIRN_DATA_DIR …`). This is documented, intended behavior — not a bug — but it silently invalidates cross-project checks. `cairn migrate` is unaffected: it takes `cwd` directly.
- **`migrate` does not touch the repo-root `.gitignore`.** Only the one *inside* the data dir. karaoke-platform had five `**/.ralph_*` patterns at root that went dead on migration; fixed by hand. No other project had any. Moot going forward — `migrate` is being deleted and nothing is left to migrate.
- **`RALPH_ANTHROPIC_API_KEY` is in no rc file.** It survives only as inherited env in long-lived shells started before the `~/.zshrc` edit. Fresh logins get `CAIRN_` only. Removing the fallback chain will break narration in those stale shells until they restart.
- **lyrical-pitch runs prettier via a pre-commit hook** and it reformatted all four installed agent `.md` files (11 lines: blank-line normalization + one escaped `\*`). Semantically identical, but every future `cairn init` there will rewrite from source and prettier will re-escape — perpetual churn.
- **The soak is not yet done.** No migrated project has run a real `cairn run` / plan cycle post-migration. `cairn status` was verified in all five, but that only proves discovery.
- Uncommitted in this repo: a `test/index.test.ts` fix (stale `.ralph` assertion, made layout-agnostic) and a pre-existing `.cairn/state.json` modification.
- Removal surface measured: **36 markers across 15 source files** (`src/utils.ts` 7, `src/narration.ts` 5, `src/config.ts` 5, `run.ts`/`init.ts` 3 each, `install.sh` and the Python server 2 each, six files with 1). The test surface is larger — ~20 test files, led by `init.test.ts` (90 legacy refs), `config.test.ts` (56), `migrate.test.ts` (47), `utils.test.ts` (41).
- **No `Bash(ralph:*)` permission rules exist in any project**, so dropping the symlink causes no permission friction in interactive sessions.

## Goals

1. **Soak** — prove a migrated project runs a real loop before burning the bridge.
2. **Remove the compatibility surface entirely** — all 36 markers, `LEGACY`, the dual symlink, `cairn migrate`, and the marker-enforcement test.
3. Keep the historical record intact — archives, review files, iteration logs, and committed task notes still contain `ralph` and must not be rewritten.
4. Leave `brand.ts` as the single source of truth, minus `LEGACY`.

## Approach

- **Soak first, in the two projects that changed most.** lyrical-pitch-reservations (oldest layout, gained agents/commands it never had) and karaoke-platform (largest surface, 951 tasks, narration hooks). A plan or run cycle in each. Cheap insurance while the fallback still exists.

- **Pin the binary for the removal round.** Same procedure as round 8, documented in CLAUDE.md: freeze `~/.local/bin/cairn` at a known-good copy, point `healthCheck` at `/tmp/cairn-healthcheck`. Milder hazard than round 8 (cairn is already on `.cairn/`, so deleting legacy paths shouldn't break its own reads) but `healthCheck: bun run build` still writes `dist/cairn` — the live binary every agent calls via `cairn task` — so a bad intermediate build goes live mid-round without it.

- **Ordering is load-bearing, twice:**
  - **`src/brand.ts` last among source changes.** Every fallback reads `LEGACY`; deleting it first breaks the build everywhere at once.
  - **`test/legacy-markers.test.ts` deleted last.** It asserts every `ralph` mention *carries* a marker, so it stays green while mentions are stripped and only becomes wrong once `LEGACY` is gone. Deleting it early removes the guardrail while it's still doing work.

- **`rm ~/.local/bin/ralph` is an explicit manual step.** Dropping the symlink from `install.sh` does not delete the existing one — it's a live symlink on disk and would keep resolving to `dist/cairn` forever. Without this, "is it really gone?" silently passes.

- **TDD within each task** — write/adjust the test, watch it fail, make it pass. Test updates fold into the source task they cover, never a separate task.

- **Explicit exclusion list on every sweep.** `tasks.completed.json`, `.cairn_iterations.log`, `.cairn_tasks_snapshot.json`, `reviews/round-*.md`, `.ralph_task_*_notes.md`, `audit/`. These are history and keep their `ralph` references. Same rule that governed round 8.

- **Test assertions stay literal** (`'.cairn'`, `'cairn.json'`) rather than importing `BRAND` — carried from round 8.

## Rejected Alternatives

**This session:**
- **Removal round immediately after migrations, no soak.** Rejected — `cairn status` only proves discovery resolves; it doesn't exercise the loop, agents, task CLI, or narration. The fallback is the safety net and it costs nothing to keep while testing.
- **Keep `cairn migrate` as a no-op safety net.** Rejected — nothing is left on `.ralph/`, and an unused command with 47 legacy test refs is pure carrying cost. Recoverable from git history if an old clone ever surfaces.
- **Tag a release before deleting `migrate`.** Rejected — git history already preserves it; a tag adds ceremony without adding recoverability.
- **Teach `migrate` about the repo-root `.gitignore`.** Rejected as moot — discovered via karaoke-platform's dead `**/.ralph_*` patterns, but `migrate` is being deleted and no project remains to migrate. Fixed by hand instead.
- **Rewrite "outside a Ralph round" in karaoke-platform's `src/services/trivia-service/CLAUDE.md:68`.** Rejected — historical narrative describing a 2026-07-12 hotfix that genuinely happened during Ralph. Changing it would falsify the record. Left as-is.
- **Amend kiosk's commit for root-`.gitignore` patterns.** Unnecessary — verified only platform had them.

**Carried from round 8 (still relevant):**
- **Truly runtime-configurable name.** Rejected on a bootstrap trap — discovery walks up looking for the data dir, so if both the dir name and config filename come from config, no fixed anchor remains. Near-zero payoff.
- **Straight rename with no abstraction.** Rejected — identical ~1,100-reference cost on any future rename. `brand.ts` survives the removal round; only `LEGACY` goes.
- **Rewriting archives during a sweep.** Rejected — falsifies history. Still governs the removal round: archives keep their `ralph` refs.
- **Renaming `.ralph_task_*_notes.md`.** Rejected — write-and-sweep scratch never read back, and 24 are committed history in karaoke-platform. They stay under the legacy name permanently.
- **`BRAND` constant in test assertions.** Rejected as partly tautological — a wrong `brand.ts` value would still pass.
- **Mixed test style** (literals for contracts, `BRAND` for incidentals). Rejected — per-test judgment for little gain.
- **Splitting a self-modifying round into batches with stop/rebuild/restart between each.** Rejected — 4–5 manual cycles, every boundary a chance to get ordering wrong. Pinning achieves the same safety with two setup commands.
- **Redirecting the health check without also pinning the symlink.** Rejected — any stray `bun run build` silently un-freezes the binary. The pin makes it structural, not conventional.
- **Hard cutover with no compatibility surface.** Rejected in round 8 because one shared symlink cuts over every project at once. Vindicated — the surface is what let the five migrations happen at the user's pace over two sessions.
- **Dropping the `ralph` symlink in round 8.** Rejected then, **now in scope** — the gate was "all projects migrated," and that condition is met as of this session.
- **Normalizing `RALPH_ANTHROPIC_API_KEY` to `ANTHROPIC_API_KEY`.** The prefix is load-bearing for Max-plan forcing (the loop blanks `ANTHROPIC_API_KEY`). The `CAIRN_`-prefixed name stays; only the legacy fallback goes.

**Carried from earlier sessions (still relevant):**
- **Per-task review files (`reviews/task-<id>.md`).** Not adopted; escape hatch if per-round files grow too long.
- **Agent-managed `state.json`** — rejected; no atomicity guarantee.
- **Store `nextTaskId` inside `tasks.json`** — rejected; separate `state.json` survives rewrites.
- **Audit agent writes `planning-notes.md` directly** — rejected; the planner owns formatting.
- **Separate `audit` CLI command instead of a slash command** — rejected; keeps the user in the planner session.
- **Anthropic TS SDK instead of shelling out to `claude`** — shelling out gives tools/permissions/MCP for free.
- **Port narration to TypeScript** — Kokoro TTS and sounddevice are Python-specific.
- **Skills instead of subagents** — subagents get fresh context with full tool access.
- **Change storage format (SQLite / per-task files / JSONL)** — CLI subcommands get ~95% of the benefit.
- **Pre-commit to git worktrees for parallel execution** — deferred to the RFC round.

## Rough Task Outline

### Phase B — soak (MANUAL, before the round)

- Run a real plan or `cairn run` cycle in **lyrical-pitch-reservations** — biggest behavioral change, newly installed agents, `state.json` lazy-seeds to 15 on first use.
- Run a real cycle in **karaoke-platform** — largest surface, narration hooks, 951-task archive.
- Confirm narration actually reaches `/tmp/cairn-tts.sock` if enabled in either.

### Phase C — removal round (MANUAL pre-step, then agent tasks)

**MANUAL pre-round:**
```
cp dist/cairn ~/.local/bin/cairn-frozen
ln -sf ~/.local/bin/cairn-frozen ~/.local/bin/cairn
# cairn.json, this round only:
#   "healthCheck": "bun build --target=bun src/index.ts --outfile /tmp/cairn-healthcheck"
```
Also commit or discard the two pending changes in this repo first (`test/index.test.ts`, `.cairn/state.json`).

1. **`src/utils.ts` — drop data-dir and temp-file fallbacks.** 7 markers: `findDataDir`, `findTempFilePath`, `allTempFilePaths`, `dataDirNameAt`, `warnIfLegacyDataDir`. Collapse resolvers to single-candidate. Update `test/utils.test.ts` (41 legacy refs). — `src/`, `test/`
2. **`src/config.ts` — drop config-file and API-key fallbacks.** 5 markers: `findConfigFile`, the three-way key chain → `CAIRN_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY`. Update `test/config.test.ts` (56 refs). — `src/`, `test/`
3. **`src/narration.ts` — drop socket and pid fallbacks.** 5 markers: `findNarrationSocketPath` (hook-file probing can go — all hooks now name the current socket), `findNarrationPidFile`. Update `test/narration.test.ts`. — `src/`, `test/`
4. **`src/commands/init.ts` — drop the legacy gitignore block and hook legacy paths.** 3 markers, including `GITIGNORE_LEGACY_HEADER` and the legacy temp-prefix entries. Update `test/commands/init.test.ts` (90 refs — the largest single test file). — `src/commands/`, `test/commands/`
5. **`src/commands/run.ts` — drop dual-prefix sweep and completion-flag probing.** 3 markers: `NOTES_TEMPFILE_RE` collapses to the current prefix, completion flag stops checking both names. Update `test/commands/run.test.ts`. — `src/commands/`, `test/commands/`
6. **Single-marker files sweep.** `task-archiver.ts` (2), `task-selector.ts`, `tasks-file.ts`, `post-task-reviewer.ts`, `index.ts`, `commands/edit.ts` — each one fallback. Update the matching tests. — `src/`, `src/commands/`, `test/`
7. **`lib/cairn_narrate_server.py` — drop the legacy API-key fallback.** 2 markers. — `lib/`
8. **Delete `cairn migrate`.** Remove `src/commands/migrate.ts`, `test/commands/migrate.test.ts` (47 refs), and the Commander registration in `src/index.ts`. — `src/commands/`, `src/`, `test/commands/`
9. **`install.sh` — drop the `ralph` symlink.** 2 markers. Update `test/install-script.test.ts`. — repo root, `test/`
10. **`src/brand.ts` — delete `LEGACY`, `warnLegacyOnce`, and `resetLegacyWarnings`.** Verified: every `warnLegacyOnce` call site is in `narration.ts` / `utils.ts` / `config.ts` (all deleted in tasks 1–3), and `resetLegacyWarnings` is called only from `test/{brand,utils,narration,config}.test.ts` (all rewritten in tasks 1–3). Zero surviving callers — all three go. Update `test/brand.test.ts`. **Must run after tasks 1–9.** — `src/`, `test/`
11. **Delete `test/legacy-markers.test.ts`.** Nothing left to enforce. **Must run after task 10.** — `test/`
12. **Docs.** `CLAUDE.md`: remove "Branding and the legacy layout", "The compatibility window", "The removal marker", "The `cairn migrate` command", and the temp-prefix/socket tier subsections; keep "Pin/unpin procedure" (generic, reusable). `README.md`: drop compatibility-window and `migrate` references. — repo root

**MANUAL post-round:**
- Restore `healthCheck` to `bun run build`; `./install.sh`; `rm ~/.local/bin/cairn-frozen`.
- **`rm ~/.local/bin/ralph`** — `install.sh` no longer creates it, but the existing symlink persists on disk.
- Verify `cairn --version` works and `ralph --version` reports command-not-found.
- Final sweep: `grep -rni ralph src/ lib/ test/ agents/ commands/ install.sh` should return nothing.

**Agent suitability:** `planner` suits tasks 1, 2, and 10 (resolver collapse and deletion ordering interact). Tasks 4–7 are mechanical sweeps for a generalist, though task 4's 90-ref test file is the round's biggest single edit. Task 12 suits `summarizer`.

## Open Questions

1. **`.prettierignore` for lyrical-pitch's `.claude/**`?** Cosmetic. Fixes perpetual reformat churn on installed agents, but that project only gets re-installed if `init` is re-run.
2. **Should the pin/unpin procedure stay in CLAUDE.md after the round?** Leaning yes — it's generic guidance for any self-modifying round, not tied to the rename.
3. **Stale long-lived shells** still export `RALPH_ANTHROPIC_API_KEY`. After task 2 lands, narration in those shells falls through to `ANTHROPIC_API_KEY` (blanked by the loop) and goes quiet. Worth restarting them, or accepting the quiet failure.
