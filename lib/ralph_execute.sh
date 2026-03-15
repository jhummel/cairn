#!/usr/bin/env bash
set -euo pipefail

source "$RALPH_LIB_DIR/ralph_common.sh"

NARRATE_SOCKET="/tmp/ralph-tts.sock"
NARRATE_PID=""
CLAUDE_PID=""

_cleanup() {
    # Kill the running claude pipeline (job PID is the pipeline leader)
    if [[ -n "$CLAUDE_PID" ]]; then
        # Kill the process group if possible, then the process itself
        kill -- -"$CLAUDE_PID" 2>/dev/null || true
        kill "$CLAUDE_PID" 2>/dev/null || true
        # Also kill any child claude processes we spawned
        pkill -P "$CLAUDE_PID" 2>/dev/null || true
        wait "$CLAUDE_PID" 2>/dev/null || true
        CLAUDE_PID=""
    fi
    # Kill narration server if we started it
    if [[ -n "$NARRATE_PID" ]] && kill -0 "$NARRATE_PID" 2>/dev/null; then
        kill "$NARRATE_PID" 2>/dev/null || true
        wait "$NARRATE_PID" 2>/dev/null || true
        NARRATE_PID=""
    fi
}

trap '_cleanup; echo ""; echo "Interrupted."; exit 130' INT TERM HUP

MAX_ITERATIONS=${1:-30}
ITERATION_TIMEOUT=${2:-900}  # seconds per iteration, default 15 minutes

# All paths are absolute — script works from any directory
TASKS_FILE="$RALPH_DATA_DIR/tasks.json"
COMPLETE_FLAG="$RALPH_DATA_DIR/.ralph_complete"
ITERATION_LOG="$RALPH_DATA_DIR/.ralph_iterations.log"
PREV_NOTES_FILE="$RALPH_DATA_DIR/.ralph_prev_notes"
TASK_META_FILE="$RALPH_DATA_DIR/.ralph_task_meta"
COMPLETED_IDS_FILE="$RALPH_DATA_DIR/.ralph_completed_ids"

# Detect timeout command (macOS doesn't ship GNU timeout)
if command -v timeout &>/dev/null; then
    TIMEOUT_CMD="timeout"
elif command -v gtimeout &>/dev/null; then
    TIMEOUT_CMD="gtimeout"
else
    TIMEOUT_CMD=""
fi

echo "Starting Ralph execution loop"
echo "Project root: $RALPH_PROJECT_ROOT"
echo "Tasks file: $TASKS_FILE"
echo "Max iterations: $MAX_ITERATIONS"
if [[ -n "$TIMEOUT_CMD" ]]; then
    echo "Timeout per iteration: ${ITERATION_TIMEOUT}s"
else
    echo "Timeout per iteration: none (install coreutils for timeout support)"
fi
echo ""

if [[ ! -f "$TASKS_FILE" ]]; then
    echo "ERROR: $TASKS_FILE not found. Create it first with 'ralph plan'."
    exit 1
fi

rm -f "$COMPLETE_FLAG" "$PREV_NOTES_FILE" "$TASK_META_FILE"

# Seed completed IDs from archive (so dependencies on archived tasks are satisfied)
python3 -c "
import json, os
archive = os.path.join('$RALPH_DATA_DIR', 'tasks.completed.json')
ids = set()
if os.path.exists(archive):
    with open(archive) as f:
        ids = {t['id'] for t in json.load(f).get('tasks', [])}
with open('$COMPLETED_IDS_FILE', 'w') as f:
    json.dump(sorted(ids), f)
" 2>/dev/null || echo '[]' > "$COMPLETED_IDS_FILE"

echo "Ralph Execution Loop Started: $(date)" > "$ITERATION_LOG"
echo "" >> "$ITERATION_LOG"

