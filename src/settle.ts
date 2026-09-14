import type { Task } from './types';
import type { ValidateTaskTestsOpts, ValidationResult } from './test-validator';
import type { TasksFile } from './tasks-file';
import { BRAND } from './brand';
import { fileRunStateStore, newAttemptRecord, type RunStateStore } from './run-state';
import { tempFilePath } from './utils';

/**
 * Post-iteration settlement: validate the task's tests, apply the
 * consecutive-revert, incomplete, and same-task stall guards, and re-read the
 * task's status.
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
 * Consecutive iterations a task may be left 'pending' before it is forced to
 * 'blocked'.
 *
 * The agent never calling `cairn task start` is a no-op iteration: the task
 * stays pending, so the loop re-selects it next time and every iteration still
 * reports SUCCESS. The cause is environmental, not task-specific — the agent
 * couldn't run the CLI, crashed before starting, or misread its instructions —
 * so retrying cannot help. Fixed at 3 on purpose, same reasoning as
 * REVERT_BLOCK_THRESHOLD: three identical no-op iterations are unambiguous,
 * and a misconfigured value would re-hide the failure. Not configurable.
 */
export const STALL_BLOCK_THRESHOLD = 3;

/**
 * Consecutive iterations a task may be left 'in-progress' without completing
 * before it is forced to 'blocked'.
 *
 * selectNextTask returns in-progress tasks first, so a task the agent leaves
 * in-progress every time (it times out, gives up, or otherwise never reaches
 * a completion) is re-picked forever — the same livelock REVERT_BLOCK_THRESHOLD
 * guards against, but for an agent that never gets as far as a failed
 * validation. Fixed at 3, not 2 like the revert guard, and not configurable:
 * blocking early costs a human an unblock, blocking late costs one extra
 * agent session, a large task can legitimately need two sessions to finish,
 * and the third attempt deliberately hands the task to a fresh agent in case
 * the first agent's own context was the problem.
 */
export const INCOMPLETE_BLOCK_THRESHOLD = 3;

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

export type GuardKind = 'reverts' | 'stalls' | 'incompletes';

/** Per-task consecutive counts backing the revert, stall, and incomplete guards. */
export interface GuardCounters {
  get(taskId: number, kind: GuardKind): number;
  set(taskId: number, kind: GuardKind, n: number): void;
  clear(taskId: number, kind: GuardKind): void;
}

/**
 * Counters stored on the task's attempt record in the run-state file
 * (src/run-state.ts). Runtime state, not a Task field: they survive restarts
 * of `cairn run` and separate settle invocations, and `cairn task set-status`
 * is what resets them. Each operation is its own short locked update, so the
 * lock is never held across test validation.
 */
export function createRunStateGuardCounters(dataDir: string, store: RunStateStore = fileRunStateStore): GuardCounters {
  return {
    get: (taskId, kind) => store.read(dataDir).attempts[String(taskId)]?.[kind] ?? 0,
    set: (taskId, kind, n) => {
      store.update(dataDir, (state) => {
        const record = (state.attempts[String(taskId)] ??= newAttemptRecord(null, 0));
        record[kind] = n;
      });
    },
    clear: (taskId, kind) => {
      store.update(dataDir, (state) => {
        const record = state.attempts[String(taskId)];
        if (record) record[kind] = 0;
      });
    },
  };
}

/**
 * Map-backed counters that live only as long as the instance. Nothing
 * persists them, so they are for unit tests that exercise the guard logic
 * without a data dir; real callers use createRunStateGuardCounters.
 */
export function createInMemoryGuardCounters(): GuardCounters {
  const maps: Record<GuardKind, Map<number, number>> = {
    reverts: new Map(),
    stalls: new Map(),
    incompletes: new Map(),
  };
  return {
    get: (taskId, kind) => maps[kind].get(taskId) ?? 0,
    set: (taskId, kind, n) => { maps[kind].set(taskId, n); },
    clear: (taskId, kind) => { maps[kind].delete(taskId); },
  };
}

