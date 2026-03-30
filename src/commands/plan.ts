import * as fs from 'fs';
import * as path from 'path';
import { spawnSync as nodeSpawnSync, type SpawnSyncReturns, type SpawnSyncOptions } from 'child_process';
import { Task, AgentInfo } from '../types';

const STATUS_ICONS: Record<string, string> = {
  complete: '✓',
  'in-progress': '▶',
  pending: '○',
  blocked: '✗',
};

interface TasksFile {
  tasks: Task[];
}

export function formatBanner(projectName: string): string {
  return `\n  Project: ${projectName}\n`;
}

export function formatPlanningNotesStatus(dataDir: string): string {
  const notesPath = path.join(dataDir, 'planning-notes.md');
  if (fs.existsSync(notesPath)) {
    return `  Planning notes: found (${notesPath})`;
  }
  return `  Planning notes: not found (${notesPath})`;
}

export function formatCompletedCount(dataDir: string): string | null {
  const completedFile = path.join(dataDir, 'tasks.completed.json');
  if (!fs.existsSync(completedFile)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(completedFile, 'utf8')) as TasksFile;
    const tasks = data.tasks ?? [];
    if (tasks.length === 0) return null;
    return `  Previously completed: ${tasks.length} task(s)`;
  } catch {
    return null;
  }
}

export function formatTasksSummary(tasks: Task[]): string {
  if (tasks.length === 0) return '  No pending tasks.';

  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`);

  const lines: string[] = [];
  lines.push(`  Status: ${parts.join(', ')} (${tasks.length} total)`);
  lines.push('');

  for (const t of tasks) {
    const icon = STATUS_ICONS[t.status] ?? '?';
    const dirStr = t.directory ? ` [${t.directory}]` : '';
    const depStr =
      t.dependencies && t.dependencies.length > 0
        ? ` (depends on: ${t.dependencies.join(',')})`
        : '';
    lines.push(`  ${icon} #${t.id} [P${t.priority}]${dirStr} ${t.title}${depStr}`);
  }

  return lines.join('\n');
}

export interface PlanningPromptInput {
  projectName: string;
  projectRoot: string;
  dataDir: string;
  agents: AgentInfo[];
}

/**
 * Build the planning system prompt.
 * The agent reads project files itself via its tools — we don't embed them.
 */
export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const { projectName, projectRoot, dataDir, agents } = input;

  // Build agents section
  let agentsSection = '';
  if (agents.length > 0) {
    const lines = agents.map(a => {
      const desc = a.description ? ` — ${a.description}` : '';
      const model = a.model ? ` (model: ${a.model})` : '';
      return `  - ${a.name}${desc}${model}`;
    });
    agentsSection = `\nAVAILABLE SPECIALIST AGENTS (.claude/agents/):\n${lines.join('\n')}`;
  }

  const prompt = `You are a planning assistant for the Ralph agentic loop system.

PROJECT: ${projectName}
PROJECT ROOT: ${projectRoot}

BRIEFING MATERIALS (read these before starting):
- CLAUDE.md and README.md (if they exist at the project root)
- Build configuration files (package.json, Cargo.toml, Makefile, etc.) in relevant modules
- planning-notes.md in ${dataDir} — notes from any previous planning session. Read this first for context on prior decisions.
- tasks.completed.json in ${dataDir} — archive of completed tasks with agent notes. Skim for context on what's already been built.
- IMPLEMENTATION.md (if it exists) — high-level system architecture summary. Read for cross-project context.
- .claude/agents/*.md — specialist agent definitions, if any exist.

You have full tool access to read these files yourself. Do NOT ask the user to paste file contents — read them directly.

YOUR ROLE:
Help the user decide WHAT to build next for this project. This is a high-level discussion — you are NOT generating tasks yet. A separate step will handle that after the user reviews your notes. You have access to the entire repository, not just a single service.

WORKFLOW:
1. Read the briefing materials listed above
2. Explore the project codebase (modules, services, infrastructure — whatever applies)
3. If previous planning-notes.md exists, summarize what was discussed last time
4. Have a conversation with the user about what they want to accomplish
5. When the discussion feels complete, write planning-notes.md

PLANNING-NOTES.MD FORMAT:
Write this file in the data directory (${dataDir}). Structure it as:

## Context
What exists today, relevant background from previous sessions.

## Goals
What the user wants to accomplish in this round.

## Approach
How we'll tackle it — key decisions, patterns to follow, trade-offs considered.

## Rejected Alternatives
What we considered but decided against, and why. (Helps prevent re-litigating in future sessions.)
IMPORTANT: If previous planning-notes.md has a Rejected Alternatives section, carry forward any entries that are still relevant. Only remove entries that are no longer applicable (e.g., the context changed significantly). This section is cumulative across sessions.

## Rough Task Outline
Bullet list of the work, in rough priority order. Not detailed — just enough to show the shape of the plan. Each bullet should be one agent-sized unit of work (~5 min).
IMPORTANT: Each bullet should include a working directory (e.g., 'src/services/auth-service' or 'src/database'). For cross-service work, note which directories are involved.

## Open Questions
Anything unresolved that might affect task generation.

RULES:
- ONLY write to planning-notes.md — do NOT write tasks.json or modify any other files
- Focus on understanding and planning, not implementation details
- Ask clarifying questions rather than making assumptions
- Reference specific files and code you've read to ground the discussion
- If specialist agents are available, consider which tasks would benefit from them and note this in the Rough Task Outline${agentsSection}`;

  return prompt;
}

export function displayPreflight(projectName: string, dataDir: string): void {
  console.log(formatBanner(projectName));

  const notesStatus = formatPlanningNotesStatus(dataDir);
  console.log(notesStatus);

  const completedLine = formatCompletedCount(dataDir);
  if (completedLine !== null) {
    console.log(completedLine);
  }

  const tasksFile = path.join(dataDir, 'tasks.json');
  if (!fs.existsSync(tasksFile)) {
    console.log('  No existing tasks.json — starting fresh.');
    console.log('');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as TasksFile;
    const tasks = data.tasks ?? [];
    console.log('  Existing tasks.json:');
    console.log('');
    console.log(formatTasksSummary(tasks));
    console.log('');
  } catch {
    console.log('  Could not read tasks.json.');
    console.log('');
  }
}

export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

export interface RunPlanOpts {
  projectName: string;
  projectRoot: string;
  dataDir: string;
  agents: AgentInfo[];
  spawnSyncFn?: SpawnSyncFn;
}

/**
 * Run the plan command: display preflight info, then spawn a single
 * interactive claude session with the planning system prompt.
 */
export function runPlan(opts: RunPlanOpts): void {
  const {
    projectName,
    projectRoot,
    dataDir,
    agents,
    spawnSyncFn = nodeSpawnSync,
  } = opts;

  displayPreflight(projectName, dataDir);

  const prompt = buildPlanningPrompt({ projectName, projectRoot, dataDir, agents });

  spawnSyncFn('claude', [
    '--append-system-prompt', prompt,
    '--allowedTools', 'Read,Glob,Grep,Write,Edit',
  ], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
  });
}
