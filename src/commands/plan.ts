import * as fs from 'fs';
import * as path from 'path';
import { spawnSync as nodeSpawnSync, type SpawnSyncReturns, type SpawnSyncOptions } from 'child_process';
import { sendToNarrate as defaultSendToNarrate, sendNtfy as defaultSendNtfy, type NtfyOpts } from '../stream-filter';
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
  implementationFile?: string;
}

export interface TaskGenPromptInput {
  projectName: string;
  projectRoot: string;
  dataDir: string;
  agents: AgentInfo[];
  gitStatus: string;
}

/**
 * Try to read a file, returning its content or null if it doesn't exist.
 */
function tryReadFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Build a labeled section wrapping file content. Returns empty string if content is null.
 */
function fileSection(label: string, content: string | null): string {
  if (content === null) return '';
  return `\n--- ${label} ---\n${content}\n--- end ${label} ---\n`;
}

/**
 * Build the planning system prompt, matching the shell version in ralph_plan.sh.
 */
export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const { projectName, projectRoot, dataDir, agents, implementationFile = 'IMPLEMENTATION.md' } = input;

  // Gather briefing file contents
  const claudeMd = tryReadFile(path.join(projectRoot, 'CLAUDE.md'));
  const readmeMd = tryReadFile(path.join(projectRoot, 'README.md'));
  const packageJson = tryReadFile(path.join(projectRoot, 'package.json'));
  const cargoToml = tryReadFile(path.join(projectRoot, 'Cargo.toml'));
  const makefile = tryReadFile(path.join(projectRoot, 'Makefile'));
  const planningNotes = tryReadFile(path.join(dataDir, 'planning-notes.md'));
  const completedTasks = tryReadFile(path.join(dataDir, 'tasks.completed.json'));
  const implContent = tryReadFile(path.join(projectRoot, implementationFile));

  // Build briefing section
  let briefing = `BRIEFING MATERIALS (read these before starting):
- CLAUDE.md and README.md (if they exist at the project root)
- Build configuration files (package.json, Cargo.toml, Makefile, etc.) in relevant modules`;

  if (planningNotes !== null) {
    briefing += `\n- planning-notes.md — notes from the previous planning session. Read this first for context on prior decisions.`;
  }
  if (completedTasks !== null) {
    briefing += `\n- tasks.completed.json — archive of completed tasks with agent notes. Skim for context on what's already been built.`;
  }
  if (implContent !== null) {
    briefing += `\n- ${implementationFile} — high-level system architecture summary. Read for cross-project context.`;
  }

  // Embed file contents
  const embeddedFiles = [
    fileSection('CLAUDE.md', claudeMd),
    fileSection('README.md', readmeMd),
    fileSection('package.json', packageJson),
    fileSection('Cargo.toml', cargoToml),
    fileSection('Makefile', makefile),
    fileSection('planning-notes.md', planningNotes),
    fileSection('tasks.completed.json', completedTasks),
    fileSection('IMPLEMENTATION.md', implContent),
  ].filter(s => s !== '').join('');

  // Build agents section
  let agentsSection = '';
  if (agents.length > 0) {
    const lines = agents.map(a => {
      const desc = a.description ? ` — ${a.description}` : '';
      const model = a.model ? ` (model: ${a.model})` : '';
      return `  - ${a.name}${desc}${model}`;
    });
    agentsSection = `\nAVAILABLE SPECIALIST AGENTS (.claude/agents/):\n${lines.join('\n')}`;
    briefing += `\n- .claude/agents/*.md — specialist agent definitions. Read these to understand what specialized agents are available for task assignment.`;
  }

  const prompt = `You are a planning assistant for the Ralph agentic loop system.

PROJECT: ${projectName}
PROJECT ROOT: ${projectRoot}

${briefing}
${embeddedFiles}
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

/**
 * Build the task generation system prompt, matching the shell version in ralph_plan.sh.
 */
export function buildTaskGenPrompt(input: TaskGenPromptInput): string {
  const { projectName, projectRoot, dataDir, agents, gitStatus } = input;
  const tasksFile = path.join(dataDir, 'tasks.json');

  // Read the schema from src/tasks-schema.json (bundled with the tool)
  const schemaPath = path.join(__dirname, '..', 'tasks-schema.json');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');

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

  // Build git status section
  let gitSection = '';
  if (gitStatus) {
    gitSection = `\nGIT STATUS:\n${gitStatus}`;
  }

  const prompt = `You are a task generation assistant for the Ralph agentic loop system.