/**
 * Settle itself could not run: the task id is in neither tasks.json nor
 * tasks.completed.json. Alongside TasksFileError (unreadable tasks.json after
 * repair/recovery) and FileLockError (lock timeout), this is one of the only
 * outcomes that should exit non-zero — every verdict, blocked and
 * already-settled included, is a successful settle.
 */
export class SettleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleError';
  }
}

export type RetryMode = 'continue' | 'fresh';
export type RetryReason = 'validation-failed' | 'stalled' | 'incomplete' | 'status-unknown';

/**
 * What a settle decided, printed as JSON by `cairn round settle`. Every
 * variant carries `next`, a short imperative hint telling the driver what to
 * do, so a compacted or resumed driver never has to reconstruct it.
 */
export type Verdict =
  | { verdict: 'retry'; taskId: number; mode: RetryMode; reason: RetryReason; failure?: string; next: string }
  | { verdict: 'blocked'; taskId: number; reason: string; next: string }
  | { verdict: 'done'; taskId: number; reason?: string; next: string }
  | { verdict: 'already-settled'; taskId: number; next: string };

const NEXT_ROUND = `Run: ${BRAND.name} round next`;

function retryNext(taskId: number, mode: RetryMode): string {
  const settle = `${BRAND.name} round settle ${taskId}`;
  return mode === 'continue'
    ? `Resume the same task agent with SendMessage, then run: ${settle}. If that agent's id is lost, launch a fresh ${BRAND.name}-task-agent with the same prompt file instead.`
    : `Launch a fresh ${BRAND.name}-task-agent with the same prompt file, then run: ${settle}`;
}

export interface SettleTaskInput {
  taskId: number;
  /**
   * The task as the caller selected it. Optional: when omitted, or when no
   * attempt record exists, settle looks the task up in tasks.json itself.
   */
  task?: Task;
  tasksFilePath: string;
  dataDir: string;
  projectRoot: string;
  /** Defaults to the attempt record's iteration. */
  iteration?: number;
  /** Defaults to `tempFilePath(dataDir, 'iterations.log')`. */
  iterationLogPath?: string;
}

export interface SettleTaskDeps {
  validateTaskTests: (opts: ValidateTaskTestsOpts) => Promise<ValidationResult>;
  readTasksFile: (filePath: string, opts?: { dataDir?: string }) => { data: TasksFile; repaired: boolean; restored: boolean; error?: string };
  blockTask: (opts: BlockTaskOpts) => void;
  appendFileSync: (p: string, content: string) => void;
  log: (...args: unknown[]) => void;
  loadCompletedIds: (dataDir: string) => Set<number>;
  /** Defaults to the run-state file in `input.dataDir`. */
  runState?: RunStateStore;
  /** Defaults to counters on the attempt records in `runState`. */
  counters?: GuardCounters;
}

export interface SettleTaskResult {
  verdict: Verdict;
  /** null only for 'already-settled', which runs no validation. */
  validation: ValidationResult | null;
  /** Task status re-read from tasks.json; 'unknown' when unreadable or missing. */
  updatedTaskStatus: string;
  /** True when a guard successfully forced the task to 'blocked'. */
  blockedByGuard: boolean;
  /** True when the re-read had to repair or restore tasks.json. */
  corrupted: boolean;
}

/**
 * Settle one attempt at a task. Safe to call repeatedly: idempotency is keyed
 * on the task's attempt record, not on its archived status (a later archive
 * step must not swallow a settle that still has work to do).
 *
 * - No record, task gone from tasks.json but in tasks.completed.json →
 *   'already-settled' with no side effects.
 * - No record, task in tasks.json → the record is created lazily and settle
 *   proceeds normally.
 * - In neither file → SettleError. A tasks.json read failure propagates.
 *
 * The record is cleared on 'done' and on every block, and kept on 'retry'.
 */
