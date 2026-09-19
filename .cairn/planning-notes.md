## Context

**Round 17: the `/cairn-run` validation round.** First real round driven through the interactive `/cairn-run` flow instead of headless `cairn run`. The task list is deliberately small, real, and low-risk: the leftovers from rounds 15–16 plus one confirmed hook hole found during this planning session.

**Round 16 is done.** Tasks #109–#116 are archived and `tasks.json` is empty. `state.json` is at `nextTaskId: 117, round: 17`. `bun run typecheck` is clean and `bun test` is green (1195 pass). Round 16 delivered:
- the type-check gate (`bun run typecheck`, `skipLibCheck`, the typescript devDependency)
- `ensureAttemptRecord` (the beforeSha race)
- self-sufficient `retry` verdicts
- orphan pruning
- the hook's `--output` rule
- settle fixes, the `cli-io.ts` writer module, and docs

**Post-round steps from rounds 15 and 16, status as of this session:**
- Done:
  - Unpinned: `~/.local/bin/cairn` is again a symlink to `dist/cairn`.
  - `healthCheck` is back to `bun run build`.
  - `defaultTestCommand` is `bun run typecheck && bun test`.
  - `review.maxIterations` is deleted.
  - `cairn init` has run here. `/cairn-run`, `cairn-task-agent`, the updated reviewer and the PreToolUse hook are all installed, and the installed copies match `commands/` and `agents/`.
  - `.cairn/.cairn_iterations.log` is untracked (`git rm --cached`; the deletion is staged, not yet committed).
  - `.cairn/.gitignore` was hand-patched with the round-15 runtime entries: `.cairn_task_*_tests.log`, `.cairn_task_*_prompt.md`, `.cairn_run_state.json`, `.cairn_run_state.json.lock`, `.cairn_hook_errors.log`.
- **Not yet done:** commit the round-16 bookkeeping (`tasks.json`, `tasks.completed.json`, `state.json`, `reviews/round-16.md`), the `.cairn/.gitignore` edit, the root `.gitignore` edit (`.claude/settings.local.json`), `cairn.json`, and the untracked `.claude/agents/cairn-task-agent.md` and `.claude/commands/cairn-run.md`.

**Smoke test done this session, in a temp repo with the `CAIRN_*` environment variables cleared:**
- Hook:
  - denies a subagent `Write` to `tasks.json`
  - denies a reviewer `Write` outside `reviews/` and allows one inside it
  - denies `git diff --output=…` and allows `git log`
  - on garbage stdin, exits 1 and appends to `.cairn_hook_errors.log`
- `cairn round next` on an empty list returns `round-done` with the hook-error `warnings` entry.

The CLI half of `/cairn-run` works. No real agent round has run through it yet.

### Findings from this session

1. **`cairn init` never updates an existing `.cairn/.gitignore`.**
   - Cause: `src/commands/init.ts:91`, `if (!fs.existsSync(gitignorePath))`.
   - The entries (`TEMP_IGNORE_SUFFIXES`) are correct, but every project initialized before round 15 lacks the run-state, prompt-file, test-log and hook-error entries.
   - An agent's `git add -A` could commit them.
   - Hand-patched in this repo only.
2. **The reviewer can still write files by hiding `--output` behind a shell variable. Confirmed by probe.**
   - Round 16's reviewer rated this PLAUSIBLE (HAS_RISKS on #113).
   - `hasOutputOption` in `src/commands/hook.ts` removes quotes, `\` and `$` from each word, but leaves the braces. So `git log --output${X}=/tmp/f` becomes `--output{X}=/tmp/f`, which neither equals `--output` nor starts with `--output=`.
   - The command is **allowed**. Bash then expands `${X}` to nothing, and git writes the file (verified: the file was created).
   - The quoting variants (`--output"="…`, `--outpu't'=…`, `--output\=…`) are all correctly denied.
   - The pre-check regex (`` /[`<>]|\$\(/ ``, hook.ts:105) blocks only backticks, `<`, `>` and `$(`.
