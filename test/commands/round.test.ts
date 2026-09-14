import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { roundNext, roundNextCommand, roundSettleCommand, registerRoundCommands, type RoundNextDeps } from '../../src/commands/round';
import { buildSystemPrompt, resolveTaskModel } from '../../src/commands/run';
import { newAttemptRecord, readRunState, updateRunState, type RunState, type RunStateStore } from '../../src/run-state';
import type { HealthCheckOpts, HealthCheckResult } from '../../src/health-check';
import { SettleError, createInMemoryGuardCounters, type SettleTaskDeps, type BlockTaskOpts, type WriteReviewPromptFileOpts } from '../../src/settle';
import { TasksFileError } from '../../src/tasks-file';
import { FileLockError } from '../../src/file-lock';
import type { ValidationResult } from '../../src/test-validator';
import type { AgentInfo, CairnConfig, Task } from '../../src/types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 7,
    priority: 1,
    title: 'Task seven',
    description: 'desc',
    status: 'pending',
    files: [],
    dependencies: [],
    tests: ['bun test'],
    ...overrides,
  } as Task;
}

function makeConfig(overrides: Partial<CairnConfig> = {}): CairnConfig {
  return {
    projectName: 'proj',
    projectDescription: '',
    healthCheck: 'bun run build',
    defaultTestCommand: 'bun test',
    implementationFile: 'IMPLEMENTATION.md',
    truncateText: true,
    summarize: { claudeMdPattern: '' },
    narration: { enabled: false, voice: '', ntfyTopic: '' },
    ...overrides,
  };
}

let projectRoot: string;
let dataDir: string;

function writeTasks(tasks: Task[]): void {
  fs.writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks }, null, 2));
}

interface Harness {
  deps: RoundNextDeps;
  healthCalls: HealthCheckOpts[];
  shaCalls: string[];
  reviewWrites: WriteReviewPromptFileOpts[];
  setHealth: (r: HealthCheckResult) => void;
  setHead: (sha: string | null) => void;
  lockHeldDuringHealth: () => boolean;
}

function makeHarness(): Harness {
  const healthCalls: HealthCheckOpts[] = [];
  const shaCalls: string[] = [];
  const reviewWrites: WriteReviewPromptFileOpts[] = [];
  let health: HealthCheckResult = { status: 'ok' };
  let head: string | null = 'sha-head';
  let lockHeld = false;
  return {
    healthCalls,
    shaCalls,
    reviewWrites,
    setHealth: (r) => { health = r; },
    setHead: (sha) => { head = sha; },
    lockHeldDuringHealth: () => lockHeld,
    deps: {
      runHealthCheck: async (opts) => {
        healthCalls.push(opts);
        if (fs.existsSync(path.join(dataDir, '.cairn_run_state.json.lock'))) lockHeld = true;
        return health;
      },
      captureGitSha: (root) => {
        shaCalls.push(root);
        return head;
      },
      writeReviewPromptFile: (opts) => {
        reviewWrites.push(opts);
        const file = path.join(opts.dataDir, `.cairn_task_${opts.taskId}_review_prompt.md`);
        fs.writeFileSync(file, 'review prompt');
        return file;
      },
    },
  };
}

