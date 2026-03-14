#!/usr/bin/env bash
set -euo pipefail

source "$RALPH_LIB_DIR/ralph_common.sh"

TASKS_FILE="$RALPH_DATA_DIR/tasks.json"
TASKS_SCHEMA="$RALPH_LIB_DIR/tasks.schema.json"
PLANNING_NOTES="$RALPH_DATA_DIR/planning-notes.md"
COMPLETED_FILE="$RALPH_DATA_DIR/tasks.completed.json"

# Compute relative path from project root to IMPLEMENTATION.md
IMPLEMENTATION_FILE="$RALPH_PROJECT_ROOT/$RALPH_IMPL_FILE"
IMPLEMENTATION_REL="$(rel_path_from "$RALPH_PROJECT_ROOT" "$IMPLEMENTATION_FILE")"

# ── Phase 1: Pre-flight ─────────────────────────────────────────────

echo ""
echo "========================================="
echo "Ralph Task Planner"
echo "Project: $(basename "$RALPH_PROJECT_ROOT")"
echo "========================================="
echo ""

if [[ -f "$PLANNING_NOTES" ]]; then
    echo "  Previous planning notes found."
fi

if [[ -f "$COMPLETED_FILE" ]]; then
    python3 - "$COMPLETED_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
tasks = data.get('tasks', [])
if tasks:
    print(f'  Previously completed: {len(tasks)} task(s)')
PYEOF
fi

if [[ -f "$TASKS_FILE" ]]; then
    echo "  Existing tasks.json:"
    echo ""
    python3 - "$TASKS_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
tasks = data.get('tasks', [])
counts = {}
for t in tasks:
    s = t['status']
    counts[s] = counts.get(s, 0) + 1
parts = [f'{v} {k}' for k, v in sorted(counts.items())]
print(f'  Status: {", ".join(parts)} ({len(tasks)} total)')
print()
for t in tasks:
    dep_str = f' (depends on: {t["dependencies"]})' if t.get('dependencies') else ''
    dir_str = f' [{t["directory"]}]' if t.get('directory') else ''
    status_icon = {'complete': '✓', 'in-progress': '▶', 'pending': '○', 'blocked': '✗'}
    icon = status_icon.get(t['status'], '?')
    print(f'  {icon} #{t["id"]} [P{t["priority"]}]{dir_str} {t["title"]}{dep_str}')
PYEOF
    echo ""
else
    echo "  No existing tasks.json — starting fresh."
    echo ""
fi

# ── Shared: briefing context for both phases ─────────────────────────

BRIEFING="BRIEFING MATERIALS (read these before starting):
- CLAUDE.md and README.md (if they exist at the project root)
- Build configuration files (package.json, Cargo.toml, Makefile, etc.) in relevant modules"

if [[ -f "$PLANNING_NOTES" ]]; then
    BRIEFING="$BRIEFING
- planning-notes.md — notes from the previous planning session. Read this first for context on prior decisions."
fi

if [[ -f "$COMPLETED_FILE" ]]; then
    BRIEFING="$BRIEFING
- tasks.completed.json — archive of completed tasks with agent notes. Skim for context on what's already been built."
fi

if [[ -f "$IMPLEMENTATION_FILE" ]]; then
    BRIEFING="$BRIEFING
- $IMPLEMENTATION_REL — high-level system architecture summary. Read for cross-project context."
fi

# ── Discover available agents ─────────────────────────────────────────
AGENTS_SECTION=""
if [[ "$RALPH_AGENTS_JSON" != "[]" ]]; then
    AGENTS_SECTION=$(python3 - "$RALPH_AGENTS_JSON" <<'PYEOF'
import json, sys

agents = json.loads(sys.argv[1])
if not agents:
    sys.exit(0)

lines = []
for a in agents:
    desc = f" — {a['description']}" if a['description'] else ""
    model = f" (model: {a['model']})" if a['model'] else ""
    lines.append(f"  - {a['name']}{desc}{model}")

print("AVAILABLE SPECIALIST AGENTS (.claude/agents/):")
print('\n'.join(lines))
PYEOF
    )
    BRIEFING="$BRIEFING
