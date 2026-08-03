import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateTaskTests } from '../src/test-validator';
import * as tasksFileModule from '../src/tasks-file';
import type { Task } from '../src/types';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `cairn-tv-test-${Math.random().toString(36).slice(2)}`);
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

    // Verbatim signals captured from bun 1.3.11 run in the wrong cwd. These cost three
    // iterations of a previous round: none matched a CANT_RUN pattern, so a finished task
    // was reverted to in-progress and re-picked every iteration until a human intervened.
    it('returns error for bun build FileNotFound (no space in "FileNotFound")', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        completedAt: '2025-01-01T00:00:00Z', completedBy: 'iteration-1',
        tests: ['echo \'FileNotFound opening root directory "src"\' >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');

      const updated = readTasksFile(tasksFilePath).tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('complete');
      expect(updated.completedAt).toBe('2025-01-01T00:00:00Z');
    });

    it('returns error for spaced "file not found"', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['echo "error: file not found" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');
      expect(readTasksFile(tasksFilePath).tasks.find((t) => t.id === 1)!.status).toBe('complete');
    });

    it('returns error when a bun test filter matched no test files', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        completedAt: '2025-01-01T00:00:00Z', completedBy: 'iteration-1',
        tests: ['echo "The following filters did not match any test files in --cwd=/x" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');

      const updated = readTasksFile(tasksFilePath).tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('complete');
      expect(updated.completedAt).toBe('2025-01-01T00:00:00Z');
    });

    it('returns error when zero tests ran, even on a non-zero exit code', async () => {
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        completedAt: '2025-01-01T00:00:00Z', completedBy: 'iteration-1',
        tests: ['echo "Ran 0 tests across 1 file. [7.00ms]" >&2 && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');

      const updated = readTasksFile(tasksFilePath).tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('complete');
      expect(updated.completedAt).toBe('2025-01-01T00:00:00Z');
    });

    it('classifies a can\'t-run signal written to stdout, not just stderr', async () => {
      // Runners differ on which stream carries the diagnostic (bun uses stderr, others
      // stdout). The classifier must see both or it silently misses the signal.
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        completedAt: '2025-01-01T00:00:00Z', completedBy: 'iteration-1',
        tests: ['echo "no tests ran" && exit 1'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('error');

      const updated = readTasksFile(tasksFilePath).tasks.find((t) => t.id === 1)!;
      expect(updated.status).toBe('complete');
      expect(updated.completedAt).toBe('2025-01-01T00:00:00Z');
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

  describe('cwd resolution', () => {
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

    it('runs root-relative test commands from projectRoot even when task.directory is a subdir', async () => {
      // Regression: task `tests` entries are written relative to the project root (e.g.
      // `bun test test/foo.test.ts`). Running them from <root>/<task.directory> made them
      // match nothing, and the resulting failure was misclassified as a real test failure,
      // reverting an already-complete task to in-progress.
      mkdirSync(join(tmpDir, 'sub'));
      writeFileSync(join(tmpDir, 'root-sentinel.txt'), 'hello');
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        directory: 'sub',
        tests: ['test -f root-sentinel.txt'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('passed');
      const data = readTasksFile(tasksFilePath);
      expect(data.tasks.find((t) => t.id === 1)!.status).toBe('complete');
    });

    it('treats directory "/" as projectRoot (not filesystem root)', async () => {
      writeFileSync(join(tmpDir, 'root-sentinel.txt'), 'hello');
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        directory: '/',
        tests: ['test -f root-sentinel.txt'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('passed');
    });

    it('does not resolve test commands against task.directory', async () => {
      const subDir = join(tmpDir, 'sub');
      mkdirSync(subDir);
      writeFileSync(join(subDir, 'sub-only.txt'), 'hello');
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        directory: 'sub',
        tests: ['test -f sub-only.txt'],
      };
      writeTasksFile(tasksFilePath, [task]);

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });
      expect(result.status).toBe('failed');
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

  describe('defensive I/O', () => {
    it('(a) recovers malformed tasks.json via readTasksFile and writes back via writeTasksFile', async () => {
      // Missing comma after "project" — triggers JSON.parse failure but jsonrepair can fix it.
      const malformed = `{
  "project": "test"
  "tasks": [
    {
      "id": 1,
      "priority": 1,
      "title": "Test",
      "status": "complete",
      "completedAt": "2025-01-01T00:00:00Z",
      "completedBy": "iteration-1",
      "tests": ["echo FAIL >&2 && exit 1"]
    }
  ]
}`;
      writeFileSync(tasksFilePath, malformed);
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['echo FAIL >&2 && exit 1'],
      };

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });

      // The malformed JSON was recovered via readTasksFile → the test ran to failure
      expect(result.status).toBe('failed');
      // writeTasksFile rewrote the file as valid JSON with reverted status
      const parsed = JSON.parse(readFileSync(tasksFilePath, 'utf-8'));
      expect(parsed.tasks[0].status).toBe('in-progress');
      expect(parsed.tasks[0].notes).toContain('Post-iteration test validation failed');
    });

    it('(b) returns { status: error, message } when readTasksFile throws TasksFileError', async () => {
      // tasksFilePath does not exist and no snapshot → TasksFileError from readTasksFile.
      // validateTaskTests must surface this as ValidationResult rather than crash.
      const task: Task = {
        id: 1, priority: 1, title: 'Test', status: 'complete',
        tests: ['echo ok'],
      };

      const result = await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });

      expect(result.status).toBe('error');
      expect(typeof result.message).toBe('string');
      expect(result.message!.length).toBeGreaterThan(0);
    });

    it('(c) calls snapshotTasksFile after each write', async () => {
      const snapshotSpy = spyOn(tasksFileModule, 'snapshotTasksFile');
      try {
        const task: Task = {
          id: 1, priority: 1, title: 'Test', status: 'complete',
          tests: ['echo FAIL >&2 && exit 1'],
        };
        writeTasksFile(tasksFilePath, [task]);

        await validateTaskTests({ task, tasksFilePath, projectRoot: tmpDir });

        expect(snapshotSpy).toHaveBeenCalled();
        const [filePathArg, dataDirArg] = snapshotSpy.mock.calls[0] as [string, string];
        expect(filePathArg).toBe(tasksFilePath);
        expect(dataDirArg).toBe(tmpDir);
      } finally {
        snapshotSpy.mockRestore();
      }
    });
  });
});
