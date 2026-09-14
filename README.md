# Cairn — Agentic Task Orchestration for Claude Code

Cairn turns Claude Code into an autonomous development loop. You plan features in a conversation, Cairn generates a task list, then executes each task one-at-a-time with fresh Claude agents — complete with health checks, test validation, and automatic archival of completed work.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` on your PATH)
- [Bun](https://bun.sh) (for building and running Cairn)
- [ntfy](https://ntfy.sh) (optional) — free push notification service for remote status updates on your phone/desktop

### API Key

Cairn uses Claude Code under the hood, which requires an Anthropic API key. If you don't already have one:

1. Create an account at [console.anthropic.com](https://console.anthropic.com)
2. Go to **Settings > API Keys** and create a new key
3. Export it in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

This key is used by both `claude` (for task execution) and the narration server (for Haiku summarization). If you're using Claude Code with a different auth method (e.g., Claude Max), the key is only needed for narration.

## Installation

```bash
git clone <repo-url> ~/cairn
cd ~/cairn
./install.sh
```

`install.sh` runs `bun build` to compile the TypeScript source to `dist/cairn`, then symlinks it to `~/.local/bin/cairn`. Pass a custom prefix if needed:

```bash
./install.sh /usr/local
```

Verify the installation:

```bash
cairn --version
```

## Quick Start

```bash
cd your-project
cairn init          # Create .cairn/ directory and starter config
cairn plan          # Plan what to build (interactive)
cairn run           # Execute the plan autonomously
cairn summarize     # Update architecture docs
```

## Commands

| Command                | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `cairn plan`           | Interactive planning discussion + task generation                 |
| `cairn run [max]`      | Execute pending tasks (default: 30 iterations)                    |
| `cairn summarize`      | Update IMPLEMENTATION.md with current system state                |
| `cairn init`           | Initialize `.cairn/` directory and starter `cairn.json`           |
| `cairn status`         | Show current task list overview                                   |
| `cairn edit [target]`  | Edit `tasks.json` (default), `plan` (planning notes), or `config` |
| `cairn logs`           | Show iteration log                                                |
| `cairn narrate on`     | Start the TTS narration server as a background daemon             |
| `cairn narrate off`    | Stop the narration server                                         |
| `cairn narrate status` | Check if the narration server is running                          |
| `cairn narrate "text"` | Speak text directly via Kokoro TTS                                |
| `cairn help`           | Show usage information                                            |

## Workflow

### 1. Initialize

```bash
cd your-project
cairn init
```

Prompts you for each `cairn.json` property with sensible defaults, then creates:

- `.cairn/` — data directory for tasks, notes, and logs
- `cairn.json` — project configuration

It also offers to create/open `CLAUDE.local.md` at the project root for personal agent preferences, and — if a legacy `.cairn/instructions.md` exists — to migrate its content into `CLAUDE.local.md` and delete it. See [Personal Agent Instructions](#personal-agent-instructions).

Re-running `cairn init` on an existing project lets you update any field — existing values are shown as defaults so you only change what you need.

`cairn init` then offers (default: yes, skippable) to seed `.claude/settings.local.json` with a permission baseline — **allow** rules for read-only git inspection (`git diff`, `log`, `show`, `status`, `rev-parse`) plus rules derived from your `healthCheck` and `defaultTestCommand`. No deny rules are seeded.

This exists because agents that verify a task actually landed — chiefly the post-task reviewer — need to run the project's tests and inspect git history while running under normal (non-skip) permissions, not `--dangerously-skip-permissions`. Without these rules, a fresh project denies them outright in headless mode. The same allow rules also mean your own interactive sessions stop accumulating repetitive approval prompts for the same read-only git and test commands.

Existing settings are **merged, not replaced**: `permissions.allow` is unioned with whatever is already there, and every other key in the file is left untouched. If you already have settings from plain `claude` usage, you won't lose them.

**One exception, and it is a repair.** An older `cairn init` seeded `deny` rules for the five mutating `cairn task` subcommands (`start`, `complete`, `set-status`, `add`, `note`). That was a bug: a project-wide deny binds *every* Claude session in the project, including `cairn run`'s own execution agents — it is not bypassed by `--dangerously-skip-permissions` — so agents were silently blocked from recording their own task state, and the loop re-ran a single task indefinitely while reporting success. Since `.claude/settings.local.json` is gitignored, nothing in `git status` reveals it. Re-running `cairn init` now strips exactly those five rules (and drops the `deny` key if that empties it). Any other deny rule you wrote yourself is kept.

Cairn deliberately does not edit `.gitignore` or your global git config — add `.claude/settings.local.json` to your own `.gitignore` yourself. Claude Code only auto-ignores that file when Claude Code itself creates it.

### 2. Plan

```bash
cairn plan
```

Claude explores your codebase and discusses what to build. When the discussion feels complete, it writes `planning-notes.md`. You review, then Claude generates a concrete task list in `tasks.json`.

### 3. Execute

```bash
cairn run
```

Each iteration:

1. Picks the highest-priority pending task (respecting dependencies)
2. Runs a health check if configured
3. Spawns a fresh Claude agent scoped to the task's directory
4. The agent implements the task, runs tests, commits, and marks it complete
5. Post-iteration validation re-runs the task's tests — reverts to `in-progress` if they fail
6. Completed tasks are archived to `tasks.completed.json`

### 4. Summarize

```bash
cairn summarize
```

Spawns a Sonnet agent that reads the entire codebase and writes/updates `IMPLEMENTATION.md` — a high-level architecture summary for returning developers.

## Voice Narration

Cairn can narrate what's happening during execution using [Kokoro](https://github.com/hexgrad/kokoro) TTS and Claude Haiku summarization. Events are summarized into brief spoken commentary — like a sarcastic coworker watching over your shoulder.

### Setup

Voice narration requires Python 3.11 (kokoro's numpy pin doesn't build on 3.13+), a working audio output device, and an Anthropic API key.

1. Create the narration venv and install dependencies:

```bash
cd ~/cairn   # or wherever you cloned cairn
python3.11 -m venv .venv
.venv/bin/pip install kokoro sounddevice anthropic
```

> If you don't have Python 3.11, install it via pyenv (`pyenv install 3.11`) or Homebrew (`brew install python@3.11`). On Linux, also ensure `libportaudio2` is installed (`apt install libportaudio2`).

2. Make sure `ANTHROPIC_API_KEY` is exported (see [API Key](#api-key) above) — the narration server calls Claude Haiku to summarize events before speaking them.

3. Kokoro downloads its voice models on first use (~80MB per language pack). The first `cairn narrate "test"` call will be slow while it caches.

Cairn automatically uses the venv Python for narration — no activation needed, and it works from any project directory.

### During `cairn run`

Set `narration.enabled` to `true` in `cairn.json`. The narration server starts automatically with the execution loop and stops when it finishes. The stream filter forwards tool use events and assistant text to the server via Unix socket.

### During standalone `claude` usage

```bash
cairn narrate on          # Start the narration server daemon
claude                    # Use Claude Code normally — hooks forward events
cairn narrate off         # Stop when done
```

Run `cairn init` with narration enabled to install Claude Code hooks (`.claude/hooks/narrate.sh`, `speak.sh`, `notify.sh`) into your project. These detect the server socket and forward events automatically.

The socket lives at `/tmp/cairn-tts.sock` (`BRAND.socket`). Because each project's hooks hardcode a `SOCKET="…"` line at install time, the server binds whatever the project's `.claude/hooks/narrate.sh` dials rather than a fixed path. Resolution lives in `findNarrationSocketPath()` / `findNarrationPidFile()` in `src/narration.ts`.

**Note:** the narration server (`lib/cairn_narrate_server.py`) reads `CAIRN_NARRATE_SOCKET` as the default for its `--socket` argument — but `cairn run` and `cairn narrate on` currently always pass `--socket` explicitly, so exporting the variable has no effect until that wiring task lands. Once it does, standalone `claude` sessions will be able to export `CAIRN_NARRATE_SOCKET` to point hooks at a non-default socket.

### One-off speech

```bash
cairn narrate "Hello, world"
```

Speaks text directly via Kokoro TTS without needing the server.

## Push Notifications (ntfy)

Cairn can send push notifications to your phone or desktop via [ntfy.sh](https://ntfy.sh) so you can walk away from the terminal and still know what's happening. You'll get notified when tasks start, complete, fail, and when the entire run finishes.

ntfy is a free, open-source pub/sub notification service — no account required. Just pick a unique topic name (it's public, so make it hard to guess) and subscribe to it in the [ntfy app](https://ntfy.sh/#subscribe) (iOS, Android, or web).

To enable, add `ntfyTopic` to your `cairn.json`:

```json
{
  "narration": {
    "ntfyTopic": "cairn-your-secret-topic-name"
  }
}
```

Notifications work independently of voice narration — you don't need `narration.enabled` set to `true` or Kokoro installed. Just set the topic and you'll get push updates.

## Personal Agent Instructions

`CLAUDE.local.md` at your project root is Claude Code's native mechanism for personal instructions. It's loaded automatically by every Claude Code session in the project — including Cairn's own headless agents (`cairn run`'s execution agents, the post-task reviewer, `cairn plan`, `cairn summarize`) and `/cairn-run`'s subagents — so Cairn doesn't need to inject it itself. Use it for preferences that shouldn't be shared with your team, like preferred coding style, tools you like to avoid, or communication tone.

It differs from `CLAUDE.md`:

| | `CLAUDE.md` | `CLAUDE.local.md` |
|---|---|---|
| **Scope** | Project-level, committed to git | Personal |
| **When used** | Every Claude Code session | Every Claude Code session |
| **Purpose** | Project conventions, build commands | Personal agent preferences |

Create it during `cairn init` (it offers to create/open it in `$EDITOR`) or manually:

```bash
touch CLAUDE.local.md
# Then edit it — plain text or markdown, no special format required
```

`cairn init` warns — but never edits `.gitignore` or your git config — if `CLAUDE.local.md` isn't already ignored. Claude Code only auto-excludes a path when Claude Code itself creates that file, and it writes that exclusion to your global git excludes, not this repository's `.gitignore`, so add it yourself.

### Migrating from `.cairn/instructions.md`

`.cairn/instructions.md` is deprecated. Unlike `CLAUDE.local.md`, it only ever reached Cairn's own execution, post-task reviewer, `plan`, and `summarize` agents — never other Claude Code sessions in the project. Re-run `cairn init` and accept the migration prompt to move its content into `CLAUDE.local.md` (appended under a heading if `CLAUDE.local.md` already has content) and delete the old file. The loader still reads `instructions.md` when present, for one release, but logs a deprecation warning to stderr each time.

## Configuration

`cairn.json` at your project root. Every field is optional with sensible defaults.

```json
{
  "projectName": "My Project",
  "projectDescription": "Brief description used in agent system prompts",
  "healthCheck": "npm run type-check",
  "defaultTestCommand": "npm test",
  "implementationFile": "IMPLEMENTATION.md",
  "truncateText": true,
  "summarize": {
    "claudeMdPattern": "src/services/*/CLAUDE.md"
  },
  "narration": {
    "enabled": false,
    "voice": "bf_emma",
    "ntfyTopic": ""
  }
}
```

| Field                       | Default             | Description                                            |
| --------------------------- | ------------------- | ------------------------------------------------------ |
| `projectName`               | Git repo basename   | Name used in agent system prompts                      |
| `projectDescription`        | (empty)             | Brief project description for agent context            |
| `healthCheck`               | Auto-detected       | Command to run before each iteration                   |
| `defaultTestCommand`        | (empty)             | Fallback test command when tasks don't specify one     |
| `implementationFile`        | `IMPLEMENTATION.md` | Path to architecture summary document                  |
| `truncateText`              | `true`              | Truncate verbose agent text output in the terminal     |
| `summarize.claudeMdPattern` | (empty)             | Glob for CLAUDE.md files to prune during summarization |
| `narration.enabled`         | `false`             | Enable voice narration during `cairn run`              |
| `narration.voice`           | `bf_emma`           | Kokoro TTS voice to use                                |
| `narration.ntfyTopic`       | (empty)             | ntfy.sh topic for push notifications (no account needed) |

`healthCheck` and `defaultTestCommand` also feed the permission rules `cairn init` can seed into `.claude/settings.local.json` — see [Initialize](#1-initialize).

### Health Check Auto-Detection

If `healthCheck` is not set in `cairn.json`, Cairn auto-detects:

- `package.json` with `type-check` script → `npm run type-check`
- `Cargo.toml` → `cargo check`
- `Makefile` with `check` target → `make check`

## Project Root Detection

Cairn finds your project root in this order:

1. `--project-root` flag
2. `CAIRN_PROJECT_ROOT` environment variable
3. Walk upward from CWD looking for a `.cairn/` directory
4. Git repository root
5. Current working directory

## File Structure

### Cairn installation

```
cairn/
├── src/
│   ├── index.ts                 # CLI entry point (Commander)
│   ├── commands/
│   │   ├── plan.ts              # Planning discussion + task generation
│   │   ├── run.ts               # Core execution loop + system prompt builder
│   │   ├── init.ts              # Project initialization
│   │   ├── summarize.ts         # IMPLEMENTATION.md generator
│   │   ├── status.ts            # Task list overview
│   │   ├── edit.ts              # Open tasks.json / plan / config in editor
│   │   ├── logs.ts              # Iteration log viewer
│   │   └── narrate.ts           # TTS narration server management
│   ├── brand.ts                 # Project name/paths (BRAND)
│   ├── config.ts                # Config loading from cairn.json
│   ├── task-selector.ts         # Task selection logic
│   ├── test-validator.ts        # Post-iteration test validation
│   └── stream-filter.ts         # Stream-json formatter + narration forwarding
├── lib/
│   ├── cairn_narrate.py         # Standalone TTS narration utility
│   └── cairn_narrate_server.py  # TTS server (Kokoro + Haiku summarization)
├── dist/cairn                   # Compiled binary (generated by bun build)
└── install.sh                   # Builds and installs cairn
```

### Per-project data (created by `cairn init`)

```
your-project/
├── .cairn/
│   ├── tasks.json              # Active task list
│   ├── tasks.completed.json    # Archive of completed tasks
│   ├── state.json              # Monotonic task-ID counter + planning round — never reuses IDs (committed to git)
│   ├── reviews/
│   │   └── round-<N>.md        # Per-planning-round post-task review logs
│   ├── planning-notes.md       # Output from planning discussions
│   └── .gitignore              # Ignores temp files (and instructions.md, if still present)
├── cairn.json                  # Project configuration (optional)
├── CLAUDE.local.md             # Personal agent preferences (gitignored — see Personal Agent Instructions)
└── IMPLEMENTATION.md           # Architecture summary
```

## Task Structure

Each task in `tasks.json`:

```json
{
  "id": 1,
  "priority": 1,
  "title": "Add user validation endpoint",
  "description": "Detailed instructions the agent follows...",
  "directory": "src/services/auth-service",
  "status": "pending",
  "files": ["src/api/users/users.controller.ts"],
  "dependencies": [],
  "tests": ["npm test"],
  "model": "sonnet"
}
```

| Field          | Description                                                                         |
| -------------- | ----------------------------------------------------------------------------------- |
| `priority`     | Lower = higher priority                                                             |
| `directory`    | Working directory relative to project root. Empty = project root.                   |
| `dependencies` | Array of task IDs that must complete first                                          |
| `model`        | `opus` (default, complex work) or `sonnet` (straightforward tasks)                  |
| `tests`        | Commands run from the task's directory to validate completion                       |

## Tips

- **Edit tasks.json directly** — it's just JSON. Add, reorder, or reword tasks anytime between runs.
- **Resume after interruption** — `cairn run` picks up where it left off. In-progress tasks are retried automatically.
- **Cost control** — set `model: "sonnet"` on straightforward tasks. Reserve `opus` for complex work.
- **CLAUDE.md matters** — the execution engine loads your project's `CLAUDE.md` as system prompt context. Keep it current with conventions and patterns so agents follow your standards.
- **CLAUDE.local.md for personal preferences** — create it with `cairn init` or by hand to steer agent behavior without committing personal preferences to the repo. It's loaded by every Claude Code session in the project, not just `cairn run`; `cairn init` warns (but won't edit `.gitignore` for you) if it isn't already ignored.
