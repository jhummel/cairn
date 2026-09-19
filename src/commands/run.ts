import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';
import type { CairnConfig, AgentInfo, Task } from '../types';
import { ProcessManager, type ProcessManagerOptions } from '../process';
import { processStream, sendToNarrate as defaultSendToNarrate, sendNtfy as defaultSendNtfy, type ProcessStreamOptions, type NtfyOpts } from '../stream-filter';
import { startNarrationServer as defaultStartNarrationServer, stopNarrationServer as defaultStopNarrationServer, checkNarrationHealth as defaultCheckNarrationHealth, findNarrationSocketPath as defaultFindNarrationSocketPath, type StartNarrationOpts } from '../narration';
import { loadCompletedIds as defaultLoadCompletedIds, selectNextTask as defaultSelectNextTask, buildIterationPrompt as defaultBuildIterationPrompt, resolveTaskModel } from '../task-selector';

// Re-exported from its neutral home so settle.ts can use it without a cycle.
export { resolveTaskModel };
import { runHealthCheck as defaultRunHealthCheck, type HealthCheckResult } from '../health-check';
import { validateTaskTests as defaultValidateTaskTests, formatTestSummary, type ValidateTaskTestsOpts, type ValidationResult } from '../test-validator';
import { archiveCompletedTasks as defaultArchiveCompletedTasks, type ArchiveResult } from '../task-archiver';
import { captureGitSha as defaultCaptureGitSha, runPostTaskReview as defaultRunPostTaskReview, type RunPostTaskReviewOpts } from '../post-task-reviewer';
import { loadPersonalInstructions } from '../personal-instructions';
import { readTasksFile as defaultReadTasksFile, snapshotTasksFile as defaultSnapshotTasksFile, mutateTasksFile as defaultMutateTasksFile, TasksFileError, type TasksFile } from '../tasks-file';
import { tempFilePath } from '../utils';
import { BRAND, NOTES_TEMP_PREFIX } from '../brand';
import { settleTask, createRunStateGuardCounters, findTaskBaseSha, type BlockTaskOpts, type SettleTaskDeps, type SettleTaskInput } from '../settle';
import { ensureAttemptRecord, fileRunStateStore, type RunStateStore } from '../run-state';

export type { BlockTaskOpts } from '../settle';

export interface SystemPromptInput {
  taskDir: string;
  taskAgent: string;
  projectRoot: string;
  dataDir: string;
  config: CairnConfig;
  agents: AgentInfo[];
  iteration: number;
  commitPrefix?: string;
  // 'headless' (default): a fresh `claude -p` process spawned by spawnClaude,
  // with its own cwd set per-task and a completion flag it must create itself.
  // 'subagent': a `cairn-task-agent` subagent launched under `/cairn-run`. It
  // inherits the interactive session's cwd (so the working directory must be
  // stated as an absolute path) and reports back to a run agent that only
  // wants a tiny report, not full completion notes — `cairn round next`
  // detects round-done on its own, so there is no completion flag to create.
  mode?: 'headless' | 'subagent';
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
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const { taskDir, taskAgent, projectRoot, dataDir, config, agents, iteration, commitPrefix: commitPrefixOverride, mode = 'headless' } = input;
  const isSubagent = mode === 'subagent';

  const tasksFile = path.join(dataDir, 'tasks.json');
  const completeFlag = tempFilePath(dataDir, 'complete');
  // Notes tempfiles keep their own permanent prefix: write-and-sweep scratch,
  // never read back, and renaming them would only churn committed history.
  const notesFile = path.join(dataDir, `${NOTES_TEMP_PREFIX}task_<id>_notes.md`);

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
      if (agentInfo.internal) {
        console.warn(`[${BRAND.name}] Agent '${taskAgent}' is marked internal and cannot be used as a task specialist — falling back to generalist prompt.`);
      } else {
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
  }

  // --- Project Description ---
  let projectDesc = '';
  if (config.projectDescription) {
    projectDesc = `\nProject description: ${config.projectDescription}`;
  }

  // --- Personal Instructions ---
  const personalInstructions = loadPersonalInstructions(dataDir);

  // --- Directory ---
  // In subagent mode the agent inherits the interactive session's cwd, not a
  // per-task cwd (only spawnClaude sets that) — so the working directory must
  // be spelled out as an absolute path, with an explicit cd/absolute-paths
  // instruction, rather than the relative label headless mode uses.
  const dirLabel = isSubagent
    ? (taskDir ? path.join(projectRoot, taskDir) : projectRoot)
    : (taskDir || 'project root');
  const dirCdInstruction = isSubagent
    ? `\n- You did not inherit a per-task working directory — cd there first, or use absolute paths for every file operation`
    : '';