3. **The hook takes the project from the `CAIRN_PROJECT_ROOT` environment variable ahead of the tool call's `cwd`.**
   - `findProjectRoot()` (`src/utils.ts:68`) checks `CAIRN_PROJECT_ROOT` first. The hook calls it with the tool call's `cwd` (hook.ts:187), so the environment variable wins.
   - Found when this planning session, which `cairn plan` launched and which therefore carries the `CAIRN_*` environment variables, pointed the hook at a temp repo. It resolved to the real repo instead.
   - Only matters when a `/cairn-run` session is started from a shell that cairn launched. `cairn run`'s headless agents have no `agent_id`, so the hook never looks anything up for them.
4. **`test/` has 38 type errors** (measured this session with a temporary tsconfig that includes `test/`; round 16 estimated 43):

   | File | Errors | Kind |
   |---|---|---|
   | `test/post-task-reviewer.test.ts` | 11 | TS2345: nearly all the same argument-type mismatch for `buildPostTaskReviewUserPrompt`'s input |
   | `test/commands/run.test.ts` | 14 | TS2322 mock type mismatches (`Mock<…>` vs. `(...args: unknown[]) => void`, archive-mock return types), TS2769 overloads |
   | `test/stream-filter.test.ts` | 5 | TS2741, `fetch` mocks missing `preconnect`; one TS2322 |
   | `test/config.test.ts` | 4 | TS2339, `maxIterations` on `{ postTask: boolean }` (leftover of the deleted config) |
   | `test/commands/init.test.ts` | 2 | TS2352, `ConfigDefaults` → `Record<string, unknown>` cast |
   | `test/index.test.ts` | 1 | TS18048, `args` possibly undefined |
   | `test/settle.test.ts` | 1 | TS2769 |

   Including `test/` also needs `rootDir` changed. `tsconfig.json` has `"rootDir": "src"`, which rejects files outside `src/`. `bun build --compile` ignores `rootDir` and `outDir`, so changing them doesn't affect the build.
5. **Small nits from the round-16 review:**
   - `src/commands/hook.ts:30` keeps its own `Writer` type; the other copies moved to `src/cli-io.ts` in #115.
   - CLAUDE.md's Run state section has two bullets ("Picking records the sha under the lock", "Orphan pruning") that repeat the bullets above them (#116).

## Goals

1. **Validate `/cairn-run` end to end** on a real round: task → settle → review → `--reviewed` → done, plus recovery after compaction or a resume, push notifications, `auto` mode, and whether `CLAUDE.local.md` reaches `cairn-task-agent`.
2. Close the confirmed hook hole (`$` expansion) and make the hook find the project from the tool call's `cwd`.
3. Make `cairn init` add missing entries to an existing `.cairn/.gitignore`.
4. Extend the type-check gate to `test/`.
5. Keep the docs accurate.

## Approach

### Run mode: `/cairn-run`, pinned

- Run the round through `/cairn-run` in an interactive session started from a **plain terminal**, not from a shell cairn launched (finding 3). Use `bypassPermissions`; switch to `auto` for a stretch.
- **Pin the binary.** Tasks 118 and 119 change `src/commands/hook.ts`, and the hook is live in the `/cairn-run` session: every Edit/Write/Bash runs `cairn hook pre-tool-use` → `dist/cairn`. Unpinned, any mid-round `bun run build` (including the health check) would put a half-finished hook into the containment layer. For example, a bad root lookup would deny the reviewer's writes to `reviews/`. Pinning also means the round validates exactly the round-16 code. Use the standard pin/unpin procedure in CLAUDE.md, including the `healthCheck` redirect to `/tmp/cairn-healthcheck`.
- No task touches `src/commands/round.ts`, `src/settle.ts` or `src/run-state.ts`.
- The standing hazard rules still go in the task descriptions:
  - Tasks touching `hook.ts`, `utils.ts`, `init.ts` or `cairn.json`: never run `cairn round …`, `cairn hook …`, `cairn init` or `bun src/index.ts round|hook|init …` against this repository's root. Exercise them only in temp dirs (`fs.mkdtempSync`).
  - Tasks touching `package.json`, `tsconfig.json` or `cairn.json`: do NOT modify `healthCheck` or the `build` script, and do not run `./install.sh`. The binary is pinned and the health check redirected.
  - `cairn.json` has an uncommitted user change: stage only the files you changed.
