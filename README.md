# Ralph — Agentic Task Orchestration for Claude Code

Ralph turns Claude Code into an autonomous development loop. You plan features in a conversation, Ralph generates a task list, then executes each task one-at-a-time with fresh Claude agents — complete with health checks, test validation, and automatic archival of completed work.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` on your PATH)
- Python 3 (for task parsing and stream formatting)
- `coreutils` recommended on macOS (`brew install coreutils`) for per-iteration timeouts
- [ntfy](https://ntfy.sh) (optional) — free push notification service for remote status updates on your phone/desktop

### API Key

Ralph uses Claude Code under the hood, which requires an Anthropic API key. If you don't already have one:

1. Create an account at [console.anthropic.com](https://console.anthropic.com)
2. Go to **Settings > API Keys** and create a new key
3. Export it in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

This key is used by both `claude` (for task execution) and the narration server (for Haiku summarization). If you're using Claude Code with a different auth method (e.g., Claude Max), the key is only needed for narration.

## Installation

```bash
git clone <repo-url> ~/ralph
cd ~/ralph
./install.sh
```

This symlinks `ralph` to `~/.local/bin/`. Pass a custom prefix if needed:

```bash
./install.sh /usr/local
```

Verify the installation:

```bash
ralph --version
```

## Quick Start

```bash
cd your-project
ralph init          # Create .ralph/ directory and starter config
ralph plan          # Plan what to build (interactive)
ralph run           # Execute the plan autonomously
ralph summarize     # Update architecture docs
```

## Commands

| Command                | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `ralph plan`           | Interactive planning discussion + task generation                 |
| `ralph run [max]`      | Execute pending tasks (default: 30 iterations)                    |
| `ralph summarize`      | Update IMPLEMENTATION.md with current system state                |
| `ralph init`           | Initialize `.ralph/` directory and starter `ralph.json`           |
| `ralph status`         | Show current task list overview                                   |
| `ralph edit [target]`  | Edit `tasks.json` (default), `plan` (planning notes), or `config` |
| `ralph logs`           | Show iteration log                                                |
| `ralph narrate on`     | Start the TTS narration server as a background daemon             |
| `ralph narrate off`    | Stop the narration server                                         |
| `ralph narrate status` | Check if the narration server is running                          |
| `ralph narrate "text"` | Speak text directly via Kokoro TTS                                |
| `ralph help`           | Show usage information                                            |

## Workflow

### 1. Initialize

```bash
cd your-project
ralph init
```

Creates:

- `.ralph/` — data directory for tasks, notes, and logs
- `ralph.json` — optional project configuration

### 2. Plan

```bash
ralph plan
```

Claude explores your codebase and discusses what to build. When the discussion feels complete, it writes `planning-notes.md`. You review, then Claude generates a concrete task list in `tasks.json`.

### 3. Execute

```bash
ralph run
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
ralph summarize
```

Spawns a Sonnet agent that reads the entire codebase and writes/updates `IMPLEMENTATION.md` — a high-level architecture summary for returning developers.

## Voice Narration

Ralph can narrate what's happening during execution using [Kokoro](https://github.com/hexgrad/kokoro) TTS and Claude Haiku summarization. Events are summarized into brief spoken commentary — like a sarcastic coworker watching over your shoulder.

### Setup

Voice narration requires Python 3.11 (kokoro's numpy pin doesn't build on 3.13+), a working audio output device, and an Anthropic API key.

1. Create the narration venv and install dependencies:

```bash
cd ~/ralph   # or wherever you cloned ralph
python3.11 -m venv .venv
.venv/bin/pip install kokoro sounddevice anthropic
```

> If you don't have Python 3.11, install it via pyenv (`pyenv install 3.11`) or Homebrew (`brew install python@3.11`). On Linux, also ensure `libportaudio2` is installed (`apt install libportaudio2`).

2. Make sure `ANTHROPIC_API_KEY` is exported (see [API Key](#api-key) above) — the narration server calls Claude Haiku to summarize events before speaking them.

3. Kokoro downloads its voice models on first use (~80MB per language pack). The first `ralph narrate "test"` call will be slow while it caches.

Ralph automatically uses the venv Python for narration — no activation needed, and it works from any project directory.

### During `ralph run`

Set `narration.enabled` to `true` in `ralph.json`. The narration server starts automatically with the execution loop and stops when it finishes. The stream filter forwards tool use events and assistant text to the server via Unix socket.

### During standalone `claude` usage

```bash
ralph narrate on          # Start the narration server daemon
claude                    # Use Claude Code normally — hooks forward events
ralph narrate off         # Stop when done
```

Run `ralph init` with narration enabled to install Claude Code hooks (`.claude/hooks/narrate.sh`, `speak.sh`, `notify.sh`) into your project. These detect the server socket at `/tmp/ralph-tts.sock` and forward events automatically.

**Note:** During `ralph run`, the loop sets `RALPH_NARRATE_SOCKET` automatically. For standalone `claude` sessions, you need to export it yourself so the hooks know where to send events:

```bash
export RALPH_NARRATE_SOCKET="/tmp/ralph-tts.sock"
ralph narrate on
claude
```

### One-off speech

```bash
ralph narrate "Hello, world"
```

Speaks text directly via Kokoro TTS without needing the server.

## Push Notifications (ntfy)

Ralph can send push notifications to your phone or desktop via [ntfy.sh](https://ntfy.sh) so you can walk away from the terminal and still know what's happening. You'll get notified when tasks start, complete, fail, and when the entire run finishes.

ntfy is a free, open-source pub/sub notification service — no account required. Just pick a unique topic name (it's public, so make it hard to guess) and subscribe to it in the [ntfy app](https://ntfy.sh/#subscribe) (iOS, Android, or web).

To enable, add `ntfyTopic` to your `ralph.json`:

```json
{
  "narration": {
    "ntfyTopic": "ralph-your-secret-topic-name"
  }
}
```

Notifications work independently of voice narration — you don't need `narration.enabled` set to `true` or Kokoro installed. Just set the topic and you'll get push updates.

## Configuration

`ralph.json` at your project root. Every field is optional with sensible defaults.

```json
{
  "projectName": "My Project",
  "projectDescription": "Brief description used in agent system prompts",
  "healthCheck": "npm run type-check",
  "defaultTestCommand": "npm test",
  "implementationFile": "IMPLEMENTATION.md",
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
| `summarize.claudeMdPattern` | (empty)             | Glob for CLAUDE.md files to prune during summarization |
| `narration.enabled`         | `false`             | Enable voice narration during `ralph run`              |
| `narration.voice`           | `bf_emma`           | Kokoro TTS voice to use                                |
| `narration.ntfyTopic`       | (empty)             | ntfy.sh topic for push notifications (no account needed) |

### Health Check Auto-Detection

If `healthCheck` is not set in `ralph.json`, Ralph auto-detects:

- `package.json` with `type-check` script → `npm run type-check`
- `Cargo.toml` → `cargo check`
- `Makefile` with `check` target → `make check`

## Project Root Detection

Ralph finds your project root in this order:

1. `--project-root` flag
2. `RALPH_PROJECT_ROOT` environment variable
3. Walk upward from CWD looking for `.ralph/` directory
4. Git repository root
5. Current working directory

## File Structure

### Ralph installation

```
ralph/
├── bin/ralph                    # CLI entry point
├── lib/
│   ├── ralph_common.sh          # Shared shell utilities
│   ├── ralph_config.sh          # Config loading from ralph.json
│   ├── ralph_execute.sh         # Core execution loop + system prompt builder
│   ├── ralph_init.sh            # Project initialization
│   ├── ralph_loop.sh            # Outer loop driver
│   ├── ralph_narrate.py         # Standalone TTS narration utility
│   ├── ralph_narrate_server.py  # TTS server (Kokoro + Haiku summarization)
│   ├── ralph_plan.sh            # Planning conversation + task generation
│   ├── ralph_stream_filter.py   # Stream-json formatter + narration forwarding
│   └── ralph_summarize.sh       # IMPLEMENTATION.md generator
└── install.sh                   # Installer
```

### Per-project data (created by `ralph init`)

```
your-project/
├── .ralph/
│   ├── tasks.json              # Active task list
│   ├── tasks.completed.json    # Archive of completed tasks
│   ├── planning-notes.md       # Output from planning discussions
│   └── .gitignore              # Ignores temp files
├── ralph.json                  # Project configuration (optional)
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
- **Resume after interruption** — `ralph run` picks up where it left off. In-progress tasks are retried automatically.
- **Cost control** — set `model: "sonnet"` on straightforward tasks. Reserve `opus` for complex work.
- **CLAUDE.md matters** — the execution engine loads your project's `CLAUDE.md` as system prompt context. Keep it current with conventions and patterns so agents follow your standards.
