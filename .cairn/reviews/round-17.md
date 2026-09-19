# Round 17 post-task reviews

## Task #117: cairn init: add missing entries to an existing .cairn/.gitignore
Reviewed: 2026-09-19T22:40:00Z

### Coverage
```
Task #117 Requirements
├── [DONE] Append-only merge for the existing-.gitignore case
│   ├── [DONE] mergeGitignoreEntries() in src/commands/init.ts (exported)
│   ├── [DONE] Trimmed, exact-string, position-independent matching
│   │          (Set of every trimmed non-blank existing line — mid-file,
│   │           end-of-file and legacy .ralph_* lines all count as present)
│   ├── [DONE] Only non-comment lines of GITIGNORE_CONTENT are candidates
│   │          (currentGitignoreEntries() filters blanks and '#' lines)
│   ├── [DONE] Appends under a short header
│   │          ('# Added by cairn init (missing entries)')
│   └── [DONE] Never reorders/rewrites/removes: writes `existing + addition`,
│              and returns early (no write at all) when nothing is missing
├── [DONE] initCoreFiles() wires the else-branch to the merge
├── [DONE] Prints "  Updated: <dirName>/.gitignore (added N entries)" when N > 0
│          (uses path.basename(dataDir), so a legacy .ralph data dir is named
│           correctly)
├── [DONE] Prints nothing when N == 0
├── [DONE] init still never touches the repo root .gitignore
│          (only path.join(dataDir, '.gitignore') is read/written; new test
│           asserts an untouched root file)
└── Tests
    ├── [DONE] Legacy .ralph_*-only file gains the missing current entries
    │          (asserts the 5 round-15 entries by name + "added 12 entries";
    │           12 is correct: 14 GITIGNORE_CONTENT entries minus the two the
    │           legacy fixture already has — .ralph_task_*_notes.md and
    │           instructions.md)
    ├── [DONE] All-entries-present MID-FILE file left byte-identical, no output
    │          (fixture puts a trailing user comment + node_modules/ after the
    │           entries and scrambles their order — a true position-independence
    │           check, not an end-of-file one)
    ├── [DONE] User-added lines preserved
    ├── [DONE] Second init adds nothing and prints nothing
    ├── [DONE] Pre-existing re-init test still passes unmodified
    │          ("is idempotent — running twice produces same files",
    │           test/commands/init.test.ts:277 after the shift)
    └── [UNVERIFIABLE] TDD ordering (test first, watched fail) — the work
                       landed as one squashed commit (3119796), so the
                       red-then-green sequence cannot be confirmed from
                       history; only the final green state is observable.
```

### Files Changed
- `src/commands/init.ts` (+39/-0) — `currentGitignoreEntries()`, `GITIGNORE_MERGE_HEADER`, exported `mergeGitignoreEntries()`, and the new `else` branch in `initCoreFiles()`
- `test/commands/init.test.ts` (+112/-2) — one existing test retitled/re-asserted, five new tests
- `.cairn/tasks.json` (+160/-2) — round-17 task list + task #117 marked complete (bookkeeping, not code)

