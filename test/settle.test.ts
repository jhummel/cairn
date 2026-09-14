import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRunState, updateRunState } from '../src/run-state';
import {
  settleTask,
  createInMemoryGuardCounters,
  createRunStateGuardCounters,
  REVERT_BLOCK_THRESHOLD,
  STALL_BLOCK_THRESHOLD,
  INCOMPLETE_BLOCK_THRESHOLD,
  summarizeFailure,
  type SettleTaskInput,
  type SettleTaskDeps,
  type BlockTaskOpts,
  type GuardCounters,
} from '../src/settle';
import type { ValidationResult } from '../src/test-validator';
import type { Task } from '../src/types';

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

interface Harness {
  deps: SettleTaskDeps;
  counters: GuardCounters;
  blocked: BlockTaskOpts[];
  logs: string[];
  appended: Array<{ p: string; content: string }>;
  setValidation: (v: ValidationResult) => void;
  setStatus: (s: string | null) => void;
  setUnreadable: (u: boolean) => void;
  setCorruption: (c: { repaired?: boolean; restored?: boolean }) => void;
  setBlockThrows: (t: boolean) => void;
}

function makeHarness(): Harness {
  let validation: ValidationResult = { status: 'passed' };
  let status: string | null = 'complete';
  let unreadable = false;
  let corruption: { repaired?: boolean; restored?: boolean } = {};
  let blockThrows = false;
  const blocked: BlockTaskOpts[] = [];
  const logs: string[] = [];
  const appended: Array<{ p: string; content: string }> = [];
  const counters = createInMemoryGuardCounters();

  const deps: SettleTaskDeps = {
    validateTaskTests: async () => validation,
    readTasksFile: () => {
      if (unreadable) throw new Error('unreadable');
      const tasks = status === null ? [] : [makeTask({ status: status as Task['status'] })];
      return {
        data: { tasks } as any,
        repaired: corruption.repaired ?? false,
        restored: corruption.restored ?? false,
      };
    },
    blockTask: (opts) => {
      if (blockThrows) throw new Error('lock busy');
      blocked.push(opts);
    },
    appendFileSync: (p, content) => { appended.push({ p, content }); },
    log: (...args) => { logs.push(args.map(String).join(' ')); },
    counters,
  };

  return {
    deps,
    counters,
    blocked,
    logs,
    appended,
    setValidation: (v) => { validation = v; },
    setStatus: (s) => { status = s; },
    setUnreadable: (u) => { unreadable = u; },
    setCorruption: (c) => { corruption = c; },
    setBlockThrows: (t) => { blockThrows = t; },
  };
}

function makeInput(overrides: Partial<SettleTaskInput> = {}): SettleTaskInput {
  return {
    task: makeTask(),
    tasksFilePath: '/proj/.cairn/tasks.json',
    dataDir: '/proj/.cairn',
    projectRoot: '/proj',
    iteration: 1,
    iterationLogPath: '/proj/.cairn/.cairn_iterations.log',
    ...overrides,
  };
}

describe('thresholds', () => {
  test('are fixed at 2 reverts, 3 stalls, 3 incompletes', () => {
    expect(REVERT_BLOCK_THRESHOLD).toBe(2);
    expect(STALL_BLOCK_THRESHOLD).toBe(3);
    expect(INCOMPLETE_BLOCK_THRESHOLD).toBe(3);
  });
});

describe('summarizeFailure', () => {
  test('falls back when message is missing', () => {
    expect(summarizeFailure(undefined)).toBe('unknown command');
  });

  test('collapses whitespace and truncates at 300 chars', () => {
    expect(summarizeFailure('a\n  b\tc')).toBe('a b c');
    const long = 'x'.repeat(400);
    expect(summarizeFailure(long)).toBe(`${'x'.repeat(300)}…`);
  });
});

describe('createInMemoryGuardCounters', () => {
  test('tracks reverts and stalls independently per task', () => {
    const c = createInMemoryGuardCounters();
    expect(c.get(1, 'reverts')).toBe(0);
    c.set(1, 'reverts', 2);
    c.set(1, 'stalls', 1);
    c.set(2, 'reverts', 5);
    expect(c.get(1, 'reverts')).toBe(2);
    expect(c.get(1, 'stalls')).toBe(1);
    expect(c.get(2, 'reverts')).toBe(5);
    c.clear(1, 'reverts');
    expect(c.get(1, 'reverts')).toBe(0);
    expect(c.get(1, 'stalls')).toBe(1);
  });
});

