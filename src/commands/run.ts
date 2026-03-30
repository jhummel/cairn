import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';
import type { RalphConfig, AgentInfo, Task } from '../types';
import { ProcessManager, type ProcessManagerOptions } from '../process';
import { processStream, sendToNarrate as defaultSendToNarrate, sendNtfy as defaultSendNtfy, type ProcessStreamOptions, type NtfyOpts } from '../stream-filter';
import { startNarrationServer as defaultStartNarrationServer, stopNarrationServer as defaultStopNarrationServer, checkNarrationHealth as defaultCheckNarrationHealth, type StartNarrationOpts } from '../narration';
import { loadCompletedIds as defaultLoadCompletedIds, selectNextTask as defaultSelectNextTask, buildIterationPrompt as defaultBuildIterationPrompt } from '../task-selector';
import { runHealthCheck as defaultRunHealthCheck, type HealthCheckResult } from '../health-check';
import { validateTaskTests as defaultValidateTaskTests, type ValidateTaskTestsOpts, type ValidationResult } from '../test-validator';
import { archiveCompletedTasks as defaultArchiveCompletedTasks, type ArchiveResult } from '../task-archiver';
import { captureGitSha as defaultCaptureGitSha, runPostTaskReview as defaultRunPostTaskReview, type RunPostTaskReviewOpts } from '../post-task-reviewer';

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

// --- Run command orchestration ---

export interface RunRunOpts {
  maxIterations?: number;
  iterationTimeout?: number; // seconds; default 900
  projectRoot: string;
  dataDir: string;
  config: RalphConfig;
  agents: AgentInfo[];
}

export interface RunRunDeps {
  loadCompletedIds: (dataDir: string) => Set<number>;
  selectNextTask: (tasks: Task[], completedIds: Set<number>) => Task | null;
  buildIterationPrompt: (task: Task, iteration: number, maxIterations: number, prevNotes: string | null, totalRemaining: number) => string;
  buildSystemPrompt: (input: SystemPromptInput) => string;
  runHealthCheck: (opts: { healthCheck: string; taskDir: string; projectRoot: string }) => Promise<HealthCheckResult>;
  spawnClaude: (opts: SpawnClaudeOpts) => Promise<{ exitCode: number }>;
  validateTaskTests: (opts: ValidateTaskTestsOpts) => Promise<ValidationResult>;
  archiveCompletedTasks: (opts: { tasksFilePath: string; dataDir: string }) => Promise<ArchiveResult>;
  captureGitSha: (projectRoot: string) => string | null;
  runPostTaskReview: (opts: RunPostTaskReviewOpts) => Promise<void>;
  runPlan: (opts: any) => Promise<void>;
  createProcessManager: (opts?: ProcessManagerOptions) => ProcessManager;
  prompt: (question: string) => Promise<string>;
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, encoding: string) => string;
  mkdirSync: (p: string, opts?: { recursive: boolean }) => void;
  unlinkSync: (p: string) => void;
  appendFileSync: (p: string, content: string) => void;
  startNarrationServer: (opts: StartNarrationOpts) => Promise<number>;
  stopNarrationServer: (pid: number, socketPath?: string) => Promise<void>;
  checkNarrationHealth: (socketPath?: string) => Promise<boolean>;
  sendToNarrate: (text: string, socketPath: string) => Promise<void>;
  sendNtfy: (message: string, topic: string, opts?: NtfyOpts) => Promise<void>;
  log: (...args: unknown[]) => void;
}

