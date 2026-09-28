## Context

**Round 19 planning session (2026-09-27).** The session reviewed the round-18 review log, `.cairn/reviews/round-18.md`, and decided to remove narration and ntfy.

**Round 18 is done.** Tasks #131–#137 are archived and `tasks.json` is empty. `state.json` is at `nextTaskId: 138, round: 19`. The suite is 1234 pass / 0 fail, and `bun run typecheck` covers `src/` and `test/`. No `planning-notes.md` was written for round 18: its tasks came straight from the round-17 review findings (commit b3af80c). Round 18 delivered:
- #131: the shared round-end sweep, `sweepRoundTempFiles` (`src/temp-sweep.ts`), called from `cairn round next`'s `round-done` branch and from `cairn run`'s loop exit
- #132: the `init` gitignore merge honors `!` opt-outs, and an unreadable `.gitignore` no longer aborts init
- #133: separate resolvers for the hook's decision and its error log
- #134: a test that pins the contents of `REVIEWER_DISALLOWED_BASH_RULES`
- #135: `tsconfig.json` uses `noEmit: true` in place of `outDir`
- #136: test cleanups
- #137: docs

**State of the working tree at session start:**
- The binary is **still pinned from round 18**: `~/.local/bin/cairn` is a regular file built at 16:04 on 2026-09-19.
- `cairn.json`'s `healthCheck` still points at `/tmp/cairn-healthcheck`.
- The round-18 files are uncommitted: `tasks.json`, `tasks.completed.json`, `state.json` and `reviews/round-18.md`.
- The CANARY-17 line has been removed from `CLAUDE.local.md`. Its token appeared in every round-18 completion note, so **custom agent types (`cairn-task-agent`) do load `CLAUDE.local.md`**.

**Why `.cairn/` is full of scratch files.** The data dir still holds the prompt, review-prompt, tests-log and `.ralph_task_*_notes.md` files for #131–#137, plus `.cairn_prev_notes` and `.cairn_completed_ids`. The #131 sweep would have removed them all, but the pinned binary predates #131 (the pin was at 16:04; #131 was committed at 18:19). The round-end `cairn round next` ran old code. This is a general hazard of self-modifying rounds: **round-end behavior added during a round never runs at that round's end, because the pinned binary is older.** No new cleanup feature is needed, only a procedure step (see Approach).

### Round-18 review findings, sorted

