## Task #150: Config flag review.postRound
Reviewed: 2026-10-10

### Coverage
```
Task Requirements
├── src/types.ts
│   ├── [DONE] CairnConfig.review -> { postTask: boolean; postRound?: boolean }
│   └── [DONE] isValidConfig(): non-boolean postRound rejected inside the existing review block; absent stays valid
├── src/config.ts
│   ├── [DONE] loadConfig(): review.postRound = boolean value, else true (postTask default still false)
│   └── [DONE] exported isPostRoundReviewEnabled(config: Pick<CairnConfig, 'review'>) -> review?.postRound !== false
├── src/commands/init.ts
│   ├── [DONE] ConfigDefaults.reviewPostRound: boolean
│   ├── [DONE] getConfigDefaults(): config.review?.postRound ?? true
│   ├── [DONE] promptForConfig(): 'Enable post-round review?' via promptBoolean, immediately after the post-task question
│   └── [DONE] returned config writes review: { postTask, postRound }
├── Tests
│   ├── [DONE] isValidConfig accepts absent / true / false, rejects 'yes' (and 1)
│   ├── [DONE] loadConfig: postRound true when key absent, true when review absent, explicit false kept
│   ├── [DONE] isPostRoundReviewEnabled: no review, { postTask: true }, postRound true, postRound false
│   ├── [DONE] promptForConfig asks the new question right after the post-task one
│   ├── [DONE] empty input falls back to the passed default (both true and false)
│   ├── [DONE] resulting config and the cairn.json written by writeCairnJson into a temp dir contain review.postRound
│   └── [DONE] existing mocked answer sequences (allDefaultAnswers, runInit cases) and the ConfigDefaults literal updated
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json not touched by the commit
    └── [PARTIAL] TDD evidence (failing test command + failing line in completion notes) — not verifiable from here
```

Verification notes:
- Inspected `git diff 18bdc61..HEAD` (one commit, cb5d116) for all six files; the changed files match the Expected Files list exactly.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1209 pass, 0 fail).
- The working tree shows an uncommitted `cairn.json` change (healthCheck redirected to `/tmp/cairn-healthcheck`). It is not part of the commit, was already present before this review, and matches the documented user-managed pin for a self-modifying round, so it is not attributed to the task agent.

### Files Changed
- src/types.ts
- src/config.ts
- src/commands/init.ts
- test/types.test.ts
- test/config.test.ts
- test/commands/init.test.ts

### Gaps
- TDD evidence could not be verified. The task requires the failing test command and its failing line in `cairn task complete --notes`; the reviewer cannot run `cairn task show` and did not read the task files, so whether the notes contain it is unconfirmed. The code and tests themselves are complete.

### Regression Risks
None detected. `postRound` is optional on the type, so existing `review: { postTask }` literals still type-check (typecheck passed), and existing configs without the key still validate and load. Nothing consumes the flag yet, so `loadConfig()` now always emitting `review.postRound` changes no behavior; the only user-visible change is one extra `cairn init` question, which defaults to the existing/absent value on empty input.

### Verdict
HAS_GAPS

### Round Triage
Reviewed: 2026-10-11
1. TDD evidence in the completion notes could not be verified by the per-task reviewer: not fixing, a process note that cannot be acted on. The code and tests are complete in the current tree.

### Round Verdict
ACCEPTED

---

## Task #151: Round-review module: scratch paths and the append-only check
Reviewed: 2026-10-10T00:00:00Z

### Coverage
```
Task Requirements
├── src/round-review.ts (mode-neutral: imports only fs, path, BRAND, tempFilePath; no Commander, no process.exit)
│   ├── [DONE] roundReviewPromptFilePath -> tempFilePath(dataDir, 'round_review_prompt.md')
│   ├── [DONE] roundReviewSnapshotPath -> tempFilePath(dataDir, 'round_review_snapshot.md')
│   ├── [DONE] roundReviewRejectedPath -> tempFilePath(dataDir, 'round_review_rejected.md')
│   ├── [DONE] fixTaskFilePath -> <dataDir>/reviews/<BRAND.tempPrefix>round_review_fix_<n>.json (dataDir taken from the caller, never rebuilt from BRAND.dataDir)
│   ├── [DONE] isAppendOnly: pure, one trailing newline ignored on each side, greedy in-order subsequence match, empty snapshot -> true
│   ├── [DONE] snapshotReviewFile: copies to the snapshot path, overwrites, throws when the review file is unreadable
│   ├── [DONE] AppendOnlyResult type, exact three-member union
│   ├── [DONE] verifyAppendOnly: never throws; snapshot-missing leaves the review file alone; violation copies non-empty rejected content first, then restores; restored false only when the write-back fails; ok writes nothing; snapshot not deleted
│   └── [DONE] cleanupRoundReviewScratch: best-effort unlink of prompt + snapshot + reviews/<prefix>round_review_fix_\d+.json (prefix regex-escaped, anchored); rejected file and everything else untouched
├── test/round-review.test.ts (all in fs.mkdtempSync dirs)
│   ├── [DONE] isAppendOnly: append at end, mid-file insert, changed, deleted, reordered, trailing-newline difference (both directions), duplicate `---`/blank lines, empty snapshot
│   ├── [DONE] verifyAppendOnly: ok leaves file identical; changed / deleted / reordered -> violated + restored: true, file equals snapshot, rejected content in rejected file
│   ├── [DONE] verifyAppendOnly: deleted review file restored; missing snapshot -> snapshot-missing, review file untouched
│   ├── [DONE] cleanupRoundReviewScratch: removes prompt, snapshot, fix_1 and fix_12 JSON; keeps rejected file, round-21.md, tasks.json, state.json
│   └── [DONE] cleanupRoundReviewScratch: no throw on an empty dir and on a missing dir
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/round-review.test.ts` -> "error: Cannot find module '../src/round-review'"
```

Verification notes:
- Inspected `git diff --stat cb5d116..HEAD` (one commit, 18b3f87, two new files) and read both files in full via `git show HEAD:<path>`. The changed files match the Expected Files list exactly.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1227 pass, 0 fail).
- The scratch path names are confirmed by the passing `scratch paths` test, which asserts the literal `.cairn_round_review_*` names; I did not separately read `tempFilePath` in `src/utils.ts`.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff. The recorded failure is the module-not-found error for the whole file, not a per-assertion failure; that satisfies the instruction as written for a brand-new module.
- The uncommitted `cairn.json` change in the working tree predates this task and is the documented user-managed health-check pin; it is not part of the commit.
- Not covered by a test, and not required by the task's test list: the `restored: false` branch (write-back failure) and the "empty current content is not copied to the rejected file" branch. Both were checked by reading the code only.

### Files Changed
- src/round-review.ts
- test/round-review.test.ts

### Gaps
None detected

### Regression Risks
None detected. Both files are new and nothing imports the module yet, so no existing behavior changes.

Note for later tasks in this round (outside this task's scope, not counted as a risk here): `.cairn/.gitignore` has no entries for `.cairn_round_review_prompt.md`, `.cairn_round_review_snapshot.md`, `.cairn_round_review_rejected.md` or `reviews/.cairn_round_review_fix_*.json`, and `cairn init`'s gitignore seeding does not add them. `reviews/` is a committed directory, so once a caller starts writing these files they will show up as untracked and can be committed by accident unless a later task adds the ignore entries. The rejected file is also never removed by `sweepRoundTempFiles()` (its regexes need a `task_\d+_` segment) nor by `cleanupRoundReviewScratch()`, which is by design per this task's description.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. No gitignore entries for the round-review scratch files: not fixing, already resolved by task #158 (8bc7fb9), which added the `.cairn_round_review_*` pattern to `cairn init`'s seeding.
2. The rejected file is never removed by either cleanup: not fixing, by design and documented in CLAUDE.md (kept for the user).
3. The `restored: false` branch and the empty-content branch of the append-only check have no test: not fixing, a test-quality nit on branches that need a failing filesystem write.

### Round Verdict
ACCEPTED

---

## Task #152: Round-review phase tracking in state.json
Reviewed: 2026-10-11 (UTC date; the reviewer has no clock command, the commit under review is stamped 2026-10-11T02:19:53Z)

### Coverage
```
Task Requirements
├── src/task-counter.ts
│   ├── [DONE] readStateValue(dataDir, key): pure read via the private readState; undefined for missing file, non-object JSON, or absent key; never creates the file
│   ├── [DONE] updateStateValue<T>(dataDir, key, fn): state.json.lock + writeStateAtomic, same acquire / close / unlink pattern as bumpRound; returns fn's value
│   ├── [DONE] Every other field preserved (spread of the existing object); missing state.json created holding just the key
│   └── [DONE] Existing exports (reserveTaskIds, seedNextId, getRound, bumpRound) unchanged: the diff is additions only
├── src/round-review.ts
│   ├── [DONE] RoundReviewPhase, RoundReviewRecord, ROUND_REVIEW_STATE_KEY = 'roundReview', RoundReviewAction exported with the exact shapes asked for
│   ├── [DONE] readRoundReview: current round from getRound; absent / malformed / unknown phase / stored 'none' / other round all read as the none record; never throws, never writes
│   ├── [DONE] advanceRoundReview: a single updateStateValue call; ranks none=0, triage=1, fixing=2, closing=3, done=4, failed=4; `rank(to) <= rank(current)` is a no-op returning the current record
│   ├── [DONE] Forward move stores { round, phase, baselineTaskIds, fixTaskIds }; arrays kept unless patch replaces them; older-round record discarded, not merged; 'none' never stored
│   ├── [DONE] decideRoundReview: rules (a)-(f) in the specified order, pure
│   ├── [DONE] Doc comment gives the meaning of each stored phase and the one-fix-pass-per-round consequence
│   └── [DONE] Earlier exports of the module (paths, isAppendOnly, snapshotReviewFile, verifyAppendOnly, cleanupRoundReviewScratch) untouched
├── test/task-counter.test.ts (temp dirs)
│   ├── [DONE] updateStateValue preserves nextTaskId, round and an unknown key
│   ├── [DONE] updateStateValue creates a missing file holding just the key
│   ├── [DONE] reserveTaskIds / bumpRound afterwards still preserve roundReview
│   └── [DONE] Extra: readStateValue cases; lock released and nothing written when fn throws
├── test/round-review.test.ts (temp dirs)
│   ├── [DONE] readRoundReview: absent, missing file, unparseable file, 12 malformed shapes, other-round record, valid record
│   ├── [DONE] advanceRoundReview: full 6 x 5 from/to matrix, so every forward transition and every backward or same-rank move (incl. done -> failed, failed -> done) is asserted, with the on-disk state compared for no-ops
│   ├── [DONE] After bumpRound the old record reads as none and a new triage can be stored
│   ├── [DONE] patch arrays stored and surviving a later advance without a patch; a no-op ignores its patch
│   └── [DONE] decideRoundReview table: flag off with and without ready tasks, missing review file skips, pending triage / closing with ready tasks, fixing with ready tasks -> task, fixing with none -> closing, done / failed -> done
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json, .cairn/state.json not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/task-counter.test.ts test/round-review.test.ts` -> "SyntaxError: Export named 'updateStateValue' not found in module ..."
```

Verification notes:
- Inspected `git diff 18b3f87..HEAD` (one commit, 78029e8, four files, 501 insertions and 1 deletion, the deletion being the rewritten import line in `test/task-counter.test.ts`). The changed files match the Expected Files list exactly. Read `src/task-counter.ts` lines 1-200 in the working tree to check `readState`, `writeStateAtomic`, `getRound` and `bumpRound` against the new accessors.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1294 pass, 0 fail). The log confirms both exit codes were 0.
- `git diff 18b3f87..HEAD --stat -- .cairn/state.json cairn.json install.sh package.json` is empty. The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff. The recorded failure is a missing-export error for both test files, not a per-assertion failure.
- No-op behaviour: `updateStateValue` always writes, so a no-op advance rewrites state.json with the same stored value. The matrix test asserts the parsed content is identical before and after. Since every writer goes through `JSON.stringify(state, null, 2)`, this causes no formatting churn in the committed file after the first write.
- The claim that `getRound` is safe inside the `updateStateValue` callback was checked by reading it: it calls `readState` only and takes no lock.

### Files Changed
- src/round-review.ts
- src/task-counter.ts
- test/round-review.test.ts
- test/task-counter.test.ts

### Gaps
None detected

### Regression Risks
None detected. The change is additive, and nothing outside the tests calls the new functions yet, so no existing behavior changes.

