## Context

Round 9 (the Ralph→Cairn compatibility-removal round) is finished. Verified this session:

- **Removal is genuinely complete.** `grep -rni ralph src/ lib/ install.sh agents/ commands/` returns exactly three hits: `src/brand.ts:41` (`NOTES_TEMP_PREFIX = '.ralph_'`) and its two explanatory comments in `src/commands/run.ts` (362, 708). That is the permanent notes-scratch exception and nothing else.
- **Suite green**: `bun test` → 799 pass / 0 fail across 29 files. `bun run build` → clean (108 modules).
- **Post-round manual steps are done.** `cairn.json`'s `healthCheck` is back to `bun run build`; the binary is unpinned and rebuilt from the current tree; `~/.local/bin/ralph` has been removed (only `cairn` remains).
- **Task #66 was stuck `in-progress` and has been set to `complete` by the user.** It still sits in `tasks.json` — archival happens inside the run loop, so the next `cairn run` will move it to `tasks.completed.json` on its first iteration. State is `{ nextTaskId: 69, round: 9 }`.

### Why #66 got stuck — and why it is a class of bug, not a one-off

`src/test-validator.ts` ran a task's root-relative `tests` entries from `<root>/<task.directory>`. For #66 (`directory: "src"`), `bun test test/config.test.ts` matched nothing, exited 1, and the stderr matched none of `CANT_RUN_PATTERNS` — so `isCantRunError()` returned false, it was classified as a real test failure, and a finished task was reverted to `in-progress`. Because `selectNextTask` (`src/task-selector.ts:48`) returns any `in-progress` task ahead of all pending work, the loop re-picked #66 every iteration: a livelock across three iterations. Iteration 18 only escaped because the agent deliberately broke the one-task rule to go fix the cwd bug (#68) instead.

Task #68 fixed the cwd for both `runHealthCheck` and `validateTaskTests` by pinning them to `projectRoot`. Correct for `healthCheck` (one project-wide string in `cairn.json`); **too blunt for task `tests`**, and it left three things unaddressed — see Goals.

### Measurements taken this session (these drive the design)

Run from `<root>/src` with a root-relative command:

| Command | Exit | Behavior |
|---|---|---|
| `npm test` | 0 | npm walks **up**, finds root `package.json`, runs the full 799-test suite |
| `bun run build` | 0 | same upward walk; script paths resolve from the manifest's dir, not cwd |
| `bun test test/config.test.ts` | 1 | filter matched nothing — `Tests need ".test", "_test_"...` |
| `bun build --compile src/index.ts` | 1 | `FileNotFound opening root directory "src"` |

Conclusion: **manifest-driven commands already self-resolve via upward walk**; only **path-argument** commands break, and only because the path was written root-relative. Neither failing stderr matches `CANT_RUN_PATTERNS` (`src/test-validator.ts:19`) — `filenotfound` has no space, so the existing `'not found'` pattern misses it.

### Round-8 review gaps still outstanding

`.cairn/reviews/round-8.md` closed with several `HAS_GAPS` verdicts. Re-verified against the current tree; these are still live:

