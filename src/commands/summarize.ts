import * as fs from 'fs';
import * as path from 'path';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { processStream } from '../stream-filter';

export interface SummarizePromptOpts {
  projectRoot: string;
  projectName: string;
  implFile: string;
  completedTasksPath: string;
  claudeMdPattern: string;
}

/**
 * Build the context string for why the summarize is being triggered.
 * Includes a reference to completed tasks if the file exists.
 */
export function buildContext(projectRoot: string, completedTasksPath: string): string {
  let context = 'Updating from the central task list.';
  if (fs.existsSync(completedTasksPath)) {
    const rel = path.relative(projectRoot, completedTasksPath);
    context += ` Completed tasks are in ${rel}.`;
  }
  return context;
}

/**
 * Build the CLAUDE.md pruning instructions section.
 * Uses specific glob pattern if provided, otherwise generic lookup.
 */
export function buildClaudeMdPruning(implFile: string, claudeMdPattern: string): string {
  if (claudeMdPattern) {
    return `
CLAUDE.MD PRUNING:
After updating ${implFile}, review each module's CLAUDE.md file (${claudeMdPattern}).
Worker agents append operational notes during task execution, and these accumulate over time.
For each CLAUDE.md:
- Remove entries that are no longer accurate (e.g., a workaround for a bug that's since been fixed)
- Deduplicate entries that say the same thing in different words
- Keep it strictly operational: build commands, config quirks, gotchas
- Remove any status updates, progress notes, or task history that crept in
Do NOT remove entries you're unsure about — when in doubt, keep them.`;
  } else {
    return `
CLAUDE.MD PRUNING:
After updating ${implFile}, look for any module-level CLAUDE.md files in the project.
If you find any, review them for accumulated noise from worker agents:
- Remove entries that are no longer accurate
- Deduplicate entries that say the same thing in different words
- Keep it strictly operational: build commands, config quirks, gotchas
- Remove any status updates, progress notes, or task history that crept in
Do NOT remove entries you're unsure about — when in doubt, keep them.`;
  }
}

/**
 * Build the full system prompt for the summarize agent.
 */
export function buildSummarizePrompt(opts: SummarizePromptOpts): string {
  const { projectRoot, projectName, implFile, completedTasksPath, claudeMdPattern } = opts;

  const context = buildContext(projectRoot, completedTasksPath);

  const implPath = path.join(projectRoot, implFile);
  const existingNote = fs.existsSync(implPath)
    ? `An existing ${implFile} is present — update it in place rather than starting from scratch.`
    : `No existing ${implFile} — create it from scratch.`;

  const claudeMdPruning = buildClaudeMdPruning(implFile, claudeMdPattern);

  return `You are updating ${implFile} — a high-level architecture and implementation summary for the ${projectName} project.

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

TRIGGER: ${context}
${existingNote}

YOUR TASK:
1. Read the existing ${implFile} if it exists (at the project root)
2. Read CLAUDE.md for conventions and architecture patterns
3. Explore each module's key files to understand current state:
   - Build configuration (package.json, Cargo.toml, etc.)
   - API/route definitions (what endpoints/interfaces exist)
   - Types and data models
   - Core business logic
   - tasks.completed.json (what was built, in what order)
4. Write an updated ${implFile} that covers the entire system

STRUCTURE (suggested — adapt as the project evolves):
- System Overview (1-2 paragraphs: what is this, who uses it)
- Architecture (component topology, communication patterns, request flow)
- Components (per-component section: purpose, key interfaces, data model)
- Data Layer (database schema overview, cache usage)
- Cross-Cutting Concerns (auth, validation, error handling, tracing)
- Current State (what's built, what's planned/placeholder)
- Key Design Decisions (non-obvious choices and why)
${claudeMdPruning}

RULES:
- Be concise but complete — aim for a document someone can read in 5-10 minutes
- Focus on HOW things work, not just WHAT exists
- Include specific details (endpoint paths, field names) when they aid understanding
- Don't duplicate CLAUDE.md content (reference it instead for coding conventions)
- Update existing sections rather than appending — the document should always reflect current state
- Write to ${implFile} and prune CLAUDE.md files — do not modify any other files
- Do not include a table of contents
- Use subagents to read files in parallel — be efficient with tokens`;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RunSummarizeOpts extends SummarizePromptOpts {
  spawnFn?: SpawnFn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function runSummarize(opts: RunSummarizeOpts): Promise<void> {
  const {
    projectRoot,
    projectName,
    implFile,
    completedTasksPath,
    claudeMdPattern,
    spawnFn = nodeSpawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  const systemPrompt = buildSummarizePrompt({
    projectRoot,
    projectName,
    implFile,
    completedTasksPath,
    claudeMdPattern,
  });

  const userPrompt = `Update ${implFile} with the current state of the entire system. Read the codebase thoroughly and write a comprehensive but concise summary.`;

  // Banner header
  console.log('');
  console.log('=========================================');
  console.log(`Updating ${implFile}`);
  console.log('=========================================');
  console.log('');

  const child = spawnFn('claude', [
    '-p',
    '--append-system-prompt', systemPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'sonnet',
    '--dangerously-skip-permissions',
  ], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
  });

  // Write prompt to stdin and close (matches run.ts pattern)
  child.stdin!.write(userPrompt);
  child.stdin!.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  // Set up close listener before awaiting processStream to avoid missing the event
  const closed = new Promise<void>((resolve) => {
    child.on('close', () => resolve());
  });

  try {
    if (child.stdout) {
      await processStream(child.stdout, process.stdout);
    }
    await closed;
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) {
    console.log(`Summarize timed out after ${Math.round(timeoutMs / 1000)} seconds`);
  }

  // Report result
  console.log('');
  const implPath = path.join(projectRoot, implFile);
  if (fs.existsSync(implPath)) {
    const content = fs.readFileSync(implPath, 'utf-8');
    const lines = content.split('\n').length;
    console.log(`${implFile} updated (${lines} lines)`);
  } else {
    console.log(`${implFile} was not created`);
  }
}
