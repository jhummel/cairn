import * as fs from 'fs';
import * as crypto from 'crypto';
import { acquireLock } from './file-lock';
import { tempFilePath } from './utils';

/**
 * Locked, atomic store for round runtime state (guard counters, per-task
 * attempt data), persisted to a gitignored temp file inside the data dir:
 * `tempFilePath(dataDir, 'run_state.json')` (`.cairn_run_state.json`).
 * Callers must pass an already-resolved dataDir (from `findDataDir`) — never
 * rebuild the path from `BRAND.dataDir` directly (see CLAUDE.md: BRAND
 * constants are for creating paths, discovery for resolving them).
 *
 * This exists because under `/cairn-run` the loop driver is a model session
 * that can be compacted, resumed, or restarted, so in-memory guard counters
 * (reverts, stalls, incompletes) and per-task attempt data must survive that.
 *
 * LOCKING RULES (read before adding a caller):
 * - Critical sections must be SHORT. `acquireLock` treats a lock older than
 *   60s as stale and breaks it, while test validation can run up to 120s per
 *   command. Never hold the run-state lock across test validation, agent
 *   execution, or health checks — do read-modify-write in short
 *   `updateRunState` calls only.
 * - `acquireLock` is not reentrant. Lock ordering: the run-state lock may be
 *   taken before the tasks.json lock (`mutateTasksFile` takes
 *   `tasks.json.lock` internally), never the reverse — never call
 *   `updateRunState` from inside a `mutateTasksFile` callback.
 */

export type AttemptPhase = 'executing' | 'awaiting-review';

export interface AttemptRecord {
  beforeSha: string | null;
  iteration: number;
  reverts: number;
  stalls: number;
  incompletes: number;
  phase: AttemptPhase;
}

export interface RunState {
  iteration: number;
  attempts: { [taskId: string]: AttemptRecord };
}

function emptyRunState(): RunState {
  return { iteration: 0, attempts: {} };
}

function statePath(dataDir: string): string {
  return tempFilePath(dataDir, 'run_state.json');
}

/**
 * Read the run-state file. A missing file returns the empty default state.
 * An unparseable file is treated as empty and does NOT throw — runtime
 * state here is disposable, unlike tasks.json.
 */
export function readRunState(dataDir: string): RunState {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(statePath(dataDir));
  } catch {
    return emptyRunState();
  }
  try {
    const data = JSON.parse(bytes.toString('utf-8'));
    if (typeof data !== 'object' || data === null || typeof data.attempts !== 'object') {
      return emptyRunState();
    }
    return {
      iteration: typeof data.iteration === 'number' ? data.iteration : 0,
      attempts: data.attempts ?? {},
    };
  } catch {
    return emptyRunState();
  }
}

/** Build a per-process, per-call unique temp path so concurrent writers never clobber the same staging file. */
function uniqueTmpPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
}

function writeRunState(dataDir: string, state: RunState): void {
  const filePath = statePath(dataDir);
  const tmpPath = uniqueTmpPath(filePath);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Tempfile may not exist if writeFileSync failed; swallow ENOENT.
    }
    throw err;
  }
}

/**
 * Acquire the run-state lock, read the current state, apply `fn` (which may
 * mutate the state in place and/or return a value), write the result back
 * atomically, and always release the lock — even if `fn` throws. Returns
 * `fn`'s return value.
 *
 * Keep `fn` SHORT — see the locking rules in the module header.
 */
export function updateRunState<T>(dataDir: string, fn: (state: RunState) => T): T {
  const lockPath = `${statePath(dataDir)}.lock`;
  const fd = acquireLock(lockPath);
  try {
    const state = readRunState(dataDir);
    const result = fn(state);
    writeRunState(dataDir, state);
    return result;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed; ignore.
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Lock already removed (e.g. broken as stale by another writer); ignore.
    }
  }
}

/** Read the attempt record for `taskId`, or undefined if none is recorded. */
export function getAttempt(dataDir: string, taskId: string): AttemptRecord | undefined {
  return readRunState(dataDir).attempts[taskId];
}

/** Remove the attempt record for `taskId`, leaving the rest of the state untouched. */
export function clearAttempt(dataDir: string, taskId: string): void {
  updateRunState(dataDir, (state) => {
    delete state.attempts[taskId];
  });
}