### Verification performed
- Read the full commit range `336ec91..HEAD` (`git diff`, `git log --oneline`, `git diff --numstat`) and the post-change `src/commands/init.ts` via `git show HEAD:...`.
- Confirmed from `--numstat` that only 2 test lines were removed — no test was deleted; coverage is strictly larger (5 new tests).
- Confirmed the entry arithmetic by hand against `TEMP_IGNORE_SUFFIXES` (12 `.cairn_*` suffixes) + `.ralph_task_*_notes.md` + `instructions.md` = 14, so the legacy fixture is missing exactly 12.
- Confirmed the pre-existing idempotency test is untouched and still passes for the right reason (a freshly written `.gitignore` already contains every entry, so the merge is a no-op).
- Confirmed `cairn.json`'s uncommitted user change was left unstaged (`git status --short` still shows ` M cairn.json`), and neither `cairn.json` nor `package.json` is in the commit — the pinning constraints were respected.
- Test validation was run by cairn before this review; I did not re-run it. Read `.cairn/.cairn_task_117_tests.log`: `bun run typecheck` exit 0 (569ms), `bun test` exit 0, 1200 pass / 0 fail (7.5s).
- I could not statically search the working tree for other `GITIGNORE_CONTENT` consumers (this reviewer's Bash scope is git-inspection only and Grep is unavailable in the session); I read `src/commands/init.ts` in full instead and confirmed the constant has exactly two consumers, both in that file.

### Gaps
None detected against the task description. Two observations that are not requirement gaps:
- TDD ordering is unverifiable from a single squashed commit (noted above).
- `mergeGitignoreEntries` is exported but no test imports it; the behavior is exercised only through `initCoreFiles`. Harmless, but the export currently buys nothing.

### Regression Risks
1. **`initCoreFiles()` can now throw on an existing `.gitignore` it cannot read.** `mergeGitignoreEntries()` calls `fs.readFileSync`/`fs.writeFileSync` with no try/catch, and `initCoreFiles` has no handler, so an unreadable or non-regular `.cairn/.gitignore` (permissions, or a directory with that name) now aborts the whole `cairn init` run before tasks.json/state.json are created. Previously that branch was a no-op and init continued. Low likelihood, but it is a changed failure contract, and it diverges from how `installClaudeSettings` handles an unusable settings file (catch, report, continue).
2. **`cairn init` now modifies a user-owned file.** Re-running init silently re-adds an entry a user deliberately deleted from `.cairn/.gitignore` (and a `!`-negated line does not count as present under exact-string matching, so the positive entry is appended after the negation and wins). This is the task's intended behavior, but it is a new class of side effect for `init`, and it is unprompted — worth a line in the round-17 docs task (#123) so users know re-running init can rewrite that file.

Neither risk touches an exported contract other modules depend on: `GITIGNORE_CONTENT` is still file-local with the same two consumers, `initCoreFiles`'s signature is unchanged, and the fresh-file branch (including the `Created:` message) is byte-for-byte what it was.

### Verdict
HAS_RISKS

---

## Task #118: Hook: deny $ anywhere in reviewer Bash; fold Writer into cli-io.ts
Reviewed: 2026-09-19T22:45:00Z

### Coverage
```
Task #118 Requirements
├── [DONE] isInspectionOnly(): deny `$` ANYWHERE in a reviewer Bash command
│   ├── [DONE] Pre-check regex changed /[`<>]|\$\(/ → /[`<>$]/ (hook.ts:111);
│   │          `$` is literal inside the class, so `$(`, `${…}`, `$VAR` and
│   │          `$'…'` are all subsumed, and `<`, `>`, backtick still deny
│   └── [DONE] Verified the hole by hand against the pre-change file
│              (git show 3119796:src/commands/hook.ts): `git log
│              --output${X}=/tmp/f` passed the old regex, stripped to
│              `--output{X}=/tmp/f` (matching neither `--output` nor
│              `--output=`), and started with the `git log ` prefix → ALLOW.
│              The new regex rejects it at the first check.
├── [DONE] Keep the exact-token --output/--output= check as a second layer
│   └── [DONE] hasOutputOption() retained and still called after the regex
│              (hook.ts:114), ordering unchanged
├── [DONE] Stop stripping `$` in hasOutputOption
│   └── [DONE] /['"\\$]/g → /['"\\]/g; `'`, `"`, `\` still stripped, so the
│              pre-existing quoting variants still resolve to `--output=`
├── [DONE] Deny reason mentions shell variables/expansion alongside
│          redirection, command substitution and --output (hook.ts:147)
├── [DONE] Fold hook.ts's local `Writer` type into an import from src/cli-io.ts
│   ├── [DONE] `type Writer = {…}` deleted; `import type { Writer } from
│   │          '../cli-io'` added; the two later uses (stdout/stderr opts)
│   │          type-check (typecheck passed)
│   └── [N/A]  src/cli-io.ts itself needed no change — it already exports the
│              identical `Writer` type from #115 (read the file to confirm),
│              so its presence in the task's `files` list is vacuous, not a gap
├── [DONE] Tests — newly denied
│   └── [DONE] `git log --output${X}=/tmp/f`, `git diff $X`,
│              `git show $'--output=x'` (test/commands/hook.test.ts:187-192)
├── [DONE] Tests — still allowed
│   └── [DONE] `git diff abc123..def456`, `git log --oneline -5`, `git status`
│              (hook.test.ts:205-209), plus the pre-existing allow cases
│              (`--output-indicator-*`, chained inspection commands) untouched
├── [DONE] Tests — still denied (quoting variants + redirection)
│   └── [DONE] `--output"="x`, `--outpu't'=x`, `--output\=x` asserted to deny
│              *with the --output reason* (hook.test.ts:196-202), which is what
│              proves the second layer still carries them; the original deny
│              list (`git diff > out.txt`, `$(rm x)`, backticks, `| sh`, …) at
│              hook.test.ts:152-175 is untouched
├── [DONE] Repo-safety constraints (no `cairn round|hook|init` against this
│          root, no real reviewer spawned) — nothing in the diff or the commit
│          touches those paths; verification was pure-function unit tests
├── [DONE] cairn.json healthCheck / package.json build untouched — the commit
│          contains only src/commands/hook.ts and test/commands/hook.test.ts;
│          `git status` still shows cairn.json modified but unstaged
└── [UNVERIFIABLE] TDD ordering (write failing test, watch it fail, then fix)
                   — one squashed commit (c3d56f3), so red-then-green cannot be
                   confirmed from history. The notes claim both new `$` cases
                   returned `allow` pre-fix; I independently confirmed that
                   claim is *true of the pre-change code* by tracing
                   3119796:src/commands/hook.ts, but not that the test was
                   written first.

### Files Changed
- `src/commands/hook.ts` (+17/-11) — regex widened to `/[`<>$]/`, `$` dropped from `hasOutputOption`'s strip set, deny reason reworded, `Writer` imported from `../cli-io`, comments updated
- `test/commands/hook.test.ts` (+28/-0) — 9 new cases in three loops (newly denied `$` forms, `$`-free `--output` quoting variants, plain allowed commands)
- (`src/cli-io.ts` listed in the task's `files` but correctly unchanged — it already exported `Writer`)

### Verification performed
- Inspected the range `3119796..HEAD` with `git diff`, `git diff --stat`, `git log --oneline`; single commit `c3d56f3`, two files, +45/-11.
- Read the post-change `src/commands/hook.ts` (lines 80-170) and `src/cli-io.ts` directly to confirm the import resolves to the same `{ write: (chunk: string) => void }` shape and that no second `Writer` declaration remains.
- Traced the reported hole through the *pre-change* source rather than trusting the description: old regex → pass, old strip → `--output{X}=/tmp/f`, prefix match → allow. The fix closes it at the earliest check.
- Confirmed no test was deleted or weakened: `--stat` shows +28/-0 on the test file, and the pre-existing deny/allow loops are still present verbatim.
- Confirmed `isInspectionOnly` / `hasOutputOption` are module-private and only reached through the exported `decidePreToolUse`, so no export contract changed. (I could not grep the tree — this reviewer's Bash scope is git-inspection only and no Grep tool was available in the session — so I verified consumers by reading hook.ts in full and the reviewer/settings docs via `git show`.)
- Test validation was run by cairn before this review and I did not re-run it: `bun run typecheck` passed (476ms), `bun test` passed 1209 / 0 fail (8.4s) — consistent with #117's 1200 plus the 9 new cases.
- Live confirmation of the *old* behavior, incidentally: this session's own hook denies still quote the pre-change reason text ("without redirection, command substitution, or the --output option"), because the round's `cairn` binary is pinned. The new reason string ships only after unpinning.

### Gaps
None detected against the task description. Two observations that are not requirement gaps:
- TDD ordering is unverifiable from a single squashed commit (noted above).
- `src/cli-io.ts` appears in the task's expected-files list but needed no edit; the fold was import-side only.

### Regression Risks
1. **Documentation now understates the rule.** `CLAUDE.md` ("Enforcement under /cairn-run") still says the reviewer's Bash is denied "never with redirection (`<`, `>`), backticks, or `$(`", and `README.md` ("Containment under /cairn-run") still says "no redirection, command substitution, or git's file-writing `--output` option". Neither mentions that **any** `$` is now denied. Both are the files future agents and users read to predict the hook's behavior, and the drift is exactly the kind that produced the stale-claim incident recorded in CLAUDE.md. Not in this task's scope (docs are not in its `files`), so this should be picked up by the round's docs task.
2. **The `$`-anywhere rule is strictly broader than "shell expansion" and can deny a legitimate inspection command.** Any reviewer Bash containing a literal `$` is refused before parsing — e.g. a repo path or pathspec containing `$`, `git log --grep='\$foo'`, or `git show 'HEAD:a$b.ts'`. In those (rare) cases the reviewer loses git inspection entirely rather than falling back, and the deny reason points at shell expansion rather than the real cause. Accepted-looking trade-off given the prompt's `${range}` is interpolated before the reviewer sees it, but it is a real narrowing of previously-allowed behavior, and it has no escape hatch.
3. **Headless-reviewer gap is unchanged and now wider in relative terms.** `cairn run`'s reviewer is contained by `--allowedTools` prefix rules, which cannot exclude an argument, so `git diff --output${X}=f` — the exact case this task closes for `/cairn-run` — remains allowed on the headless path. CLAUDE.md already documents the `--output` half of this gap as accepted defense-in-depth; this task does not change it, but the `${X}` variant is not called out there, so the accepted-gap note is now incomplete rather than wrong.

### Verdict
HAS_RISKS

---

## Task #119: Hook: find the project from the tool call's cwd, not CAIRN_PROJECT_ROOT
Reviewed: 2026-09-19T22:52:00Z

### Coverage
```
Task #119 Requirements
├── [DONE] Hook resolves the project from the payload's own `cwd`, ignoring
│          CAIRN_PROJECT_ROOT
│   ├── [DONE] `payloadCwd` set only for a non-empty string `input.cwd`
│   │          (hook.ts:203) — an empty string no longer counts as usable,
│   │          a small strictening over the old `typeof === 'string'`
│   └── [DONE] `resolveProjectRoot()` (hook.ts:193) →
│              `findProjectRoot(payloadCwd, { ignoreEnv: true })`, which walks
│              up for `.cairn/` (utils.ts:89) before git root / cwd
├── [DONE] With no usable `cwd`, fall back to today's behavior
│   └── [DONE] `findProjectRoot(fallbackCwd)` where
│              `fallbackCwd = opts.cwd ?? process.cwd()` — env var first
├── [DONE] The same resolution serves the fail-open error-log location
│   └── [DONE] catch block now calls `findDataDir(resolveProjectRoot())`
│              (hook.ts:228) instead of the old `findProjectRoot(cwd)`;
│              `payloadCwd` is declared outside the `try`, so a failure after
│              parsing still logs against the payload's project
├── [DONE] Shape: options argument on findProjectRoot
│   └── [DONE] exported `FindProjectRootOptions { ignoreEnv?: boolean }`
│              (utils.ts:59) with a doc comment naming the hook as the only
│              intended caller
├── [DONE] findProjectRoot's default behavior unchanged
│   ├── [DONE] `opts: FindProjectRootOptions = {}` — a one-arg call is
│   │          byte-identical in behavior; step 1 is only skipped when
│   │          `opts.ignoreEnv` is truthy
│   └── [DONE] Guarded by an assertion inside the new utils test
│              (`findProjectRoot(nested)` still returns the env value) and by
│              the pre-existing "returns CAIRN_PROJECT_ROOT env var when set"
│              test, untouched
├── [DONE] Tests — env project A vs payload-cwd project B
│   ├── [DONE] B's tasks.json is the denied one; A's tasks.json is allowed
│   │          (hook.test.ts:362-383)
│   ├── [DONE] reviewer may Write B/.cairn/reviews/, denied for
│   │          A/.cairn/reviews/ with B's path in the reason (385-400)
│   ├── [DONE] no `cwd` in the payload → A still wins (402-411); the fixture
│   │          destructures `cwd` off and asserts `'cwd' in noCwd === false`,
│   │          so it really exercises the fallback
│   └── [DONE] extra case beyond the ask: a payload cwd in a bare dir fails
│              open (exit 1) and writes no error log into A (413-429) — the
│              direct test of the "deny and its log never name different
│              projects" clause
├── [DONE] Save/restore process.env.CAIRN_PROJECT_ROOT
│   └── [DONE] outer `preToolUseHookCommand` beforeEach/afterEach
│              (hook.test.ts:241-257) save and restore it; the nested describe
│              sets it after that save and removes project A in its own
│              afterEach. utils.test.ts's `findProjectRoot` describe already
│              had the same save/restore (test/utils.test.ts:76-90)
├── [DONE] Repo-safety constraints — every new temp dir via `fs.mkdtempSync`;
│          no `cairn round|hook|init` invocation, the tests call the exported
│          function in-process
├── [DONE] cairn.json healthCheck / package.json build untouched, ./install.sh
│          not run — neither file is in commit 2037720, and `git status` still
│          shows cairn.json modified-but-unstaged
├── [BONUS] CLAUDE.md "Enforcement under /cairn-run" gained a paragraph
│           recording the cwd-first rule and the untouched default
└── [UNVERIFIABLE] TDD ordering (write failing test, watch it fail) — the work
                   landed as one squashed commit (2037720), so red-then-green
                   cannot be confirmed from history. The notes claim 5
                   failures first; I confirmed only the final green state.
```

### Files Changed
- `src/utils.ts` (+16/-3) — exported `FindProjectRootOptions`, `findProjectRoot(cwd?, opts = {})`, env step gated on `!opts.ignoreEnv`, doc comment updated
- `src/commands/hook.ts` (+20/-6) — `fallbackCwd` / `payloadCwd` / `resolveProjectRoot()`, used by both the decision path and the fail-open error log; `PreToolUseHookCommandOpts.cwd` doc tightened
- `test/commands/hook.test.ts` (+82/-0) — new nested describe `CAIRN_PROJECT_ROOT vs the payload cwd`, 5 tests
- `test/utils.test.ts` (+16/-0) — 2 new `findProjectRoot` cases (`ignoreEnv: true` / `false`)
- `CLAUDE.md` (+2/-0) — one paragraph in "Enforcement under /cairn-run"
- `.cairn/tasks.json` (+4/-40), `.cairn/state.json` (+1/-1) — bookkeeping: #119 marked complete, #117/#118 archived out by settle (both verified present in the working tree's `tasks.completed.json`, so no task was dropped), `nextTaskId` 117 → 124 from planning

### Verification performed
- Inspected the range `c3d56f3..HEAD` (`git diff`, `git log --oneline`, `git diff --name-only`, `git show --stat c3d56f3`): one commit, 2037720.
- Read the post-change `src/commands/hook.ts` (lines 120-248) and `src/utils.ts` in full rather than reviewing the diff alone — confirmed `resolveProjectRoot` is the only resolver left in the function (no stray `findProjectRoot(cwd)` remains), that it is called after `isFastPathAllow` (so a main-session call still needs no project lookup), and that `runPreToolUseHook()` passes no `cwd`, so production always takes the payload path.
- Traced the bare-dir fail-open by hand: walk-up finds no `.cairn`, `git rev-parse` throws for a non-repo temp dir, step 4 returns the cwd, `findDataDir` (a pure `join`, no legacy `.ralph` probing) yields a non-existent dir → `existsSync` guard → nothing written anywhere. Matches the new test's assertions.
- Checked the tasks.json deletions were archival, not loss: `git diff -- .cairn/tasks.completed.json` shows #117, #118 and #119 all appended with `status: complete`.
- Confirmed no test was deleted or weakened — both test files are +N/-0.
- Test validation was run by cairn before this review and I did not re-run it: `bun run typecheck` passed (476ms), `bun test` passed 1216 / 0 fail (8.7s) — 1209 (#118) + 7 new cases, which reconciles exactly.
- I could not grep the working tree for other `findProjectRoot` callers (this reviewer's Bash scope is git-inspection only and no Grep tool was available in the session), so I verified compatibility structurally instead: the new parameter is optional with a `{}` default, and the task's `bun run typecheck` pass covers every `src/` call site.

### Gaps
None detected against the task description. Observations that are not requirement gaps:
- TDD ordering is unverifiable from a single squashed commit (noted above).
- The CLAUDE.md paragraph added here sits directly above the bullet that still describes the reviewer Bash rule as "redirection (`<`, `>`), backticks, or `$(`" — stale since #118 widened it to any `$`. Already flagged in the #118 review and out of this task's scope; noting only that #119 edited that same section without fixing it, so the round's docs task still needs it.
- `.cairn/state.json`'s `nextTaskId` bump came from planning, not from this task; it rode along in the commit. Harmless (state.json is committed by design), but outside the "stage only the files you changed" instruction.

### Regression Risks
1. **A payload `cwd` whose tree contains no `.cairn/` now fails open silently, where the env var previously rescued it.** With `ignoreEnv: true` the resolver can land on a directory with no data dir (a bare dir, or a git root without `.cairn/`); the hook then throws "data dir not found", exits 1, and the call is allowed — subagent containment is off for that call. Worse, the error log is written to that *same* resolved project, so when the directory has no `.cairn/` there is nowhere to append and the failure never reaches `.cairn_hook_errors.log`, i.e. `cairn round next`'s `warnings` array never surfaces it. This is the behavior the task explicitly asked for and is close to unreachable in practice (the hook is registered in the project's own `.claude/settings.local.json`, so a session outside that project would not run the hook at all), but it is a real narrowing: before this change, `CAIRN_PROJECT_ROOT` made the hook resolve *something* in that situation. No action proposed; recorded so it is not re-derived later.

No other regression surface: `findProjectRoot`'s default path is unchanged and still covered by its original test, no export was removed (`FindProjectRootOptions` is purely additive), `decidePreToolUse` / `HookContext` / `PreToolUseHookCommandOpts` shapes are unchanged, and the fast-path allow still short-circuits before any filesystem lookup.

### Verdict
HAS_RISKS

---

## Task #120: test/ type errors, batch A
Reviewed: 2026-09-19T23:30:00Z

### Coverage
```
Task #120 Requirements
├── [DONE] Fix the 19 assigned test/ type errors
│   ├── [DONE] test/post-task-reviewer.test.ts — 11 x TS2345
│   │          11 call sites of buildPostTaskReviewUserPrompt gained
│   │          `reviewFilePath: "/p/review.md"`. Verified against the src
│   │          signature (src/post-task-reviewer.ts:48-61): reviewFilePath is a
│   │          REQUIRED string on the opts object, so every call missing it was a
│   │          genuine TS2345. Read the whole describe block (lines 95-266): all
│   │          call sites now pass it; the 3 that already did (the "references
│   │          the injected reviewFilePath", diff-range, and no-description
│   │          cases) were correctly left alone.
│   ├── [DONE] test/config.test.ts — 4 x TS2339
│   │          `config.review?.maxIterations` -> cast through
│   │          `{ maxIterations?: number } | undefined` at the assertion. Matches
│   │          src/types.ts:14 (`review?: { postTask: boolean }`) and
│   │          isValidConfig's comment that maxIterations is a dead-but-tolerated
│   │          legacy key — the tests still assert the runtime legacy-ignore
│   │          behavior, none were deleted.
│   ├── [DONE] test/commands/init.test.ts — 2 x TS2352
│   │          `defaults as Record<string, unknown>` -> `as unknown as
│   │          Record<string, unknown>`, the double-cast the task sanctioned.
│   ├── [DONE] test/index.test.ts — 1 x TS18048
│   │          `args[0]` -> `args?.[0]`. Runtime failure mode is preserved: if
│   │          args were undefined, `expect(undefined).toContain(...)` still
│   │          fails, so the assertion is not weakened into a silent pass.
│   └── [DONE] test/settle.test.ts — 1 x TS2769
│              `reason: string` -> `reason: DoneReason`, importing the existing
│              exported type from src/settle.ts (confirmed already exported).
│              This tightens the fixture rather than loosening anything.
├── [DONE] Fix TEST code, not src/ types
│          `git show --stat a640d7a` confirms zero src/ files in the commit; the
│          only non-test files are .cairn/tasks*.json bookkeeping.
├── [DONE] No `// @ts-expect-error` / `// @ts-ignore` added
│          Neither string appears anywhere in the diff.
├── [DONE] Do not modify the real tsconfig.json; delete the temporary probe one
│          tsconfig.json is absent from the diff, and `git status --porcelain`
│          shows no leftover/untracked tsconfig — the probe file was cleaned up.
├── [DONE] `bun test` stays green
│          Validation run by cairn (not re-run here): bun test 1216 pass / 0 fail.
│          1216 is exactly the count #119 reported, which corroborates the
│          "type-only, no behavior change" claim — no test added or removed.
├── [DONE] TDD "where it applies"
│          Correctly a no-op: every change is a type annotation, a cast, or a
│          required-arg addition with a placeholder value no assertion reads.
│          The agent says so explicitly in its notes.
└── [DONE] Do not touch cairn.json healthCheck / package.json build / install.sh
           None of the three is in the commit, and cairn.json's uncommitted user
           change is still uncommitted in the working tree.
```

### Files Changed
- `test/post-task-reviewer.test.ts` (+11 `reviewFilePath` args, 2 call sites reformatted inline)
- `test/config.test.ts` (4 assertion casts)
- `test/commands/init.test.ts` (2 `as unknown as` casts)
- `test/index.test.ts` (1 optional-chain)
- `test/settle.test.ts` (+1 type import, 1 fixture annotation)
- `.cairn/tasks.json`, `.cairn/tasks.completed.json` (task bookkeeping — #117-#119 archives plus #120's completion; CLI-written, not hand-authored)

### Verification performed
- Inspected the range `2037720..HEAD` (`git log --oneline`, `git diff --stat`, `git diff -- test/`, `git show a640d7a -- .cairn/tasks.json`): one commit, a640d7a.
- Read the post-change `src/post-task-reviewer.ts`, `src/settle.ts` (via `git show HEAD:`) and `src/types.ts` in full to confirm each fix matches what the src side actually declares, rather than trusting the diff.
- Read `test/post-task-reviewer.test.ts:95-266` directly to confirm *every* call site in that describe block now supplies the required field, not just the ones the diff touched.
- `git status --porcelain` to confirm no temporary tsconfig was left behind and that `cairn.json` was not committed.
- Test validation was run by cairn before this review and I did not re-run it: `bun run typecheck` passed (460ms), `bun test` passed 1216 / 0 fail (8.6s).
- **Could not verify (tooling limit):** I was unable to run `tsc` over `test/` myself — this reviewer's Bash scope is git-inspection only. So the notes' claim of "38 errors before, 19 remaining after, all in test/commands/run.test.ts and test/stream-filter.test.ts" is **unverified by me**. Note it is also unverified by cairn's validation: `bun run typecheck` is src-only (CLAUDE.md), so the passing typecheck above says nothing about this task's actual deliverable. That gate arrives in #122 by design; until then a residual or newly-introduced `test/` error is invisible to both of us. My confidence rests on the per-site structural check above, which accounts for exactly 11+4+2+1+1 = 19 sites matching the described error codes.

### Gaps
None detected against the task description. Observations that are not requirement gaps:
- The notes state "only the 5 test files I actually edited were staged for commit", but a640d7a also contains `.cairn/tasks.json` and `.cairn/tasks.completed.json`. Those are CLI-written bookkeeping (the #117-#119 archives plus this task's own completion), committing them is the established pattern for this round (#117 and #119 did the same), and the thing the instruction actually protected — `cairn.json`'s uncommitted user change — was correctly left alone. The notes' claim is inaccurate; the behavior is fine.
- Style inconsistency between the two cast fixes: `init.test.ts` uses `as unknown as Record<string, unknown>` while `config.test.ts` uses a direct `as { maxIterations?: number } | undefined`, repeated inline at all four sites where a one-line helper would read better. Cosmetic only.

### Regression Risks
None detected.
- No export was removed or changed; no `src/` file was touched at all, so no contract moved.
- No test was deleted, skipped or weakened: all five files are net-additive or same-line edits, and the suite count is unchanged at 1216 (#119: 1216, #120: 1216), which is what a type-only change must produce.
- The two assertions that could in principle have been softened were checked individually: `args?.[0]` still fails the test if `args` is undefined, and the `config.review` casts leave the runtime `toBeUndefined()` assertions intact, so the round-16 removal of `maxIterations` is still genuinely pinned.

### Verdict
CLEAN

---

## Task #121: Headless reviewer: --disallowedTools closes the same --output hole
Reviewed: 2026-09-19T23:36:00Z

### Coverage
```
Task #121 Requirements
├── [DONE] Add --disallowedTools to the reviewer spawn in spawnPostTaskReviewer
│          Read the post-change src/post-task-reviewer.ts in full (`git show
│          HEAD:`): the args array is now
│          [-p, ...buildAgentArgs(...), --allowedTools, <allow>,
│           --disallowedTools, REVIEWER_DISALLOWED_BASH_RULES.join(","),
│           --output-format, stream-json, --model, sonnet, --verbose].
│          The flag is added, not substituted — the existing --allowedTools
│          value (Read/Glob/Grep + the two reviewsDir Edit/Write rules +
│          GIT_INSPECTION_RULES) is byte-for-byte unchanged, so the allowlist
│          containment story is layered on, not replaced.
├── [DONE] Carry the validated pattern list verbatim
│          REVIEWER_DISALLOWED_BASH_RULES = ['Bash(*--output*)', 'Bash(*--out*)',
│          'Bash(*$*)', `Bash(*")`, "Bash(*')"]. Cross-checked against the
│          planning probe record in .cairn/planning-notes.md (finding 5,
│          lines 64-70, and the Approach section lines 121-124): the probe says
│          the split-quoting form is blocked "once Bash(*$*), Bash(*--out*) and
│          Bash(*") are added" — all five shipped patterns match, and the
│          Bash(git log:* --output*) form the probe found inert is correctly
│          NOT used.
├── [DONE] Define it as an exported constant BESIDE GIT_INSPECTION_RULES
│          src/claude-settings.ts, immediately after GIT_INSPECTION_RULES (which
│          ends at the old line 89); exported `readonly string[]`, imported by
│          src/post-task-reviewer.ts in the same import statement as
│          GIT_INSPECTION_RULES. The two lists are now visibly paired at both
│          the definition and the use site.
├── [DONE] Document the accepted limit rather than solve it
│          Both the constant's doc comment and the inline comment at the spawn
│          site state that deny patterns match raw command text while the
│          /cairn-run PreToolUse hook parses the command, that the hook remains
│          the stronger layer, and that this is defense in depth against a
│          trusted agent, not a sandbox. The doc comment also records the probe
│          results and the `:*`-prefix syntax trap for the next reader.
├── [PARTIAL] Test: assert the spawn is invoked with --disallowedTools
│   ├── [DONE] New test "closes the --output hole with --disallowedTools"
│   │          (test/post-task-reviewer.test.ts:345-368) uses the existing
│   │          injected `deps.spawn`, asserts `--disallowedTools` is present and
│   │          that the following arg is the joined list. No real reviewer is
│   │          spawned (mock child + mock processStreamFn), and it does not
│   │          re-probe Claude Code's matcher. Style matches the two adjacent
│   │          spawn-arg tests exactly.
│   └── [PARTIAL] Nothing pins the pattern CONTENT — see Gaps.
├── [DONE] TDD (failing test first)
│          Not directly observable from a squashed single commit, so treated as
│          unverified-but-plausible: the test imports a symbol that did not
│          exist before this commit, so on the agent's stated sequence the file
│          could only have failed red first. The notes are candid that the red
│          may have been an import failure rather than an assertion failure.
├── [DONE] Never spawn a real reviewer / never run cairn round|hook|init here
│          The only Bash-shaped side effects in the diff are inside the mocked
│          spawn test; no new temp-dir or CLI invocation was added at all.
└── [DONE] Scope rules (cairn.json healthCheck, package.json build, install.sh,
    │      stage only your own files)
    └── `git show HEAD --stat`: exactly 4 files — src/claude-settings.ts,
        src/post-task-reviewer.ts, test/post-task-reviewer.test.ts and
        .cairn/tasks.json (CLI bookkeeping). cairn.json and package.json are
        absent from the commit, and `git status --porcelain` still shows
        cairn.json's user change unstaged, exactly as before.
```

### Files Changed
- `src/claude-settings.ts` (+36: `REVIEWER_DISALLOWED_BASH_RULES` and its doc comment; nothing existing touched)
- `src/post-task-reviewer.ts` (+11/-1: import extended, 2 args + a 7-line comment added to the spawn args array)
- `test/post-task-reviewer.test.ts` (+26: 1 import, 1 new test; no existing test modified)
- `.cairn/tasks.json` (#120 archived out, #121 marked complete — CLI-written)

### Verification performed
- Inspected the range `a640d7a..HEAD` (`git log --oneline`, `git diff`, `git show HEAD --stat`): one commit, 8a4ebd1, 4 files.
- Read the post-change `src/post-task-reviewer.ts` in full via `git show HEAD:` to confirm the flag lands in the real args array and that the `--allowedTools` value and the `reviewFileRule` derivation were not disturbed.
- Read `test/post-task-reviewer.test.ts:270-390` directly to check the new test against the surrounding mock-spawn pattern and to confirm no adjacent assertion was weakened.
- Cross-checked the five shipped patterns against the independent probe record in `.cairn/planning-notes.md` (finding 5), not just against the task description.
- Checked `test/claude-settings.test.ts`'s imports to see whether the constant's contents are asserted anywhere — they are not (that is the gap below).
- `git log -S"disallowedTools" --all`: the flag appears nowhere else in the codebase, so there is no second spawn site (e.g. `cairn run`'s execution agents, which are `--dangerously-skip-permissions` and out of scope) left inconsistent by this change.
- `git status --porcelain` to confirm `cairn.json` was not committed.
- Test validation was run by cairn before this review and I did **not** re-run it: `bun run typecheck` passed (584ms), `bun test` passed 1217 / 0 fail (8.5s). 1217 = #120's 1216 + the single new test, which corroborates that nothing was deleted or skipped.
- **Could not verify (accepted by design):** that `--disallowedTools` is honored by the installed `claude` CLI and that these globs actually block `git diff --output=…`. The task forbids re-probing it and this reviewer's Bash scope is git-inspection-only. The evidence is the planning probe, recorded in planning-notes.md and now in the source comment; I am relying on it, not confirming it.
- **Could not verify:** the red-then-green TDD ordering (single squashed commit, no intermediate state on disk).

### Gaps
- **[PARTIAL] The new test cannot fail if the rule list is wrong.** It asserts `spawnArgs[i+1] === REVIEWER_DISALLOWED_BASH_RULES.join(",")` — the same constant the production code joins. It pins the *wiring* (the flag is passed, in the right position, from that constant) but not the *content*: emptying the array, or dropping `Bash(*--output*)` so the original hole reopens, leaves the suite green at 1217. The probe is the only record of which patterns matter, and planning-notes.md line 70 explicitly concluded "Any shipped rule needs a test." A one-line `expect(REVIEWER_DISALLOWED_BASH_RULES).toEqual([...five literals...])` (or a `toContain` per pattern) in `test/claude-settings.test.ts` would close it. The task description did ask for exactly the wiring assertion that was written, so this is a thin-coverage finding rather than an instruction that was ignored.
- Not a gap: CLAUDE.md's "Remaining headless gap" paragraph and README.md's reviewer-containment line are now stale (they still say a headless reviewer can run `git diff --output=<file>`). That is deliberately assigned to task #123, which names this exact paragraph, and #123 depends on #121.
- Minor redundancy, no action needed: `Bash(*--out*)` strictly subsumes `Bash(*--output*)`. Both were in the probe and both were requested, so shipping both is correct; the doc comment could note that the narrower rule is kept for readability.

### Regression Risks
- **Low: the deny list is unconditional for every headless reviewer Bash call, and a false positive is silent.** `Bash(*$*)` and `Bash(*--out*)` match raw text anywhere in the command, so a legitimate inspection whose *arguments* contain `$` (a path or ref with a `$` in it) would be refused, and a refused Bash call surfaces to the reviewer only as a denial — the review still gets written, just with less evidence behind it. Planning anticipated the `$` case and cleared it (`${range}` in the prompt is a JS template literal resolved before the reviewer ever sees it, planning-notes.md line 108), and the probe confirmed `git log --oneline -3` still runs — though note the no-false-positive probe was run with `Bash(*--output*),Bash(*$*)` only, *not* with `Bash(*--out*)` in the list. Accepted risk, worth knowing if a future reviewer session looks unexpectedly evidence-poor.
- No contract changed: `GIT_INSPECTION_RULES` and every other export of `src/claude-settings.ts` are untouched (the diff is purely additive, after line 89), so `cairn init`'s seeding, `buildCommandRules` and the hook's reviewer Bash scope are unaffected. `spawnPostTaskReviewer`'s signature, the `reviewFileRule` derivation from the resolved `reviewsDir`, and the `--allowedTools` string are all unchanged.
- No test was deleted, skipped or weakened; the change is net-additive in all three source files.
- `/cairn-run`'s containment path is untouched, so the stronger layer still behaves exactly as round 17's earlier hook tasks left it.

### Verdict
HAS_GAPS

---

## Task #122: test/ type errors, batch B, then turn the gate on
Reviewed: 2026-09-19T23:35:00Z

### Coverage
```
Task #122 Requirements
├── [DONE] test/commands/run.test.ts — 14 errors fixed (counted in the diff)
│   ├── [DONE] 7 archiveCompletedTasks mocks gained `warnings: []`
│   │          (verified against `ArchiveResult` in src/task-archiver.ts via
│   │           `git show HEAD:src/task-archiver.ts` — `warnings: string[]` is
│   │           required, so the mocks were genuinely wrong, not the src type)
│   ├── [DONE] 3 `log: mock((msg: string) => …)` retyped to
│   │          `(...args: unknown[])`, matching RunRunDeps.log (contravariance)
│   └── [DONE] 4 `calls.find(([, content]: [string, string]) => …)` TS2769
│              overload failures rewritten as `(call: unknown[])` + `call[1]`
├── [DONE] test/stream-filter.test.ts — 5 errors fixed
│   ├── [DONE] 4 `globalThis.fetch` mocks: typed params +
│   │          `as unknown as typeof fetch` (TS2741 `preconnect`)
│   └── [DONE] 1 ntfy no-op now uses `type NtfyOpts`, imported from
│              src/stream-filter (confirmed pre-existing export; no src change)
├── [DONE] tsconfig.json gate turned on
│   ├── [DONE] `include: ["src", "test"]`
│   ├── [DONE] `rootDir: "src"` deleted (the option that rejected test/)
│   └── [DONE] `outDir: "dist"` left alone; no test/tsconfig.json exists to
│              shadow the root config
├── [DONE] Gate exits 0 with test/ included; no errors left by the #117–#121
│          tests (they needed no edits — none of their files are in the diff)
├── [DONE] Constraints honored
│   ├── [DONE] No src/ signature loosened — the diff touches no src/ file
│   ├── [DONE] No @ts-expect-error / @ts-ignore added (diff has none)
│   ├── [DONE] Mock-boundary casts are the sanctioned `as unknown as T` form
│   └── [DONE] bun test green (1217 pass / 0 fail, same count as #121)
└── [DONE] Round-17 pin respected
    ├── [DONE] package.json untouched (`git diff HEAD -- package.json` empty)
    ├── [DONE] cairn.json's redirected healthCheck still present and still
    │          unstaged (`git status --porcelain` → ` M cairn.json`)
    └── [DONE] Only the agent's own files + task-state files committed
```
Beyond the expected file list, the commit also updates CLAUDE.md's Development
paragraph (the "`test/` is not type-checked yet (~43 pre-existing errors)" line,
which this task made false). I read the new text: it is accurate and correctly
explains why `rootDir` is unset. Unrequested but in-scope and correct.

### Files Changed
- `test/commands/run.test.ts` (14 type fixes, no test added or removed)
- `test/stream-filter.test.ts` (5 type fixes, no test added or removed)
- `tsconfig.json` (`include` + `rootDir`)
- `CLAUDE.md` (one stale doc line)
- `.cairn/tasks.json`, `.cairn/tasks.completed.json` (task-state, expected)

### Gaps
None detected.

### Regression Risks
- **Low: `outDir: "dist"` now has no `rootDir`.** With `rootDir` gone, a bare
  `tsc` (no `--noEmit`) would emit `dist/src/**` and `dist/test/**` rather than
  `dist/**`, into the same directory that holds the compiled `dist/cairn`
  binary. Nothing in the repo does that today — `package.json`'s only tsc
  invocation is `typecheck: "tsc --noEmit"` and `build` is
  `bun build --compile`, which ignores both options (verified by reading
  package.json). Worth knowing before anyone adds a tsc emit step.
- **Low: the three retyped `log` mocks now join every argument** instead of
  recording only the first. That can only add text to the captured lines, and
  the one exact-match assertion over them (`expect(logs).toContain('Cairn
  Execution Loop Completed')`, run.test.ts:2394) still passes, so nothing was
  weakened — but that assertion would now break if a future change gave that
  log call a second argument. Cosmetic, not a correctness loss.
- **Low, accepted by the task's own rules: the four `as unknown as typeof
  fetch` casts remove type checking at those mock boundaries.** A future change
  to how `sendNtfy` calls `fetch` would not be caught by these tests at compile
  time. The task explicitly sanctioned this form over `@ts-ignore`, and the
  params were narrowed from `any` to `string | URL | Request` / `RequestInit`,
  so this is net stricter than what it replaced.
- **Forward-looking, intended:** the gate now fails on any type error in
  `test/`, so every later task that edits a test must keep it type-clean. That
  is the point of the task, not a defect, but it is a real change of contract
  for subsequent rounds.
- No test was deleted, skipped or weakened; the suite count is 1217 pass / 0
  fail both before (#121's log) and after (#122's log), which matches a
  type-only change. No export removed, no src/ file touched, so no other module
  can be affected.

### Verification notes
- Inspected the range with `git log --oneline`, `git diff --stat` and the full
  `git diff` of `test/`, `tsconfig.json` and `CLAUDE.md` — one commit, no
  src/ changes.
- Confirmed the mock fixes track real src types rather than loosened ones by
  reading the post-change `src/task-archiver.ts` (`ArchiveResult.warnings` is
  required) and `src/stream-filter.ts` (`NtfyOpts` and `ProcessStreamOptions`
  are unchanged pre-existing exports).
- Read the assertions around each retyped `log` mock (run.test.ts:1807-1865,
  2385-2396) to check none was weakened by the join.
- Checked `git status --porcelain` and `git diff HEAD -- cairn.json
  package.json`: the health-check redirect survives as an unstaged user change
  and the build script is untouched.
- Confirmed no `test/tsconfig.json` exists that could shadow the root
  `include`.
- Test validation was run by cairn before this review and I did **not** re-run
  it: `bun run typecheck` exit 0 (536ms), `bun test` 1217 pass / 0 fail
  (8.6s), per `.cairn/.cairn_task_122_tests.log`.
- **Could not verify directly:** that `tsc` now really walks `test/`. This
  reviewer's Bash scope is git-inspection-only, so I could not run `tsc
  --listFiles` or introduce a deliberate error to see the gate fail. The
  evidence is the tsconfig content (`include` + no `rootDir`, no overriding
  test-level tsconfig) plus cairn's own exit-0 run. Note the typecheck duration
  barely moved (584ms at #121 with src/ only → 536ms here), which is consistent
  with TypeScript 7.0.2's native compiler but is not itself confirmation.
- **Could not verify:** the red-then-green TDD ordering (single squashed
  commit) — though for a type-error cleanup the failing state is the
  pre-existing error list, which the agent's notes enumerate and the error
  count (19 = 14 + 5) matches the task description exactly.

---

## Task #123: Docs: CLAUDE.md and README.md for the round-17 changes
Reviewed: 2026-09-19T23:42:00Z

### Coverage
```
Task #123 Requirements
├── CLAUDE.md
│   ├── [DONE] 1. Development — typecheck covers src/ AND test/; the
│   │          "~43 pre-existing errors, deferred" paragraph is gone.
│   │          NOT changed by this commit: `git diff 0d60b13~1..0d60b13 --
│   │          CLAUDE.md` shows task #122 already replaced that exact line.
│   │          Verified the requirement holds in the tree (CLAUDE.md:30) and
│   │          the agent's notes say so honestly rather than claiming the edit.
│   ├── [DONE] 2a. Reviewer Bash scope now denies any `$`
│   │          CLAUDE.md:170 rewritten. Checked against the code, not the
│   │          description: src/commands/hook.ts `isInspectionOnly` is
│   │          `if (/[`<>$]/.test(command)) return false;` — backtick, `<`,
│   │          `>` and `$` anywhere, exactly as documented. The doc's
│   │          subsumption list ($( ), ${VAR}, $VAR, $'…') follows from a bare
│   │          `$` match, and the `--output${X}=` hole it describes is real:
│   │          the old strip-then-compare yielded `--output{X}=`, matching
│   │          neither `--output` nor `--output=`.
│   ├── [DONE] 2b. hasOutputOption() kept as a second layer, no longer
│   │          strips `$`
│   │          Confirmed: it strips only `['"\]` and is still called from
│   │          isInspectionOnly (`subcommands.some(hasOutputOption)`), after
│   │          the `$` gate. Doc matches the source comment and the code.
│   ├── [DONE] 2c. Hook resolves the project from the tool call's cwd
│   │          CLAUDE.md:173. Matches preToolUseHookCommand: `payloadCwd` is
│   │          set from `input.cwd` when it is a non-empty string, and
│   │          `resolveProjectRoot()` is `findProjectRoot(payloadCwd,
│   │          { ignoreEnv: true })` else `findProjectRoot(fallbackCwd)`.
│   │          The doc's "same resolver serves the fail-open error log" claim
│   │          is verified at the catch block (`dataDir ??
│   │          findDataDir(resolveProjectRoot())`).
│   ├── [DONE] 3. "Remaining headless gap" replaced
│   │          Now "Headless reviewer containment" (CLAUDE.md:177). The five
│   │          patterns quoted — Bash(*--output*), Bash(*--out*), Bash(*$*),
│   │          Bash(*"), Bash(*') — match REVIEWER_DISALLOWED_BASH_RULES in
│   │          src/claude-settings.ts character for character, and
│   │          spawnPostTaskReviewer really does pass `--disallowedTools`
│   │          with `REVIEWER_DISALLOWED_BASH_RULES.join(",")` (read the
│   │          post-change src/post-task-reviewer.ts, not just the diff).
│   │          The probe narrative and the residual limit ("deny matches raw
│   │          text, the hook parses the command; the hook stays the stronger
│   │          layer") match the constant's doc comment.
│   ├── [DONE] 4. Per-project data layout — .gitignore line
│   │          CLAUDE.md:92. Matches mergeGitignoreEntries()
│   │          (src/commands/init.ts): trimmed exact-string membership test,
│   │          appends only missing entries under a header, returns 0 and
│   │          writes nothing when none are missing — append-only, never
│   │          reorders or removes, exactly as the line now claims.
│   └── [DONE] 5. Run state — two duplicated bullets merged
│              4 bullets → 2. Compared old and new text clause by clause: the
│              "in one short locked update" detail, "HEAD at pick time", the
│              re-pick rule, "never `awaiting-review` ones (their task is
│              archived by design)" and the already-settled clearing all
│              survive. Nothing was dropped, only de-duplicated.
├── README.md
│   ├── [DONE] ~line 105 — .gitignore / cairn init
│   │          Now scopes the "Cairn does not edit .gitignore" promise to the
│   │          project's ROOT .gitignore and links to Per-project data. The
│   │          anchor `#per-project-data-created-by-cairn-init` resolves to
│   │          the real heading at README:370.
│   ├── [DONE] ~line 381 — Per-project data tree line
│   │          Matching wording to CLAUDE.md's tree line; accurate per
│   │          mergeGitignoreEntries.
│   └── [PARTIAL] ~line 167 — reviewer-containment line
│              The hook bullet at README:167 WAS updated and is accurate.
│              But README's only statement about *headless* reviewer
│              containment (README:164) still reads "constrained by their
│              prompts and (for the reviewer) a scoped `--allowedTools`
│              list" — `--disallowedTools` appears nowhere in README. See
│              Gaps.
└── [DONE] Scope rules: docs only, cairn.json / package.json / install.sh
    │      untouched, stage only your own files
    └── `git diff --name-only 0d60b13..HEAD` → exactly CLAUDE.md, README.md
        and .cairn/tasks.json (CLI bookkeeping). No src/ or test/ file in the
        commit — consistent with "docs only". `git status` still shows
        cairn.json as an unstaged user change, so the round-17 health-check
        redirect and binary pin were left alone. CANARY-17 is present in the
        completion notes, per CLAUDE.local.md.
```

### Files Changed
- `CLAUDE.md` (+5/-7: run-state bullets merged 4→2, `.gitignore` tree line, reviewer-Bash bullet, "Remaining headless gap" → "Headless reviewer containment")
- `README.md` (+3/-3: lines 105, 167, 381)
- `.cairn/tasks.json` (#122 archived out, #123 marked complete — CLI-written)

### Verification performed
- Inspected the range `0d60b13..HEAD` (`git log --oneline`, `git diff --stat`, `git diff -- CLAUDE.md README.md`, `git diff -- .cairn/tasks.json`): one commit, 8ff433c, 3 files.
- Did **not** review the doc text against the task description alone. Read the post-change sources the new prose describes — `src/commands/hook.ts` (full), `src/post-task-reviewer.ts` (via `git show HEAD:`), `src/claude-settings.ts` (via `git show HEAD:`), `src/commands/init.ts` (via `git show HEAD:`) — and checked every factual claim against them. All five `--disallowedTools` patterns, the `/[\`<>$]/` regex, the `hasOutputOption` strip set, the `ignoreEnv` resolver and the append-only gitignore merge match the docs exactly.
- Read the current `CLAUDE.md:120-190` and `README.md:96-105 / 150-174 / 360-394` in the working tree (not just the diff hunks) to look for text the round left stale nearby — that is how the README:164 finding below surfaced.
- Checked the anchor `#per-project-data-created-by-cairn-init` against the actual README heading at line 370; it resolves.
- Diffed the removed run-state bullets against the merged ones clause by clause to confirm the de-duplication lost no content.
- Confirmed item 1 was already satisfied before this commit by diffing `0d60b13~1..0d60b13 -- CLAUDE.md`, rather than taking the agent's notes for it.
- Test validation was run by cairn before this review and I did **not** re-run it: `bun run typecheck` passed (475ms), `bun test` passed 1217 / 0 fail (8616ms) — the same 1217 as #121 and #122, which is what a docs-only commit must produce.
- **Could not verify:** that `#122`'s tasks.json deletion here is an archive rather than a loss — `.cairn/tasks.completed.json` is modified but uncommitted in the working tree, so the append is not in this commit range. The working-tree file does contain #122; I could not confirm it via git inspection alone.
- **Could not verify (tooling limit):** no `grep`/`Grep` was available to me (this reviewer's Bash scope is git-inspection only), so "`--disallowedTools` appears nowhere in README" rests on reading the three README regions above, not an exhaustive search.

### Gaps
- **[PARTIAL] README still describes headless reviewer containment as `--allowedTools` only.** README:164 ("Headless `cairn run` agents are constrained by their prompts and (for the reviewer) a scoped `--allowedTools` list") is the README's counterpart to the CLAUDE.md paragraph this task replaced, and it was not updated; `--disallowedTools` is absent from README entirely. The #121 review explicitly deferred "README.md's reviewer-containment line" to this task. The task description narrowed that to "~line 167", which *was* done correctly, so this is a scoping miss rather than an ignored instruction — but the round's stated goal was "make the docs match what shipped", and a reader of README alone still concludes the `--output` hole is open. One clause ("…and a `--disallowedTools` deny list that blocks `--output` and shell-expansion forms") would close it.
- Not a gap, same shape, worth recording: CLAUDE.md:142 (enforcement point 2) also still describes the reviewer's headless containment purely in `--allowedTools` terms. It is not wrong — and CLAUDE.md:177 now carries the full story eight lines later — but the task did not ask for it and the agent did not volunteer it.
- Not a gap: item 1 required no edit in this commit because #122 had already made it. Verified, and the notes are candid about it.

### Regression Risks
None detected.
- Docs-only commit: `git diff --name-only` shows no `src/`, `test/`, `package.json`, `tsconfig.json` or `cairn.json` change, so no contract, export or behavior moved and no test was touched. Suite count unchanged at 1217.
- Every rewritten claim was checked against the code it describes; none of them overstates what ships (the `$`-anywhere rule, the second-layer `--output` check, the `ignoreEnv` resolution, the append-only gitignore merge and the five deny patterns are all real).
- The merged run-state bullets are a pure de-duplication — no operational detail was lost, so an agent or human reading the shortened section is not missing a rule it previously had.
- The one new cross-reference link resolves to an existing heading, so no broken anchor was introduced.

### Verdict
HAS_GAPS

---