  // --- Test instruction ---
  let testInstruction = '4. Run the tests listed in the task.';
  if (config.defaultTestCommand) {
    testInstruction = `4. Run the tests listed in the task. If none are listed, run '${config.defaultTestCommand}' if available.`;
  }

  // --- Workflow steps ---
  const workflowSteps: string[] = [
    `1. Run: cairn task start <id> --iteration ${iteration}`,
    `2. If the task has files listed, focus on those files. Otherwise explore the codebase to understand it.`,
    `3. Implement the task COMPLETELY. No placeholders, no stubs, no TODOs. Incomplete implementations waste an entire future iteration redoing the same work.`,
    testInstruction,
    `5. Mark the task complete:\n   (a) Write your completion notes to ${notesFile} using the Write tool (substitute <id> with the task ID)\n   (b) Run: cairn task complete <id> --iteration ${iteration} --notes-file ${notesFile}`,
  ];
  // Headless mode is the only one with a completion flag to create — under
  // /cairn-run, `cairn round next` detects round-done on its own.
  if (!isSubagent) {
    workflowSteps.push(`6. If '${tasksFile}' has no remaining pending/in-progress tasks, create the file '${completeFlag}'`);
  }
  workflowSteps.push(`${isSubagent ? 6 : 7}. Make a focused git commit with message format: '[${commitPrefix}] Task #<id>: <title>'`);

  // --- Report contract (subagent only) ---
  // The subagent's parent is a run agent that only wants a tiny report — full
  // detail belongs in the completion notes, not here.
  const reportSection = isSubagent ? `

REPORT:
When finished, return a report of at most 5 lines: task id, outcome, commit sha, and anything blocking. Put details in the completion notes via --notes-file, not in this report.
If you cannot finish, leave the task in-progress and say so in the report. Only for a genuine external blocker, first record a note with \`cairn task note <id> "..."\` and run \`cairn task set-status <id> blocked\`, then say so in the report.` : '';

  // --- Critical rules ---
  const criticalRules: string[] = [
    `- Work on EXACTLY ONE task per iteration — the one assigned in the prompt`,
    `- Set status to 'in-progress' BEFORE starting implementation`,
  ];
  if (!isSubagent) {
    criticalRules.push(`- Mark the task complete in ${tasksFile} BEFORE creating ${completeFlag}`);
  }
  criticalRules.push(
    `- Do NOT use Edit or Write on ${tasksFile} directly — the cairn task subcommands are the only supported path.`,
    `- Be thorough with notes — help the next agent understand what you did`,
    `- Keep responses concise. Use Edit for surgical changes — do NOT Write entire large files in one shot.`,
  );

  const prompt = `${specialistSection}You are working on the ${config.projectName} project.${projectDesc}
${personalInstructions}
DIRECTORY:
- Your working directory is: ${dirLabel}${dirCdInstruction}
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
${workflowSteps.join('\n')}${reportSection}

DISCOVER AND DOCUMENT:
- If you discover bugs or missing functionality UNRELATED to your task, use cairn task add --file <path> to append a new task (the CLI validates the payload before merging). Include a 'directory' field indicating where the work should happen. Max 3 discovered tasks per iteration.
- Do NOT supply an id — the CLI assigns one for you and prints it ('assigned id: <n>'). New tasks need at minimum: priority, title, description, directory, status ('pending'), files (array), dependencies (array), tests (array).
- If you learn something operational about a module (config quirk, undocumented dependency), add a brief note to the directory-level CLAUDE.md.
- Keep CLAUDE.md strictly operational (build commands, config quirks, gotchas). No status updates, no progress notes, no task history.

CRITICAL RULES:
${criticalRules.join('\n')}`;

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
  config: CairnConfig;
  agents: AgentInfo[];
}