# ── Start narration server if enabled ────────────────────────────────
if [[ "${RALPH_NARRATION_ENABLED:-false}" == "true" ]]; then
    # Check if a narration server is already running (e.g. from `ralph narrate on`)
    if [[ -S "$NARRATE_SOCKET" ]]; then
        echo "Using existing narration server (socket: $NARRATE_SOCKET)"
        export RALPH_NARRATE_SOCKET="$NARRATE_SOCKET"
    else
        echo "Starting narration server (voice: ${RALPH_NARRATION_VOICE:-bf_emma})..."
        "$RALPH_NARRATE_PYTHON" "$RALPH_LIB_DIR/ralph_narrate_server.py" \
            --voice "${RALPH_NARRATION_VOICE:-bf_emma}" \
            --socket "$NARRATE_SOCKET" &
        NARRATE_PID=$!
        export RALPH_NARRATE_SOCKET="$NARRATE_SOCKET"
        # Give server a moment to bind the socket
        sleep 1
        if kill -0 "$NARRATE_PID" 2>/dev/null; then
            echo "Narration server started (PID: $NARRATE_PID)"
        else
            echo "⚠ Narration server failed to start — continuing without narration"
            NARRATE_PID=""
            unset RALPH_NARRATE_SOCKET
        fi
    fi
    echo ""
fi

ITERATIONS_RUN=0

