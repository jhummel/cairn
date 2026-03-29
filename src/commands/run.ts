import * as fs from 'fs';
import * as path from 'path';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';
import type { RalphConfig, AgentInfo } from '../types';
import { type ProcessManager } from '../process';
import { processStream, type ProcessStreamOptions } from '../stream-filter';

export interface SystemPromptInput {
  taskDir: string;
  taskAgent: string;
  projectRoot: string;
  dataDir: string;
  config: RalphConfig;
  agents: AgentInfo[];
  iteration: number;
  commitPrefix?: string;
}

/**
 * Strip YAML frontmatter (--- delimited) from markdown content, returning the body.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

/**
 * Build the system prompt for a task execution agent.
 * Ports build_system_prompt() from ralph_execute.sh.
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const { taskDir, taskAgent, projectRoot, dataDir, config, agents, iteration, commitPrefix: commitPrefixOverride } = input;

  const tasksFile = path.join(dataDir, 'tasks.json');
  const completeFlag = path.join(dataDir, '.ralph_complete');

  // Derive commit prefix
  let commitPrefix: string;
  if (commitPrefixOverride) {
    commitPrefix = commitPrefixOverride;
  } else if (taskDir) {
    commitPrefix = path.basename(taskDir);
  } else {
    commitPrefix = path.basename(projectRoot);
  }

  // --- Specialist Instructions ---
  let specialistSection = '';
  if (taskAgent) {
    const agentInfo = agents.find(a => a.name === taskAgent);
    if (agentInfo) {
      const agentFilePath = path.join(projectRoot, '.claude', 'agents', agentInfo.file);
      if (fs.existsSync(agentFilePath)) {
        const body = stripFrontmatter(fs.readFileSync(agentFilePath, 'utf-8'));
        if (body) {
          specialistSection = `SPECIALIST INSTRUCTIONS:
You have been assigned as a specialist agent for this task. Follow these instructions in addition to your standard workflow:

${body}

---
`;
        }
      }
    }
  }

  // --- Project Description ---
  let projectDesc = '';
  if (config.projectDescription) {
    projectDesc = `\nProject description: ${config.projectDescription}`;
  }

  // --- Personal Instructions ---
  let personalInstructions = '';
  const instructionsFile = path.join(dataDir, 'instructions.md');
  if (fs.existsSync(instructionsFile)) {
    const content = fs.readFileSync(instructionsFile, 'utf-8');
    if (content.trim()) {
      personalInstructions = `\nPERSONAL INSTRUCTIONS:\n${content}\n`;
    }
  }

  // --- Directory ---
  const dirLabel = taskDir || 'project root';

  // --- Test instruction ---
  let testInstruction = '4. Run the tests listed in the task.';
  if (config.defaultTestCommand) {
    testInstruction = `4. Run the tests listed in the task. If none are listed, run '${config.defaultTestCommand}' if available.`;
  }

  const prompt = `${specialistSection}You are working on the ${config.projectName} project.${projectDesc}
${personalInstructions}
DIRECTORY:
- Your working directory is: ${dirLabel}
- You may work wherever needed to complete the task

CONTEXT:
- This is a FRESH agent instance with no memory of previous iterations
- The root CLAUDE.md is already loaded in your system prompt — do NOT re-read it
- If a directory-level CLAUDE.md or README.md exists in your working directory, read it before starting work

SUBAGENT STRATEGY:
- Use up to 10 parallel Sonnet subagents for codebase exploration, reading multiple files, and searching. Prefer targeted reads over broad sweeps.
- Use only 1 subagent for builds and tests (backpressure — avoid parallel test runs stomping on each other).
- Use an Opus subagent only when stuck on a genuinely hard problem (debugging a subtle issue, an architectural decision with trade-offs). Most tasks don't need one.

YOUR WORKFLOW:
Your assigned task is provided in the user prompt. Do NOT read tasks.json to find your task — it's already been extracted for you.
1. IMMEDIATELY set the task's status to 'in-progress' in '${tasksFile}' before doing any implementation work
2. If the task has files listed, focus on those files. Otherwise explore the codebase to understand it.
3. Implement the task COMPLETELY. No placeholders, no stubs, no TODOs. Incomplete implementations waste an entire future iteration redoing the same work.
${testInstruction}
5. Update '${tasksFile}' to mark the task complete. Use Edit to set these fields on the task object:
   - status: 'complete'
   - completedAt: Current ISO 8601 timestamp (e.g., '2025-01-25T14:32:15Z')
   - completedBy: 'iteration-N' where N is the iteration number from the prompt
   - notes: Observations, warnings, or suggestions for future iterations
6. If '${tasksFile}' has no remaining pending/in-progress tasks, create the file '${completeFlag}'
7. Make a focused git commit with message format: '[${commitPrefix}] Task #<id>: <title>'

DISCOVER AND DOCUMENT:
- If you discover bugs or missing functionality UNRELATED to your task, add them as new pending tasks in '${tasksFile}' (next available ID, low priority). Include a 'directory' field indicating where the work should happen. Max 3 discovered tasks per iteration.
- New tasks need at minimum: id, priority, title, description, directory, status ('pending'), files (array), dependencies (array), tests (array).
- If you learn something operational about a module (config quirk, undocumented dependency), add a brief note to the directory-level CLAUDE.md.
- Keep CLAUDE.md strictly operational (build commands, config quirks, gotchas). No status updates, no progress notes, no task history.

CRITICAL RULES:
- Work on EXACTLY ONE task per iteration — the one assigned in the prompt
- Set status to 'in-progress' BEFORE starting implementation
- Mark the task complete in ${tasksFile} BEFORE creating ${completeFlag}
- Be thorough with notes — help the next agent understand what you did
- Keep responses concise. Use Edit for surgical changes — do NOT Write entire large files in one shot.`;

  return prompt;
}

// --- Claude agent spawner ---

type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined>; stdio: any[] },
) => ChildProcess;

type ProcessStreamFn = (
  input: Readable,
  output: Writable,
  options?: ProcessStreamOptions,
) => Promise<void>;

export interface SpawnClaudeDeps {
  spawn?: SpawnFn;
  processStreamFn?: ProcessStreamFn;
}

export interface SpawnClaudeOpts {
  prompt: string;
  systemPrompt: string;
  model: string;
  projectRoot: string;
  taskDir: string;
  timeout: number;
  processManager: ProcessManager;
  streamOpts?: ProcessStreamOptions;
  deps?: SpawnClaudeDeps;
}

/**
 * Spawn a Claude agent process, pipe the prompt to stdin, stream stdout
 * through processStream, and return the exit code.
 * Ports run_claude() from ralph_execute.sh.
 */