function input(overrides: { config?: CairnConfig; agents?: AgentInfo[] } = {}) {
  return { projectRoot, dataDir, config: overrides.config ?? makeConfig(), agents: overrides.agents ?? [] };
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-round-'));
  dataDir = path.join(projectRoot, '.cairn');
  fs.mkdirSync(dataDir);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('roundNext', () => {
  describe('pending review first', () => {
    test('returns an awaiting-review record before selecting any task', async () => {
      writeTasks([makeTask({ id: 7 })]);
      updateRunState(dataDir, (state) => {
        state.iteration = 4;
        state.attempts['3'] = { ...newAttemptRecord('sha-before', 4), phase: 'awaiting-review' };
      });
      const h = makeHarness();

      const result = await roundNext(input(), h.deps);

      const reviewPromptFile = path.join(dataDir, '.cairn_task_3_review_prompt.md');
      expect(result).toEqual({
        verdict: 'review',
        taskId: 3,
        reviewPromptFile,
        next: `Launch the post-task-reviewer agent with the prompt 'Read ${reviewPromptFile} and follow it', then run: cairn round settle 3 --reviewed`,
      });
      expect(h.healthCalls).toHaveLength(0);
      expect(readRunState(dataDir).iteration).toBe(4);
      expect(readRunState(dataDir).attempts['7']).toBeUndefined();
      expect(fs.existsSync(path.join(dataDir, '.cairn_task_7_prompt.md'))).toBe(false);
    });

    test('rewrites a missing review prompt file from the record beforeSha', async () => {
      writeTasks([]);
      updateRunState(dataDir, (state) => {
        state.attempts['3'] = { ...newAttemptRecord('sha-before', 1), phase: 'awaiting-review' };
      });
      const h = makeHarness();

      await roundNext(input(), h.deps);

      expect(h.reviewWrites).toEqual([{ projectRoot, dataDir, taskId: 3, beforeSha: 'sha-before' }]);
    });

    test('leaves an existing review prompt file alone', async () => {
      writeTasks([]);
      updateRunState(dataDir, (state) => {
        state.attempts['3'] = { ...newAttemptRecord('sha-before', 1), phase: 'awaiting-review' };
      });
      fs.writeFileSync(path.join(dataDir, '.cairn_task_3_review_prompt.md'), 'existing');
      const h = makeHarness();

      await roundNext(input(), h.deps);

      expect(h.reviewWrites).toHaveLength(0);
    });

    test('does not return an executing record as a review', async () => {
      writeTasks([makeTask({ id: 7 })]);
      updateRunState(dataDir, (state) => {
        state.attempts['7'] = newAttemptRecord('sha-before', 1);
      });
      const h = makeHarness();

      const result = await roundNext(input(), h.deps);

      expect(result.verdict).toBe('task');
    });
  });

  describe('round-done', () => {
    test('reports the blocked count and tells the driver to notify and stop', async () => {
      writeTasks([
        makeTask({ id: 1, status: 'blocked' }),
        makeTask({ id: 2, status: 'blocked' }),
        makeTask({ id: 3, status: 'pending', dependencies: [1] }),
      ]);
      const h = makeHarness();

      const result = await roundNext(input(), h.deps);

      expect(result.verdict).toBe('round-done');
      if (result.verdict !== 'round-done') throw new Error('unreachable');
      expect(result.blocked).toBe(2);
      expect(result.next).toMatch(/notification/i);
      expect(result.next).toMatch(/stop/i);
      expect(h.healthCalls).toHaveLength(0);
      expect(readRunState(dataDir).iteration).toBe(0);
    });

    test('an empty task list is round-done with zero blocked', async () => {
      writeTasks([]);
      const result = await roundNext(input(), makeHarness().deps);
      expect(result).toMatchObject({ verdict: 'round-done', blocked: 0 });
    });

    test('an unreadable tasks.json with no snapshot throws', async () => {
      fs.writeFileSync(path.join(dataDir, 'tasks.json'), '');
      await expect(roundNext(input(), makeHarness().deps)).rejects.toThrow();
    });
  });

  describe('attempt record', () => {
    test('a new record gets the HEAD sha in phase executing', async () => {
      writeTasks([makeTask({ id: 7 })]);
      const h = makeHarness();
      h.setHead('abc123');

      await roundNext(input(), h.deps);

      expect(h.shaCalls).toEqual([projectRoot]);
      expect(readRunState(dataDir).attempts['7']).toEqual(newAttemptRecord('abc123', 1));
    });

    test('a re-pick keeps the original beforeSha and counters', async () => {
      writeTasks([makeTask({ id: 7, status: 'in-progress' })]);
      updateRunState(dataDir, (state) => {
        state.iteration = 2;
        state.attempts['7'] = { ...newAttemptRecord('original-sha', 2), reverts: 1, incompletes: 1 };
      });
      const h = makeHarness();
      h.setHead('new-head');

      await roundNext(input(), h.deps);

      expect(h.shaCalls).toHaveLength(0);
      expect(readRunState(dataDir).attempts['7']).toEqual({
        ...newAttemptRecord('original-sha', 3),
        reverts: 1,
        incompletes: 1,
      });
    });

    test('iteration increments across calls and is stored on the record', async () => {
      writeTasks([makeTask({ id: 7 })]);
      const h = makeHarness();

      const first = await roundNext(input(), h.deps);
      const second = await roundNext(input(), h.deps);

      expect(first).toMatchObject({ verdict: 'task', iteration: 1 });
      expect(second).toMatchObject({ verdict: 'task', iteration: 2 });
      const state = readRunState(dataDir);
      expect(state.iteration).toBe(2);
      expect(state.attempts['7'].iteration).toBe(2);
    });

    test('the run-state lock is not held during the health check', async () => {
      writeTasks([makeTask({ id: 7 })]);
      const h = makeHarness();
      await roundNext(input(), h.deps);
      expect(h.healthCalls).toHaveLength(1);
      expect(h.lockHeldDuringHealth()).toBe(false);
    });
  });

  describe('prompt file', () => {
    test('contains the subagent-mode system prompt, a separator, and the iteration prompt', async () => {
      const config = makeConfig();
      writeTasks([makeTask({ id: 7, title: 'Build the widget', directory: 'pkg/widget' })]);

      const result = await roundNext(input({ config }), makeHarness().deps);

      const promptFile = path.join(dataDir, '.cairn_task_7_prompt.md');
      expect(result).toMatchObject({ verdict: 'task', promptFile });
      const content = fs.readFileSync(promptFile, 'utf-8');
      const systemPrompt = buildSystemPrompt({
        taskDir: 'pkg/widget', taskAgent: '', projectRoot, dataDir, config, agents: [], iteration: 1, mode: 'subagent',
      });
      expect(content.startsWith(`${systemPrompt}\n\n---\n\n`)).toBe(true);
      expect(content).toContain('REPORT:');
      expect(content).not.toContain('.cairn_complete');
      expect(content).toContain(path.join(projectRoot, 'pkg/widget'));
      expect(content).toContain('YOUR ASSIGNED TASK (#7):');
      expect(content).toContain('Title: Build the widget');
      expect(content.trimEnd().endsWith('Begin work.')).toBe(true);
    });

    test('maxIterations and totalRemaining are derived from the remaining work', async () => {
      writeTasks([
        makeTask({ id: 1, priority: 1 }),
        makeTask({ id: 2, priority: 2 }),
        makeTask({ id: 3, priority: 3 }),
        makeTask({ id: 4, priority: 4, status: 'blocked' }),
        makeTask({ id: 5, priority: 5, status: 'complete' }),
      ]);
      updateRunState(dataDir, (state) => { state.iteration = 4; });

      await roundNext(input(), makeHarness().deps);

      const content = fs.readFileSync(path.join(dataDir, '.cairn_task_1_prompt.md'), 'utf-8');
      // Iteration 5, three pending tasks: this one plus two more → last iteration 7.
      expect(content).toContain('Iteration 5 of 7.');
      expect(content).toContain('Remaining tasks after this one: 2');
    });

    test('a health check failure is prepended to the iteration prompt', async () => {
      const config = makeConfig({ healthCheck: 'make check' });
      writeTasks([makeTask({ id: 7 })]);
      const h = makeHarness();
      h.setHealth({ status: 'failed', output: 'BUILD HEALTH CHECK FAILED:\nboom' });

      await roundNext(input({ config }), h.deps);

      expect(h.healthCalls).toEqual([{ healthCheck: 'make check', projectRoot }]);
      const content = fs.readFileSync(path.join(dataDir, '.cairn_task_7_prompt.md'), 'utf-8');
      expect(content).toContain('\n\n---\n\nBUILD HEALTH CHECK FAILED:\nboom\n\n---\n\nIteration 1 of 1.');
    });

    test('a passing health check adds nothing', async () => {
      writeTasks([makeTask({ id: 7 })]);
      await roundNext(input(), makeHarness().deps);
      const content = fs.readFileSync(path.join(dataDir, '.cairn_task_7_prompt.md'), 'utf-8');
      expect(content).not.toContain('BUILD HEALTH CHECK FAILED');
    });
  });

  describe('task verdict', () => {
    test('returns the task, model, prompt file, and a launch-then-settle hint', async () => {
      writeTasks([makeTask({ id: 7, title: 'Task seven', agent: 'db-expert' })]);
      const agents: AgentInfo[] = [{ name: 'db-expert', description: '', model: 'sonnet', file: 'db-expert.md' }];

      const result = await roundNext(input({ agents }), makeHarness().deps);

      const promptFile = path.join(dataDir, '.cairn_task_7_prompt.md');
      expect(result).toEqual({
        verdict: 'task',
        taskId: 7,
        title: 'Task seven',
        iteration: 1,
        model: 'sonnet',
        promptFile,
        next: `Launch the Agent tool with subagent_type 'cairn-task-agent', model 'sonnet', prompt 'Read ${promptFile} and follow it', then run: cairn round settle 7`,
      });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });

    test('selects the in-progress task ahead of pending work', async () => {
      writeTasks([makeTask({ id: 1, priority: 1 }), makeTask({ id: 2, priority: 9, status: 'in-progress' })]);
      const result = await roundNext(input(), makeHarness().deps);
      expect(result).toMatchObject({ verdict: 'task', taskId: 2 });
    });
  });
});

describe('resolveTaskModel', () => {
  const agents: AgentInfo[] = [
    { name: 'db-expert', description: '', model: 'sonnet', file: 'db-expert.md' },
    { name: 'no-model', description: '', model: '', file: 'no-model.md' },
  ];

  test('defaults to opus', () => {
    expect(resolveTaskModel(makeTask(), agents)).toBe('opus');
  });

  test("uses the task's own model", () => {
    expect(resolveTaskModel(makeTask({ model: 'sonnet' }), agents)).toBe('sonnet');
  });

  test("uses the specialist agent's model when the task has none", () => {
    expect(resolveTaskModel(makeTask({ agent: 'db-expert' }), agents)).toBe('sonnet');
  });

  test("the task's model wins over the agent's", () => {
    expect(resolveTaskModel(makeTask({ agent: 'db-expert', model: 'opus' }), agents)).toBe('opus');
  });

  test('an unknown agent or an agent without a model falls back to opus', () => {
    expect(resolveTaskModel(makeTask({ agent: 'missing' }), agents)).toBe('opus');
    expect(resolveTaskModel(makeTask({ agent: 'no-model' }), agents)).toBe('opus');
  });
});

// --- CLI handlers (task 99) ---

function makeWriter(): { write: (chunk: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (chunk: string) => { lines.push(chunk); } };
}

function makeMemoryRunState(initial: RunState = { iteration: 0, attempts: {} }): RunStateStore {
  const state = structuredClone(initial);
  return {
    read: () => structuredClone(state),
    update: (_dataDir, fn) => fn(state),
  };
}

function makeThrowingRunState(err: Error): RunStateStore {
  return {
    read: () => ({ iteration: 0, attempts: {} }),
    update: () => { throw err; },
  };
}

interface SettleHarness {
  deps: Partial<SettleTaskDeps>;
  logs: string[];
  appended: string[];
  blocked: BlockTaskOpts[];
  archiveCalls: Array<{ tasksFilePath: string; dataDir: string; iterationLogPath?: string }>;
}

function makeSettleHarness(overrides: {
  tasks?: Task[];
  completedIds?: Set<number>;
  validation?: ValidationResult;
  readTasksFile?: SettleTaskDeps['readTasksFile'];
  runState?: RunStateStore;
  counters?: SettleTaskDeps['counters'];
  headSha?: string | null;
  taskBaseSha?: string | null;
  includeLog?: boolean;
} = {}): SettleHarness {
  const logs: string[] = [];
  const appended: string[] = [];
  const blocked: BlockTaskOpts[] = [];
  const archiveCalls: SettleHarness['archiveCalls'] = [];
  const deps: Partial<SettleTaskDeps> = {
    validateTaskTests: async () => overrides.validation ?? { status: 'passed' },
    archiveCompletedTasks: async (opts) => {
      archiveCalls.push(opts);
      return { archivedCount: 1, prevNotes: null, warnings: [] };
    },
    git: {
      headSha: () => overrides.headSha ?? 'sha-after',
      taskBaseSha: () => (overrides.taskBaseSha === undefined ? 'sha-before' : overrides.taskBaseSha),
    },
    writeReviewPromptFile: (opts) => {
      const file = path.join(opts.dataDir, `.cairn_task_${opts.taskId}_review_prompt.md`);
      fs.writeFileSync(file, 'review prompt');
      return file;
    },
    existsSync: () => false,
    readTasksFile: overrides.readTasksFile ?? (() => ({ data: { tasks: overrides.tasks ?? [] }, repaired: false, restored: false })),
    blockTask: (opts) => { blocked.push(opts); },
    appendFileSync: (_p, content) => { appended.push(content); },
    loadCompletedIds: () => overrides.completedIds ?? new Set(),
    counters: overrides.counters ?? createInMemoryGuardCounters(),
    runState: overrides.runState ?? makeMemoryRunState(),
  };
  if (overrides.includeLog !== false) {
    deps.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  }
  return { deps, logs, appended, blocked, archiveCalls };
}

describe('roundNextCommand', () => {
  test('prints the roundNext result as JSON on stdout and exits 0', async () => {
    writeTasks([makeTask({ id: 7 })]);
    const h = makeHarness();
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundNextCommand({ ...input(), stdout, stderr }, h.deps);

    expect(code).toBe(0);
    expect(stderr.lines).toHaveLength(0);
    expect(stdout.lines).toHaveLength(1);
    const parsed = JSON.parse(stdout.lines[0]);
    expect(parsed).toMatchObject({ verdict: 'task', taskId: 7 });
  });

  test('an unreadable tasks.json exits 1 with a one-line stderr message and no stdout', async () => {
    fs.writeFileSync(path.join(dataDir, 'tasks.json'), '');
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundNextCommand({ ...input(), stdout, stderr }, makeHarness().deps);

    expect(code).toBe(1);
    expect(stdout.lines).toHaveLength(0);
    expect(stderr.lines).toHaveLength(1);
    expect(stderr.lines[0]).toContain('cairn round next');
  });
});

describe('roundSettleCommand', () => {
  test('retry verdict: a failed validation below the revert threshold prints a retry JSON verdict', async () => {
    const h = makeSettleHarness({
      tasks: [makeTask({ id: 7, status: 'in-progress' })],
      validation: { status: 'failed', message: 'boom', failureTail: 'boom' },
    });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(0);
    expect(stdout.lines).toHaveLength(1);
    const parsed = JSON.parse(stdout.lines[0]);
    expect(parsed).toMatchObject({ verdict: 'retry', taskId: 7, mode: 'continue', reason: 'validation-failed' });
    expect(stderr.lines).toHaveLength(0);
  });

  test('blocked verdict: exits 0 with a blocked JSON verdict', async () => {
    const h = makeSettleHarness({
      tasks: [makeTask({ id: 7, status: 'blocked', notes: 'agent gave up' })],
      validation: { status: 'passed' },
    });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.lines[0]);
    expect(parsed).toMatchObject({ verdict: 'blocked', taskId: 7, reason: 'agent gave up' });
  });

  test('review verdict: a completed task with review enabled prints a review JSON verdict', async () => {
    const h = makeSettleHarness({
      tasks: [makeTask({ id: 7, status: 'complete' })],
      validation: { status: 'passed' },
      headSha: 'sha-after',
      taskBaseSha: 'sha-before',
    });
    const config = makeConfig({ review: { postTask: true, maxIterations: 5 } });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config, stdout, stderr }, h.deps);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.lines[0]);
    const reviewPromptFile = path.join(dataDir, '.cairn_task_7_review_prompt.md');
    expect(parsed).toMatchObject({ verdict: 'review', taskId: 7, reviewPromptFile });
    expect(h.archiveCalls).toHaveLength(1);
  });

  test('done verdict: a completed task with review disabled prints a done JSON verdict', async () => {
    const h = makeSettleHarness({
      tasks: [makeTask({ id: 7, status: 'complete' })],
      validation: { status: 'passed' },
    });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.lines[0]);
    expect(parsed).toMatchObject({ verdict: 'done', taskId: 7, reason: 'review-disabled' });
  });

  test('already-settled verdict: a task missing from tasks.json but present in the archive exits 0', async () => {
    const h = makeSettleHarness({ tasks: [], completedIds: new Set([7]) });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.lines[0]);
    expect(parsed).toMatchObject({ verdict: 'already-settled', taskId: 7 });
  });

  test('unknown task id: SettleError exits 1 with a one-line stderr message and no stdout', async () => {
    const h = makeSettleHarness({ tasks: [], completedIds: new Set() });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 999, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(1);
    expect(stdout.lines).toHaveLength(0);
    expect(stderr.lines).toHaveLength(1);
    expect(stderr.lines[0]).toContain('999');
  });

  test('an unreadable tasks.json (TasksFileError) exits 1', async () => {
    const h = makeSettleHarness({
      readTasksFile: () => { throw new TasksFileError('tasks.json is corrupt'); },
    });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(1);
    expect(stdout.lines).toHaveLength(0);
    expect(stderr.lines[0]).toContain('corrupt');
  });

  test('a run-state lock timeout (FileLockError) exits 1', async () => {
    const h = makeSettleHarness({
      tasks: [makeTask({ id: 7 })],
      runState: makeThrowingRunState(new FileLockError('lock timed out')),
    });
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(1);
    expect(stdout.lines).toHaveLength(0);
    expect(stderr.lines[0]).toContain('lock timed out');
  });

  test('an invalid task id exits 1 without invoking settle', async () => {
    const h = makeSettleHarness();
    let validateCalled = false;
    h.deps.validateTaskTests = async () => { validateCalled = true; return { status: 'passed' }; };
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: NaN, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(1);
    expect(validateCalled).toBe(false);
    expect(stdout.lines).toHaveLength(0);
    expect(stderr.lines).toHaveLength(1);
  });

  test('a non-positive-integer --test-timeout exits 1 without invoking settle', async () => {
    const h = makeSettleHarness();
    let validateCalled = false;
    h.deps.validateTaskTests = async () => { validateCalled = true; return { status: 'passed' }; };
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand(
      { id: 7, projectRoot, dataDir, config: makeConfig(), testTimeoutSec: 0, stdout, stderr },
      h.deps
    );

    expect(code).toBe(1);
    expect(validateCalled).toBe(false);
    expect(stderr.lines).toHaveLength(1);
  });

  test('--test-timeout in seconds is converted to ms for test validation', async () => {
    let receivedTimeoutMs: number | undefined;
    const h = makeSettleHarness({ tasks: [makeTask({ id: 7 })] });
    h.deps.validateTaskTests = async (opts) => { receivedTimeoutMs = opts.timeoutMs; return { status: 'passed' }; };

    await roundSettleCommand(
      { id: 7, projectRoot, dataDir, config: makeConfig(), testTimeoutSec: 30, stdout: makeWriter(), stderr: makeWriter() },
      h.deps
    );

    expect(receivedTimeoutMs).toBe(30000);
  });

  test('log output from settle deps is routed to stderr, never stdout', async () => {
    const h = makeSettleHarness({
      tasks: [makeTask({ id: 7, status: 'complete' })],
      validation: { status: 'error', message: 'timed out' },
    });
    delete h.deps.log; // exercise the CLI's own default routing, not the harness's
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await roundSettleCommand({ id: 7, projectRoot, dataDir, config: makeConfig(), stdout, stderr }, h.deps);

    expect(code).toBe(0);
    expect(stdout.lines).toHaveLength(1);
    expect(() => JSON.parse(stdout.lines[0])).not.toThrow();
    expect(stderr.lines.join('')).toContain('timed out');
  });
});

describe('registerRoundCommands', () => {
  test('registers the round command group with next and settle subcommands', () => {
    const program = new Command();
    registerRoundCommands(program);
    const round = program.commands.find((c) => c.name() === 'round');
    expect(round).toBeDefined();
    const subNames = round!.commands.map((c) => c.name());
    expect(subNames).toContain('next');
    expect(subNames).toContain('settle');
  });

  test('settle has the documented options', () => {
    const program = new Command();
    registerRoundCommands(program);
    const round = program.commands.find((c) => c.name() === 'round');
    const settle = round!.commands.find((c) => c.name() === 'settle');
    expect(settle).toBeDefined();
    const longFlags = settle!.options.map((o) => o.long);
    expect(longFlags).toContain('--reviewed');
    expect(longFlags).toContain('--before-sha');
    expect(longFlags).toContain('--test-timeout');
    const args = settle!.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true);
  });
});
