import { spawn } from 'child_process';
import * as path from 'path';
import * as tasksFileModule from './tasks-file';
import { TasksFileError, type TasksFile } from './tasks-file';
import type { Task } from './types';

export interface ValidateTaskTestsOpts {
  task: Task;
  tasksFilePath: string;
  projectRoot: string;
  timeoutMs?: number;
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
}

const CANT_RUN_PATTERNS = [
  'missing script',
  'not found',
  'no such file',
  'enoent',
  'cannot find module',
  'module not found',
];

function runCommand(cmd: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: 1, stderr: `timeout after ${timeoutMs}ms` });
        return;
      }
      resolve({ exitCode: code ?? 1, stderr: Buffer.concat(stderrChunks).toString() });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stderr: err.message });
    });
  });
}

function isCantRunError(stderr: string, exitCode: number): boolean {
  if (exitCode === 127) return true;
  const lower = stderr.toLowerCase();
  return CANT_RUN_PATTERNS.some((p) => lower.includes(p));
}

function writeAndSnapshot(tasksFilePath: string, dataDir: string, data: TasksFile): void {
  tasksFileModule.writeTasksFile(tasksFilePath, data);
  tasksFileModule.snapshotTasksFile(tasksFilePath, dataDir);
}

export async function validateTaskTests(opts: ValidateTaskTestsOpts): Promise<ValidationResult> {
  const { task, tasksFilePath, projectRoot, timeoutMs = 120_000 } = opts;

  // No tests defined → skip
  if (!task.tests || task.tests.length === 0) {
    return { status: 'skipped' };
  }

  const dataDir = path.dirname(tasksFilePath);

  // Re-read tasks.json to get current status (defensive read with jsonrepair + snapshot recovery)
  let data: TasksFile;
  try {
    ({ data } = tasksFileModule.readTasksFile(tasksFilePath, { dataDir }));
  } catch (err) {
    if (err instanceof TasksFileError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  const fileTask = data.tasks.find((t: Task) => t.id === task.id);
  if (!fileTask || fileTask.status !== 'complete') {
    return { status: 'skipped' };
  }
  const taskDir = task.directory && task.directory !== '/' ? task.directory : '.';
  const cwd = path.resolve(projectRoot, taskDir);

  for (const cmd of task.tests) {
    const { exitCode, stderr } = await runCommand(cmd, cwd, timeoutMs);

    if (exitCode === 0) continue;

    if (stderr.includes('timeout after')) {
      // Timeout → infrastructure error, don't revert
      appendNote(data, fileTask, 'Post-iteration: test commands could not execute (missing deps/scripts).');
      writeAndSnapshot(tasksFilePath, dataDir, data);
      return { status: 'error', message: `timeout: ${cmd}` };
    }

    if (isCantRunError(stderr, exitCode)) {
      // Infrastructure error → note but don't revert
      appendNote(data, fileTask, 'Post-iteration: test commands could not execute (missing deps/scripts).');
      writeAndSnapshot(tasksFilePath, dataDir, data);
      return { status: 'error', message: `can't run: ${cmd}` };
    }

    // Real test failure → revert status
    fileTask.status = 'in-progress';
    delete fileTask.completedAt;
    delete fileTask.completedBy;
    appendNote(data, fileTask, 'Post-iteration test validation failed — reverted to in-progress.');
    writeAndSnapshot(tasksFilePath, dataDir, data);
    return { status: 'failed', message: `${cmd}: ${stderr.slice(-200)}` };
  }

  return { status: 'passed' };
}

function appendNote(data: { tasks: Task[] }, task: Task, note: string) {
  if (task.notes) {
    task.notes += ` | ${note}`;
  } else {
    task.notes = note;
  }
}
