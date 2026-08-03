import { readFileSync } from 'fs';
import { join } from 'path';
import { findTempFilePath } from './utils';
import type { Task } from './types';

export function loadCompletedIds(dataDir: string): Set<number> {
  const ids = new Set<number>();

  // Load from .cairn_completed_ids (array of ints as JSON), falling back to the
  // legacy .ralph_ name so an un-migrated project's IDs are not lost.
  const idsFile = findTempFilePath(dataDir, 'completed_ids');
  try {
    const content = readFileSync(idsFile, 'utf-8').trim();
    if (content) {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'number') ids.add(id);
        }
      }
    }
  } catch {
    // Missing or unreadable file — ignore
  }

  // Load from tasks.completed.json archive
  const completedFile = join(dataDir, 'tasks.completed.json');
  try {
    const content = readFileSync(completedFile, 'utf-8').trim();
    if (content) {
      const parsed = JSON.parse(content);
      const tasks: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? []);
      for (const t of tasks) {
        if (typeof t === 'object' && t !== null && typeof (t as Record<string, unknown>).id === 'number') {
          ids.add((t as Record<string, unknown>).id as number);
        }
      }
    }
  } catch {
    // Missing or unreadable file — ignore
  }

  return ids;
}

export function selectNextTask(tasks: Task[], completedIds: Set<number>): Task | null {
  // In-progress first
  for (const t of tasks) {
    if (t.status === 'in-progress') return t;
  }

  // Build set of complete IDs from active tasks + archived
  const activeCompleteIds = new Set<number>(completedIds);
  for (const t of tasks) {
    if (t.status === 'complete') activeCompleteIds.add(t.id);
  }

  // Highest priority pending with all deps satisfied
  const pending = tasks.filter((t) => t.status === 'pending');
  pending.sort((a, b) => a.priority - b.priority);
  for (const t of pending) {
    const deps = t.dependencies ?? [];
    if (deps.every((d) => activeCompleteIds.has(d))) return t;
  }

  return null;
}

// In-progress tasks occupy their directories — any pending task that shares the
// same non-empty directory as an in-progress task is excluded from the ready-set.
// This prevents two concurrent agents from writing to the same directory in a
// parallel wave. The ready-set itself also applies the same constraint among its
// own members: after sorting by priority, each candidate is skipped if its
// directory is already claimed by a higher-priority task in the batch.
export function selectReadyTasks(
  tasks: Task[],
  completedIds: Set<number>,
  opts?: { limit?: number },
): Task[] {
  // Build complete ID set from archived + active (same logic as selectNextTask)
  const allCompleteIds = new Set<number>(completedIds);
  for (const t of tasks) {
    if (t.status === 'complete') allCompleteIds.add(t.id);
  }

  // Collect directories occupied by currently in-progress tasks
  const occupiedDirs = new Set<string>();
  for (const t of tasks) {
    if (t.status === 'in-progress' && t.directory) occupiedDirs.add(t.directory);
  }

  // Filter to dependency-satisfied pending tasks not blocked by an occupied dir
  const candidates = tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    if (t.directory && occupiedDirs.has(t.directory)) return false;
    return (t.dependencies ?? []).every((d) => allCompleteIds.has(d));
  });

  candidates.sort((a, b) => a.priority - b.priority);

  // Walk the sorted list, claiming directories as we go
  const usedDirs = new Set<string>();
  const result: Task[] = [];
  for (const t of candidates) {
    if (t.directory) {
      if (usedDirs.has(t.directory)) continue;
      usedDirs.add(t.directory);
    }
    result.push(t);
    if (opts?.limit !== undefined && result.length >= opts.limit) break;
  }

  return result;
}

export function buildIterationPrompt(
  task: Task,
  iteration: number,
  maxIterations: number,
  prevNotes: string | null,
  totalRemaining: number,
): string {
  const lines: string[] = [`Iteration ${iteration} of ${maxIterations}.`, ''];

  lines.push(`YOUR ASSIGNED TASK (#${task.id}):`);
  lines.push(`  Title: ${task.title}`);
  if (task.description) lines.push(`  Description: ${task.description}`);
  if (task.directory) lines.push(`  Directory: ${task.directory}`);
  if (task.files?.length) lines.push(`  Files: ${task.files.join(', ')}`);
  if (task.tests?.length) lines.push(`  Tests: ${task.tests.join(', ')}`);

  if (task.status === 'in-progress') {
    lines.push('');
    lines.push('NOTE: This task was started by a previous iteration but not completed.');
    lines.push('Check the actual code state before continuing — it may be partially done.');
  }

  if (prevNotes) {
    lines.push('');
    lines.push(`FROM PREVIOUS ITERATION: ${prevNotes}`);
  }

  lines.push('');
  lines.push(`Remaining tasks after this one: ${totalRemaining - 1}`);
  lines.push('');
  lines.push('Begin work.');

  return lines.join('\n');
}
