import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import type { AgentInfo, CairnConfig, Task } from '../types';
import { loadCompletedIds, selectNextTask, buildIterationPrompt, resolveTaskModel } from '../task-selector';
import { runHealthCheck as defaultRunHealthCheck, type HealthCheckOpts, type HealthCheckResult } from '../health-check';
import { readTasksFile, mutateTasksFile } from '../tasks-file';
import { captureGitSha as defaultCaptureGitSha } from '../post-task-reviewer';
import { fileRunStateStore, upsertAttemptRecord, orphanedAttemptKeys, pruneOrphanedAttempts, type RunStateStore } from '../run-state';
import {
  reviewPromptFilePath,
  taskPromptFilePath,
  reviewVerdict,
  writeReviewPromptFile as defaultWriteReviewPromptFile,
  settleTask,
  defaultGitAccess,
  type WriteReviewPromptFileOpts,
  type SettleTaskDeps,
  type BlockTaskOpts,
} from '../settle';

// Moved into settle.ts (the retry verdict names it); re-exported for existing importers.
export { taskPromptFilePath };
import { validateTaskTests as defaultValidateTaskTests, type ValidateTaskTestsOpts } from '../test-validator';
import { archiveCompletedTasks as defaultArchiveCompletedTasks } from '../task-archiver';
import { loadConfig, autoDetectHealthCheck } from '../config';
import { buildSystemPrompt } from './run';
import { hookErrorLogPath } from './hook';
import { sweepRoundTempFiles, defaultSweepDeps } from '../temp-sweep';
import { BRAND } from '../brand';
import { defaultStdout, defaultStderr, type Writer } from '../cli-io';

/**
 * `cairn round next` — the pick step of `/cairn-run`. Decides what the run
 * agent does next and writes everything the task agent needs to a prompt
 * file, so the run agent never reads tasks.json itself.
 */

export type RoundNextResult = (
  | { verdict: 'review'; taskId: number; reviewPromptFile: string; next: string }
  | { verdict: 'round-done'; blocked: number; next: string }
  | { verdict: 'task'; taskId: number; title: string; iteration: number; model: string; promptFile: string; next: string }
) & {
  /** Present only when there is something to warn about. */
  warnings?: string[];
};

export interface RoundNextInput {
  projectRoot: string;
  dataDir: string;
  config: CairnConfig;
  agents: AgentInfo[];
}

export interface RoundNextDeps {
  runHealthCheck?: (opts: HealthCheckOpts) => Promise<HealthCheckResult>;
  /** HEAD's sha, or null when git cannot answer. */
  captureGitSha?: (projectRoot: string) => string | null;
  writeReviewPromptFile?: (opts: WriteReviewPromptFileOpts) => string;
  runState?: RunStateStore;
  /** tasks.json reader for the round-done sweep's blocked-log check (default fs.readFileSync). */
  sweepReadFileSync?: (p: string, enc: 'utf-8') => string;
}

/**
 * Warnings for the run agent. A non-empty hook-error log means the PreToolUse
 * containment hook failed open at least once — silently, from the agent's side.
 */
function roundWarnings(dataDir: string): string[] {
  const logPath = hookErrorLogPath(dataDir);
  let text: string;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '').length;
  if (lines === 0) return [];
  return [`Hook errors logged in ${logPath} (${lines} lines) — the /${BRAND.name}-run containment hook may not be working`];
}

export async function roundNext(input: RoundNextInput, deps: RoundNextDeps = {}): Promise<RoundNextResult> {
  const result = await pickNext(input, deps);
  const warnings = roundWarnings(input.dataDir);
  return warnings.length > 0 ? { ...result, warnings } : result;
}