- **Tests on every task:** `bun run typecheck` and the relevant `bun test …` (the full `bun test` is fine). TDD per `CLAUDE.local.md`.

### `init`: add missing `.gitignore` entries

- When `.cairn/.gitignore` exists, compare its lines (trimmed, exact match, **wherever they appear in the file**) against the lines of `GITIGNORE_CONTENT`. Append only the missing ones, under a short comment header.
- Never reorder, remove or rewrite existing lines. The legacy `.ralph_*` block and user additions stay as they are.
- Print `Updated: .cairn/.gitignore (added N entries)`, or nothing when nothing was added.
- A second `init` adds nothing (the existing re-init test at `init.test.ts:170` must still hold).
- This repo's hand-patched file places the new lines mid-file, so the post-round `cairn init` here should report nothing to add. That's a live check of position-independent matching.
- `init` still never touches the repository's root `.gitignore` (the existing "Cairn does not edit .gitignore" rule is about the root file; the data-dir file is init's own).

### Hook: deny `$` in reviewer Bash

- Reviewer Bash is denied if the command contains `$` anywhere, replacing "strip `$` then check". This subsumes `$(`, `${…}`, `$VAR`, and `$'…'` ANSI-C quoting.
- Safe for legitimate use: `${range}` in `src/post-task-reviewer.ts`'s prompt (lines 31–33) is a JS template literal filled in before the reviewer sees it, so the reviewer's git commands never contain a literal `$`.
- Keep the exact-token `--output` check as a second layer.
- Tests:
  - denied: `git log --output${X}=/tmp/f`, `git diff $X`, `git show $'--output=x'`
  - still allowed: plain `git diff <sha>..<sha>`, `git log --oneline -5`
  - the quoting variants stay denied
- Update the deny reason text to mention shell variables.
- Fold `hook.ts`'s local `Writer` type into `src/cli-io.ts`.

### Hook: find the project from the tool call's `cwd`

- When the tool call has a string `cwd`, the hook finds the project by walking up from it for a `.cairn/` directory, **ignoring `CAIRN_PROJECT_ROOT`**. With no usable `cwd`, fall back to today's behavior (environment variable, then `process.cwd()`). That includes the error-log location path (hook.ts:209).
- Suggested shape: an option on `findProjectRoot` (e.g. `{ ignoreEnv: true }`) or a small walk-only helper in `src/utils.ts`. Don't change `findProjectRoot`'s default behavior; every other command relies on the environment variable.
- Test: with `CAIRN_PROJECT_ROOT` set to directory A and the tool call's `cwd` inside temp project B, the reviewer's `reviews/` scope and the `tasks.json` rule resolve to B. Restore the environment variable after the test.

### `test/` type-check in two batches

- **Batch A** (`post-task-reviewer`, `config`, `init`, `index`, `settle` tests, 19 errors):
  - Fix the test code, not `src/` types, unless a `src/` type is genuinely wrong. Say so in the notes if it is.
  - The agent checks its progress with a temporary tsconfig that extends `tsconfig.json`, sets `rootDir: "."` and includes `src` and `test`, then deletes it. Validation cannot enforce batch A until batch B turns the gate on. That's accepted: batch B catches any leftovers.
