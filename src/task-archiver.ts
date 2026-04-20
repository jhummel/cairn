import { readFileSync, writeFileSync, existsSync, unlinkSync, appendFileSync } from 'fs';
import { join } from 'path';
import * as tasksFileModule from './tasks-file';
import { TasksFileError } from './tasks-file';
import type { Task } from './types';

interface CompletedFile {
  tasks: Task[];
}

export interface ArchiveResult {
  archivedCount: number;
  prevNotes: string | null;
  warnings: string[];
}

export async function archiveCompletedTasks(opts: {
  tasksFilePath: string;
  dataDir: string;
  iterationLogPath?: string;
}): Promise<ArchiveResult> {
  const { tasksFilePath, dataDir, iterationLogPath } = opts;
  const warnings: string[] = [];

  // Missing file → nothing to archive (not a corruption event)
  if (!existsSync(tasksFilePath)) {
    return { archivedCount: 0, prevNotes: null, warnings };
  }

  // Defensive read: jsonrepair + snapshot recovery handled inside readTasksFile.
  // On TasksFileError, surface the failure as a warning + iteration-log line
  // instead of silently returning zero (the previous bug at lines 27-31).
  let data: tasksFileModule.TasksFile;
  try {
    ({ data } = tasksFileModule.readTasksFile(tasksFilePath, { dataDir }));
  } catch (err) {
    if (err instanceof TasksFileError) {
      const msg = `archiveCompletedTasks: ${err.message}`;
      warnings.push(msg);
      if (iterationLogPath) {
        try {
          appendFileSync(
            iterationLogPath,
            `${new Date().toISOString()} — archive aborted: ${err.message}\n`
          );
        } catch {
          // Best-effort; never let logging failures mask the real failure.
        }
      }
      return { archivedCount: 0, prevNotes: null, warnings };
    }
    throw err;
  }

  const completed = data.tasks.filter((t) => t.status === 'complete');
  const remaining = data.tasks.filter((t) => t.status !== 'complete');

  if (completed.length === 0) {
    return { archivedCount: 0, prevNotes: null, warnings };
  }

  // Append completed IDs to .ralph_completed_ids (JSON array)
  const idsFile = join(dataDir, '.ralph_completed_ids');
  const existingIds = new Set<number>();
  if (existsSync(idsFile)) {
    try {
      const parsed = JSON.parse(readFileSync(idsFile, 'utf-8'));
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'number') existingIds.add(id);
        }
      }
    } catch {
      // ignore corrupt file
    }
  }
  for (const t of completed) existingIds.add(t.id);
  writeFileSync(idsFile, JSON.stringify([...existingIds].sort((a, b) => a - b)));

  // Save last completed task's notes to .ralph_prev_notes
  const prevNotesFile = join(dataDir, '.ralph_prev_notes');
  const lastNotes = completed[completed.length - 1].notes ?? '';
  if (lastNotes) {
    writeFileSync(prevNotesFile, lastNotes);
  } else if (existsSync(prevNotesFile)) {
    unlinkSync(prevNotesFile);
  }

  // Append to tasks.completed.json
  const archivePath = join(dataDir, 'tasks.completed.json');
  let archive: CompletedFile = { tasks: [] };
  if (existsSync(archivePath)) {
    try {
      archive = JSON.parse(readFileSync(archivePath, 'utf-8')) as CompletedFile;
      if (!Array.isArray(archive.tasks)) archive.tasks = [];
    } catch {
      archive = { tasks: [] };
    }
  }
  archive.tasks.push(...completed);
  writeFileSync(archivePath, JSON.stringify(archive, null, 2));

  // Remove completed tasks from tasks.json — atomic write + snapshot
  data.tasks = remaining;
  tasksFileModule.writeTasksFile(tasksFilePath, data);
  tasksFileModule.snapshotTasksFile(tasksFilePath, dataDir);

  return {
    archivedCount: completed.length,
    prevNotes: completed[completed.length - 1].notes ?? null,
    warnings,
  };
}