async function pickNext(input: RoundNextInput, deps: RoundNextDeps): Promise<RoundNextResult> {
  const { projectRoot, dataDir, config, agents } = input;
  const store = deps.runState ?? fileRunStateStore;
  const writeReview = deps.writeReviewPromptFile ?? defaultWriteReviewPromptFile;

  // 1. A review left open by settle comes first, so a crash between settle
  // and the reviewer never loses it. Lowest task id first, for determinism.
  const state = store.read(dataDir);
  const pendingReview = Object.entries(state.attempts)
    .filter(([, record]) => record.phase === 'awaiting-review')
    .map(([key, record]) => ({ taskId: Number(key), record }))
    .sort((a, b) => a.taskId - b.taskId)[0];
  if (pendingReview) {
    const { taskId, record } = pendingReview;
    const reviewPromptFile = reviewPromptFilePath(dataDir, taskId);
    if (record.beforeSha !== null && !fs.existsSync(reviewPromptFile)) {
      writeReview({ projectRoot, dataDir, taskId, beforeSha: record.beforeSha });
    }
    return reviewVerdict(taskId, reviewPromptFile);
  }

  // 2. Select. A tasks.json that repair and snapshot recovery cannot read
  // throws TasksFileError.
  const tasks: Task[] = readTasksFile(path.join(dataDir, 'tasks.json'), { dataDir }).data.tasks ?? [];
  const task = selectNextTask(tasks, loadCompletedIds(dataDir));
  // Executing records whose task left tasks.json are orphans (awaiting-review
  // ones never are). They are pruned in the task path's single update below;
  // round-done takes an update only when the snapshot shows one.
  const liveTaskIds = new Set(tasks.map((t) => t.id));
  if (!task) {
    if (orphanedAttemptKeys(state, liveTaskIds).length > 0) {
      store.update(dataDir, (s) => pruneOrphanedAttempts(s, liveTaskIds));
    }
    const blocked = tasks.filter((t) => t.status === 'blocked').length;
    // Round-scoped scratch (prompt/review-prompt/tests-log/notes files, plus
    // the flat complete/prev-notes/completed-ids files) is swept only here,
    // at round end — never per-task. See sweepRoundTempFiles.
    const sweepDeps = defaultSweepDeps();
    if (deps.sweepReadFileSync) sweepDeps.readFileSync = deps.sweepReadFileSync;
    sweepRoundTempFiles(dataDir, sweepDeps);
    return {
      verdict: 'round-done',
      blocked,
      next: blocked > 0
        ? `No ready tasks remain; ${blocked} blocked task(s) need attention. Send a notification summarizing the round, then stop.`
        : 'All tasks are done. Send a notification summarizing the round, then stop.',
    };
  }

  const taskDir = task.directory ?? '';
  fs.mkdirSync(taskDir ? path.join(projectRoot, taskDir) : projectRoot, { recursive: true });

  // 3. Health check — no run-state lock held while it runs.
  const healthResult = await (deps.runHealthCheck ?? defaultRunHealthCheck)({ healthCheck: config.healthCheck, projectRoot });

  // 4–5. Attempt record, iteration, and orphan prune, in one short locked update. A re-pick
  // keeps the first attempt's beforeSha so the review covers every attempt.
  // HEAD is captured outside the lock, unconditionally — whether a record
  // exists is decided under the lock, not from the entry read above.
  const headSha = (deps.captureGitSha ?? defaultCaptureGitSha)(projectRoot);
  const iteration = store.update(dataDir, (s) => {
    pruneOrphanedAttempts(s, liveTaskIds);
    const next = s.iteration + 1;
    s.iteration = next;
    upsertAttemptRecord(s, task.id, next, headSha);
    return next;
  });

  // 6. Prompt file. A round has no iteration cap, so "of N" is the iteration
  // the round would end on if every remaining task took one attempt.
  const totalRemaining = tasks.filter((t) => t.status === 'pending' || t.status === 'in-progress').length;
  const maxIterations = iteration + Math.max(totalRemaining, 1) - 1;
  let iterPrompt = buildIterationPrompt(task, iteration, maxIterations, null, totalRemaining);
  if (healthResult.status === 'failed' && healthResult.output) {
    iterPrompt = `${healthResult.output}\n\n---\n\n${iterPrompt}`;
  }
  const systemPrompt = buildSystemPrompt({
    taskDir,
    taskAgent: task.agent ?? '',
    projectRoot,
    dataDir,
    config,
    agents,
    iteration,
    mode: 'subagent',
  });
  const promptFile = taskPromptFilePath(dataDir, task.id);
  fs.writeFileSync(promptFile, `${systemPrompt}\n\n---\n\n${iterPrompt}\n`);

  // 7. Hand off.
  const model = resolveTaskModel(task, agents);
  return {
    verdict: 'task',
    taskId: task.id,
    title: task.title,
    iteration,
    model,
    promptFile,
    next: `Launch the Agent tool with subagent_type '${BRAND.name}-task-agent', model '${model}', prompt 'Read ${promptFile} and follow it', then run: ${BRAND.name} round settle ${task.id}`,
  };
}

