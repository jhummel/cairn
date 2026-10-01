## Task #143: Stream filter: extract a shared per-event renderer
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── [DONE] Export renderEvent(e, { truncateText }): string[] from src/stream-filter.ts (exact suggested signature)
│   ├── [DONE] system/init -> `  [init] model | mode` (DIM/RESET preserved)
│   ├── [DONE] assistant tool_use -> `  > fmtTool(...)`
│   ├── [DONE] assistant text: truncateText first-line / 77+"..." logic vs. full multi-line, empty/whitespace text skipped
│   ├── [DONE] result -> `  fmtResult(e)`
│   └── [DONE] all other types (incl. user tool_result) -> []
├── [DONE] Lines returned without [#id] prefix and without trailing newline
├── [DONE] processStream keeps line splitting, JSON parse, non-JSON pass-through, prefix and newline; calls renderEvent per event
├── [DONE] Pure extraction: bodies moved verbatim (only writeLine(`...\n`) -> lines.push(`...`)); output bytes identical
├── [DONE] No tool_result rendering added
├── [DONE] cairn run unaffected: src/commands/run.ts untouched; processStream signature/options unchanged
├── [DONE] Existing processStream tests unmodified (diff to test file is the import line plus appended block only)
└── [DONE] describe('renderEvent') cases: transcript-shape tool_use, text truncate true/false (multi-line), mixed content, result, user tool_result -> [], unknown type -> [] (plus extra: 80-char truncation, system init, empty object)

### Files Changed
- src/stream-filter.ts
- test/stream-filter.test.ts

(src/commands/run.ts was listed as an expected file but needed no change, since processStream's interface is unchanged.)

### Gaps
None detected

### Regression Risks
None detected. Cairn's test validation passed: typecheck passed, and bun test had 1163 pass, 0 fail. I did not re-run it. One theoretical behavior difference is too small to matter: output is now buffered per event, so if fmtTool threw partway through a multi-block assistant event, the lines rendered before it would no longer be written. fmtTool does not throw on normal input, and the exception would propagate either way.

### Verdict
CLEAN

---

## Task #144: Transcript discovery module (src/transcripts.ts)
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── [DONE] New read-only module src/transcripts.ts (fs reads only: statSync/readdirSync/readFileSync; no writes)
├── [DONE] projectSlug(projectRoot): replaces every non-alphanumeric with `-` (/[^a-zA-Z0-9]/g)
├── [DONE] claudeConfigDir(env = process.env): CLAUDE_CONFIG_DIR ?? ~/.claude
├── [DONE] findSession({ configDir, projectRoot, sessionId? })
│   ├── [DONE] missing <configDir>/projects -> { ok: false }, error names the exact path
│   ├── [DONE] missing slug dir -> { ok: false }, error names the exact path
│   ├── [DONE] slug dir with no session subagents/ -> { ok: true, sessionDir: null }
│   ├── [DONE] no sessionId -> session whose subagents/ dir has the newest mtime
│   └── [DONE] explicit sessionId -> that session; missing subagents/ -> error naming the path
├── [DONE] listAgentTranscripts(sessionDir, { all? })
│   ├── [DONE] returns { id, jsonlPath, metaPath, agentType, description, mtimeMs }[], sorted by .jsonl mtime ascending
│   ├── [DONE] missing or unparseable meta -> agentType undefined, never throws (also handles non-object JSON)
│   └── [DONE] default filter cairn-task-agent / post-task-reviewer; `all` disables it; DEFAULT_AGENT_TYPES exported
└── [DONE] test/transcripts.test.ts covers slug (`_` and `.`), env override vs default, newest session, explicit and missing sessionId, sessionDir null, both missing-dir errors, filter vs all, missing and corrupt meta, sort order; all tests use temp dirs and set mtimes with utimesSync

### Files Changed
- src/transcripts.ts (new)
- test/transcripts.test.ts (new)

### Gaps
None detected

### Regression Risks
None detected. The change only adds files (git diff --stat shows 236 insertions, 0 deletions, one commit acb904c), and no existing module imports the new one yet. Cairn's validation passed: typecheck passed, and bun test had 1171 pass, 0 fail. I did not re-run it. I also checked the round constraints: cairn.json, install.sh and package.json are not in the commit range. These minor points do not count toward the verdict:
- An explicit sessionId is joined into the path without validation, so a value like `../x` would resolve outside the slug dir. The module is read-only and the value comes from the user's own CLI input, so the effect is limited.
- The explicit-sessionId test uses a loose `toContain("old")` assertion.
- When two transcripts have the same mtime, their sort order depends on readdir order.
- I could not check the TDD claim (that the test failed first) from git, because the test and the implementation are in a single commit.

### Verdict
CLEAN

---

## Task #145: cairn watch command
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── [DONE] src/commands/watch.ts created; exports runWatch(opts, deps) with injected sleep/write/writeErr/configDir/shouldStop
├── [DONE] Registered in src/index.ts as `watch` with --session <id> and --all; goes through normal preAction; projectRoot from CAIRN_PROJECT_ROOT; truncateText from loadConfig(projectRoot)
├── [DONE] Uses claudeConfigDir / findSession / listAgentTranscripts (#144) and renderEvent (#143); no fs.watch; 500ms poll (WATCH_POLL_MS)
├── [DONE] Read-only: only fs open/fstat/read/close on transcripts; no run-state, tasks.json, hook or settle imports
├── [PARTIAL] Startup: {ok:false} -> stderr + exit 1 [DONE]; no session / no matching transcript -> wait quietly [DONE without --session; with --session, a session whose subagents/ dir does not exist yet exits 1, see Regression Risks]
├── [DONE] Replay from byte 0 then follow by byte offset; trailing partial line buffered; unparseable lines (and non-object JSON, renderEvent throws) skipped silently
├── [DONE] Switching: re-lists every poll, re-resolves session unless --session; drains current to EOF before switching; header `── <description|id> · <agentType> ──` before initial replay and each switch
├── [DONE] Runs until Ctrl-C (shouldStop: () => false, default SIGINT)
└── [DONE] Tests (test/commands/watch.test.ts, temp-dir config dirs)
    ├── [DONE] replay then follow, exactly once
    ├── [DONE] partial trailing line held until complete
    ├── [DONE] unparseable line skipped
    ├── [DONE] switching: drain -> header -> replay (asserts exact output order)
    ├── [DONE] filter: Explore/general-purpose hidden by default, shown with --all
    ├── [DONE] missing projects dir / missing slug dir -> error names path, exit 1
    ├── [DONE] no subagents yet -> no output, no error (plus later pickup)
    ├── [DONE] --session pins the session
    └── [DONE] test/index.test.ts: watch registered with --session and --all

### Files Changed
- src/commands/watch.ts (new)
- src/index.ts
- test/commands/watch.test.ts (new)
- test/index.test.ts

(src/transcripts.ts and src/stream-filter.ts were listed as expected files but were used without changes.)

### Gaps
None detected beyond the --session startup behavior, which is counted once under Regression Risks.

### Regression Risks
Cairn's test validation passed: typecheck passed, and bun test had 1182 pass, 0 fail. I did not re-run it. The commit range has one commit (9c1467a) that only adds code (391 insertions, 0 deletions). cairn.json, install.sh and package.json are not in the range; the working-tree change to cairn.json is the user's pinned healthCheck, not part of this task.
1. `cairn watch --session <id>` exits 1 when that session exists but has not launched a subagent yet, so its `subagents/` dir does not exist. The spec says "if there is no session or no matching transcript yet, wait quietly". The cause is that #144's findSession returns {ok:false} for a pinned session with no subagents/ dir, and runWatch treats every startup {ok:false} as fatal. This is reasonable for a mistyped id, but a user who starts `cairn watch --session <id>` before the first task agent launches gets an error instead of a wait. No test covers this case.

These minor points do not count toward the verdict:
- On a switch, the old transcript is drained earlier in the same poll and is not read again before the switch. Bytes appended to it in that small window are dropped. Subagents run one after another, so this is very unlikely in practice.
- If two matching transcripts appear between polls, only the newest is shown.
- I could not check the TDD claim from git, because the test and the implementation are in a single commit.

### Verdict
HAS_RISKS

---

## Task #146: Move the round bump from cairn plan to cairn round new
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── [DONE] 1. runPlan(): bumpRound call and its import removed from plan.ts
│   └── [DONE] planner --allowedTools now 'Read,Glob,Grep,Write,Edit,Agent,Bash(cairn task next-id:*),Bash(cairn round new:*)'
├── [DONE] 2. `cairn round new` in registerRoundCommands, next to next/settle
│   ├── [DONE] Exported, testable roundNewCommand({ dataDir, stdout?, stderr? }, deps) returns an exit code; uses process.env.CAIRN_DATA_DIR
│   ├── [DONE] Calls bumpRound(dataDir) (injectable)
│   ├── [DONE] Best-effort unlink of <dataDir>/${BRAND.tempPrefix}planning_session.md; missing file or failed unlink is swallowed
│   ├── [DONE] Prints one JSON line { verdict: 'round-started', round, next } (next names tasks.json and reviews/round-N.md)
│   ├── [DONE] Exit 0; exit 1 with one stderr line and no stdout when bumpRound throws (e.g. FileLockError)
│   └── [DONE] registerRoundCommands doc comment and group description updated
├── [DONE] 3. bumpRound: absent or non-finite round -> 1, numeric round -> +1; doc comment updated; getRound unchanged
├── [DONE] 4. commands/generate-tasks.md: both places (RULES bullet and final paragraph) run `cairn round new` once after next-id and before writing tasks.json, say its JSON reports the round, and warn not to re-run it in the same session
└── [DONE] Tests
    ├── [DONE] plan.test.ts: bump tests replaced (round unchanged, state.json not created, allowedTools contains Bash(cairn round new:*)); exact allowedTools assertion updated
    ├── [DONE] round.test.ts: increments, absent -> 1, preserves nextTaskId and unknown keys, deletes the log when present, succeeds when it is absent, swallows a failed unlink, lock failure -> exit 1, one JSON line, exit 0; `new` subcommand registered
    └── [DONE] task-counter.test.ts: (e) updated to absent -> 1, plus non-finite and missing-file cases; (c) adjusted to start from round 1

### Files Changed
- src/commands/plan.ts
- src/commands/round.ts
- src/task-counter.ts
- commands/generate-tasks.md
- test/commands/plan.test.ts
- test/commands/round.test.ts
- test/task-counter.test.ts
- CLAUDE.md (docs: the round command list and the state.json round paragraph now describe `cairn round new`)
- .cairn/tasks.json (task status bookkeeping)

### Gaps
None detected

### Regression Risks
None detected. Cairn's test validation passed: typecheck passed, and bun test had 1190 pass, 0 fail. I did not re-run it. The range has one commit (afc70c6). cairn.json, install.sh and package.json are not in it; the working-tree change to cairn.json is the user's pinned healthCheck. Notes, none of which count toward the verdict:
- In a project whose state.json has no round field, the first `cairn round new` writes 1, not 2. getRound already read an absent round as 1, so reviews keep going to round-1.md. The task asked for exactly this.
- The reviewer hook blocked non-git shell commands such as grep, so I could not search the repo for other docs that still say `cairn plan` bumps the round. CLAUDE.md, the doc the task named, was updated. bumpRound's only other caller (plan.ts) was removed in this diff.
- I could not check the TDD claim from git, because the tests and the implementation are in a single commit.

### Verdict
CLEAN

---

## Task #147: Gitignore entries for /teach learning mode
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── [DONE] 'planning_session.md' added to TEMP_IGNORE_SUFFIXES, with a comment saying it is the `/teach` running log (it renders as `.cairn_planning_session.md`)
├── [DONE] 'concepts.md\n' added to GITIGNORE_CONTENT right after instructions.md, with a comment saying it is the personal `/teach` glossary
├── [DONE] No merge code changed (the diff to init.ts is the two additions only)
├── [DONE] src/temp-sweep.ts untouched (not in the changed files)
└── [DONE] Tests in test/commands/init.test.ts
    ├── [DONE] Fresh init: the exact ordered entry list now includes `.cairn_planning_session.md` and `concepts.md`
    ├── [DONE] Re-init on an existing file without them: the original content is kept as an unchanged prefix, then the `# Added by cairn init (missing entries)` header, then both entries
    └── [DONE] `!concepts.md` negation: kept, with no bare `concepts.md` re-added, while `.cairn_planning_session.md` is still appended

### Files Changed
- src/commands/init.ts
- test/commands/init.test.ts

### Gaps
None detected

### Regression Risks
None detected. Cairn's test validation passed: typecheck passed, and bun test had 1192 pass, 0 fail. I did not re-run it. The range has one commit (983e974) that changes only the two expected files, so cairn.json, install.sh, package.json and src/temp-sweep.ts are not in it. Existing tests were updated, not removed: the "added N entries" count went from 12 to 14, and the "already has every entry mid-file" fixture gained the two new lines so it still covers the no-op case. Notes, none of which count toward the verdict:
- The repo's own `.cairn/.gitignore` is not updated until someone re-runs `cairn init` here. The task did not ask for that, and the round constraints forbid running init in the project root.
- CLAUDE.md's data-layout tree does not list the two new files. The task did not ask for this.
- I could not check the TDD claim from git, because the tests and the implementation are in a single commit.

### Verdict
CLEAN

---

## Task #148: /teach slash command (commands/teach.md)
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── [DONE] commands/teach.md created, adapted from ~/Downloads/plan.md (I read the draft and compared them); second-person voice, short numbered sections, frontmatter `description:` line, $ARGUMENTS kept
├── [DONE] KEEP list
│   ├── [DONE] Define terms on first use, mechanism before the name (§2)
│   ├── [DONE] "Have you worked with X before?" (§2)
│   ├── [DONE] Why -> mechanism -> recommendation (§2)
│   ├── [DONE] One concept per message, concrete traces, no walls of text (§2)
│   ├── [DONE] Breadcrumb `📍 Phase · Working on · Decided so far` (§3)
│   ├── [DONE] End every reply with exactly one question or action (§3)
│   ├── [DONE] Name tangents and offer the way back (§3)
│   ├── [DONE] Understanding checks before locking a decision: one at a time, never self-answered, plain correction (§4)
│   ├── [DONE] Steelman, trade-off, failure question, requirement vs preference, hold position, scope creep (§5)
│   └── [DONE] Don't challenge trivia (§5)
├── [DONE] DROP "nothing gets implemented until let's build"; replaced with "You never implement anything"
├── [DONE] CHANGE
│   ├── [DONE] 1. Running log `.cairn/.cairn_planning_session.md`: gitignored, template sections match the spec (Goal; Current phase / focus; Decision log table with the 5 columns; Open questions; Parked ideas; Next step); "Logged decision #N."; says /generate-tasks never reads it and `cairn round new` deletes it; "Do not delete it yourself"
│   ├── [DONE] 2. Re-entry briefing with four lines, built from the log or else from planning-notes.md, then "Does this match what you remember?"
│   ├── [DONE] 3. Glossary `.cairn/concepts.md`: read at start, append, point the user to an existing entry, cumulative and never reset
│   ├── [DONE] 4. planning-notes.md rules unchanged: written only on yes, usual format, Rejected Alternatives carried forward, decision log may feed Approach / Rejected Alternatives
│   ├── [DONE] 5. Stopping: update the log, then a three-line handoff
│   ├── [DONE] 6. `/teach off` or "back to normal mode"; a later instruction overrides this one
│   ├── [DONE] 7. Compaction: re-run /teach
│   └── [DONE] 8. Scope: meant for cairn plan, harmless elsewhere
├── [DONE] All three literal paths are present. I checked them against #147 (TEMP_IGNORE_SUFFIXES 'planning_session.md' with the `.cairn_` prefix, and 'concepts.md') and #146 (planningSessionLogPath = BRAND.tempPrefix + 'planning_session.md')
├── [DONE] Optional: displayPreflight prints a dim tip line (DIM/RESET from stream-filter), with a plan.test.ts assertion
└── [DONE] init.test.ts: installSlashCommands into tmpDir installs .claude/commands/teach.md, and its content contains all three paths

### Files Changed
- commands/teach.md (new)
- commands/generate-tasks.md (one line: tells the subagent not to read the two /teach scratch files)
- src/commands/plan.ts
- test/commands/init.test.ts
- test/commands/plan.test.ts
- .cairn/tasks.json (cairn bookkeeping: 146 and 147 archived, 148 marked complete)

### Gaps
None detected

### Regression Risks
None detected. Cairn's test validation passed: typecheck passed, and bun test had 1194 pass, 0 fail. I did not re-run it. The range has one commit (7e99625). cairn.json, install.sh and package.json are not in it; the working-tree change to cairn.json is the user's pinned healthCheck. The only code change adds one console.log line, and no existing test was removed. Notes, none of which count toward the verdict:
- The generate-tasks.md edit is a small addition beyond the spec, in a file that was on the expected list. It makes the spec's claim that "/generate-tasks never reads it" true by instruction, not only by convention.
- I could not check the TDD claim from git, because the tests and the implementation are in a single commit.

### Verdict
CLEAN

---

## Task #149: Docs: cairn watch, cairn round new, /teach, round-bump semantics
Reviewed: 2026-09-30T00:00:00Z

### Coverage
Task Requirements
├── CLAUDE.md
│   ├── [DONE] 1. `watch` -> src/commands/watch.ts entry: read-only, --session/--all, replays the newest matching agent from byte 0 then follows, switch header, polls every 500ms (WATCH_POLL_MS) and does not use fs.watch. I checked each point against watch.ts and transcripts.ts. The `round` entry is extended with `cairn round new` and `{ verdict, round, next }`
│   ├── [DONE] 2. New "Planning rounds (`cairn round new`)" subsection: the round-started verdict with round and next; run by /generate-tasks after next-id and before tasks.json is written; lives under `round` so task agents can't bump the round; the CLI owns state; deletes .cairn_planning_session.md. I checked these against round.ts (roundNewCommand, planningSessionLogPath) and generate-tasks.md
│   ├── [DONE] 3. state.json is corrected in the data-layout tree and the Agent workflow paragraph: bumped by `cairn round new`, not `cairn plan`; an absent round becomes 1 (bumpRound also turns a non-finite round into 1, which matches the docs); the previous round shows during planning; running twice bumps twice
│   ├── [DONE] 4. The data-layout tree adds concepts.md and .cairn_planning_session.md (gitignored, deleted by round new, never swept). teach.md is added to the .claude/commands/ list. "Never swept" holds because the temp-sweep regexes need a `task_\d+_` segment
│   ├── [DONE] 5. Transcript-layout note: $CLAUDE_CONFIG_DIR / ~/.claude, projects/<slug>/<session>/subagents/agent-<id>.jsonl + .meta.json, the slug rule, and loud failures that name the path. I checked the last two points against the code: stream-filter.ts renderEvent renders only system/init, assistant text/tool_use, and result, so tool results are not rendered. It prints a Done line only for `result` events, which transcripts don't contain
│   └── [DONE] 6. /teach bullet under Conventions: opt-in, off by default, /teach and /teach off, and why it is not in CLAUDE.local.md (task agents would stall) or planner.md (init overwrites it). I checked this against commands/teach.md
└── README.md
    ├── [DONE] Commands table: `cairn watch [--session <id>] [--all]` ("second terminal"), plus `cairn round new` and `/teach`
    ├── [DONE] Execute section: a new "Watching a round: cairn watch" subsection with usage for all three forms
    ├── [DONE] Plan section: "Learning mode (/teach)" paragraph, plus a "Planning rounds" paragraph on the bump semantics
    ├── [DONE] Bump claims: the commit leaves no text saying `cairn plan` bumps the round. The new text says explicitly that it does not
    └── [DONE] Per-project File Structure tree: both new files added. The source tree also gains watch.ts and transcripts.ts

### Files Changed
- CLAUDE.md
- README.md
- .cairn/tasks.json (cairn bookkeeping: task 148 archived)

### Gaps
None detected

### Regression Risks
Cairn's test validation passed: typecheck passed, and bun test had 1194 pass, 0 fail. I did not re-run it. The range has one commit (45efb97). cairn.json, install.sh and package.json are not in it; the working-tree change to cairn.json is the user's pinned healthCheck. The task changes only docs, so the risks below are about whether the docs are accurate and well organized:
1. **Misplaced paragraphs in CLAUDE.md.** The two new `###` subsections were inserted between the round verdict list and the existing "**Exit codes**" and "**Why `round`, not `task`**" paragraphs. Those two paragraphs are about `round next`/`round settle`, but they now sit under the "`cairn watch` and the transcript layout" heading (CLAUDE.md lines 78-80). Readers and agents who scan by heading will find round exit-code rules filed under `cairn watch`. The fix is to move both paragraphs back above `### Planning rounds`.
2. **New text names a plan phase that no longer exists.** The Planning rounds subsection says "`cairn plan`'s generation phase grants `Bash(cairn round new:*)`". But runPlan in src/commands/plan.ts spawns one interactive session, and the grant is on that session's `--allowedTools`; there is no separate generation phase. This repeats the stale "Two-phase interactive flow ... Both phases launch claude" text in the `plan` entry, which this task did not touch. The task asked for every claim to be checked against the shipped code, so this new sentence should say "the `cairn plan` session's `--allowedTools` grants ...".

Notes, none of which count toward the verdict:
- The reviewer hook blocked non-git shell commands, so I could not run `git grep -n "bump"` or `git grep -n "round"`. Instead I read the full diff and the changed sections. I did not search the unchanged parts of README.md for older stale claims.
- The README "Watching a round" text says `--session` pins a session. It does not mention that a pinned session with no subagents/ dir yet exits 1 (the #145 risk). CLAUDE.md does describe this correctly.

### Verdict
HAS_RISKS

---