describe('createRunStateGuardCounters', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-settle-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('reads 0 when no attempt record exists and clear does not create one', () => {
    const c = createRunStateGuardCounters(dataDir);
    expect(c.get(7, 'reverts')).toBe(0);
    c.clear(7, 'stalls');
    expect(readRunState(dataDir).attempts['7']).toBeUndefined();
  });

  test('set creates a default record when none exists', () => {
    createRunStateGuardCounters(dataDir).set(7, 'stalls', 2);
    expect(readRunState(dataDir).attempts['7']).toEqual({
      beforeSha: null, iteration: 0, reverts: 0, stalls: 2, incompletes: 0, phase: 'executing',
    });
  });

  test('stores counts in the existing attempt record without touching its other fields', () => {
    updateRunState(dataDir, (s) => {
      s.attempts['7'] = { beforeSha: 'abc', iteration: 4, reverts: 0, stalls: 0, incompletes: 1, phase: 'executing' };
    });
    const c = createRunStateGuardCounters(dataDir);
    c.set(7, 'reverts', 1);
    expect(createRunStateGuardCounters(dataDir).get(7, 'reverts')).toBe(1);
    c.clear(7, 'reverts');
    expect(readRunState(dataDir).attempts['7']).toEqual({
      beforeSha: 'abc', iteration: 4, reverts: 0, stalls: 0, incompletes: 1, phase: 'executing',
    });
  });

  test('counters survive separate settleTask calls against the same data dir', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'failed', message: 'bun test exited 1' });
    // No injected counters: settleTask falls back to the run-state file.
    const { counters: _unused, ...rest } = h.deps;
    const input = makeInput({ dataDir });

    const first = await settleTask({ ...input, iteration: 1 }, { ...rest });
    expect(first.blockedByGuard).toBe(false);
    expect(readRunState(dataDir).attempts['7']?.reverts).toBe(1);

    const second = await settleTask({ ...input, iteration: 2 }, { ...rest });
    expect(second.blockedByGuard).toBe(true);
    expect(h.blocked).toHaveLength(1);
    expect(readRunState(dataDir).attempts['7']?.reverts ?? 0).toBe(0);
  });
});