# ── build_system_prompt ──────────────────────────────────────────────
# Generates a per-task system prompt based on directory and scope.
# Args: $1 = task_dir_rel (relative path or empty), $2 = task_scope (internal|integration), $3 = task_agent (agent name or empty)
build_system_prompt() {
    local task_dir_rel="${1:-}"
    local task_scope="${2:-internal}"
    local task_agent="${3:-}"
    local dir_label="${task_dir_rel:-project root}"
    local commit_prefix

    if [[ -n "$task_dir_rel" ]]; then
        commit_prefix="$(basename "$task_dir_rel")"
    else
        commit_prefix="$(basename "$RALPH_PROJECT_ROOT")"
    fi

    local scope_instructions
    if [[ "$task_scope" == "integration" ]]; then
        scope_instructions="SCOPE: INTEGRATION
- Your primary working directory is: $dir_label
- You MAY modify files across multiple directories as needed
- Coordinate changes across service boundaries carefully"
    else
        scope_instructions="SCOPE: INTERNAL
- Your working directory is: $dir_label
- Stay within this directory — do NOT modify files in other directories
- If you discover something that requires changes elsewhere, note it as a discovered task"
    fi

    local project_desc=""
    if [[ -n "$RALPH_PROJECT_DESC" ]]; then
        project_desc="
Project description: $RALPH_PROJECT_DESC"
    fi

    local test_instruction="4. Run the tests listed in the task."
    if [[ -n "$RALPH_TEST_CMD" ]]; then
        test_instruction="4. Run the tests listed in the task. If none are listed, run '$RALPH_TEST_CMD' if available."
    fi

    # Load specialist agent instructions if assigned
    local agent_instructions=""
    if [[ -n "$task_agent" ]]; then
        local agent_file="$RALPH_AGENTS_DIR/$task_agent.md"
        if [[ -f "$agent_file" ]]; then
            # Read file, strip YAML frontmatter, use body as instructions
            agent_instructions=$(python3 -c "
import sys
with open('$agent_file') as f:
    content = f.read()
# Strip YAML frontmatter
if content.startswith('---'):
    end = content.find('---', 3)
    if end != -1:
        content = content[end+3:].strip()
print(content)
")
        else
            echo "WARNING: Agent file not found: $agent_file" >&2
        fi
    fi

    cat <<SYSPROMPT
$(if [[ -n "$agent_instructions" ]]; then
echo "SPECIALIST INSTRUCTIONS:
You have been assigned as a specialist agent for this task. Follow these instructions in addition to your standard workflow:

$agent_instructions

---
"
fi)
You are working on the ${RALPH_PROJECT_NAME} project.${project_desc}

$scope_instructions

CONTEXT:
- This is a FRESH agent instance with no memory of previous iterations
- The root CLAUDE.md is already loaded in your system prompt — do NOT re-read it
- If a service-level CLAUDE.md or README.md exists in your working directory, read it before starting work

SUBAGENT STRATEGY:
- Use up to 10 parallel Sonnet subagents for codebase exploration, reading multiple files, and searching. Prefer targeted reads over broad sweeps.
- Use only 1 subagent for builds and tests (backpressure — avoid parallel test runs stomping on each other).
- Use an Opus subagent only when stuck on a genuinely hard problem (debugging a subtle issue, an architectural decision with trade-offs). Most tasks don't need one.

YOUR WORKFLOW:
Your assigned task is provided in the user prompt. Do NOT read tasks.json to find your task — it's already been extracted for you.
1. IMMEDIATELY set the task's status to 'in-progress' in '$TASKS_FILE' before doing any implementation work
2. If the task has files listed, focus on those files. Otherwise explore the codebase to understand it.
3. Implement the task COMPLETELY. No placeholders, no stubs, no TODOs. Incomplete implementations waste an entire future iteration redoing the same work.
$test_instruction
5. Update '$TASKS_FILE' to mark the task complete. Use Edit to set these fields on the task object:
   - status: 'complete'
   - completedAt: Current ISO 8601 timestamp (e.g., '2025-01-25T14:32:15Z')
   - completedBy: 'iteration-N' where N is the iteration number from the prompt
   - notes: Observations, warnings, or suggestions for future iterations
6. If '$TASKS_FILE' has no remaining pending/in-progress tasks, create the file '$COMPLETE_FLAG'
7. Make a focused git commit with message format: '[$commit_prefix] Task #<id>: <title>'

DISCOVER AND DOCUMENT:
- If you discover bugs or missing functionality UNRELATED to your task, add them as new pending tasks in '$TASKS_FILE' (next available ID, low priority). Include a 'directory' field indicating where the work should happen. Max 3 discovered tasks per iteration.
- New tasks need at minimum: id, priority, title, description, directory, scope, status ('pending'), files (array), dependencies (array), tests (array).
- If you learn something operational about a service (config quirk, undocumented dependency), add a brief note to the service CLAUDE.md.
- Keep CLAUDE.md strictly operational (build commands, config quirks, gotchas). No status updates, no progress notes, no task history.

CRITICAL RULES:
- Work on EXACTLY ONE task per iteration — the one assigned in the prompt
- Set status to 'in-progress' BEFORE starting implementation
- Mark the task complete in $TASKS_FILE BEFORE creating $COMPLETE_FLAG
- Be thorough with notes — help the next agent understand what you did
- Keep responses concise. Use Edit for surgical changes — do NOT Write entire large files in one shot.
SYSPROMPT
}

FILTER="$RALPH_LIB_DIR/ralph_stream_filter.py"

# Carry forward notes from a previous run (if resuming after interruption)
PREV_NOTES=""
if [[ -f "$PREV_NOTES_FILE" ]]; then
    PREV_NOTES=$(cat "$PREV_NOTES_FILE")
fi

for i in $(seq 1 "$MAX_ITERATIONS"); do
  ITERATIONS_RUN=$i
  echo ""
  echo "--- ITERATION $i/$MAX_ITERATIONS ---"

  echo "Iteration $i started: $(date)" >> "$ITERATION_LOG"

  # Exit if completion flag exists
  if [[ -f "$COMPLETE_FLAG" ]]; then
    echo "✓ Completion flag found. All tasks complete!"
    echo "Iteration $i: COMPLETION FLAG FOUND" >> "$ITERATION_LOG"
    break
  fi

  # Check if tasks file still exists
  if [[ ! -f "$TASKS_FILE" ]]; then
    echo "ERROR: $TASKS_FILE disappeared. Stopping."
    echo "Iteration $i: ERROR - tasks file missing" >> "$ITERATION_LOG"
    exit 1
  fi

  # ── Extract next task and build iteration prompt ──────────────────
  # One python call: finds the task, extracts model + directory + scope, builds the prompt.

  PROMPT_FILE=$(mktemp)
  TASK_MODEL=$(python3 - "$TASKS_FILE" "$PROMPT_FILE" "$TASK_META_FILE" "$i" "$MAX_ITERATIONS" "$PREV_NOTES" <<'PYEOF'
import json, sys, os

tasks_file = sys.argv[1]
prompt_file = sys.argv[2]
meta_file = sys.argv[3]
iteration = sys.argv[4]
max_iterations = sys.argv[5]
prev_notes = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] else ""

try:
    with open(tasks_file) as f:
        data = json.load(f)
except (json.JSONDecodeError, FileNotFoundError) as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)

