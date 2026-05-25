# Codebase Audit

You are the planning agent. Your job is to run a cold audit of the codebase by spawning a specialist recon agent, then help the user digest and discuss the findings before writing planning notes.

## Instructions

Use the **Agent tool** to spawn a subagent with `subagent_type: "general-purpose"` and the prompt below. The subagent will perform a read-only sweep of the codebase through security and structural lenses and return structured findings.

**Important**: Copy the contents of `agents/audit-planner.md` into the subagent prompt verbatim. Read that file first, then pass its full contents as the prompt to the Agent tool. Do NOT summarize or paraphrase — the audit agent needs the complete instructions.

## After receiving the subagent's findings

### 1. Present a concise summary

Do NOT dump the raw output. Instead, present a digestible overview organized as follows:

**Security findings** — group by severity (critical, high, medium, low). For each finding, show:
- The title and severity
- A one-sentence summary of the problem
- The affected file(s)

**Structural findings** — group by impact (high, medium, low). Same format as above.

**Investigation items** — list briefly with one-line descriptions.

**Clean areas** — mention what was reviewed and found sound so the user knows what does NOT need attention.

Omit any section that has no entries. Keep the entire summary scannable — the user should be able to read it in under 2 minutes.

### 2. Invite discussion

After presenting the summary, ask the user:

> Anything surprising here? Anything you know is already handled? Anything to add from your own experience with this codebase?

Let the user react, ask questions, dismiss false positives, add context, or request deeper dives into specific findings. Answer questions using the audit data. If the user wants to see the full detail of a specific finding, show it.

Do NOT rush to write planning notes. Stay in discussion mode until the user signals they are ready to move on.

### 3. Write planning-notes.md

When the conversation feels complete — the user has triaged the findings and given direction — write `.ralph/planning-notes.md` incorporating the audit findings into the standard planning notes format:

```markdown
## Context
[What the audit found and the user's assessment of it]

## Goals
[What the user wants to address based on the audit findings]

## Approach
[How the identified issues should be tackled — ordering, grouping, priorities]

## Rejected Alternatives
[Findings the user dismissed as false positives or not worth addressing, with reasons]

## Rough Task Outline
[Preliminary breakdown of work items derived from the accepted findings]

## Open Questions
[Unresolved items, investigation spikes, things that need more info]
```

Write the file using the **Write tool** directly — do NOT spawn another agent to write it.

After writing, confirm to the user that `planning-notes.md` is ready and suggest they run `/generate-tasks` to turn the plan into an executable task list.