export interface RunRunDeps {
  loadCompletedIds: (dataDir: string) => Set<number>;
  selectNextTask: (tasks: Task[], completedIds: Set<number>) => Task | null;
  buildIterationPrompt: (task: Task, iteration: number, maxIterations: number, prevNotes: string | null, totalRemaining: number) => string;
  buildSystemPrompt: (input: SystemPromptInput) => string;
  runHealthCheck: (opts: { healthCheck: string; projectRoot: string }) => Promise<HealthCheckResult>;
  spawnClaude: (opts: SpawnClaudeOpts) => Promise<{ exitCode: number }>;
  validateTaskTests: (opts: ValidateTaskTestsOpts) => Promise<ValidationResult>;
  archiveCompletedTasks: (opts: { tasksFilePath: string; dataDir: string; iterationLogPath?: string }) => Promise<ArchiveResult>;
  captureGitSha: (projectRoot: string) => string | null;
  runPostTaskReview: (opts: RunPostTaskReviewOpts) => Promise<void>;
  runPlan: (opts: any) => Promise<void>;
  createProcessManager: (opts?: ProcessManagerOptions) => ProcessManager;
  prompt: (question: string) => Promise<string>;
  existsSync: (p: string) => boolean;
  readTasksFile: (filePath: string, opts?: { dataDir?: string }) => { data: TasksFile; repaired: boolean; restored: boolean; error?: string };
  snapshotTasksFile: (filePath: string, dataDir: string) => void;
  readdirSync: (p: string) => string[];
  mkdirSync: (p: string, opts?: { recursive: boolean }) => void;
  unlinkSync: (p: string) => void;
  appendFileSync: (p: string, content: string) => void;
  startNarrationServer: (opts: StartNarrationOpts) => Promise<number>;
  stopNarrationServer: (pid: number, socketPath?: string) => Promise<void>;
  checkNarrationHealth: (socketPath?: string) => Promise<boolean>;
  sendToNarrate: (text: string, socketPath: string) => Promise<void>;
  findNarrationSocketPath: (projectRoot: string) => string;
  sendNtfy: (message: string, topic: string, opts?: NtfyOpts) => Promise<void>;
  blockTask: (opts: BlockTaskOpts) => void;
  runState: RunStateStore;
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
    readTasksFile: defaultReadTasksFile,
    snapshotTasksFile: defaultSnapshotTasksFile,
    readdirSync: fs.readdirSync as (p: string) => string[],
    mkdirSync: fs.mkdirSync as (p: string, opts?: { recursive: boolean }) => void,
    unlinkSync: fs.unlinkSync,
    appendFileSync: fs.appendFileSync as (p: string, content: string) => void,
    startNarrationServer: defaultStartNarrationServer,
    stopNarrationServer: defaultStopNarrationServer,
    checkNarrationHealth: defaultCheckNarrationHealth,
    sendToNarrate: defaultSendToNarrate,
    findNarrationSocketPath: defaultFindNarrationSocketPath,
    sendNtfy: defaultSendNtfy,
    blockTask: ({ tasksFilePath, dataDir, taskId, note }) => {
      // Routed through mutateTasksFile so the write is locked, atomic and
      // snapshotted — same path every `cairn task` mutation takes.
      defaultMutateTasksFile(tasksFilePath, (data) => {
        const t = (data.tasks ?? []).find((x: Task) => x.id === taskId);
        if (!t) return;
        t.status = 'blocked';
        t.notes = t.notes ? `${t.notes} | ${note}` : note;
      }, { dataDir });
    },
    runState: fileRunStateStore,
    log: console.log,
  };
}

