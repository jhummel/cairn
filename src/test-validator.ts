import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as tasksFileModule from './tasks-file';
import { TasksFileError, type TasksFile } from './tasks-file';
import type { Task } from './types';
import { tempFilePath } from './utils';

export interface ValidateTaskTestsOpts {
  task: Task;
  tasksFilePath: string;
  projectRoot: string;
  timeoutMs?: number;
}

export interface TestSummaryEntry {
  command: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  durationMs: number;
  counts?: { pass?: number; fail?: number; skip?: number };
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
  /** Path to the full per-command log; set only when at least one command ran. */
  logPath?: string;
  /** One entry per command actually run (the loop stops at the first failure). */
  summary?: TestSummaryEntry[];
  /** Last ~40 lines of the failing command's output. Only set for failed/error. */
  failureTail?: string;
}

const FAILURE_TAIL_LINES = 40;

/** Last `n` lines of `text`, preserving order. */
function tailLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

// bun test prints summary lines like ` 12 pass`, ` 0 fail`, ` 0 skip`. Lenient by
// design: take the LAST occurrence of each so a nested/child run's totals don't win
// over the final summary, and leave a count undefined when its line never appears
// rather than guessing.
function parseCounts(output: string): { pass?: number; fail?: number; skip?: number } | undefined {
  const lastMatch = (re: RegExp): number | undefined => {
    const matches = [...output.matchAll(re)];
    return matches.length ? Number(matches[matches.length - 1][1]) : undefined;
  };
  const pass = lastMatch(/(?:^|\n)\s*(\d+)\s+pass\b/gi);
  const fail = lastMatch(/(?:^|\n)\s*(\d+)\s+fail\b/gi);
  const skip = lastMatch(/(?:^|\n)\s*(\d+)\s+skip\b/gi);
  if (pass === undefined && fail === undefined && skip === undefined) return undefined;
  return { pass, fail, skip };
}

function formatLogEntry(cmd: string, cwd: string, exitCode: number, durationMs: number, output: string): string {
  return [
    `=== ${cmd}`,
    `cwd: ${cwd}`,
    `exit code: ${exitCode}`,
    `duration: ${durationMs}ms`,
    '--- output ---',
    output,
    '',
  ].join('\n');
}

/** Overwrite the per-task log. A write failure must never affect the validation outcome. */
function writeTestLog(logPath: string, entries: string[]): void {
  try {
    fs.writeFileSync(logPath, entries.join('\n'));
  } catch {
    // best-effort — the reviewer just won't have a log to read
  }
}