- **Batch B** (`run.test.ts`, `stream-filter.test.ts`, 19 errors), then **turn on the gate:**
  - add `"test"` to `include`
  - change or remove `rootDir` (`"."` or delete it; keep `outDir` harmless)
  - `bun run typecheck` must exit 0 with `test/` included
  - fix any test type errors that tasks 117–119 introduced
- Prefer typed helpers or `as unknown as T` casts at mock boundaries over loosening `src/` signatures. Don't add `// @ts-expect-error` or `// @ts-ignore` except as a last resort, with a comment.

### Validation-round observations (the human's side)

- **`CLAUDE.local.md` canary:** before the round, add a temporary line, e.g. "Include the word CANARY-17 in your `cairn task complete --notes`." After the round, grep `tasks.completed.json` for it, then remove the line.
- **Compaction and resume:** run `/compact` (or quit and resume) between tasks at least once. The session should carry on from the `next` hints alone; an open review should be picked up first by `round next`.
- **`auto` mode:** run at least one task in `auto` and note any wrongly denied routine commands (`git commit`, `bun test`, `cairn task …`).
- **Remote Control:** drive part of the round from the phone. Note whether permission prompts can be approved there (they shouldn't appear in `bypassPermissions`).
- **Clean end state:**
  - `.cairn/.cairn_hook_errors.log` is empty or missing
  - `.cairn/.cairn_run_state.json` has no attempt records
  - each task has a `Task #N:` commit
  - `reviews/round-17.md` has one section per task
  - the push notification arrived at `round-done`
- **Compare with headless:** round 16 ran under `cairn run`. Note wall-clock, retries, and anything the run agent got wrong.

## Rejected Alternatives

**This session (round 17):**

- **Unpinned validation round.** I first proposed it because the round-loop code isn't touched. Rejected once the hook tasks were in scope: the hook is live in the session, and a mid-round rebuild would change the containment layer while the round runs.
- **Strip `${` / braces in `hasOutputOption` instead of denying `$`.** Rejected: patching one expansion form at a time is the pattern that produced this hole. The reviewer never needs `$`.
- **Only documenting the `CAIRN_PROJECT_ROOT` behavior.** Rejected: the fix is small, and the tool call's `cwd` is the true answer for the session the hook guards.
- **Changing `findProjectRoot`'s default to prefer `cwd` over the environment variable.** Rejected: every CLI command spawned by cairn relies on the environment variable winning.
- **Rewriting an existing `.cairn/.gitignore` from `GITIGNORE_CONTENT`.** Rejected: it would drop user additions and the legacy block. Append-only merge.
- **One task for all 38 `test/` type errors.** Rejected in favor of two batches: it keeps each task agent-sized and gives the validation round more settle/review cycles.
- **A small side project for the validation round.** Considered. Rejected because this repo has real, low-risk work queued, and the pin makes self-modification safe.

**Round 16:**

- **Type-check in `healthCheck`.** Rejected: it runs before every iteration (a few seconds each), and a type error would block the *next* task's health check rather than fail validation of the task that introduced it, so the revert guard would never point at the right task.
- **Type-check as a script only, with no gate.** Rejected: the round-15 reviews show agents' self-reported "no new tsc errors" is not reliable.
- **Relying on `defaultTestCommand` alone for the gate.** Doesn't work: it's a prompt hint (`run.ts:137`), not something validation runs. The gate goes into each task's declared `tests`.
- **Hook blocks subagent Bash writes to `tasks.json`** (redirection, `sed -i`, `mv`, `cp`, `tee` naming the file). Rejected: pattern matching is easy to get around and goes beyond what headless enforces. Execution agents are bound by the prompt ban in both modes.
- **Fixing the #105 gap only in `cairn-run.md` wording** ("remember model and promptFile"). Rejected: the run agent's memory is exactly what compaction loses. The verdict carries the fields.
- **Re-reading the record right before the SHA decision** (the #98 reviewer's one-line fix). Rejected in favor of capture-unconditionally-then-decide-under-lock, which closes the window instead of narrowing it and unifies the `run.ts` and `round.ts` paths.
- **Pruning `awaiting-review` records for archived tasks.** Rejected: those are pending reviews, and their tasks are archived by design.
- **Making the concurrent counter `get`/`set` atomic** (#93). Deferred: only concurrent settles of the same task could race, and neither loop produces them. Revisit with the concurrent-loops open question.

**Round 15:**

- **Workflow scripts for the loop.** Rejected: rounds are under 20 tasks, users report Workflows eating token budgets, and it's unclear how much a running Workflow can be redirected from a phone. Revisit if rounds grow large.
- **Task agent launches its own reviewer (nesting).** Rejected even though nesting works: the reviewer loses independence, the deterministic steps get skipped, and failure handling ends up inside a subagent.
- **Run agent reads `tasks.json` and picks tasks itself.** Rejected: costs context and moves tested selection logic into prompt prose.
- **Guard counters kept by the run agent.** Rejected: compaction or restart miscounts, which leads either to the 60-iteration livelock or to blocking too early.
- **`--before-sha` passed only as a flag.** Rejected because the attempt record exists anyway. Kept as an override.
- **Finding the review range from `Task #<id>:` commit messages as the primary method.** Rejected because the message format is enforced only by the prompt. Kept as the fallback when the record is missing.
- **A `selectedStatus` field.** Rejected: "still pending at settle" is enough.
- **Putting `next`/`settle` under `cairn task`.** Rejected: task agents use `cairn task`, and one calling `settle` would archive and skip its own review.
- **Returning prompts inline from `next`/`settle`.** Rejected in favor of prompt files.
- **Passing full test output to the reviewer.** Rejected: summary plus log path instead.
- **Pausing the loop with AskUserQuestion on a block.** Rejected: it stalls unattended rounds.
- **Moving `instructions.md` into the project `CLAUDE.md`.** Rejected: that file is committed, and the content is personal.
- **Multiple independent reviewers (`review.maxIterations`).** Deferred, config deleted. Sketch if revived: focused lenses (spec / correctness / coverage) or mixed models; reviewers *return* findings; a `review-merger` agent writes one section; config `review.reviewers` with a per-task override.
- **Removing headless `cairn run`.** Rejected until a real round succeeds through `/cairn-run`. (Round 17 is that round; revisit after it.)
- **Idempotency keyed on archived status.** Rejected: settle archives before the review gate, so `--reviewed` would be swallowed. Keyed on the attempt record.
- **Mapping the task's `agent` field to `subagent_type`.** Rejected: the specialist `.md` would replace the whole system prompt. Always launch `cairn-task-agent` and embed the specialist in the prompt file.
- **Built-in `general-purpose` as the task agent type.** Rejected: it can't set `maxTurns`.
- **Hook denies `tasks.json` edits only while a round is live.** Rejected: a crashed round's stale record would block generate-tasks.
- **Shell-script hook.** Rejected in favor of `cairn hook pre-tool-use` (tested TS; reuses `GIT_INSPECTION_RULES` and discovery).
- **`default`/`acceptEdits` mode + allowlist for `/cairn-run`.** Rejected for unattended rounds: every unlisted command prompts, and phone approval isn't documented.
- **`incompletes` limit of 2.** Rejected: never tries a fresh agent on a stuck task.
- **Dropping SUBAGENT STRATEGY from the subagent-mode prompt.** Rejected: nesting works.

**Corrected from earlier rounds:**

- ~~"Guard counters are in memory and per-run on purpose."~~ Counters live in run state. They are still not a `Task` field.
- ~~"Dropping test execution from the reviewer's remit — moot."~~ Adopted in round 15: settle validates before the review gate.
- ~~"Subagents do not load the parent's auto memory."~~ They do (round-15 probe a).
- **"Skills instead of subagents"** stays rejected as worded: the skill is the run agent, and all work happens in fresh-context subagents.

**Carried forward from round 14 and earlier:**

- **Per-agent deny via `--settings`.** Rejected: headless mode is already deny-by-default. Revive only if headless defaults change.
- **Keeping the deny rules and exempting the loop some other way.** Rejected: a deny wins when rules merge.
- **Manual removal only, no init migration.** Rejected: repos initialized during the round-13 window would stay silently broken.
- **A `cairn doctor` command.** Deferred; revisit if a second known-bad state appears. (Leftover run state from round 16's findings is handled by pruning instead. The stale `.cairn/.gitignore` is handled by init's merge this round.)
- **Halting the entire run on a same-task stall.** Rejected in favor of block-and-continue.
- **Grant broad `Bash(*)` with targeted denies.** Rejected: the reviewer needs no breadth.
- **Blanket `Bash(cairn task:*)` deny.** Rejected: breaks `cairn task next-id` / `show`.
- **Grant `Bash(find|cat|ls|rg|grep|head|wc:*)`.** Rejected: redundant with Read/Glob/Grep, and `find` is not read-only.
- **Write rules or the hook to `.claude/settings.json` (committed).** Rejected: affects every teammate's sessions.
- **Cairn writes to global git excludes.** Rejected: too invasive.
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
- **Port narration to TypeScript.** Rejected.
- **Change storage format (SQLite / per-task files / JSONL).** Rejected.
- **Pre-commit to git worktrees for parallel execution.** Deferred to the RFC round.

## Rough Task Outline

**MANUAL pre-round (user), in this order:**

1. **Commit:**
   - the round-16 bookkeeping: `.cairn/tasks.json`, `tasks.completed.json`, `state.json`, `reviews/round-16.md`
   - the staged untracking of `.cairn/.cairn_iterations.log`
   - `.cairn/.gitignore` and the root `.gitignore`
   - `.claude/agents/cairn-task-agent.md`, `.claude/agents/post-task-reviewer.md`, `.claude/commands/cairn-run.md`
   - `cairn.json` (`maxIterations` removed, `defaultTestCommand` updated) *before* pinning, so the `healthCheck` redirect is the only uncommitted change during the round
2. **Pin** (CLAUDE.md procedure): `bun run build`, copy `dist/cairn` over the symlink, verify it's a regular file; set `healthCheck` to `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck`.
3. **Canary:** add the temporary CANARY-17 line to `CLAUDE.local.md`.
4. **Optional probe (headless `--output`, round 16's probe 4):** from a throwaway repo, check whether `claude -p --allowedTools "Bash(git log:*)" --disallowedTools "Bash(git * --output*)"` blocks `git log --output=x`. The result decides whether headless `cairn run` can get the same rule later.
5. **Generate tasks** (`/generate-tasks`), then launch a fresh `claude --permission-mode bypassPermissions` **from a plain terminal** in the repo and run `/cairn-run`.

**Round tasks** (IDs from #117; each TDD; tests = `bun run typecheck` + `bun test`). No specialist agents apply.

1. **`init` adds missing `.cairn/.gitignore` entries** (`src/commands/init.ts`, `test/commands/init.test.ts`). Existing file: position-independent exact-line match against `GITIGNORE_CONTENT`; append only the missing lines under a comment header; print `Updated: … (added N entries)`; never remove or reorder. Tests:
   - old-style file with the legacy `.ralph_*` block
   - file already containing the entries mid-file (no change, no output)
   - user-added lines preserved
   - re-init idempotent
   ⚠️ Temp dirs only for `init`.
2. **Hook: deny `$` in reviewer Bash; fold `Writer` into `cli-io.ts`** (`src/commands/hook.ts`, `src/cli-io.ts`, `test/commands/hook.test.ts`). Deny any `$`; keep the `--output` exact-token check; update the deny reason. Test cases:
   - denied: `--output${X}=`, `$X`, `$'…'`
   - still allowed: plain sha-range diffs
   - still denied: the quoting variants
   ⚠️ Hook hazard: temp dirs only; the binary is pinned.
3. **Hook: find the project from the tool call's `cwd`, not `CAIRN_PROJECT_ROOT`** (`src/commands/hook.ts`, `src/utils.ts`, `test/commands/hook.test.ts`, `test/utils.test.ts` if present). Walk up from the tool call's `cwd` ignoring the environment variable; fall back to today's behavior when there's no `cwd` (including the error-log path). Don't change `findProjectRoot`'s default. Test with the environment variable pointing at A and the `cwd` in B. ⚠️ Hook hazard. *Deps: 2 (same file).*
4. **`test/` type errors, batch A** (`test/post-task-reviewer.test.ts`, `test/config.test.ts`, `test/commands/init.test.ts`, `test/index.test.ts`, `test/settle.test.ts`; 19 errors). Check with a temporary extending tsconfig that includes `test/`, then delete it. Fix tests, not `src/` types, unless a `src/` type is wrong. *Deps: 1 (same test file).*
5. **`test/` type errors, batch B, then turn on the gate** (`test/commands/run.test.ts`, `test/stream-filter.test.ts`, `tsconfig.json`; 19 errors). Add `test` to `include`, fix `rootDir`, fix any type errors in the new tests from tasks 1–3; `bun run typecheck` exits 0 with `test/` included. ⚠️ Touches `tsconfig.json`: don't touch `package.json`'s `build` script or `healthCheck`. *Deps: 1, 2, 3, 4.*
6. **Docs** (repo-root `CLAUDE.md`, `README.md`):
   - Development: `typecheck` now covers `test/`; remove the "~43 pre-existing errors" paragraph.
   - Enforcement under /cairn-run: the reviewer `$` rule; the hook finds the project from the tool call's `cwd`, ignoring `CAIRN_PROJECT_ROOT`.
   - Data layout: `cairn init` adds missing entries to an existing `.cairn/.gitignore` (append-only).
   - Run state: merge the duplicated bullets.
   - README: matching hook and init lines.
   *Last.*

Directories: `src/commands/`, `src/`, `test/`, `test/commands/`, plus repo-root `tsconfig.json`, `CLAUDE.md`, `README.md`. No cross-service work.

**MANUAL post-round:**

1. **Unpin** (`./install.sh`) and restore `healthCheck` to `bun run build`.
2. **`cairn init` in this repo:** expect **no** `.gitignore` update (live check of task 1 against the hand-patched file).
3. **Remove the CANARY-17 line** from `CLAUDE.local.md` after checking `tasks.completed.json` for it.
4. **Record the validation results** (below) in the next planning session: `CLAUDE.local.md` loading, `auto`-mode denies, Remote Control, compaction/resume behavior, clean end state, comparison with `cairn run`.

## Open Questions

- **Validation round will answer:**
  - Do custom agent types (`cairn-task-agent`) load `CLAUDE.local.md`? (canary)
  - Does `auto` mode wrongly deny routine Cairn actions?
  - Can the phone approve permission prompts over Remote Control?
  - Is `maxTurns` 150 right? (watch for a task agent hitting the limit)
  - Does a compacted or resumed run agent behave identically to a fresh one?
- **After the validation round:**
  - Should headless `cairn run` be removed or demoted (the round-15 rejection said "until a real round succeeds through `/cairn-run`")?
  - Should `cairn run` switch to prompt files?
- **Headless `--output` / `$` hole:** can a `--disallowedTools` wildcard match an argument in the middle of a command (probe 4)? If yes, a later round adds it to the headless reviewer spawn, likely including `$`. If no, the documented gap stands.
- **Should `cairn round next` refuse when another loop is running?** (carried from round 15)
- **`--before-sha` on a repeat call:** saving the override (done in round 16) vs. rejecting a value that differs from the record. Revisit only if it causes confusion.
- **Should `cairn run` stamp `promptFile` / `model` into its log,** or ignore the retry fields? Ignoring is the current behavior.