- .claude/agents/*.md — specialist agent definitions. Read these to understand what specialized agents are available for task assignment."
fi

# ── Prompts ──────────────────────────────────────────────────────────

PLANNING_PROMPT="You are a planning assistant for the Ralph agentic loop system.

PROJECT: $(basename "$RALPH_PROJECT_ROOT")
PROJECT ROOT: $RALPH_PROJECT_ROOT

$BRIEFING

YOUR ROLE:
Help the user decide WHAT to build next for this project. This is a high-level discussion — you are NOT generating tasks yet. A separate step will handle that after the user reviews your notes. You have access to the entire repository, not just a single service.

WORKFLOW:
1. Read the briefing materials listed above
2. Explore the project codebase (modules, services, infrastructure — whatever applies)
3. If previous planning-notes.md exists, summarize what was discussed last time
4. Have a conversation with the user about what they want to accomplish
5. When the discussion feels complete, write planning-notes.md

PLANNING-NOTES.MD FORMAT:
Write this file in the data directory ($RALPH_DATA_DIR). Structure it as:

## Context
What exists today, relevant background from previous sessions.

## Goals
What the user wants to accomplish in this round.

## Approach
How we'll tackle it — key decisions, patterns to follow, trade-offs considered.

## Rejected Alternatives
What we considered but decided against, and why. (Helps prevent re-litigating in future sessions.)
IMPORTANT: If previous planning-notes.md has a Rejected Alternatives section, carry forward any entries that are still relevant. Only remove entries that are no longer applicable (e.g., the context changed significantly). This section is cumulative across sessions.

## Rough Task Outline
Bullet list of the work, in rough priority order. Not detailed — just enough to show the shape of the plan. Each bullet should be one agent-sized unit of work (~5 min).
IMPORTANT: Each bullet should include a working directory (e.g., 'src/services/auth-service' or 'src/database'). For cross-service work, note which directories are involved.

## Open Questions
Anything unresolved that might affect task generation.

RULES:
- ONLY write to planning-notes.md — do NOT write tasks.json or modify any other files
- Focus on understanding and planning, not implementation details
- Ask clarifying questions rather than making assumptions
- Reference specific files and code you've read to ground the discussion
- If specialist agents are available, consider which tasks would benefit from them and note this in the Rough Task Outline"

if [[ -n "$AGENTS_SECTION" ]]; then
    PLANNING_PROMPT="$PLANNING_PROMPT

$AGENTS_SECTION"
fi

SCHEMA_CONTENT=$(cat "$TASKS_SCHEMA")

TASK_GEN_PROMPT="You are a task generation assistant for the Ralph agentic loop system.

PROJECT: $(basename "$RALPH_PROJECT_ROOT")
PROJECT ROOT: $RALPH_PROJECT_ROOT
TASKS FILE: $TASKS_FILE

The user has already approved a set of planning notes. Your job is to translate those notes into a concrete, executable task list.

YOUR WORKFLOW:
1. Read planning-notes.md — this is the approved plan. Follow it closely.
2. Read the project codebase as needed to fill in implementation details (file paths, function names, test commands)
3. If tasks.json already exists, preserve any tasks with status 'complete' and their metadata
4. Present your proposed task breakdown to the user BEFORE writing tasks.json. Show each task's title, directory, scope, rough description, dependencies, and suggested model (opus/sonnet). Wait for the user to approve or request changes.
5. Once approved, write tasks.json following the schema below.

TASKS.JSON SCHEMA:
$SCHEMA_CONTENT

TASK STRUCTURE:
Each task needs:
- id: unique integer
- priority: integer (lower = higher priority)
- title: short descriptive title
- description: detailed implementation instructions for the worker agent
- directory: relative path from project root to the agent's working directory (e.g., 'src/services/auth-service'). Empty string or omitted means project root.
- scope: 'internal' (stay within the task directory) or 'integration' (may modify files across directories)
- status: 'pending' for new tasks
- files: array of relevant file paths RELATIVE TO THE TASK'S DIRECTORY to point the worker agent to
- dependencies: array of task IDs that must complete first (empty array if none)
- tests: array of test commands to verify the task (run from the task's directory)
- model: 'opus' or 'sonnet' (optional, defaults to 'opus'). Use 'sonnet' for straightforward tasks (add validation, write tests, simple CRUD, config changes). Use 'opus' for complex tasks (architectural decisions, subtle debugging, multi-file refactors).
- agent: (optional) name of a specialist agent from .claude/agents/ to handle this task. Omit for the default generalist agent.

DIRECTORY & SCOPE GUIDELINES:
| Task type | directory | scope | Agent behavior |
|-----------|----------|-------|----------------|
| Module work | src/services/auth-service | internal | cd into module, stay within it |
| DB migration | src/database | internal | cd into database dir, stay within it |
| Cross-module | (empty) | integration | cd to project root, may touch anything |
| Gateway + service | src/services/api-gateway | integration | primary dir is gateway, but can touch others |

RULES:
- NEVER modify tasks with status 'complete' or their metadata (completedAt, completedBy, notes)
- ONLY write to: $TASKS_FILE — do not modify any other files
- Keep task IDs unique and sequential
- The description field should give the worker agent enough context to complete the task independently
- Include specific file paths in the files array so the worker knows where to look
- Each task should be scoped to ~5 minutes of focused agent work
- Link tasks via dependencies when ordering matters
- When specialist agents are available, assign them to tasks that match their expertise. Not every task needs a specialist — use the default generalist for tasks without a clear match."

if [[ -n "$AGENTS_SECTION" ]]; then
    TASK_GEN_PROMPT="$TASK_GEN_PROMPT

$AGENTS_SECTION"
fi

# ── Functions ────────────────────────────────────────────────────────

launch_planning_session() {
    echo "Launching planning discussion..."
    echo "Discuss your goals. Claude will write planning-notes.md when ready."
    echo "Exit the session (Ctrl+C or /exit) when done."
    echo ""

    cd "$RALPH_PROJECT_ROOT"
    claude --append-system-prompt "$PLANNING_PROMPT" \
        --allowedTools "Read,Glob,Grep,Write,Edit"
    cd - > /dev/null
}

launch_task_generation() {
    echo "Launching task generation from planning notes..."
    echo "Claude will propose tasks for your approval, then write tasks.json."
    echo "Exit the session (Ctrl+C or /exit) when done."
    echo ""

    cd "$RALPH_PROJECT_ROOT"
    claude --append-system-prompt "$TASK_GEN_PROMPT" \
        --allowedTools "Read,Glob,Grep,Write,Edit"
    cd - > /dev/null
}

show_planning_notes() {
    if [[ -f "$PLANNING_NOTES" ]]; then
        echo ""
        cat "$PLANNING_NOTES"
        echo ""
    else
        echo "  No planning-notes.md found."
    fi
}

show_tasks_summary() {
    if [[ -f "$TASKS_FILE" ]]; then
        python3 - "$TASKS_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
tasks = data.get('tasks', [])
counts = {}
for t in tasks:
    s = t['status']
    counts[s] = counts.get(s, 0) + 1
parts = [f'{v} {k}' for k, v in sorted(counts.items())]
print(f'  Tasks: {", ".join(parts)} ({len(tasks)} total)')
PYEOF
    else
        echo "  No tasks.json generated."
    fi
}

# Notes review loop — used after every planning session.
# Returns 0 if user chose [g]enerate (proceed to task gen), 1 otherwise (quit or back).
review_notes_loop() {
    local has_back="${1:-false}"

    while true; do
        echo ""
        show_planning_notes

        if [[ "$has_back" == "true" ]]; then
            echo "  [g]enerate - Approve notes and generate tasks.json"
            echo "  [e]dit     - Edit planning-notes.md in \$EDITOR"
            echo "  [p]lan     - Re-enter the planning discussion"
            echo "  [b]ack     - Back to task review (keep current tasks.json)"
            echo "  [q]uit     - Exit (notes saved for later)"
        else
            echo "  [g]enerate - Approve notes and generate tasks.json"
            echo "  [e]dit     - Edit planning-notes.md in \$EDITOR"
            echo "  [p]lan     - Re-enter the planning discussion"
            echo "  [q]uit     - Exit (notes saved for later)"
        fi
        echo ""
        read -r -p "  Choice: " choice

        case "$choice" in
            [gG]|generate)
                if [[ ! -f "$PLANNING_NOTES" ]]; then
                    echo "  No planning-notes.md to generate from. Plan first."
                    continue
                fi
                launch_task_generation
                echo ""
                echo "========================================="
                echo "Task generation complete."
                echo "========================================="
                return 0
                ;;
            [eE]|edit)
                if [[ ! -f "$PLANNING_NOTES" ]]; then
                    echo "  No planning-notes.md to edit."
                    continue
                fi
                ${EDITOR:-vi} "$PLANNING_NOTES"
                ;;
            [pP]|plan)
                launch_planning_session
                echo ""
                echo "========================================="
                echo "Planning discussion complete."
                echo "========================================="
                ;;
            [bB]|back)
                if [[ "$has_back" == "true" ]]; then
                    return 1
                fi
                echo "  Invalid choice."
                ;;
            [qQ]|quit)
                echo ""
                if [[ -f "$PLANNING_NOTES" ]]; then
                    echo "Planning notes saved at: $PLANNING_NOTES"
                    echo "Resume later with: ralph plan"
                fi
                echo "Goodbye!"
                exit 0
                ;;
            *)
                if [[ "$has_back" == "true" ]]; then
                    echo "  Invalid choice. Use g, e, p, b, or q."
                else
                    echo "  Invalid choice. Use g, e, p, or q."
                fi
                ;;
        esac
    done
}

# ── Phase 2: Planning discussion ─────────────────────────────────────

launch_planning_session

# ── Phase 3: Review planning notes ──────────────────────────────────

echo ""
echo "========================================="
echo "Planning discussion complete."
echo "========================================="

review_notes_loop "false"

# ── Phase 4: Task review loop ───────────────────────────────────────

while true; do
    echo ""
    show_tasks_summary

    echo ""
    echo "  [r]un  - Start the execution loop"
    echo "  [e]dit - Edit tasks.json in \$EDITOR"
    echo "  [v]iew - View raw tasks.json"
    echo "  [p]lan - Go back to planning discussion"
    echo "  [q]uit - Exit (tasks saved for later)"
    echo ""
    read -r -p "  Choice: " choice

    case "$choice" in
        [rR]|run)
            if [[ ! -f "$TASKS_FILE" ]]; then
                echo "  No tasks.json to run. Generate tasks first."
                continue
            fi
            echo ""
            echo "Starting execution loop..."
            exec "$RALPH_LIB_DIR/ralph_loop.sh"
            ;;
        [eE]|edit)
            if [[ ! -f "$TASKS_FILE" ]]; then
                echo "  No tasks.json to edit."
                continue
            fi
            ${EDITOR:-vi} "$TASKS_FILE"
            ;;
        [vV]|view)
            if [[ ! -f "$TASKS_FILE" ]]; then
                echo "  No tasks.json to view."
                continue
            fi
            echo ""
            cat "$TASKS_FILE"
            ;;
        [pP]|plan)
            launch_planning_session
            echo ""
            echo "========================================="
            echo "Planning discussion complete."
            echo "========================================="

            # Review notes with [b]ack option to return here
            review_notes_loop "true"
            ;;
        [qQ]|quit)
            echo ""
            if [[ -f "$TASKS_FILE" ]]; then
                echo "Tasks saved at: $TASKS_FILE"
                echo "Run later with: ralph run"
            fi
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo "  Invalid choice. Use r, e, v, p, or q."
            ;;
    esac
done
