import * as fs from 'fs';
import * as path from 'path';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { processStream } from '../stream-filter';
import { buildAgentArgs } from '../agent-prompt';

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RunSummarizeOpts {
  projectRoot: string;
  projectName: string;
  implFile: string;
  completedTasksPath: string;
  claudeMdPattern: string;
  spawnFn?: SpawnFn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export function buildUserPrompt(opts: {
  projectRoot: string;
  projectName: string;
  implFile: string;
  completedTasksPath: string;
  claudeMdPattern: string;
}): string {
  const { projectRoot, projectName, implFile, completedTasksPath, claudeMdPattern } = opts;

  const implPath = path.join(projectRoot, implFile);
  const existsNote = fs.existsSync(implPath)
    ? `An existing ${implFile} is present — update it in place rather than starting from scratch.`
    : `No existing ${implFile} — create it from scratch.`;

  let completedNote = '';
  if (fs.existsSync(completedTasksPath)) {
    const rel = path.relative(projectRoot, completedTasksPath);
    completedNote = `\nCompleted tasks are in ${rel} — review them for context on what was built.`;
  }

  let pruningSection: string;
  if (claudeMdPattern) {
    pruningSection = `After updating ${implFile}, review each module's CLAUDE.md file (${claudeMdPattern}).`;
  } else {
    pruningSection = `After updating ${implFile}, look for any module-level CLAUDE.md files in the project.`;
  }
  pruningSection += `
For each CLAUDE.md:
- Remove entries that are no longer accurate
- Deduplicate entries that say the same thing in different words
- Keep it strictly operational: build commands, config quirks, gotchas
- Remove any status updates, progress notes, or task history that crept in
Do NOT remove entries you're unsure about — when in doubt, keep them.`;

  return `PROJECT: ${projectName}
IMPLEMENTATION FILE: ${implFile}
${existsNote}
${completedNote}
CLAUDE.MD PRUNING:
${pruningSection}

Update ${implFile} with the current state of the entire system. Read the codebase thoroughly and write a comprehensive but concise summary.`;
}

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

  const userPrompt = buildUserPrompt({
    projectRoot,
    projectName,
    implFile,
    completedTasksPath,
    claudeMdPattern,
  });

  // Banner header
  console.log('');
  console.log('=========================================');
  console.log(`Updating ${implFile}`);
  console.log('=========================================');
  console.log('');

  const child = spawnFn('claude', [
    '-p',
    ...buildAgentArgs('summarizer', 'Technical writer / architecture documenter', projectRoot),
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
