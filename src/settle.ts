import type { Task } from './types';
import type { ValidateTaskTestsOpts, ValidationResult } from './test-validator';
import type { TasksFile } from './tasks-file';
import { BRAND } from './brand';

/**
 * Post-iteration settlement: validate the task's tests, apply the
 * consecutive-revert and same-task stall guards, and re-read the task's status.
 *
 * Shared by `cairn run` and the interactive round commands so both modes run
 * one tested implementation of the logic that decides what an iteration did.
 */

/**
 * Consecutive post-iteration validation reverts tolerated before a task is
 * forced to 'blocked'.
 *
 * A revert puts the task back to 'in-progress', and selectNextTask returns any
 * in-progress task ahead of all pending work — so without this guard a task the
 * agent cannot get past is re-picked every iteration for the rest of the run.
 * Fixed at 2 on purpose: one revert is a normal "agent left work unfinished"
 * signal worth retrying, two in a row is a livelock. Not configurable.
 */
export const REVERT_BLOCK_THRESHOLD = 2;

/**
 * Consecutive iterations a task may be selected as 'pending' and left 'pending'
 * before it is forced to 'blocked'.
 *
 * The agent never calling `cairn task start` is a no-op iteration: the task
 * stays pending, so the loop re-selects it next time and every iteration still
 * reports SUCCESS. The usual cause is environmental (a `permissions.deny` rule
 * for `cairn task`), so retrying cannot help. Fixed at 3 on purpose, same
 * reasoning as REVERT_BLOCK_THRESHOLD: three identical no-op iterations are
 * unambiguous, and a misconfigured value would re-hide the failure. Not
 * configurable.
 */
export const STALL_BLOCK_THRESHOLD = 3;

/** Squash a validation message into a single readable line for a task note. */
export function summarizeFailure(message: string | undefined): string {
  if (!message) return 'unknown command';
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
}

export interface BlockTaskOpts {
  tasksFilePath: string;
  dataDir: string;
  taskId: number;
  note: string;
}

export type GuardKind = 'reverts' | 'stalls';

/** Per-task consecutive counts backing the revert and stall guards. */
export interface GuardCounters {
  get(taskId: number, kind: GuardKind): number;
  set(taskId: number, kind: GuardKind, n: number): void;
  clear(taskId: number, kind: GuardKind): void;
}

/**
 * Map-backed counters. In-memory and per-instance on purpose: a livelock only
 * matters inside a single run, so a fresh instance per run resets naturally on
 * restart and needs no schema/Task field.
 */
export function createInMemoryGuardCounters(): GuardCounters {
  const maps: Record<GuardKind, Map<number, number>> = {
    reverts: new Map(),
    stalls: new Map(),
  };
  return {
    get: (taskId, kind) => maps[kind].get(taskId) ?? 0,
    set: (taskId, kind, n) => { maps[kind].set(taskId, n); },
    clear: (taskId, kind) => { maps[kind].delete(taskId); },
  };
}

export interface SettleTaskInput {
  task: Task;
  /** Status snapshot at selection time — the stall guard compares against this. */
  selectedStatus: Task['status'];
  tasksFilePath: string;
  dataDir: string;
  projectRoot: string;
  iteration: number;
  iterationLogPath: string;
}

export interface SettleTaskDeps {
  validateTaskTests: (opts: ValidateTaskTestsOpts) => Promise<ValidationResult>;
  readTasksFile: (filePath: string, opts?: { dataDir?: string }) => { data: TasksFile; repaired: boolean; restored: boolean; error?: string };
  blockTask: (opts: BlockTaskOpts) => void;
  appendFileSync: (p: string, content: string) => void;
  log: (...args: unknown[]) => void;
  counters: GuardCounters;
}

export interface SettleTaskResult {
  validation: ValidationResult;
  /** Task status re-read from tasks.json; 'unknown' when unreadable or missing. */
  updatedTaskStatus: string;
  /** True when a guard successfully forced the task to 'blocked'. */
  blockedByGuard: boolean;
  /** True when the re-read had to repair or restore tasks.json. */
  corrupted: boolean;
}

