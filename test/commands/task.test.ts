import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import {
  taskStart,
  taskComplete,
  taskNote,
  taskSetStatus,
  taskAdd,
  taskShow,
  taskNextId,
  registerTaskCommands,
} from '../../src/commands/task';
import type { TasksFile } from '../../src/tasks-file';

let tmpDir: string;
let tasksPath: string;

function writeTasks(data: TasksFile): void {
  fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
}

function readTasks(): TasksFile {
  return JSON.parse(fs.readFileSync(tasksPath, 'utf-8')) as TasksFile;
}

function defaultTasks(): TasksFile {
  return {
    project: 'test-project',
    tasks: [
      {
        id: 1,
        priority: 1,
        title: 'Task 1',
        status: 'pending',
      },
      {
        id: 2,
        priority: 2,
        title: 'Task 2',
        status: 'in-progress',
        notes: 'initial note',
      },
    ],
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-task-test-'));
  tasksPath = path.join(tmpDir, 'tasks.json');
  writeTasks(defaultTasks());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('task start', () => {
  it('(1a) sets status to in-progress', () => {
    const exitCode = taskStart({ id: 1, iteration: 5, tasksPath, dataDir: tmpDir });
    expect(exitCode).toBe(0);
    const after = readTasks();
    const t = after.tasks.find((x) => x.id === 1)!;
    expect(t.status).toBe('in-progress');
  });

  it('(1b) is idempotent on re-run', () => {
    taskStart({ id: 1, iteration: 5, tasksPath, dataDir: tmpDir });
    const exitCode = taskStart({ id: 1, iteration: 5, tasksPath, dataDir: tmpDir });
    expect(exitCode).toBe(0);
    const after = readTasks();
    const t = after.tasks.find((x) => x.id === 1)!;
    expect(t.status).toBe('in-progress');
  });

  it('(1c) exits non-zero when task id is missing', () => {
    const stderr: string[] = [];
    const exitCode = taskStart({
      id: 999,
      iteration: 5,
      tasksPath,
      dataDir: tmpDir,
      stderr: { write: (s) => stderr.push(s) },
    });
    expect(exitCode).not.toBe(0);
    expect(stderr.join('')).toMatch(/999/);
  });
});

describe('task complete', () => {
  it('(2) with --notes sets fields correctly', () => {
    const before = Date.now();
    const exitCode = taskComplete({
      id: 1,
      iteration: 7,
      notes: 'done the thing',
      tasksPath,
      dataDir: tmpDir,
    });
    const after = Date.now();
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 1)!;
    expect(t.status).toBe('complete');
    expect(t.completedBy).toBe('iteration-7');
    expect(t.notes).toBe('done the thing');
    expect(t.completedAt).toBeDefined();
    const ts = Date.parse(t.completedAt!);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
    // ISO-8601 string check
    expect(t.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('(3) --notes-file PATH reads notes from file', () => {
    const notesFile = path.join(tmpDir, 'notes.md');
    fs.writeFileSync(notesFile, 'file-note contents');
    const exitCode = taskComplete({
      id: 1,
      iteration: 3,
      notesFile,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 1)!;
    expect(t.notes).toBe('file-note contents');
    expect(t.status).toBe('complete');
    expect(t.completedBy).toBe('iteration-3');
  });

  it("(4) --notes-file '-' reads notes from stdin", () => {
    const exitCode = taskComplete({
      id: 1,
      iteration: 4,
      notesFile: '-',
      tasksPath,
      dataDir: tmpDir,
      readStdin: () => 'stdin-supplied notes',
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 1)!;
    expect(t.notes).toBe('stdin-supplied notes');
  });

  it('(5) without notes leaves existing notes untouched', () => {
    const exitCode = taskComplete({
      id: 2,
      iteration: 9,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 2)!;
    expect(t.notes).toBe('initial note');
    expect(t.status).toBe('complete');
    expect(t.completedBy).toBe('iteration-9');
    expect(t.completedAt).toBeDefined();
  });

  it('(5b) without notes and without pre-existing notes leaves notes undefined', () => {
    const exitCode = taskComplete({
      id: 1,
      iteration: 2,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 1)!;
    expect(t.notes).toBeUndefined();
    expect(t.status).toBe('complete');
  });
});

describe('task note', () => {
  it("(6a) appends via ' | ' separator when notes exist", () => {
    const exitCode = taskNote({
      id: 2,
      text: 'appended text',
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 2)!;
    expect(t.notes).toBe('initial note | appended text');
  });

  it('(6b) sets notes directly when no prior notes exist', () => {
    const exitCode = taskNote({
      id: 1,
      text: 'first note',
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 1)!;
    expect(t.notes).toBe('first note');
  });

  it('(6c) --replace overwrites existing notes', () => {
    const exitCode = taskNote({
      id: 2,
      text: 'fresh',
      replace: true,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const t = readTasks().tasks.find((x) => x.id === 2)!;
    expect(t.notes).toBe('fresh');
  });
});

describe('task set-status', () => {
  const validStatuses = ['pending', 'in-progress', 'complete', 'blocked'] as const;

  for (const s of validStatuses) {
    it(`(7) accepts '${s}'`, () => {
      const exitCode = taskSetStatus({ id: 1, status: s, tasksPath, dataDir: tmpDir });
      expect(exitCode).toBe(0);
      const t = readTasks().tasks.find((x) => x.id === 1)!;
      expect(t.status).toBe(s);
    });
  }

  it('(7b) rejects invalid status with non-zero exit', () => {
    const stderr: string[] = [];
    const exitCode = taskSetStatus({
      id: 1,
      status: 'bogus',
      tasksPath,
      dataDir: tmpDir,
      stderr: { write: (s) => stderr.push(s) },
    });
    expect(exitCode).not.toBe(0);
    expect(stderr.join('')).toMatch(/bogus/);
    // Original file untouched
    const t = readTasks().tasks.find((x) => x.id === 1)!;
    expect(t.status).toBe('pending');
  });
});

describe('task add', () => {
  it('(8a) appends valid task to tasks.tasks[]', () => {
    const payloadPath = path.join(tmpDir, 'new-task.json');
    const payload = {
      id: 3,
      priority: 3,
      title: 'A new task',
      status: 'pending',
      description: 'desc',
      files: [],
      dependencies: [],
      tests: [],
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const exitCode = taskAdd({
      file: payloadPath,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const after = readTasks();
    expect(after.tasks).toHaveLength(3);
    expect(after.tasks[2].id).toBe(3);
    expect(after.tasks[2].title).toBe('A new task');
  });

  it('(8b) rejects invalid payload and leaves tasks.json untouched', () => {
    const payloadPath = path.join(tmpDir, 'bad-task.json');
    // Missing required 'title' field
    const payload = { id: 3, priority: 3, status: 'pending' };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const before = fs.readFileSync(tasksPath, 'utf-8');
    const stderr: string[] = [];
    const exitCode = taskAdd({
      file: payloadPath,
      tasksPath,
      dataDir: tmpDir,
      stderr: { write: (s) => stderr.push(s) },
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('cairn task add: validation failed');
    // Exact contract: 'cairn task add: validation failed — <field>: <reason>'
    expect(stderr.join('')).toMatch(/cairn task add: validation failed — .+: .+/);
    const after = fs.readFileSync(tasksPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('(8c) rejects bad enum value and exits 1', () => {
    const payloadPath = path.join(tmpDir, 'bad-enum.json');
    const payload = { id: 3, priority: 3, title: 'x', status: 'weird' };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const before = fs.readFileSync(tasksPath, 'utf-8');
    const stderr: string[] = [];
    const exitCode = taskAdd({
      file: payloadPath,
      tasksPath,
      dataDir: tmpDir,
      stderr: { write: (s) => stderr.push(s) },
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('cairn task add: validation failed');
    const after = fs.readFileSync(tasksPath, 'utf-8');
    expect(after).toBe(before);
  });

  // defaultTasks() has ids 1 and 2, so seedNextId → 3 when no state.json exists.
  it('(8d) assigns a reserved id to a payload with no id and appends it', () => {
    const payloadPath = path.join(tmpDir, 'no-id-task.json');
    const payload = {
      priority: 3,
      title: 'Auto-id task',
      status: 'pending',
      description: 'desc',
      files: [],
      dependencies: [],
      tests: [],
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const exitCode = taskAdd({
      file: payloadPath,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const after = readTasks();
    expect(after.tasks).toHaveLength(3);
    expect(after.tasks[2].id).toBe(3);
    expect(after.tasks[2].title).toBe('Auto-id task');
  });

  it('(8e) overwrites an agent-supplied id with the reserved id', () => {
    const payloadPath = path.join(tmpDir, 'supplied-id-task.json');
    const payload = {
      id: 999,
      priority: 3,
      title: 'Supplied-id task',
      status: 'pending',
      description: 'desc',
      files: [],
      dependencies: [],
      tests: [],
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const exitCode = taskAdd({
      file: payloadPath,
      tasksPath,
      dataDir: tmpDir,
    });
    expect(exitCode).toBe(0);
    const after = readTasks();
    expect(after.tasks).toHaveLength(3);
    // The supplied 999 is ignored; the reserved id (3) wins.
    expect(after.tasks[2].id).toBe(3);
    expect(after.tasks.some((t) => t.id === 999)).toBe(false);
  });

  it('(8f) prints the assigned id to stdout', () => {
    const payloadPath = path.join(tmpDir, 'print-id-task.json');
    const payload = {
      priority: 3,
      title: 'Print-id task',
      status: 'pending',
      description: 'desc',
      files: [],
      dependencies: [],
      tests: [],
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    const out: string[] = [];
    const exitCode = taskAdd({
      file: payloadPath,
      tasksPath,
      dataDir: tmpDir,
      stdout: { write: (s) => out.push(s) },
    });
    expect(exitCode).toBe(0);
    expect(out.join('')).toBe('assigned id: 3\n');
  });
});

describe('task next-id', () => {
  // defaultTasks() has ids 1 and 2, so seedNextId → 3 when no state.json exists.
  it('(10a) prints a single reserved id by default', () => {
    const out: string[] = [];
    const exitCode = taskNextId({
      dataDir: tmpDir,
      stdout: { write: (s) => out.push(s) },
    });
    expect(exitCode).toBe(0);
    expect(out.join('')).toBe('3\n');
  });

  it('(10b) --count 3 prints 3 ids one per line and advances the counter', () => {
    const out1: string[] = [];
    const exitCode1 = taskNextId({
      count: 3,
      dataDir: tmpDir,
      stdout: { write: (s) => out1.push(s) },
    });
    expect(exitCode1).toBe(0);
    expect(out1.join('')).toBe('3\n4\n5\n');

    // Counter advanced: next reservation continues at 6.
    const out2: string[] = [];
    const exitCode2 = taskNextId({
      dataDir: tmpDir,
      stdout: { write: (s) => out2.push(s) },
    });
    expect(exitCode2).toBe(0);
    expect(out2.join('')).toBe('6\n');
  });

  for (const bad of [0, -2, NaN, 1.5]) {
    it(`(10c) rejects invalid --count ${bad} with exit 1`, () => {
      const stderr: string[] = [];
      const exitCode = taskNextId({
        count: bad,
        dataDir: tmpDir,
        stderr: { write: (s) => stderr.push(s) },
      });
      expect(exitCode).toBe(1);
      expect(stderr.join('')).toMatch(/cairn task next-id/);
      // No state.json should have been written on rejection.
      expect(fs.existsSync(path.join(tmpDir, 'state.json'))).toBe(false);
    });
  }
});

describe('task show', () => {
  it('(9a) prints formatted JSON of the task', () => {
    const out: string[] = [];
    const exitCode = taskShow({
      id: 2,
      tasksPath,
      stdout: { write: (s) => out.push(s) },
    });
    expect(exitCode).toBe(0);
    const printed = out.join('');
    const parsed = JSON.parse(printed);
    expect(parsed.id).toBe(2);
    expect(parsed.title).toBe('Task 2');
    expect(parsed.status).toBe('in-progress');
    // formatted (pretty-printed) JSON has newlines + indentation
    expect(printed).toContain('\n');
  });

  it('(9b) is read-only — tasks.json bytes unchanged', () => {
    const before = fs.readFileSync(tasksPath, 'utf-8');
    const beforeMtime = fs.statSync(tasksPath).mtimeMs;
    const out: string[] = [];
    const exitCode = taskShow({
      id: 2,
      tasksPath,
      stdout: { write: (s) => out.push(s) },
    });
    expect(exitCode).toBe(0);
    const after = fs.readFileSync(tasksPath, 'utf-8');
    expect(after).toBe(before);
    expect(fs.statSync(tasksPath).mtimeMs).toBe(beforeMtime);
  });

  it('(9c) returns non-zero when task id missing', () => {
    const stderr: string[] = [];
    const exitCode = taskShow({
      id: 999,
      tasksPath,
      stderr: { write: (s) => stderr.push(s) },
    });
    expect(exitCode).not.toBe(0);
    expect(stderr.join('')).toMatch(/999/);
  });
});

describe('registerTaskCommands', () => {
  it('(10a) describes the task subcommand group with the .cairn data dir', () => {
    const program = new Command();
    registerTaskCommands(program);
    const task = program.commands.find((c) => c.name() === 'task');
    expect(task?.description()).toBe('Manage tasks in .cairn/tasks.json');
  });
});
