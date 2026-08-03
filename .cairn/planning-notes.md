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
- **Soak done via karaoke-platform** (round 32 → 33, real work committed post-migration). lyrical-pitch-reservations remains unsoaked — the one project whose migration was an *upgrade* rather than a rename.
- Removal surface measured: **36 markers across 15 source files** (`src/utils.ts` 7, `src/narration.ts` 5, `src/config.ts` 5, `run.ts`/`init.ts` 3 each, `install.sh` and the Python server 2 each, six files with 1). The test surface is larger — ~20 test files, led by `init.test.ts` (90 legacy refs), `config.test.ts` (56), `migrate.test.ts` (47), `utils.test.ts` (41).
- **No `Bash(ralph:*)` permission rules exist in any project**, so dropping the symlink causes no permission friction in interactive sessions.

## Goals

1. **Remove the compatibility surface entirely** — all 36 markers, `LEGACY`, the dual symlink, `cairn migrate`, and the marker-enforcement test. (The soak that gated this is complete; see Approach.)
2. Keep the historical record intact — archives, review files, iteration logs, and committed task notes still contain `ralph` and must not be rewritten.
3. Leave `brand.ts` as the single source of truth, minus `LEGACY`.

## Approach

- **Soak — DONE.** karaoke-platform ran a full round post-migration (round 32 → 33, real work committed). That is the largest surface: 951-task archive, narration hooks, full agent set. lyrical-pitch-reservations was *not* soaked (still no `state.json`, last commit is its migration) — accepted, because every project is now on `.cairn/` and the fallbacks being deleted are unreachable regardless.

