import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { archiveCompletedTasks } from '../src/task-archiver';
import type { Task } from '../src/types';

function expectEmptyResult(result: { archivedCount: number; prevNotes: string | null; warnings?: string[] }) {
  expect(result.archivedCount).toBe(0);
  expect(result.prevNotes).toBeNull();
  expect(result.warnings ?? []).toEqual([]);
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `cairn-ta-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTasks(path: string, tasks: Task[]) {
  writeFileSync(path, JSON.stringify({ project: 'test', tasks }, null, 2));
}

function readTasks(path: string): { project: string; tasks: Task[] } {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readCompleted(path: string): { tasks: Task[] } {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readIds(path: string): number[] {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('archiveCompletedTasks', () => {
  let tmpDir: string;
  let tasksFilePath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    tasksFilePath = join(tmpDir, 'tasks.json');
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('no-op cases', () => {
    it('returns zero when tasks.json is missing', async () => {
      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expectEmptyResult(result);
    });

    it('returns zero when no tasks are complete', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'A', status: 'pending' },
        { id: 2, priority: 2, title: 'B', status: 'in-progress' },
      ];
      writeTasks(tasksFilePath, tasks);
      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expectEmptyResult(result);
    });

    it('does not modify tasks.json when nothing to archive', async () => {
      const tasks: Task[] = [{ id: 1, priority: 1, title: 'A', status: 'pending' }];
      writeTasks(tasksFilePath, tasks);
      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      const after = readTasks(tasksFilePath);
      expect(after.tasks).toHaveLength(1);
    });
  });

  describe('archiving completed tasks', () => {
    it('archives a single completed task', async () => {
      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.archivedCount).toBe(1);
    });

    it('removes completed tasks from tasks.json', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'Done', status: 'complete' },
        { id: 2, priority: 2, title: 'Pending', status: 'pending' },
      ];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const after = readTasks(tasksFilePath);
      expect(after.tasks).toHaveLength(1);
      expect(after.tasks[0].id).toBe(2);
    });

    it('writes completed tasks to tasks.completed.json', async () => {
      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const archivePath = join(tmpDir, 'tasks.completed.json');
      expect(existsSync(archivePath)).toBe(true);
      const archive = readCompleted(archivePath);
      expect(archive.tasks).toHaveLength(1);
      expect(archive.tasks[0].id).toBe(1);
    });

    it('appends to existing tasks.completed.json', async () => {
      const archivePath = join(tmpDir, 'tasks.completed.json');
      writeFileSync(archivePath, JSON.stringify({ tasks: [{ id: 99, priority: 1, title: 'Old', status: 'complete' }] }, null, 2));

      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const archive = readCompleted(archivePath);
      expect(archive.tasks).toHaveLength(2);
      expect(archive.tasks.map((t) => t.id)).toContain(99);
      expect(archive.tasks.map((t) => t.id)).toContain(1);
    });

    it('archives multiple completed tasks at once', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'Done1', status: 'complete' },
        { id: 2, priority: 2, title: 'Done2', status: 'complete' },
        { id: 3, priority: 3, title: 'Still pending', status: 'pending' },
      ];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.archivedCount).toBe(2);

      const after = readTasks(tasksFilePath);
      expect(after.tasks).toHaveLength(1);
      expect(after.tasks[0].id).toBe(3);
    });
  });

  describe('completed IDs file', () => {
    it('creates .cairn_completed_ids with completed task IDs', async () => {
      const tasks: Task[] = [{ id: 5, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const idsFile = join(tmpDir, '.cairn_completed_ids');
      expect(existsSync(idsFile)).toBe(true);
      const ids = readIds(idsFile);
      expect(ids).toContain(5);
    });

    it('merges with existing IDs in .cairn_completed_ids', async () => {
      const idsFile = join(tmpDir, '.cairn_completed_ids');
      writeFileSync(idsFile, JSON.stringify([3, 4]));

      const tasks: Task[] = [{ id: 5, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const ids = readIds(idsFile);
      expect(ids).toContain(3);
      expect(ids).toContain(4);
      expect(ids).toContain(5);
    });

    it('merges IDs from a legacy .ralph_completed_ids into the new .cairn_ file', async () => {
      writeFileSync(join(tmpDir, '.ralph_completed_ids'), JSON.stringify([3, 4]));

      const tasks: Task[] = [{ id: 5, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      // Pre-existing state must migrate forward, not be silently discarded
      const ids = readIds(join(tmpDir, '.cairn_completed_ids'));
      expect(ids).toEqual([3, 4, 5]);
    });

    it('deduplicates IDs when merging', async () => {
      const idsFile = join(tmpDir, '.cairn_completed_ids');
      writeFileSync(idsFile, JSON.stringify([5]));

      const tasks: Task[] = [{ id: 5, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const ids = readIds(idsFile);
      expect(ids.filter((id) => id === 5)).toHaveLength(1);
    });

    it('sorts IDs in the file', async () => {
      const idsFile = join(tmpDir, '.cairn_completed_ids');
      writeFileSync(idsFile, JSON.stringify([10, 2]));

      const tasks: Task[] = [{ id: 5, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const ids = readIds(idsFile);
      expect(ids).toEqual([2, 5, 10]);
    });
  });

  describe('prev notes', () => {
    it('returns null prevNotes when last completed task has no notes', async () => {
      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.prevNotes).toBeNull();
    });

    it('returns prevNotes from last completed task', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'Done', status: 'complete', notes: 'Some notes here' },
      ];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.prevNotes).toBe('Some notes here');
    });

    it('uses notes from last (highest array index) completed task', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'First', status: 'complete', notes: 'First notes' },
        { id: 2, priority: 2, title: 'Last', status: 'complete', notes: 'Last notes' },
      ];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.prevNotes).toBe('Last notes');
    });

    it('writes notes to .cairn_prev_notes file', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'Done', status: 'complete', notes: 'Important notes' },
      ];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const prevNotesFile = join(tmpDir, '.cairn_prev_notes');
      expect(existsSync(prevNotesFile)).toBe(true);
      expect(readFileSync(prevNotesFile, 'utf-8')).toBe('Important notes');
    });

    it('removes .cairn_prev_notes when last completed task has no notes', async () => {
      const prevNotesFile = join(tmpDir, '.cairn_prev_notes');
      writeFileSync(prevNotesFile, 'old notes');

      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      expect(existsSync(prevNotesFile)).toBe(false);
    });

    it('removes a legacy .ralph_prev_notes when last completed task has no notes', async () => {
      const legacyPrevNotes = join(tmpDir, '.ralph_prev_notes');
      writeFileSync(legacyPrevNotes, 'old notes');

      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      // Otherwise a stale legacy file would keep answering the dual-read
      expect(existsSync(legacyPrevNotes)).toBe(false);
    });

    it('does not create .cairn_prev_notes when no notes', async () => {
      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const prevNotesFile = join(tmpDir, '.cairn_prev_notes');
      expect(existsSync(prevNotesFile)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles corrupt .cairn_completed_ids gracefully', async () => {
      const idsFile = join(tmpDir, '.cairn_completed_ids');
      writeFileSync(idsFile, 'not-json');

      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.archivedCount).toBe(1);
      const ids = readIds(idsFile);
      expect(ids).toContain(1);
    });

    it('handles corrupt tasks.completed.json gracefully', async () => {
      const archivePath = join(tmpDir, 'tasks.completed.json');
      writeFileSync(archivePath, 'not-json');

      const tasks: Task[] = [{ id: 1, priority: 1, title: 'Done', status: 'complete' }];
      writeTasks(tasksFilePath, tasks);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expect(result.archivedCount).toBe(1);
      const archive = readCompleted(archivePath);
      expect(archive.tasks).toHaveLength(1);
    });

    it('preserves project field in tasks.json after archival', async () => {
      const tasks: Task[] = [
        { id: 1, priority: 1, title: 'Done', status: 'complete' },
        { id: 2, priority: 2, title: 'Remaining', status: 'pending' },
      ];
      writeTasks(tasksFilePath, tasks);

      await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      const after = readTasks(tasksFilePath);
      expect(after.project).toBe('test');
    });

    it('handles empty tasks array in tasks.json', async () => {
      writeFileSync(tasksFilePath, JSON.stringify({ project: 'test', tasks: [] }));
      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });
      expectEmptyResult(result);
    });
  });

  describe('defensive I/O', () => {
    it('(a) recovers malformed tasks.json via readTasksFile and archives normally', async () => {
      // Missing comma after "project" — JSON.parse fails but jsonrepair fixes it.
      const malformed = `{
  "project": "test"
  "tasks": [
    { "id": 1, "priority": 1, "title": "Done", "status": "complete", "notes": "n1" },
    { "id": 2, "priority": 2, "title": "Pending", "status": "pending" }
  ]
}`;
      writeFileSync(tasksFilePath, malformed);

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      expect(result.archivedCount).toBe(1);
      expect(result.prevNotes).toBe('n1');
      expect(result.warnings).toEqual([]);

      // Archive happened
      const archive = readCompleted(join(tmpDir, 'tasks.completed.json'));
      expect(archive.tasks).toHaveLength(1);
      expect(archive.tasks[0].id).toBe(1);

      // tasks.json now valid JSON with only the pending task
      const after = readTasks(tasksFilePath);
      expect(after.tasks).toHaveLength(1);
      expect(after.tasks[0].id).toBe(2);

      // Snapshot was written (writeTasksFile + snapshotTasksFile path)
      expect(existsSync(join(tmpDir, '.cairn_tasks_snapshot.json'))).toBe(true);
    });

    it('(b) returns warnings + writes corruption.log + appends iteration log when readTasksFile throws TasksFileError', async () => {
      // Garbage that jsonrepair cannot turn into a TasksFile shape, AND no snapshot.
      writeFileSync(tasksFilePath, '\x00\x01\x02 not json @#$%^&*()');
      const iterationLogPath = join(tmpDir, '.cairn_iterations.log');
      writeFileSync(iterationLogPath, 'pre-existing line\n');

      const result = await archiveCompletedTasks({
        tasksFilePath,
        dataDir: tmpDir,
        iterationLogPath,
      });

      // Returned shape: archivedCount: 0, prevNotes: null, warnings: [<string>]
      expect(result.archivedCount).toBe(0);
      expect(result.prevNotes).toBeNull();
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(typeof result.warnings[0]).toBe('string');
      expect(result.warnings[0].length).toBeGreaterThan(0);

      // corruption.log exists with at least one entry (written by readTasksFile)
      const corruptionLogPath = join(tmpDir, 'corruption.log');
      expect(existsSync(corruptionLogPath)).toBe(true);
      const corruptionLogContent = readFileSync(corruptionLogPath, 'utf-8');
      expect(corruptionLogContent.length).toBeGreaterThan(0);
      expect(corruptionLogContent).toContain('"stage"');

      // Iteration log was appended (still has the pre-existing content + new line)
      const iterLogContent = readFileSync(iterationLogPath, 'utf-8');
      expect(iterLogContent).toContain('pre-existing line');
      expect(iterLogContent.length).toBeGreaterThan('pre-existing line\n'.length);
    });

    it('(b) does not throw if iterationLogPath is omitted', async () => {
      writeFileSync(tasksFilePath, '\x00\x01\x02 not json @#$%^&*()');

      const result = await archiveCompletedTasks({ tasksFilePath, dataDir: tmpDir });

      expect(result.archivedCount).toBe(0);
      expect(result.prevNotes).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
