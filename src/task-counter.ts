import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { acquireLock } from './file-lock';

/**
 * The persisted state object. `nextTaskId` and `round` are the fields Cairn
 * manages, but any additional keys present on disk are read and written back
 * verbatim so that independent features storing state here never clobber each
 * other.
 */
type CounterState = {
  nextTaskId?: number;
  round?: number;
  [key: string]: unknown;
};

/**
 * Cheaply read the `id` values out of a tasks file (tasks.json or
 * tasks.completed.json). A missing or unparseable/empty file contributes no
 * ids. We parse directly rather than via readTasksFile to avoid the repair /
 * snapshot machinery — for seeding we only need a best-effort max.
 */
function readTaskIds(filePath: string): number[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  if (text.trim() === '') return [];
  try {
    const parsed = JSON.parse(text) as { tasks?: Array<{ id?: unknown }> };
    if (!parsed || !Array.isArray(parsed.tasks)) return [];
    return parsed.tasks
      .map((t) => t?.id)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
  } catch {
    return [];
  }
}

/**
 * Compute the next id to hand out when no persisted counter exists yet:
 * one past the highest id seen across the archive and the active task list,
 * floored at 1 so a brand-new project starts at id 1.
 */
export function seedNextId(dataDir: string): number {
  const ids = [
    ...readTaskIds(path.join(dataDir, 'tasks.completed.json')),
    ...readTaskIds(path.join(dataDir, 'tasks.json')),
  ];
  const max = ids.reduce((m, id) => (id > m ? id : m), 0);
  return Math.max(1, max + 1);
}

function uniqueTmpPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
}

/** Atomic temp-file-then-rename write, matching writeTasksFile in tasks-file.ts. */
function writeStateAtomic(filePath: string, state: CounterState): void {
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
 * Read the raw persisted state object, preserving every field. Returns `null`
 * when the file is missing or not a JSON object. When present, `nextTaskId` is
 * validated to be a finite number; if it fails validation the field is dropped
 * but the rest of the object is preserved so callers re-seed cleanly without
 * discarding sibling fields (e.g. `round`).
 */
function readState(filePath: string): CounterState | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const state = { ...(parsed as CounterState) };
      if (!(typeof state.nextTaskId === 'number' && Number.isFinite(state.nextTaskId))) {
        delete state.nextTaskId;
      }
      return state;
    }
  } catch {
    // Fall through to treat as absent.
  }
  return null;
}

/**
 * Reserve `count` contiguous, monotonically increasing task ids. Performs an
 * atomic read -> increment-by-count -> write of <dataDir>/state.json inside the
 * shared cross-process file lock (state.json.lock), so concurrent reservations
 * from separate `cairn` processes never overlap. When state.json is missing it
 * is lazily seeded from the max existing id (see seedNextId).
 *
 * Returns the reserved ids, e.g. reserveTaskIds(dir, 3) -> [7, 8, 9].
 */
export function reserveTaskIds(dataDir: string, count = 1): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`reserveTaskIds: count must be a positive integer, got ${count}`);
  }

  const statePath = path.join(dataDir, 'state.json');
  const lockPath = `${statePath}.lock`;
  const fd = acquireLock(lockPath);
  try {
    const existing = readState(statePath);
    const start =
      existing && typeof existing.nextTaskId === 'number'
        ? existing.nextTaskId
        : seedNextId(dataDir);

    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(start + i);

    writeStateAtomic(statePath, { ...(existing ?? {}), nextTaskId: start + count });
    return ids;
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

/**
 * Read the current planning round from <dataDir>/state.json. An absent file,
 * absent field, or non-finite value all mean "round 1" (the lazy seed). This is
 * a pure read: it never creates or mutates state.json.
 */
export function getRound(dataDir: string): number {
  const statePath = path.join(dataDir, 'state.json');
  const existing = readState(statePath);
  if (existing && typeof existing.round === 'number' && Number.isFinite(existing.round)) {
    return existing.round;
  }
  return 1;
}

/**
 * Atomically start a new planning round in <dataDir>/state.json and return the
 * new value. Runs under the same state.json.lock and temp-file-rename machinery
 * as reserveTaskIds. An existing numeric round is incremented; an absent or
 * non-finite round is set to 1, so the first `cairn round new` (run by
 * /generate-tasks) in a fresh project starts round 1. (getRound still *reads*
 * an absent round as 1.) Every other field (nextTaskId and any unknown keys) is
 * preserved exactly, except the top-level keys named in `opts.clear`, which are
 * removed in the same write as the bump. That is for round-scoped state that a
 * new round makes obsolete: because an absent round both reads as 1 and bumps
 * to 1, such state cannot rely on its stored round number no longer matching.
 * `round` and `nextTaskId` are never removed.
 */
export function bumpRound(dataDir: string, opts: { clear?: readonly string[] } = {}): number {
  const statePath = path.join(dataDir, 'state.json');
  const lockPath = `${statePath}.lock`;
  const fd = acquireLock(lockPath);
  try {
    const existing = readState(statePath);
    const next =
      existing && typeof existing.round === 'number' && Number.isFinite(existing.round)
        ? existing.round + 1
        : 1;

    const state: CounterState = { ...(existing ?? {}) };
    for (const key of opts.clear ?? []) {
      if (key !== 'round' && key !== 'nextTaskId') delete state[key];
    }
    writeStateAtomic(statePath, { ...state, round: next });
    return next;
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

/**
 * Read one top-level value from <dataDir>/state.json. A pure read: it never
 * creates or mutates the file. Returns `undefined` when the file is missing,
 * is not a JSON object, or has no such key.
 */
export function readStateValue(dataDir: string, key: string): unknown {
  const existing = readState(path.join(dataDir, 'state.json'));
  return existing ? existing[key] : undefined;
}

/**
 * Atomically replace one top-level value in <dataDir>/state.json. Under the
 * same state.json.lock and temp-file-rename machinery as reserveTaskIds and
 * bumpRound: read the state, call `fn` with the value currently stored under
 * `key` (`undefined` when absent), store what it returns, and return that.
 * Every other field (nextTaskId, round and any unknown keys) is preserved
 * exactly; a missing state.json is created holding just `key`. If `fn` throws,
 * nothing is written. `fn` runs inside the lock, so it must be short and must
 * not itself take the state.json lock.
 */
export function updateStateValue<T>(
  dataDir: string,
  key: string,
  fn: (current: unknown) => T,
): T {
  const statePath = path.join(dataDir, 'state.json');
  const lockPath = `${statePath}.lock`;
  const fd = acquireLock(lockPath);
  try {
    const existing = readState(statePath);
    const next = fn(existing ? existing[key] : undefined);
    writeStateAtomic(statePath, { ...(existing ?? {}), [key]: next });
    return next;
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