export async function settleTask(input: SettleTaskInput, deps: SettleTaskDeps): Promise<SettleTaskResult> {
  const { task, selectedStatus, tasksFilePath, dataDir, projectRoot, iteration, iterationLogPath } = input;
  const { counters } = deps;
  let blockedByGuard = false;
  let corrupted = false;

  // k. Post-iteration: validate tests
  const validation = await deps.validateTaskTests({
    task,
    tasksFilePath,
    projectRoot,
  });

  // k2. Consecutive-revert guard. A 'failed' validation reverted the task to
  // in-progress; two in a row means the loop would otherwise re-pick it
  // forever, so block it and let the run continue with other work.
  if (validation.status === 'failed') {
    const reverts = counters.get(task.id, 'reverts') + 1;
    counters.set(task.id, 'reverts', reverts);

    if (reverts >= REVERT_BLOCK_THRESHOLD) {
      const note = `Blocked by ${BRAND.name} after ${reverts} consecutive post-iteration test validation failures. Last failing command — ${summarizeFailure(validation.message)}`;
      try {
        deps.blockTask({ tasksFilePath, dataDir, taskId: task.id, note });
        blockedByGuard = true;
        deps.log(`Task #${task.id} blocked after ${reverts} consecutive validation failures — moving on.`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration}: Task #${task.id} BLOCKED after ${reverts} consecutive validation failures\n`);
      } catch (err) {
        deps.log(`Failed to block task #${task.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Start the count over: if a human unblocks the task mid-run it gets a
      // fresh pair of attempts rather than re-blocking on the first revert.
      counters.clear(task.id, 'reverts');
    }
  } else if (validation.status === 'passed') {
    counters.clear(task.id, 'reverts');
  }

  // k3. Re-read task status from tasks.json (the agent may have updated it).
  // Unconditional on purpose: both the stall guard below and the post-task
  // review gate need it, and gating it on review.postTask would silently
  // disable the guard on every project that has review turned off.
  let updatedTaskStatus = 'unknown';
  try {
    const result = deps.readTasksFile(tasksFilePath, { dataDir });
    if (result.repaired || result.restored) corrupted = true;
    const updatedTask = (result.data.tasks ?? []).find((t: Task) => t.id === task.id);
    if (updatedTask) {
      updatedTaskStatus = updatedTask.status;
    }
  } catch {
    // Unreadable: 'unknown' leaves the guard neutral and skips the review.
  }

  // k4. Same-task stall guard. A task selected as 'pending' that is *still*
  // pending afterwards means the agent never ran `cairn task start` — a
  // no-op iteration that reports SUCCESS and gets re-selected forever.
  // Anything else observed (in-progress, complete, blocked) is real
  // progress and resets the count; an unreadable file is neutral.
  if (updatedTaskStatus === 'pending') {
    if (selectedStatus === 'pending') {
      const stalls = counters.get(task.id, 'stalls') + 1;
      counters.set(task.id, 'stalls', stalls);

      if (stalls >= STALL_BLOCK_THRESHOLD) {
        const note = `Blocked by ${BRAND.name} after ${stalls} consecutive iterations in which the agent never moved the task out of 'pending'. The usual cause is a permissions.deny rule for 'cairn task' in .claude/settings.local.json — which is NOT bypassed by --dangerously-skip-permissions, so the agent silently cannot run 'cairn task start'/'complete' and every iteration still reports SUCCESS.`;
        try {
          deps.blockTask({ tasksFilePath, dataDir, taskId: task.id, note });
          blockedByGuard = true;
          deps.log(`Task #${task.id} blocked after ${stalls} consecutive iterations that left it 'pending' — the agent is likely unable to run 'cairn task start'. Moving on.`);
          deps.appendFileSync(iterationLogPath, `Iteration ${iteration}: Task #${task.id} BLOCKED after ${stalls} consecutive iterations still 'pending'\n`);
        } catch (err) {
          deps.log(`Failed to block task #${task.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Start over, so a human fixing the permissions rule mid-run gets a
        // fresh set of attempts rather than an instant re-block.
        counters.clear(task.id, 'stalls');
      }
    }
  } else if (updatedTaskStatus !== 'unknown') {
    counters.clear(task.id, 'stalls');
  }

  return { validation, updatedTaskStatus, blockedByGuard, corrupted };
}
