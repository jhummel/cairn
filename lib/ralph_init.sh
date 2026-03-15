#!/usr/bin/env bash
# Initializes .ralph/ directory and optional ralph.json config.
# Sourced by bin/ralph, not executed directly.

TASKS_FILE="$RALPH_DATA_DIR/tasks.json"
CONFIG_FILE="$RALPH_PROJECT_ROOT/ralph.json"

echo ""
echo "Initializing Ralph in: $RALPH_PROJECT_ROOT"
echo ""

# Create .ralph/ data directory
if [[ -d "$RALPH_DATA_DIR" ]]; then
    echo "  .ralph/ directory already exists."
else
    mkdir -p "$RALPH_DATA_DIR"
    echo "  Created: .ralph/"
fi

# Create .gitignore inside .ralph/ for temp files
GITIGNORE="$RALPH_DATA_DIR/.gitignore"
if [[ ! -f "$GITIGNORE" ]]; then
    cat > "$GITIGNORE" <<'EOF'
# Ralph temp files (tasks.json and planning-notes.md are tracked)
.ralph_complete
.ralph_iterations.log
.ralph_prev_notes
.ralph_task_meta
.ralph_completed_ids
EOF
    echo "  Created: .ralph/.gitignore"
fi

# Create empty tasks.json
if [[ -f "$TASKS_FILE" ]]; then
    echo "  tasks.json already exists."
else
    PROJECT_NAME="$(basename "$RALPH_PROJECT_ROOT")"
    cat > "$TASKS_FILE" <<EOF
{
  "project": "$PROJECT_NAME",
  "tasks": []
}
EOF
    echo "  Created: .ralph/tasks.json"
fi

# Scaffold ralph.json config
if [[ -f "$CONFIG_FILE" ]]; then
    echo "  ralph.json already exists."
else
    PROJECT_NAME="$(basename "$RALPH_PROJECT_ROOT")"

    # Ask about narration during initial setup
    echo ""
    read -r -p "  Enable TTS narration? [y/N] " ENABLE_NARRATION
    if [[ "$ENABLE_NARRATION" =~ ^[Yy] ]]; then
        NARRATION_ENABLED="true"
    else
        NARRATION_ENABLED="false"
    fi

    cat > "$CONFIG_FILE" <<EOF
{
  "projectName": "$PROJECT_NAME",
  "projectDescription": "",
  "healthCheck": "",
  "defaultTestCommand": "",
  "implementationFile": "IMPLEMENTATION.md",
  "summarize": {
    "claudeMdPattern": ""
  },
  "narration": {
    "enabled": $NARRATION_ENABLED,
    "ntfyTopic": ""
  }
}
EOF
    echo "  Created: ralph.json (edit to configure)"
fi

# Reload config so RALPH_NARRATION_ENABLED reflects what we just wrote
source "$RALPH_LIB_DIR/ralph_config.sh"

# Offer to install Claude Code narration hooks
if [[ "${RALPH_NARRATION_ENABLED:-false}" == "true" ]]; then
    HOOKS_DIR="$RALPH_PROJECT_ROOT/.claude/hooks"
    if [[ -d "$HOOKS_DIR" && -f "$HOOKS_DIR/narrate.sh" ]]; then
        echo "  Narration hooks already installed."
    else
        echo ""
        echo "Narration is enabled. Install Claude Code hooks for standalone 'claude' usage?"
        echo "  (These forward events to the Ralph narration server at /tmp/ralph-tts.sock)"
        read -r -p "  Install hooks? [y/N] " INSTALL_HOOKS
        if [[ "$INSTALL_HOOKS" =~ ^[Yy] ]]; then
            mkdir -p "$HOOKS_DIR"

            cat > "$HOOKS_DIR/narrate.sh" <<'HOOKEOF'
#!/bin/bash
# PostToolUse hook: narrates what just happened after each tool use
SOCKET="/tmp/ralph-tts.sock"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty')
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty' | head -c 2000)
[ -z "$TOOL_NAME" ] && exit 0

PAYLOAD=$(jq -n --arg name "$TOOL_NAME" --arg input "$TOOL_INPUT" --arg output "$TOOL_OUTPUT" \
  '{tool: $name, input: $input, output: $output}')

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$PAYLOAD" &
exit 0
HOOKEOF
            chmod +x "$HOOKS_DIR/narrate.sh"

            cat > "$HOOKS_DIR/speak.sh" <<'HOOKEOF'
#!/bin/bash
# Stop hook: speaks assistant responses via narration server
SOCKET="/tmp/ralph-tts.sock"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.last_assistant_message // empty')
[ -z "$MESSAGE" ] && exit 0

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$MESSAGE" &
exit 0
HOOKEOF
            chmod +x "$HOOKS_DIR/speak.sh"

            cat > "$HOOKS_DIR/notify.sh" <<'HOOKEOF'
#!/bin/bash
# Notification hook: speaks when Claude needs user attention
SOCKET="/tmp/ralph-tts.sock"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // empty')
[ -z "$MESSAGE" ] && exit 0

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$MESSAGE" &
exit 0
HOOKEOF
            chmod +x "$HOOKS_DIR/notify.sh"

            echo "  Created: .claude/hooks/narrate.sh (PostToolUse)"
            echo "  Created: .claude/hooks/speak.sh (Stop)"
            echo "  Created: .claude/hooks/notify.sh (Notification)"
        fi
    fi
fi

echo ""
echo "Next steps:"
echo "  1. Edit ralph.json to describe your project"
echo "  2. Run 'ralph plan' to start planning"
echo ""