Notes for the task that wires this into `cairn round next` (outside this task's scope, not counted as risks here):
- Round-number collision when state.json has no `round`. `getRound` reads an absent round as 1, and `bumpRound` turns an absent round into 1. A record stored while `round` is absent is therefore stamped `round: 1`, and after the next `cairn round new` it still matches the current round. A project whose state.json has no `round` key (one that predates rounds, or one that never ran `/generate-tasks`) that finishes a post-round review at `done` would have the following round read as already `done`, and its post-round review would be skipped without any message. The test "works with no state.json (round 1)" shows the record being stored in that state. The spec asked for `getRound`, so the implementation is as specified; the wiring task should decide whether to handle it (for example, clear `roundReview` in `cairn round new`).
- An unparseable state.json reads as null in `readState`, so `advanceRoundReview` would replace the whole file with just `roundReview`, dropping `nextTaskId` and `round`. `bumpRound` and `reserveTaskIds` already behave the same way, and `nextTaskId` is re-seeded from the task files, but `round` would fall back to 1.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. Round-number collision when state.json has no `round` key (a finished record is stamped round 1 and still matches after the first `cairn round new`, so that round's review is skipped without a message): still applies. Checked in the current tree: `getRound` reads an absent round as 1, `bumpRound` sets an absent round to 1, and nothing clears the record. Planned fix (task #162): `cairn round new` clears the `roundReview` record, with tests for the absent-round case.
2. An unparseable state.json is replaced by a file holding only `roundReview`: not fixing, the same pre-existing behaviour as `bumpRound` and `reserveTaskIds`, and an unlikely case.

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #162 (0b1c4eb). Differs from plan: no difference in effect. The clearing is done by a new `startNewRound()` in `src/round-review.ts`, which calls `bumpRound(dataDir, { clear: ['roundReview'] })`, so the record is removed in the same locked write as the round bump; `roundNewCommand` now defaults to it. Tests cover the absent-round case and the existing-round case. The #162 review section is CLEAN with no gaps or risks.

### Round Verdict
RESOLVED

---

## Task #153: Round-review prompt builders (triage and closing) and the UNRESOLVED counter
Reviewed: 2026-10-11 (UTC date; the reviewer has no clock command, the commit under review is stamped 2026-10-11T02:23:44Z)

### Coverage
```
Task Requirements
├── src/settle.ts
│   └── [DONE] findTaskCommits(projectRoot, taskId): beside findTaskBaseSha, same execGit `log --reverse --format=%H --fixed-strings --grep=Task #<id>:` call, oldest first, [] on no match or git failure
├── src/round-review.ts (earlier exports untouched: the diff is additions plus three import lines)
│   ├── [DONE] ROUND_VERDICTS = ['RESOLVED', 'UNRESOLVED', 'ACCEPTED'] as const (plus a RoundVerdict type)
│   ├── [DONE] reviewedTaskIds: line-anchored heading match, file order, de-duplicated
│   ├── [DONE] countUnresolved: sections split at task headings; UNRESOLVED as the next non-blank line after the round-verdict heading, or a triage heading with no round-verdict heading; preamble text and text with no sections count 0
│   ├── [DONE] buildTriagePrompt with the specified signature
│   │   ├── [DONE] review file path, task list (id, title, directory), distinct test commands with the "exactly these" rule
│   │   ├── [DONE] read EVERY finding (Gaps, Regression Risks, [PARTIAL]/[GAP], minor notes under CLEAN, do not filter on the verdict), verify against the CURRENT tree, de-duplicate
│   │   ├── [DONE] FIX / LEAVE rubric, all seven rows
│   │   ├── [DONE] fix-task creation: real fixTaskFilePath pattern (n, 1, 2), every field, NO id, exact `cairn task add --file <path>` as a single command, the hook warning, `assigned id: <n>`
│   │   ├── [DONE] one fix task per underlying issue with the cost reason; never edit tasks.json; no unblocking; no reviewing incomplete work; continue an interrupted run without duplicates
│   │   ├── [DONE] what to write: triage block after the section's verdict value; ACCEPTED with no outcome block when nothing needs a fix; no blocks for a section with no findings
│   │   └── [DONE] append-only rule in plain words and the final `TRIAGED: <n> fix task(s), see <path>` line
│   ├── [DONE] FixTaskInfo and buildClosingPrompt with the specified shapes
│   │   ├── [DONE] review file path; per fix task its id, title, status, completion notes, `git show <sha>` per commit, or the no-commits statement
│   │   ├── [DONE] fix tasks' own sections are EVIDENCE, get no triage blocks, one fix pass per round
│   │   ├── [DONE] learn from the diff, notes and own review section, NOT from the triage plan
│   │   ├── [DONE] outcome block then round verdict for every section with a triage block and no round verdict; never edit the triage block; RESOLVED / UNRESOLVED conditions
│   │   └── [DONE] same append-only rule and the final `CLOSED: <resolved> resolved, <unresolved> unresolved, see <path>` line
│   └── [DONE] writeRoundReviewPromptFile(opts, deps?): resolveReviewFilePath, writes to roundReviewPromptFilePath(dataDir), returns the path
│       ├── [DONE] triage: ids from the review file headings, loadArchivedTask per id, `(not in archive)` with no tests when absent
│       └── [DONE] closing: archive (status complete) -> plain JSON.parse of tasks.json (real status and notes) -> status missing; commits from findTaskCommits (injectable)
├── Tests
│   ├── [DONE] test/settle.test.ts: temp git repo next to the findTaskBaseSha tests; oldest-first order, #7 vs #70, no match, outside a repo
│   ├── [DONE] both prompts name the review path; triage carries each task id, de-duplicated test commands, rubric rows, three block headings, the exact `cairn task add --file` form and the fix-file path
│   ├── [DONE] append-only wording asserted for both prompts, plus a regex guard against rewrite/replace/delete/remove/modify wording
│   ├── [DONE] closing prompt: each fix task's status and commits, empty commit list, no fix tasks at all
│   ├── [DONE] writeRoundReviewPromptFile: prompt path for both passes, ids from headings (an older archived task is not listed), blocked fix task from tasks.json, missing task, unparseable tasks.json, missing review file
│   └── [DONE] reviewedTaskIds / countUnresolved on a multi-section file with UNRESOLVED, RESOLVED, ACCEPTED, triage-without-verdict, no round blocks, a repeated task id, and CRLF
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json and .cairn/reviews/ not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/round-review.test.ts test/settle.test.ts` -> "SyntaxError: Export named 'findTaskCommits' not found in module ..."
```

Verification notes:
- Inspected `git diff 78029e8..HEAD` in full (one commit, 5477436, four files, 659 insertions, no deletions). The changed files match the Expected Files list exactly. Read the pre-existing half of `src/round-review.ts`, `src/task-archiver.ts` (`loadArchivedTask`) and the import headers of `src/settle.ts` and `src/post-task-reviewer.ts` in the working tree.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1320 pass, 0 fail). I did not open the full log.
- Import cycle check: `src/round-review.ts` now imports `./settle`, `./post-task-reviewer` and `./task-archiver`. Neither `settle.ts` nor `post-task-reviewer.ts` imports `round-review`, so there is no cycle today.
- The prompt's `cairn task add --file <path>` form and its `assigned id:` output line were checked only as far as confirming that `src/commands/task.ts` contains the string `assigned id`; I did not read the command's implementation. The hook has no `post-round-reviewer` scope yet (task #155), so the prompt's "a hook denies anything else" sentence describes behaviour a later task adds.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff. The recorded failure is a missing-export error for both test files, not a per-assertion failure.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Reviewer tooling note: three of my inspection commands (`git -C`, `git grep`, and a `tail`/`grep` pipeline) were denied by the containment hook; I used plain `git diff` / `git status` and the Read tool instead, so nothing above depends on a command that did not run.

### Files Changed
- src/round-review.ts
- src/settle.ts
- test/round-review.test.ts
- test/settle.test.ts

### Gaps
None detected

### Regression Risks
None detected. The change is additive, and nothing outside the tests calls the new functions yet, so no existing behavior changes.

Notes for the tasks that wire this in (#156, #157) and for the round review itself (behaviour is as specified, so not counted as risks here):
- The parsers are not fence-aware. `reviewedTaskIds` and `countUnresolved` match any line that, after trailing whitespace is trimmed, starts with the task heading or equals a round-block heading, including lines inside a fenced code block. A per-task review that quotes the round-triage heading on a line of its own (likely for reviews of this round's own tasks, which are about those headings) would be counted as one UNRESOLVED section by `countUnresolved`, and the closing prompt's "every section that has a triage block and no round verdict" instruction would also pick it up. This section deliberately keeps those headings off the start of any line.
- A round-verdict heading followed by nothing, or by any value other than the exact word UNRESOLVED (a typo, trailing punctuation, lower case), counts 0, so an interrupted or malformed closing write is reported as resolved rather than unresolved. The test `v('UNRESOLVED, sort of')` -> 0 pins this.
- The closing prompt reports an archived fix task as `complete` without checking whether its own review raised concerns; that judgement is left to the agent reading the fix task's review section, as the spec says.
- `src/round-review.ts` now pulls in `settle.ts` and its imports. Its header still says "mode-neutral", which holds (no Commander, no process.exit), but the module is no longer cheap to import; `cairn hook` must keep not importing it.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. The review-file parsers are not fence-aware, so a quoted round-block heading on a line of its own would be counted: not fixing, behaviour is as specified and the case is unlikely (it needs a reviewer to put such a heading alone on a line; none in this file does).
2. A round-verdict heading followed by a missing or malformed value counts as not unresolved: not fixing, as specified and pinned by a test; an unlikely case.
3. The closing prompt reports an archived fix task as `complete` without checking its review: not fixing, as specified; the closing agent reads the fix task's review section.
4. `src/round-review.ts` is no longer cheap to import: not fixing, a note only. Checked: `src/commands/hook.ts` does not import it.

### Round Verdict
ACCEPTED

---

## Task #154: post-round-reviewer agent definition (and cairn watch default)
Reviewed: 2026-10-11 (UTC date; the reviewer has no clock command, the commit under review is stamped 2026-10-11T02:26:02Z)

### Coverage
```
Task Requirements
├── agents/post-round-reviewer.md (new, modelled on agents/post-task-reviewer.md)
│   ├── [DONE] Frontmatter has exactly the six keys: name, description (one line), internal: true, tools: Read, Grep, Glob, Bash, Edit, Write, model: opus, maxTurns: 100
│   ├── [DONE] Body: the user prompt names a prompt file, read it in full and follow it; written by `cairn round next`; says which pass (TRIAGE or CLOSING); carries the review file path, task lists and block formats
│   ├── [DONE] Role: round-level review, sees the final tree, de-duplicates across task sections, drops what later tasks resolved, reads past the per-task verdicts
│   ├── [DONE] APPEND-ONLY RULE: only adds lines; never changes, removes or reorders; the CLI checks against a snapshot, restores the file and discards the pass
│   ├── [DONE] What it may do: write only inside the reviews directory; the five git inspection commands; exactly `cairn task add --file <path>`; no redirection, `$`, backticks or `--output`; Grep/Glob/Read rather than shell grep
│   ├── [DONE] Never edits tasks.json directly, never fixes code, never unblocks tasks
│   ├── [DONE] Block formats and verdict words: the three round-block headings and RESOLVED / UNRESOLVED / ACCEPTED, compared line by line against BLOCK_FORMAT, the heading constants and ROUND_VERDICTS in src/round-review.ts; spellings identical
│   └── [DONE] Final response: single line, `TRIAGED: <n> fix task(s), see <review file path>` and `CLOSED: <resolved> resolved, <unresolved> unresolved, see <review file path>`, identical to the two prompt builders
├── src/transcripts.ts
│   └── [DONE] "post-round-reviewer" added to DEFAULT_AGENT_TYPES
├── Tests
│   ├── [DONE] test/transcripts.test.ts default-filter assertion updated to the three-element list
│   ├── [DONE] test/commands/init.test.ts, inside describe('installAgents'): installAgents(tmpDir, real repo root) installs the file into a temp dir, byte-identical to the source
│   ├── [DONE] Frontmatter assertions: name, internal, model, tools line (plus maxTurns)
│   └── [DONE] Content assertions: three block headings, every ROUND_VERDICTS word (imported from src/round-review.ts), `cairn task add --file`, `TRIAGED:` and `CLOSED:`
└── Round constraints
    ├── [DONE] src/round-review.ts unchanged; cairn.json, install.sh, package.json not touched by the commit
    ├── [DONE] The agent was not copied into this repo's own .claude/agents/ (a Read of that path reports the file does not exist)
    └── [DONE] TDD evidence in completion notes: `bun test test/commands/init.test.ts test/transcripts.test.ts` -> "(fail) installAgents > installs post-round-reviewer.md byte-identical and its definition names the formats and verdicts" and "(fail) listAgentTranscripts > filters, sorts, handles bad meta"
```

Verification notes:
- Inspected `git diff 5477436..HEAD` in full (one commit, 2eb40e3, four files, 97 insertions and 2 deletions). The four changed files are all in the Expected Files list; the fifth listed file, `src/round-review.ts`, was read-only by design and is unchanged.
- Read `src/round-review.ts` and `agents/post-task-reviewer.md` in the working tree and compared the new agent file against them.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1321 pass, 0 fail). I did not open the full log.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Not verifiable from here: that Claude Code accepts `model: opus` and `maxTurns: 100` in agent frontmatter and that a real `/cairn-run` session can launch the agent. Nothing launches it yet (tasks #156, #157, #159).
- Reviewer tooling note: commands using `cd`, `ls`, `grep` and `git -C` were denied by the containment hook; I used plain `git diff` / `git log` / `git status` and the Read tool, so nothing above depends on a command that did not run.

### Files Changed
- agents/post-round-reviewer.md
- src/transcripts.ts
- test/commands/init.test.ts
- test/transcripts.test.ts

### Gaps
None detected

### Regression Risks
None detected. The agent file is new and nothing launches it yet. The only behaviour change is that `cairn watch` without `--all` now also follows `post-round-reviewer` transcripts, which is what the task asked for.

Minor notes (not counted as gaps or risks):
- Stale wording left by the `DEFAULT_AGENT_TYPES` change, in files outside this task's list. The `--all` option's help text in `src/index.ts` still reads "Show every subagent, not just cairn-task-agent / post-task-reviewer", and the `all` field comment on `WatchOptions` in `src/commands/watch.ts` says the same. Both now omit `post-round-reviewer`. No remaining task covers them: #155 may change only the `hook pre-tool-use` description in `src/index.ts`, and #160 covers `CLAUDE.md` and `README.md` but is told not to change any source file.
- The guard test checks the body strings against the whole file rather than the part after the frontmatter. That is harmless today because the frontmatter contains none of them. The `RESOLVED` check is satisfied by the substring inside `UNRESOLVED`, so the test would still pass if the standalone word were removed from the agent file.
- The agent file's `UNRESOLVED` line reads "blocked, missing or incomplete, or its own review raised concerns", while `BLOCK_FORMAT` in `src/round-review.ts` reads "blocked, or its own review raised concerns". The longer wording matches the closing prompt's own instruction line, and the agent file defers to the prompt file where they differ, so there is no conflict.
- The agent file tells the agent it may run only git inspection and `cairn task add --file <path>`, but the `/cairn-run` hook has no `post-round-reviewer` scope until task #155 lands. Until then that limit is prompt-only.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. Stale `--all` wording that omits `post-round-reviewer`: still applies. Confirmed in `src/commands/watch.ts` (the `all` field comment); the `src/index.ts` help text was not re-read and is to be checked by the fix task. Planned fix (task #163): update both descriptions.
2. The guard test checks the whole file and its `RESOLVED` check is satisfied by `UNRESOLVED`: not fixing, a test-quality nit.
3. The agent file's `UNRESOLVED` wording is longer than `BLOCK_FORMAT`'s: not fixing, no conflict; the agent file defers to the prompt file.
4. The agent's command limit was prompt-only until the hook scope landed: not fixing, already resolved by task #155 (0180a8f).

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #163 (59f28f2). Differs from plan: none. Both descriptions (the `all` field comment in `src/commands/watch.ts` and the `--all` help text in `src/index.ts`) now name `post-round-reviewer`, and a new test in `test/commands/watch.test.ts` reads the registered option's description. The #163 review section's verdict is HAS_GAPS, for a process point only: the completion notes carry no failing test command or failing line from before the fix, which `CLAUDE.local.md` asks for. That review states it has no effect on the shipped text or code, so it is reported here and not counted against this fix.

### Round Verdict
RESOLVED

---

## Task #155: Hook scope for post-round-reviewer
Reviewed: 2026-10-11 (UTC date; the reviewer has no clock command, the commit under review is stamped 2026-10-11T02:28:49Z)

### Coverage
```
Task Requirements
├── src/commands/hook.ts
│   ├── [DONE] ROUND_REVIEWER_AGENT_TYPE = 'post-round-reviewer' added and exported
│   ├── [DONE] Edit/Write: same `target !== null && isInside(ctx.reviewsDir, target)` check; rule 1 (tasks.json) still runs first; deny reason names post-round-reviewer
│   ├── Bash
│   │   ├── [DONE] Blanket ban on backtick, `<`, `>`, `$` kept exactly (the `/[`<>$]/` line is unchanged)
│   │   ├── [DONE] hasOutputOption still applied to every subcommand, before the per-subcommand match
│   │   ├── [DONE] Every subcommand is a git inspection prefix match OR matches the task-add regex
│   │   ├── [DONE] Regex is the specified one, character for character, with the binary name from BRAND.name
│   │   ├── [DONE] Other cairn forms denied: no --file, --file=<path>, trailing flags or arguments, the other task subcommands, round, hook
│   │   └── [DONE] Deny reason lists the git prefixes and the `cairn task add --file <path>` form
│   ├── [DONE] Scope code shared: isInspectionOnly(command, alsoAllowed?) plus one helper, decideReviewerScope, driven by a REVIEWER_SCOPES table
│   └── [DONE] post-task-reviewer unchanged: no alsoAllowed, both deny reasons build to the same strings as before
├── src/index.ts
│   └── [DONE] Only the `hook pre-tool-use` .description(...) string changed (one line in the diff)
├── test/commands/hook.test.ts (new describe, existing subagent() helper and CTX)
│   ├── [DONE] Write/Edit inside reviews/ allowed, including reviews/.cairn_round_review_fix_1.json
│   ├── [DONE] Write and Edit to src/x.ts, a data-dir file, the reviews dir path itself, `../` escapes and a prefix-sharing sibling dir denied, exact reason asserted
│   ├── [DONE] tasks.json denied by rule 1
│   ├── [DONE] Each git inspection prefix allowed, bare and with an argument
│   ├── [DONE] Allowed: absolute path, relative path, double-quoted and single-quoted path with a space, `git log --oneline -3 && cairn task add --file x.json`
│   ├── [DONE] All 14 denied commands listed in the task are present, plus 21 more; each asserts the reason names the agent, every git prefix and the task-add form
│   ├── [DONE] post-task-reviewer still denied `cairn task add --file a.json`; its Bash and file deny reasons pinned as exact literal strings
│   └── [DONE] Existing rule-2 tests unmodified: the test diff is one added import line and one added describe block, no deletions
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json and .claude/ not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/commands/hook.test.ts` -> "SyntaxError: Export named 'ROUND_REVIEWER_AGENT_TYPE' not found in module ..."
```

Verification notes:
- Inspected `git diff 2eb40e3..HEAD` in full (one commit, 0180a8f, three files, 217 insertions and 19 deletions). The changed files match the Expected Files list exactly. Read the post-change `src/commands/hook.ts` in the working tree, and `splitSubcommands` in `src/claude-settings.ts`.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1394 pass, 0 fail). I did not open the full log.
- "Byte-for-byte unchanged" for post-task-reviewer was checked two ways: by comparing the removed and added template strings in the diff (the new reason is the old one with the agent name and the allowance phrase substituted back in), and by the two new tests that compare against literal strings rather than against values built from the same constants.
- `splitSubcommands` splits on `&&`, `||`, `;`, `|`, `&` and newlines without regard to quotes, so a quoted path containing any of those is split before the regex sees it and is denied. That errs on the deny side, and the completion notes say so.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff. The recorded failure is a missing-export error for the whole file, not a per-assertion failure.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Not verified: the hook's behaviour in a real `/cairn-run` session with a `post-round-reviewer` subagent. The task forbids running `cairn hook` against this project, the pinned binary predates the change, and nothing launches that agent yet. The policy is covered only through `decidePreToolUse` unit tests. I also did not read `cairn task add --file`'s implementation in `src/commands/task.ts`.
- Reviewer tooling note: `git grep` and a `tail` command were denied by the live hook. One compound command that began with `cd` and chained several git commands ran instead of being denied, which the live per-task-reviewer scope should not allow. I did not investigate; `.cairn/.cairn_hook_errors.log` would show whether the hook failed open on that call.

### Files Changed
- src/commands/hook.ts
- src/index.ts
- test/commands/hook.test.ts

### Gaps
None detected

### Regression Risks
None detected. Rule 2 was restructured from an inline branch into a table plus a helper, but for `post-task-reviewer` the conditions and both reason strings are the same, and the pre-existing rule-2 tests pass unmodified. Agent types other than the two reviewers still fall through to allow; a test pins that `post-round-reviewer-2` is not contained.

Minor notes (the code matches the specified regex, so these are not counted as gaps or risks):
- The bare-path branch of the task-add regex, `[^\s'"\\]+`, accepts characters that bash expands into several words: braces, `*`, `?` and `~`. `cairn task add --file {a.json,--title,X,--description,Y}` matches the regex as one path argument, and bash would deliver it as `--file a.json --title X --description Y`. So "exactly one path argument, nothing after it" holds for the command text but not for the argv the binary receives. The effect is limited: the subcommand is still `cairn task add`, which the agent may run anyway, no other cairn subcommand becomes reachable, and the `$`, backtick and redirection bans still apply. Excluding `{`, `}`, `*`, `?`, `[` and `~` from the bare branch would close it. No test covers a brace or glob form.
- A bare path may start with `-`, so `cairn task add --file --title` is allowed. Whether the option parser treats `--title` as the file name or as a flag was not checked.
- CLAUDE.md's "Enforcement under /cairn-run" section still describes only the post-task-reviewer scope. That file is outside this task's scope and task #160 covers the documentation.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. The bare-path branch of the task-add regex accepts brace, glob and tilde characters that bash expands into several words: still applies (confirmed in `TASK_ADD_FILE_RE`, `src/commands/hook.ts`). Containment. Planned fix (task #161): exclude those characters from the bare branch, with deny tests.
2. A path may start with `-`, so `cairn task add --file --title` is allowed: still applies. Planned fix (task #161): reject a leading `-` in all three path forms.
3. A `cd`-prefixed compound command ran under the live per-task-reviewer scope instead of being denied (tooling note; also raised in the #156, #157, #158 and #159 sections): cause not established. By reading the current source such a command should be denied (`cd <dir>` matches no inspection prefix), `.cairn/.cairn_hook_errors.log` does not exist, the live hook was the pinned older binary, and the exact command was not recorded. I did not reproduce it. Containment, so planned fix (task #161): add tests that pin the deny for both reviewer types through the policy function and the command handler, fix the code if any fails, and otherwise report the cause as unexplained.
4. CLAUDE.md's enforcement section described only the post-task-reviewer scope: not fixing, already resolved by task #160 (a35ab86).

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #161 (666167a). Differs from plan: none. The bare-path branch of `TASK_ADD_FILE_RE` now also excludes `{ } * ? [ ] ~`; the quoted branches still accept them. Deny tests added for the brace, glob and tilde forms.
2. Fixed by #161 (666167a). Differs from plan: none. All three path forms start with a `(?!-)` lookahead, with deny tests for bare and quoted leading-dash paths. Not part of the plan: the post-round-reviewer Bash deny reason gained a clause stating the path restriction, and README.md's containment bullet was corrected as well as CLAUDE.md's.
3. Not resolved. #161 (666167a) added the planned tests for both reviewer types through `decidePreToolUse`, plus one `preToolUseHookCommand` test; all of them passed against the unchanged code, so no policy code was changed and the cause was reported as unexplained, as the plan allowed. The #161 review section then recorded the anomaly happening again under `post-task-reviewer`, with the exact command: `cd <project root> && git log ... && git diff --stat ... && git diff ...` ran, while a call in the same batch with the same `cd` prefix followed by non-git commands was denied. The #162 review section recorded it once more. So the current source denies this shape in tests while a live session let it run, and why is not established: the candidates named in those sections are the pinned binary, or the call reaching the hook in a different form or not at all. Neither was tested, and no `cairn hook` run was made by anyone. One observation from this pass: a `git -C <project root> show ...` call of mine was denied, and the deny reason carried the wording #161 added, so the hook answering in this session is a post-#161 build. I did not try a `cd`-prefixed command. Left for the user; the #161 section describes a direct temp-dir check that would separate the two candidates.

### Round Verdict
UNRESOLVED

---

## Task #156: cairn round next: the round-review verdict and round-done's unresolved count
Reviewed: 2026-10-11T02:32:31Z (the commit's timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── Types
│   ├── [DONE] RoundNextResult gains { verdict: 'round-review'; pass: 'triage' | 'closing'; promptFile; next }
│   └── [DONE] round-done variant is { blocked; unresolved; roundReviewFailed?: true; next }
├── pickNext() flow
│   ├── [DONE] (a) pending per-task review still first, code unchanged
│   ├── (b) pending round-review pass, before task selection
│   │   ├── [DONE] isPostRoundReviewEnabled, readRoundReview, resolveReviewFilePath + fs.existsSync, decideRoundReview({ readyTasksRemain: true })
│   │   ├── [DONE] existing snapshot kept; a new one only when the snapshot file is missing (and the review file exists)
│   │   ├── [DONE] prompt file rewritten with writeRoundReviewPromptFile
│   │   └── [DONE] returns round-review; tasks.json is not read and no task is selected
│   ├── [DONE] (c) readTasksFile + selectNextTask unchanged; a ready task takes the existing task path (also in phase fixing)
│   ├── (d) no ready task
│   │   ├── [DONE] orphan prune kept, runs before the round-review decision
│   │   ├── [DONE] fresh triage: snapshot (overwrites a stale one) -> prompt -> advanceRoundReview('triage', { baselineTaskIds: every id in tasks.json }); no sweep
│   │   ├── [DONE] fresh closing: snapshot -> prompt -> advanceRoundReview('closing'); no sweep
│   │   └── [DONE] done: blocked count, sweepRoundTempFiles, unresolved via a non-throwing file read (0 when unreadable), roundReviewFailed only when phase is failed, cleanupRoundReviewScratch
│   ├── [DONE] round-review `next` hint matches the specified wording, binary name from BRAND.name
│   ├── [DONE] round-done `next`: old wording byte-identical when nothing is unresolved or failed; mentions the unresolved count and the failed append-only check otherwise; still ends with notify and stop
│   ├── [DONE] no health check and no run-state iteration bump for a round-review verdict
│   ├── [DONE] roundWarnings wrapping unchanged
│   ├── [DONE] module doc comment and the `round next` description string updated
│   └── [DONE] no `review-settle` subcommand added; the `round` group description left for the later task
├── src/round-review.ts
│   └── [DONE] one small mode-neutral addition: countUnresolvedInFile (wraps countUnresolved, 0 when unreadable)
├── Tests (test/commands/round.test.ts, temp-dir harness)
│   ├── [DONE] postRound absent and true -> triage; prompt, snapshot, state.json phase + baselineTaskIds; scratch NOT swept; no health call; iteration stays 0
│   ├── [DONE] second call without settling -> triage again, snapshot unchanged after the review file was modified
│   ├── [DONE] pending triage (and pending closing) returned even with a ready task; no attempt record, no task prompt
│   ├── [DONE] phase fixing + ready task -> ordinary task verdict
│   ├── [DONE] phase fixing + no ready task -> closing, phase closing, arrays preserved
│   ├── [DONE] phase done -> round-done with unresolved 2 of 4 sections; prompt / snapshot / fix-JSON scratch removed
│   ├── [DONE] phase failed -> round-done with roundReviewFailed: true
│   ├── [DONE] flag false -> round-done with the old wording plus unresolved; state.json not created
│   ├── [DONE] no review file -> round-done, nothing stored
│   ├── [DONE] only blocked tasks + review file -> triage with those ids as the baseline; blocked task's tests log kept
│   ├── [DONE] pending per-task review wins over a pending round-review pass
│   ├── [DONE] existing round-done tests updated for `unresolved`
│   └── [DONE] extras: stale snapshot overwritten, missing snapshot retaken, ready task beats a fresh triage, flag false ignores a stored pending pass, current round's file is the one used, orphan prune, roundNextCommand output with warnings
└── Round constraints
    ├── [DONE] src/commands/run.ts, cairn.json, install.sh, package.json not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/commands/round.test.ts` -> 62 pass / 20 fail, with three named `(fail)` lines
```

Verification notes:
- Inspected `git diff 0180a8f..HEAD` in full (one commit, 5dbc3bb, three files, 427 insertions and 15 deletions). The changed files match the Expected Files list exactly. Read the post-change `src/commands/round.ts` and `src/post-task-reviewer.ts` via `git show HEAD:<path>`, and `src/round-review.ts` in the working tree.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1415 pass, 0 fail). I did not open the full log.
- The 15 deletions are the two replaced `next` strings, renumbered step comments, widened import lines, and three existing assertions widened to include `unresolved`. No test was removed. One existing test ("never sweeps run state, logs, ...") now passes `review.postRound: false`, because it writes a review file and with the default-on flag that would start a triage pass instead of ending the round; what it asserts is unchanged.
- A thrown error on the new paths (for example `snapshotReviewFile` on a review file that cannot be read) is caught by `roundNextCommand`'s existing catch-all and becomes exit 1 with one stderr line, the same as any other failure of the command.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Not verified: behaviour in a real `/cairn-run` session. The task forbids running `cairn round` against this project and the pinned binary predates the change, so the flow is covered only by `roundNext` / `roundNextCommand` tests against temp dirs. `isPostRoundReviewEnabled` and `getRound` were not re-read; their behaviour here rests on the passing tests (default-on, and no state.json created when the flag is off).
- Reviewer tooling note: a pipeline using `cat` / `tail` was denied by the containment hook. As in the previous section, one compound command that began with `cd` and chained several git commands ran instead of being denied. I did not investigate.

### Files Changed
- src/commands/round.ts
- src/round-review.ts
- test/commands/round.test.ts

### Gaps
None detected

### Regression Risks
None detected. With `review.postRound: false`, or with no review file for the round, `round next` returns the same verdicts and the same `next` wording as before, plus the new `unresolved` field. The one deliberate behaviour change is the one the task asks for: with the flag on (the default) and a review file present, round end now hands out a triage pass instead of `round-done`.

Minor notes (behaviour is as specified, or outside this task's scope; not counted as gaps or risks):
- The code at this commit is not usable on its own. The `round-review` verdict's `next` names `cairn round review-settle`, which does not exist until task #157, and `commands/cairn-run.md` does not handle the verdict until #159. Nothing but a settle moves the phase past `triage`, so a binary built from this commit would hand out the same triage pass on every `round next` and never reach `round-done`. The pinned binary driving this round predates the change, so the current round is unaffected. If #157 ends up blocked, do not unpin and run the post-round `cairn round next` step in this repo (this round has a review file) without first setting `review.postRound: false`.
- `resolveReviewFilePath` creates `<dataDir>/reviews/` as a side effect, and step 2 now calls it on every `round next` that gets past the per-task-review check, including with `review.postRound: false` and on ordinary `task` picks. Harmless, and the completion notes say so, but `round next` used to create nothing there.
- A pending pass whose snapshot is missing takes a new snapshot of the review file as it is at that moment, as the task specifies. Whatever the interrupted agent already wrote, including a changed or deleted line, becomes the baseline for the append-only check. A pending pass whose review file is gone is handed out with no snapshot at all; settle (#157) is specified to turn that into a failed round review.
- The round-number collision described in the Task #152 section (a state.json with no `round` key stamps the record as round 1, which still matches after the first `cairn round new`) is not handled here, and no remaining task mentions it. The effect would be a later round's review skipped without any message, in a project whose state.json has no round yet.
- `unresolved` comes from the non-fence-aware parser described in the Task #153 section and is reported even when no round review ran (flag off, phase none). A per-task review that quotes a round-block heading on a line of its own would be counted. This section keeps those headings off the start of any line.
- With the flag off, a `triage` or `closing` phase left in state.json is ignored and its scratch is removed at round-done, so turning the flag off mid-review abandons that review without a message. Pinned by a test, and consistent with the flag meaning "off".

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. The code at this commit was not usable on its own (no `review-settle`, no instructions for the verdict): not fixing, already resolved by tasks #157 (4979c74) and #159 (1dca29f).
2. `resolveReviewFilePath` creates the reviews directory on every `round next`: not fixing, harmless.
3. A pending pass whose snapshot is missing takes a new snapshot of the file as it then is: not fixing, as specified and documented in CLAUDE.md.
4. Round-number collision when state.json has no `round` key: still applies, the same issue as in the Task #152 section. Planned fix (task #162): `cairn round new` clears the `roundReview` record.
5. `unresolved` comes from the non-fence-aware parser: not fixing, same issue and reason as in the Task #153 section.
6. Turning the flag off mid-review abandons that review without a message: not fixing, pinned by a test and consistent with the flag meaning off.
7. A `cd`-prefixed compound command ran under the live hook (tooling note): cause not established, same issue as item 3 in the Task #155 section. Planned fix (task #161): tests that pin the deny, and a code fix if any fails.

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #162 (0b1c4eb). Differs from plan: none in effect; see the outcome in the Task #152 section (`startNewRound()` clears the record in the same locked write as the round bump).
2. Not resolved. #161 (666167a) added the tests; all passed against the unchanged code, no code was changed, and the anomaly recurred in the #161 and #162 reviews. Same issue and same outcome as item 3 in the Task #155 section.

### Round Verdict
UNRESOLVED

---

## Task #157: cairn round review-settle
Reviewed: 2026-10-11T02:36:25Z (the commit's timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── src/round-review.ts (mode-neutral: no Commander, no process.exit; the diff is one import line plus additions)
│   ├── [DONE] RoundReviewSettleVerdict exported with the three specified variants, field for field
│   ├── [DONE] settleRoundReview(input, deps?) with the specified signature (deps typed as an exported RoundReviewSettleDeps)
│   ├── [DONE] every verdict's `next` is `Run: cairn round next`, binary name from BRAND.name
│   ├── [DONE] phase not triage/closing -> no-round-review with the current phase; returns before any read of tasks.json, any write, or any log line
│   ├── [DONE] verifyAppendOnly run against the path from resolveReviewFilePath(projectRoot, dataDir)
│   ├── [DONE] violated -> advanceRoundReview('failed'), round-review-failed / append-only-violated
│   ├── [DONE] snapshot-missing -> advanceRoundReview('failed'), round-review-failed / snapshot-missing; no retry in either case
│   ├── [DONE] ok + triage -> ids in tasks.json (via readTasksFile) not in rec.baselineTaskIds, ascending; any -> fixing with { fixTaskIds }; none -> done
│   ├── [DONE] ok + closing -> done, fixTasks = rec.fixTaskIds
│   ├── [DONE] snapshot best-effort deleted only after a successful settle, and after the phase advance (code order)
│   ├── [DONE] best-effort iteration-log line `Round review <pass>: <verdict>[ (<reason>)]` at tempFilePath(dataDir, 'iterations.log')
│   ├── [DONE] lock ordering: tasks.json is read before advanceRoundReview is called, never inside the updateStateValue callback
│   └── [DONE] TasksFileError / FileLockError propagate (no catch around the read or the advance)
├── src/commands/round.ts
│   ├── [DONE] roundReviewSettleCommand(opts, deps?): one JSON line on stdout and 0; thrown error -> `cairn round review-settle: <message>` on stderr and 1
│   ├── [DONE] registered as round.command('review-settle') with a description, no arguments, loadRoundContext() for projectRoot/dataDir
│   └── [DONE] `round` group description and the registerRoundCommands doc comment mention review-settle
├── Tests: test/round-review.test.ts
│   ├── [DONE] clean triage with new ids -> fixing, fixTasks exactly the non-baseline ids (ascending from unsorted input), state updated, snapshot deleted
│   ├── [DONE] clean triage with no new tasks -> done
│   ├── [DONE] baseline (blocked) tasks never counted as fix tasks
│   ├── [DONE] clean closing -> done with the recorded fixTaskIds (a new task in tasks.json is ignored)
│   ├── [DONE] changed, deleted and reordered original line, each in triage and in closing -> failed / append-only-violated, file equal to the snapshot, rejected content saved, phase failed
│   ├── [DONE] missing snapshot -> failed / snapshot-missing, review file untouched, no rejected file, phase failed
│   ├── [DONE] repeat call after each of five settle outcomes -> no-round-review; state.json, review file and log byte-identical
│   ├── [DONE] phases none, fixing, done, failed -> no-round-review, nothing changed
│   └── [DONE] extras: tasks.json read with no state.json.lock present, phase already advanced when the log line is appended, a failing log append does not change the verdict, a TasksFileError leaves the phase pending
├── Tests: test/commands/round.test.ts
│   ├── [DONE] one JSON line and exit 0 for round-review-settled, round-review-failed and no-round-review
│   ├── [DONE] exit 1, one stderr line, no stdout for a thrown TasksFileError and a thrown FileLockError
│   ├── [DONE] registerRoundCommands registers review-settle (no arguments, non-empty description, group description names it), added inside the existing describe
│   └── [DONE] end to end in a temp dir: roundNext -> triage, task added to tasks.json, review-settle -> fixing, roundNext -> task #31
└── Round constraints
    ├── [DONE] cairn.json, install.sh and package.json not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/round-review.test.ts test/commands/round.test.ts` -> "SyntaxError: Export named 'roundReviewSettleCommand' not found in module ..." (0 pass, 2 fail, 2 errors)
```

Verification notes:
- Inspected `git diff 5dbc3bb..HEAD` in full (one commit, 4979c74, four files, 463 insertions and 8 deletions). The changed files match the Expected Files list exactly. Read `verifyAppendOnly`, `readRoundReview`, `advanceRoundReview` and `cleanupRoundReviewScratch` in the working tree's `src/round-review.ts`.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1441 pass, 0 fail). I did not open the full log.
- The 8 deletions are widened import lines and the reworded doc comment and group description. No test was removed or weakened.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff. The recorded failure is a missing-export error for both test files, not a per-assertion failure.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Not verified: the command through the real CLI. The task forbids running `cairn round` against this project and the pinned binary predates the change. The completion notes report a temp-dir smoke run of `bun src/index.ts round review-settle`; I could not reproduce it. The "advance before deleting the snapshot" order is enforced by code order only (no test observes it), as the completion notes say; I confirmed the order by reading the code. `readTasksFile`'s signature and `updateStateValue` were not re-read; the call shape rests on the passing typecheck.
- Reviewer tooling note: commands using `git -C` and a `tail` / `date` pipeline were denied by the containment hook. As in the two previous sections, one compound command that began with `cd` and chained several git commands ran instead of being denied.

### Files Changed
- src/commands/round.ts
- src/round-review.ts
- test/commands/round.test.ts
- test/round-review.test.ts

### Gaps
None detected

### Regression Risks
- A repeat call after a thrown error on the violation path settles the pass as clean. In `settleRoundReview`, `verifyAppendOnly` has side effects (it restores the review file from the snapshot and saves the rejected content) and runs before `advanceRoundReview(dataDir, 'failed')`. If that advance throws a `FileLockError` (state.json lock timeout), the command exits 1 with the phase still `triage` or `closing` and the snapshot still in place. The function's doc comment and the completion notes both say the call "can be repeated" in that state. A repeat then compares the already-restored file with its own snapshot, gets `ok`, and returns `round-review-settled` (phase `fixing` or `done`). The append-only violation is never reported: no `round-review-failed` verdict, no `roundReviewFailed: true` on round-done, and the only trace is `.cairn_round_review_rejected.md`. For a triage pass, the fix tasks then run and a closing pass is handed out against a review file whose triage blocks were removed by the restore. Narrow (it needs a lock timeout at that exact step), and the existing lines of the review file stay intact either way, but the failure signal is lost and the doc comment is wrong for this path. No test covers a throw from `advanceRoundReview`; the two throw tests inject the error through `readTasksFile`, which runs only on the `ok` path. A possible fix: treat an existing rejected-content file as a failed pass on the repeat, or record the failure before restoring.

Minor notes (behaviour is as specified, or outside this task's scope; not counted as gaps or risks):
- `verifyAppendOnly` can return `{ status: 'violated', restored: false }` when the restore write fails. `settleRoundReview` ignores `restored`, so the verdict is `append-only-violated` while the review file still holds the rejected content. The specified verdict shape has no field for it, and the phase still goes to `failed`.
- On a failed pass the snapshot is kept and `.cairn_round_review_rejected.md` is written. `cleanupRoundReviewScratch` removes the snapshot at round-done but not the rejected file, and the temp sweep's regexes require a `task_<id>_` segment, so the rejected file stays until something else removes it. That may be intended (it is the only diagnostic for the failure); I did not check whether `cairn init`'s `.gitignore` entries cover it.
- `CLAUDE.md` and `commands/cairn-run.md` do not describe `review-settle` or its verdicts yet. The completion notes say so; earlier sections of this file name #159 and #160 as the tasks that cover them.
- The command's `next` is `Run: cairn round next` for the failed verdict too. A run agent learns about the failure from the verdict name and later from `roundReviewFailed` on round-done, not from the hint.

### Verdict
HAS_RISKS

### Round Triage
Reviewed: 2026-10-11
1. A repeated `review-settle` after a thrown `FileLockError` on the violation path settles the pass as clean, and the doc comment's "can be repeated" is wrong for that path: still applies. Confirmed in `settleRoundReview`: `verifyAppendOnly` restores the file before `advanceRoundReview(dataDir, 'failed')` runs. Planned fix (task #162): record the failure so a repeat still returns `round-review-failed`, correct the doc comment, and add tests that inject a throwing advance.
2. `settleRoundReview` ignores `restored: false`: not fixing, the specified verdict shape has no field for it, the phase still goes to `failed`, and it needs a failing write of the review file.
3. The rejected file stays after a failed pass; gitignore coverage unknown: not fixing, keeping it is by design, and task #158 (8bc7fb9) added the gitignore pattern that covers it.
4. `CLAUDE.md` and `commands/cairn-run.md` did not describe `review-settle`: not fixing, already resolved by tasks #159 (1dca29f) and #160 (a35ab86).
5. The failed verdict's `next` hint does not mention the failure: not fixing, the verdict name carries it and `commands/cairn-run.md` tells the run agent to notify.
6. A `cd`-prefixed compound command ran under the live hook (tooling note): cause not established, same issue as item 3 in the Task #155 section. Planned fix (task #161): tests that pin the deny, and a code fix if any fails.

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #162 (0b1c4eb). Differs from plan: the failure is not recorded in a separate marker; the order of steps was changed instead. `verifyAppendOnly` was split into `checkAppendOnly()` (reads only) and `restoreReviewFile()`, and `settleRoundReview` now runs detect, then the advance to `failed`, then the restore. If the advance throws, nothing has been written, so a repeat detects the violation again and returns `round-review-failed`. The doc comment was corrected, and tests inject a throwing advance through a new `RoundReviewSettleDeps.advanceRoundReview` for triage, closing and a missing review file. A consequence the plan did not name, documented in the doc comment and CLAUDE.md and pinned by a test: after a crash between recording `failed` and the restore, the failure is still reported but the restore is not retried, so the review file keeps the violating content, no rejected copy is written, and the original survives only in the snapshot until round-done removes it. The #162 review section is CLEAN and lists this as a minor note.
2. Not resolved. #161 (666167a) added the tests; all passed against the unchanged code, no code was changed, and the anomaly recurred in the #161 and #162 reviews. Same issue and same outcome as item 3 in the Task #155 section.

### Round Verdict
UNRESOLVED

---

## Task #158: Gitignore entry for the round-review scratch files
Reviewed: 2026-10-11T02:38:55Z (the commit's timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── src/commands/init.ts
│   ├── [DONE] exactly ONE entry, 'round_review_*', added to TEMP_IGNORE_SUFFIXES (ignoreBlock(BRAND.tempPrefix) yields `.cairn_round_review_*`)
│   ├── [DONE] comment lists the four files: prompt, snapshot, rejected, reviews/ fix_<n>.json
│   ├── [DONE] comment says the pattern has no slash, so it matches at any depth below `.cairn/` and covers the JSON files in reviews/ while reviews/round-<N>.md stays tracked
│   └── [DONE] comment names cleanupRoundReviewScratch as the cleanup, not temp-sweep
├── [DONE] src/temp-sweep.ts not touched
├── Tests (test/commands/init.test.ts, temp dirs)
│   ├── [DONE] fresh initCoreFiles writes a .gitignore containing the line `.cairn_round_review_*`
│   ├── [DONE] re-init on a file lacking it appends it after the `# Added by cairn init (missing entries)` header; content.startsWith(existing) pins that no existing line was reordered or removed
│   ├── [DONE] a file that already has the entry is byte-identical after a second init
│   ├── [DONE] a file with `!.cairn_round_review_*` does not get the entry re-added (negation line kept)
│   ├── [DONE] temp git repo: check-ignore via isPathGitIgnored reports reviews/.cairn_round_review_fix_1.json and .cairn_round_review_prompt.md ignored, reviews/round-1.md NOT ignored; returns early when `git init` fails
│   └── [DONE] existing tests updated: exact entry list, the mixed-order "already has every entry" fixture, and the "added 14 entries" count -> 15
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json and this repo's own .cairn/.gitignore not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/commands/init.test.ts` -> "(fail) round-review scratch gitignore entry > a fresh init writes the entry" (3 fail before the fix)
```

Verification notes:
- Inspected `git diff 4979c74..HEAD` in full (one commit, 8bc7fb9, two files, 82 insertions and 1 deletion). The changed files match the Expected Files list exactly. The one deletion is the "added 14 entries" assertion, replaced by 15; no test was removed.
- `git diff 4979c74..HEAD --stat -- .cairn/.gitignore cairn.json install.sh package.json src/temp-sweep.ts` is empty.
- Read `src/round-review.ts` at HEAD and checked the pattern against the names the code really produces: `round_review_prompt.md`, `round_review_snapshot.md` and `round_review_rejected.md` through `tempFilePath`, and `<BRAND.tempPrefix>round_review_fix_<n>.json` under `reviews/`. All four start with the ignored prefix. Read `mergeGitignoreEntries` in the working tree's `src/commands/init.ts`; the new entry goes through the same trimmed exact-match and `!` opt-out logic as every other entry, with no code change needed there.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1446 pass, 0 fail). I did not open the full log. `git` is present in this environment (I used it for this review), so the check-ignore test most likely ran its assertions rather than taking the early return; I did not confirm that from the log, and I did not read `isPathGitIgnored`'s implementation.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Reviewer tooling note: a pipeline using `tail` / `grep` / `date` was denied by the containment hook. As in the previous sections, one compound command that began with `cd` and chained several git commands ran instead of being denied.

### Files Changed
- src/commands/init.ts
- test/commands/init.test.ts

### Gaps
None detected

### Regression Risks
None detected. The change adds one ignore pattern. A fresh `cairn init` writes one more line, and a re-init appends one more missing entry to an existing `.gitignore`; no existing line is touched. No tracked file name in a Cairn data dir starts with `.cairn_round_review_`, so nothing that should be committed becomes ignored.

Minor notes (behaviour is as specified, or outside this task's scope; not counted as gaps or risks):
- This repo's own `.cairn/.gitignore` does not have the entry yet, by design: the task forbids editing it and the user re-runs `cairn init` after the round. Until then, round-review scratch files written in this repo (for example by the post-unpin `cairn round next` step, which now starts a triage pass because this round has a review file) would show up as untracked. Re-run `cairn init` before that step, or right after unpinning.
- This answers the open question in the Task #157 section: `.cairn_round_review_rejected.md` is now gitignored. It is still never deleted by `cleanupRoundReviewScratch` or the temp sweep, so after a failed append-only check it stays in the data dir, out of `git status`, until removed by hand.
- The negation test asserts the entry is not re-added and the `!` line is kept. It does not assert the file is byte-identical, and it could not: its fixture lacks every other entry, so those are appended. The "left untouched" wording of the task is met in the sense that matters (the user's opt-out is not reversed).
- The check-ignore test passes without asserting anything when `git init` fails, as the task allows ("if `git` is available"). On a machine without git the at-any-depth claim would be untested.
- The pattern also ignores any future file in the data dir whose name starts with `.cairn_round_review_`, at any depth. That is the intent, but a later task that wants a tracked file with that prefix would need a different name.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. This repo's own `.cairn/.gitignore` lacks the entry until `cairn init` is re-run: not fixing, a user-managed post-round step that no task may perform; CLAUDE.md's unpin procedure covers it.
2. The rejected file stays in the data dir until removed by hand: not fixing, by design and documented.
3. The negation test does not assert byte-identity, and the check-ignore test asserts nothing without git: not fixing, test-quality nits.
4. The pattern ignores any future file with that prefix: not fixing, intended.
5. A `cd`-prefixed compound command ran under the live hook (tooling note): cause not established, same issue as item 3 in the Task #155 section. Planned fix (task #161): tests that pin the deny, and a code fix if any fails.

### Round Outcome
Reviewed: 2026-10-11
1. Not resolved. #161 (666167a) added the tests; all passed against the unchanged code, no code was changed, and the anomaly recurred in the #161 and #162 reviews. Same issue and same outcome as item 3 in the Task #155 section. This was the only planned fix in this section; nothing about the gitignore entry itself is open.

### Round Verdict
UNRESOLVED

---

## Task #159: /cairn-run instructions for the round review
Reviewed: 2026-10-11T02:40:38Z (the commit's timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── commands/cairn-run.md
│   ├── 1. `cairn round next` verdicts
│   │   ├── [DONE] round-review bullet with `{ verdict, pass, promptFile, next }`, `pass` is triage or closing (matches RoundNextResult field for field)
│   │   ├── [DONE] Agent tool, subagent_type "post-round-reviewer", description `Round review (<pass>)`, prompt `Read <promptFile> and follow it` (same agent type and prompt wording as the verdict's own `next` hint)
│   │   ├── [DONE] do NOT pass a `model`
│   │   ├── [DONE] returns one line (`TRIAGED: ...` or `CLOSED: ...`)
│   │   └── [DONE] then run `cairn round review-settle` and act on its verdict
│   ├── 2. New section "`cairn round review-settle` verdicts"
│   │   ├── [DONE] round-review-settled `{ verdict, pass, phase, fixTasks, next }`: run `cairn round next`; phase fixing -> ordinary task verdicts, run / settled / reviewed like any other
│   │   ├── [DONE] round-review-failed `{ verdict, pass, reason, next }`: cause stated, file restored, PushNotification with pass and reason, `cairn round next`, do not relaunch the reviewer
│   │   └── [DONE] no-round-review: run `cairn round next`
│   ├── 3. round-done
│   │   └── [DONE] `{ verdict, blocked, unresolved, roundReviewFailed?, next }`; summary mentions `unresolved` when non-zero and the failed round review when `roundReviewFailed` is true
│   ├── 4. Intro and Rules
│   │   ├── [DONE] intro sentence covers both reviewers (per task, then once for the whole round)
│   │   ├── [DONE] "One agent at a time": the run agent launches the task agents, the per-task reviewer and the round reviewer; no agent launches another
│   │   ├── [DONE] "The CLI owns state": never read or edit the round review file
│   │   ├── [DONE] "Stay terse": the reviewers return one line
│   │   └── [DONE] frontmatter `description` left as it was (still accurate)
│   └── 5. When a command fails
│       └── [DONE] the non-zero-exit rule names `cairn round review-settle`
├── Tests (test/commands/init.test.ts, inside describe('installSlashCommands'))
│   ├── [DONE] source file contains all eight names: round-review, post-round-reviewer, cairn round review-settle, round-review-settled, round-review-failed, no-round-review, unresolved, roundReviewFailed
│   ├── [DONE] installSlashCommands(tmpDir, real repo root) yields a .claude/commands/cairn-run.md containing the agent type and the settle command
│   └── [DONE] existing cairn-run.md tests unmodified (the test diff is 21 added lines, no deletions) and passing
└── Round constraints
    ├── [DONE] src/commands/round.ts and src/round-review.ts not changed (read-only by design)
    ├── [DONE] cairn.json, install.sh and package.json not touched by the commit
    ├── [DONE] this repo's installed .claude/commands/cairn-run.md not edited (read it: still the old text, round-done is `{ verdict, blocked, next }`; clean in git status)
    └── [DONE] TDD evidence in completion notes: `bun test test/commands/init.test.ts` -> "(fail) installSlashCommands > cairn-run.md teaches the post-round review, in source and in a temp-dir install" (Expected to contain: "round-review")
```

Verification notes:
- Inspected `git diff 8bc7fb9..HEAD` in full (one commit, 1dca29f, two files, 34 insertions and 6 deletions). Both changed files are in the Expected Files list; the other two listed files were for reading only and are unchanged.
- Field names were checked against the shipped types, not against the task text: `RoundNextResult` and `roundReviewVerdict()` in `src/commands/round.ts` (diff `0180a8f..4979c74`) and `RoundReviewSettleVerdict` in `src/round-review.ts` (diff `5dbc3bb..4979c74`). Every shape in the Markdown matches. `roundReviewSettleCommand` returns 1 with one stderr line on a thrown error, which is what the "When a command fails" sentence now covers.
- Read the post-change `commands/cairn-run.md` in full (59 lines, 7 more than before), and the new test in the working tree.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1447 pass, 0 fail). I did not open the full log.
- TDD evidence was read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree is the documented user-managed health-check pin; it is not part of the commit.
- Not verified: that a real `/cairn-run` session follows the new instructions. The installed copy and the pinned binary both predate this round's changes, and the task forbids running `cairn round` here. The first live exercise will be after unpinning and re-running `cairn init`.
- Reviewer tooling note: commands using `git -C`, a `grep` / `ls` / `tail` pipeline, and a `git log -G` pattern containing a pipe character were denied by the containment hook. As in earlier sections, one compound command that began with `cd` and chained several git commands ran instead of being denied.

### Files Changed
- commands/cairn-run.md
- test/commands/init.test.ts

### Gaps
None detected

### Regression Risks
None detected. The existing verdict bullets for `task`, `review`, `retry`, `blocked`, `done` and `already-settled` are unchanged, and the four pre-existing cairn-run.md content tests pass unmodified. The new text only takes effect in a project once `cairn init` reinstalls the command.

Minor notes (the text matches the task's wording, or the point is outside this task's scope; not counted as gaps or risks):
- The round-review-failed bullet says "the CLI has restored the file" for both reasons. That holds for `append-only-violated`. For `snapshot-missing`, `verifyAppendOnly` leaves the review file alone, so nothing was restored and whatever the reviewer wrote is still in it. The run agent's action is the same either way (notify with the reason, then `cairn round next`), and the wording is the task's own, but a user reading the notification should not assume the file was rolled back in the snapshot-missing case.
- The new test's first needle, `round-review`, is a substring of four other needles, and `unresolved` is checked without backticks, so neither would catch the removal of the `round-review` verdict bullet or the `unresolved` field on their own. Nothing asserts the verdict shapes (for example the `{ verdict, pass, promptFile, next }` literal), the "Do NOT pass a `model`" instruction, or the "do not relaunch the reviewer" instruction, unlike the existing retry test, which pins the exact shape string. The task asked only for the eight names.
- The "Before you start" bullet still says the hook "scopes the reviewer's writes" (singular). It now scopes both reviewers; the sentence is still true as far as it goes.
- The intro reads "launch the reviewers when the CLI asks for one", and the state rule now chains three clauses with "and never ... and never". Both are clear enough for the run agent; they are wording only.
- This repo's installed `.claude/commands/cairn-run.md` is tracked in git and still the old version, by design. After the round it has to be refreshed (`cairn init`) and committed before a `/cairn-run` session here can handle a `round-review` verdict; an unpinned binary with the old command file would hand the run agent a verdict its instructions do not describe, leaving only the `next` hint to follow.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. The `round-review-failed` bullet says the CLI has restored the file for both reasons, which is false for `snapshot-missing`: still applies (confirmed in `commands/cairn-run.md` and `verifyAppendOnly`). Planned fix (task #163): reword the bullet per reason.
2. The new test's needles are loose and no verdict shape is asserted: not fixing, a test-quality nit. Task #163 adds assertions only for the reworded bullet.
3. "scopes the reviewer's writes" is singular: still applies, minor. Planned fix (task #163): make it plural, in the same edit.
4. Intro and state-rule phrasing: not fixing, wording only and clear enough.
5. This repo's installed `.claude/commands/cairn-run.md` must be refreshed with `cairn init` after the round: not fixing, a user-managed post-round step; CLAUDE.md's unpin procedure covers it.
6. A `cd`-prefixed compound command ran under the live hook (tooling note): cause not established, same issue as item 3 in the Task #155 section. Planned fix (task #161): tests that pin the deny, and a code fix if any fails.

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #163 (59f28f2). Differs from plan: none. The `round-review-failed` bullet in `commands/cairn-run.md` now says the file is restored from its snapshot for `append-only-violated`, and that nothing is restored for `snapshot-missing`. The run agent's action is unchanged. The added test checks only that both reason names appear in the file, not which one is described as restored.
2. Fixed by #163 (59f28f2). Differs from plan: none. The bullet now reads "the reviewers' writes".
3. Not resolved. #161 (666167a) added the tests; all passed against the unchanged code, no code was changed, and the anomaly recurred in the #161 and #162 reviews. Same issue and same outcome as item 3 in the Task #155 section.
Also reported from the #163 review section (verdict HAS_GAPS, process only): its completion notes carry no failing test command or failing line from before the fix. The wording fixes in items 1 and 2 landed; this section is left open because of item 3.

### Round Verdict
UNRESOLVED

---

## Task #160: Docs: post-round review (CLAUDE.md, README.md)
Reviewed: 2026-10-11T02:45:23Z (the task's completion timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── CLAUDE.md
│   ├── 1. Execution flow `round` bullet + "Two ways to run a round"
│   │   ├── [DONE] `cairn round review-settle` named in the `round` bullet and in the /cairn-run flow
│   │   ├── [DONE] `round-review` verdict `{ verdict, pass: 'triage'|'closing', promptFile, next }` (matches RoundNextResult)
│   │   ├── [DONE] pickNext() order: pending per-task review, pending round-review pass, task selection, fresh triage/closing else round-done (matches steps 1-3 and the no-task branch in src/commands/round.ts)
│   │   ├── [DONE] round-done's `unresolved` (always present) and `roundReviewFailed` (only when the phase is `failed`)
│   │   ├── [DONE] review-settle verdicts round-review-settled / round-review-failed / no-round-review, with shapes matching RoundReviewSettleVerdict; all exit 0, exit 1 only on a thrown TasksFileError / FileLockError
│   │   └── [DONE] headless `cairn run` has no round review (src/commands/run.ts has never contained `roundReview`, `round-review` or `cleanupRoundReviewScratch`)
│   ├── 2. New "Post-round review" section
│   │   ├── [DONE] two passes and their blocks (`### Round Triage`, `### Round Outcome`, `### Round Verdict`; RESOLVED | UNRESOLVED | ACCEPTED)
│   │   ├── [DONE] phases triage / fixing / closing / done / failed / implicit none
│   │   ├── [DONE] stored in state.json under `roundReview`, and why not run state. Documents the code where the task text was wrong: one record carrying its round, not a map keyed by round (toRecord)
│   │   ├── [DONE] forward-only rule (PHASE_RANK, done and failed share the top rank) and the one-fix-pass cap
│   │   ├── [DONE] a handed-out pass is re-handed before any task runs and keeps its snapshot (plus the code's exception: a new snapshot only if the old one is gone and the review file exists)
│   │   ├── [DONE] skipped when `review.postRound` is false or there is no review file (also the postTask-off case)
│   │   ├── [DONE] append-only check: snapshot at hand-out, subsequence test, insertions anywhere pass, restore, rejected copy, phase `failed`, no retry, created fix tasks still run; plus `snapshot-missing`, which the task text did not mention
│   │   ├── [DONE] fix-task ids = tasks.json at triage settle minus `baselineTaskIds`
│   │   ├── [DONE] `unresolved` parsed from the file. Documented as a count of task sections, which is what countUnresolved() does
│   │   ├── [DONE] closing pass evidence: findTaskCommits, the `Task #<id>:` commit-message search
│   │   ├── [DONE] shared logic in src/round-review.ts, mode-neutral, so headless can be added later
│   │   └── [DONE] accepted limitation: mid-round upgrade gets one triage; turn off with `review.postRound: false`
│   ├── 3. [DONE] Conventions: src/round-review.ts in the "where logic lives" bullet
│   ├── 4. [DONE] Enforcement under /cairn-run: `post-round-reviewer` scope (REVIEWER_SCOPES, TASK_ADD_FILE_RE; bans and `--output` check kept; post-task-reviewer unchanged)
│   ├── 5. Data layout and sweep paragraph
│   │   ├── [DONE] the three `.cairn_round_review_*.md` files and `reviews/.cairn_round_review_fix_<n>.json`
│   │   ├── [DONE] post-round-reviewer.md on the `.claude/agents/` line; `roundReview` on the state.json line
│   │   └── [DONE] not swept by sweepRoundTempFiles(); removed by cleanupRoundReviewScratch() at round-done, rejected copy kept
│   ├── 6. [DONE] Config: `review.postRound` (absent = on; isPostRoundReviewEnabled; init prompt "Enable post-round review?")
│   ├── 7. Agent workflow block
│   │   ├── [DONE] stale `cairn task add --title ...` replaced by `cairn task add --file <path>` (no `--title` string is left anywhere under src/)
│   │   └── [DONE] `cairn round review-settle` added to the not-agent-commands sentence
│   ├── 8. [DONE] cairn watch default types include `post-round-reviewer` (DEFAULT_AGENT_TYPES)
│   └── 9. Pin/unpin
│       ├── [DONE] post-unpin `cairn round next` can return `round-review`; run it from a /cairn-run session; re-run `cairn init` first
│       └── [DONE] the "never run cairn round in the project root" paragraph names state.json (and the snapshot and review-file restore)
├── README.md
│   ├── [DONE] "Post-round review" section: what it does, /cairn-run only, how to turn it off, unresolved reported at round end
│   ├── [DONE] commands table: new `cairn round review-settle` row, `cairn round next` row lists `round-review`
│   ├── [DONE] /cairn-run flow list (step 5) and the exit-code sentence
│   ├── [DONE] containment bullet for post-round-reviewer
│   ├── [DONE] both file trees (repo layout and per-project layout)
│   ├── [DONE] config example and table rows for `review.postTask` and `review.postRound` (neither was listed before)
│   └── [DONE] sentence listing installed agents
└── Round constraints
    ├── [DONE] only CLAUDE.md and README.md changed (one commit, a35ab86)
    ├── [DONE] cairn.json, install.sh, package.json and all source files untouched by the commit
    ├── [DONE] completion notes list the claims that did not match the code (six items)
    └── [DONE] `bun run typecheck` and `bun test` pass (cairn's validation)
```

Verification notes:
- Inspected `git diff 1dca29f..HEAD` in full: one commit, two files, 105 insertions and 30 deletions.
- Read the current `src/round-review.ts`, `src/commands/round.ts`, `src/commands/hook.ts`, `src/config.ts`, `src/task-counter.ts`, `agents/post-round-reviewer.md` and `commands/cairn-run.md` in full, and the head of `src/transcripts.ts`, and checked each documented claim against them. Checked the init prompt and the gitignore pattern from the diffs of cb5d116 and 8bc7fb9. I found no claim in the new text that contradicts the code.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1447 pass, 0 fail). I did not open the full log.
- Completion notes were read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree is the user-managed health-check pin; it is not part of the commit.
- Not verified: the agent's statement that no test reads `CLAUDE.md` or `README.md` content. The hook denies `grep`, so I could not repeat the search; the full test suite passing is the evidence that no such test broke.
- Not verified: live behaviour. Neither the task agent (by its own notes) nor I ran any `cairn round` / `hook` / `init` / `watch` command, in the project or in a temp dir. Every claim rests on reading the source.
- Not read: `src/types.ts` and the full `src/commands/init.ts` and `src/commands/task.ts`. The `cairn task add` claims ("takes only `--file`", "prints `assigned id: <n>`") were checked indirectly: no `--title` string exists under `src/`, and `assigned id` appears in `src/commands/task.ts`.

### Files Changed
- CLAUDE.md
- README.md

### Gaps
None detected

### Regression Risks
None detected. The change is documentation only. No statement about existing behaviour was removed; the edited paragraphs keep their earlier content and add to it.

Minor notes (wording, or outside this task's scope; not counted as gaps or risks):
- The unpin command block still shows a bare `cairn round next` line in a shell block, with a comment saying to run it "from inside a /cairn-run session". The paragraph below says to run the step as `/cairn-run` instead of a bare shell command. A reader who copies the block gets the bare command, which starts a triage pass and leaves it pending. The prose says this loses nothing, which is true, but the block and the prose point in different directions.
- The unpin block now has `cairn init` as a plain line. That command is interactive (prompts for config and settings), so the block is no longer copy-and-paste as a whole. The task asked for the step; only the prose could say that it prompts.
- "It is skipped when `review.postRound` is `false`" does not cover one case in the code: if the flag is turned off while a pass is pending, `decideRoundReview` stops re-handing the pass and the phase stays `triage` or `closing` in `state.json` for that round. Turning the flag back on re-hands the same pass. Not documented, and unlikely in practice.
- README's append-only bullet describes only the changed-or-removed-line failure. The `snapshot-missing` failure, where nothing is restored, is in CLAUDE.md only. That is reasonable for a user-facing summary, and it leaves the Task #159 note (cairn-run.md says "the CLI has restored the file" for both reasons) as it was.
- README's config example sets `"postTask": true` while the table gives its default as `false`. Both are correct; the example is not a list of defaults.
- This repo's own installed `.claude/agents/`, `.claude/commands/cairn-run.md` and `.cairn/.gitignore` still predate the feature, as earlier sections note. The new unpin text now tells the user to fix that with `cairn init` before the post-unpin step.

### Verdict
CLEAN

### Round Triage
Reviewed: 2026-10-11
1. The unpin command block shows a bare `cairn round next` line while the prose says to run that step as `/cairn-run`: still applies (confirmed in CLAUDE.md). Planned fix (task #163): make the block agree with the prose.
2. The unpin block lists the interactive `cairn init` as a plain line: still applies, minor. Planned fix (task #163): note that it prompts, in the same edit.
3. The flag-turned-off-while-a-pass-is-pending case is not documented: not fixing, unlikely in practice and the documented sentence is not false.
4. README's append-only bullet omits `snapshot-missing`: not fixing, reasonable for a user-facing summary; task #163 corrects the `commands/cairn-run.md` wording that note refers to.
5. README's config example sets `postTask: true` while the default is `false`: not fixing, both are correct.
6. This repo's installed agent, command and gitignore files predate the feature: not fixing, a user-managed post-round step the unpin text already covers.

### Round Outcome
Reviewed: 2026-10-11
1. Fixed by #163 (59f28f2). Differs from plan: none for the block. The bare `cairn round next` line is gone from the unpin block; a comment now says to start an interactive session in the repo root and run /cairn-run there. Left as it was, because the fix task was told to keep the rest of the section: the paragraph directly under the block still opens with "The `cairn round next` step matters" and speaks of running `cairn round next` once from the repo root, so a reader has to connect that to the /cairn-run comment. The paragraph after it does say to run the step as /cairn-run. The #163 review section lists this as a minor note.
2. Fixed by #163 (59f28f2). Differs from plan: none. A comment above the `cairn init` line says it is interactive and that the block is not to be pasted as a whole.
Also reported from the #163 review section (verdict HAS_GAPS, process only): its completion notes carry no failing test command or failing line from before the fix. That review states it has no effect on the shipped text or code, so it is not counted against these fixes.

### Round Verdict
RESOLVED

---

## Task #161: Hook: tighten the post-round-reviewer task-add path match; pin cd-chained commands as denied
Reviewed: 2026-10-11T20:11:26Z (the task's completion timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── Finding A: tighten the task-add path match (src/commands/hook.ts)
│   ├── [DONE] Bare branch also excludes `{`, `}`, `*`, `?`, `[`, `]`, `~` (BARE_PATH character class)
│   ├── [DONE] All three branches reject a leading `-` (a `(?!-)` lookahead at the start of each path form)
│   ├── [DONE] Quoted branches still accept brace / glob / tilde characters
│   ├── [DONE] Kept as is: the blanket ban on backtick, `<`, `>`, `$`; hasOutputOption; the git prefixes; isInspectionOnly is untouched by the diff
│   ├── [DONE] post-task-reviewer scope untouched (no alsoAllowed; its REVIEWER_SCOPES entry is not in the diff)
│   ├── [DONE] Binary name still from BRAND.name
│   ├── [DONE] Doc comment above TASK_ADD_FILE_RE describes the tightened match
│   ├── [DONE] CLAUDE.md 'Enforcement under /cairn-run' post-round-reviewer bullet updated
│   └── [DONE] README.md containment bullet corrected (its "one path argument, nothing else" wording was incomplete for the new rule)
├── Tests for A (test/commands/hook.test.ts, post-round-reviewer describe block, subagent() / CTX)
│   ├── [DONE] Denied: all 8 listed commands, plus `a{1,2}.json`, `a~b.json` and bare `-x.json`
│   ├── [DONE] Allowed: absolute path, relative path, double- and single-quoted path with a space, quoted paths containing `{`, `*`, `~`, `[`, `?`, and a quoted path with an inner `-`
│   └── [DONE] Existing tests in the block unmodified: the test diff is additions only (77 insertions, 0 deletions)
├── Finding B: cd-chained commands
│   ├── [DONE] decidePreToolUse tests for BOTH reviewer agent types: the four listed commands (`&&`, three-part `&&`, `;`, newline) plus bare `cd /tmp/proj`
│   ├── [DONE] preToolUseHookCommand test: full JSON payload, agent_id, agent_type post-task-reviewer, Bash, cwd = temp dir with a data dir; asserts exit 0, deny JSON, empty stderr, no hook error log
│   ├── [DONE] No policy code changed for B (the tests passed against the unchanged code, per the notes; the diff confirms isInspectionOnly and src/claude-settings.ts are untouched)
│   ├── [DONE] Completion notes say plainly that the cause was not reproduced and remains unexplained
│   └── [DONE] No claim about the cause written to CLAUDE.md
└── Round constraints
    ├── [DONE] cairn.json, install.sh, package.json, .claude/ and .cairn/ not touched by the commit
    └── [DONE] TDD evidence in completion notes: `bun test test/commands/hook.test.ts` -> 163 pass / 13 fail, with a named `(fail)` line for the brace-expansion case
```

Verification notes:
- Inspected `git diff a35ab86..HEAD` in full: one commit (666167a), four files, 93 insertions and 4 deletions. The changed files match the Expected Files list exactly. `git diff a35ab86..HEAD --stat -- cairn.json install.sh package.json .claude .cairn src/claude-settings.ts` is empty.
- Read the post-change `src/commands/hook.ts` (lines 120-195) in the working tree. The compiled regex is `^cairn task add --file (?:(?!-)[^\s'"\\{}*?\[\]~]+|"(?!-)[^"\\]*"|'(?!-)[^'\\]*')$`; the template-string escaping yields that, checked by hand.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1478 pass, 0 fail). I did not open the full log.
- Completion notes were read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree is the user-managed health-check pin; it is not part of the commit.
- Not verified: the hook's behaviour end to end with the built binary. The task forbids running `cairn hook` against this project and the reviewer cannot run `bun`. The new policy is covered through `decidePreToolUse` and `preToolUseHookCommand` tests only. Which binary the live hook currently runs (the pinned older one or a newer one) could not be checked from here.

### Files Changed
- CLAUDE.md
- README.md
- src/commands/hook.ts
- test/commands/hook.test.ts

### Gaps
None detected

### Regression Risks
None detected. The regex only became narrower, so no command that was denied before is allowed now. The post-round-reviewer Bash deny reason gained a clause but still contains the `cairn task add --file <path>` text that existing tests assert; the post-task-reviewer reason is unchanged and pinned by an existing exact-text test. Paths that the prompt hands out (`<dataDir>/reviews/.cairn_round_review_fix_<n>.json`) contain none of the newly excluded characters, unless the project root itself has one of `{ } * ? [ ] ~` in its path, in which case the agent must quote the path; the deny reason says so.

Finding B: new evidence from this review (not a gap in this task, which did what it was told; recorded for the closing pass and the user):
- The anomaly happened again during this review, and this time the exact command is known. My first Bash call, under agent_type `post-task-reviewer`, was:
  `cd /Users/jhummel/Documents/_Repos/cairn && git log --oneline a35ab86900ebb341194dd940cf4e4cdde8b49e04..HEAD && git diff --stat a35ab86900ebb341194dd940cf4e4cdde8b49e04..HEAD && git diff a35ab86900ebb341194dd940cf4e4cdde8b49e04..HEAD`
  It ran and returned output. It was not denied.
- In the same batch a second call, also starting with `cd /Users/jhummel/Documents/_Repos/cairn && ` but followed by `tail -c ... ; echo; ... grep ... | head ...; date ...`, was denied with the ordinary post-task-reviewer Bash reason. So the hook is live and consulted for this agent, and a `cd` prefix on its own was not what got that second call denied or the first one allowed.
- What the two calls have in common with the earlier reports: the allowed one is `cd <the project root, which is also the session cwd> && <only git inspection commands joined by &&>`. Every subcommand after the `cd` would pass the policy on its own.
- This matches the new tests' prediction only if the live hook is not the code under test, or if the command the hook receives is not the command the agent sent. Both remain untested. The new unit tests use `cd /tmp/proj`, and the handler test uses a temp project root, so a test with the same shape as the real case (cd target equal to the payload `cwd`) exists and passes: that points away from the current source and toward either the pinned binary or the call reaching the hook in a different form (or not at all). I could not check either.
- A direct check is now possible because the command text is recorded: in a temp dir with a `.cairn/` directory, feed the hook a payload with `agent_type: post-task-reviewer`, `cwd` = that dir and `command` = `cd <that dir> && git log --oneline -1 && git diff --stat HEAD && git diff HEAD`, once with the pinned binary on PATH and once with a fresh build. If both deny, the hook is not being consulted for this call shape in a live session, and that is a containment gap outside the hook's code.

Minor notes (not counted as gaps or risks):
- An empty quoted path (`cairn task add --file ""`) is still allowed, as before. The notes say the agent tried and then removed tests for it as out of scope. Harmless: the binary fails on an empty path.
- A bare path starting with `#` is allowed by the regex, and bash would treat it as a comment, so the binary would receive `--file` with no argument. Harmless: the command just fails.
- The CLAUDE.md bullet is now long, and repeats the reasoning from the code comment. Accurate; a wording matter only.

### Verdict
CLEAN

---

## Task #162: Round review: keep the failed verdict across a repeated review-settle; clear the stale record on cairn round new
Reviewed: 2026-10-11 (date only; the reviewer cannot run `date`)

### Coverage
```
Task Requirements
├── Finding A: failed verdict survives a throwing state update
│   ├── [DONE] Detection separated from side effects: `checkAppendOnly()` (no writes) + `restoreReviewFile()`
│   ├── [DONE] `settleRoundReview` records `failed` before the restore (check -> advance -> restore)
│   ├── [DONE] Repeat after a throw ends in `round-review-failed` / `append-only-violated`, phase `failed`
│   ├── [DONE] `verifyAppendOnly` kept as check + restore, same result type; its existing tests untouched
│   ├── [DONE] `snapshot-missing` path unchanged (advance to `failed`, no restore, same reason)
│   ├── [DONE] Clean paths unchanged (same advances, snapshot deleted after the advance)
│   ├── [DONE] Lock ordering unchanged: tasks.json read before the advance, not inside the state callback
│   ├── [DONE] Opposite window (crash after `failed`, before restore) stated in the doc comment
│   ├── [DONE] `settleRoundReview` doc comment matches the implemented path
│   ├── [DONE] CLAUDE.md 'Append-only check' paragraph updated for the new order
│   └── Tests (test/round-review.test.ts)
│       ├── [DONE] Triage and closing: first call throws, phase still pending, repeat fails with
│       │          `append-only-violated`, phase `failed`, review file == snapshot, rejected file holds the bad content
│       ├── [DONE] Injectable `advanceRoundReview` added to `RoundReviewSettleDeps`
│       └── [DONE] Extra: order test, opposite-window test, missing-review-file repeat, clean-pass repeat
├── Finding B: `cairn round new` clears the stale `roundReview` record
│   ├── [DONE] `bumpRound(dataDir, { clear })` removes named keys in the same locked write; never `round` / `nextTaskId`
│   ├── [DONE] `startNewRound()` in src/round-review.ts; `roundNewCommand` defaults to it
│   ├── [DONE] `bumpRound` default behaviour unchanged (optional second argument)
│   ├── [DONE] Verdict shape `{ verdict, round, next }` and exit codes unchanged (key set asserted in a test)
│   ├── [DONE] CLAUDE.md: record paragraph and 'Planning rounds' section both say the record is cleared
│   └── Tests
│       ├── [DONE] (1) No `round` key + stored round-1 `done` record: round 1, phase `none`, `nextTaskId` and extra key kept
│       │          (test/round-review.test.ts and test/commands/round.test.ts)
│       ├── [DONE] (2) `round: 3` + round-3 record: round 4, phase `none`
│       ├── [DONE] (3) Existing `cairn round new` tests unchanged (the diff only adds tests)
│       └── [DONE] `bumpRound` `clear` tests in test/task-counter.test.ts
├── Round constraints
│   ├── [DONE] cairn.json, install.sh, package.json not in the commit
│   └── [DONE] No .cairn/state.json, .cairn/reviews/ or .claude/ file in the commit
└── [DONE] `bun run typecheck` and `bun test` pass (run by cairn)
```

Verification notes:
- Inspected `git diff 666167a..HEAD` in full: one commit (0b1c4eb), seven files, 319 insertions and 24 deletions. The changed files are exactly the Expected Files list.
- Read the post-change `settleRoundReview` in the working tree (src/round-review.ts lines 643-709) and `advanceRoundReview` (lines 232-255). On a violation the only write before `advance(dataDir, 'failed')` is none at all: `checkAppendOnly` only reads. The restore runs only for `status === 'violated'`, so `snapshot-missing` still has nothing restored.
- Opposite window, checked against the code: with `failed` stored, a repeat returns at the `rec.phase !== 'triage' && rec.phase !== 'closing'` guard with `no-round-review` / phase `failed`, before any file is touched. That is what the doc comment, CLAUDE.md and the new test say.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1493 pass, 0 fail; 15 more than at task #161). I did not open the full log.
- The uncommitted `cairn.json` change in the working tree is the user-managed health-check pin; it is not part of the commit.
- Not verified: `cairn round new` end to end with a built binary (the task forbids running it against this project and the reviewer cannot run `bun`). It is covered through `roundNewCommand` and `startNewRound` tests only. The TDD evidence in the completion notes was not checked.

### Files Changed
- CLAUDE.md
- src/commands/round.ts
- src/round-review.ts
- src/task-counter.ts
- test/commands/round.test.ts
- test/round-review.test.ts
- test/task-counter.test.ts

### Gaps
None detected

### Regression Risks
None detected. `bumpRound`'s new parameter is optional and its default path writes the same object as before. `verifyAppendOnly` keeps its signature and result type. `RoundNewDeps.bumpRound` is still honoured when injected, so existing command tests that inject it are unaffected.

Minor notes (not counted as gaps or risks):
- In the opposite window the review file keeps the violating content for the rest of the round and no rejected copy is written; the original survives only in the snapshot, which `cleanupRoundReviewScratch()` deletes at `round-done`. So after that crash the pre-violation text is lost at round end unless the user copies the snapshot first. This is the trade-off the task asked to be documented, and it is documented; the window is one `state.json` write wide.
- README.md was not touched. The task did not ask for it; I did not check whether README describes the old order of steps.
- The hook anomaly recorded under task #161 (Finding B there) happened again in this review: `cd /Users/jhummel/Documents/_Repos/cairn && git log --oneline <range> && git diff --stat <range> && git diff <range> -- src CLAUDE.md README.md` ran and returned output, while a call in the same batch with the same `cd` prefix followed by `; tail ...` was denied. `git -C <project root> diff ...` and `git -C <project root> status --short` were also denied; plain `git diff` / `git status` ran.

### Verdict
CLEAN

---

## Task #163: Wording fixes: cairn-run.md failed-review bullet, cairn watch --all help text, unpin command block
Reviewed: 2026-10-11T20:16:54Z (the commit's timestamp; the reviewer has no clock command)

### Coverage
```
Task Requirements
├── 1. commands/cairn-run.md
│   ├── [DONE] round-review-failed bullet split per reason: `append-only-violated` -> restored from the snapshot;
│   │          `snapshot-missing` -> nothing to restore from, file is as the reviewer left it
│   ├── [DONE] Run agent's action unchanged (PushNotification with `pass` and `reason`, `cairn round next`, do not relaunch)
│   ├── [DONE] 'Before you start' bullet: "the reviewer's writes" -> "the reviewers' writes"
│   ├── [DONE] Verdict names, shape literals and instructions kept (the diff changes two lines only; `{ verdict, pass, reason, next }` intact)
│   ├── [DONE] test/commands/init.test.ts, describe('installSlashCommands'): source contains `snapshot-missing` and `append-only-violated`
│   └── [DONE] Installed copy .claude/commands/cairn-run.md not edited by this task (see verification notes)
├── 2. `cairn watch --all` wording
│   ├── [DONE] src/commands/watch.ts: `all` field comment on WatchOptions names post-round-reviewer
│   ├── [DONE] src/index.ts: `--all` option help text names post-round-reviewer
│   └── [DONE] Test reading the registered option's description (test/commands/watch.test.ts, via createProgram())
├── 3. CLAUDE.md unpin block
│   ├── [DONE] Bare `cairn round next` line removed; replaced by a comment: start an interactive session, run /cairn-run there
│   ├── [DONE] No runnable `cairn round next` line left in the block (it appears only inside a comment, in backticks)
│   ├── [DONE] Note that `cairn init` is interactive and the block is not to be pasted as a whole (comment above the `cairn init` line)
│   └── [DONE] Rest of the section unchanged (the diff touches only lines inside the block)
├── Round constraints
│   ├── [DONE] cairn.json, install.sh, package.json not in the commit
│   └── [DONE] Nothing under .claude/ or .cairn/ in the commit
├── [DONE] `bun run typecheck` and `bun test` pass (run by cairn)
└── [PARTIAL] Standing personal instructions (CLAUDE.local.md): tests were added, but the completion notes carry
               no failing test command and no failing line from before the fix
```

Verification notes:
- Inspected `git diff 0b1c4eb..HEAD` in full: one commit (59f28f2), six files, 23 insertions and 7 deletions. Five are the Expected Files; the sixth, `test/commands/watch.test.ts`, is the test the task allows for item 2 ("a small test that reads the option description from the registered command is enough").
- Read the post-change unpin section of `CLAUDE.md` (lines 287-307) in the working tree.
- Both new tests would have failed before the change: the pre-change `commands/cairn-run.md` contained neither `snapshot-missing` nor `append-only-violated` (the old bullet said "or the snapshot was missing"), and the old `--all` description did not contain `post-round-reviewer`. This is from reading the diff, not from running them.
- The reworded bullet agrees with the code as described in CLAUDE.md's 'Append-only check' paragraph and with the Task #162 section's reading of `settleRoundReview` (the restore runs only for a violation; `snapshot-missing` restores nothing). I did not re-read `src/round-review.ts` for this review.
- Installed copy: `.claude/commands/cairn-run.md` is modified in the working tree, but its content is blob 205aaf8, which is the source file as it was BEFORE this task (it still has the old "the CLI has restored the file" wording). So this task did not write it. Something refreshed it from the source between the Task #159 review (which found it clean) and now; I could not tell what.
- Test validation was run by cairn, not by me: `bun run typecheck` passed, `bun test` passed (1495 pass, 0 fail; 2 more than at task #162, matching the two added tests). I did not open the full log.
- Completion notes were read from the task's archived entry in the uncommitted `.cairn/tasks.completed.json` diff.
- The uncommitted `cairn.json` change in the working tree adds `"postRound": true` to the `review` block; it is not part of the commit.
- Not verified: whether any other file still lists only two agent types for `cairn watch --all` (README.md, for example). The hook denies `grep`, and the task named only the two source locations.
- Reviewer tooling note: this time a compound command starting with `cd /Users/jhummel/Documents/_Repos/cairn && git log ... && git diff --stat ... && git diff ... && tail ... && date ...` was denied by the hook. It contained `tail` and `date`, so this says nothing new about the all-git `cd` case recorded under tasks #161 and #162. Plain single `git` commands ran.

### Files Changed
- CLAUDE.md
- commands/cairn-run.md
- src/commands/watch.ts
- src/index.ts
- test/commands/init.test.ts
- test/commands/watch.test.ts

### Gaps
- Process only, no effect on the shipped text or code: the completion notes do not include the failing test command and the line showing it failing before the fix, which `CLAUDE.local.md` asks for in every `cairn task complete --notes`. The notes say only "Tests added" and that the final run passes. The two tests are real and would have failed first (see verification notes), so whether they were written before the edits cannot be told from the record.

### Regression Risks
None detected. The source changes are one comment and one help string; no behaviour changes. Every string the pre-existing `cairn-run.md` content tests assert on is on lines the diff did not touch or is kept in the reworded bullet (`round-review-failed`, the shape literal, "do not relaunch the reviewer"), and the suite passes. No test was removed or modified.

Minor notes (not counted as gaps or risks):
- The paragraph right under the unpin block still opens with "The `cairn round next` step matters ..." and says "Running `cairn round next` once from the repo root after unpinning makes that behavior ... actually run", although the block no longer has a `cairn round next` line. The next paragraph then says to run the step as `/cairn-run`. The task said to keep the rest of the section, so this is as asked, but a reader now has to connect "the `cairn round next` step" to the /cairn-run comment.
- The unpin block's last comment says the interactive session should be started "in the repo root". Fine, and consistent with the block's "from the repo root" heading.
- The new init test checks that the two reason names appear anywhere in the file. It does not pin which reason is described as restored, so swapping the two explanations would still pass. The task asked only for the mention.
- The new watch test imports `src/index` to call `createProgram()`. It passes, so the import has no harmful side effect in the test run; I did not read how `src/index.ts` guards its top-level parse.
- This repo's installed `.claude/commands/cairn-run.md` now lags the source by this task's two wording changes. `cairn init` after the round, as the unpin procedure says, brings it up to date.

### Verdict
HAS_GAPS

---