PROJECT: ${projectName}
PROJECT ROOT: ${projectRoot}
TASKS FILE: ${tasksFile}

The user has already approved a set of planning notes. Your job is to translate those notes into a concrete, executable task list.

YOUR WORKFLOW:
1. Read planning-notes.md — this is the approved plan. Follow it closely.
2. Read the project codebase as needed to fill in implementation details (file paths, function names, test commands)
3. If tasks.json already exists, preserve any tasks with status 'complete' and their metadata
4. Present your proposed task breakdown to the user BEFORE writing tasks.json. Show each task's title, directory, rough description, dependencies, and suggested model (opus/sonnet). Wait for the user to approve or request changes.
5. Once approved, write tasks.json following the schema below.

TASKS.JSON SCHEMA:
${schemaContent}

TASK STRUCTURE:
Each task needs:
- id: unique integer
- priority: integer (lower = higher priority)
- title: short descriptive title
- description: detailed implementation instructions for the worker agent
- directory: relative path from project root to the agent's working directory (e.g., 'src/services/auth-service'). Empty string or omitted means project root.
- status: 'pending' for new tasks
- files: array of relevant file paths RELATIVE TO THE TASK'S DIRECTORY to point the worker agent to
- dependencies: array of task IDs that must complete first (empty array if none)
- tests: array of test commands to verify the task (run from the task's directory)
- model: 'opus' or 'sonnet' (optional, defaults to 'opus'). Use 'sonnet' for straightforward tasks (add validation, write tests, simple CRUD, config changes). Use 'opus' for complex tasks (architectural decisions, subtle debugging, multi-file refactors).
- agent: (optional) name of a specialist agent from .claude/agents/ to handle this task. Omit for the default generalist agent.

DIRECTORY GUIDELINES:
| Task type | directory | Agent behavior |
|-----------|----------|----------------|
| Module work | src/services/auth-service | cd into module, work within it |
| DB migration | src/database | cd into database dir, work within it |
| Cross-module | (empty) | cd to project root, may touch anything |

TEST COMMAND GUIDELINES:
- ALWAYS prefer the project's own test scripts (e.g., 'npm run test', 'npm test', 'cargo test') over direct tool invocations (e.g., 'npx vitest run Foo', 'npx jest Foo')
- Direct tool invocations like 'npx vitest run ComponentName' often fail because they bypass project-level config, setup files, and path resolution that the npm script handles
- If you want to scope tests to specific files, use the test framework's built-in filtering via the npm script (e.g., 'npm test -- --filter ComponentName') but only if the project's test script supports passthrough args. When in doubt, just use 'npm run test' or equivalent.
- Read the project's package.json (or equivalent) to find the correct test script name

RULES:
- NEVER modify tasks with status 'complete' or their metadata (completedAt, completedBy, notes)
- ONLY write to: ${tasksFile} — do not modify any other files
- Keep task IDs unique and sequential
- The description field should give the worker agent enough context to complete the task independently
- Include specific file paths in the files array so the worker knows where to look
- Each task should be scoped to ~5 minutes of focused agent work
- Link tasks via dependencies when ordering matters
- When specialist agents are available, assign them to tasks that match their expertise. Not every task needs a specialist — use the default generalist for tasks without a clear match.${agentsSection}${gitSection}`;

  return prompt;
}

export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

type SendToNarrateFn = (text: string, socketPath: string) => Promise<void>;
type SendNtfyFn = (message: string, topic: string, opts?: NtfyOpts) => Promise<void>;

export interface LaunchPlanningSessionOpts extends PlanningPromptInput {
  spawnSyncFn?: SpawnSyncFn;
  narrateSocketPath?: string;
  sendToNarrateFn?: SendToNarrateFn;
  ntfyTopic?: string;
  sendNtfyFn?: SendNtfyFn;
}

export interface LaunchTaskGenerationOpts extends TaskGenPromptInput {
  spawnSyncFn?: SpawnSyncFn;
  narrateSocketPath?: string;
  sendToNarrateFn?: SendToNarrateFn;
  ntfyTopic?: string;
  sendNtfyFn?: SendNtfyFn;
}

export function launchPlanningSession(opts: LaunchPlanningSessionOpts): void {
  const {
    projectName,
    projectRoot,
    dataDir,
    agents,
    implementationFile,
    spawnSyncFn = nodeSpawnSync,
    narrateSocketPath = process.env.RALPH_NARRATE_SOCKET ?? '',
    sendToNarrateFn = defaultSendToNarrate,
    ntfyTopic = process.env.RALPH_NTFY_TOPIC ?? '',
    sendNtfyFn = defaultSendNtfy,
  } = opts;

  console.log('Launching planning discussion...');
  console.log('Discuss your goals. Claude will write planning-notes.md when ready.');
  console.log('Exit the session (Ctrl+C or /exit) when done.');
  console.log('');

  if (narrateSocketPath) {
    sendToNarrateFn(
      `Starting the planning discussion for project ${projectName}. Time to figure out what we're building next.`,
      narrateSocketPath,
    );
  }
  if (ntfyTopic) {
    sendNtfyFn(`Planning session started for ${projectName}`, ntfyTopic, {
      title: 'Ralph - Planning',
      tags: 'memo',
    });
  }

  const prompt = buildPlanningPrompt({ projectName, projectRoot, dataDir, agents, implementationFile });

  spawnSyncFn('claude', [
    '--append-system-prompt', prompt,
    '--allowedTools', 'Read,Glob,Grep,Write,Edit',
  ], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
  });

  if (narrateSocketPath) {
    sendToNarrateFn('Planning discussion complete. Let\'s see what we came up with.', narrateSocketPath);
  }
  if (ntfyTopic) {
    sendNtfyFn('Planning discussion complete', ntfyTopic, {
      title: 'Ralph - Planning',
      tags: 'white_check_mark',
    });
  }
}

