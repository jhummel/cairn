## Context

Round 13 shipped `cairn init`'s permission seeding (tasks #80–#84). It wrote `.claude/settings.local.json` with two things: an **allow** list (read-only git inspection + the project's health check and test commands), which was the actual fix for the real problem — health checks and reviewer tests failing on missing permissions — and a **deny** list, `CAIRN_TASK_DENY_RULES` (`src/commands/init.ts:481`), covering the five mutating `cairn task` subcommands. The deny block was speculative hardening bolted onto the work that was needed, not a response to any observed incident.

The first `cairn run` in another repo after that change failed in a way that looked like three separate bugs:

- `tasks.json` never drained — every task stayed `pending`
- No `reviews/round-16.md` was ever written
- `.cairn_tasks_snapshot.json` showed as permanently modified

All three are one root cause. The deny rules are written into a **project-wide** settings file, so they bind *every* Claude session in the project — including `cairn run`'s own execution agents. Those agents could do the work but could not record it:

- `cairn task start` / `complete` → denied → task stays `pending`
- The loop re-reads `tasks.json`, sees `pending`, hands the same task to a fresh agent → **60 iterations on task #147 across two runs**, every one reporting SUCCESS
- `run.ts:692` gates the post-task reviewer on `updatedTaskStatus === 'complete'` → never fires → no round file
- Archival at `run.ts:706` finds nothing complete → `tasks.json` stays full

Iteration 1 genuinely implemented #147 (commits `e8231e4`, `556474c`); iterations 2–60 were handed the finished task back. Tasks #148+ were never reached. The snapshot issue is unrelated and cosmetic: it was committed in the same commit that added the ignore rule, and `.gitignore` does not apply to already-tracked files.

**Why this was invisible:** `.claude/settings.local.json` is gitignored (globally, via `~/.config/git/ignore`). It never appears in a diff, is never committed, and differs per machine and per repo. Nothing in `git status` could have shown it.

### The false premise

Both `init.ts:477-479` and CLAUDE.md asserted:

> `cairn run`'s execution agents are unaffected: they run with `--dangerously-skip-permissions`

**This is false.** `--dangerously-skip-permissions` suppresses *prompting*; it does not override an explicit deny. The same false belief is recorded in round 13's Rejected Alternatives ("denies are bypassed under `--dangerously-skip-permissions`") — it was never tested, and it propagated into a design decision.

### Empirical findings (this session)

Nine headless `claude -p` probes. Tests 2, 6, 7, 8 were confounded and are recorded so they are not re-run as evidence.

| # | Setup | Result |
|---|---|---|
| 1 | project deny + `--dangerously-skip-permissions` | **BLOCKED** — root cause confirmed |
| 2 | scoped `--allowedTools`, then `echo` | ran — **confounded**, `echo` is side-effect-free and auto-approved |
| 3 | deny via per-agent `--settings <file>`, no project deny | BLOCKED — per-agent deny is possible |
| 4 | no project deny + `--dangerously-skip-permissions` | ran — removing the block restores the loop |
| 5 | `--settings` with **inline JSON** | BLOCKED — no temp file needed |
| 6, 7 | writes outside cwd | **confounded** — blocked by the Bash *sandbox*, not by permissions |
| 8 | as 6, inside cwd but under `/tmp` | **confounded** — `/tmp` → `/private/tmp` symlink |
| 8b | non-allowlisted Bash write inside cwd, real path | **BLOCKED** |
| 9b | `Write` outside the granted `Edit(...)` scope | **BLOCKED** — *"non-interactive so I can't prompt"* |

**The governing rule: in headless `-p`, anything with side effects is deny-by-default unless allowlisted, because there is nobody to prompt.** Only side-effect-free commands pass. Test 2 proved nothing about `cairn task set-status`, which writes `tasks.json` and would be refused exactly as `touch` was in 8b.

**Therefore the deny rules were never load-bearing.** The reviewer's scoped `--allowedTools` (`post-task-reviewer.ts:163-171`) already prevented task-state mutation. The deny block defended a locked door, and the lock it added caught the only agents with a legitimate need to pass.

## Goals

1. Restore the loop — unblock this repo and every repo `cairn init` has poisoned
2. Delete the deny rules at the source so newly initialized repos are never affected
3. Add a tripwire so a stalled loop announces itself in ~3 iterations, not 60
4. Correct CLAUDE.md — the false premise is what made this invisible for a full round

## Approach

**Delete `CAIRN_TASK_DENY_RULES` outright.** Keep the allow rules, which were the genuine fix. This returns the permission model to the configuration that ran cleanly for 12 rounds, plus the allows.