describe('settleTask', () => {
  test('passes validation opts through and returns the validation result', async () => {
    const h = makeHarness();
    let seen: any;
    h.deps.validateTaskTests = async (opts) => { seen = opts; return { status: 'skipped' }; };
    const input = makeInput();
    const result = await settleTask(input, h.deps);
    expect(seen).toEqual({ task: input.task, tasksFilePath: input.tasksFilePath, projectRoot: input.projectRoot });
    expect(result.validation).toEqual({ status: 'skipped' });
  });

  test('passed validation resets the revert and incomplete counters', async () => {
    const h = makeHarness();
    h.counters.set(7, 'reverts', 1);
    h.counters.set(7, 'incompletes', 2);
    h.setValidation({ status: 'passed' });
    const result = await settleTask(makeInput(), h.deps);
    expect(h.counters.get(7, 'reverts')).toBe(0);
    // Status re-reads as 'complete' (makeHarness default), so the incomplete
    // guard does not re-increment after the reset.
    expect(h.counters.get(7, 'incompletes')).toBe(0);
    expect(result.blockedByGuard).toBe(false);
    expect(h.blocked).toHaveLength(0);
  });

  test('error/skipped validation leaves the revert counter untouched', async () => {
    const h = makeHarness();
    h.counters.set(7, 'reverts', 1);
    h.setValidation({ status: 'error', message: 'boom' });
    await settleTask(makeInput(), h.deps);
    expect(h.counters.get(7, 'reverts')).toBe(1);
    h.setValidation({ status: 'skipped' });
    await settleTask(makeInput(), h.deps);
    expect(h.counters.get(7, 'reverts')).toBe(1);
  });

  test('failed validation increments reverts and blocks at the threshold', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'failed', message: 'bun test\n  exited 1' });

    const first = await settleTask(makeInput({ iteration: 1 }), h.deps);
    expect(h.counters.get(7, 'reverts')).toBe(1);
    expect(first.blockedByGuard).toBe(false);
    expect(first.retryMode).toBe('continue');
    expect(h.blocked).toHaveLength(0);

    const second = await settleTask(makeInput({ iteration: 2 }), h.deps);
    expect(second.blockedByGuard).toBe(true);
    expect(second.retryMode).toBe('blocked');
    expect(h.blocked).toHaveLength(1);
    expect(h.blocked[0]).toEqual({
      tasksFilePath: '/proj/.cairn/tasks.json',
      dataDir: '/proj/.cairn',
      taskId: 7,
      note: 'Blocked by cairn after 2 consecutive post-iteration test validation failures. Last failing command — bun test exited 1',
    });
    // Counter restarts after a block.
    expect(h.counters.get(7, 'reverts')).toBe(0);
    expect(h.logs).toContain('Task #7 blocked after 2 consecutive validation failures — moving on.');
    expect(h.appended).toContainEqual({
      p: '/proj/.cairn/.cairn_iterations.log',
      content: 'Iteration 2: Task #7 BLOCKED after 2 consecutive validation failures\n',
    });
  });

  test('a failed validation counts only as a revert, never also as an incomplete', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'failed', message: 'bun test: boom' });
    await settleTask(makeInput(), h.deps);
    expect(h.counters.get(7, 'reverts')).toBe(1);
    expect(h.counters.get(7, 'incompletes')).toBe(0);
  });

  test('a blockTask failure is logged and does not mark blockedByGuard', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'failed', message: 'x' });
    h.counters.set(7, 'reverts', 1);
    h.setBlockThrows(true);
    const result = await settleTask(makeInput(), h.deps);
    expect(result.blockedByGuard).toBe(false);
    expect(h.logs).toContain('Failed to block task #7: lock busy');
    expect(h.counters.get(7, 'reverts')).toBe(0);
  });

  test('stall increments whenever the task is still pending, blocks at 3', async () => {
    const h = makeHarness();
    h.setStatus('pending');
    h.setValidation({ status: 'skipped' });

    const r1 = await settleTask(makeInput({ iteration: 1 }), h.deps);
    expect(r1.updatedTaskStatus).toBe('pending');
    expect(h.counters.get(7, 'stalls')).toBe(1);
    expect(r1.retryMode).toBe('fresh');
    await settleTask(makeInput({ iteration: 2 }), h.deps);
    expect(h.counters.get(7, 'stalls')).toBe(2);
    expect(h.blocked).toHaveLength(0);

    const r3 = await settleTask(makeInput({ iteration: 3 }), h.deps);
    expect(r3.blockedByGuard).toBe(true);
    expect(r3.retryMode).toBe('blocked');
    expect(h.blocked).toHaveLength(1);
    expect(h.blocked[0].taskId).toBe(7);
    expect(h.blocked[0].note).toContain("Blocked by cairn after 3 consecutive iterations in which the agent never moved the task out of 'pending'.");
    expect(h.blocked[0].note).not.toContain('permissions.deny');
    expect(h.counters.get(7, 'stalls')).toBe(0);
    expect(h.appended).toContainEqual({
      p: '/proj/.cairn/.cairn_iterations.log',
      content: "Iteration 3: Task #7 BLOCKED after 3 consecutive iterations still 'pending'\n",
    });
  });

  test('still-pending counts as a stall regardless of the task\'s prior status', async () => {
    const h = makeHarness();
    h.setStatus('pending');
    h.setValidation({ status: 'skipped' });
    h.counters.set(7, 'stalls', 2);
    // The task object's own status (pre-iteration) was 'in-progress'; settleTask
    // no longer takes a selection-time snapshot, so only the re-read status
    // (still 'pending') decides — a prior status can no longer suppress it.
    const result = await settleTask(makeInput({ task: makeTask({ status: 'in-progress' }) }), h.deps);
    // Third consecutive stall: hits the threshold and blocks, so the counter
    // restarts at 0 rather than landing on 3.
    expect(result.blockedByGuard).toBe(true);
    expect(h.counters.get(7, 'stalls')).toBe(0);
  });

  test('any other observed status resets the stall counter', async () => {
    for (const status of ['in-progress', 'complete', 'blocked']) {
      const h = makeHarness();
      h.setStatus(status);
      h.setValidation({ status: 'skipped' });
      h.counters.set(7, 'stalls', 2);
      const result = await settleTask(makeInput(), h.deps);
      expect(result.updatedTaskStatus).toBe(status);
      expect(h.counters.get(7, 'stalls')).toBe(0);
    }
  });

  test('an unreadable tasks file leaves both guards neutral', async () => {
    const h = makeHarness();
    h.setUnreadable(true);
    h.setValidation({ status: 'skipped' });
    h.counters.set(7, 'reverts', 1);
    h.counters.set(7, 'stalls', 2);
    const result = await settleTask(makeInput(), h.deps);
    expect(result.updatedTaskStatus).toBe('unknown');
    expect(result.corrupted).toBe(false);
    expect(result.blockedByGuard).toBe(false);
    expect(h.counters.get(7, 'reverts')).toBe(1);
    expect(h.counters.get(7, 'stalls')).toBe(2);
    expect(h.blocked).toHaveLength(0);
  });

  test('task missing from tasks file yields unknown status', async () => {
    const h = makeHarness();
    h.setStatus(null);
    h.counters.set(7, 'stalls', 2);
    const result = await settleTask(makeInput(), h.deps);
    expect(result.updatedTaskStatus).toBe('unknown');
    expect(h.counters.get(7, 'stalls')).toBe(2);
  });

  test('reports corruption when the re-read was repaired or restored', async () => {
    for (const c of [{ repaired: true }, { restored: true }]) {
      const h = makeHarness();
      h.setCorruption(c);
      const result = await settleTask(makeInput(), h.deps);
      expect(result.corrupted).toBe(true);
    }
    const clean = makeHarness();
    expect((await settleTask(makeInput(), clean.deps)).corrupted).toBe(false);
  });
});