function defaultDeps(): RunRunDeps {
  return {
    loadCompletedIds: defaultLoadCompletedIds,
    selectNextTask: defaultSelectNextTask,
    buildIterationPrompt: defaultBuildIterationPrompt,
    buildSystemPrompt,
    runHealthCheck: defaultRunHealthCheck,
    spawnClaude,
    validateTaskTests: defaultValidateTaskTests,
    archiveCompletedTasks: defaultArchiveCompletedTasks,
    captureGitSha: defaultCaptureGitSha,
    runPostTaskReview: defaultRunPostTaskReview,
    runPlan: async () => {
      // Lazy-load to avoid circular dependency
      const { runPlan } = await import('./plan');
      // This would need readline setup — for now it's a placeholder
      // Task #13 will wire this properly
      throw new Error('runPlan not wired yet');
    },
    createProcessManager: (opts?) => new ProcessManager(opts),
    prompt: async (question: string) => {
      const rl = await import('readline');
      const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise<string>((resolve) => {
        iface.question(question, (answer) => {
          iface.close();
          resolve(answer);
        });
      });
    },
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync as (p: string, encoding: string) => string,
    mkdirSync: fs.mkdirSync as (p: string, opts?: { recursive: boolean }) => void,
    unlinkSync: fs.unlinkSync,
    appendFileSync: fs.appendFileSync as (p: string, content: string) => void,
    startNarrationServer: defaultStartNarrationServer,
    stopNarrationServer: defaultStopNarrationServer,
    checkNarrationHealth: defaultCheckNarrationHealth,
    sendToNarrate: defaultSendToNarrate,
    sendNtfy: defaultSendNtfy,
    log: console.log,
  };
}

