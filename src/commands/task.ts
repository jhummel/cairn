import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import Ajv, { type ErrorObject } from 'ajv';
import { mutateTasksFile, type TasksFile } from '../tasks-file';
import { reserveTaskIds } from '../task-counter';
import { clearAttempt } from '../run-state';
import { BRAND } from '../brand';
import { defaultStdout, defaultStderr, type Writer } from '../cli-io';
import type { Task } from '../types';
import schema from '../tasks-schema.json' with { type: 'json' };

const VALID_STATUSES = ['pending', 'in-progress', 'complete', 'blocked'] as const;

function findTask(data: TasksFile, id: number): Task | undefined {
  return data.tasks.find((t) => t.id === id);
}

export interface TaskStartOpts {
  id: number;
  iteration: number;
  tasksPath: string;
  dataDir?: string;
  stderr?: Writer;
}

export function taskStart(opts: TaskStartOpts): number {
  const stderr = opts.stderr ?? defaultStderr();
  try {
    let found = true;
    mutateTasksFile(
      opts.tasksPath,
      (data) => {
        const t = findTask(data, opts.id);
        if (!t) {
          found = false;
          return;
        }
        t.status = 'in-progress';
      },
      { dataDir: opts.dataDir }
    );
    if (!found) {
      stderr.write(`cairn task start: task ${opts.id} not found\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    stderr.write(`cairn task start: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export interface TaskCompleteOpts {
  id: number;
  iteration: number;
  notes?: string;
  notesFile?: string;
  tasksPath: string;
  dataDir?: string;
  stderr?: Writer;
  readStdin?: () => string;
}

export function taskComplete(opts: TaskCompleteOpts): number {
  const stderr = opts.stderr ?? defaultStderr();
  const readStdin = opts.readStdin ?? (() => fs.readFileSync(0, 'utf-8'));

  let notesValue: string | undefined;
  if (opts.notes !== undefined) {
    notesValue = opts.notes;
  } else if (opts.notesFile !== undefined) {
    try {
      notesValue = opts.notesFile === '-' ? readStdin() : fs.readFileSync(opts.notesFile, 'utf-8');
    } catch (err) {
      stderr.write(`cairn task complete: failed to read notes: ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  try {
    let found = true;
    mutateTasksFile(
      opts.tasksPath,
      (data) => {
        const t = findTask(data, opts.id);
        if (!t) {
          found = false;
          return;
        }
        t.status = 'complete';
        t.completedAt = new Date().toISOString();
        t.completedBy = `iteration-${opts.iteration}`;
        if (notesValue !== undefined) {
          t.notes = notesValue;
        }
      },
      { dataDir: opts.dataDir }
    );
    if (!found) {
      stderr.write(`cairn task complete: task ${opts.id} not found\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    stderr.write(`cairn task complete: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export interface TaskNoteOpts {
  id: number;
  text: string;
  replace?: boolean;
  tasksPath: string;
  dataDir?: string;
  stderr?: Writer;
}

export function taskNote(opts: TaskNoteOpts): number {
  const stderr = opts.stderr ?? defaultStderr();
  try {
    let found = true;
    mutateTasksFile(
      opts.tasksPath,
      (data) => {
        const t = findTask(data, opts.id);
        if (!t) {
          found = false;
          return;
        }
        if (opts.replace || !t.notes) {
          t.notes = opts.text;
        } else {
          t.notes = `${t.notes} | ${opts.text}`;
        }
      },
      { dataDir: opts.dataDir }
    );
    if (!found) {
      stderr.write(`cairn task note: task ${opts.id} not found\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    stderr.write(`cairn task note: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export interface TaskSetStatusOpts {
  id: number;
  status: string;
  tasksPath: string;
  dataDir?: string;
  stderr?: Writer;
}

export function taskSetStatus(opts: TaskSetStatusOpts): number {
  const stderr = opts.stderr ?? defaultStderr();
  if (!VALID_STATUSES.includes(opts.status as typeof VALID_STATUSES[number])) {
    stderr.write(
      `cairn task set-status: invalid status '${opts.status}' (must be one of: ${VALID_STATUSES.join(', ')})\n`
    );
    return 1;
  }
  try {
    let found = true;
    mutateTasksFile(
      opts.tasksPath,
      (data) => {
        const t = findTask(data, opts.id);
        if (!t) {
          found = false;
          return;
        }
        t.status = opts.status as Task['status'];
      },
      { dataDir: opts.dataDir }
    );
    if (!found) {
      stderr.write(`cairn task set-status: task ${opts.id} not found\n`);
      return 1;
    }
    // A manual status change resets the task's guard counters. Cleared only
    // after mutateTasksFile has returned (lock ordering: never take the
    // run-state lock inside its callback), and best-effort: the status change
    // itself already succeeded.
    if (opts.dataDir) {
      try {
        clearAttempt(opts.dataDir, String(opts.id));
      } catch (err) {
        stderr.write(
          `cairn task set-status: warning: could not clear attempt record for task ${opts.id}: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
    return 0;
  } catch (err) {
    stderr.write(`cairn task set-status: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export interface TaskAddOpts {
  file: string;
  tasksPath: string;
  dataDir: string;
  stdout?: Writer;
  stderr?: Writer;
}

function formatAjvError(err: ErrorObject): { field: string; reason: string } {
  // For `required` errors, ajv sets instancePath to the parent and puts the missing field in params
  if (err.keyword === 'required' && err.params && typeof (err.params as { missingProperty?: string }).missingProperty === 'string') {
    const missing = (err.params as { missingProperty: string }).missingProperty;
    const base = err.instancePath || '';
    const field = base ? `${base}/${missing}` : missing;
    return { field, reason: `missing required property '${missing}'` };
  }
  const field = err.instancePath ? err.instancePath.replace(/^\//, '').replace(/\//g, '.') : '(root)';
  return { field, reason: err.message ?? 'invalid' };
}

const taskItemSchema = (schema as { properties: { tasks: { items: object } } }).properties.tasks.items;

export function taskAdd(opts: TaskAddOpts): number {
  const stdout = opts.stdout ?? defaultStdout();
  const stderr = opts.stderr ?? defaultStderr();

  let payload: unknown;
  try {
    const raw = fs.readFileSync(opts.file, 'utf-8');
    payload = JSON.parse(raw);
  } catch (err) {
    stderr.write(
      `cairn task add: validation failed — file: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }

  // Own id assignment: reserve a single id once and inject it into the payload,
  // overwriting any agent-supplied id. This runs before validation so the
  // schema's required `id` is always satisfied. The reserved id is captured
  // outside the mutate callback so a mutate retry reuses it rather than burning
  // a fresh id each attempt.
  let assignedId: number;
  try {
    [assignedId] = reserveTaskIds(opts.dataDir, 1);
  } catch (err) {
    stderr.write(`cairn task add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (payload && typeof payload === 'object') {
    (payload as { id: number }).id = assignedId;
  }

  const ajv = new Ajv({ allErrors: false, strict: false, logger: false });
  const validate = ajv.compile(taskItemSchema);
  if (!validate(payload)) {
    const first = (validate.errors ?? [])[0];
    if (first) {
      const { field, reason } = formatAjvError(first);
      stderr.write(`cairn task add: validation failed — ${field}: ${reason}\n`);
    } else {
      stderr.write('cairn task add: validation failed — unknown: invalid payload\n');
    }
    return 1;
  }

  try {
    mutateTasksFile(
      opts.tasksPath,
      (data) => {
        data.tasks.push(payload as Task);
      },
      { dataDir: opts.dataDir }
    );
    stdout.write(`assigned id: ${assignedId}\n`);
    return 0;
  } catch (err) {
    stderr.write(`cairn task add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export interface TaskShowOpts {
  id: number;
  tasksPath: string;
  stdout?: Writer;
  stderr?: Writer;
}

export function taskShow(opts: TaskShowOpts): number {
  const stdout = opts.stdout ?? defaultStdout();
  const stderr = opts.stderr ?? defaultStderr();
  try {
    const raw = fs.readFileSync(opts.tasksPath, 'utf-8');
    const data = JSON.parse(raw) as TasksFile;
    const t = findTask(data, opts.id);
    if (!t) {
      stderr.write(`cairn task show: task ${opts.id} not found\n`);
      return 1;
    }
    stdout.write(JSON.stringify(t, null, 2) + '\n');
    return 0;
  } catch (err) {
    stderr.write(`cairn task show: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export interface TaskNextIdOpts {
  count?: number;
  dataDir: string;
  stdout?: Writer;
  stderr?: Writer;
}

export function taskNextId(opts: TaskNextIdOpts): number {
  const stdout = opts.stdout ?? defaultStdout();
  const stderr = opts.stderr ?? defaultStderr();
  const count = opts.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    stderr.write(`cairn task next-id: --count must be a positive integer, got ${count}\n`);
    return 1;
  }
  try {
    const ids = reserveTaskIds(opts.dataDir, count);
    stdout.write(ids.join('\n') + '\n');
    return 0;
  } catch (err) {
    stderr.write(`cairn task next-id: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/**
 * Wire the `task` subcommand group onto a Commander program.
 */
export function registerTaskCommands(program: Command): void {
  const tasksPath = () => path.join(process.env.CAIRN_DATA_DIR!, 'tasks.json');
  const dataDir = () => process.env.CAIRN_DATA_DIR!;

  const task = program
    .command('task')
    .description(`Manage tasks in ${BRAND.dataDir}/tasks.json`);

  task
    .command('start <id>')
    .description('Mark a task as in-progress')
    .requiredOption('--iteration <n>', 'Iteration number', (v) => parseInt(v, 10))
    .action((idStr: string, options: { iteration: number }) => {
      const code = taskStart({
        id: parseInt(idStr, 10),
        iteration: options.iteration,
        tasksPath: tasksPath(),
        dataDir: dataDir(),
      });
      process.exit(code);
    });

  task
    .command('complete <id>')
    .description('Mark a task as complete')
    .requiredOption('--iteration <n>', 'Iteration number', (v) => parseInt(v, 10))
    .option('--notes <text>', 'Completion notes as literal text')
    .option('--notes-file <path>', "Read notes from file (or '-' for stdin)")
    .action((idStr: string, options: { iteration: number; notes?: string; notesFile?: string }) => {
      const code = taskComplete({
        id: parseInt(idStr, 10),
        iteration: options.iteration,
        notes: options.notes,
        notesFile: options.notesFile,
        tasksPath: tasksPath(),
        dataDir: dataDir(),
      });
      process.exit(code);
    });

  task
    .command('note <id> <text>')
    .description('Append (or replace with --replace) a note on a task')
    .option('--replace', 'Replace the existing notes instead of appending')
    .action((idStr: string, text: string, options: { replace?: boolean }) => {
      const code = taskNote({
        id: parseInt(idStr, 10),
        text,
        replace: options.replace,
        tasksPath: tasksPath(),
        dataDir: dataDir(),
      });
      process.exit(code);
    });

  task
    .command('set-status <id> <status>')
    .description('Set task status (pending|in-progress|complete|blocked)')
    .action((idStr: string, status: string) => {
      const code = taskSetStatus({
        id: parseInt(idStr, 10),
        status,
        tasksPath: tasksPath(),
        dataDir: dataDir(),
      });
      process.exit(code);
    });

  task
    .command('add')
    .description('Append a new task from a JSON file (validated)')
    .requiredOption('--file <path>', 'Path to JSON file containing the new task')
    .action((options: { file: string }) => {
      const code = taskAdd({
        file: options.file,
        tasksPath: tasksPath(),
        dataDir: dataDir(),
      });
      process.exit(code);
    });

  task
    .command('next-id')
    .description('Reserve and print the next task id(s), one per line')
    .option('--count <n>', 'Number of ids to reserve (default 1)', (v) => parseInt(v, 10), 1)
    .action((options: { count: number }) => {
      const code = taskNextId({
        count: options.count,
        dataDir: dataDir(),
      });
      process.exit(code);
    });

  task
    .command('show <id>')
    .description('Print a single task as formatted JSON')
    .action((idStr: string) => {
      const code = taskShow({
        id: parseInt(idStr, 10),
        tasksPath: tasksPath(),
      });
      process.exit(code);
    });
}