Explicitly *not* doing the per-agent `--settings` scoping that Tests 3 and 5 proved feasible. It works, but it would preserve a guarantee we already have by default, at the cost of new machinery on every reviewer and planner spawn. Recorded under Rejected Alternatives with the evidence, so it can be revived if headless defaults ever change.

**The enforcement story, corrected.** After this round there are two real mechanisms, not three:

1. **The per-agent system prompt** ban — the only guard on execution agents, which run under `--dangerously-skip-permissions` and are constrained by nothing else. This was always true; the doc obscured it.
2. **Per-agent `--allowedTools` scoping**, effective *because* headless mode is deny-by-default (8b, 9b). This covers the reviewer and planner. The reviews-dir write scoping is genuinely real — 9b confirms it.

The third mechanism (project-wide deny rules) is deleted. `writeTasksFile()`'s atomic-replace-and-validate is unchanged and orthogonal.

**No chicken-and-egg.** The fix that unblocks a poisoned repo is a config edit, not code — delete the `deny` block from `.claude/settings.local.json` and the loop works immediately (Test 4). No build, no binary, no loop involvement. The deadlock exists only if you try to fix it *with* the loop. Because the file is gitignored and machine-local, the hand-edit needs no coordination.

**Stall guard.** Mirror the existing `REVERT_BLOCK_THRESHOLD` pattern in `run.ts`: if the same task is selected N consecutive iterations with no status change, block it, log loudly, move on. In-memory per-run counter, matching the precedent that a livelock only matters within a single run. This is the change that converts a silent 60-iteration burn into a visible error, and it is independent of the permission fix — see Open Questions on sequencing.

**Self-modifying round.** This round edits Cairn itself, and `~/.local/bin/cairn` symlinks straight to `dist/cairn` while `healthCheck` is `bun run build`. CLAUDE.md's pin/unpin procedure applies: pin the binary and redirect the health check to a throwaway outfile before starting.

**Round-specific hazard.** No task may run `cairn init` or `installClaudeSettings` against the project root. This round edits init's settings writer; exercising it against the real root rewrites the deny block into `.claude/settings.local.json` mid-round and re-breaks the loop from that iteration on — with no git diff to show for it, producing a failure identical to the one just debugged. Existing init tests are all `mkdtempSync`-isolated (`test/commands/init.test.ts:36`+); the new migration task is the one that must be told explicitly.

## Rejected Alternatives

**This session:**

- **Per-agent deny via `--settings`** (inline JSON on reviewer + planner spawns). Proven to work (Tests 3, 5) and was the plan until 8b/9b showed headless mode is already deny-by-default. Rejected as machinery preserving a guarantee we get for free. Revive only if headless defaults change.
- **Keeping the deny rules and exempting the loop some other way.** Rejected — deny wins on merge with no carve-out mechanism, and the premise that the reviewer needs this containment is disproven.
- **Manual removal only, no init migration.** Rejected — any repo initialized during the round-13 window stays silently broken, and the symptom is a loop that reports SUCCESS forever.
- **A `cairn doctor` command** for known-bad config states. Deferred — larger scope than this round; revisit if a second such state appears.
- **Halting the entire run on a same-task stall** rather than blocking the task and continuing. Rejected in favor of block-and-continue, matching `REVERT_BLOCK_THRESHOLD` precedent; a stall is recoverable and the remaining tasks are usually independent.
- **Dropping test execution from the reviewer's remit** so it needs no Bash grant at all. Moot once the deny rules are gone — the grant was never the problem.

**Corrected from round 13:**

- ~~"Grant broad `Bash(*)` with targeted denies — rejected because denies are bypassed under `--dangerously-skip-permissions`"~~ — **the stated reason was false** (Test 1: deny beats skip-permissions). The conclusion still stands on its other grounds: the reviewer needs no breadth. Keeping broad-allow rejected; the reasoning is replaced.
- **Blanket `Bash(cairn task:*)` deny.** Still rejected, now moot — it would break `cairn task next-id`, which task generation requires, and deny admits no exception. Retained because it documents why a "just deny everything" reflex fails.

**Carried forward (still relevant):**

