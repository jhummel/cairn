import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateTaskTests } from '../src/test-validator';
import type { Task } from '../src/types';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ralph-tv-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTasksFile(path: string, tasks: Task[]) {
  writeFileSync(path, JSON.stringify({ project: 'test', tasks }, null, 2));
}

function readTasksFile(path: string): { project: string; tasks: Task[] } {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('validateTaskTests', () => {
  let tmpDir: string;
  let tasksFilePath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    tasksFilePath = join(tmpDir, 'tasks.json');
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('skipped cases', () => {
    it('returns skipped when task has no tests', async () => {
      const task: Task = { id: 1, priority: 1, title: 'Test', status: 'complete' };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'skipped' });
    });

    it('returns skipped when task has empty tests array', async () => {
      const task: Task = { id: 1, priority: 1, title: 'Test', status: 'complete', tests: [] };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'skipped' });
    });

    it('returns skipped when task is not complete in tasks.json', async () => {
      const task: Task = { id: 1, priority: 1, title: 'Test', status: 'in-progress', tests: ['echo ok'] };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'skipped' });
    });

    it('returns skipped when task is not found in tasks.json', async () => {
      const task: Task = { id: 99, priority: 1, title: 'Ghost', status: 'complete', tests: ['echo ok'] };
      writeTasksFile(tasksFilePath, []);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'skipped' });
    });
  });

  describe('passing tests', () => {
    it('returns passed when all test commands succeed', async () => {
      const task: Task = { id: 1, priority: 1, title: 'Test', status: 'complete', tests: ['true'] };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'passed' });
    });

    it('returns passed when multiple test commands all succeed', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['exit 0', 'echo "ok"', 'true'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'passed' });
    });
  });

  describe('real test failures', () => {
    it('returns failed and reverts task status on test failure', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        completedAt: '2025-01-01T00:00:00Z', completedBy: 'iteration-1',
        tests: ['echo "FAIL: expected 1 got 2" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('failed');
      expect(result.message).toBeDefined();

      // Verify task was reverted in tasks.json
      const data = readTasksFile(tasksFilePath);
      const updated = data.tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('in-progress');
      expect(updated.completedAt).toBeUndefined();
      expect(updated.completedBy).toBeUndefined();
      expect(updated.notes).toContain('Post-iteration test validation failed');
    });

    it('appends to existing notes on failure', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        notes: 'Previous note',
        tests: ['echo "test failed" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });

      const data = readTasksFile(tasksFilePath);
      const updated = data.tasks.find((t) => t.id === 1)!;
      expect(updated.notes).toContain('Previous note');
      expect(updated.notes).toContain('Post-iteration test validation failed');
    });

    it('stops at first failure and does not run remaining tests', async () => {
      // Second command creates a file — if it runs, the file exists
      const marker = join(tmpDir, 'should-not-exist');
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: [
          'echo "FAIL" >&2 && exit 1',
          `touch "${marker}"`,
        ],
      };
      writeTasksFile(tasksFilePath, [task]);

      await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(existsSync(marker)).toBe(false);
    });
  });

  describe('infrastructure errors (cant run)', () => {
    it('returns error for command not found (exit 127)', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['nonexistent_command_xyz'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');
      expect(result.message).toBeDefined();

      // Verify task status was NOT reverted
      const data = readTasksFile(tasksFilePath);
      const updated = data.tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('complete');
      expect(updated.notes).toContain('could not execute');
    });

    it('returns error for missing script', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['echo "missing script: test" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');

      const data = readTasksFile(tasksFilePath);
      expect(data.tasks.find((t) => t.id === 1)!.status).toBe('complete');
    });

    it('returns error for MODULE_NOT_FOUND', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['echo "Error: Cannot find module" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');
    });

    it('does not revert status on infrastructure error', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        completedAt: '2025-01-01T00:00:00Z', completedBy: 'iteration-1',
        tests: ['echo "ENOENT: no such file" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });

      const data = readTasksFile(tasksFilePath);
      const updated = data.tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('complete');
      expect(updated.completedAt).toBe('2025-01-01T00:00:00Z');
      expect(updated.completedBy).toBe('iteration-1');
    });
  });

  describe('timeout handling', () => {
    it('returns error on timeout (does not revert status)', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['sleep 300'],
      };
      writeTasksFile(tasksFilePath, [task]);

      // Use a short timeout for testing
      const result = await validateTaskTests({
        task, tasksFilePath, projectRoot: tmpDir, timeoutMs: 500,
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('timeout');

      const data = readTasksFile(tasksFilePath);
      expect(data.tasks.find((t) => t.id === 1)!.status).toBe('complete');
    });
  });

  describe('directory resolution', () => {
    it('runs tests in projectRoot when task has no directory', async () => {
      writeFileSync(join(tmpDir, 'sentinel.txt'), 'hello');
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['test -f sentinel.txt'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('passed');
    });

    it('runs tests in projectRoot even when task has a directory', async () => {
      const subDir = join(tmpDir, 'sub');
      mkdirSync(subDir);
      writeFileSync(join(tmpDir, 'root-sentinel.txt'), 'hello');
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        directory: 'sub',
        tests: ['test -f root-sentinel.txt'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('passed');
    });
  });

  describe('re-reads tasks.json for current status', () => {
    it('uses status from file, not from passed task object', async () => {
      // Task object says complete, but file says in-progress
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['echo ok'],
      };
      const fileTask: Task = { ...task, status: 'in-progress' };
      writeTasksFile(tasksFilePath, [fileTask]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result).toEqual({ status: 'skipped' });
    });
  });
});