**Fixing this round:**
1. **(#137 gap)** `CLAUDE.md:76` gets the notes-file prefixes backwards. It calls `.cairn_` "the legacy `.cairn_` spelling", but `.cairn_` is `BRAND.tempPrefix`, the current prefix, which the sweep covers only as a precaution. The permanent pre-rename spelling is `.ralph_` (`NOTES_TEMP_PREFIX`). Fix: "the defensive `.cairn_` spelling".
2. **(#131 risk)** The round-end sweep deletes `task_<id>_tests.log` for **blocked** tasks too, so the diagnostics for the tasks that the `round-done` verdict flags are lost. Only the 300-char `summarizeFailure` note and `failureTail` survive.

**Accepted; no task:**
3. **(#134 gap)** The `Bash(*--out*)` re-probe is recorded only as a dated doc comment in `src/claude-settings.ts`, with no harness to reproduce it, and the five rules were never probed together. **Decision: the doc comment is enough.** The rules are independent substring matches, so combining them can only deny more.
4. **(#134 risk)** The `toEqual` test on `REVIEWER_DISALLOWED_BASH_RULES` fails whenever a rule is added. This is deliberate and fails loudly.
5. **(#135 note)** `test/tsconfig.test.ts` uses `JSON.parse`, so converting `tsconfig.json` to JSONC would throw rather than fail an assertion.
6. **(#135 risk)** CLAUDE.md still described `outDir`. Already closed by #137.

**Known limits, recorded as observations:**
- **(#132)** Gitignore matching is exact-string, so `!/.cairn_iterations.log` (with a leading slash) doesn't count as an opt-out. The positive side has the same limit.
- **(#132)** A merge failure is reported on stderr, while `installClaudeSettings` reports through `log` (stdout).
- **(#132)** A `.gitignore` that is a directory (EISDIR) is caught by construction but has no test.
- **(#133)** The hook error log can name a different project than the tool call's. The logged line includes the failing path. Keep this in mind when triaging `round next` warnings.
- **(#133)** `resolveHookErrorLogDir` resolves both candidates eagerly. This is on the error path only.
- **(#136)** Seven other log mocks in `run.test.ts` still join every argument.
- **(#137)** Old `.ralph_complete` / `.ralph_prev_notes` / `.ralph_completed_ids` files in pre-rename projects are never swept.

**Process pattern:** In 5 of the 7 reviews, TDD came back **[PARTIAL]**, because each task landed as one commit and the red-then-green order couldn't be checked. **Decision:** the user adds a line to `CLAUDE.local.md` telling agents to record the failing test command and its failure line, from before the fix, in `cairn task complete --notes`. The reviewer already reads `CLAUDE.local.md`, so this needs no Cairn code change.

### Narration and ntfy

- **Narration** (Kokoro TTS over a Unix socket) is unused.
  - `cairn.json` has `narration.enabled: false`.
  - The footprint is about 1,300 lines deleted outright, plus changes in `run.ts`, `stream-filter.ts`, `init.ts`, `config.ts`, `types.ts`, `brand.ts`, `index.ts` and about 10 test files.
- **ntfy** lives inside the narration config (`narration.ntfyTopic`) and in `stream-filter.ts` (`sendNtfy`). It fires only under headless `cairn run`.
- The user decided to remove both, because Claude Code now has built-in notifications.

## Goals

1. Keep a blocked task's test log through the round-end sweep.
2. Remove narration completely: the TTS server, the Python scripts, the `cairn narrate` command, the socket hooks, the config and the docs.
3. Remove ntfy completely.
4. Fix the one doc inversion (item 1). Add a procedure step so round-end behavior added during a self-modifying round runs once after unpinning.
5. Clear the scratch files left in `.cairn/` by rounds 18 and 19.

## Approach

### Run mode

Run under `/cairn-run`, pinned. Tasks 2–4 edit `run.ts`, `init.ts`, `index.ts` and `brand.ts`, and task 1 edits the sweep, so the pin procedure applies. **Re-pin from the current HEAD** rather than keeping round 18's stale binary. The round-19 binary then includes #131, so round 19's own `round-done` sweep clears the round-18 and round-19 scratch files. It will not include task 1's blocked-log exception; see post-round step 3.

### Sweep: keep blocked tasks' test logs

- `sweepRoundTempFiles` skips `task_<id>_tests.log` when task `<id>` has status `blocked` in `tasks.json`.
- Every other file is swept as today, including that task's `_prompt.md`, `_review_prompt.md` and notes file, which don't help diagnose a failure.
- **Best-effort both ways:** if `tasks.json` can't be read, **keep all** `_tests.log` files rather than delete them. The sweep still must never throw or change a verdict.
- **Lifetime of a kept log:** it goes at the first round end after the task is no longer blocked. If the task re-runs first, validation overwrites it.
- The `cairn run` call site passes injected fs deps, so the blocked lookup must go through them, or through an injectable reader, so the mocked-fs tests still apply.

### Removal ordering (why four tasks, in this order)

Each task must leave `bun run typecheck` and `bun test` green:
1. Remove the **consumers** in `run.ts` and `stream-filter.ts` first, while the modules and config still exist.
2. Then delete the **modules** (`narration.ts`, `commands/narrate.ts`, `lib/`).
3. Then remove **config, types, `init` and `BRAND.socket`/`pidFile`**. `init.ts`'s embedded hook scripts reference `BRAND.socket`, so the brand constants go in the same task as the hook scripts.
4. Docs last.

### Old configs must keep loading

A `cairn.json` that still has a `narration` block, as this repo's does until the manual cleanup and many other projects' will, must load without error or warning; the loader ignores the key. `isCairnConfig` must stop requiring `narration`. Pin both with tests.

### Other projects' hook scripts

`cairn init` used to write `.claude/hooks/{narrate,speak,notify}.sh` into target projects, without registering them in settings. The scripts exit 0 when `/tmp/cairn-tts.sock` is missing, so leftovers are inert. **No cleanup migration.** This repo's copies are tracked in git and are deleted in task 4.

### New procedure step for self-modifying rounds

Add to CLAUDE.md's unpin procedure: *after `./install.sh`, run `cairn round next` once from the repo root (with `tasks.json` empty it returns `round-done`), so any round-end behavior added during the round, such as the temp-file sweep, actually runs and gets a live check.* This is safe because it happens after unpinning. The ban on running `cairn round` in the project root covers only the round itself.

## Rejected Alternatives

**This session (round 19):**

- **Moving ntfy to its own `notifications.ntfyTopic` key.** Rejected: Claude Code now has built-in notifications, and ntfy fired only under headless `cairn run`, not `/cairn-run`.
- **Keeping ntfy under the `narration` key.** Rejected: it leaves a misleadingly named config block behind.
- **An `init` migration that deletes old narration hook scripts in other projects.** Rejected: they exit when the socket is missing, so they're inert. Unlike the round-13 deny rules, they break nothing.
- **Building "record the red run" into Cairn's task prompt.** Rejected: TDD is the user's personal convention, not a Cairn feature. The line goes in `CLAUDE.local.md`.
- **Having the reviewer stop checking TDD order.** Rejected in favor of agents recording the evidence.
- **A probe harness for `REVIEWER_DISALLOWED_BASH_RULES`.** Rejected: the dated doc comment is enough.
- **A new cleanup command, or cleaning `.cairn/` at a different point.** Rejected: the round-end sweep (#131) already does it. The leftovers come from the pinned binary predating #131, which the new unpin step fixes.
- **Keeping every blocked task's scratch files (prompt and notes too).** Rejected: only `_tests.log` explains a block.
- **Deleting a blocked task's `_tests.log` when `tasks.json` can't be read.** Rejected: when the status is unknown, keep the diagnostics.

**Round 17:**

- **Unpinned validation round.** Rejected once the hook tasks were in scope: the hook is live in the session, and a mid-round rebuild would change the containment layer while the round runs.
- **Strip `${` / braces in `hasOutputOption` instead of denying `$`.** Rejected: patching one expansion form at a time is the pattern that produced the hole. The reviewer never needs `$`.
- **Only documenting the `CAIRN_PROJECT_ROOT` behavior.** Rejected: the fix is small, and the tool call's `cwd` is the true answer for the session the hook guards.
- **Changing `findProjectRoot`'s default to prefer `cwd` over the environment variable.** Rejected: every CLI command spawned by cairn relies on the environment variable winning.
- **Rewriting an existing `.cairn/.gitignore` from `GITIGNORE_CONTENT`.** Rejected: it would drop user additions and the legacy block. Append-only merge.
- **One task for all 38 `test/` type errors.** Rejected in favor of two batches.
- **A small side project for the validation round.** Rejected: this repo had real, low-risk work queued, and the pin makes self-modification safe.

**Round 16:**

- **Type-check in `healthCheck`.** Rejected: it runs before every iteration, and a type error would block the *next* task's health check instead of failing the task that introduced it.
- **Type-check as a script only, with no gate.** Rejected: agents' self-reported "no new tsc errors" isn't reliable.
- **Relying on `defaultTestCommand` alone for the gate.** Doesn't work: it's a prompt hint, not something validation runs. The gate goes into each task's declared `tests`.
- **Hook blocks subagent Bash writes to `tasks.json`** (redirection, `sed -i`, `mv`, `cp`, `tee`). Rejected: pattern matching is easy to get around and goes beyond what headless enforces.
- **Fixing the #105 gap only in `cairn-run.md` wording.** Rejected: the run agent's memory is exactly what compaction loses. The verdict carries the fields.
- **Re-reading the record right before the SHA decision.** Rejected in favor of capture-unconditionally-then-decide-under-lock.
- **Pruning `awaiting-review` records for archived tasks.** Rejected: those are pending reviews.
- **Making the concurrent counter `get`/`set` atomic** (#93). Deferred until concurrent loops are on the table.

**Round 15:**

- **Workflow scripts for the loop.** Rejected: rounds are under 20 tasks, Workflows eat token budgets, and it's unclear how much a running Workflow can be redirected from a phone. Revisit if rounds grow large.
- **Task agent launches its own reviewer (nesting).** Rejected: the reviewer loses independence, the deterministic steps get skipped, and failure handling ends up inside a subagent.
- **Run agent reads `tasks.json` and picks tasks itself.** Rejected: costs context and moves tested logic into prompt prose.
- **Guard counters kept by the run agent.** Rejected: compaction or restart miscounts.
- **`--before-sha` passed only as a flag.** Rejected: the attempt record exists anyway. Kept as an override.
- **Finding the review range from `Task #<id>:` commit messages as the primary method.** Rejected. Kept as the fallback.
- **A `selectedStatus` field.** Rejected: "still pending at settle" is enough.
- **Putting `next`/`settle` under `cairn task`.** Rejected: a task agent calling `settle` would archive its own task and skip its own review.
- **Returning prompts inline from `next`/`settle`.** Rejected in favor of prompt files.
- **Passing full test output to the reviewer.** Rejected: summary plus log path instead.
- **Pausing the loop with AskUserQuestion on a block.** Rejected: it stalls unattended rounds.
- **Moving `instructions.md` into the project `CLAUDE.md`.** Rejected: that file is committed, and the content is personal.
- **Multiple independent reviewers (`review.maxIterations`).** Deferred, config deleted. Sketch if revived: focused lenses or mixed models; reviewers *return* findings; a `review-merger` agent writes one section.
- **Removing headless `cairn run`.** Rejected until a real round succeeds through `/cairn-run`. Rounds 17 and 18 have now run through `/cairn-run`, so this is up for decision; see Open Questions.
- **Idempotency keyed on archived status.** Rejected: keyed on the attempt record.
- **Mapping the task's `agent` field to `subagent_type`.** Rejected: always launch `cairn-task-agent` and embed the specialist in the prompt file.
- **Built-in `general-purpose` as the task agent type.** Rejected: it can't set `maxTurns`.
- **Hook denies `tasks.json` edits only while a round is live.** Rejected: a crashed round's stale record would block generate-tasks.
- **Shell-script hook.** Rejected in favor of `cairn hook pre-tool-use`.
- **`default`/`acceptEdits` mode plus an allowlist for `/cairn-run`.** Rejected for unattended rounds.
- **`incompletes` limit of 2.** Rejected: it never tries a fresh agent on a stuck task.
- **Dropping SUBAGENT STRATEGY from the subagent-mode prompt.** Rejected: nesting works.

**Corrected from earlier rounds:**

- ~~"Guard counters are in memory and per-run on purpose."~~ Counters live in run state.
- ~~"Dropping test execution from the reviewer's remit — moot."~~ Adopted in round 15.
- ~~"Subagents do not load the parent's auto memory."~~ They do.
- **"Skills instead of subagents"** stays rejected as worded.
- ~~**Port narration to TypeScript.**~~ Moot: narration is being removed in round 19.

**Carried forward from round 14 and earlier:**

- **Per-agent deny via `--settings`.** Rejected: headless mode is already deny-by-default.
- **Keeping the deny rules and exempting the loop some other way.** Rejected: a deny wins when rules merge.
- **Manual removal only, no init migration** (for the legacy deny rules). Rejected.
- **A `cairn doctor` command.** Deferred; revisit if a second known-bad state appears.
- **Halting the entire run on a same-task stall.** Rejected in favor of block-and-continue.
- **Grant broad `Bash(*)` with targeted denies.** Rejected.
- **Blanket `Bash(cairn task:*)` deny.** Rejected: breaks `cairn task next-id` / `show`.
- **Grant `Bash(find|cat|ls|rg|grep|head|wc:*)`.** Rejected.
- **Write rules or the hook to `.claude/settings.json` (committed).** Rejected.
- **Cairn writes to global git excludes.** Rejected.
- **Truly runtime-configurable brand name.** Rejected: bootstrap trap.
- **Renaming `.ralph_task_*_notes.md`.** Rejected permanently.
- **Declaring task `tests` root-relative everywhere.** Rejected.
- **Try-then-fall-back cwd for test validation.** Rejected.
- **An explicit per-task `testCwd` field.** Rejected.
- **Giving `healthCheck` the per-directory resolver.** Rejected.
- **Never normalize a resolved API key onto plain `ANTHROPIC_API_KEY`.**
- **`BRAND` constants in test assertions.** Rejected as partly tautological.
- **Splitting a self-modifying round into stop/rebuild/restart batches.** Rejected.
- **Rewriting archives during a sweep.** Rejected: falsifies history.
- **Per-task review files.** Not adopted; escape hatch if per-round files grow too long.
- **Agent-managed `state.json`.** Rejected.
- **Store `nextTaskId` inside `tasks.json`.** Rejected.
- **Audit agent writes `planning-notes.md` directly.** Rejected.
- **Separate `audit` CLI command.** Rejected.
- **Anthropic TS SDK instead of shelling out to `claude`.** Rejected.
- **Change storage format (SQLite / per-task files / JSONL).** Rejected.
- **Pre-commit to git worktrees for parallel execution.** Deferred to the RFC round.

## Rough Task Outline

**MANUAL pre-round (user), in this order:**

1. **Commit** the round-18 files: `.cairn/tasks.json`, `tasks.completed.json`, `state.json` and `reviews/round-18.md`. Leave `cairn.json`'s pinned `healthCheck` uncommitted.
2. **Add the failing-test line to `CLAUDE.local.md`**, e.g. *"In `cairn task complete --notes`, include the failing test command and the line showing it fail, from before the fix."*
3. **Re-pin from the current HEAD** (CLAUDE.md procedure): `bun run build`, copy `dist/cairn` over `~/.local/bin/cairn`, verify it's a regular file. `healthCheck` stays at `/tmp/cairn-healthcheck`.
4. **Generate tasks** (`/generate-tasks`), then launch a fresh `claude --permission-mode bypassPermissions` from a plain terminal and run `/cairn-run`.

**Round tasks** (IDs from #138). Every task is TDD, with tests = `bun run typecheck` + `bun test`. No specialist agents apply. Every task says: *don't modify `cairn.json`, `install.sh` or `package.json`'s `build` script (the binary is pinned); never run `cairn round`/`cairn hook`/`cairn init` against the project root; temp dirs only.*

1. **Sweep keeps blocked tasks' `_tests.log`**
   - Files: `src/temp-sweep.ts`, `src/commands/round.ts` / `src/commands/run.ts` only if the call sites need to pass anything new, `test/commands/round.test.ts`, `test/commands/run.test.ts`.
   - Behavior: skip `task_<id>_tests.log` when task `<id>` is `blocked`. Sweep that task's prompt, review prompt and notes files as usual. If `tasks.json` can't be read, keep every `_tests.log`. Never throw.
   - Tests (in both suites):
     - a blocked task's log survives while its prompt and notes are removed
     - a non-blocked task's log is removed
     - with an unreadable `tasks.json`, logs survive and no error is raised
     - the existing never-sweep tests still pass
   - Update the `temp-sweep.ts` docblock. *No deps.*
2. **Strip narration and ntfy from the run loop and the stream filter**
   - Files: `src/commands/run.ts`, `src/stream-filter.ts`, `test/commands/run.test.ts`, `test/stream-filter.test.ts`, plus narration/ntfy mock stubs in other test files (`test/commands/round.test.ts`, `test/agent-prompt.test.ts`, `test/post-task-reviewer.test.ts`).
   - In `run.ts`, remove:
     - the narration server start/stop and its per-iteration health check and restart
     - the `narrate` and ntfy stream callbacks, and the final ntfy/spoken summary
     - the five narration deps and `sendNtfy`
   - In `stream-filter.ts`, remove `sendToNarrate`, `sendNtfy`, `NtfyOpts` and the `narrate`/ntfy options of `ProcessStreamOptions`.
   - Keep the console summary output and every non-narration behavior identical.
   - Leave `config.narration` itself in place; task 4 removes it.
   - *No deps.*
3. **Delete the narration modules and the `cairn narrate` command**
   - Delete `src/narration.ts`, `src/commands/narrate.ts`, `test/narration.test.ts`, `test/commands/narrate.test.ts`, and all of `lib/` (`cairn_narrate.py`, `cairn_narrate_server.py`, `__pycache__`).
   - In `src/index.ts`, remove the `narrate` command registration and the `CAIRN_NARRATE_PYTHON` / `CAIRN_LIB_DIR` env vars. Check whether anything else uses `libDir`/`CAIRN_LIB_DIR` before removing it.
   - Update `test/index.test.ts`.
   - Remove the `lib/__pycache__/` line from the root `.gitignore`; leave the `.venv/` line.
   - Leave `ProcessManager` (`src/process.ts`) alone: it's generic, and its tests use "narrate" only as a sample name.
   - Leave `BRAND.socket`/`pidFile` in place; task 4 removes them.
   - *Deps: 2.*
4. **Remove narration from config, types, `init` and `BRAND`**
   - Files: `src/config.ts`, `src/types.ts`, `src/commands/init.ts`, `src/brand.ts`, `test/config.test.ts`, `test/types.test.ts`, `test/commands/init.test.ts`, plus the repo's tracked `.claude/hooks/narrate.sh`, `speak.sh` and `notify.sh` (delete them).
   - Remove:
     - the `narration` field from `CairnConfig`
     - its check in `isCairnConfig`, its defaults in `loadConfig`, and the `CAIRN_NARRATION_ENABLED` / `CAIRN_NARRATION_VOICE` / `CAIRN_NTFY_TOPIC` env exports
     - `init`'s TTS, voice and ntfy prompts and the `narrationEnabled`/`narrationVoice`/`ntfyTopic` fields of its config-prompt type
     - `NARRATE_SH`/`SPEAK_SH`/`NOTIFY_SH`, `NARRATION_HOOKS`, `writeNarrationHooks` and `installNarrationHooks`
     - `BRAND.socket`, `BRAND.pidFile` and the `brand.ts` standing-rule comment's references to them
   - **Required tests:** a `cairn.json` that still contains a `narration` block loads without error, and `isCairnConfig` accepts a config without one. `init`'s generated `cairn.json` has no `narration` key.
   - *Deps: 3.*
5. **Docs**
   - Files: repo-root `README.md`, `CLAUDE.md`, `docs/parallel-execution-rfc.md`.
   - README: remove the narration setup (venv/kokoro/sounddevice), the "Push Notifications (ntfy)" section, the ntfy prerequisite, any `cairn narrate` usage, and the narration/ntfy fields in the `cairn.json` reference.
   - CLAUDE.md:
     - drop `narrate` from the command list and the **Narration** bullet
     - Conventions: remove the "`lib/` contains only Python narration scripts" sentence (`lib/` no longer exists)
     - update the BRAND standing rule (`socket`/`pidFile` and the two narration finders are gone), and the Branding bullet's field list
     - line 76: "the legacy `.cairn_` spelling" → "the defensive `.cairn_` spelling"
     - pin/unpin procedure: after `./install.sh`, run `cairn round next` once so round-end behavior added during the round runs
     - document task 1's blocked-log exception in the Run state sweep bullet
   - RFC: drop or rewrite the "Single narration socket" point.
   - Verify every claim against the shipped code. *Deps: 1–4. Last.*

Directories: `src/`, `src/commands/`, `test/`, `test/commands/`, `lib/` (deleted), `.claude/hooks/` (deleted), `docs/`, plus the repo-root `README.md`, `CLAUDE.md` and `.gitignore`. No cross-service work.

**MANUAL post-round:**

1. **Unpin** (`./install.sh`) and set `healthCheck` back to `bun run build`.
2. **Delete the `narration` block from `cairn.json` by hand.** Task 4's test guarantees an old block is harmless, so the order doesn't matter.
3. **Run `cairn round next` once from the repo root.** With `tasks.json` empty it returns `round-done` and sweeps with the fresh binary. This is a live check of #131 and task 1. Anything the pinned round-19 sweep missed goes now.
4. **`rm -rf .venv`** (only narration used it), then **`cairn summarize`** to refresh IMPLEMENTATION.md.
5. **Commit** the round bookkeeping, `cairn.json` and the regenerated IMPLEMENTATION.md.

## Open Questions

- **Round-17 validation results were never recorded.** Only the canary question has an answer (custom agent types do load `CLAUDE.local.md`). Still open, answerable from round 17/18/19 experience:
  - Does `auto` mode wrongly deny routine Cairn actions?
  - Can the phone approve permission prompts over Remote Control?
  - Is `maxTurns` 150 right? Did any task agent hit it?
  - Does a compacted or resumed run agent behave identically to a fresh one?
- **Should headless `cairn run` be removed or demoted?** Rounds 17 and 18 both ran through `/cairn-run`, which meets the round-15 condition. Removing narration and ntfy (this round) strips out most of what made `cairn run`'s loop distinctive, which makes a later removal smaller.
- **Should `cairn run` switch to prompt files?** Moot if it's removed.
- **Headless reviewer raw-text matching:** is there an escaping form of the `--disallowedTools` patterns worth chasing? It's low priority: the reviewer is a trusted agent, and the hook covers `/cairn-run`.
- **Should `cairn round next` refuse when another loop is running?** (carried from round 15)
- **`--before-sha` on a repeat call:** save the override (done in round 16) or reject a value that differs from the record? Revisit only if it causes confusion.
- **Should `cairn run` stamp `promptFile` / `model` into its log,** or ignore the retry fields? Ignoring is current behavior; moot if `cairn run` is removed.
