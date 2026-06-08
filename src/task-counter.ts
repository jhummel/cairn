import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { acquireLock } from './file-lock';

interface CounterState {
  nextTaskId: number;
}

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

function readState(filePath: string): CounterState | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { nextTaskId?: unknown };
    if (parsed && typeof parsed.nextTaskId === 'number' && Number.isFinite(parsed.nextTaskId)) {
      return { nextTaskId: parsed.nextTaskId };
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
 * from separate `ralph` processes never overlap. When state.json is missing it
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
    const start = existing ? existing.nextTaskId : seedNextId(dataDir);

    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(start + i);

    writeStateAtomic(statePath, { nextTaskId: start + count });
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