- **`CLAUDE.md` documents a health check that does not exist.** The Conventions bullet claims *"The health check must pass `--target=bun`"*, and the pin/unpin section repeats that command twice more. The real build is `bun run build` → `bun build --compile src/index.ts --outfile dist/cairn`. Round 9 explicitly **rejected** the `--target=bun` form because it emits a plain bundle and would let a compile-step failure pass the check.
- **`CLAUDE.md` lost the CREATE-vs-RESOLVE standing rule** (task #65's flagged gap). `findDataDir`/`findConfigFile` descriptions were deleted wholesale rather than rewritten. Both functions are live (`src/utils.ts:36`, `src/config.ts:12`), and `src/brand.ts`'s own doc comment still points readers to CLAUDE.md for a rule that no longer appears there.
- **`src/commands/init.ts` describes deleted machinery.** Lines 12 and 328 discuss `cairn migrate` in present tense; the `GITIGNORE_CONTENT` comment cites a CLAUDE.md section ("The temp-file prefix — a second naming tier") that #65 deleted. `TEMP_IGNORE_SUFFIXES`, `GITIGNORE_CURRENT_HEADER`, and `ignoreBlock` are exported solely for migrate — **verified zero consumers in `src/` or `test/` outside `init.ts`**, so they can be made module-private.
- **`src/post-task-reviewer.ts:143-146` is self-contradictory.** Task #57 applied a literal instruction that broke the sentence: it now warns that hardcoding `.cairn/reviews/**` "on a project that actually lives in `.cairn/`" causes silent denial. That is not a mismatch, so the comment no longer supports its own conclusion — and the invariant it guards is load-bearing.
- **`src/narration.ts` carries a dead injection seam.** `PathProbeDeps` is unused (`_deps` at :37 and :52), and two test titles imply a liveness check that is no longer performed. `src/utils.ts:36` `findDataDir` is likewise an unconditional join. Note the `RunRunDeps.findNarrationSocketPath` seam (`test/commands/run.test.ts:1434`) is a **different** seam and must survive.
- **`commands/generate-tasks.md:120` contradicts the code.** It still tells the planner *"tests: array of test commands to verify the task (run from the task's directory)"*, which #68 made false.

## Goals

A pure cleanup/consolidation round. No new features.

1. **Make a wrong cwd non-fatal.** Fix the cwd resolution *and* the misclassification *and* the livelock — three independent layers, so that no single one of them can silently revert finished work again.
2. **Make the docs describe the code that exists** — CLAUDE.md's health check and standing rule, and `generate-tasks.md`'s test-cwd contract.
3. **Delete the last references to machinery removed in round 9** — migrate-era comments and exports, the broken reviewer comment, the dead narration seam.

## Approach

### The three-layer fix for the stuck-task bug

**Layer 1 — classifier (`src/test-validator.ts`).** Broaden `isCantRunError`: add `filenotfound`, bun's non-matching-filter message, and a zero-tests-ran check. A command that ran no tests is never a real failure. This is the highest-value change in the round and is valuable *independent* of the cwd work: with it, any future cwd or environment mistake degrades to "note it, don't revert" instead of reverting completed work.

**Layer 2 — per-command cwd resolution (`src/test-validator.ts`).** Default the cwd to the task directory; scan each command for path-shaped arguments; if any fail to resolve from the task dir but do resolve from the project root, run **that command** from the root. Deterministic pre-flight, decided before anything runs.

- Resolve **per command, not per task** — a task can legitimately mix `["npm test", "npx tsc -p tsconfig.json"]`.
- Running manifest-driven commands from the task dir is *strictly better* than root: in a multi-service repo they find the service's own `package.json`; in a single-package repo they walk up to root and behave identically. There is no case where root-cwd wins for that shape.
- Keep the resolver private to `test-validator.ts`. `health-check.ts` stays root-only — #68 was right there.

**Layer 3 — break the livelock (`src/commands/run.ts`).** Count consecutive validation reverts per task, in memory, for the duration of the run. At 2, set the task `blocked` with an explanatory note and let the loop move on.

- `blocked` is already fully plumbed: `src/tasks-schema.json`, `src/types.ts:23` validation, `cairn task set-status`, the `status` display (`1 blocked`), and `selectNextTask` already ignores blocked tasks. The only new code is the counter and the summary.
- **The completion flag needs attention.** `src/commands/run.ts:131` tells agents to create the flag when `tasks.json` has "no remaining pending/in-progress tasks." A `blocked` task is neither — so the flag fires and the run prints "All tasks complete!" with a blocked task sitting there. The run summary must report blocked tasks distinctly, or layer 3 trades a visible livelock for a silent drop.

### This is a self-modifying round — pin per CLAUDE.md's procedure

Tasks 1–3 change `test-validator.ts` and the run loop, and `healthCheck: bun run build` writes `dist/cairn` — the live binary every agent shells out to for `cairn task complete`. A bad intermediate build would go live mid-round and corrupt task bookkeeping. Follow the standard procedure:

- Freeze `~/.local/bin/cairn` (copy aside, not a link).
- Redirect `healthCheck` to `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` — the real command with only the outfile changed, uncommitted and round-only.
- Restore both manually after the round.

**The trap to avoid:** task 5 documents the health-check command *while it is pinned to a throwaway value*. Its description must say explicitly: document the **real** value (`bun run build`), and do **NOT** touch `cairn.json`'s `healthCheck` — it is user-managed for the round. This is exactly the failure round 9 hit, where the pin got swept into task #56's commit and became permanent git history.

### Standing conventions carried forward

- **TDD within each task** — write/adjust the test, watch it fail, make it pass. Test updates fold into the source task they cover, never a separate task.
- **Test assertions stay literal** (`'.cairn'`, `'cairn.json'`) rather than importing `BRAND`.
- **History is never rewritten.** `tasks.completed.json`, `.cairn_iterations.log`, `.cairn_tasks_snapshot.json`, `reviews/round-*.md`, `.ralph_task_*_notes.md`, and `audit/` keep their existing content, including `ralph` references.

## Rejected Alternatives

**This session:**

- **Option (a): declare tests root-relative everywhere and just fix the doc.** Rejected on the measurements above — manifest-driven commands get strictly better behavior from the task directory, and pinning to root permanently punishes multi-service repos (karaoke-platform, the reservation projects) where `npm test` in a service dir is the natural thing a planner writes.
- **Try-then-fall-back cwd** (run in the task dir, re-run at root on failure). Rejected — it double-runs the suite (slow, side-effecting), and it cannot distinguish "wrong cwd" from "real failure," which is precisely the discrimination that already failed and caused this bug.
- **An explicit per-task `testCwd` field** (or `tests` entries as objects). Rejected — pushes the burden onto task generation, adds schema surface, and does nothing for task files already generated in other projects.
- **Give `healthCheck` the same per-directory resolver.** Rejected — it is a single project-wide string in `cairn.json`, not a per-task value. #68's root-only fix stands.
- **Persist the revert counter as a `Task` field.** Rejected — would need `types.ts`, `tasks-schema.json`, and `generate-tasks.md` changes for no benefit; a livelock only matters within a single run, so an in-memory per-run counter is sufficient and resets naturally on restart.
- **Fix only the cwd bug, skip the classifier.** Rejected — the classifier miss is the general failure. Any wrong cwd, missing dep, or environment problem whose stderr happens not to match six hardcoded substrings will silently revert finished work. The cwd fix closes one instance; the classifier closes the class.
- **Skip the pin because "the changes are small."** Rejected — every agent shells out to `cairn task` against the live `dist/cairn`. The blast radius of a bad mid-round build is corrupted task bookkeeping, not a failed build.

**Carried forward (still relevant):**

- **Truly runtime-configurable brand name.** Rejected on a bootstrap trap — discovery walks up looking for the data dir, so if both the dir name and the config filename come from config, no fixed anchor remains. Near-zero payoff. `brand.ts` stays a frozen constant.
- **Renaming `.ralph_task_*_notes.md`.** Rejected permanently — write-and-sweep scratch that is never read back, and 24 are committed history in karaoke-platform. It stays under `NOTES_TEMP_PREFIX` forever; this is a documented exception, not a leftover.
- **Never normalize a resolved API key onto plain `ANTHROPIC_API_KEY`.** The loop deliberately blanks that name per-spawn to force Max-plan usage. The invariant now lives in `lib/cairn_narrate_server.py` (~line 224), which is the single remaining implementation of the resolution chain.
- **`BRAND` constants in test assertions.** Rejected as partly tautological — a wrong `brand.ts` value would still pass.
- **Mixed test style** (literals for contracts, `BRAND` for incidentals). Rejected — per-test judgment for little gain.
- **Splitting a self-modifying round into batches with stop/rebuild/restart between each.** Rejected — 4–5 manual cycles, every boundary a chance to get ordering wrong. Pinning achieves the same safety with two setup commands.
- **Redirecting the health check without also pinning the binary.** Rejected — any stray `bun run build` silently un-freezes it. The pin makes the guarantee structural rather than conventional.
- **Rewriting archives during a sweep.** Rejected — falsifies history.
- **Per-task review files (`reviews/task-<id>.md`).** Not adopted; escape hatch if per-round files grow too long.
- **Agent-managed `state.json`** — rejected; no atomicity guarantee.
- **Store `nextTaskId` inside `tasks.json`** — rejected; a separate `state.json` survives rewrites.
- **Audit agent writes `planning-notes.md` directly** — rejected; the planner owns formatting.
- **Separate `audit` CLI command instead of a slash command** — rejected; keeps the user in the planner session.
- **Anthropic TS SDK instead of shelling out to `claude`** — shelling out gives tools/permissions/MCP for free.
- **Port narration to TypeScript** — Kokoro TTS and sounddevice are Python-specific.
- **Skills instead of subagents** — subagents get fresh context with full tool access.
- **Change storage format (SQLite / per-task files / JSONL)** — CLI subcommands get ~95% of the benefit.
- **Pre-commit to git worktrees for parallel execution** — deferred to the RFC round.

## Rough Task Outline

**MANUAL pre-round (user):**
- `cairn task complete 66` ✅ done (still awaiting archival by the next run loop)
- `rm ~/.local/bin/ralph` ✅ done
- Freeze `~/.local/bin/cairn` → `~/.local/bin/cairn-frozen` (real copy, not a link)
- `cairn.json` `healthCheck` → `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` (uncommitted, round-only)

**Validation & loop correctness** — 1 and 2 both touch `src/test-validator.ts`, so they must run in order.

1. **`src/test-validator.ts` — broaden `isCantRunError`.** Add `filenotfound`, bun's non-matching-filter stderr, and a zero-tests-ran check to `CANT_RUN_PATTERNS`/the classifier. TDD against `test/test-validator.test.ts`. *(dir: `src`)*
2. **`src/test-validator.ts` — per-command cwd resolution.** Default to the task directory; detect root-relative path arguments and run those commands from the project root. Resolver stays private to this module; `health-check.ts` unchanged. TDD. *(dir: `src`, deps: 1, agent: `planner`)*
3. **`src/commands/run.ts` — consecutive-revert guard + summary.** In-memory per-task revert counter; at 2, set `blocked` with a note and continue. Make the run summary distinguish blocked tasks from "all complete," including when the completion flag fired. TDD against `test/commands/run.test.ts`. *(dir: `src`, agent: `planner`)*
4. **`commands/generate-tasks.md:120` — rewrite the `tests` description** to match the resolver: commands run from the task's directory, with root-relative path arguments detected and run from the project root, so either form works. *(dir: `commands`, deps: 2)*

**Docs truth-up**

5. **`CLAUDE.md` truth-up.** Fix the `--target=bun` claim in all three places (Conventions bullet, pin/unpin intro, pin/unpin step 2) to `bun run build` / `bun build --compile src/index.ts --outfile dist/cairn`. Restore the `findDataDir`/`findConfigFile` descriptions and the CREATE-vs-RESOLVE standing rule deleted by #65. **Must document the real `healthCheck` value, not the round's pinned throwaway; must not edit `cairn.json`.** *(dir: project root)*

**Dead references to removed machinery**

6. **`src/commands/init.ts` — migrate-era cleanup.** Fix the present-tense `cairn migrate` comments at :12 and :328; drop the pointer to the deleted CLAUDE.md section in the `GITIGNORE_CONTENT` comment; make `TEMP_IGNORE_SUFFIXES`, `GITIGNORE_CURRENT_HEADER`, and `ignoreBlock` module-private (verified zero consumers in `src/` or `test/` outside this file). *(dir: `src`)*
7. **`src/post-task-reviewer.ts:143-146` — repair the allowlist comment.** Restore a genuine mismatch example, or rewrite so the illustration actually supports the silent-denial conclusion. Comment-only; the `reviewFileRule`-derived-from-`reviewsDir` mechanism must not change. *(dir: `src`)*
8. **`src/narration.ts` + `src/utils.ts` — retire the dead probe seam.** Delete the unused `PathProbeDeps` seam (`_deps` at :37, :52) or restore real existence checks; fix the two misleading test titles in `test/narration.test.ts`; decide the same question for `findDataDir` (`src/utils.ts:36`). **The `RunRunDeps.findNarrationSocketPath` seam (`test/commands/run.test.ts:1434`) is a different seam and must survive.** *(dir: `src`)*

**MANUAL post-round:**
- Restore `healthCheck` to `bun run build`; `./install.sh`; `rm ~/.local/bin/cairn-frozen`.
- Verify `cairn --version` and confirm the archival of #66 happened on the round's first iteration.
- Smoke-test the fix in a multi-service repo: a task with `directory: src/services/<svc>` and `tests: ["npm test"]` should run that service's suite, not the root's.

## Open Questions

1. **Should the pin/unpin procedure stay in `CLAUDE.md` long-term?** Carried from round 9, still unresolved. Leaning yes — it is generic guidance for any self-modifying round, not tied to the rename. Task 5 touches that section, so this is the natural moment to decide.
2. **What counts as a "path-shaped argument" for task 2's resolver?** Anything containing `/`, or also bare filenames like `foo.test.ts`? A too-narrow rule misses `bun test config.test.ts`; a too-broad one misclassifies flags and package names. Task 2 should settle this explicitly and pin it with tests.
3. **Should the revert threshold be 2, or configurable?** Fixed at 2 in the outline. A `cairn.json` knob is easy to add later if 2 proves wrong, but adding it now is speculative.