tasks = data.get('tasks', [])
complete_ids = {t['id'] for t in tasks if t['status'] == 'complete'}

# Include archived task IDs (lightweight — just an array of ints)
ids_file = os.path.join(os.path.dirname(tasks_file) or '.', '.ralph_completed_ids')
if os.path.exists(ids_file):
    with open(ids_file) as f:
        complete_ids |= set(json.load(f))

# In-progress first (previous iteration may have started but not finished)
chosen = None
for t in tasks:
    if t['status'] == 'in-progress':
        chosen = t
        break

# Highest priority pending with satisfied deps
if not chosen:
    pending = [t for t in tasks if t['status'] == 'pending']
    pending.sort(key=lambda t: t['priority'])
    for t in pending:
        deps = t.get('dependencies', [])
        if all(d in complete_ids for d in deps):
            chosen = t
            break

if not chosen:
    with open(prompt_file, 'w') as f:
        f.write("")
    with open(meta_file, 'w') as f:
        json.dump({}, f)
    print("none")
    sys.exit(0)

remaining = len([t for t in tasks if t['status'] in ('pending', 'in-progress')])

# Build the iteration prompt with full task context
lines = [f"Iteration {iteration} of {max_iterations}.", ""]
lines.append(f"YOUR ASSIGNED TASK (#{chosen['id']}):")
lines.append(f"  Title: {chosen['title']}")
if chosen.get('description'):
    lines.append(f"  Description: {chosen['description']}")
if chosen.get('directory'):
    lines.append(f"  Directory: {chosen['directory']}")
if chosen.get('scope'):
    lines.append(f"  Scope: {chosen['scope']}")
if chosen.get('files'):
    lines.append(f"  Files: {', '.join(chosen['files'])}")
if chosen.get('tests'):
    lines.append(f"  Tests: {', '.join(chosen['tests'])}")

if chosen['status'] == 'in-progress':
    lines.append("")
    lines.append("NOTE: This task was started by a previous iteration but not completed.")
    lines.append("Check the actual code state before continuing — it may be partially done.")

if prev_notes:
    lines.append("")
    lines.append(f"FROM PREVIOUS ITERATION: {prev_notes}")

lines.append("")
lines.append(f"Remaining tasks after this one: {remaining - 1}")
lines.append("")
lines.append("Begin work.")

with open(prompt_file, 'w') as f:
    f.write('\n'.join(lines))

with open(meta_file, 'w') as f:
    json.dump({
        'id': chosen['id'],
        'title': chosen.get('title', ''),
        'tests': chosen.get('tests', []),
        'directory': chosen.get('directory', ''),
        'scope': chosen.get('scope', 'internal'),
        'agent': chosen.get('agent', ''),
    }, f)

