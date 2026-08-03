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
  // `bun build --compile` run from the wrong cwd prints `FileNotFound opening root
  // directory "src"` — one word, so the 'not found' entry above does not catch it.
  'filenotfound',
  'file not found',
  // `bun test <path>` whose filter matches nothing prints "The following filters did
  // not match any test files in --cwd=..." followed by a `Tests need ".test", ...` note.
  'did not match any test files',
];

// A command that collected or executed no tests is never evidence of a real failure —
// it is evidence that the command could not find the tests. Classify as can't-run
// regardless of exit code so a cwd or environment mistake degrades to "note it" rather
// than reverting finished work.
const ZERO_TESTS_PATTERNS = [
  /\bran\s+0\s+tests?\b/,        // bun:    "Ran 0 tests across 1 file."
  /\b0\s+tests?\s+(ran|found|executed|collected)\b/,
  /\bno\s+tests?\s+(ran|found|were\s+found|to\s+run|were\s+run|executed|collected)\b/,
  /\bno\s+test\s+files?\s+found\b/,
];

function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: 1, stdout: '', stderr: `timeout after ${timeoutMs}ms` });
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });
  });
}

// `output` must carry both streams: bun writes its diagnostics to stderr, but other
// runners report the same conditions on stdout, and a signal the classifier cannot see
// is a signal that reverts a completed task.
function isCantRunError(output: string, exitCode: number): boolean {
  if (exitCode === 127) return true;
  const lower = output.toLowerCase();
  if (CANT_RUN_PATTERNS.some((p) => lower.includes(p))) return true;
  return ZERO_TESTS_PATTERNS.some((re) => re.test(lower));
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
  // Task `tests` entries are written relative to the project root, so they must run
  // there — not from `task.directory`. Running them from the task directory made them
  // fail spuriously, and the failure was then misclassified as a real one and reverted
  // an already-complete task to in-progress.
  const cwd = path.resolve(projectRoot);

  for (const cmd of task.tests) {
    const { exitCode, stdout, stderr } = await runCommand(cmd, cwd, timeoutMs);
    const output = `${stdout}\n${stderr}`;

    if (exitCode === 0) continue;

    if (stderr.includes('timeout after')) {
      // Timeout → infrastructure error, don't revert
      appendNote(data, fileTask, 'Post-iteration: test commands could not execute (missing deps/scripts).');
      writeAndSnapshot(tasksFilePath, dataDir, data);
      return { status: 'error', message: `timeout: ${cmd}` };
    }

    if (isCantRunError(output, exitCode)) {
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
    return { status: 'failed', message: `${cmd}: ${output.trim().slice(-200)}` };
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
