#!/usr/bin/env bash
set -euo pipefail

# Updates IMPLEMENTATION.md at the project root after a task list completes.
# Called via: ralph summarize

source "$RALPH_LIB_DIR/ralph_common.sh"

IMPLEMENTATION_FILE="$RALPH_PROJECT_ROOT/$RALPH_IMPL_FILE"
COMPLETED_FILE="$RALPH_DATA_DIR/tasks.completed.json"
FILTER="$RALPH_LIB_DIR/ralph_stream_filter.py"

echo ""
echo "========================================="
echo "Updating $RALPH_IMPL_FILE"
echo "========================================="
echo ""

# Build context about what triggered this update
CONTEXT="Updating from the central task list."
if [[ -f "$COMPLETED_FILE" ]]; then
    REL_COMPLETED="$(rel_path_from "$RALPH_PROJECT_ROOT" "$COMPLETED_FILE")"
    CONTEXT="$CONTEXT Completed tasks are in $REL_COMPLETED."
fi

EXISTING_NOTE=""
if [[ -f "$IMPLEMENTATION_FILE" ]]; then
    EXISTING_NOTE="An existing $RALPH_IMPL_FILE is present — update it in place rather than starting from scratch."
else
    EXISTING_NOTE="No existing $RALPH_IMPL_FILE — create it from scratch."
fi

# Build CLAUDE.md pruning instructions based on config
CLAUDE_MD_PRUNING=""
if [[ -n "$RALPH_CLAUDE_MD_PATTERN" ]]; then
    CLAUDE_MD_PRUNING="
CLAUDE.MD PRUNING:
After updating $RALPH_IMPL_FILE, review each module's CLAUDE.md file ($RALPH_CLAUDE_MD_PATTERN).
Worker agents append operational notes during task execution, and these accumulate over time.
For each CLAUDE.md:
- Remove entries that are no longer accurate (e.g., a workaround for a bug that's since been fixed)
- Deduplicate entries that say the same thing in different words
- Keep it strictly operational: build commands, config quirks, gotchas
- Remove any status updates, progress notes, or task history that crept in
Do NOT remove entries you're unsure about — when in doubt, keep them."
else
    CLAUDE_MD_PRUNING="
CLAUDE.MD PRUNING:
After updating $RALPH_IMPL_FILE, look for any module-level or service-level CLAUDE.md files in the project.
If you find any, review them for accumulated noise from worker agents:
- Remove entries that are no longer accurate
- Deduplicate entries that say the same thing in different words
- Keep it strictly operational: build commands, config quirks, gotchas
- Remove any status updates, progress notes, or task history that crept in
Do NOT remove entries you're unsure about — when in doubt, keep them."
fi

SYSTEM_PROMPT="You are updating $RALPH_IMPL_FILE — a high-level architecture and implementation summary for the ${RALPH_PROJECT_NAME} project.

PURPOSE:
This document helps a returning developer (who may have been away for weeks) quickly understand:
- What the system does and how it works end-to-end
- How the components communicate
- What each module is responsible for
- Key data models and their relationships
- What's currently implemented vs what's planned/placeholder
- Important design decisions and patterns
- How to think about the system when making changes

AUDIENCE:
- A human developer returning after time away
- Future Claude sessions (to reduce exploration token cost)

TRIGGER: $CONTEXT
$EXISTING_NOTE

YOUR TASK:
1. Read the existing $RALPH_IMPL_FILE if it exists (at the project root)
2. Read CLAUDE.md for conventions and architecture patterns
3. Explore each module's key files to understand current state:
   - Build configuration (package.json, Cargo.toml, etc.)
   - API/route definitions (what endpoints/interfaces exist)
   - Types and data models
   - Core business logic
   - tasks.completed.json (what was built, in what order)
4. Write an updated $RALPH_IMPL_FILE that covers the entire system

STRUCTURE (suggested — adapt as the project evolves):
- System Overview (1-2 paragraphs: what is this, who uses it)
- Architecture (component topology, communication patterns, request flow)
- Components (per-component section: purpose, key interfaces, data model)
- Data Layer (database schema overview, cache usage)
- Cross-Cutting Concerns (auth, validation, error handling, tracing)
- Current State (what's built, what's planned/placeholder)
- Key Design Decisions (non-obvious choices and why)
$CLAUDE_MD_PRUNING

RULES:
- Be concise but complete — aim for a document someone can read in 5-10 minutes
- Focus on HOW things work, not just WHAT exists
- Include specific details (endpoint paths, field names) when they aid understanding
- Don't duplicate CLAUDE.md content (reference it instead for coding conventions)
- Update existing sections rather than appending — the document should always reflect current state
- Write to $RALPH_IMPL_FILE and prune CLAUDE.md files — do not modify any other files
- Do not include a table of contents
- Use subagents to read files in parallel — be efficient with tokens"

# Detect timeout command
if command -v timeout &>/dev/null; then
    TIMEOUT_CMD="timeout"
elif command -v gtimeout &>/dev/null; then
    TIMEOUT_CMD="gtimeout"
else
    TIMEOUT_CMD=""
fi

TIMEOUT_SECS=900  # 15 minutes should be plenty

cd "$RALPH_PROJECT_ROOT"

PROMPT="Update $RALPH_IMPL_FILE with the current state of the entire system. Read the codebase thoroughly and write a comprehensive but concise summary."

if [[ -n "$TIMEOUT_CMD" ]]; then
    printf '%s' "$PROMPT" \
        | ANTHROPIC_API_KEY= "$TIMEOUT_CMD" "$TIMEOUT_SECS" claude -p \
            --append-system-prompt "$SYSTEM_PROMPT" \
            --dangerously-skip-permissions \
            --output-format stream-json \
            --model sonnet \
            --verbose \
        | python3 "$FILTER"
else
    printf '%s' "$PROMPT" \
        | ANTHROPIC_API_KEY= claude -p \
            --append-system-prompt "$SYSTEM_PROMPT" \
            --dangerously-skip-permissions \
            --output-format stream-json \
            --model sonnet \
            --verbose \
        | python3 "$FILTER"
fi

echo ""
if [[ -f "$IMPLEMENTATION_FILE" ]]; then
    LINES=$(wc -l < "$IMPLEMENTATION_FILE" | tr -d ' ')
    echo "$RALPH_IMPL_FILE updated ($LINES lines)"
else
    echo "$RALPH_IMPL_FILE was not created"
fi