export async function settleTask(input: SettleTaskInput, deps: SettleTaskDeps): Promise<SettleTaskResult> {
  const { taskId, tasksFilePath, dataDir, projectRoot } = input;
  const iterationLogPath = input.iterationLogPath ?? tempFilePath(dataDir, 'iterations.log');
  const store = deps.runState ?? fileRunStateStore;
  const counters = deps.counters ?? createRunStateGuardCounters(dataDir, store);
  const attemptKey = String(taskId);
  let blockedByGuard = false;
  let blockNote: string | null = null;
  let corrupted = false;

  const logSettle = (verdict: Verdict) => {
    const reason = 'reason' in verdict && verdict.reason ? ` (${verdict.reason.replace(/\s+/g, ' ').trim()})` : '';
    deps.appendFileSync(iterationLogPath, `Settle #${taskId}: ${verdict.verdict}${reason}\n`);
  };

  // Idempotency lookup. Skipped when the caller passed the task and a record
  // exists (the `cairn run` path), so that path adds no tasks.json read.
  let task = input.task;
  let record = store.read(dataDir).attempts[attemptKey];
  if (!record || !task) {
    const found = (deps.readTasksFile(tasksFilePath, { dataDir }).data.tasks ?? []).find((t: Task) => t.id === taskId);
    if (!found) {
      if (deps.loadCompletedIds(dataDir).has(taskId)) {
        const verdict: Verdict = { verdict: 'already-settled', taskId, next: NEXT_ROUND };
        logSettle(verdict);
        return { verdict, validation: null, updatedTaskStatus: 'complete', blockedByGuard: false, corrupted: false };
      }
      throw new SettleError(`Task #${taskId} not found in tasks.json or tasks.completed.json`);
    }
    task ??= found;
    record ??= store.update(dataDir, (state) => (state.attempts[attemptKey] ??= newAttemptRecord(null, input.iteration ?? state.iteration)));
  }
  const iteration = input.iteration ?? record.iteration;

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
        blockNote = note;
        deps.log(`Task #${task.id} blocked after ${reverts} consecutive validation failures — moving on.`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration}: Task #${task.id} BLOCKED after ${reverts} consecutive validation failures\n`);
      } catch (err) {
        deps.log(`Failed to block task #${task.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Start the count over: if a human unblocks the task it gets a fresh
      // pair of attempts rather than re-blocking on the first revert.
      counters.clear(task.id, 'reverts');
    }
  } else if (validation.status === 'passed') {
    counters.clear(task.id, 'reverts');
    counters.clear(task.id, 'incompletes');
  }

  // k3. Re-read task status from tasks.json (the agent may have updated it).
  // Unconditional on purpose: both the stall guard below and the post-task
  // review gate need it, and gating it on review.postTask would silently
  // disable the guard on every project that has review turned off.
  let updatedTaskStatus = 'unknown';
  let updatedNotes: string | undefined;
  try {
    const result = deps.readTasksFile(tasksFilePath, { dataDir });
    if (result.repaired || result.restored) corrupted = true;
    const updatedTask = (result.data.tasks ?? []).find((t: Task) => t.id === task.id);
    if (updatedTask) {
      updatedTaskStatus = updatedTask.status;
      updatedNotes = updatedTask.notes;
    }
  } catch {
    // Unreadable: 'unknown' leaves the guard neutral and skips the review.
  }

  // k3.5. Incomplete guard. A task still 'in-progress' at settle time, that
  // was NOT reverted by a failed validation above, means the agent left it
  // unfinished — it timed out, gave up, or otherwise never called
  // `cairn task complete`. Excluding a failed-validation revert keeps the two
  // guards disjoint: that iteration already counted as a revert, not this.
  if (updatedTaskStatus === 'in-progress' && validation.status !== 'failed') {
    const incompletes = counters.get(task.id, 'incompletes') + 1;
    counters.set(task.id, 'incompletes', incompletes);

    if (incompletes >= INCOMPLETE_BLOCK_THRESHOLD) {
      const note = `Blocked by ${BRAND.name} after ${incompletes} consecutive iterations that left the task 'in-progress' without completing it.`;
      try {
        deps.blockTask({ tasksFilePath, dataDir, taskId: task.id, note });
        blockedByGuard = true;
        blockNote = note;
        deps.log(`Task #${task.id} blocked after ${incompletes} consecutive iterations left 'in-progress' — moving on.`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration}: Task #${task.id} BLOCKED after ${incompletes} consecutive iterations left 'in-progress'\n`);
      } catch (err) {
        deps.log(`Failed to block task #${task.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Start the count over: if a human unblocks the task it gets a fresh
      // pair of attempts rather than re-blocking on the first incomplete.
      counters.clear(task.id, 'incompletes');
    }
  }

  // k4. Same-task stall guard. A task that is still 'pending' at settle time
  // means the agent never ran `cairn task start` — a no-op iteration that
  // reports SUCCESS and gets re-selected forever. Anything else observed
  // (in-progress, complete, blocked) is real progress and resets the count;
  // an unreadable file is neutral.
  if (updatedTaskStatus === 'pending') {
    const stalls = counters.get(task.id, 'stalls') + 1;
    counters.set(task.id, 'stalls', stalls);

    if (stalls >= STALL_BLOCK_THRESHOLD) {
      const note = `Blocked by ${BRAND.name} after ${stalls} consecutive iterations in which the agent never moved the task out of 'pending'. Likely causes: the agent could not run the ${BRAND.name} CLI (not on PATH, or a permission rule or hook denying it), it crashed or hit its turn limit before starting, or it misread its instructions.`;
      try {
        deps.blockTask({ tasksFilePath, dataDir, taskId: task.id, note });
        blockedByGuard = true;
        blockNote = note;
        deps.log(`Task #${task.id} blocked after ${stalls} consecutive iterations that left it 'pending'. Moving on.`);
        deps.appendFileSync(iterationLogPath, `Iteration ${iteration}: Task #${task.id} BLOCKED after ${stalls} consecutive iterations still 'pending'\n`);
      } catch (err) {
        deps.log(`Failed to block task #${task.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Start over, so a human who fixes the underlying cause gets a fresh
      // set of attempts rather than an instant re-block.
      counters.clear(task.id, 'stalls');
    }
  } else if (updatedTaskStatus !== 'unknown') {
    counters.clear(task.id, 'stalls');
  }

  // Verdict. A guard block wins outright; an agent-set block reports the
  // task's own notes. A failed validation below its threshold resumes the
  // same agent; a stall always gets a fresh one; an incomplete escalates from
  // continue to fresh on its second consecutive occurrence. An unknown status
  // (unreadable re-read) retries in place — the record is kept, so the next
  // settle re-reads.
  const retry = (mode: RetryMode, reason: RetryReason, failure?: string): Verdict =>
    ({ verdict: 'retry', taskId, mode, reason, ...(failure ? { failure } : {}), next: retryNext(taskId, mode) });
  let verdict: Verdict;
  if (blockedByGuard && blockNote !== null) {
    verdict = { verdict: 'blocked', taskId, reason: blockNote, next: NEXT_ROUND };
  } else if (updatedTaskStatus === 'blocked') {
    verdict = { verdict: 'blocked', taskId, reason: updatedNotes?.trim() || 'Blocked by the task agent (no notes recorded)', next: NEXT_ROUND };
  } else if (validation.status === 'failed') {
    verdict = retry('continue', 'validation-failed', validation.failureTail);
  } else if (updatedTaskStatus === 'pending') {
    verdict = retry('fresh', 'stalled');
  } else if (updatedTaskStatus === 'in-progress') {
    verdict = retry(counters.get(task.id, 'incompletes') >= 2 ? 'fresh' : 'continue', 'incomplete');
  } else if (updatedTaskStatus === 'complete') {
    verdict = { verdict: 'done', taskId, next: NEXT_ROUND };
  } else {
    verdict = retry('continue', 'status-unknown');
  }

  // Record lifecycle: the attempt is over on done or any block; a retry keeps
  // it (and its counters and beforeSha) for the next attempt.
  if (verdict.verdict !== 'retry') {
    store.update(dataDir, (state) => {
      delete state.attempts[attemptKey];
    });
  }
  logSettle(verdict);

  return { verdict, validation, updatedTaskStatus, blockedByGuard, corrupted };
}