/** A few lines suitable for a reviewer prompt: per command, then the log path. */
export function formatTestSummary(result: ValidationResult): string {
  if (result.status === 'skipped') {
    return 'Tests skipped (no test commands declared, or the task was not complete).';
  }
  const lines: string[] = [];
  if (result.summary && result.summary.length > 0) {
    for (const entry of result.summary) {
      const parts: string[] = [];
      if (entry.counts?.pass !== undefined) parts.push(`${entry.counts.pass} pass`);
      if (entry.counts?.fail !== undefined) parts.push(`${entry.counts.fail} fail`);
      if (entry.counts?.skip !== undefined) parts.push(`${entry.counts.skip} skip`);
      const countsStr = parts.length ? ` (${parts.join(', ')})` : '';
      lines.push(`${entry.command}: ${entry.status}${countsStr} [${entry.durationMs}ms]`);
    }
  } else {
    lines.push(result.message ? `${result.status}: ${result.message.replace(/\s+/g, ' ').trim()}` : result.status);
  }
  if (result.logPath) {
    lines.push(`Full output: ${result.logPath}`);
  }
  return lines.join('\n');
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

// ---------------------------------------------------------------------------
// cwd resolution — private to this module.
//
// Test commands default to the task's own directory. Manifest-driven commands
// (`npm test`, `bun run build`) carry no path argument and self-resolve by walking UP
// to their manifest, so running them from <root>/<task.directory> is strictly better
// than from the root: in a multi-service repo they find the service's own package.json;
// in a single-package repo the upward walk makes the two identical.
//
// Only commands carrying an explicit PATH ARGUMENT break, and only when that path was
// written relative to the project root. So the decision is made per COMMAND, before
// anything runs: if a command names a path-shaped argument that does not resolve under
// the task directory but does resolve under the project root, that one command runs
// from the root. Deliberately NOT try-then-fall-back — re-running a failed suite from a
// second cwd double-runs side-effecting tests and cannot tell "wrong cwd" from a real
// failure, which is exactly the discrimination that already failed once.
//
// PATH-SHAPED ARGUMENT — a whitespace-separated token (surrounding quotes stripped) that:
//   * does NOT start with '-' — excludes flags and their embedded values (`-p`,
//     `--target=bun`, `--outfile=dist/cairn`). A flag's value is typically an OUTPUT
//     path that need not exist yet, so its resolvability says nothing about the cwd.
//   * does NOT start with '@' — excludes scoped package names (`@scope/pkg`).
//   * AND either contains '/' (`test/config.test.ts`, `./run.sh`) or is a bare filename
//     with a letter-leading extension (`config.test.ts`, `tsconfig.json`) — the latter
//     is required so `bun test config.test.ts` is not missed by a slash-only rule.
// Excluded by construction: bare extensionless words (`test`, `build`, `run` are
// overwhelmingly subcommands) and dotted tokens whose extension is not letter-leading
// (`1.2.3` is a version, not a file).
// ---------------------------------------------------------------------------

const BARE_FILENAME_RE = /^[\w.-]+\.[A-Za-z]\w*$/;

function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;

  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function isPathShaped(token: string): boolean {
  if (!token || token.startsWith('-') || token.startsWith('@')) return false;
  if (token.includes('/')) return true;
  return BARE_FILENAME_RE.test(token);
}

// Base cwd for a task: <projectRoot>/<task.directory>, with '/' and '.' meaning the
// root itself. A directory that does not exist would make spawn fail with ENOENT for
// every command, so fall back to the root rather than turning a typo in tasks.json into
// a validation error.
function resolveTaskDir(directory: string | undefined, projectRoot: string): string {
  const root = path.resolve(projectRoot);
  const dir = directory?.trim();
  if (!dir || dir === '/' || dir === '.') return root;

  const resolved = path.resolve(root, dir.replace(/^\/+/, ''));
  try {
    if (!fs.statSync(resolved).isDirectory()) return root;
  } catch {
    return root;
  }
  return resolved;
}

function resolveCommandCwd(cmd: string, taskDir: string, projectRoot: string): string {
  if (taskDir === projectRoot) return projectRoot;

  for (const token of tokenizeCommand(cmd)) {
    if (!isPathShaped(token)) continue;
    if (fs.existsSync(path.resolve(taskDir, token))) continue;
    if (fs.existsSync(path.resolve(projectRoot, token))) return projectRoot;
  }
  return taskDir;
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
  const root = path.resolve(projectRoot);
  const taskDir = resolveTaskDir(task.directory, root);

  const logPath = tempFilePath(dataDir, `task_${task.id}_tests.log`);
  const logEntries: string[] = [];
  const summary: TestSummaryEntry[] = [];

  // Write the log (best-effort) and stamp logPath/summary onto whatever result
  // the caller is about to return. Called exactly once, right before returning.
  const finalize = (result: ValidationResult): ValidationResult => {
    writeTestLog(logPath, logEntries);
    return { ...result, logPath, summary: summary.length ? summary : undefined };
  };

  for (const cmd of task.tests) {
    const cwd = resolveCommandCwd(cmd, taskDir, root);
    const start = Date.now();
    const { exitCode, stdout, stderr } = await runCommand(cmd, cwd, timeoutMs);
    const durationMs = Date.now() - start;
    const output = `${stdout}\n${stderr}`;
    logEntries.push(formatLogEntry(cmd, cwd, exitCode, durationMs, output));

    if (exitCode === 0) {
      summary.push({ command: cmd, status: 'passed', durationMs, counts: parseCounts(output) });
      continue;
    }

    if (stderr.includes('timeout after')) {
      // Timeout → infrastructure error, don't revert
      summary.push({ command: cmd, status: 'error', durationMs, counts: parseCounts(output) });
      appendNote(data, fileTask, 'Post-iteration: test commands could not execute (missing deps/scripts).');
      writeAndSnapshot(tasksFilePath, dataDir, data);
      return finalize({ status: 'error', message: `timeout: ${cmd}`, failureTail: tailLines(output, FAILURE_TAIL_LINES) });
    }

    if (isCantRunError(output, exitCode)) {
      // Infrastructure error → note but don't revert
      summary.push({ command: cmd, status: 'error', durationMs, counts: parseCounts(output) });
      appendNote(data, fileTask, 'Post-iteration: test commands could not execute (missing deps/scripts).');
      writeAndSnapshot(tasksFilePath, dataDir, data);
      return finalize({ status: 'error', message: `can't run: ${cmd}`, failureTail: tailLines(output, FAILURE_TAIL_LINES) });
    }

    // Real test failure → revert status
    summary.push({ command: cmd, status: 'failed', durationMs, counts: parseCounts(output) });
    fileTask.status = 'in-progress';
    delete fileTask.completedAt;
    delete fileTask.completedBy;
    appendNote(data, fileTask, 'Post-iteration test validation failed — reverted to in-progress.');
    writeAndSnapshot(tasksFilePath, dataDir, data);
    return finalize({ status: 'failed', message: `${cmd}: ${output.trim().slice(-200)}`, failureTail: tailLines(output, FAILURE_TAIL_LINES) });
  }

  return finalize({ status: 'passed' });
}

function appendNote(data: { tasks: Task[] }, task: Task, note: string) {
  if (task.notes) {
    task.notes += ` | ${note}`;
  } else {
    task.notes = note;
  }
}
