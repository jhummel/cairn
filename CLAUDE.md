# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Cairn

Cairn (formerly Ralph — see [Branding and the legacy layout](#branding-and-the-legacy-layout)) is an agentic task orchestration CLI that wraps Claude Code. It turns a planning conversation into a task list (`tasks.json`), then executes each task autonomously with fresh Claude agents — including health checks, test validation, dependency ordering, and archival of completed work.

## Development

Cairn is a TypeScript project built with Bun. The entry point is `src/index.ts`, compiled to `dist/cairn` via `bun run build`.

```bash
# Install (runs bun build, symlinks dist/cairn to both ~/.local/bin/cairn and ~/.local/bin/ralph)
./install.sh

# Build manually
bun run build

# Run tests
bun test

# Verify
cairn --version
```

## Architecture

### Execution flow

`src/index.ts` is the entry point. It uses [Commander](https://github.com/tj/commander.js) to parse CLI arguments and dispatch to command handlers in `src/commands/*.ts`:

- **plan** → `src/commands/plan.ts` — Two-phase interactive flow: (1) planning discussion that writes `planning-notes.md`, (2) task generation that writes `tasks.json`. Both phases launch `claude` with `--append-system-prompt` and restricted `--allowedTools`.
- **run** → `src/commands/run.ts` — The core loop. For each iteration: picks highest-priority pending task (respecting dependencies), runs a health check, spawns `claude -p` with a per-task system prompt, validates tests post-completion, archives completed tasks to `tasks.completed.json`. Agents run with `--dangerously-skip-permissions` and `--output-format stream-json`.
- **summarize** → `src/commands/summarize.ts` — Spawns a Sonnet agent to read the codebase and write/update `IMPLEMENTATION.md`.
- **init**, **status**, **edit**, **logs**, **narrate** — `src/commands/*.ts`.

### Key design patterns

- **Fresh agents per task**: Each execution iteration spawns a new `claude -p` process with no memory of previous iterations. Cross-iteration context is passed via `notes` fields in `tasks.json` and a `PREV_NOTES` mechanism.
- **System prompt construction**: `buildSystemPrompt()` in `src/commands/run.ts` generates per-task prompts based on directory and project config. The agent is told its task via the user prompt, not by reading `tasks.json`.
- **Task lifecycle**: pending → in-progress (set by agent) → complete (set by agent) → archived (moved to `tasks.completed.json` by the loop). Post-iteration test validation can revert a task to in-progress.
- **Stream filtering**: `src/stream-filter.ts` parses `stream-json` output from Claude and renders colored one-line summaries of tool calls and results.
- **Config loading**: `src/config.ts` reads `cairn.json` (or legacy `ralph.json` — see [Branding and the legacy layout](#branding-and-the-legacy-layout)), exports config values, and auto-detects health checks from `package.json`/`Cargo.toml`/`Makefile`.
- **Narration**: `lib/cairn_narrate.py` and `lib/cairn_narrate_server.py` are Python scripts used for audio narration of task progress. Managed via `src/narration.ts`.

### Per-project data layout (created by `cairn init` in the target project)

```
target-project/
├── .cairn/                     # or .ralph/ on projects not yet migrated
│   ├── tasks.json              # Active task list
│   ├── tasks.completed.json    # Archive of completed tasks
│   ├── state.json              # Monotonic task-ID counter + planning round { "nextTaskId": N, "round": R } — committed to git
│   ├── reviews/
│   │   └── round-<N>.md        # Per-planning-round post-task review logs
│   └── planning-notes.md       # Output from planning discussions
└── cairn.json                  # Project configuration (optional; or legacy ralph.json)
```

## Conventions

- All source lives in `src/`. `lib/` contains only Python narration scripts (`cairn_narrate.py`, `cairn_narrate_server.py`).
- Task selection logic lives in `src/task-selector.ts`, prompt building and loop control in `src/commands/run.ts`, test validation in `src/test-validator.ts`.
- Paths are kept absolute internally; task `directory` fields in `tasks.json` are relative to the project root.
- No external runtime dependencies beyond Bun and the `claude` CLI.
- The health check must pass `--target=bun` (`bun build --target=bun src/index.ts ...`). Without it Bun assumes a browser target and fails on the Node builtins imported by `src/index.ts`.

## Branding and the legacy layout

`src/brand.ts` is the single source of truth for the project name (`BRAND`, frozen, not user-configurable). `LEGACY` holds the pre-rename names, which are still **read** so that projects on the old layout keep working:

- `findDataDir(projectRoot)` in `src/utils.ts` → existing `.cairn/`, else existing `.ralph/`, else `.cairn/`.
- `findConfigFile(projectRoot)` in `src/config.ts` → existing `cairn.json`, else existing `ralph.json`, else `cairn.json`.
- `findProjectRoot()` checks both names at every level of the upward walk, so the nearest project wins regardless of layout.

**Standing rule:** `BRAND.dataDir` / `BRAND.configFile` are for CREATING paths, never for RESOLVING them. Any path to data that should already exist must come from `findDataDir()` / `findConfigFile()` — otherwise a project still on `.ralph/` gets paths into a nonexistent `.cairn/`.

Legacy fallbacks warn via `warnLegacyOnce(key, message)` (stderr, once per key per process; `resetLegacyWarnings()` exists for tests).

### The temp-file prefix — a second naming tier

Inside the data dir, runtime temp files carry their own prefix (`BRAND.tempPrefix` = `.cairn_`, `LEGACY.tempPrefix` = `.ralph_`). It is **independent of the directory name**: a project can be on `.cairn/` and still hold `.ralph_`-prefixed files. Four of these hold live cross-run state — `completed_ids`, `prev_notes`, `iterations.log`, `tasks_snapshot.json` — so the same standing rule applies, via three helpers in `src/utils.ts`:

- `tempFilePath(dataDir, suffix)` — CREATE. Always the current prefix.
- `findTempFilePath(dataDir, suffix)` — RESOLVE. Existing `.cairn_`, else existing `.ralph_`, else `.cairn_`.
- `allTempFilePaths(dataDir, suffix)` — both candidates, current first. Use for existence checks behind an injected `existsSync` (as `runRun` does for the completion flag) and for cleanup sweeps, which must remove both names.

`suffix` is the name *minus* the prefix (`'completed_ids'`, not `'.cairn_completed_ids'`).

The one deliberate exception is `.ralph_task_<id>_notes.md`: write-and-sweep scratch that is never read back, still handed to agents under the legacy name. The cleanup sweep (`NOTES_TEMPFILE_RE` in `src/commands/run.ts`) matches **both** prefixes anyway, so scratch written under either name is removed.

## Agent workflow

Agents **must** use the `cairn task` subcommand group for every mutation of `.cairn/tasks.json` (`.ralph/tasks.json` on a project not yet migrated — the subcommands resolve either layout automatically):

```
cairn task start <id> --iteration <n>
cairn task complete <id> --iteration <n> [--notes "..."]
cairn task note <id> "message"
cairn task set-status <id> <status>
cairn task add --title "..." --description "..." [...]
cairn task next-id [--count <n>]
cairn task show <id>
```

`ralph task ...` still works identically — see [Branding and the legacy layout](#branding-and-the-legacy-layout) — but new documentation and prompts should say `cairn`.

Task IDs are allocated by `cairn task next-id`, which reads and increments `state.json`. IDs are never reused — once allocated, an ID remains reserved even if the task is deleted or archived. `state.json` is seeded lazily on first call and is committed to git alongside `tasks.json`. `state.json` also tracks the current planning round; `cairn plan` bumps the round counter on every planning run, and the post-task reviewer writes its findings to `.cairn/reviews/round-<N>.md` for the active round.

Direct `Edit` or `Write` on `tasks.json` is **forbidden**. This is enforced two ways: the per-agent system prompt explicitly bans it, and the post-task reviewer runs with a directory-scoped allowlist covering only `<dataDir>/reviews/**`, which excludes `tasks.json`. That allowlist rule is derived from the same resolved `reviewsDir` the reviewer's prompt targets (`src/post-task-reviewer.ts`), so the grant and the write path can never name different data dirs — if they did, every reviewer write would be *silently* denied. The CLI routes all writes through `writeTasksFile()`, which performs atomic temp-file replacement and validates JSON on every write — making corruption structurally impossible via this path.

## The `cairn migrate` command

`cairn migrate` (`src/commands/migrate.ts`) converts a single project from the legacy `.ralph/`/`ralph.json` layout to `.cairn/`/`cairn.json`. Key mechanics:

- **Operates on `cwd` only.** No scanning, no walking upward, no recursion into subdirectories. Run it from the project root you want to migrate.
- **Stages, never commits.** Every rename (`git mv`) and every write (refreshed `.claude/` artifacts, the appended `.gitignore` lines) ends up in the git index, not in a commit. The run prints a `Staged changes:` summary and closes with "Changes are STAGED, not committed" — review with `git status` / `git diff --cached`, then commit yourself.
- **Refuses rather than guesses.** It aborts (exit 1, nothing touched) if both layouts exist side by side (`.ralph/` + `.cairn/`, or `ralph.json` + `cairn.json`), if the project isn't inside a git repo, or if any task is `in-progress` (an agent mid-task would lose its data directory underneath it). A dirty working tree is only a warning.
- **Also refreshes `.claude/` artifacts.** Beyond the directory/config rename, it reinstalls the current slash-command and agent set (even into a project that never ran `cairn init`) and regenerates the narration hooks *if* they already exist, so a migrated project points at the current socket path instead of a stale one. Custom, non-Cairn files under `.claude/` are never touched (overwrite is by filename only).
- **Idempotent.** A second run against an already-migrated project with current artifacts finds nothing to do and says so.

## The compatibility window

The rename from Ralph to Cairn is being rolled out gradually across every project on this machine, not in one atomic cutover. Until every project has run `cairn migrate`, both names must keep working simultaneously:

- **Both data layouts are read.** `.cairn/` is preferred; `.ralph/` is used when `.cairn/` doesn't exist. Same for `cairn.json` vs. `ralph.json`. See [Branding and the legacy layout](#branding-and-the-legacy-layout) for the exact resolution helpers.
- **Both binaries are installed.** `./install.sh` symlinks `~/.local/bin/cairn` and `~/.local/bin/ralph` to the same compiled binary. The `ralph` symlink is a long-lived compatibility commitment, not a deprecation stub — other projects have `ralph task ...` frozen into their installed `.claude/agents/*.md` files, and they break the moment `ralph` stops resolving. Do not add a deprecation warning that fires on every `ralph` invocation.
- **The `ralph` symlink stays until every project is migrated.** There is no scheduled removal date; it comes out only once nothing on the machine still depends on the old name.

### The removal marker

Every intentional legacy fallback in shipped source carries the exact comment string **`remove once all projects migrated`** (in the comment syntax of its language). `grep -rn "remove once all projects migrated" src/ lib/ install.sh` is the complete work list for the eventual removal round — start from `LEGACY` in `src/brand.ts` and follow the markers out.

`test/legacy-markers.test.ts` enforces this: any line in `src/**/*.ts`, `lib/*.py`, `agents/*.md`, `commands/*.md`, or `install.sh` that mentions the old name must have the marker within 20 lines above or 3 below. Add a legacy fallback without the marker and the suite fails. The marker must sit on a single line — a comment wrapped mid-phrase will not match.

The one exemption is the narration socket/pid paths (`/tmp/ralph-tts.sock`, `/tmp/ralph-tts.pid`). They are *not* compatibility fallbacks — they are plain un-migrated literals that never got the dual-name treatment, tracked by task #48, and marked `TODO(#48)` instead. Note that `writeNarrationHooks` already emits `/tmp/cairn-tts.sock` while `run.ts` still starts the server on `/tmp/ralph-tts.sock`, so generated hooks and the running server currently disagree — that mismatch is #48's to resolve.

## Pin/unpin procedure for self-modifying rounds

Cairn's own health check (`ralph.json`/`cairn.json`'s `healthCheck` field) is `bun build --target=bun src/index.ts --outfile ...`, and it runs before *every* iteration of `cairn run`. That is a problem specifically when a planning round's own task list is renaming this tool: the loop is executing changes to the same binary it uses to build and check itself, mid-round, with no atomicity between "task N edits `src/`" and "the next iteration's health check builds `src/`".

The fix used during the Ralph→Cairn rename rounds — worth reusing for any future self-modifying round:

1. **Freeze the installed binary before starting the round.** Copy the last known-good `~/.local/bin/ralph` (or `cairn`) aside, or simply stop re-running `./install.sh` for the duration of the round. Agents are explicitly told not to run `./install.sh` themselves.
2. **Redirect the health check to a throwaway outfile.** Point `healthCheck` at something like `bun build --target=bun src/index.ts --outfile /tmp/cairn-healthcheck` instead of the real `dist/` output, so a build-outfile-path task (e.g. renaming `dist/ralph` → `dist/cairn`) doesn't corrupt the binary developers are actively using.
3. **Tell agents both values are user-managed for the round.** Any task whose file scope could plausibly touch `install.sh`, `package.json`'s build script, or `healthCheck` should say so explicitly in its description (e.g. "do NOT modify `ralph.json`'s `healthCheck` value — the user has pinned the binary and redirected the health check to a throwaway outfile"). Without that, an unrelated task can innocently "fix" the health check back to the real outfile and re-introduce the self-modification hazard mid-round.
4. **Revert both manually once the round finishes.** Un-pin the binary (re-run `./install.sh`) and restore `healthCheck` to its real value. Neither is done automatically — both are explicitly user-managed for the duration of the round.