print(chosen.get('model', 'opus'))
PYEOF
  )

  if [[ $? -ne 0 ]]; then
    echo "ERROR: Failed to parse $TASKS_FILE. Fix the JSON and retry."
    echo "Iteration $i: ERROR - invalid tasks.json" >> "$ITERATION_LOG"
    rm -f "$PROMPT_FILE"
    exit 1
  fi

  if [[ "$TASK_MODEL" == "none" ]]; then
    echo "✓ No actionable tasks remain. Creating completion flag."
    touch "$COMPLETE_FLAG"
    echo "Iteration $i: ALL TASKS COMPLETE" >> "$ITERATION_LOG"
    rm -f "$PROMPT_FILE"
    break
  fi

  ITER_PROMPT=$(cat "$PROMPT_FILE")
  rm -f "$PROMPT_FILE"

  # Read task meta for directory/scope
  TASK_DIR_REL=$(python3 -c "import json; m=json.load(open('$TASK_META_FILE')); print(m.get('directory',''))")
  TASK_SCOPE=$(python3 -c "import json; m=json.load(open('$TASK_META_FILE')); print(m.get('scope','internal'))")
  TASK_AGENT=$(python3 -c "import json; m=json.load(open('$TASK_META_FILE')); print(m.get('agent',''))")
  TASK_TITLE=$(python3 -c "import json; m=json.load(open('$TASK_META_FILE')); print(m.get('title',''))")
  TASK_DIR_ABS=$(resolve_task_dir "$TASK_DIR_REL")
  export RALPH_TASK_CONTEXT="$TASK_TITLE"

  echo "Model: $TASK_MODEL"
  echo "Directory: ${TASK_DIR_REL:-<project root>}"
  echo "Scope: $TASK_SCOPE"
  if [[ -n "$TASK_AGENT" ]]; then
      echo "Agent: $TASK_AGENT"
  fi

  # If agent specifies a model and task didn't explicitly set one, use the agent's model
  if [[ -n "$TASK_AGENT" && "$TASK_MODEL" == "opus" ]]; then
      AGENT_MODEL=$(python3 -c "
import json, os, re, sys
agent_file = os.path.join('$RALPH_AGENTS_DIR', '$TASK_AGENT.md')
if not os.path.exists(agent_file):
    sys.exit(0)
with open(agent_file) as f:
    content = f.read()
if not content.startswith('---'):
    sys.exit(0)
end = content.find('---', 3)
if end == -1:
    sys.exit(0)
for line in content[3:end].strip().splitlines():
    m = re.match(r'^model\s*:\s*(.+)$', line)
    if m:
        print(m.group(1).strip().strip('\"').strip(\"'\"))
        break
" 2>/dev/null || true)
      if [[ -n "$AGENT_MODEL" ]]; then
          TASK_MODEL="$AGENT_MODEL"
          echo "  (model overridden by agent: $TASK_MODEL)"
      fi
  fi

  # Build per-task system prompt
  SYSTEM_PROMPT=$(build_system_prompt "$TASK_DIR_REL" "$TASK_SCOPE" "$TASK_AGENT")

  # ── cd into the task directory (create if needed for new services) ──
  mkdir -p "$TASK_DIR_ABS"
  pushd "$TASK_DIR_ABS" > /dev/null

  # ── Pre-iteration health check ──────────────────────────────────
  if [[ -z "$RALPH_HEALTH_CHECK" ]]; then
      echo "  Health check: skipped (not configured)"
  else
      # For auto-detected checks, verify the task directory supports them
      SHOULD_RUN=true
      if [[ "$RALPH_HEALTH_CHECK" == "npm run type-check" ]]; then
          # Only run npm health check if this directory has package.json with type-check
          if [[ ! -f "package.json" ]]; then
              SHOULD_RUN=false
              echo "  Health check: skipped (no package.json)"
          elif ! node -e "const p=require('./package.json'); process.exit(p.scripts?.['type-check'] ? 0 : 1)" 2>/dev/null; then
              SHOULD_RUN=false
              echo "  Health check: skipped (no type-check script)"
          fi
      fi

      if [[ "$SHOULD_RUN" == "true" ]]; then
          if eval "$RALPH_HEALTH_CHECK" >/dev/null 2>&1; then
              echo "  Health check: OK"
          else
              HEALTH_OUTPUT=$(eval "$RALPH_HEALTH_CHECK" 2>&1 || true)
              HEALTH_OUTPUT=$(echo "$HEALTH_OUTPUT" | tail -30)
              echo "  ⚠ Health check: errors detected"
              ITER_PROMPT="BUILD HEALTH CHECK FAILED:
The codebase has errors. Review and fix these as part of your work if they're related to your task. If they're unrelated, note them in tasks.json as a new discovered task.

Errors (last 30 lines):
$HEALTH_OUTPUT

---

$ITER_PROMPT"
          fi
      fi
  fi

  # ── Run the agent from the task directory ──────────────────────
  run_claude() {
      # Unset ANTHROPIC_API_KEY for claude CLI so it uses the Max plan.
      # The narration server (already running) retains its own copy.
      if [[ -n "$TIMEOUT_CMD" ]]; then
          printf '%s' "$ITER_PROMPT" \
              | ANTHROPIC_API_KEY= "$TIMEOUT_CMD" "$ITERATION_TIMEOUT" claude -p \
                  --append-system-prompt "$SYSTEM_PROMPT" \
                  --dangerously-skip-permissions \
                  --output-format stream-json \
                  --model "$TASK_MODEL" \
                  --verbose \
              | python3 "$FILTER" &
      else
          printf '%s' "$ITER_PROMPT" \
              | ANTHROPIC_API_KEY= claude -p \
                  --append-system-prompt "$SYSTEM_PROMPT" \
                  --dangerously-skip-permissions \
                  --output-format stream-json \
                  --model "$TASK_MODEL" \
                  --verbose \
              | python3 "$FILTER" &
      fi
      CLAUDE_PID=$!
      wait "$CLAUDE_PID"
      local rc=$?
      CLAUDE_PID=""
      return $rc
  }

  if run_claude; then
      echo "✓ Iteration $i completed successfully"
      echo "Iteration $i completed: $(date) - SUCCESS" >> "$ITERATION_LOG"
  else
      EXIT_CODE=$?
      if [[ $EXIT_CODE -eq 124 ]]; then
          echo "⚠ Iteration $i timed out after ${ITERATION_TIMEOUT}s"
          echo "Iteration $i completed: $(date) - TIMEOUT" >> "$ITERATION_LOG"
      else
          echo "⚠ Iteration $i encountered errors (exit code: $EXIT_CODE)"
          echo "Iteration $i completed: $(date) - FAILED (exit code: $EXIT_CODE)" >> "$ITERATION_LOG"
      fi
  fi

  popd > /dev/null

  # ── Post-iteration test validation ────────────────────────────────
  # If the agent marked the task complete, verify by running its tests.
  # Tests run from the task's directory.
  if [[ -f "$TASK_META_FILE" && -f "$TASKS_FILE" ]]; then
      python3 - "$TASKS_FILE" "$TASK_META_FILE" "$TASK_DIR_ABS" <<'PYEOF'
import json, sys, subprocess, os

tasks_path = sys.argv[1]
meta_path = sys.argv[2]
test_dir = sys.argv[3]

with open(meta_path) as f:
    meta = json.load(f)

task_id = meta.get('id')
test_cmds = meta.get('tests', [])

if not task_id or not test_cmds:
    sys.exit(0)

# Check if the task was marked complete
with open(tasks_path) as f:
    data = json.load(f)

task = next((t for t in data['tasks'] if t['id'] == task_id), None)
if not task or task['status'] != 'complete':
    sys.exit(0)

# Run each test command from the task's directory
print(f"  Validating task #{task_id} tests...")
test_failed = False   # tests ran but had failures (agent's fault)
test_errored = False  # tests couldn't run at all (infra issue)
for cmd in test_cmds:
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, timeout=120, cwd=test_dir)
        if result.returncode != 0:
            stderr = result.stderr.decode() if result.stderr else ""
            # Distinguish "can't run" from "ran and failed"
            cant_run = any(s in stderr.lower() for s in [
                "missing script", "not found", "no such file",
                "enoent", "cannot find module", "module not found",
            ])
            if cant_run:
                print(f"  ⚠ SKIPPED (can't run): {cmd}")
                test_errored = True
            else:
                print(f"  ✗ FAILED: {cmd}")
                if stderr:
                    print(f"    {stderr[-200:]}")
                test_failed = True
            break
    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"  ⚠ SKIPPED (error): {cmd} ({e})")
        test_errored = True
        break

if test_failed:
    # Tests ran but failed — revert so next iteration retries
    print(f"  ⚠ Tests failed — reverting task #{task_id} to in-progress")
    task['status'] = 'in-progress'
    if task.get('notes'):
        task['notes'] += ' | Post-iteration test validation failed — reverted to in-progress.'
    else:
        task['notes'] = 'Post-iteration test validation failed — reverted to in-progress.'
    task.pop('completedAt', None)
    task.pop('completedBy', None)
    with open(tasks_path, 'w') as f:
        json.dump(data, f, indent=2)
elif test_errored:
    # Tests couldn't run — note it but don't revert
    print(f"  ⚠ Tests could not run for task #{task_id} (infrastructure issue — not reverting)")
    if task.get('notes'):
        task['notes'] += ' | Post-iteration: test commands could not execute (missing deps/scripts).'
    else:
        task['notes'] = 'Post-iteration: test commands could not execute (missing deps/scripts).'
    with open(tasks_path, 'w') as f:
        json.dump(data, f, indent=2)
else:
    print(f"  ✓ All tests passed for task #{task_id}")
PYEOF
  fi

  # Archive completed tasks and capture notes for next iteration
  PREV_NOTES=""
  if [[ -f "$TASKS_FILE" ]]; then
      python3 - "$TASKS_FILE" "$PREV_NOTES_FILE" "$RALPH_DATA_DIR" <<'PYEOF'
import json, sys, os

tasks_path = sys.argv[1]
notes_path = sys.argv[2]
data_dir = sys.argv[3]

with open(tasks_path) as f:
    data = json.load(f)

completed = [t for t in data["tasks"] if t["status"] == "complete"]
remaining = [t for t in data["tasks"] if t["status"] != "complete"]

if not completed:
    sys.exit(0)

# Append completed IDs to the lightweight IDs file
ids_file = os.path.join(data_dir, '.ralph_completed_ids')
existing_ids = set()
if os.path.exists(ids_file):
    with open(ids_file) as f:
        existing_ids = set(json.load(f))
existing_ids |= {t['id'] for t in completed}
with open(ids_file, 'w') as f:
    json.dump(sorted(existing_ids), f)

# Save the last completed task's notes for the next iteration
last_notes = completed[-1].get("notes", "")
if last_notes:
    with open(notes_path, "w") as f:
        f.write(last_notes)
elif os.path.exists(notes_path):
    os.remove(notes_path)

# Append to archive
archive_path = os.path.join(data_dir, "tasks.completed.json")
if os.path.exists(archive_path):
    with open(archive_path) as f:
        archive = json.load(f)
else:
    archive = {"tasks": []}

archive["tasks"].extend(completed)
with open(archive_path, "w") as f:
    json.dump(archive, f, indent=2)

# Keep only non-complete tasks
data["tasks"] = remaining
with open(tasks_path, "w") as f:
    json.dump(data, f, indent=2)

print(f"  Archived {len(completed)} completed task(s)")
PYEOF

      # Pick up notes for next iteration
      if [[ -f "$PREV_NOTES_FILE" ]]; then
          PREV_NOTES=$(cat "$PREV_NOTES_FILE")
      fi
  fi
done

# Stop narration server if we started it
_cleanup

# Final summary
echo ""
echo "========================================="
echo "Ralph Execution Loop Completed"
echo "========================================="
echo "Total iterations run: $ITERATIONS_RUN"
echo ""

if [[ -f "$COMPLETE_FLAG" ]]; then
    echo "✓ Status: ALL TASKS COMPLETE"
    # Send ntfy notification for loop completion
    if [[ -n "${RALPH_NTFY_TOPIC:-}" ]]; then
        python3 -c "
import urllib.request
req = urllib.request.Request(
    'https://ntfy.sh/${RALPH_NTFY_TOPIC}',
    data=b'All tasks complete after $ITERATIONS_RUN iterations',
    headers={'Title': 'Ralph - Complete', 'Tags': 'tada', 'Priority': '4'},
)
try: urllib.request.urlopen(req, timeout=5)
except: pass
" 2>/dev/null &
    fi
else
    echo "⚠ Status: INCOMPLETE (reached max iterations or errors)"
    echo ""
    echo "Remaining tasks can be found in $TASKS_FILE"
    # Send ntfy notification for incomplete loop
    if [[ -n "${RALPH_NTFY_TOPIC:-}" ]]; then
        python3 -c "
import urllib.request
req = urllib.request.Request(
    'https://ntfy.sh/${RALPH_NTFY_TOPIC}',
    data=b'Loop stopped after $ITERATIONS_RUN iterations — tasks remaining',
    headers={'Title': 'Ralph - Stopped', 'Tags': 'warning', 'Priority': '4'},
)
try: urllib.request.urlopen(req, timeout=5)
except: pass
" 2>/dev/null &
    fi
fi

# Clean up temp files
rm -f "$PREV_NOTES_FILE" "$TASK_META_FILE" "$COMPLETED_IDS_FILE"

echo ""
echo "Full log available in: $ITERATION_LOG"
echo ""
