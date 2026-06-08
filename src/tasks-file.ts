import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { jsonrepair } from 'jsonrepair';
import type { Task } from './types';
import { acquireLock } from './file-lock';

export interface TasksFile {
  project?: string;
  tasks: Task[];
}

export class TasksFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TasksFileError';
  }
}

function trimTrailingGarbage(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth++;
      started = true;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (started && depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }
  return null;
}

function isTasksFileShape(value: unknown): value is TasksFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { tasks?: unknown }).tasks)
  );
}

function logCorruption(
  dataDir: string | undefined,
  stage: 'parse' | 'jsonrepair' | 'snapshot',
  err: unknown,
  bytes: Buffer
): void {
  if (!dataDir) return;
  try {
    const entry = {
      ts: new Date().toISOString(),
      stage,
      error: err instanceof Error ? err.message : String(err),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      preview: bytes.slice(0, 500).toString('utf-8'),
    };
    fs.appendFileSync(path.join(dataDir, 'corruption.log'), JSON.stringify(entry) + '\n');
  } catch {
    // Best-effort logging; never let logging failures mask the real error.
  }
}

export function readTasksFile(
  filePath: string,
  opts?: { dataDir?: string }
): { data: TasksFile; repaired: boolean; restored: boolean; error?: string } {
  const dataDir = opts?.dataDir;

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    throw new TasksFileError(
      `Failed to read tasks file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Path 1: plain JSON.parse
  const text = bytes.toString('utf-8');
  try {
    const data = JSON.parse(text) as TasksFile;
    return { data, repaired: false, restored: false };
  } catch (parseErr) {
    logCorruption(dataDir, 'parse', parseErr, bytes);

    // Path 2: jsonrepair (with trailing-garbage trim fallback)
    try {
      let candidates: string[] = [text];
      const trimmed = trimTrailingGarbage(text);
      if (trimmed !== null && trimmed !== text) candidates.push(trimmed);

      let lastErr: unknown = parseErr;
      for (const candidate of candidates) {
        try {
          const repairedText = jsonrepair(candidate);
          const data = JSON.parse(repairedText) as TasksFile;
          if (!isTasksFileShape(data)) {
            throw new Error('repaired content does not match TasksFile shape');
          }
          return { data, repaired: true, restored: false };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    } catch (repairErr) {
      logCorruption(dataDir, 'jsonrepair', repairErr, bytes);

      // Path 3: snapshot recovery
      if (dataDir) {
        const snapshotPath = path.join(dataDir, '.ralph_tasks_snapshot.json');
        if (fs.existsSync(snapshotPath)) {
          let snapBytes: Buffer;
          try {
            snapBytes = fs.readFileSync(snapshotPath);
            const data = JSON.parse(snapBytes.toString('utf-8')) as TasksFile;
            return { data, repaired: false, restored: true };
          } catch (snapErr) {
            const snapForLog = (() => {
              try {
                return fs.readFileSync(snapshotPath);
              } catch {
                return Buffer.from('');
              }
            })();
            logCorruption(dataDir, 'snapshot', snapErr, snapForLog);
          }
        } else {
          logCorruption(
            dataDir,
            'snapshot',
            new Error(`snapshot not found at ${snapshotPath}`),
            Buffer.from('')
          );
        }
      }

      throw new TasksFileError(
        `Failed to read tasks file at ${filePath}: parse, jsonrepair, and snapshot recovery all failed`
      );
    }
  }
}

/**
 * Build a per-process, per-call unique temp path so concurrent writers (each
 * Ralph agent shells `ralph task ...`, a separate OS process) never share — and
 * thus never clobber — the same staging file. pid scopes it to a process;
 * a random suffix scopes it within a process.
 */
function uniqueTmpPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
}

export function writeTasksFile(filePath: string, data: TasksFile): void {
  const tmpPath = uniqueTmpPath(filePath);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Never leave a partial staging file behind on failure.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Tempfile may not exist if writeFileSync failed; swallow ENOENT.
    }
    throw err;
  }
}

export function snapshotTasksFile(filePath: string, dataDir: string): void {
  const dest = path.join(dataDir, '.ralph_tasks_snapshot.json');
  fs.copyFileSync(filePath, dest);
}

export function mutateTasksFile(
  filePath: string,
  fn: (data: TasksFile) => void | TasksFile,
  opts?: { dataDir?: string }
): void {
  // Hold a cross-process lock around the entire read->modify->write->snapshot
  // critical section. Each Ralph agent shells `ralph task ...` as a separate OS
  // process, so two concurrent mutations could otherwise interleave their
  // read-modify-write cycles and lose updates. writeTasksFile is itself atomic
  // (unique tmp + rename) and self-cleans on failure, so no manual tmp cleanup
  // is needed here.
  const lockPath = `${filePath}.lock`;
  const fd = acquireLock(lockPath);
  try {
    const { data } = readTasksFile(filePath, opts);
    const result = fn(data);
    const next = result === undefined ? data : result;
    writeTasksFile(filePath, next);

    if (opts?.dataDir) {
      snapshotTasksFile(filePath, opts.dataDir);
    }
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