const PATH_ADDITIONS = [
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

const TEMP_FILES = ['.ralph_complete', '.ralph_prev_notes', '.ralph_completed_ids'];

export async function runRun(opts: RunRunOpts, deps: RunRunDeps = defaultDeps()): Promise<void> {
  const { projectRoot, dataDir, config, agents } = opts;
  const maxIterations = opts.maxIterations ?? 30;
  const iterationTimeout = (opts.iterationTimeout ?? 900) * 1000; // convert to ms
  const tasksFilePath = path.join(dataDir, 'tasks.json');
  const iterationLogPath = path.join(dataDir, '.ralph_iterations.log');

  // 1. Check for tasks.json — prompt to launch planner if missing
  if (!deps.existsSync(tasksFilePath)) {
    const answer = await deps.prompt('No tasks.json found. Launch planner? [Y/n] ');
    if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      throw new Error('tasks.json not found. Create it first with \'ralph plan\'');
    }
    await deps.runPlan({ projectRoot, dataDir, config, agents });
    // After plan, tasks.json should exist. If still missing, bail.
    if (!deps.existsSync(tasksFilePath)) {
      throw new Error('tasks.json not found after planning');
    }
  }

  // 2. PATH augmentation
  const currentPath = process.env.PATH ?? '';
  const newPaths = PATH_ADDITIONS.filter(p => !currentPath.includes(p));
  if (newPaths.length > 0) {
    process.env.PATH = [...newPaths, currentPath].join(':');
  }

  // 3. Initialize ProcessManager
  const processManager = deps.createProcessManager();

  // 4. Write iteration log header
  deps.appendFileSync(iterationLogPath, `Ralph Execution Loop Started: ${new Date().toISOString()}\n\n`);

  // 5. Start narration server if enabled
  let narrationPid: number | null = null;
  const narrationEnabled = config.narration.enabled;
  const narrationSocketPath = '/tmp/ralph-tts.sock';

  if (narrationEnabled) {
    try {
      narrationPid = await deps.startNarrationServer({
        pythonPath: process.env.RALPH_NARRATE_PYTHON!,
        scriptPath: path.join(process.env.RALPH_LIB_DIR!, 'ralph_narrate_server.py'),
        voice: config.narration.voice,
        socketPath: narrationSocketPath,
      });
      processManager.register('narration', narrationPid);
      deps.log(`Narration server started (PID: ${narrationPid})`);
    } catch {
      deps.log('Narration server failed to start — continuing without narration');
      narrationPid = null;
    }
  }

  let prevNotes: string | null = null;
  let iterationsCompleted = 0;
  let totalArchived = 0;
  let completedByFlag = false;

  try {
    // 6. Main iteration loop
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // a. Check for .ralph_complete flag
      const completeFlag = path.join(dataDir, '.ralph_complete');
      if (deps.existsSync(completeFlag)) {
        deps.log('Completion flag found. All tasks complete!');
        completedByFlag = true;
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration}: COMPLETION FLAG FOUND\n`);
        break;
      }

      // b. Narration health check (per-iteration)
      if (narrationEnabled && narrationPid !== null) {
        const healthy = await deps.checkNarrationHealth(narrationSocketPath);
        if (!healthy) {
          deps.log('Narration server unresponsive — restarting...');
          await deps.stopNarrationServer(narrationPid, narrationSocketPath).catch(() => {});
          processManager.unregister('narration');
          try {
            narrationPid = await deps.startNarrationServer({
              pythonPath: process.env.RALPH_NARRATE_PYTHON!,
              scriptPath: path.join(process.env.RALPH_LIB_DIR!, 'ralph_narrate_server.py'),
              voice: config.narration.voice,
              socketPath: narrationSocketPath,
            });
            processManager.register('narration', narrationPid);
          } catch {
            narrationPid = null;
          }
        }
      }

      // c. Load completed IDs
      const completedIds = deps.loadCompletedIds(dataDir);

      // Read tasks from file
      let tasks: Task[];
      try {
        const data = JSON.parse(deps.readFileSync(tasksFilePath, 'utf-8'));
        tasks = data.tasks ?? [];
      } catch {
        deps.log('ERROR: Failed to parse tasks.json');
        break;
      }

      // d. Select next task
      const task = deps.selectNextTask(tasks, completedIds);
      if (!task) {
        deps.log('No actionable tasks remain.');
        break;
      }

      // Resolve model — default to opus, with agent override
      let taskModel = task.model ?? 'opus';
      if (task.agent && !task.model) {
        const agentInfo = agents.find(a => a.name === task.agent);
        if (agentInfo?.model) {
          taskModel = agentInfo.model;
        }
      }

      const taskDir = task.directory ?? '';

      // Set RALPH_TASK_CONTEXT env var
      process.env.RALPH_TASK_CONTEXT = task.title;

      deps.log(`\n--- ITERATION ${iteration}/${maxIterations} ---`);
      deps.log(`Task #${task.id}: ${task.title}`);
      deps.log(`Model: ${taskModel}`);
      deps.log(`Directory: ${taskDir || '<project root>'}`);

      // Log iteration start
      deps.appendFileSync(iterationLogPath, `Iteration ${iteration} started: ${new Date().toISOString()} — Task #${task.id}: ${task.title}\n`);

      // Create task directory if needed
      const taskDirAbs = taskDir ? path.join(projectRoot, taskDir) : projectRoot;
      deps.mkdirSync(taskDirAbs, { recursive: true });

      // e. Run health check
      const healthResult = await deps.runHealthCheck({
        healthCheck: config.healthCheck,
        taskDir,
        projectRoot,
      });

      // f. Build iteration prompt
      const totalRemaining = tasks.filter(t => t.status === 'pending' || t.status === 'in-progress').length;
      let iterPrompt = deps.buildIterationPrompt(task, iteration, maxIterations, prevNotes, totalRemaining);

      // Prepend health check failure to prompt
      if (healthResult.status === 'failed' && healthResult.output) {
        iterPrompt = `${healthResult.output}\n\n---\n\n${iterPrompt}`;
      }

      // g. Build system prompt
      const systemPrompt = deps.buildSystemPrompt({
        taskDir,
        taskAgent: task.agent ?? '',
        projectRoot,
        dataDir,
        config,
        agents,
        iteration,
      });

      // h. Build stream options with narration/ntfy callbacks
      const streamOpts: ProcessStreamOptions = {
        truncateText: config.truncateText,
        taskContext: task.title,
      };

      if (narrationEnabled && narrationPid !== null) {
        streamOpts.narrate = (text: string) => {
          deps.sendToNarrate(text, narrationSocketPath).catch(() => {});
        };
      }

      if (config.narration.ntfyTopic) {
        const topic = config.narration.ntfyTopic;
        streamOpts.ntfy = (msg: string, ntfyOpts?: NtfyOpts) => {
          deps.sendNtfy(msg, topic, ntfyOpts).catch(() => {});
        };
      }

      // i. Capture git SHA before spawn
      const beforeSha = deps.captureGitSha(projectRoot);

      // j. Spawn Claude
      const { exitCode } = await deps.spawnClaude({
        prompt: iterPrompt,
        systemPrompt,
        model: taskModel,
        projectRoot,
        taskDir,
        timeout: iterationTimeout,
        processManager,
        streamOpts,
      });

      if (exitCode === 0) {
        deps.log(`Iteration ${iteration} completed successfully`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration} completed: ${new Date().toISOString()} — SUCCESS\n`);
      } else if (exitCode === 124) {
        deps.log(`Iteration ${iteration} timed out`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration} completed: ${new Date().toISOString()} — TIMEOUT\n`);
      } else {
        deps.log(`Iteration ${iteration} encountered errors (exit code: ${exitCode})`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration} completed: ${new Date().toISOString()} — FAILED (exit code: ${exitCode})\n`);
      }

      iterationsCompleted++;

      // k. Post-iteration: validate tests
      await deps.validateTaskTests({
        task,
        tasksFilePath,
        projectRoot,
      });

      // l. Post-task review (if enabled and task completed)
      if (config.review?.postTask) {
        // Re-read task status from tasks.json (agent may have updated it)
        let updatedTaskStatus = 'unknown';
        try {
          const updatedData = JSON.parse(deps.readFileSync(tasksFilePath, 'utf-8'));
          const updatedTask = (updatedData.tasks ?? []).find((t: Task) => t.id === task.id);
          if (updatedTask) {
            updatedTaskStatus = updatedTask.status;
          }
        } catch {
          // If we can't read, skip review
        }

        if (updatedTaskStatus === 'complete') {
          await deps.runPostTaskReview({
            projectRoot,
            dataDir,
            task,
            taskStatus: updatedTaskStatus,
            beforeSha,
            config,
            streamOpts,
          });
        }
      }

      // m. Archive completed tasks
      const archiveResult = await deps.archiveCompletedTasks({
        tasksFilePath,
        dataDir,
      });

      totalArchived += archiveResult.archivedCount;

      // l. Carry forward prevNotes
      prevNotes = archiveResult.prevNotes;
    }
  } finally {
    // 7. Stop narration server if we started it
    if (narrationPid !== null) {
      await deps.stopNarrationServer(narrationPid, narrationSocketPath).catch(() => {});
    }

    // 8. Final summary
    deps.log('');
    deps.log('=========================================');
    deps.log('Ralph Execution Loop Completed');
    deps.log(`Iterations completed: ${iterationsCompleted}`);
    deps.log(`Tasks archived: ${totalArchived}`);
    if (completedByFlag) {
      deps.log('Status: ALL TASKS COMPLETE');
    }
    deps.log('=========================================');

    const summaryMsg = completedByFlag
      ? `All tasks complete after ${iterationsCompleted} iterations`
      : `Loop stopped after ${iterationsCompleted} iterations — tasks may remain`;

    // Send ntfy notification
    if (config.narration.ntfyTopic) {
      const ntfyTags = completedByFlag ? 'tada' : 'warning';
      const ntfyTitle = completedByFlag ? 'Ralph - Complete' : 'Ralph - Stopped';
      await deps.sendNtfy(summaryMsg, config.narration.ntfyTopic, {
        title: ntfyTitle,
        tags: ntfyTags,
        priority: '4',
      }).catch(() => {});
    }

    // Narrate final summary
    if (narrationEnabled) {
      await deps.sendToNarrate(summaryMsg, narrationSocketPath).catch(() => {});
    }

    // 9. Clean up ProcessManager
    processManager.dispose();

    // Clean up temp files
    for (const file of TEMP_FILES) {
      const filePath = path.join(dataDir, file);
      if (deps.existsSync(filePath)) {
        try {
          deps.unlinkSync(filePath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
}