export async function spawnClaude(opts: SpawnClaudeOpts): Promise<{ exitCode: number }> {
  const {
    prompt,
    systemPrompt,
    model,
    projectRoot,
    taskDir,
    timeout,
    processManager,
    streamOpts,
    deps,
  } = opts;

  const doSpawn: SpawnFn = deps?.spawn ?? (nodeSpawn as any);
  const doProcessStream: ProcessStreamFn = deps?.processStreamFn ?? processStream;

  const cwd = taskDir ? path.join(projectRoot, taskDir) : projectRoot;

  // Unset ANTHROPIC_API_KEY to force Max plan usage
  const env = { ...process.env, ANTHROPIC_API_KEY: '' };

  const args = [
    '-p',
    '--append-system-prompt', systemPrompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--model', model,
    '--verbose',
  ];

  const child = doSpawn('claude', args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  // Register with ProcessManager for signal cleanup
  if (child.pid) {
    processManager.register('claude', child.pid);
  }

  // Write prompt to stdin and close
  child.stdin!.write(prompt);
  child.stdin!.end();

  // Pipe stdout through stream filter
  const streamPromise = doProcessStream(child.stdout!, process.stdout, streamOpts);

  // Set up timeout
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (timeout > 0) {
    timeoutTimer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);
  }

  // Wait for child to exit
  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code: number | null) => {
      resolve(code ?? 1);
    });
  });

  // Clear timeout on normal exit
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
  }

  // Wait for stream processing to finish
  await streamPromise.catch(() => {});

  // Unregister from ProcessManager
  processManager.unregister('claude');

  return { exitCode };
}
