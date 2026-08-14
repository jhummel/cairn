## Task #77: Grant the post-task-reviewer git-inspection and per-task test commands
Reviewed: 2026-08-14T00:00:00Z

### Coverage
Task Requirements
├── [DONE] Enumerate the five read-only git subcommands (diff, log, show, status, rev-parse) via `GIT_INSPECTION_RULES`, never `Bash(git:*)`
├── [DONE] One Bash prefix rule per entry in `opts.task.tests`, via `buildTestCommandRules()`
├── [DONE] Handle absent/empty `tests` cleanly — no trailing separators, no empty `Bash()` rule (tests: "emits no Bash test rules when tests is absent/empty", "never emits an empty rule or a trailing separator")
├── [DONE] Decide + pin with tests the shape for a `tests` entry containing shell operators — split into one rule per subcommand, decision documented in the comment above `buildTestCommandRules` (lines 27-38)
├── [DONE] `reviewFileRule` mechanism and its comment block left untouched (lines 180-196 in the new file match the pre-existing text verbatim, only line numbers shifted)
├── [DONE] `cairn.json` not modified
└── [DONE] TDD: `test/post-task-reviewer.test.ts` extended with a dedicated "Bash allowlist rules" describe block covering enumerated git rules, no-blanket-git, per-entry rules, compound-operator splitting (all five operator kinds + newline), absent/empty tests, empty-rule/trailing-separator avoidance, dedup, and paren/comma-corruption avoidance — all 44 tests in the file pass, and the full suite (827 tests) passes

