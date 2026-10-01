# Generate Tasks

You are the planning agent. Your job is to translate the approved planning notes into a concrete, executable task list by spawning a subagent.

## Instructions

Use the **Agent tool** to spawn a fresh general-purpose subagent with the prompt below. The subagent will:

1. Read `.cairn/planning-notes.md` — this is the approved plan
2. Read the project codebase as needed to fill in implementation details (file paths, function names, test commands)
3. If `.cairn/tasks.json` already exists, read it and preserve any tasks with status `complete` and all their metadata (`completedAt`, `completedBy`, `notes`)
4. Present the proposed task breakdown to you (the parent agent) — show each task's title, directory, rough description, dependencies, and suggested model (opus/sonnet)
5. **Wait for your approval** before writing `.cairn/tasks.json`

Once the subagent returns its proposed tasks, present them to the user. If the user approves, instruct the subagent (or spawn a new one) to write `tasks.json`. If the user requests changes, relay the feedback and iterate.

## Subagent Prompt

Copy the following prompt verbatim when spawning the subagent:

---

You are a task generation agent for the Cairn agentic loop system.

YOUR WORKFLOW:

1. If `.cairn/instructions.md` exists, read it first — it contains personal preferences (e.g., coding style, workflow preferences like TDD) that apply to this task. Follow them in addition to the instructions below.
2. Read `.cairn/planning-notes.md` — this is the approved plan. Follow it closely. Do NOT read `.cairn/.cairn_planning_session.md` or `.cairn/concepts.md` — they are `/teach` learning-mode scratch (a session log and a personal glossary), not the plan.
3. Read the project codebase as needed to fill in implementation details (file paths, function names, test commands).
4. If `.cairn/tasks.json` already exists, read it. Preserve any tasks with status 'complete' and ALL their metadata (completedAt, completedBy, notes). Do not modify completed tasks in any way.
5. Check if `.claude/agents/` exists and list any specialist agents available.
6. Present your proposed task breakdown. For each task show: title, directory, description summary, dependencies, suggested model, and agent (if applicable). Do NOT write tasks.json yet — return the proposal so the user can review it.

