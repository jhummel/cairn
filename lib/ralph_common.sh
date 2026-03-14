#!/usr/bin/env bash
# Shared utilities for ralph scripts. Source this, don't execute it.
#
# Expects these env vars to be set by bin/ralph before sourcing:
#   RALPH_PROJECT_ROOT  — absolute path to project root
#   RALPH_DATA_DIR      — absolute path to .ralph/ data directory
#   RALPH_LIB_DIR       — absolute path to lib/ directory

if [[ -z "${RALPH_PROJECT_ROOT:-}" || -z "${RALPH_DATA_DIR:-}" || -z "${RALPH_LIB_DIR:-}" ]]; then
    echo "ERROR: Ralph lib scripts should not be invoked directly." >&2
    echo "Use the 'ralph' command instead (e.g., 'ralph plan', 'ralph run')." >&2
    exit 1
fi

# resolve_task_dir <relative_dir>
# Resolves a task's relative directory to an absolute path.
# Defaults to RALPH_PROJECT_ROOT if the argument is empty.
resolve_task_dir() {
    local rel="${1:-}"
    if [[ -z "$rel" ]]; then
        echo "$RALPH_PROJECT_ROOT"
    elif [[ "$rel" = /* ]]; then
        echo "$rel"
    else
        echo "$RALPH_PROJECT_ROOT/$rel"
    fi
}

# rel_path_from <from> <to>
# Returns the relative path from one directory to another.
rel_path_from() {
    python3 -c "import os, sys; print(os.path.relpath(sys.argv[2], sys.argv[1]))" "$1" "$2"
}
