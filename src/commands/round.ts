import * as fs from 'fs';
import * as path from 'path';
import type { AgentInfo, CairnConfig, Task } from '../types';
import { loadCompletedIds, selectNextTask, buildIterationPrompt } from '../task-selector';
import { runHealthCheck as defaultRunHealthCheck, type HealthCheckOpts, type HealthCheckResult } from '../health-check';
import { readTasksFile } from '../tasks-file';
import { captureGitSha as defaultCaptureGitSha } from '../post-task-reviewer';
import { fileRunStateStore, newAttemptRecord, type RunStateStore } from '../run-state';
import { reviewPromptFilePath, reviewVerdict, writeReviewPromptFile as defaultWriteReviewPromptFile, type WriteReviewPromptFileOpts } from '../settle';
import { buildSystemPrompt, resolveTaskModel } from './run';
import { tempFilePath } from '../utils';
import { BRAND } from '../brand';

/**
 * `cairn round next` — the pick step of `/cairn-run`. Decides what the run
 * agent does next and writes everything the task agent needs to a prompt
 * file, so the run agent never reads tasks.json itself.
 */

export type RoundNextResult =
  | { verdict: 'review'; taskId: number; reviewPromptFile: string; next: string }
  | { verdict: 'round-done'; blocked: number; next: string }
  | { verdict: 'task'; taskId: number; title: string; iteration: number; model: string; promptFile: string; next: string };

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
}

/** `.cairn_task_<id>_prompt.md` in the data dir. */
export function taskPromptFilePath(dataDir: string, taskId: number): string {
  return tempFilePath(dataDir, `task_${taskId}_prompt.md`);
}

export async function roundNext(input: RoundNextInput, deps: RoundNextDeps = {}): Promise<RoundNextResult> {
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
  if (!task) {
    const blocked = tasks.filter((t) => t.status === 'blocked').length;
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

  // 4–5. Attempt record and iteration, in one short locked update. A re-pick
  // keeps the first attempt's beforeSha so the review covers every attempt;
  // HEAD is captured outside the lock, and only for a new record.
  const attemptKey = String(task.id);
  const capturedSha = state.attempts[attemptKey] ? null : (deps.captureGitSha ?? defaultCaptureGitSha)(projectRoot);
  const iteration = store.update(dataDir, (s) => {
    const next = s.iteration + 1;
    s.iteration = next;
    const record = s.attempts[attemptKey];
    if (record) {
      record.iteration = next;
    } else {
      s.attempts[attemptKey] = newAttemptRecord(capturedSha, next);
    }
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
