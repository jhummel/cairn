# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Cairn

Cairn is an agentic task orchestration CLI that wraps Claude Code. It turns a planning conversation into a task list (`tasks.json`), then executes each task autonomously with fresh Claude agents — including health checks, test validation, dependency ordering, and archival of completed work.

## Development

Cairn is a TypeScript project built with Bun. The entry point is `src/index.ts`, compiled to `dist/cairn` via `bun run build`.

```bash
# Install (runs bun build, symlinks dist/cairn to ~/.local/bin/cairn)
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
- **Config loading**: `src/config.ts` reads `cairn.json`, exports config values, and auto-detects health checks from `package.json`/`Cargo.toml`/`Makefile`.
- **Narration**: `lib/cairn_narrate.py` and `lib/cairn_narrate_server.py` are Python scripts used for audio narration of task progress. Managed via `src/narration.ts`.
- **Branding**: `src/brand.ts` is the single source of truth for the project's name and paths (`BRAND` — `dataDir`, `configFile`, `envPrefix`, `tempPrefix`, `socket`, `pidFile`), frozen and not user-configurable. It also exports `NOTES_TEMP_PREFIX`, a deliberately separate constant — see [Conventions](#conventions).

### Per-project data layout (created by `cairn init` in the target project)

```
target-project/
├── .cairn/
│   ├── tasks.json              # Active task list
│   ├── tasks.completed.json    # Archive of completed tasks
│   ├── state.json              # Monotonic task-ID counter + planning round { "nextTaskId": N, "round": R } — committed to git
│   ├── reviews/
│   │   └── round-<N>.md        # Per-planning-round post-task review logs
│   └── planning-notes.md       # Output from planning discussions
└── cairn.json                  # Project configuration (optional)
```

## Conventions

- All source lives in `src/`. `lib/` contains only Python narration scripts (`cairn_narrate.py`, `cairn_narrate_server.py`).
- Task selection logic lives in `src/task-selector.ts`, prompt building and loop control in `src/commands/run.ts`, test validation in `src/test-validator.ts`.
- Paths are kept absolute internally; task `directory` fields in `tasks.json` are relative to the project root.
- No external runtime dependencies beyond Bun and the `claude` CLI.
- The health check must use the `--compile` form (`bun build --compile src/index.ts --outfile ...`), matching `package.json`'s `build` script (`bun run build` → `bun build --compile src/index.ts --outfile dist/cairn`). `--compile` is what exercises the same standalone-executable compile step that produces the shipped binary; a plain bundle build (e.g. `--target=bun`) skips that step, so a compile-stage failure would pass the check and only surface later at install time.
- BRAND.dataDir / BRAND.configFile / BRAND.socket / BRAND.pidFile are for CREATING paths, never for RESOLVING them. Any path pointing at something expected to already exist must come from `findDataDir()` (`src/utils.ts`), `findConfigFile()` (`src/config.ts`), or `findNarrationSocketPath()` / `findNarrationPidFile()` (`src/narration.ts`) — otherwise the path is built from what the name *should* be rather than from what discovery actually found on disk.
- The per-task notes scratch file is named `.ralph_task_<id>_notes.md` (prefix `NOTES_TEMP_PREFIX` in `src/brand.ts`), not `.cairn_...`. This is a deliberate permanent exception, not a leftover: the file is write-and-sweep scratch that's never read back, so renaming it would only churn every project's committed `.gitignore` history for zero behavioral gain.

## Agent workflow

Agents **must** use the `cairn task` subcommand group for every mutation of `.cairn/tasks.json`:

```
cairn task start <id> --iteration <n>
cairn task complete <id> --iteration <n> [--notes "..."]
cairn task note <id> "message"
cairn task set-status <id> <status>
cairn task add --title "..." --description "..." [...]
cairn task next-id [--count <n>]
cairn task show <id>
```

Task IDs are allocated by `cairn task next-id`, which reads and increments `state.json`. IDs are never reused — once allocated, an ID remains reserved even if the task is deleted or archived. `state.json` is seeded lazily on first call and is committed to git alongside `tasks.json`. `state.json` also tracks the current planning round; `cairn plan` bumps the round counter on every planning run, and the post-task reviewer writes its findings to `.cairn/reviews/round-<N>.md` for the active round.

Direct `Edit` or `Write` on `tasks.json` is **forbidden**. This is enforced two ways: the per-agent system prompt explicitly bans it, and the post-task reviewer's only Edit/Write grant is the directory-scoped `<dataDir>/reviews/**`, which excludes `tasks.json`. (Its Bash grants are narrow too: the enumerated read-only git subcommands — `diff`, `log`, `show`, `status`, `rev-parse` — never `Bash(git:*)`, plus one prefix rule per subcommand of the task's declared `tests` entries.) That allowlist rule is derived from the same resolved `reviewsDir` the reviewer's prompt targets (`src/post-task-reviewer.ts`), so the grant and the write path can never name different data dirs — if they did, every reviewer write would be *silently* denied. The CLI routes all writes through `writeTasksFile()`, which performs atomic temp-file replacement and validates JSON on every write — making corruption structurally impossible via this path.

## Pin/unpin procedure for self-modifying rounds

This section is permanent, generic guidance for *any* self-modifying round — it is not tied to the historical Ralph→Cairn rename, and does not get removed once a given round ends.

Cairn's own health check (`cairn.json`'s `healthCheck` field) is `bun build --compile src/index.ts --outfile dist/cairn`, and it runs before *every* iteration of `cairn run`. That is a problem specifically when a planning round's own task list is modifying this tool: the loop is executing changes to the same binary it uses to build and check itself, mid-round, with no atomicity between "task N edits `src/`" and "the next iteration's health check builds `src/`".

The fix used during past self-modifying rounds — worth reusing for any future one:

1. **Freeze the installed binary before starting the round.** Copy the last known-good `~/.local/bin/cairn` aside, or simply stop re-running `./install.sh` for the duration of the round. Agents are explicitly told not to run `./install.sh` themselves.
2. **Redirect the health check to a throwaway outfile.** Point `healthCheck` at something like `bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck` instead of the real `dist/cairn` output, so a build-outfile-path task doesn't corrupt the binary developers are actively using.
3. **Tell agents both values are user-managed for the round.** Any task whose file scope could plausibly touch `install.sh`, `package.json`'s build script, or `healthCheck` should say so explicitly in its description (e.g. "do NOT modify `cairn.json`'s `healthCheck` value — the user has pinned the binary and redirected the health check to a throwaway outfile"). Without that, an unrelated task can innocently "fix" the health check back to the real outfile and re-introduce the self-modification hazard mid-round.
4. **Revert both manually once the round finishes.** Un-pin the binary (re-run `./install.sh`) and restore `healthCheck` to its real value. Neither is done automatically — both are explicitly user-managed for the duration of the round.
