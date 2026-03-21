#!/usr/bin/env bash
# Initializes .ralph/ directory and ralph.json config with interactive prompts.
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
instructions.md
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

# --- Interactive ralph.json configuration ---

# Load existing values if ralph.json exists (for re-init)
DEFAULT_PROJECT_NAME="$(basename "$RALPH_PROJECT_ROOT")"
DEFAULT_PROJECT_DESC=""
DEFAULT_HEALTH_CHECK=""
DEFAULT_TEST_CMD=""
DEFAULT_IMPL_FILE="IMPLEMENTATION.md"
DEFAULT_TRUNCATE_TEXT="true"
DEFAULT_CLAUDE_MD_PATTERN=""
DEFAULT_NARRATION_ENABLED="false"
DEFAULT_NARRATION_VOICE="bf_emma"
DEFAULT_NTFY_TOPIC=""

if [[ -f "$CONFIG_FILE" ]]; then
    echo ""
    echo "  ralph.json exists — current values shown as defaults."
    eval "$(python3 - "$CONFIG_FILE" <<'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    cfg = json.load(f)

def sh_escape(s):
    return s.replace("'", "'\\''")

def emit(var, val):
    print(f"{var}='{sh_escape(str(val))}'")

emit("DEFAULT_PROJECT_NAME", cfg.get("projectName", ""))
emit("DEFAULT_PROJECT_DESC", cfg.get("projectDescription", ""))
emit("DEFAULT_HEALTH_CHECK", cfg.get("healthCheck", ""))
emit("DEFAULT_TEST_CMD", cfg.get("defaultTestCommand", ""))
emit("DEFAULT_IMPL_FILE", cfg.get("implementationFile", "IMPLEMENTATION.md"))
emit("DEFAULT_TRUNCATE_TEXT", str(cfg.get("truncateText", True)).lower())
emit("DEFAULT_CLAUDE_MD_PATTERN", cfg.get("summarize", {}).get("claudeMdPattern", ""))
emit("DEFAULT_NARRATION_ENABLED", str(cfg.get("narration", {}).get("enabled", False)).lower())
emit("DEFAULT_NARRATION_VOICE", cfg.get("narration", {}).get("voice", "bf_emma"))
emit("DEFAULT_NTFY_TOPIC", cfg.get("narration", {}).get("ntfyTopic", ""))
PYEOF
    )"
fi

echo ""

# Prompt helper: prompt_val VAR "Label" "default"
prompt_val() {
    local _var="$1" _label="$2" _default="$3" _input
    read -r -p "  $_label [$_default]: " _input
    eval "$_var=\"\${_input:-\$_default}\""
}

prompt_val CFG_PROJECT_NAME   "Project name"                              "$DEFAULT_PROJECT_NAME"
prompt_val CFG_PROJECT_DESC   "Description (used in agent system prompts)" "$DEFAULT_PROJECT_DESC"
prompt_val CFG_HEALTH_CHECK   "Health check command (auto-detected if blank)" "$DEFAULT_HEALTH_CHECK"
prompt_val CFG_TEST_CMD       "Default test command"                       "$DEFAULT_TEST_CMD"
prompt_val CFG_IMPL_FILE      "Implementation file"                        "$DEFAULT_IMPL_FILE"

# Truncate text — Y/n boolean
if [[ "$DEFAULT_TRUNCATE_TEXT" == "true" ]]; then
    TRUNCATE_HINT="Y/n"
else
    TRUNCATE_HINT="y/N"
fi
read -r -p "  Truncate agent text output? [$TRUNCATE_HINT]: " TRUNCATE_INPUT
if [[ -z "$TRUNCATE_INPUT" ]]; then
    CFG_TRUNCATE_TEXT="$DEFAULT_TRUNCATE_TEXT"
elif [[ "$TRUNCATE_INPUT" =~ ^[Yy] ]]; then
    CFG_TRUNCATE_TEXT="true"
else
    CFG_TRUNCATE_TEXT="false"
fi

prompt_val CFG_CLAUDE_MD_PATTERN "CLAUDE.md glob pattern for summarize"   "$DEFAULT_CLAUDE_MD_PATTERN"

# Narration — y/N boolean
if [[ "$DEFAULT_NARRATION_ENABLED" == "true" ]]; then
    NARRATION_HINT="Y/n"
else
    NARRATION_HINT="y/N"
fi
read -r -p "  Enable TTS narration? [$NARRATION_HINT]: " NARRATION_INPUT
if [[ -z "$NARRATION_INPUT" ]]; then
    CFG_NARRATION_ENABLED="$DEFAULT_NARRATION_ENABLED"
elif [[ "$NARRATION_INPUT" =~ ^[Yy] ]]; then
    CFG_NARRATION_ENABLED="true"
else
    CFG_NARRATION_ENABLED="false"
fi

# Conditional narration sub-prompts
CFG_NARRATION_VOICE="$DEFAULT_NARRATION_VOICE"
CFG_NTFY_TOPIC="$DEFAULT_NTFY_TOPIC"
if [[ "$CFG_NARRATION_ENABLED" == "true" ]]; then
    prompt_val CFG_NARRATION_VOICE "Narration voice" "$DEFAULT_NARRATION_VOICE"
    prompt_val CFG_NTFY_TOPIC      "ntfy push notification topic" "$DEFAULT_NTFY_TOPIC"
fi

# Write ralph.json via Python for proper JSON formatting
python3 - "$CONFIG_FILE" \
    "$CFG_PROJECT_NAME" \
    "$CFG_PROJECT_DESC" \
    "$CFG_HEALTH_CHECK" \
    "$CFG_TEST_CMD" \
    "$CFG_IMPL_FILE" \
    "$CFG_TRUNCATE_TEXT" \
    "$CFG_CLAUDE_MD_PATTERN" \
    "$CFG_NARRATION_ENABLED" \
    "$CFG_NARRATION_VOICE" \
    "$CFG_NTFY_TOPIC" \
    <<'PYEOF'
import json, sys

args = sys.argv[1:]
config = {
    "projectName": args[1],
    "projectDescription": args[2],
    "healthCheck": args[3],
    "defaultTestCommand": args[4],
    "implementationFile": args[5],
    "truncateText": args[6] == "true",
    "summarize": {
        "claudeMdPattern": args[7]
    },
    "narration": {
        "enabled": args[8] == "true",
        "voice": args[9],
        "ntfyTopic": args[10]
    }
}

with open(args[0], 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
PYEOF

echo ""
echo "  Wrote: ralph.json"

# Offer to create .ralph/instructions.md for personal agent preferences
INSTRUCTIONS_FILE="$RALPH_DATA_DIR/instructions.md"
read -r -p "  Create .ralph/instructions.md for personal agent preferences? [y/N] " INSTRUCTIONS_INPUT
if [[ "$INSTRUCTIONS_INPUT" =~ ^[Yy] ]]; then
    touch "$INSTRUCTIONS_FILE"
    echo "  Created: .ralph/instructions.md"
    # Ensure instructions.md is in .gitignore (for existing projects where gitignore already existed)
    grep -qxF 'instructions.md' "$GITIGNORE" || echo 'instructions.md' >> "$GITIGNORE"
    ${EDITOR:-vi} "$INSTRUCTIONS_FILE"
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
echo "  1. Run 'ralph plan' to start planning"
echo ""
