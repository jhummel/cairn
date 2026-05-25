## Context

Ralph's plan command (`ralph plan`) launches an interactive planner session where the user discusses what to build. The planner agent writes `planning-notes.md`, then the user runs `/generate-tasks` to turn those notes into `tasks.json`. This flow works well when the user knows what they want, but there's no automated alternative — no way to say "go find what needs work."

The existing slash command pattern is established: `commands/generate-tasks.md` and `commands/review-tasks.md` live in Ralph's `commands/` directory, get installed into target projects via `ralph init` → `installSlashCommands()` (copies to `.claude/commands/`). Agent definitions live in `agents/` and get installed via `installAgents()` (copies to `.claude/agents/`). The planner agent is spawned by `plan.ts` with `--allowedTools Read,Glob,Grep,Write,Edit` and `--append-system-prompt` for dynamic project context.

Prior session completed the corruption-defense work: CLI subcommands for task mutations, atomic `readTasksFile`/`writeTasksFile`, snapshot recovery, post-task-reviewer scope tightening. All 15 tasks archived.

## Goals

Add a `/codebase-audit` slash command that launches an autonomous agent to do a full-codebase security + SOLID-design audit, producing findings that the planner agent then formats into `planning-notes.md`. This serves as an alternative to the user-driven planning conversation — the user kicks it off, the agent does a cold read of the codebase, and returns structured findings. The user can then continue chatting with the planner to refine before running `/generate-tasks` as usual.

Key design decisions already made:
- **The audit agent is a recon specialist, not a planner.** It returns findings to the planner, which does the formatting. The agent doesn't know about planning-notes.md structure.
- **Two fixed lenses**: security (adversarial) and SOLID/structural. Not configurable per-invocation for now.
- **Slash command + agent file**: `commands/codebase-audit.md` (slash command wrapper) + `agents/audit-planner.md` (the recon agent prompt). Both installed by `ralph init`.
- **No code changes to `plan.ts` or `index.ts`** — this is purely additive (new files).

## Approach

### Architecture

Two new files, following existing patterns:

1. **`agents/audit-planner.md`** — The recon specialist agent prompt. Read-only against the codebase. Its job:
   - Read briefing materials (CLAUDE.md, IMPLEMENTATION.md, tasks.completed.json, prior planning-notes.md) to understand project context and avoid re-flagging fixed issues
   - Do a cold sweep through the codebase using two separate cognitive passes (security lens, then SOLID lens)
   - Return structured findings (not planning notes) to the planner

2. **`commands/codebase-audit.md`** — The slash command, structured like `generate-tasks.md`. Tells the planner to:
   - Spawn the audit agent (via Agent tool)
   - Receive the findings
   - Present a summary to the user
   - Continue the conversation so the user can discuss, challenge, or refine findings
   - When the user is satisfied, write `planning-notes.md` in the standard format

### Audit agent design (from user's draft, adapted)

The agent prompt preserves these concepts from the user's original draft:
- **Two-lens cognitive separation**: Security and SOLID held as separate mental modes, never blended in a single finding. Security is adversarial ("how do I abuse this?"), SOLID is structural ("what will hurt to change in six months?").
- **Recon, not findings-exhaustion**: The agent is pattern-matching in one cold sweep, not proving. Findings are leads, not verdicts.
- **Confirm-then-remediate framing**: Every finding is framed as "X appears to have issue Y; confirm by checking [bounded locations]; if confirmed, remediate by [approach]; if already safe, document why and close." This handles false positives from cold reads.
- **Spike demotion**: If a finding can't be bounded to a confirmable-and-fixable scope, it gets demoted to an investigation item — honestly flagged as needing a deeper look, not crammed into a fix.
- **Bounded confirmation**: Every finding must name specific files/functions/call-sites so downstream executors aren't doing unbounded spelunking.

Changes from the user's original draft:
- **Removed all planning-notes formatting** — the agent returns findings, not a planning document. The planner handles formatting.
- **Removed time-box enforcement** (`~N min` tokens, atomicity grader references) — that's the planner's and task generator's concern, not the audit agent's.
- **Generalized away from service-oriented language** — the agent describes the codebase structure it *finds* (modules, packages, directories, components) rather than assuming a microservice architecture.
- **Added project context reading** — agent reads CLAUDE.md, IMPLEMENTATION.md, tasks.completed.json, and prior planning-notes.md before scanning.

### Findings return format

The audit agent returns structured findings (not planning notes):

