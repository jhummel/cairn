import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Task } from './types';

interface TasksFile {
  project?: string;
  tasks: Task[];
}

interface CompletedFile {
  tasks: Task[];
}

export interface ArchiveResult {
  archivedCount: number;
  prevNotes: string | null;
}

export async function archiveCompletedTasks(opts: {
  tasksFilePath: string;
  dataDir: string;
}): Promise<ArchiveResult> {
  const { tasksFilePath, dataDir } = opts;

  // Read tasks.json
  let data: TasksFile;
  try {
    data = JSON.parse(readFileSync(tasksFilePath, 'utf-8')) as TasksFile;
  } catch {
    return { archivedCount: 0, prevNotes: null };
  }

  const completed = data.tasks.filter((t) => t.status === 'complete');
  const remaining = data.tasks.filter((t) => t.status !== 'complete');

  if (completed.length === 0) {
    return { archivedCount: 0, prevNotes: null };
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

  // Remove completed tasks from tasks.json
  data.tasks = remaining;
  writeFileSync(tasksFilePath, JSON.stringify(data, null, 2));

  return {
    archivedCount: completed.length,
    prevNotes: completed[completed.length - 1].notes ?? null,
  };
}