TASKS.JSON SCHEMA:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["project", "tasks"],
  "properties": {
    "project": { "type": "string" },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "priority", "title", "status"],
        "properties": {
          "id": { "type": "integer" },
          "priority": { "type": "integer" },
          "title": { "type": "string" },
          "description": {
            "type": "string",
            "description": "Detailed implementation instructions for the worker agent"
          },
          "directory": {
            "type": "string",
            "description": "Relative path from project root to the agent's working directory (e.g., 'src/services/auth-service'). Empty or omitted means project root."
          },
          "status": {
            "type": "string",
            "enum": ["pending", "in-progress", "complete", "blocked"]
          },
          "files": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Relevant file paths relative to the task's directory"
          },
          "tests": {
            "type": "array",
            "items": { "type": "string" }
          },
          "completedAt": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp when task was completed"
          },
          "completedBy": {
            "type": "string",
            "pattern": "^iteration-[0-9]+$",
            "description": "Which iteration completed this task"
          },
          "notes": {
            "type": "string",
            "description": "Agent observations, warnings, suggestions for next iteration"
          },
          "dependencies": {
            "type": "array",
            "items": { "type": "integer" },
            "description": "Task IDs that must be complete before this task"
          },
          "model": {
            "type": "string",
            "enum": ["opus", "sonnet"],
            "default": "opus",
            "description": "Which Claude model to use"
          },
          "agent": {
            "type": "string",
            "description": "Name of a .claude/agents/*.md specialist agent for this task (omit for default generalist)"
          }
        }
      }
    }
  }
}
```

TASK STRUCTURE GUIDELINES:
Each task needs:

- **id**: unique integer, sequential
- **priority**: integer (lower = higher priority)
- **title**: short descriptive title
- **description**: detailed implementation instructions — give the worker agent enough context to complete the task independently without reading planning-notes.md
- **directory**: relative path from project root to the agent's working directory
- **status**: `pending` for new tasks
- **files**: array of relevant file paths RELATIVE TO THE TASK'S DIRECTORY
- **dependencies**: array of task IDs that must complete first (empty array if none)
- **tests**: array of test commands to verify the task. Each command runs from the task's directory by default; a command runs from the project root instead only if it has a path-shaped argument (a non-flag, non-`@`-scoped token containing `/`, or a bare filename with a letter-leading extension) that doesn't resolve under the task's directory but does resolve under the project root — so file paths can be written relative to either. Manifest-driven commands (`npm test`, `bun test`, `cargo test`) carry no path argument, so they always run from the task's directory and correctly pick up the right service's manifest in a multi-service repo.
- **model**: `opus` or `sonnet` (optional, defaults to `opus`)
- **agent**: (optional) name of a specialist agent from `.claude/agents/`

ATOMICITY RULE:

Each task is one atomic unit of work. Do NOT create paired "write tests for X" / "implement X" tasks. If TDD is desired, the executor agent practices it within a single task: write the test, see it fail, make it pass — all in one task.

TEST COMMAND GUIDELINES:

- ALWAYS prefer the project's own test scripts (e.g., `npm run test`, `npm test`, `bun test`, `cargo test`) over direct tool invocations (e.g., `npx vitest run Foo`, `npx jest Foo`)
- Direct tool invocations like `npx vitest run ComponentName` often fail because they bypass project-level config, setup files, and path resolution that the npm script handles
- If you want to scope tests to specific files, use the test framework's built-in filtering via the npm script (e.g., `npm test -- --filter ComponentName`) but only if the project's test script supports passthrough args. When in doubt, just use `npm run test` or equivalent.
- Read the project's `package.json` (or equivalent) to find the correct test script name

MODEL SELECTION GUIDANCE:

- **sonnet**: straightforward tasks — add validation, write tests, simple CRUD, config changes, file deletions, simple refactors
- **opus**: complex tasks — architectural decisions, subtle debugging, multi-file refactors, tasks requiring deep codebase understanding

AGENT SELECTION:

- Post-task code review runs **automatically** after every task (gated on project config) — do NOT create "review code", "review the work", or similar review tasks, and do NOT assign `post-task-reviewer` or any other internal agent to a task's `agent` field
- If `.claude/agents/` contains specialist executor agents, assign them to tasks matching their expertise
- Not every task needs a specialist — use the default generalist for tasks without a clear match

RULES:

- NEVER modify tasks with status `complete` or their metadata (`completedAt`, `completedBy`, `notes`)
- Assign IDs to new tasks only after user approval: run `cairn task next-id --count <n>` (where `n` = the number of new tasks), then assign the returned IDs sequentially. The command outputs one integer per line. Then run `cairn round new` once, before writing `tasks.json` — it starts the new planning round and prints one JSON object whose `round` field is the new round number (post-task reviews for the round go to `.cairn/reviews/round-<N>.md`). Run it ONCE per approved generation: do NOT re-run it when tasks are edited or regenerated later in the same session, because every run bumps the round again. Never reuse archived IDs. Preserve existing completed tasks' IDs and all their metadata unchanged.
- The description field should give the worker agent enough context to complete the task independently
- Include specific file paths in the `files` array so the worker knows where to look
- Each task should be scoped to ~5 minutes of focused agent work
- Link tasks via `dependencies` when ordering matters
- ONLY write to `.cairn/tasks.json` — do not modify any other files
- Present the proposed tasks FIRST. Do NOT write tasks.json until explicitly told to proceed.

---

After receiving the subagent's proposed tasks, present them to the user for review. Once approved: (1) run `cairn task next-id --count <n>` (where `n` = the number of new tasks) and assign the returned IDs sequentially to the new tasks — the command outputs one integer per line; (2) run `cairn round new` exactly once — its JSON output (`{"verdict": "round-started", "round": N, ...}`) reports the new round. Do NOT re-run it if the tasks are edited or regenerated later in this session: each run bumps the round again; (3) write `.cairn/tasks.json` directly using the Write tool — do NOT spawn another agent just to write the file.