### Files Changed
- src/post-task-reviewer.ts — adds `GIT_INSPECTION_RULES`, `buildTestCommandRules()`, wires both into the `allowedTools` string built in `spawnPostTaskReviewer`
- test/post-task-reviewer.test.ts — updates the two existing full-string `--allowedTools` assertions to include the new rules, adds a 13-test "Bash allowlist rules" describe block
- CLAUDE.md — updates the `tasks.json`-write-protection paragraph to mention the new narrow Bash grants (not in Expected Files, but a reasonable in-scope doc sync consistent with prior rounds' pattern of updating this paragraph alongside the mechanism it describes)

### Gaps
None detected against the stated task requirements. One edge case worth flagging for a future round rather than as a gap here: a `tests` entry containing a colon in the command itself (e.g. `bun run test:unit`) would emit `Bash(bun run test:unit:*)` — two colons in one rule. The task's verified-semantics section only specifies that `Bash(x:*)` is sugar for a single prefix match; it doesn't state whether a second colon inside `x` parses safely or breaks the prefix boundary. The task explicitly scoped the "decide and pin with tests" requirement to shell-operator splitting only, so this isn't a missed requirement — just an untested input shape that could silently under- or mis-grant if a project's test script name happens to contain a colon (common with npm-style `test:unit` scripts).

### Regression Risks
None detected. `reviewFileRule` and its load-bearing comment are byte-for-byte unchanged. No exports were removed; `buildTestCommandRules` and `GIT_INSPECTION_RULES` are new additions (module-private, not exported, so no external contract changes). No tests were deleted — only extended. Full suite (`bun test`, 827 tests / 29 files) passes with 0 failures, and `git status`/diff confirm no unrelated files touched.

### Verdict
CLEAN

---

## Task #78: Instruct the post-task reviewer to actually verify
Reviewed: 2026-08-14T00:00:00Z

### Verification performed
- Ran `bun run test` myself (not just trusting the task's own notes): 827 pass, 0 fail, 29
  files — matches the completed-task notes exactly.
- Used `git show 7030387:agents/post-task-reviewer.md` (the commit immediately before this
  task's `6277a1b`) to diff the pre-change file against the current one directly, rather than
  relying solely on the supplied diff text. Confirmed byte-for-byte that the frontmatter
  (`name`, `description`, `internal: true`), the "You may only write to the review file..."
  sentence, the entire `## Coverage Diagram` section, and the entire `## Output Format`
  section (including the exact template and the CLEAN/HAS_GAPS/HAS_RISKS rules) are
  unchanged — only one new `## Verification` section was inserted between the write-scope
  instruction and the Coverage Diagram heading.
- Used `git log --oneline -- agents/post-task-reviewer.md` to confirm this file has a real,
  continuous history (not a stray recreate) and that `6277a1b` is the only commit touching it
  this round.
- Grepped `test/*.ts` for `post-task-reviewer.md` references to check whether any test asserts
  exact byte content of the real bundled file (which the new section would break). All hits
  (`test/agent-prompt.test.ts`, `test/commands/init.test.ts`, `test/commands/plan.test.ts`,
  `test/post-task-reviewer.test.ts`) use synthetic fixture strings written inline via
  `writeFileSync`, not the real file — so none could be affected either way. Nothing to
  verify further here; this rules out a regression class rather than leaving it unverified.
- Did not find a way to verify the claim "propagation is user-managed / `cairn init` copies
  this on next run" from static inspection alone beyond confirming `.claude/agents/` was in
  fact left untouched by this commit (`git show --stat 6277a1b` lists only
  `agents/post-task-reviewer.md`, not the `.claude/agents/` copy) — noting this as verified
  indirectly (by omission in the diff) rather than directly executed.

### Coverage
Task Requirements
├── [DONE] Instruct reviewer to run declared test commands and report pass/fail + output —
│         new "Run the task's declared test commands ... and report the real result —
│         pass/fail plus the relevant output" bullet, confirmed present in current file
├── [DONE] Instruct reviewer to use git inspection beyond the diff (e.g. `git show
│         <sha>:<path>`, `git log`) — bullet present verbatim with both named examples
├── [DONE] Instruct reviewer to state explicitly when something could not be verified —
│         bullet present: "say so explicitly in your findings rather than silently
│         reviewing from the diff alone"
├── [DONE] Preserve `internal: true` frontmatter — confirmed unchanged via git show diff
├── [DONE] Preserve the "may only write to the review file... never modify tasks.json"
│         instruction — confirmed unchanged, new section placed directly after it
├── [DONE] Preserve ASCII coverage-diagram format with [DONE]/[PARTIAL]/[GAP] markers —
│         confirmed byte-for-byte unchanged
├── [DONE] Preserve existing output template — confirmed byte-for-byte unchanged
└── [DONE] `cairn.json` not modified — confirmed not in changed-files list

### Files Changed
- agents/post-task-reviewer.md — adds `## Verification` section (3 bullets + 1 tie-back
  paragraph explaining how verification results fold into the unchanged output template)
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/state.json,
  .cairn/.cairn_iterations.log, .cairn/.cairn_tasks_snapshot.json — task-lifecycle
  bookkeeping (task #78 archived, tasks #79–84 added, counters advanced); not part of this
  task's stated scope but expected loop mechanics, not a concern

### Gaps
None detected against the stated requirements. One soft observation, not a gap: the task's
"fold into Coverage/Gaps/Regression Risks" instruction (own paragraph in the new section) asks
future reviewer runs to make `[DONE]` mean "confirmed," but the template itself still has no
dedicated place to show actual command output — a reviewer that ran a failing test has to
squeeze real stdout into "Regression Risks" prose. That's consistent with the task's explicit
instruction not to touch the template, and the task's own notes already flagged this as a
deliberate deferral for a future task rather than an oversight here.

### Regression Risks
None detected. No exports, code, or tests were touched — this is a prose-only change to a
markdown agent-prompt file. Confirmed no test pins the real file's exact byte content (see
Verification performed above), so the new section cannot break any existing assertion. Full
suite re-run by me independently: 827 pass, 0 fail, 29 files.

### Verdict
CLEAN

---

## Task #79: New src/claude-settings.ts — safe merge helper for .claude/settings.local.json
Reviewed: 2026-08-14T00:00:00Z

### Verification performed
- Ran `bun test test/claude-settings.test.ts` myself: 28 pass, 0 fail, 62 expect() calls —
  matches the completed-task notes exactly.
- Ran `bun run test` myself: 855 pass, 0 fail, 30 files — matches the notes exactly (was
  827/29 before this task, consistent with +28 new tests / +1 new file).
- Ran `git status --short .claude/` and confirmed it is clean — the repo's own
  `.claude/settings.local.json` (18 hand-accumulated rules per the task description) was not
  touched by the test run, confirming the "temp dir only" isolation claim actually holds in
  practice and not just by code inspection.
- Ran `git diff HEAD~1 HEAD -- cairn.json`: empty — confirms the "DO NOT modify cairn.json"
  instruction was honored.
- Ran the pinned health check
  (`bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck-review`): compiles
  clean.
- Read `src/tasks-file.ts` lines 160-189 directly (the cited reference implementation) and
  compared against `mergeClaudeSettings`'s `writeSettingsAtomic`: same `<path>.tmp.<pid>.<6
  random hex bytes>` staging pattern, same write→rename→unlink-on-failure structure. Faithful
  reproduction, not just a similar-looking approximation.
- Read the full diff of `src/claude-settings.ts` and `test/claude-settings.test.ts` directly
  (not relying solely on the task's own notes) to check the dedupe logic and shape-validation
  branches line by line — see Coverage below for what was traced.
- Could not execute a hostile/adversarial input beyond what the test suite already covers
  (e.g. deeply nested unicode edge cases in rule strings, or a `permissions` value that is an
  array rather than object — the latter *is* covered by `isPlainObject`'s `!Array.isArray`
  check and is implicitly exercised by the "top-level not an object" test, though there is no
  dedicated test for `permissions` itself being an array). Flagged below as a minor gap, not
  a blocking one.

### Coverage
Task Requirements
├── [DONE] Read/parse existing file; malformed JSON → throw, never clobber — `readSettings()`
│         runs before any write decision is made (including the "nothing to add" path,
│         verified by the "leaves a malformed file alone even when there is nothing to add"
│         test); confirmed the malformed-file test asserts the file is byte-for-byte
│         unchanged after the throw
├── [DONE] Union `permissions.allow`/`permissions.deny` by value, dedupe; create `permissions`
│         and either array only if missing — `selectNewRules()` + the `nextPermissions.allow =
│         ...` / `nextPermissions.deny = ...` branches, each gated independently; tested by
│         "creates only the missing array, leaving the sibling untouched"
├── [DONE] Preserve every other key untouched (`hooks`, `env`, `model`, `statusLine`, unknown
│         keys) — top-level and `permissions`-level spread (`{...(existing ?? {})}`,
│         `{...(permissions ?? {})}`); the "round-trips hooks, env, model, statusLine and
│         unrecognized keys" test covers all four named keys plus a synthetic unknown key
│         plus `permissions.defaultMode`/`additionalDirectories`
├── [DONE] Write atomically, following `writeTasksFile()`'s temp-file-replace pattern — traced
│         side-by-side against `src/tasks-file.ts:165-189`, structurally identical
├── [DONE] Idempotent — second run adds nothing and reports nothing; `addedAllow.length === 0
│         && addedDeny.length === 0` early-returns before any `fs` write call, so mtime and
│         exact byte formatting survive (tested directly: "does not rewrite the file when
│         nothing is added" asserts exact string equality of file contents pre/post)
├── [DONE] Return which rules were added — `MergeResult.addedAllow`/`addedDeny`, in original
│         supplied order and original (non-canonicalized) spelling
├── [DONE] Bash `x:*` / `x *` suffix-equivalence dedupe, comparison-only, never rewrites the
│         user's own spelling, non-Bash tools excluded, pre-suffix differences stay distinct —
│         `canonicalizeRule()` traced line by line: regex-gated to `Bash(...)` only, strips a
│         literal trailing `:*` and re-adds ` *`; four dedicated tests cover both directions
│         (`bun:*`→`bun *`-present and `bun *`→`bun:*`-present), the git/git-diff distinctness
│         case, and allow/deny-independent dedupe
├── [DONE] Test isolation — every one of the 28 tests runs inside
│         `fs.mkdtempSync(os.tmpdir(), 'cairn-claude-settings-test-')` via a shared
│         `beforeEach`/`afterEach`; confirmed no test references `projectRoot` from anywhere
│         but that fixture, and confirmed empirically via `git status --short .claude/` after
│         running the suite
└── [DONE] TDD — test file is comprehensive (28 tests) and covers all six named categories
          (fresh-file creation, merge into existing, unknown-key preservation, malformed-JSON
          refusal, idempotency, suffix-equivalent dedupe); could not directly verify the
          "written first, seen failing" ordering from the diff alone (a squashed single commit
          shows only the end state), so this is taken on the notes' word rather than
          independently confirmed — flagged under Gaps below as an unverifiable-not-a-gap item

### Files Changed
- src/claude-settings.ts — new module (214 lines): `ClaudeSettingsError`,
  `claudeSettingsPath()`, `canonicalizeRule()`, `mergeClaudeSettings()`, plus private
  `isPlainObject`/`readSettings`/`selectNewRules`/`writeSettingsAtomic` helpers
- test/claude-settings.test.ts — new (351 lines, 28 tests)
- src/tasks-file.ts — listed in the task's `files` but not modified; confirmed correct per the
  task's own framing ("around line 175" as a reference pattern to follow, not a file to edit)
  and confirmed no diff hunk touches it
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_tasks_snapshot.json —
  task-lifecycle bookkeeping (task #79 archived); expected loop mechanics, not a concern

### Gaps
None blocking. Two minor observations, neither rising to [PARTIAL]/[GAP] against the stated
requirements:
1. No dedicated test for `permissions` itself being a non-object *array* (e.g.
   `{"permissions": ["not", "an", "object"]}`) — `isPlainObject`'s `!Array.isArray` guard means
   this is handled correctly (verified by reading the code), but it's untested directly; the
   closest test ("refuses a top-level value that is not an object") exercises the same
   `isPlainObject` function at a different call site, not this one.
2. Could not independently verify the TDD "red before green" ordering claimed in the task's
   own completion notes, since the change landed as a single commit (`f53b751`) with no
   intermediate failing-test commit to inspect via `git log`. Not treating this as a gap — the
   resulting test suite is thorough and the code satisfies every test — but noting the
   ordering claim itself is unverified rather than confirmed.

### Regression Risks
None detected. This is a wholly new, currently uncalled module — no existing exports were
touched, removed, or renamed, and no existing test was modified or deleted. `git diff
HEAD~1 HEAD -- cairn.json` is empty. `git status --short .claude/` is clean after running the
full suite, confirming the isolation requirement holds in practice, not just on paper — a
regression here would have been silent corruption of this repository's own 18-rule
`.claude/settings.local.json`, which is exactly the failure mode the task called out as worst-
case. Full suite re-run by me independently: 855 pass, 0 fail, 30 files. Health check
(pinned throwaway-outfile form) compiles clean.

### Verdict
CLEAN

---

## Task #80: Wire the settings.local.json writer into cairn init
Reviewed: 2026-08-14T11:00:00Z

### Verification performed
- Ran `bun test test/commands/init.test.ts` myself: 135 pass, 0 fail, 290 expect() calls —
  matches the completed-task notes exactly.
- Ran `bun run test` myself: 879 pass, 0 fail, 30 files — matches the notes exactly (was
  855/30 before this task, consistent with +24 new tests in the same file).
- Ran `git diff e3e77ef~1 e3e77ef -- src/config.ts`: empty — confirms `config.ts` (listed in
  Expected Files) genuinely needed no change, rather than being silently skipped; `runInit`
  already had the resolved `CairnConfig` object with `healthCheck`/`defaultTestCommand` in
  hand from `promptForConfig`, and `buildInitPermissionRules` takes a `Pick<CairnConfig, ...>`
  of exactly those two fields, both typed as plain `string` in `src/types.ts`.
- Read `src/claude-settings.ts` and `src/post-task-reviewer.ts` in full to verify the
  extracted `GIT_INSPECTION_RULES`/`buildCommandRules` are byte-identical in behavior to the
  pre-existing private copies (same regex split, same `[(),]` filter, same dedupe-by-`includes`
  loop) — confirmed via `git show e3e77ef~1:src/post-task-reviewer.ts` side-by-side diff. The
  reviewer's call site (`...GIT_INSPECTION_RULES, ...buildTestCommandRules(task.tests)`) is
  unchanged, and `buildTestCommandRules` survives as a one-line delegation.
- Traced `runInit`'s prompt sequence by reading `promptForConfig` directly (10 prompts with
  narration disabled: projectName, projectDescription, healthCheck, defaultTestCommand,
  implementationFile, truncateText, claudeMdPattern, narrationEnabled,
  reviewMaxIterationsStr, reviewPostTask) plus `createInstructionsFile` (1) plus
  `installClaudeSettings` (1) = 12 total with narration disabled — confirms the new "skips the
  settings file when the user declines" test's 12-answer array
  (`['', '', '', '', '', '', '', '', '', '', 'n', 'n']`) lines up correctly with `n` landing on
  `instructions` then `settings`, and confirms `createMockPrompt`'s past-end `''` fallback is
  why `allDefaultAnswers()` (9 answers) still exercises the settings-file default-yes path
  correctly in the sibling test. Matches the "trap for the next agent" caveat the task's own
  notes flagged — verified rather than taken on faith.
- Confirmed `promptBoolean`'s `[Y/n]`/`[y/N]` hint logic (`src/commands/init.ts:160-168`,
  unchanged by this task) backs the "shows a Y/n hint" test and the "defaults to YES" task
  requirement.

### Coverage
Task Requirements
├── [DONE] Wire merge helper into `runInit`, alongside `installNarrationHooks`/
│         `createInstructionsFile` — `installClaudeSettings()` call added right after
│         `installNarrationHooks`, before `showNextSteps`
├── [DONE] Prompt before writing, defaulting to YES, via `promptBoolean` — `await
│         promptBoolean(rl, 'Write permission rules?', true)`; tested directly
├── [DONE] Allow: five read-only git subcommands, never blanket `Bash(git:*)` —
│         `GIT_INSPECTION_RULES`, tested including an explicit
│         "never allows a blanket git rule" test
├── [DONE] Allow: rules derived from `healthCheck`/`defaultTestCommand`, skip cleanly when
│         empty — `buildCommandRules([config.healthCheck, config.defaultTestCommand])`,
│         tested for derivation, empty-value skipping, compound-command splitting, and
│         cross-field dedupe
├── [DONE] Deny: exactly the five task-mutating subcommands, never a blanket
│         `Bash(cairn task:*)` — `CAIRN_TASK_DENY_RULES` hardcoded to exactly those five;
│         tested for exact-equality and for absence of any blanket/`next-id`/`show` rule
├── [DONE] Gitignore warning printed, no `.gitignore` or git config touched — WARNING text
│         printed when rules are written; tested that no `.gitignore` file is created
├── [DONE] Report via `InstallOptions`/`skipUnchanged`/`log` style — reuses `InstallOptions`
│         type, routes through `opts.log`, documents (and tests) that `skipUnchanged` is
│         accepted but not consulted since merging is inherently additive
├── [DONE] Test isolation — every new test uses `fs.mkdtempSync`/`afterEach` cleanup; verified
│         no test path resolves to the real repo root
└── [DONE] `cairn.json` not modified — confirmed via `git diff` against the pre-task commit

### Files Changed
- src/commands/init.ts — adds `buildInitPermissionRules()`, `installClaudeSettings()`,
  `CAIRN_TASK_DENY_RULES`; wires the new step into `runInit`
- src/claude-settings.ts — adds exported `GIT_INSPECTION_RULES` and `buildCommandRules()`
  (extracted from post-task-reviewer.ts, generalized to accept `(string | undefined)[]`)
- src/post-task-reviewer.ts — **not in Expected Files**, edited to delete its private
  `GIT_INSPECTION_RULES`/splitter and delegate to the newly shared versions; justified in the
  task notes as avoiding two independently-editable copies of a security-sensitive allowlist,
  and verified behaviorally identical (see Verification performed) with the reviewer's own
  test suite passing unchanged as part of the 879-test full run
- test/commands/init.test.ts — 24 new tests across `buildInitPermissionRules`,
  `installClaudeSettings`, and two new `runInit` integration tests
- CLAUDE.md — one-sentence doc update noting the git list and command splitter are now shared
  between `cairn init` and the reviewer; confirmed accurate against the actual code
- src/config.ts — listed in Expected Files but not modified; confirmed correct, no change was
  needed (see Verification performed)
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_tasks_snapshot.json —
  task-lifecycle bookkeeping (task #80 archived); expected loop mechanics, not a concern

### Gaps
None blocking. Two minor observations, neither rising to [PARTIAL] against the stated
requirements:
1. The gitignore WARNING is printed only when at least one rule was actually written (inside
   the `if (added.length === 0)` early-return, the "already has every rule" message prints
   instead and the WARNING is skipped). The task's wording ("print a WARNING telling the user
   to gitignore the file themselves") doesn't explicitly scope this to first-write-only, but
   conditioning on "was anything written" is a reasonable, tested design choice (a no-op
   re-run has no new state to warn about) rather than an omission — noting it as an
   interpretation worth confirming with the user if a future round wants the warning to repeat
   on every declined-cleanup re-run.
2. `src/post-task-reviewer.ts` was edited outside its Expected Files scope. Justified and
   verified safe (see Files Changed / Regression Risks), but flagging per the review
   checklist's "changed contracts" concern since it's a file the task description never
   mentioned.

### Regression Risks
None detected. `post-task-reviewer.ts`'s public behavior (the `--allowedTools` string it
builds, including the exact `GIT_INSPECTION_RULES` rule strings and the test-command splitting
semantics) is unchanged — confirmed by direct code comparison and by the full suite passing,
including `test/post-task-reviewer.test.ts`'s pinned exact-string assertions. No exports were
removed: `GIT_INSPECTION_RULES` and `buildCommandRules` are net-new exports from
`claude-settings.ts`; `buildTestCommandRules` in post-task-reviewer.ts remains present
(module-private, unexported, same signature) as a delegating wrapper, so nothing that imported
it before can break. No tests were deleted — only added. `cairn.json` untouched. Full suite
re-run by me independently: 879 pass, 0 fail, 30 files.

### Verdict
CLEAN

---

## Task #81: Add cairn task next-id to the planner's allowedTools
Reviewed: 2026-08-14T10:44:00Z

### Coverage
Task Requirements
├── [DONE] Add rule pre-approving `cairn task next-id` in prefix form on `runPlan`'s `--allowedTools` (`src/commands/plan.ts:166`, `Bash(cairn task next-id:*)` appended)
├── [DONE] Scoped strictly to `next-id` — no other `cairn task` subcommand, no git rules, no other widening; new test explicitly asserts no `Bash(cairn task:*)` blanket grant and no grant for the five mutating subcommands (start/complete/note/set-status/add)
├── [DONE] TDD against `test/commands/plan.test.ts`: existing exact-string assertion updated to the new value (would fail red before the implementation change, per commit message and independently re-run below), new scope-assertion test added
└── [DONE] `cairn.json` not modified (verified: `git show c8c8ad8 --stat` touches only `.cairn/*` bookkeeping, `src/commands/plan.ts`, `test/commands/plan.test.ts`)

### Files Changed
- src/commands/plan.ts — `--allowedTools` value changed from `Read,Glob,Grep,Write,Edit,Agent` to `Read,Glob,Grep,Write,Edit,Agent,Bash(cairn task next-id:*)`
- test/commands/plan.test.ts — updated the pre-existing exact-string assertion, added a new scope-assertion test
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log, .cairn/.cairn_tasks_snapshot.json — task lifecycle bookkeeping only (task #81 archival-adjacent reordering plus task #80 moving in the completed archive; not code changes)

### Gaps
None detected. The change is a single flag-string addition exactly matching the requested `Bash(cairn task next-id:*)` prefix form; no adjacent scope creep.

### Regression Risks
None detected. `--allowedTools` is a flat allowlist on the interactive `claude` planning session (not a layered allow/deny file like task #80's `settings.local.json` mechanism), so there is no deny-vs-allow ordering to worry about here. No exports removed, no tests deleted — one test updated in place, one new test added (44 → 45 tests in the file). Independently re-ran `bun test test/commands/plan.test.ts` (45 pass, 0 fail) and `bun run test` (880 pass, 0 fail across 30 files, matching the notes' claim). Confirmed via `git show c8c8ad8 --stat` that `cairn.json` was not touched by this commit (a separate, unrelated `cairn.json` change to `healthCheck` predates this commit on a prior commit, not part of task #81's diff).

### Verdict
CLEAN

---

## Task #82: Mark planner, audit-planner and summarizer as internal agents
Reviewed: 2026-08-14T10:50:00Z

### Verification performed
- Read `src/config.ts`'s `discoverAgents()` (lines ~98-133) directly: frontmatter is parsed
  between `---` delimiters via a per-line `key: value` regex, and `internal: true` is set on
  the returned `AgentInfo` only when `meta.internal === 'true'`. Confirms `AgentInfo.internal`
  (`src/types.ts:39`) is genuinely populated from the file, not just declared in the type.
- Read `src/commands/run.ts:63-86`'s `buildSystemPrompt()` directly: `if (agentInfo.internal)`
  warns and falls back to the generalist prompt before any specialist-file injection — the
  exact guard the task description cites, confirmed still wired to the parsed flag.
- Read `src/commands/plan.ts:82`: `agents.filter(a => !a.internal)` — confirms the stated,
  intended side effect (these three agents now drop out of the `cairn plan` preflight
  specialist listing) is accurate and was correctly noted rather than silently left unverified.
- Read `src/agent-prompt.ts`'s `buildAgentArgs()` in full: reads the whole `.claude/agents/
  <name>.md` file via `readFileSync` and passes it verbatim as `prompt` inside a
  `JSON.stringify`'d `--agents` blob — no YAML parsing or frontmatter-stripping happens here,
  so a leading `---` block is inert plain text to this function. Confirms the task's precedent
  claim ("`post-task-reviewer.md` already has frontmatter and works this way") by reading the
  code rather than trusting the notes' assertion.
- Diffed all four `agents/*.md` files' frontmatter blocks directly (`head -8` on each): the
  three new blocks match `post-task-reviewer.md`'s existing `name`/`description`/
  `internal: true` shape exactly — same three keys, same delimiter style, one blank line before
  the body.
- Ran `bun test test/config.test.ts` myself: 50 pass, 0 fail — matches the notes (was 49 before,
  net +1 test as claimed).
- Ran `bun run test` myself: 881 pass, 0 fail, 30 files — matches the notes exactly (was 880
  before this task).
- Inspected the new test (`test/config.test.ts`, "marks every bundled non-executor agent as
  internal..."): it copies the *real* `agents/*.md` files from this repo's own `agents/`
  directory into a temp `.claude/agents/` dir and asserts `internal === true` for all four named
  agents via `discoverAgents()`. This is a genuine regression guard against the exact bug class
  fixed here (a real bundled file silently losing its frontmatter), not merely a synthetic-
  fixture unit test of the parser in the abstract.
- Confirmed `cairn.json`'s `healthCheck` still points at the pinned throwaway outfile
  (`/tmp/cairn-healthcheck`) and is absent from the diff's changed-files list — the
  "DO NOT modify cairn.json" instruction was honored.
- No prose/body text in any of the four `agents/*.md` files was altered — only the six-line
  frontmatter block was inserted above the pre-existing first line in each of the three edited
  files (confirmed via the diff hunks, which show only additions, no removed/changed lines
  below the `---` closing delimiter).

### Coverage
Task Requirements
├── [DONE] Add YAML frontmatter (`name`, `description`, `internal: true`) to `planner.md`,
│         `audit-planner.md`, `summarizer.md`, matching `post-task-reviewer.md`'s format —
│         confirmed byte-shape-identical across all four files
├── [DONE] Verify agent discovery parses `internal` into `AgentInfo.internal` so the run.ts
│         guard fires — confirmed by direct code read (`discoverAgents`, `AgentInfo`,
│         `buildSystemPrompt`'s guard) plus the new dedicated regression test against the real
│         bundled files
├── [DONE] Verify `buildAgentArgs` is not broken by added frontmatter — confirmed by direct
│         code read (`readFileSync` + `JSON.stringify`, no YAML parsing) rather than assumed;
│         task notes additionally describe an ad-hoc verification script exercising all four
│         files, consistent with the code-level confirmation
├── [DONE] Confirm and note the `cairn plan` preflight specialist-listing side effect
│         (`buildDynamicContext`'s `!a.internal` filter now excludes all three) — confirmed
│         accurate via direct read of `plan.ts:82`, and explicitly called out in the task notes
│         as intended rather than a regression
├── [DONE] Do not edit `.claude/agents/*.md` directly — confirmed: changed-files list contains
│         only the bundled `agents/*.md` source files, no `.claude/agents/` paths
└── [DONE] `cairn.json` not modified — confirmed absent from the diff, `healthCheck` still
          pinned to the throwaway outfile

### Files Changed
- agents/planner.md — adds `name`/`description`/`internal: true` frontmatter (body unchanged)
- agents/audit-planner.md — same
- agents/summarizer.md — same
- test/config.test.ts — new regression test in the `discoverAgents` describe block, copying the
  real `agents/*.md` files and asserting all four are discovered with `internal: true`
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log — task-lifecycle
  bookkeeping (task #82 archived, iteration 6 logged); expected loop mechanics, not a concern

### Gaps
None detected. All three files received frontmatter, the two explicitly-requested verifications
were genuinely performed (traced in code, not merely asserted in notes), the intended
side-effect on the `cairn plan` listing was confirmed and correctly framed as expected, and a
real regression test backs the fix against recurrence.

### Regression Risks
None detected. Only additive frontmatter blocks were inserted; no existing prose, headings, or
instructions in any of the four agent files were altered, reordered, or removed. No exports were
touched — `discoverAgents`, `AgentInfo`, `buildSystemPrompt`, `buildDynamicContext`, and
`buildAgentArgs` are all unmodified by this task; the fix is purely data (frontmatter) plus one
new test. No existing tests were deleted or weakened — only one test added (49 → 50 in
`config.test.ts`, 880 → 881 overall). The expected and correctly-flagged behavior change to the
`cairn plan` specialist listing (three agents no longer appear) is not a regression — it's the
task's stated intent, and existing filter-behavior tests in `test/commands/plan.test.ts` don't
pin which specific agents appear, only the filter mechanism, so nothing there needed updating.
Full suite re-run by me independently: 881 pass, 0 fail, 30 files. `cairn.json` confirmed
untouched and still pinned to the throwaway outfile.

### Verdict
CLEAN

---

## Task #83: CLAUDE.md — truth-up the tasks.json enforcement story
Reviewed: 2026-08-14T10:55:00Z

### Coverage
Task Requirements
├── [DONE] Correct the enforcement set from "two ways" to the actual three:
│         (1) per-agent system prompt ban, (2) directory-scoped write allowlist
│         (`<dataDir>/reviews/**`, with the `GIT_INSPECTION_RULES`/`buildCommandRules`/
│         `reviewsDir` prose preserved verbatim), (3) new — `permissions.deny` rules on the
│         five mutating `cairn task` subcommands written by `cairn init`
│         (`CAIRN_TASK_DENY_RULES`) — confirmed against `src/commands/init.ts:481-487`,
│         which lists exactly `start`, `complete`, `set-status`, `add`, `note`
├── [DONE] Record fact 1 — deny rules are not enforced under
│         `--dangerously-skip-permissions`, so they bind the reviewer/planner (normal
│         permission mode) but not `cairn run` execution agents — confirmed against
│         `grep -rn dangerously-skip-permissions src/`, which shows only
│         `run.ts:210`/`summarize.ts:107` pass that flag, not `plan.ts` or
│         `post-task-reviewer.ts`
├── [DONE] Record fact 2 — deny covers mutating subcommands only; a blanket
│         `Bash(cairn task:*)` would break `next-id`; deny beats allow with no exception
│         mechanism — present verbatim in the new text
└── [DONE] Scope the ban itself to execution agents mutating a live task list mid-round,
          and reconcile with `commands/generate-tasks.md`'s Write-tool instruction for task
          generation — confirmed `generate-tasks.md:159` does instruct writing
          `.cairn/tasks.json` directly with Write, so the prior flat "forbidden" wording was
          a genuine contradiction and is now resolved

### Files Changed
- CLAUDE.md — one paragraph in "Agent workflow" expanded into a scoped-ban sentence, a
  3-item enforcement list, a 2-item "easy to get wrong" list, and the closing
  `writeTasksFile()` sentence (unchanged content, just repositioned)
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log,
  .cairn/.cairn_tasks_snapshot.json — task-lifecycle bookkeeping (task #83 archived,
  iteration 7 logged); expected loop mechanics, not a concern

### Gaps
None detected. Both parts of the task description are fully addressed, and the new prose
preserves all previously-existing detail (the `GIT_INSPECTION_RULES`/`buildCommandRules`/
`reviewsDir` sub-bullet survives verbatim) rather than dropping it while adding the third
enforcement item.

### Regression Risks
None detected. Documentation-only change to CLAUDE.md; no source files touched, no exports
affected, no tests deleted (`bun run test` unchanged at 881 pass, 0 fail, as expected for a
prose-only diff). The CRITICAL GUARD was honored: `cairn.json` is absent from the diff, its
`healthCheck` remains pinned to `/tmp/cairn-healthcheck`, and CLAUDE.md's own health-check
documentation (lines 11, 18, 68, 107 — `bun run build` / `--outfile dist/cairn`) is
unmodified by this task, correctly preserving the intentional disagreement for the duration
of the self-modifying round.

### Verdict
CLEAN

---

## Task #84: README.md — document the permission rules init now writes
Reviewed: 2026-08-14T10:56:00Z

### Verification performed
- Read `src/commands/init.ts:481-566` directly: `CAIRN_TASK_DENY_RULES` lists exactly
  `start`, `complete`, `set-status`, `add`, `note`; `promptBoolean(rl, 'Write permission
  rules?', true)` confirms default-yes/skippable; the WARNING log block (lines 559-563)
  confirms the gitignore claim's substance.
- Read `src/claude-settings.ts:71-77` (`GIT_INSPECTION_RULES`) and `:180-260`
  (`selectNewRules`/`mergeClaudeSettings`) directly: confirms the five git subcommands
  named in the README match exactly, and that the merge spreads both top-level and
  `permissions`-level existing keys before only adding new rule entries — i.e. genuinely
  additive, not replacing.
- Read the current `README.md` (post-diff) directly rather than trusting the diff hunk in
  isolation: the new Initialize-section paragraph sits after the existing re-run note, and
  the new Configuration-section sentence sits directly after the field table, before
  "Health Check Auto-Detection" — both placements match the task's stated preference.

### Coverage
Task Requirements
├── [DONE] `cairn init` offers to write `.claude/settings.local.json`; prompt defaults to
│         yes, is skippable — README states this explicitly; matches
│         `promptBoolean(rl, 'Write permission rules?', true)`
├── [DONE] WHAT gets written — allow: read-only git inspection subcommands + rules derived
│         from `healthCheck`/`defaultTestCommand`; deny: five mutating `cairn task`
│         subcommands — README's Allow/Deny bullets name all five git subcommands and all
│         five task subcommands correctly, verified against source
├── [DONE] WHY — the post-task reviewer (and similar agents) need to run tests/inspect
│         history but run under normal permissions, not `--dangerously-skip-permissions`;
│         without these rules a fresh project denies them outright in headless mode —
│         present near-verbatim in README
├── [DONE] Existing settings MERGED not replaced — `permissions.allow`/`deny` unioned,
│         every other key preserved untouched, so plain-`claude` users don't lose settings
│         — present verbatim in README, matches `mergeClaudeSettings`'s spread-then-append
│         behavior
├── [DONE] User should gitignore `.claude/settings.local.json` themselves; Cairn
│         deliberately does not edit `.gitignore` or global git config; Claude Code only
│         auto-ignores files it creates itself — present in README's closing paragraph,
│         matches the WARNING log text's substance (condensed but no loss of the key claim)
└── [DONE] (bonus, "if useful") cross-reference from Configuration — one sentence added
          after the `cairn.json` field table linking back to `#1-initialize`

### Files Changed
- README.md — new paragraph block in Workflow > 1. Initialize (after the existing re-run
  note): prompt-default sentence, Allow/Deny bullets, WHY paragraph, merge-semantics
  paragraph, gitignore paragraph. Plus one cross-reference sentence in Configuration,
  after the `cairn.json` field table.
- .cairn/tasks.json, .cairn/tasks.completed.json, .cairn/.cairn_iterations.log,
  .cairn/.cairn_tasks_snapshot.json — task-lifecycle bookkeeping (task #84 archived,
  iteration 8 logged); expected loop mechanics, not a concern

### Gaps
None detected. All five required points are present, and each was independently checked
against the actual source (`src/commands/init.ts`, `src/claude-settings.ts`) rather than
taken on the completed-task notes' word — every factual claim in the new README prose
(subcommand names, default behavior, merge semantics, gitignore rationale) checks out
accurately. Existing README table/heading structure and formatting conventions are
preserved; the new content is inserted as prose/bullets at natural points rather than
disrupting the existing table-driven sections.

Note on the personal TDD instruction ("write the test, see it fail, then make it pass"):
not applicable to this task — its entire scope is README prose, and the repo has no
doc-lint or prose-assertion test harness for README content to red/green against. Not
treated as a gap; consistent with how task #83 (also CLAUDE.md prose) was assessed in this
same round.

### Regression Risks
None detected. Documentation-only change to README.md; no source files touched, no exports
affected, no tests deleted or weakened (`bun run test` unchanged at 881 pass, 0 fail — as
expected for a prose-only diff). The CRITICAL GUARD was honored: `cairn.json` is absent
from this diff entirely, so the pinned throwaway-outfile `healthCheck` value for this
self-modifying round was left untouched.

### Verdict
CLEAN
