## Task #85: Add same-task stall guard to the run loop
Reviewed: 2026-08-14T19:30:00Z

### Coverage
Task Requirements
├── [DONE] STALL_BLOCK_THRESHOLD = 3 added next to REVERT_BLOCK_THRESHOLD (run.ts:403), with a
│          "deliberately not configurable" comment mirroring the REVERT_BLOCK_THRESHOLD precedent —
│          confirmed no new cairn.json config key was introduced (grepped `config.ts` / `cairn.json`
│          for "stall" — no hits).
├── [DONE] In-memory `consecutiveStalls: Map<number, number>` declared alongside `consecutiveReverts`
│          (run.ts:493-495).
├── [DONE] Predicate implemented exactly as specified (run.ts:572-575, 713-740):
│   │        - `selectedStatus` snapshotted immediately after task selection, before the agent runs
│   │        - increment only when `selectedStatus === 'pending' && updatedTaskStatus === 'pending'`
│   │        - any other *observed* status (`in-progress`/`complete`/`blocked`) resets to zero via the
│   │          `else if (updatedTaskStatus !== 'unknown')` branch
│   │        - a throwing re-read leaves `updatedTaskStatus` at the `'unknown'` sentinel, which hits
│   │          neither branch — neutral, no increment, no reset
│   └──     Verified by re-deriving the state machine by hand against all 4 new unit tests below;
│            it matches in every case, including the discriminating ones (reset test asserts block
│            lands at iteration 5 not 4; throw test asserts block lands at iteration 4, distinguishing
│            it from both an increment-on-throw reading (would block at 3) and a reset-on-throw
│            reading (would push to 6)).
├── [DONE] REQUIRED REFACTOR — post-iteration status re-read hoisted out of `if (config.review?.postTask)`
│          into unconditional step `k3` (run.ts:697-711). `corruptionEvents++` on `repaired || restored`
│          preserved verbatim. The review gate at the old run.ts:692 now reads
│          `if (config.review?.postTask && updatedTaskStatus === 'complete')` (run.ts:743) — same
│          condition, collapsed from a nested if into one `&&`, behavior unchanged.
├── [DONE] Block-on-threshold block mirrors the revert-guard block at run.ts:659-672: calls
│          `deps.blockTask(...)`, logs, appends `BLOCKED` to the iteration log, clears the counter,
│          and falls through (no `break`/`return`) so the run continues to the next task. Note text
│          matches the required wording almost verbatim, naming the `permissions.deny` /
│          `--dangerously-skip-permissions` cause.
└── [DONE] TDD — tests added to test/commands/run.test.ts under a new "Same-task stall guard" section
           (lines 1279-1443), modeled directly on the revert-guard tests at 1170-1260 (same
           `makeGuardDeps` fixture, same call/assert style).

### Verification performed

- `bun test test/commands/run.test.ts` → **129 pass, 0 fail** (251 expect() calls). All 7 new stall-guard
  tests pass, including the three that specifically discriminate correct predicate semantics from
  plausible-but-wrong ones (reset-to-zero vs. status-changed; neutral-on-throw vs. increment-or-reset-on-throw).
- `bun test` (full suite) → **888 pass, 0 fail** across 30 files, 1794 expect() calls. No regressions
  elsewhere in the suite.
- Read the pre-change `src/commands/run.ts` in full via `git show d78a695~1:src/commands/run.ts` and
  hand-traced each new test against that old control flow (no `consecutiveStalls` map, no `selectedStatus`
  snapshot, review-gated-only re-read): every new test's assertion (e.g. `blockTask` called exactly once,
  `spawnClaude` called exactly 4 times, `note` containing `'permissions.deny'`) has no equivalent code path
  to satisfy in the old version, so the tests could not have passed against it — consistent with the task
  notes' TDD claim. I was **not able to mechanically re-run the tests against the old file** to observe the
  failure directly: my write scope is restricted to `.cairn/reviews/**` and a direct attempt to swap in the
  old file for a live re-run was correctly rejected by the harness's permission system (confirming, as a
  side effect, that `src/commands/run.ts` itself was never touched by my review). The hand-trace is a sound
  substitute here since the old file is short enough to fully reason about, but flagging the gap in
  first-hand verification for the record.
- Confirmed `cairn.json`'s `healthCheck` is unmodified by this commit (`git diff HEAD~1 HEAD -- cairn.json`
  is empty) and `install.sh` does not appear in the commit's changed-files list — the pin/unpin guard was
  honored.
- `bunx tsc --noEmit` could not be run in this sandbox (no local `typescript` devDependency / `tsc` binary,
  and `bunx` network fetch is blocked here) — not attempted; it is also not one of the task's declared
  "Expected Tests" (`bun test` only), so this doesn't block the verdict, but I could not independently
  confirm the implementing agent's own claim of "2 pre-existing errors only, unchanged from HEAD."