const PATH_ADDITIONS = [
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

// Suffixes (prefix-less) of the run-scoped temp files removed at loop exit.
const TEMP_FILE_SUFFIXES = ['complete', 'prev_notes', 'completed_ids'];

/**
 * `.ralph_task_<id>_notes.md` or `.cairn_task_<id>_notes.md`, nothing else.
 *
 * NOTES_TEMP_PREFIX is the one the prompt actually hands out and is permanent,
 * so that branch is load-bearing — drop it and every iteration's scratch leaks.
 * BRAND.tempPrefix stays in the alternation defensively: an agent that spells
 * the file with the current prefix instead must not leave scratch behind.
 */
const NOTES_TEMPFILE_RE = new RegExp(
  `^(?:${[NOTES_TEMP_PREFIX, BRAND.tempPrefix].map(escapeRegExp).join('|')})task_\\d+_notes\\.md$`
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function runRun(opts: RunRunOpts, deps: RunRunDeps = defaultDeps()): Promise<void> {
  const { projectRoot, dataDir, config, agents } = opts;
  const maxIterations = opts.maxIterations ?? 30;
  const iterationTimeout = (opts.iterationTimeout ?? 900) * 1000; // convert to ms
  const tasksFilePath = path.join(dataDir, 'tasks.json');
  const iterationLogPath = tempFilePath(dataDir, 'iterations.log');

  // 1. Check for tasks.json — prompt to launch planner if missing
  if (!deps.existsSync(tasksFilePath)) {
    const answer = await deps.prompt('No tasks.json found. Launch planner? [Y/n] ');
    if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      throw new Error(`tasks.json not found. Create it first with '${BRAND.name} plan'`);
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
  deps.appendFileSync(iterationLogPath, `${BRAND.displayName} Execution Loop Started: ${new Date().toISOString()}\n\n`);

  // 5. Start narration server if enabled
  let narrationPid: number | null = null;
  const narrationEnabled = config.narration.enabled;
  // The server must bind wherever this project's .claude/hooks/*.sh dial, which
  // is the legacy path on any project that has not re-run init or migrate.
  const narrationSocketPath = deps.findNarrationSocketPath(projectRoot);

  if (narrationEnabled) {
    try {
      narrationPid = await deps.startNarrationServer({
        pythonPath: process.env.CAIRN_NARRATE_PYTHON!,
        scriptPath: path.join(process.env.CAIRN_LIB_DIR!, 'cairn_narrate_server.py'),
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
  let corruptionEvents = 0;
  // taskId -> consecutive validation reverts / pending stalls. Runtime state
  // kept on the task's attempt record in the gitignored run-state file, so
  // restarting `cairn run` no longer resets them; `cairn task set-status` is
  // the reset. Still not a Task field — they never touch tasks.json.
  const guardCounters = createRunStateGuardCounters(dataDir, deps.runState);
  // Tasks this run forced to 'blocked' — the summary's fallback count if the
  // final tasks.json read fails.
  const blockedByGuard = new Set<number>();

  try {
    // 6. Main iteration loop
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // a. Check for the completion flag.
      if (deps.existsSync(tempFilePath(dataDir, 'complete'))) {
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
              pythonPath: process.env.CAIRN_NARRATE_PYTHON!,
              scriptPath: path.join(process.env.CAIRN_LIB_DIR!, 'cairn_narrate_server.py'),
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

      // Read tasks from file (defensive: jsonrepair + snapshot recovery inside readTasksFile)
      let tasks: Task[];
      try {
        const result = deps.readTasksFile(tasksFilePath, { dataDir });
        if (result.repaired || result.restored) corruptionEvents++;
        tasks = result.data.tasks ?? [];
        // Per-iteration snapshot — captures a known-good copy before the agent touches tasks.json
        try {
          deps.snapshotTasksFile(tasksFilePath, dataDir);
        } catch {
          // snapshot failures are non-fatal
        }
      } catch (err) {
        if (err instanceof TasksFileError) {
          deps.log(`ERROR: ${err.message}`);
        } else {
          deps.log('ERROR: Failed to parse tasks.json');
        }
        break;
      }

      // d. Select next task
      const task = deps.selectNextTask(tasks, completedIds);
      if (!task) {
        deps.log('No actionable tasks remain.');
        break;
      }

      const taskModel = resolveTaskModel(task, agents);

      const taskDir = task.directory ?? '';

      // Set CAIRN_TASK_CONTEXT env var
      process.env.CAIRN_TASK_CONTEXT = task.title;

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

      // i. Record the attempt before spawn. A re-pick of the same task keeps
      // the first attempt's beforeSha so the eventual review covers every
      // attempt; only the iteration moves forward. HEAD is captured outside
      // the run-state lock, unconditionally — whether a record exists is
      // decided under the lock.
      const headSha = deps.captureGitSha(projectRoot);
      const { beforeSha } = ensureAttemptRecord(dataDir, task.id, iteration, headSha, deps.runState);

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

      // k. Settle: validate tests, apply the revert, incomplete, and stall
      // guards, re-read the task status, and — for a completed task — archive
      // it and apply the review gate (see src/settle.ts). Settle clears the
      // attempt record on done and on any block (so an unblocked task starts
      // over with fresh attempts). The loop ignores the verdict's retry mode —
      // it simply re-selects the task next iteration.
      const settleInput: SettleTaskInput = {
        taskId: task.id, task, tasksFilePath, dataDir, projectRoot, iteration, iterationLogPath, config, agents,
        // cairn run reviews with an inline prompt, not a prompt file.
        inlineReview: true,
      };
      const settleDeps: SettleTaskDeps = {
        validateTaskTests: deps.validateTaskTests,
        archiveCompletedTasks: deps.archiveCompletedTasks,
        git: { headSha: deps.captureGitSha, taskBaseSha: findTaskBaseSha },
        readTasksFile: deps.readTasksFile,
        blockTask: deps.blockTask,
        appendFileSync: deps.appendFileSync,
        log: deps.log,
        loadCompletedIds: deps.loadCompletedIds,
        runState: deps.runState,
        counters: guardCounters,
      };
      const settled = await settleTask(settleInput, settleDeps);
      if (settled.corrupted) corruptionEvents++;
      if (settled.blockedByGuard) blockedByGuard.add(task.id);
      const { updatedTaskStatus } = settled;

      // l. Post-task review. Settle has already archived the task and passed
      // the review gate; run the headless reviewer, then settle again to close
      // the review phase.
      if (settled.verdict.verdict === 'review') {
        await deps.runPostTaskReview({
          projectRoot,
          dataDir,
          task,
          taskStatus: updatedTaskStatus,
          beforeSha,
          config,
          testSummary: settled.validation ? formatTestSummary(settled.validation) : undefined,
          streamOpts,
        });
        await settleTask({ ...settleInput, reviewed: true }, settleDeps);
      }

      // m. Archive: settle archived when the task completed; otherwise still
      // sweep any task an agent completed without it being this iteration's.
      const archiveResult = settled.archive ?? await deps.archiveCompletedTasks({
        tasksFilePath,
        dataDir,
        iterationLogPath,
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
    //
    // Blocked tasks are counted from tasks.json rather than from this run's own
    // guard: agents can block tasks too, and a blocked task is neither pending
    // nor in-progress, so the completion flag fires with one still sitting
    // there. Reporting the flag alone would turn a visible livelock into a
    // silent drop.
    let blockedCount = blockedByGuard.size;
    try {
      const finalRead = deps.readTasksFile(tasksFilePath, { dataDir });
      blockedCount = (finalRead.data.tasks ?? []).filter((t: Task) => t.status === 'blocked').length;
    } catch {
      // Unreadable tasks.json — fall back to what this run blocked itself.
    }
    const allClear = completedByFlag && blockedCount === 0;

    deps.log('');
    deps.log('=========================================');
    deps.log(`${BRAND.displayName} Execution Loop Completed`);
    deps.log(`Iterations completed: ${iterationsCompleted}`);
    deps.log(`Tasks archived: ${totalArchived}`);
    if (blockedCount > 0) {
      deps.log(`Tasks blocked: ${blockedCount}`);
    }
    if (allClear) {
      deps.log('Status: ALL TASKS COMPLETE');
    } else if (completedByFlag) {
      deps.log(`Status: NO ACTIONABLE TASKS REMAIN — ${blockedCount} blocked task(s) need attention`);
    }
    if (corruptionEvents > 0) {
      deps.log(`\u26a0 ${corruptionEvents} corruption events recovered this run \u2014 see ${path.join(dataDir, 'corruption.log')}`);
    }
    deps.log('=========================================');

    let baseSummary: string;
    if (allClear) {
      baseSummary = `All tasks complete after ${iterationsCompleted} iterations`;
    } else if (completedByFlag) {
      baseSummary = `No actionable tasks remain after ${iterationsCompleted} iterations — ${blockedCount} task(s) blocked`;
    } else if (blockedCount > 0) {
      baseSummary = `Loop stopped after ${iterationsCompleted} iterations — ${blockedCount} task(s) blocked, tasks may remain`;
    } else {
      baseSummary = `Loop stopped after ${iterationsCompleted} iterations — tasks may remain`;
    }
    const summaryMsg = corruptionEvents > 0
      ? `${baseSummary} (${corruptionEvents} corruption events recovered)`
      : baseSummary;

    // Send ntfy notification
    if (config.narration.ntfyTopic) {
      const ntfyTags = allClear ? 'tada' : 'warning';
      const ntfyTitle = allClear
        ? `${BRAND.displayName} - Complete`
        : blockedCount > 0
          ? `${BRAND.displayName} - Blocked`
          : `${BRAND.displayName} - Stopped`;
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
    for (const suffix of TEMP_FILE_SUFFIXES) {
      const filePath = tempFilePath(dataDir, suffix);
      if (deps.existsSync(filePath)) {
        try {
          deps.unlinkSync(filePath);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    // Sweep per-task notes tempfiles (e.g. .ralph_task_42_notes.md) from dataDir.
    // Matches both prefixes — see NOTES_TEMPFILE_RE.
    try {
      const entries = deps.readdirSync(dataDir);
      for (const name of entries) {
        if (NOTES_TEMPFILE_RE.test(name)) {
          try {
            deps.unlinkSync(path.join(dataDir, name));
          } catch {
            // ignore cleanup errors
          }
        }
      }
    } catch {
      // dataDir may be gone mid-run — best-effort
    }
  }
}