- **Grant `Bash(find:*)`, `Bash(cat:*)`, `Bash(ls:*)`, `Bash(rg:*)`, `Bash(grep:*)`, `Bash(head:*)`, `Bash(wc:*)`.** Rejected — redundant with `Read`/`Glob`/`Grep`, and `find` is not read-only (`-delete`, `-exec rm`).
- **Write rules to `.claude/settings.json` (committed, team-wide).** Rejected — Cairn should not edit a git-tracked file affecting every teammate's plain `claude` sessions.
- **Cairn writes to global git excludes.** Rejected — reaching outside the repo is too invasive for an init step.
- **Truly runtime-configurable brand name.** Rejected on a bootstrap trap — discovery walks up looking for the data dir, so no fixed anchor would remain. `brand.ts` stays frozen.
- **Renaming `.ralph_task_*_notes.md`.** Rejected permanently — write-and-sweep scratch never read back; 24 are committed history in karaoke-platform.
- **Declaring task `tests` root-relative everywhere.** Rejected in round 12 — manifest-driven commands behave better from the task directory via upward walk.
- **Try-then-fall-back cwd** for test validation. Rejected — double-runs the suite, cannot distinguish "wrong cwd" from "real failure."
- **An explicit per-task `testCwd` field.** Rejected — pushes burden onto task generation, does nothing for existing task files.
- **Giving `healthCheck` the per-directory resolver.** Rejected — it is a single project-wide string. Root-only is correct.
- **Persisting the revert counter as a `Task` field.** Rejected — a livelock only matters within a single run.
- **Never normalize a resolved API key onto plain `ANTHROPIC_API_KEY`.** The loop blanks that name per-spawn to force Max-plan usage (`lib/cairn_narrate_server.py` ~line 224).
- **`BRAND` constants in test assertions.** Rejected as partly tautological.
- **Splitting a self-modifying round into batches with stop/rebuild/restart.** Rejected — many manual cycles, every boundary a chance to get ordering wrong.
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

**MANUAL pre-round (user) — required, in this order:**

1. Strip the `deny` block from `.claude/settings.local.json` in this repo. Unblocks the loop immediately; gitignored, so no commit or coordination.
2. `git rm --cached .cairn/.cairn_tasks_snapshot.json`
3. Pin the binary and set `cairn.json` `healthCheck` → `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` (uncommitted, round-only).
4. Do the same to the other affected repo: strip its `deny` block, `cairn task complete 147`, `git rm --cached` its snapshot. Tasks #148+ then flow — including #148, the renderer half of the `joinNext` fix.

**Round tasks** (each TDD — test written and failing before implementation, per project convention):

- **Stall guard** — `src/commands/run.ts`. If the same task is selected N consecutive iterations with no status change, block it with a diagnostic note and continue. In-memory per-run counter mirroring `REVERT_BLOCK_THRESHOLD` (`run.ts:656-675`). Tests in `test/commands/run.test.ts`. *Sequenced first — it is the tripwire for everything after it.*
- **Delete the deny rules** — `src/commands/init.ts`. Invert the existing assertions at `test/commands/init.test.ts:1287+`, watch them fail, then remove `CAIRN_TASK_DENY_RULES` and its use in `buildInitPermissionRules`. Delete the false `--dangerously-skip-permissions` rationale in the doc comment at `init.ts:466-480`.
- **Init migration** — `src/commands/init.ts`. On re-run, detect and strip a legacy `deny` block containing the five `cairn task` rules from an existing `settings.local.json`, preserving all other keys and any unrelated user deny entries. Report what was removed. ⚠️ Task description must state: **temp dirs only; never exercise this against the project root.**
- **Correct the enforcement story** — `CLAUDE.md`. Remove enforcement mechanism #3 and the false skip-permissions exemption. Replace with the two real mechanisms and the headless deny-by-default rule that makes #2 work. Note that execution agents are constrained only by their system prompt. Include the Test 1 / 8b / 9b findings so the premise is not re-derived from intuition.
- **Snapshot ignore hygiene** — `src/commands/init.ts` (or docs). Decide whether init should detect a tracked-but-ignored snapshot and warn. Small; drop if it complicates the migration task.

Directories: everything is `src/commands/` plus `test/`, except the CLAUDE.md task at the repo root. No cross-service work.

**MANUAL post-round:** re-run `./install.sh`, restore `healthCheck` to `bun run build`.

## Open Questions

- **Should the stall guard ship as its own round, before the permission fix?** Sequenced first within this round as a compromise. A separate round means the permission-fix round runs with a proven tripwire underneath it; the cost is an extra pin/unpin cycle. Unresolved — user's call before task generation.
- **Stall threshold: hardcoded or configurable?** `REVERT_BLOCK_THRESHOLD` is hardcoded and `cairn.json` already has `review.maxIterations` nearby. Leaning hardcoded at 3 for consistency; not settled.
- **Does "no status change" fully capture a stall?** A task legitimately in `in-progress` across iterations is normal. The signal is *selected repeatedly while still `pending`* — i.e. the agent never even called `cairn task start`. Worth pinning down the exact predicate during task generation.
- **How many other repos were initialized during the round-13 window?** Two known (this one, plus the `joinNext` repo). If there are more, the init migration is the only thing that will reach them.
- **Does the reviewer need a regression test** proving it *cannot* mutate task state, now that the deny rules are gone and the guarantee rests on headless defaults? A test asserting the absence of `cairn task` in its `--allowedTools` would catch a future widening.