describe('incomplete guard', () => {
  test('increments only when the task is left in-progress without a failed validation, blocks at 3', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'skipped' });

    const r1 = await settleTask(makeInput({ iteration: 1 }), h.deps);
    expect(h.counters.get(7, 'incompletes')).toBe(1);
    expect(r1.blockedByGuard).toBe(false);
    expect(r1.retryMode).toBe('continue');

    const r2 = await settleTask(makeInput({ iteration: 2 }), h.deps);
    expect(h.counters.get(7, 'incompletes')).toBe(2);
    expect(r2.blockedByGuard).toBe(false);
    expect(r2.retryMode).toBe('fresh');

    const r3 = await settleTask(makeInput({ iteration: 3 }), h.deps);
    expect(r3.blockedByGuard).toBe(true);
    expect(r3.retryMode).toBe('blocked');
    expect(h.blocked).toHaveLength(1);
    expect(h.blocked[0]).toEqual({
      tasksFilePath: '/proj/.cairn/tasks.json',
      dataDir: '/proj/.cairn',
      taskId: 7,
      note: "Blocked by cairn after 3 consecutive iterations that left the task 'in-progress' without completing it.",
    });
    // Counter restarts after a block.
    expect(h.counters.get(7, 'incompletes')).toBe(0);
    expect(h.logs).toContain("Task #7 blocked after 3 consecutive iterations left 'in-progress' — moving on.");
    expect(h.appended).toContainEqual({
      p: '/proj/.cairn/.cairn_iterations.log',
      content: "Iteration 3: Task #7 BLOCKED after 3 consecutive iterations left 'in-progress'\n",
    });
  });

  test('a completed task does not count as an incomplete', async () => {
    const h = makeHarness();
    h.setStatus('complete');
    h.setValidation({ status: 'passed' });
    await settleTask(makeInput(), h.deps);
    expect(h.counters.get(7, 'incompletes')).toBe(0);
  });

  test('a blockTask failure is logged and does not mark blockedByGuard', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'skipped' });
    h.counters.set(7, 'incompletes', 2);
    h.setBlockThrows(true);
    const result = await settleTask(makeInput(), h.deps);
    expect(result.blockedByGuard).toBe(false);
    expect(h.logs).toContain('Failed to block task #7: lock busy');
    expect(h.counters.get(7, 'incompletes')).toBe(0);
  });
});
