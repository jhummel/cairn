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
 * Atomically increment the planning round in <dataDir>/state.json and return the
 * new value. Runs under the same state.json.lock and temp-file-rename machinery
 * as reserveTaskIds. An absent round semantically equals 1, so bumping a state
 * file without a round field writes round: 2. Every other field (nextTaskId and
 * any unknown keys) is preserved exactly.
 */
export function bumpRound(dataDir: string): number {
  const statePath = path.join(dataDir, 'state.json');
  const lockPath = `${statePath}.lock`;
  const fd = acquireLock(lockPath);
  try {
    const existing = readState(statePath);
    const current =
      existing && typeof existing.round === 'number' && Number.isFinite(existing.round)
        ? existing.round
        : 1;
    const next = current + 1;

    writeStateAtomic(statePath, { ...(existing ?? {}), round: next });
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
