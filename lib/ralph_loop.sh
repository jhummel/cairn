#!/usr/bin/env bash
set -euo pipefail

source "$RALPH_LIB_DIR/ralph_common.sh"

MAX_ITERATIONS=${1:-30}

TASKS_FILE="$RALPH_DATA_DIR/tasks.json"

# If no tasks.json, offer to launch the planner
if [[ ! -f "$TASKS_FILE" ]]; then
    echo "No tasks.json found at $TASKS_FILE."
    read -r -p "Launch task planner? [Y/n] " answer
    case "$answer" in
        [nN]|no)
            echo "ERROR: tasks.json not found. Create it first with 'ralph plan'"
            exit 1
            ;;
        *)
            exec "$RALPH_LIB_DIR/ralph_plan.sh"
            ;;
    esac
fi

echo "Running Ralph execution loop"

# Delegate to the execution engine
"$RALPH_LIB_DIR/ralph_execute.sh" "$MAX_ITERATIONS"