/**
 * `cairn round next` as a CLI handler: prints `roundNext`'s result as a
 * single JSON object on stdout and returns the process exit code. 1 only
 * when `roundNext` itself could not run (an unreadable tasks.json, a lock
 * timeout, or any other thrown error) — every resolved verdict is 0.
 */
export interface RoundNextCommandOpts {
  projectRoot: string;
  dataDir: string;
  config: CairnConfig;
  agents: AgentInfo[];
  stdout?: Writer;
  stderr?: Writer;
}

export async function roundNextCommand(opts: RoundNextCommandOpts, deps: RoundNextDeps = {}): Promise<number> {
  const stdout = opts.stdout ?? defaultStdout();
  const stderr = opts.stderr ?? defaultStderr();
  try {
    const result = await roundNext(
      { projectRoot: opts.projectRoot, dataDir: opts.dataDir, config: opts.config, agents: opts.agents },
      deps
    );
    stdout.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (err) {
    stderr.write(`cairn round next: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/**
 * The default `blockTask` for `cairn round settle`: same behavior as the one
 * `cairn run` builds inline in `commands/run.ts`'s `defaultDeps()` — routed
 * through `mutateTasksFile` so the write is locked, atomic, and snapshotted.
 */
function defaultBlockTask({ tasksFilePath, dataDir, taskId, note }: BlockTaskOpts): void {
  mutateTasksFile(
    tasksFilePath,
    (data) => {
      const t = (data.tasks ?? []).find((x: Task) => x.id === taskId);
      if (!t) return;
      t.status = 'blocked';
      t.notes = t.notes ? `${t.notes} | ${note}` : note;
    },
    { dataDir }
  );
}

/**
 * `cairn round settle <id>` as a CLI handler: resolves `settleTask`'s deps to
 * their real implementations (each overridable for tests, the way
 * `commands/run.ts`'s `defaultDeps()` does), calls it, and prints the verdict
 * JSON on stdout. Exit 1 only when settle itself could not run — an
 * unreadable tasks.json (TasksFileError), a run-state lock timeout
 * (FileLockError), an unknown task id (SettleError), or an invalid id/option
 * — with a one-line message on stderr; every resolved verdict, 'blocked' and
 * 'already-settled' included, is 0.
 */
export interface RoundSettleCommandOpts {
  id: number;
  reviewed?: boolean;
  beforeSha?: string;
  /** Seconds; validated as a positive integer and converted to ms below. */
  testTimeoutSec?: number;
  projectRoot: string;
  dataDir: string;
  config: CairnConfig;
  /** Resolves a retry verdict's model; defaults to none (task model, else opus). */
  agents?: AgentInfo[];
  /** Defaults to `<dataDir>/tasks.json`. */
  tasksFilePath?: string;
  stdout?: Writer;
  stderr?: Writer;
}

export async function roundSettleCommand(opts: RoundSettleCommandOpts, deps: Partial<SettleTaskDeps> = {}): Promise<number> {
  const stdout = opts.stdout ?? defaultStdout();
  const stderr = opts.stderr ?? defaultStderr();

  if (!Number.isInteger(opts.id) || opts.id < 1) {
    stderr.write(`cairn round settle: invalid task id '${opts.id}'\n`);
    return 1;
  }

  let timeoutMs: number | undefined;
  if (opts.testTimeoutSec !== undefined) {
    if (!Number.isInteger(opts.testTimeoutSec) || opts.testTimeoutSec < 1) {
      stderr.write(`cairn round settle: --test-timeout must be a positive integer number of seconds, got '${opts.testTimeoutSec}'\n`);
      return 1;
    }
    timeoutMs = opts.testTimeoutSec * 1000;
  }

  const tasksFilePath = opts.tasksFilePath ?? path.join(opts.dataDir, 'tasks.json');
  // --test-timeout is applied on top of whichever validateTaskTests is in
  // play — the real one or an injected one — so overriding the dep for tests
  // never silently drops the flag.
  const baseValidateTaskTests = deps.validateTaskTests ?? defaultValidateTaskTests;
  const validateTaskTests: SettleTaskDeps['validateTaskTests'] =
    timeoutMs !== undefined
      ? (o: ValidateTaskTestsOpts) => baseValidateTaskTests({ ...o, timeoutMs })
      : baseValidateTaskTests;
  // Any log output from settle's own deps is routed to stderr, never stdout —
  // stdout carries the verdict JSON and nothing else.
  const settleDeps: SettleTaskDeps = {
    validateTaskTests,
    archiveCompletedTasks: deps.archiveCompletedTasks ?? defaultArchiveCompletedTasks,
    git: deps.git ?? defaultGitAccess,
    writeReviewPromptFile: deps.writeReviewPromptFile ?? defaultWriteReviewPromptFile,
    existsSync: deps.existsSync ?? fs.existsSync,
    readTasksFile: deps.readTasksFile ?? readTasksFile,
    blockTask: deps.blockTask ?? defaultBlockTask,
    appendFileSync: deps.appendFileSync ?? (fs.appendFileSync as (p: string, content: string) => void),
    log: deps.log ?? ((...args: unknown[]) => stderr.write(args.map(String).join(' ') + '\n')),
    loadCompletedIds: deps.loadCompletedIds ?? loadCompletedIds,
    runState: deps.runState,
    counters: deps.counters,
  };

  try {
    const { verdict } = await settleTask(
      {
        taskId: opts.id,
        tasksFilePath,
        dataDir: opts.dataDir,
        projectRoot: opts.projectRoot,
        config: opts.config,
        beforeSha: opts.beforeSha,
        reviewed: opts.reviewed,
        agents: opts.agents,
      },
      settleDeps
    );
    stdout.write(JSON.stringify(verdict) + '\n');
    return 0;
  } catch (err) {
    stderr.write(`cairn round settle: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/** Shared project context for both `round` subcommands, resolved from the env vars `setupProjectContext` sets. */
function loadRoundContext(): { projectRoot: string; dataDir: string; config: CairnConfig; agents: AgentInfo[] } {
  const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
  const dataDir = process.env.CAIRN_DATA_DIR!;
  const config = loadConfig(projectRoot);
  if (!config.healthCheck) config.healthCheck = autoDetectHealthCheck(projectRoot);
  let agents: AgentInfo[] = [];
  try {
    agents = JSON.parse(process.env.CAIRN_AGENTS_JSON ?? '[]') as AgentInfo[];
  } catch {
    // ignore parse errors
  }
  return { projectRoot, dataDir, config, agents };
}

/**
 * Wire the `round` subcommand group onto a Commander program. These commands
 * deliberately live under `round`, not `task`: task execution agents use
 * `cairn task`, and a task agent calling settle would archive its own task
 * and skip its own review.
 */
export function registerRoundCommands(program: Command): void {
  const round = program
    .command('round')
    .description(`Interactive round commands used by /${BRAND.name}-run`);

  round
    .command('next')
    .description('Pick the next round step: a pending review, a task to run, or round-done')
    .action(async () => {
      const { projectRoot, dataDir, config, agents } = loadRoundContext();
      const code = await roundNextCommand({ projectRoot, dataDir, config, agents });
      process.exit(code);
    });

  round
    .command('settle <id>')
    .description("Settle the last task attempt: validate tests, apply guards, archive, and gate for review")
    .option('--reviewed', 'Close a review phase opened by a previous settle')
    .option('--before-sha <sha>', "Override the attempt record's pre-task sha")
    .option('--test-timeout <seconds>', 'Test validation timeout, in seconds', (v) => parseInt(v, 10))
    .action(async (idStr: string, options: { reviewed?: boolean; beforeSha?: string; testTimeout?: number }) => {
      const { projectRoot, dataDir, config, agents } = loadRoundContext();
      const code = await roundSettleCommand({
        id: parseInt(idStr, 10),
        reviewed: options.reviewed,
        beforeSha: options.beforeSha,
        testTimeoutSec: options.testTimeout,
        projectRoot,
        dataDir,
        config,
        agents,
      });
      process.exit(code);
    });
}
