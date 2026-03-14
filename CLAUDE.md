# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Ralph

Ralph is an agentic task orchestration CLI that wraps Claude Code. It turns a planning conversation into a task list (`tasks.json`), then executes each task autonomously with fresh Claude agents — including health checks, test validation, dependency ordering, and archival of completed work.

## Development

Ralph is a pure shell + Python project with no build step, no package manager, and no test framework. To test changes, run `ralph` commands against a target project directory.

```bash
# Install (symlinks bin/ralph to ~/.local/bin/)
./install.sh

# Verify
ralph --version
```

There are no linting, formatting, or test commands — validation is manual.

## Architecture

### Execution flow

`bin/ralph` is the entry point. It resolves the project root (`.ralph/` dir → git root → CWD), sources `lib/ralph_common.sh` and `lib/ralph_config.sh`, then dispatches to subcommands:

- **plan** → `ralph_plan.sh` — Two-phase interactive flow: (1) planning discussion that writes `planning-notes.md`, (2) task generation that writes `tasks.json`. Both phases launch `claude` with `--append-system-prompt` and restricted `--allowedTools`.
- **run** → `ralph_loop.sh` → `ralph_execute.sh` — The core loop. For each iteration: picks highest-priority pending task (respecting dependencies), runs a health check, spawns `claude -p` with a per-task system prompt, validates tests post-completion, archives completed tasks to `tasks.completed.json`. Agents run with `--dangerously-skip-permissions` and `--output-format stream-json`.
- **summarize** → `ralph_summarize.sh` — Spawns a Sonnet agent to read the codebase and write/update `IMPLEMENTATION.md`.
- **init**, **status**, **edit**, **logs**, **help** — handled inline in `bin/ralph`.

### Key design patterns

- **Fresh agents per task**: Each execution iteration spawns a new `claude -p` process with no memory of previous iterations. Cross-iteration context is passed via `notes` fields in `tasks.json` and a `PREV_NOTES` mechanism.
- **System prompt construction**: `build_system_prompt()` in `ralph_execute.sh` generates per-task prompts based on directory, scope (internal/integration), and project config. The agent is told its task via the user prompt, not by reading `tasks.json`.
- **Task lifecycle**: pending → in-progress (set by agent) → complete (set by agent) → archived (moved to `tasks.completed.json` by the loop). Post-iteration test validation can revert a task to in-progress.
- **Stream filtering**: `ralph_stream_filter.py` parses `stream-json` output from Claude and renders colored one-line summaries of tool calls and results.
- **Config loading**: `ralph_config.sh` reads `ralph.json` via inline Python, exports `RALPH_*` env vars, and auto-detects health checks from `package.json`/`Cargo.toml`/`Makefile`.

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

- All lib scripts expect `RALPH_PROJECT_ROOT`, `RALPH_DATA_DIR`, and `RALPH_LIB_DIR` env vars set by `bin/ralph`. They check for these and refuse to run standalone.
- Python is used inline (heredocs) for JSON manipulation and as a standalone stream filter. No external Python dependencies.
- Task selection logic, prompt building, and post-iteration validation all live in `ralph_execute.sh` — this is the most complex file.
- Shell scripts use `set -euo pipefail`. Paths are kept absolute internally; task directories are relative in `tasks.json`.