### Files Changed
- `src/commands/run.ts` — stall guard implementation, hoisted status re-read, threshold constant
- `test/commands/run.test.ts` — 7 new tests under "Same-task stall guard"
- `.cairn/tasks.json` — task lifecycle bookkeeping (task #85 archived to complete, new tasks #86-90 added by
  the agent's discovery mechanism — outside this task's declared file scope but is the intended `cairn task
  add` discovery workflow, not a direct edit)
- `.cairn/.cairn_tasks_snapshot.json` — deleted; artifact of the per-iteration snapshot mechanism, not a
  deliberate part of this task's change

### Gaps
None detected against the task's stated requirements. One process note rather than a gap: this task's own
notes record that it filed four follow-up tasks (#86-89, #90) discovered while implementing #85 — these
concern a separate, more serious issue (a project-wide `permissions.deny` block that silently breaks
`cairn run`, independent of this stall guard). That is out of scope for reviewing #85 itself and is captured
as its own task chain for future rounds.

### Regression Risks
- None detected in the changed code itself: the refactor of the post-iteration re-read is a mechanical hoist
  that preserves the exact `corruptionEvents` and review-gate semantics, confirmed both by reading the diff
  and by the full test suite passing.
- Minor, expected behavior change (not a regression, but worth recording): `readTasksFile` is now called
  once more per iteration than before when `review.postTask` is disabled (previously this read was skipped
  entirely in that case). This is required by the task ("otherwise the guard silently does nothing whenever
  post-task review is disabled") and is exercised by test 1 in the new suite, which runs with no
  `review.postTask` config and still asserts the block fires.
- No exports were removed, no existing tests were deleted or weakened — the revert-guard tests immediately
  above the new section (lines 1170-1260) are untouched and still pass alongside the new ones.

### Verdict
CLEAN

---

## Task #86: Delete CAIRN_TASK_DENY_RULES from init's permission seeding
Reviewed: 2026-08-14T19:45:00Z

### Verification performed

- Ran `bun test test/commands/init.test.ts` myself: **134 pass, 0 fail**, 278 expect() calls —
  matches the completed-task notes exactly.
- Ran `bun test` (full suite) myself: **887 pass, 0 fail** across 30 files, 1782 expect() calls —
  matches the notes exactly (888 → 887, a net -1 from merging two deny-assertion tests into one,
  not a coverage loss — confirmed the merged test still pins the same invariant).
- Grepped `src/`, `CLAUDE.md`, `README.md` for `CAIRN_TASK_DENY_RULES`, `deny task-state
  mutations`, and the `--dangerously-skip-permissions` false-exemption claim: the only surviving
  `--dangerously-skip-permissions` mentions are accurate ones (the real flag passed by
  `run.ts`/`summarize.ts`, the new stall-guard note text in `run.ts:724`, and CLAUDE.md's
  corrected paragraph) — the false claim itself is gone from every file it previously appeared in.
- Read the full commit (`git show 59505c6 --stat` / diff) directly rather than trusting the diff
  text alone: confirms `CAIRN_TASK_DENY_RULES` and its doc comment are fully deleted from
  `src/commands/init.ts` (not just emptied), the `deny: [...]` line is gone from
  `buildInitPermissionRules`, and the prompt copy in `installClaudeSettings` no longer claims
  denial of task-state mutation.
- Confirmed `mergeClaudeSettings`'s generic deny plumbing was left alone as instructed: `git diff
  HEAD~1 HEAD -- src/claude-settings.ts` is empty.
- Confirmed the CRITICAL GUARD was honored: `git diff HEAD~1 HEAD -- cairn.json` is empty, and
  `healthCheck` remains pinned to the throwaway outfile.
- Read `test/commands/init.test.ts`'s `installClaudeSettings` fixture (`config = { healthCheck:
  'bun run build', defaultTestCommand: 'bun test' }`) to confirm the two tests not explicitly
  named in the task ("returns the rules it added", "reports the file and each rule it wrote"),
  which were repointed from asserting `Bash(cairn task start:*)` to `Bash(bun run build:*)`, are
  legitimate substitutions — that allow rule is genuinely produced by the same fixture, so the
  tests still exercise "added/reported rules include health-check-derived ones" as intended.
- Could not directly observe a red→green TDD sequence from git history: this landed as a single
  squashed commit with no intermediate failing-test commit, consistent with every prior task in
  this round. The task notes claim 3 of the 4 named assertions failed pre-implementation and were
  confirmed failing before the deletion; I could not independently reproduce that (would require
  checking out the pre-image test file against the pre-image source), but the claim is
  self-consistent with the diff shape (all three named assertions changed from asserting deny
  content to asserting its absence) and is taken on the notes' word, per this round's established
  precedent for squashed commits.
- **Found a gap not caught by the task's own notes**: grepped for the deny rules' documentation
  footprint end-to-end. `README.md:92` (added by task #84, not touched by this commit) still
  reads `- **Deny** — the five mutating \`cairn task\` subcommands (\`start\`, \`complete\`,
  \`set-status\`, \`add\`, \`note\`).` — this is now factually false: `cairn init` no longer
  seeds any deny rules. The surrounding paragraph on README.md:94 ("Without these rules, a fresh
  project denies them outright in headless mode") is also now describing a mechanism that no
  longer exists. The task's own notes address this exact class of staleness for CLAUDE.md
  explicitly (calling it a "bonus fix" for "the exact false claim that caused the 60-iteration
  stall") but never mention checking README.md, which documents the identical content and is now
  equally wrong.

### Coverage
Task Requirements
├── [DONE] TDD: invert the four named assertions first — confirmed present in the diff (deny-
│         equality test, never-blanket-deny test, exactly-five-deny-rules test, runInit
│         deny-seeded test all replaced with absence assertions); ordering claim taken on the
│         notes' word per this round's precedent for squashed commits (see Verification above)
├── [DONE] New assertions: `buildInitPermissionRules` returns no deny (absent or empty) — `rules.deny
│         ?? []` equals `[]`; allow list unchanged — confirmed the "writes the git inspection and
│         config-derived allow rules" test is untouched by the diff
├── [DONE] Remove `CAIRN_TASK_DENY_RULES` const and its entire doc comment, including the false
│         `--dangerously-skip-permissions` claim — confirmed byte-gone from `init.ts`
├── [DONE] Remove `deny: [...CAIRN_TASK_DENY_RULES]` from `buildInitPermissionRules` — confirmed
├── [DONE] Fix the user-facing prompt copy in `installClaudeSettings` — old two-line copy
│         claiming deny-of-task-mutation replaced with a line describing only what's actually
│         written (git inspection + health-check/test-command allow rules)
├── [DONE] Leave `mergeClaudeSettings`'s generic deny plumbing alone — confirmed
│         `src/claude-settings.ts` has zero diff in this commit
└── [GAP]  Documentation consistency for the deleted feature was only partially completed.
          CLAUDE.md was corrected (a good, self-initiated bonus fix beyond the task's declared
          file scope). README.md — which documents the *identical* deny-rule content, added by
          task #84 specifically to describe this now-deleted behavior — was missed and still
          asserts the deny rules exist.

### Files Changed
- src/commands/init.ts — `CAIRN_TASK_DENY_RULES` and its doc comment deleted; `deny: [...]` line
  removed from `buildInitPermissionRules`; prompt copy in `installClaudeSettings` corrected
- test/commands/init.test.ts — 4 named assertions inverted/merged, plus 2 unnamed tests
  repointed from a deny-rule string to an equivalent allow-rule string
- CLAUDE.md — not in Expected Files; self-initiated correction of the same false claim
  (mechanism #3 and its "two facts" bullets removed, replaced with an accurate paragraph); this
  was the right call since the file is loaded into every future agent's context and the old text
  directly reintroduces the bug this task exists to fix
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/state.json,
  .cairn/.cairn_iterations.log — task-lifecycle bookkeeping (task #86 archived); expected loop
  mechanics, not a concern

### Gaps
- **README.md is stale.** `README.md:90-94` (Workflow > 1. Initialize, added by task #84) still
  documents a "Deny" bullet listing the five `cairn task` subcommands and a paragraph explaining
  why the deny rules exist — both now false, since `buildInitPermissionRules` no longer emits any
  `deny` content at all. A user reading the README after this change would be told to expect
  behavior (`cairn init` denying `cairn task start`/`complete`/etc.) that will not happen. This is
  the same class of staleness the task's own "bonus fix" correctly caught and fixed in CLAUDE.md,
  just missed in README.md. Not in the task's declared Expected Files, but it's a direct,
  immediate consequence of this exact change and — per this round's own established precedent
  (the task's own bonus CLAUDE.md fix, and task #83/#84's pattern of keeping docs in sync with
  code within the same round) — should have been caught here or filed as an explicit follow-up
  task. No follow-up task for this was found in the current `.cairn/tasks.json`.

### Regression Risks
- Behavioral regression risk in the code itself: none detected. `mergeClaudeSettings`'s generic
  deny support is untouched, no exports were removed (`buildInitPermissionRules`,
  `installClaudeSettings` keep their signatures), and the two tests repointed to a different
  allow-rule string still assert the same underlying invariant against the same fixture. Full
  suite passes (887/887, matches notes).
- Documentation regression: `README.md` now actively misinforms users about a security-relevant
  permission-seeding behavior (claiming a deny list exists when it doesn't) — see Gaps. This
  doesn't break any test (README has no lint/assertion harness in this repo, consistent with how
  task #84 itself was assessed), but it is a real, live inaccuracy in shipped user documentation
  as of this commit.

### Verdict
HAS_GAPS
