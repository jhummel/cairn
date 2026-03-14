#!/usr/bin/env bash
# Loads project configuration from ralph.json (if present).
# Expects RALPH_PROJECT_ROOT to be set before sourcing.

_ralph_load_config() {
    local config_file="$RALPH_PROJECT_ROOT/ralph.json"

    if [[ -f "$config_file" ]]; then
        # Parse ralph.json via Python and export shell variables
        eval "$(python3 - "$config_file" <<'PYEOF'
import json, sys, os

with open(sys.argv[1]) as f:
    cfg = json.load(f)

def sh_escape(s):
    return s.replace("'", "'\\''")

def emit(var, val):
    if val:
        print(f"export {var}='{sh_escape(str(val))}'")

emit("RALPH_PROJECT_NAME", cfg.get("projectName", ""))
emit("RALPH_PROJECT_DESC", cfg.get("projectDescription", ""))
emit("RALPH_HEALTH_CHECK", cfg.get("healthCheck", ""))
emit("RALPH_TEST_CMD", cfg.get("defaultTestCommand", ""))
emit("RALPH_IMPL_FILE", cfg.get("implementationFile", ""))
emit("RALPH_CLAUDE_MD_PATTERN", cfg.get("summarize", {}).get("claudeMdPattern", ""))

narration = cfg.get("narration", {})
emit("RALPH_NARRATION_ENABLED", str(narration.get("enabled", False)).lower())
emit("RALPH_NARRATION_VOICE", narration.get("voice", ""))
PYEOF
        )"
    fi

    # Apply defaults for anything not set by config
    : "${RALPH_PROJECT_NAME:=$(basename "$RALPH_PROJECT_ROOT")}"
    : "${RALPH_PROJECT_DESC:=}"
    : "${RALPH_HEALTH_CHECK:=}"
    : "${RALPH_TEST_CMD:=}"
    : "${RALPH_IMPL_FILE:=IMPLEMENTATION.md}"
    : "${RALPH_CLAUDE_MD_PATTERN:=}"
    : "${RALPH_NARRATION_ENABLED:=false}"
    : "${RALPH_NARRATION_VOICE:=bf_emma}"

    export RALPH_PROJECT_NAME RALPH_PROJECT_DESC RALPH_HEALTH_CHECK
    export RALPH_TEST_CMD RALPH_IMPL_FILE RALPH_CLAUDE_MD_PATTERN
    export RALPH_NARRATION_ENABLED RALPH_NARRATION_VOICE

    # Auto-detect health check if not configured
    if [[ -z "$RALPH_HEALTH_CHECK" ]]; then
        _ralph_auto_detect_health_check
    fi
}

_ralph_auto_detect_health_check() {
    # Check for common build systems at project root
    if [[ -f "$RALPH_PROJECT_ROOT/package.json" ]]; then
        if node -e "const p=require('$RALPH_PROJECT_ROOT/package.json'); process.exit(p.scripts?.['type-check'] ? 0 : 1)" 2>/dev/null; then
            export RALPH_HEALTH_CHECK="npm run type-check"
            return
        fi
    fi

    if [[ -f "$RALPH_PROJECT_ROOT/Cargo.toml" ]]; then
        export RALPH_HEALTH_CHECK="cargo check"
        return
    fi

    if [[ -f "$RALPH_PROJECT_ROOT/Makefile" ]] && grep -q '^check:' "$RALPH_PROJECT_ROOT/Makefile" 2>/dev/null; then
        export RALPH_HEALTH_CHECK="make check"
        return
    fi

    # No health check detected — will be skipped
    export RALPH_HEALTH_CHECK=""
}

_ralph_discover_agents() {
    local agents_dir="$RALPH_PROJECT_ROOT/.claude/agents"
    export RALPH_AGENTS_DIR="$agents_dir"

    if [[ ! -d "$agents_dir" ]]; then
        export RALPH_AGENTS_JSON="[]"
        return
    fi

    RALPH_AGENTS_JSON=$(python3 - "$agents_dir" <<'PYEOF'
import json, sys, os, re

agents_dir = sys.argv[1]
agents = []

for fname in sorted(os.listdir(agents_dir)):
    if not fname.endswith('.md'):
        continue
    fpath = os.path.join(agents_dir, fname)
    with open(fpath) as f:
        content = f.read()

    # Parse YAML frontmatter (between --- delimiters)
    meta = {}
    if content.startswith('---'):
        end = content.find('---', 3)
        if end != -1:
            for line in content[3:end].strip().splitlines():
                m = re.match(r'^(\w+)\s*:\s*(.+)$', line)
                if m:
                    meta[m.group(1)] = m.group(2).strip().strip('"').strip("'")

    agents.append({
        'name': meta.get('name', fname[:-3]),
        'description': meta.get('description', ''),
        'model': meta.get('model', ''),
        'file': fname,
    })

print(json.dumps(agents))
PYEOF
    )
    export RALPH_AGENTS_JSON
}

_ralph_load_config
_ralph_discover_agents