- **Pin the binary for the removal round — DONE.** `~/.local/bin/cairn` → `~/.local/bin/cairn-frozen` (a real 59MB copy, not a link, so no rebuild can reach it). Milder hazard than round 8 (cairn is already on `.cairn/`, so deleting legacy paths shouldn't break its own reads) but the default `healthCheck: bun run build` writes `dist/cairn` — the live binary every agent calls via `cairn task` — so a bad intermediate build would go live mid-round without the pin.

- **Health check redirected to a throwaway outfile — DONE.** `cairn.json` now holds `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`. This is the real build command with only the outfile changed, so it validates exactly what `bun run build` does without touching `dist/`. Deliberately **not** round 8's `bun build --target=bun …` form: that produces a plain bundle rather than a standalone executable, so a compile-step failure would pass the check and only break after unpinning. The 155ms difference is not worth the gap.

- **`cairn.json` and `install.sh` build output are user-managed for the round.** The `healthCheck` value above is a deliberate, uncommitted, round-only change. No task may "restore" it, and no agent may run `./install.sh` — either would un-freeze the binary mid-round. Task 9 edits `install.sh`'s symlink block only; it must leave the build command alone.

- **Ordering is load-bearing, three times** (corrected during task generation — the first draft of these notes got two of them wrong):
  - **`src/utils.ts` cannot go first.** `findTempFilePath` / `allTempFilePaths` have five external callers — `task-selector.ts`, `tasks-file.ts`, `task-archiver.ts`, `commands/run.ts`, and `commands/logs.ts` (the last missing from the first draft entirely, because it carries no marker — it never spells `ralph`). Deleting the exports first breaks the build, and the health check runs *before every iteration*, so the loop stalls immediately. It runs after the caller-migration tasks.
  - **`test/legacy-markers.test.ts` deleted immediately BEFORE `brand.ts`, not after.** The first draft had this backwards. Killing `LEGACY` forces a hardcoded `.ralph_` literal for the permanent notes-scratch exception; that is an unmarked `ralph` mention, so the markers test fails the moment the `brand.ts` task lands — leaving it with a red suite and getting it reverted to `in-progress` by the post-iteration validator. The original rationale survives the inversion: earlier tasks only *remove* marked mentions and can never introduce an unmarked one, so the guardrail has no work left by then.
  - **`src/brand.ts` last among source changes.** Every fallback reads `LEGACY`; deleting it first breaks the build everywhere at once.

- **The `.ralph_task_<id>_notes.md` scratch exception is more load-bearing than the first draft assumed.** `run.ts:52` builds the agent-facing path from `LEGACY.tempPrefix`, and `TEMP_IGNORE_SUFFIXES` includes `task_*_notes.md`, so `ignoreBlock(LEGACY.tempPrefix)` is what keeps that scratch gitignored. Two first-draft instructions were wrong and are corrected in the tasks: `NOTES_TEMPFILE_RE` must **keep** matching the legacy prefix (collapsing it leaks scratch into every data dir forever), and the legacy gitignore block must **keep exactly one line** (dropping it wholesale un-ignores an actively written file — the mechanism behind karaoke-platform's 24 committed scratch files). The prefix is rehomed to a `NOTES_TEMP_PREFIX` constant in `brand.ts`, explicitly *not* a compatibility fallback.

- **Narration's hook-file probe stays.** The first draft said it could go since all hooks now name the current socket. Decided otherwise: it carries no removal marker (the markers there target only the `LEGACY.socket`/`pidFile` candidates), it is the mechanism that binds the server where the hooks actually dial rather than a compat fallback, and removing it would collapse the `RunRunDeps.findNarrationSocketPath` injection seam for no benefit.

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

### Phase B — soak: COMPLETE

karaoke-platform ran round 32 → 33 post-migration with real work committed. lyrical-pitch-reservations was not soaked; accepted as a known gap (see Approach).

### Phase C — removal round

**MANUAL pre-round — ALL COMPLETE:**
- `~/.local/bin/cairn` → `~/.local/bin/cairn-frozen` (pinned) ✅
- `cairn.json` `healthCheck` → `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` (uncommitted, round-only) ✅
- Working tree otherwise clean; the earlier `test/index.test.ts` fix is committed (`02e7b1f`), suite green at 862 pass / 0 fail ✅

The tasks below are the round proper.

**`.cairn/tasks.json` is authoritative** — generated from this outline and corrected against the code. It expanded to **15 tasks (IDs 51–65)**; the summary below reflects what was actually generated, not the 12-item first draft.

| ID | Task | Model | Agent | Deps |
|---|---|---|---|---|
| 51 | `src/config.ts` — drop `ralph.json` + `RALPH_ANTHROPIC_API_KEY` legs | opus | planner | — |
| 52 | `src/narration.ts` — drop legacy socket/pid candidates (keep the hook probe) | opus | — | — |
| 53 | `src/commands/init.ts` — drop legacy gitignore block, **keep the notes-scratch line** | opus | — | — |
| 54 | `test/commands/init.test.ts` — cosmetic fixture rename (~70 refs) | sonnet | — | 53 |
| 55 | `src/commands/run.ts` — completion flag + temp-file cleanup (**not** the notes regex) | opus | — | — |
| 56 | Temp-file read callers → `tempFilePath` (4 files, incl. `commands/logs.ts`) | sonnet | — | — |
| 57 | Comment-only caveats (`post-task-reviewer`, `index`, `edit`) | sonnet | — | 51 |
| 58 | `src/utils.ts` — collapse data-dir tier, delete temp resolvers | opus | planner | 55, 56 |
| 59 | `lib/cairn_narrate_server.py` — drop `RALPH_` env legs | sonnet | — | — |
| 60 | Delete `cairn migrate` | sonnet | — | — |
| 61 | `install.sh` — drop the `ralph` symlink | sonnet | — | — |
| 62 | Delete `test/legacy-markers.test.ts` | sonnet | — | 51–61 |
| 63 | `src/brand.ts` — delete `LEGACY`, rehome `NOTES_TEMP_PREFIX` | opus | planner | 62 |
| 64 | Cosmetic test-fixture sweep (7 files, ~75 refs) | sonnet | — | 63 |
| 65 | Docs — `CLAUDE.md`, `README.md`, `docs/parallel-execution-rfc.md` | sonnet | summarizer | 63 |

Three additions the first draft missed: `src/commands/logs.ts` as an unmarked caller of `findTempFilePath`; the ~75 cosmetic `.ralph` fixture refs across seven test files (task 64); and the split of `init.test.ts` (1381 lines) into behavioral vs. mechanical halves.

**MANUAL post-round:**
- Restore `healthCheck` to `bun run build`; `./install.sh`; `rm ~/.local/bin/cairn-frozen`.
- **`rm ~/.local/bin/ralph`** — `install.sh` no longer creates it, but the existing symlink persists on disk.
- Verify `cairn --version` works and `ralph --version` reports command-not-found.
- Final sweep: `grep -rni ralph src/ lib/ test/ agents/ commands/ install.sh | grep -v NOTES_TEMP_PREFIX`. This **cannot** be empty — the permanent notes-scratch exception requires one `.ralph_` literal in `src/brand.ts` plus its assertion in `test/brand.test.ts`. Expect exactly those two and nothing else.

## Open Questions

1. **`.prettierignore` for lyrical-pitch's `.claude/**`?** Cosmetic. Fixes perpetual reformat churn on installed agents, but that project only gets re-installed if `init` is re-run.
2. **Should the pin/unpin procedure stay in CLAUDE.md after the round?** Leaning yes — it's generic guidance for any self-modifying round, not tied to the rename.
3. **Stale long-lived shells** still export `RALPH_ANTHROPIC_API_KEY`. After task 2 lands, narration in those shells falls through to `ANTHROPIC_API_KEY` (blanked by the loop) and goes quiet. Worth restarting them, or accepting the quiet failure.