export function launchTaskGeneration(opts: LaunchTaskGenerationOpts): void {
  const {
    projectName,
    projectRoot,
    dataDir,
    agents,
    gitStatus,
    spawnSyncFn = nodeSpawnSync,
    narrateSocketPath = process.env.RALPH_NARRATE_SOCKET ?? '',
    sendToNarrateFn = defaultSendToNarrate,
    ntfyTopic = process.env.RALPH_NTFY_TOPIC ?? '',
    sendNtfyFn = defaultSendNtfy,
  } = opts;

  console.log('Launching task generation from planning notes...');
  console.log('Claude will propose tasks for your approval, then write tasks.json.');
  console.log('Exit the session (Ctrl+C or /exit) when done.');
  console.log('');

  if (narrateSocketPath) {
    sendToNarrateFn(
      'Switching to task generation mode. Turning the plan into a concrete task list.',
      narrateSocketPath,
    );
  }
  if (ntfyTopic) {
    sendNtfyFn('Task generation started', ntfyTopic, {
      title: 'Ralph - Tasks',
      tags: 'gear',
    });
  }

  const prompt = buildTaskGenPrompt({ projectName, projectRoot, dataDir, agents, gitStatus });

  spawnSyncFn('claude', [
    '--append-system-prompt', prompt,
    '--allowedTools', 'Read,Glob,Grep,Write,Edit',
    'Read planning-notes.md and generate the task breakdown. Show me the proposed tasks for approval before writing tasks.json.',
  ], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
  });

  if (narrateSocketPath) {
    sendToNarrateFn('Task generation complete. Let\'s review what we\'ve got.', narrateSocketPath);
  }
  if (ntfyTopic) {
    sendNtfyFn('Task generation complete', ntfyTopic, {
      title: 'Ralph - Tasks',
      tags: 'white_check_mark',
    });
  }
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
