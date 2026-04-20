# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Ralph

Ralph is an agentic task orchestration CLI that wraps Claude Code. It turns a planning conversation into a task list (`tasks.json`), then executes each task autonomously with fresh Claude agents — including health checks, test validation, dependency ordering, and archival of completed work.

## Development

Ralph is a TypeScript project built with Bun. The entry point is `src/index.ts`, compiled to `dist/ralph` via `bun run build`.

```bash
# Install (runs bun build, symlinks dist/ralph to ~/.local/bin/)
./install.sh

# Build manually
bun run build

# Run tests
bun test

# Verify
ralph --version
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
- **Config loading**: `src/config.ts` reads `ralph.json`, exports config values, and auto-detects health checks from `package.json`/`Cargo.toml`/`Makefile`.
- **Narration**: `lib/ralph_narrate.py` and `lib/ralph_narrate_server.py` are Python scripts used for audio narration of task progress. Managed via `src/narration.ts`.

### Per-project data layout (created by `ralph init` in the target project)

```
target-project/
├── .ralph/
│   ├── tasks.json              # Active task list
│   ├── tasks.completed.json    # Archive of completed tasks
│   └── planning-notes.md       # Output from planning discussions
└── ralph.json                  # Project configuration (optional)
```

## Conventions

- All source lives in `src/`. `lib/` contains only Python narration scripts (`ralph_narrate.py`, `ralph_narrate_server.py`).
- Task selection logic lives in `src/task-selector.ts`, prompt building and loop control in `src/commands/run.ts`, test validation in `src/test-validator.ts`.
- Paths are kept absolute internally; task `directory` fields in `tasks.json` are relative to the project root.
- No external runtime dependencies beyond Bun and the `claude` CLI.

## Agent workflow

Agents **must** use the `ralph task` subcommand group for every mutation of `.ralph/tasks.json`:

```
ralph task start <id> --iteration <n>
ralph task complete <id> --iteration <n> [--notes "..."]
ralph task note <id> "message"
ralph task set-status <id> <status>
ralph task add --title "..." --description "..." [...]
ralph task show <id>
```

Direct `Edit` or `Write` on `.ralph/tasks.json` is **forbidden**. This is enforced two ways: the per-agent system prompt explicitly bans it, and the post-task reviewer runs with a path-scoped allowlist that excludes `.ralph/tasks.json`. The CLI routes all writes through `writeTasksFile()`, which performs atomic temp-file replacement and validates JSON on every write — making corruption structurally impossible via this path.