```
## Codebase Overview
Factual inventory — what was inspected, structure observed, entry points,
trust boundaries, tech stack. File references throughout.

## Security Findings
Each finding: observation, severity (critical/high/medium/low), specific
locations to confirm, remediation direction if confirmed.

## SOLID / Structural Findings
Same structure — observation, specific locations, suggested direction.

## Reviewed and Judged Sound
Areas inspected where nothing actionable was found. Brief reason why.

## Unresolved
Things the cold read couldn't determine — needs human judgment or
runtime observation.
```

### Slash command flow

The `commands/codebase-audit.md` slash command instructs the planner to:
1. Spawn the `audit-planner` agent via the Agent tool
2. Receive its findings report
3. Present a concise summary to the user (not the full raw output — a digestible overview of what was found, organized by severity/lens)
4. Invite the user to discuss — "anything surprising? anything you know is already handled? anything to add?"
5. When the conversation feels complete, write `planning-notes.md` incorporating the audit findings into the standard format (Context, Goals, Approach, Rejected Alternatives, Rough Task Outline, Open Questions)

This preserves the user's ability to course-correct before anything gets generated.

## Rejected Alternatives

- **Audit agent writes planning-notes.md directly.** Considered and rejected. The audit agent is a recon specialist — it finds things. The planner knows the planning-notes format and has conversational context with the user. Separating these concerns means the user can refine findings before they become notes, and the audit agent doesn't need to know about document formatting.
- **Configurable lenses per invocation** (e.g., `/codebase-audit security` or `/codebase-audit solid,performance`). Decided to keep fixed (security + SOLID) for simplicity. Can be extended later by adding lens parameters or additional audit profiles.
- **Separate command instead of slash command** (e.g., `ralph audit`). The slash command pattern fits better — it runs inside the planner session so the user can continue chatting. A separate CLI command would break the conversational flow.
- **Embed the full agent prompt in the slash command** (like `generate-tasks.md` embeds its subagent prompt). Rejected in favor of a separate `agents/audit-planner.md` file — the prompt is substantial, and having it as a named agent enables potential reuse outside the plan flow.

Carried from prior sessions:
- **Use Anthropic TS SDK instead of shelling out to claude** — shelling out gives us Claude Code's full tool suite, permissions model, and MCP support for free.
- **Port narration to TypeScript** — Kokoro TTS and sounddevice are Python-specific.
- **Skills instead of subagents for task generation/review** — clean context matters; subagents get fresh context while keeping full tool access.
- **Change storage format (SQLite / per-task files / JSONL)** — structurally solves corruption but a much larger change with migration cost. CLI-subcommand approach gets 95% of the benefit.

## Rough Task Outline

1. Create `agents/audit-planner.md` — the recon specialist agent prompt. Adapted from user's draft: two-lens separation (security + SOLID), confirm-then-remediate framing, spike demotion, bounded confirmation, project context reading, generalized module/component language. Returns structured findings format. Read-only. — `agents/`
2. Create `commands/codebase-audit.md` — slash command wrapper following the `generate-tasks.md` pattern. Instructs the planner to spawn the audit agent, present findings summary, continue conversation, then write planning-notes.md in standard format when discussion is complete. — `commands/`
3. Update `commands/codebase-audit.md` mirror — ensure `ralph init` installs the new slash command. Currently `installSlashCommands()` copies all `commands/*.md`, so this is automatic. But also ensure `installAgents()` copies the new agent file. Verify by reading `init.ts` logic — if both functions glob `*.md` from their respective directories, no code change needed, just a verification task. — `src/commands/`, `commands/`, `agents/`
4. Write tests for the new files — verify the agent file and slash command are present, well-formed, and get installed by `ralph init`. Add a test to `test/commands/init.test.ts` that confirms `installSlashCommands` and `installAgents` pick up the new files. — `test/`
5. End-to-end smoke test — run `ralph plan` on a scratch project, type `/codebase-audit`, verify the agent spawns, produces findings, and the planner presents them. Manual verification, document results in task notes. — project root

## Open Questions

1. **Planner `--allowedTools` and the Agent tool.** The planner is spawned with `--allowedTools Read,Glob,Grep,Write,Edit` (plan.ts:162). The `/generate-tasks` slash command instructs the planner to use the `Agent` tool, which isn't in that list — yet it works in practice. Need to verify whether `--allowedTools` restricts the `Agent` tool or whether `Agent` is always available. If it *is* restricted, we'd need to add `Agent` to the allowlist in `plan.ts`. This affects both the new `/codebase-audit` command and the existing `/generate-tasks` command.
