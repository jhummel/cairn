import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRunState, updateRunState, newAttemptRecord, type RunState, type RunStateStore } from '../src/run-state';
import {
  settleTask,
  createInMemoryGuardCounters,
  createRunStateGuardCounters,
  REVERT_BLOCK_THRESHOLD,
  STALL_BLOCK_THRESHOLD,
  INCOMPLETE_BLOCK_THRESHOLD,
  summarizeFailure,
  SettleError,
  findTaskBaseSha,
  writeReviewPromptFile,
  type SettleTaskInput,
  type SettleTaskDeps,
  type BlockTaskOpts,
  type GuardCounters,
  type WriteReviewPromptFileOpts,
} from '../src/settle';
import { execFileSync } from 'child_process';
import { formatTestSummary, type ValidationResult } from '../src/test-validator';
import type { CairnConfig, Task } from '../src/types';

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

function makeMemoryRunState(): RunStateStore & { state: RunState } {
  const state: RunState = { iteration: 0, attempts: {} };
  return {
    state,
    read: () => structuredClone(state),
    update: <T>(_dataDir: string, fn: (s: RunState) => T): T => fn(state),
  };
}

const NEXT_ROUND = 'Run: cairn round next';
const NEXT_CONTINUE = "Resume the same task agent with SendMessage, then run: cairn round settle 7. If that agent's id is lost, launch a fresh cairn-task-agent with the same prompt file instead.";
const NEXT_FRESH = 'Launch a fresh cairn-task-agent with the same prompt file, then run: cairn round settle 7';

interface Harness {
  deps: SettleTaskDeps;
  counters: GuardCounters;
  runState: RunStateStore & { state: RunState };
  completedIds: Set<number>;
  readCalls: () => number;
  blocked: BlockTaskOpts[];
  logs: string[];
  appended: Array<{ p: string; content: string }>;
  setValidation: (v: ValidationResult) => void;
  setStatus: (s: string | null) => void;
  setUnreadable: (u: boolean) => void;
  setCorruption: (c: { repaired?: boolean; restored?: boolean }) => void;
  setBlockThrows: (t: boolean) => void;
  setNotes: (n: string | undefined) => void;
  setHead: (sha: string | null) => void;
  setTaskBaseSha: (sha: string | null) => void;
  validations: () => number;
  archiveCalls: Array<{ tasksFilePath: string; dataDir: string; iterationLogPath?: string }>;
  baseShaCalls: Array<{ projectRoot: string; taskId: number }>;
  promptWrites: Array<WriteReviewPromptFileOpts & { phaseAtWrite?: string }>;
  promptFiles: Set<string>;
  order: string[];
}

const PROMPT_FILE = '/proj/.cairn/.cairn_task_7_review_prompt.md';
const NEXT_REVIEW = `Launch the post-task-reviewer agent with the prompt 'Read ${PROMPT_FILE} and follow it', then run: cairn round settle 7 --reviewed`;
const REVIEW_ON: Pick<CairnConfig, 'review'> = { review: { postTask: true, maxIterations: 5 } };

function makeHarness(): Harness {
  let validation: ValidationResult = { status: 'passed' };
  let status: string | null = 'complete';
  let unreadable = false;
  let corruption: { repaired?: boolean; restored?: boolean } = {};
  let blockThrows = false;
  let notes: string | undefined;
  let readCount = 0;
  let validationCount = 0;
  let head: string | null = 'sha-head';
  let taskBaseSha: string | null = null;
  const runState = makeMemoryRunState();
  const completedIds = new Set<number>();
  const blocked: BlockTaskOpts[] = [];
  const logs: string[] = [];
  const appended: Array<{ p: string; content: string }> = [];
  const counters = createInMemoryGuardCounters();
  const archiveCalls: Harness['archiveCalls'] = [];
  const baseShaCalls: Harness['baseShaCalls'] = [];
  const promptWrites: Harness['promptWrites'] = [];
  const promptFiles = new Set<string>();
  const order: string[] = [];

  const deps: SettleTaskDeps = {
    validateTaskTests: async () => { validationCount++; return validation; },
    archiveCompletedTasks: async (opts) => {
      archiveCalls.push(opts);
      order.push('archive');
      // Models the real archiver: a complete task leaves tasks.json.
      const archived = status === 'complete' ? 1 : 0;
      if (archived) {
        status = null;
        completedIds.add(7);
      }
      return { archivedCount: archived, prevNotes: null, warnings: [] };
    },
    git: {
      headSha: () => { order.push('head'); return head; },
      taskBaseSha: (projectRoot, taskId) => { baseShaCalls.push({ projectRoot, taskId }); return taskBaseSha; },
    },
    writeReviewPromptFile: (opts) => {
      promptWrites.push({ ...opts, phaseAtWrite: runState.state.attempts[String(opts.taskId)]?.phase });
      promptFiles.add(PROMPT_FILE);
      return PROMPT_FILE;
    },
    existsSync: (p) => promptFiles.has(p),
    readTasksFile: () => {
      readCount++;
      if (unreadable) throw new Error('unreadable');
      const tasks = status === null ? [] : [makeTask({ status: status as Task['status'], notes })];
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
    loadCompletedIds: () => completedIds,
    counters,
    runState,
  };

  return {
    deps,
    counters,
    runState,
    completedIds,
    readCalls: () => readCount,
    blocked,
    logs,
    appended,
    setValidation: (v) => { validation = v; },
    setStatus: (s) => { status = s; },
    setUnreadable: (u) => { unreadable = u; },
    setCorruption: (c) => { corruption = c; },
    setBlockThrows: (t) => { blockThrows = t; },
    setNotes: (n) => { notes = n; },
    setHead: (sha) => { head = sha; },
    setTaskBaseSha: (sha) => { taskBaseSha = sha; },
    validations: () => validationCount,
    archiveCalls,
    baseShaCalls,
    promptWrites,
    promptFiles,
    order,
  };
}

function makeInput(overrides: Partial<SettleTaskInput> = {}): SettleTaskInput {
  return {
    taskId: 7,
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
    const { counters: _unused, runState: _unusedStore, ...rest } = h.deps;
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
    // No task passed in: settle looked it up in tasks.json.
    expect(seen).toEqual({ task: makeTask({ status: 'complete' }), tasksFilePath: input.tasksFilePath, projectRoot: input.projectRoot });
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
    expect(first.verdict).toMatchObject({ verdict: 'retry', mode: 'continue' });
    expect(h.blocked).toHaveLength(0);

    const second = await settleTask(makeInput({ iteration: 2 }), h.deps);
    expect(second.blockedByGuard).toBe(true);
    expect(second.verdict.verdict).toBe('blocked');
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
    expect(r1.verdict).toMatchObject({ verdict: 'retry', mode: 'fresh' });
    await settleTask(makeInput({ iteration: 2 }), h.deps);
    expect(h.counters.get(7, 'stalls')).toBe(2);
    expect(h.blocked).toHaveLength(0);

    const r3 = await settleTask(makeInput({ iteration: 3 }), h.deps);
    expect(r3.blockedByGuard).toBe(true);
    expect(r3.verdict.verdict).toBe('blocked');
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

  test('an unreadable post-validation re-read leaves both guards neutral', async () => {
    const h = makeHarness();
    // Record present and task passed in, so the only read is the re-read.
    h.runState.state.attempts['7'] = newAttemptRecord(null, 1);
    h.setUnreadable(true);
    h.setValidation({ status: 'skipped' });
    h.counters.set(7, 'reverts', 1);
    h.counters.set(7, 'stalls', 2);
    const result = await settleTask(makeInput({ task: makeTask() }), h.deps);
    expect(result.updatedTaskStatus).toBe('unknown');
    expect(result.verdict).toEqual({ verdict: 'retry', taskId: 7, mode: 'continue', reason: 'status-unknown', next: NEXT_CONTINUE });
    expect(result.corrupted).toBe(false);
    expect(result.blockedByGuard).toBe(false);
    expect(h.counters.get(7, 'reverts')).toBe(1);
    expect(h.counters.get(7, 'stalls')).toBe(2);
    expect(h.blocked).toHaveLength(0);
  });

  test('task vanishing from tasks file during settle yields unknown status', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord(null, 1);
    h.setStatus(null);
    h.counters.set(7, 'stalls', 2);
    const result = await settleTask(makeInput({ task: makeTask() }), h.deps);
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
    expect(r1.verdict).toMatchObject({ verdict: 'retry', mode: 'continue' });

    const r2 = await settleTask(makeInput({ iteration: 2 }), h.deps);
    expect(h.counters.get(7, 'incompletes')).toBe(2);
    expect(r2.blockedByGuard).toBe(false);
    expect(r2.verdict).toMatchObject({ verdict: 'retry', mode: 'fresh' });

    const r3 = await settleTask(makeInput({ iteration: 3 }), h.deps);
    expect(r3.blockedByGuard).toBe(true);
    expect(r3.verdict.verdict).toBe('blocked');
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

describe('verdicts', () => {
  test('done: completed task, record cleared, one settle line logged', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('abc', 3);
    const result = await settleTask(makeInput({ iteration: 3 }), h.deps);
    // No config passed: the review gate is off.
    expect(result.verdict).toEqual({ verdict: 'done', taskId: 7, reason: 'review-disabled', next: NEXT_ROUND });
    expect(h.runState.state.attempts['7']).toBeUndefined();
    expect(h.appended).toContainEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: done (review-disabled)\n' });
  });

  test('retry/continue after a failed validation keeps the record', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'failed', message: 'bun test exited 1' });
    const result = await settleTask(makeInput(), h.deps);
    expect(result.verdict).toEqual({ verdict: 'retry', taskId: 7, mode: 'continue', reason: 'validation-failed', next: NEXT_CONTINUE });
    expect(h.runState.state.attempts['7']).toBeDefined();
    expect(h.appended).toContainEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: retry (validation-failed)\n' });
  });

  test('retry/fresh after a stall', async () => {
    const h = makeHarness();
    h.setStatus('pending');
    h.setValidation({ status: 'skipped' });
    const result = await settleTask(makeInput(), h.deps);
    expect(result.verdict).toEqual({ verdict: 'retry', taskId: 7, mode: 'fresh', reason: 'stalled', next: NEXT_FRESH });
    expect(h.runState.state.attempts['7']).toBeDefined();
  });

  test('incompletes map 1 → continue, 2 → fresh', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'skipped' });
    const r1 = await settleTask(makeInput(), h.deps);
    expect(r1.verdict).toEqual({ verdict: 'retry', taskId: 7, mode: 'continue', reason: 'incomplete', next: NEXT_CONTINUE });
    const r2 = await settleTask(makeInput(), h.deps);
    expect(r2.verdict).toEqual({ verdict: 'retry', taskId: 7, mode: 'fresh', reason: 'incomplete', next: NEXT_FRESH });
  });

  test('a guard block yields blocked with the guard note as reason and clears the record', async () => {
    const h = makeHarness();
    h.setStatus('pending');
    h.setValidation({ status: 'skipped' });
    h.counters.set(7, 'stalls', 2);
    const result = await settleTask(makeInput(), h.deps);
    expect(result.verdict).toEqual({ verdict: 'blocked', taskId: 7, reason: h.blocked[0]!.note, next: NEXT_ROUND });
    expect(h.runState.state.attempts['7']).toBeUndefined();
  });

  test('agent-set blocked yields blocked with the task notes as reason and clears the record', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('abc', 2);
    h.setStatus('blocked');
    h.setNotes('Needs an API key from the user');
    h.setValidation({ status: 'skipped' });
    const result = await settleTask(makeInput(), h.deps);
    expect(result.verdict).toEqual({ verdict: 'blocked', taskId: 7, reason: 'Needs an API key from the user', next: NEXT_ROUND });
    expect(result.blockedByGuard).toBe(false);
    expect(h.blocked).toHaveLength(0);
    expect(h.runState.state.attempts['7']).toBeUndefined();
    expect(h.appended).toContainEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: blocked (Needs an API key from the user)\n' });
  });

  test('a second call after done (task archived) is already-settled with no side effects', async () => {
    const h = makeHarness();
    let validations = 0;
    h.deps.validateTaskTests = async () => { validations++; return { status: 'passed' }; };
    const first = await settleTask(makeInput(), h.deps);
    expect(first.verdict.verdict).toBe('done');

    // Archived: gone from tasks.json, present in tasks.completed.json.
    h.setStatus(null);
    h.completedIds.add(7);
    const second = await settleTask(makeInput(), h.deps);
    expect(second.verdict).toEqual({ verdict: 'already-settled', taskId: 7, next: NEXT_ROUND });
    expect(validations).toBe(1);
    expect(h.runState.state.attempts['7']).toBeUndefined();
    expect(h.blocked).toHaveLength(0);
    expect(h.appended.at(-1)).toEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: already-settled\n' });
  });

  test('a missing record with the task present creates the record lazily from run state', async () => {
    const h = makeHarness();
    h.runState.state.iteration = 5;
    h.setStatus('in-progress');
    h.setValidation({ status: 'skipped' });
    const { iteration: _omit, ...input } = makeInput();
    const result = await settleTask(input, h.deps);
    expect(result.verdict.verdict).toBe('retry');
    expect(h.runState.state.attempts['7']).toEqual({
      beforeSha: null, iteration: 5, reverts: 0, stalls: 0, incompletes: 0, phase: 'executing',
    });
  });

  test('an existing record plus a passed-in task skips the lookup read', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('abc', 1);
    await settleTask(makeInput({ task: makeTask() }), h.deps);
    // Only the post-validation re-read.
    expect(h.readCalls()).toBe(1);
  });

  test('an unknown task id throws SettleError', async () => {
    const h = makeHarness();
    h.setStatus(null);
    const err = await settleTask(makeInput({ taskId: 99 }), h.deps).catch((e) => e);
    expect(err).toBeInstanceOf(SettleError);
    expect(err.name).toBe('SettleError');
    expect(err.message).toContain('#99');
  });

  test('the lookup read propagates a tasks.json read failure', async () => {
    const h = makeHarness();
    h.setUnreadable(true);
    await expect(settleTask(makeInput(), h.deps)).rejects.toThrow('unreadable');
  });

  test('defaults the iterations log path to the data dir temp file', async () => {
    const h = makeHarness();
    const { iterationLogPath: _omit, ...input } = makeInput();
    await settleTask(input, h.deps);
    expect(h.appended.at(-1)).toEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: done (review-disabled)\n' });
  });
});

describe('review phase', () => {
  test('complete + passed with review enabled: archives, then returns review with the record awaiting-review', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    const result = await settleTask(makeInput({ config: REVIEW_ON }), h.deps);

    expect(h.archiveCalls).toEqual([
      { tasksFilePath: '/proj/.cairn/tasks.json', dataDir: '/proj/.cairn', iterationLogPath: '/proj/.cairn/.cairn_iterations.log' },
    ]);
    // Archive first, then the HEAD comparison of the review gate.
    expect(h.order).toEqual(['archive', 'head']);
    expect(result.archive).toEqual({ archivedCount: 1, prevNotes: null, warnings: [] });
    expect(result.verdict).toEqual({ verdict: 'review', taskId: 7, reviewPromptFile: PROMPT_FILE, next: NEXT_REVIEW });
    expect(h.runState.state.attempts['7']).toMatchObject({ phase: 'awaiting-review', beforeSha: 'sha-before' });
    expect(h.promptWrites).toEqual([
      {
        projectRoot: '/proj', dataDir: '/proj/.cairn', taskId: 7, beforeSha: 'sha-before',
        testSummary: formatTestSummary({ status: 'passed' }), phaseAtWrite: 'awaiting-review',
      },
    ]);
    expect(h.appended.at(-1)).toEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: review\n' });
  });

  test("the prompt file carries this settle's validation summary, and says so when validation was skipped", async () => {
    const ran = makeHarness();
    ran.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    const validation: ValidationResult = {
      status: 'passed',
      logPath: '/proj/.cairn/.cairn_task_7_tests.log',
      summary: [{ command: 'bun test', status: 'passed', durationMs: 12, counts: { pass: 3, fail: 0 } }],
    };
    ran.setValidation(validation);
    await settleTask(makeInput({ config: REVIEW_ON }), ran.deps);
    expect(ran.promptWrites[0]?.testSummary).toBe(formatTestSummary(validation));
    expect(ran.promptWrites[0]?.testSummary).toContain('/proj/.cairn/.cairn_task_7_tests.log');

    const skipped = makeHarness();
    skipped.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    skipped.setValidation({ status: 'skipped' });
    await settleTask(makeInput({ config: REVIEW_ON }), skipped.deps);
    expect(skipped.promptWrites[0]?.testSummary).toMatch(/skipped/i);
  });

  test('a repeat call while awaiting review returns review again with no second archive or validation', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    await settleTask(makeInput({ config: REVIEW_ON }), h.deps);

    const again = await settleTask(makeInput({ config: REVIEW_ON }), h.deps);
    expect(again.verdict).toEqual({ verdict: 'review', taskId: 7, reviewPromptFile: PROMPT_FILE, next: NEXT_REVIEW });
    expect(again.validation).toBeNull();
    expect(again.archive).toBeNull();
    expect(h.archiveCalls).toHaveLength(1);
    expect(h.validations()).toBe(1);
    // Prompt file still present: not rewritten.
    expect(h.promptWrites).toHaveLength(1);
    expect(h.runState.state.attempts['7']?.phase).toBe('awaiting-review');
  });

  test('a repeat call rewrites the prompt file only when it is missing', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    await settleTask(makeInput({ config: REVIEW_ON }), h.deps);
    h.promptFiles.clear();

    const again = await settleTask(makeInput({ config: REVIEW_ON }), h.deps);
    expect(again.verdict.verdict).toBe('review');
    expect(h.promptWrites).toHaveLength(2);
    expect(h.promptWrites[1]).toMatchObject({ taskId: 7, beforeSha: 'sha-before' });
    // No validation ran in this settle call, so there is no summary to pass.
    expect(h.promptWrites[1]?.testSummary).toBeUndefined();
    expect(h.archiveCalls).toHaveLength(1);
  });

  test('reviewed: done with reason reviewed and the record cleared', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    await settleTask(makeInput({ config: REVIEW_ON }), h.deps);

    const result = await settleTask(makeInput({ config: REVIEW_ON, reviewed: true }), h.deps);
    expect(result.verdict).toEqual({ verdict: 'done', taskId: 7, reason: 'reviewed', next: NEXT_ROUND });
    expect(result.validation).toBeNull();
    expect(h.runState.state.attempts['7']).toBeUndefined();
    expect(h.validations()).toBe(1);
    expect(h.archiveCalls).toHaveLength(1);
    expect(h.appended.at(-1)).toEqual({ p: '/proj/.cairn/.cairn_iterations.log', content: 'Settle #7: done (reviewed)\n' });
  });

  test('reviewed with no awaiting-review record: already-settled when archived, SettleError otherwise', async () => {
    const archived = makeHarness();
    archived.setStatus(null);
    archived.completedIds.add(7);
    const result = await settleTask(makeInput({ reviewed: true }), archived.deps);
    expect(result.verdict).toEqual({ verdict: 'already-settled', taskId: 7, next: NEXT_ROUND });
    expect(archived.validations()).toBe(0);

    const executing = makeHarness();
    executing.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    const err = await settleTask(makeInput({ reviewed: true }), executing.deps).catch((e) => e);
    expect(err).toBeInstanceOf(SettleError);
    expect(err.message).toContain('#7');
    expect(executing.runState.state.attempts['7']).toBeDefined();
    expect(executing.validations()).toBe(0);
  });

  test('gate failures return done with the matching reason, archived, record cleared, no prompt file', async () => {
    const cases: Array<{ reason: string; config?: Pick<CairnConfig, 'review'>; sha: string | null; head: string | null }> = [
      { reason: 'review-disabled', config: { review: { postTask: false, maxIterations: 5 } }, sha: 'sha-before', head: 'sha-head' },
      { reason: 'review-disabled', config: undefined, sha: 'sha-before', head: 'sha-head' },
      { reason: 'no-before-sha', config: REVIEW_ON, sha: null, head: 'sha-head' },
      { reason: 'no-commits', config: REVIEW_ON, sha: 'sha-head', head: 'sha-head' },
    ];
    for (const c of cases) {
      const h = makeHarness();
      h.runState.state.attempts['7'] = newAttemptRecord(c.sha, 1);
      h.setHead(c.head);
      const result = await settleTask(makeInput({ config: c.config }), h.deps);
      expect(result.verdict).toEqual({ verdict: 'done', taskId: 7, reason: c.reason, next: NEXT_ROUND });
      expect(h.archiveCalls).toHaveLength(1);
      expect(h.promptWrites).toHaveLength(0);
      expect(h.runState.state.attempts['7']).toBeUndefined();
    }
  });

  test('an error validation on a complete task logs a warning and still archives', async () => {
    const h = makeHarness();
    h.setValidation({ status: 'error', message: 'spawn ENOENT' });
    const result = await settleTask(makeInput(), h.deps);
    expect(result.verdict).toMatchObject({ verdict: 'done', reason: 'review-disabled' });
    expect(h.archiveCalls).toHaveLength(1);
    expect(h.logs.some((l) => l.includes('#7') && l.includes('spawn ENOENT'))).toBe(true);
  });

  test('retry and blocked verdicts do not archive', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'skipped' });
    const result = await settleTask(makeInput({ config: REVIEW_ON }), h.deps);
    expect(result.verdict.verdict).toBe('retry');
    expect(result.archive).toBeNull();
    expect(h.archiveCalls).toHaveLength(0);
  });

  test('a lazily created record takes beforeSha from the commit-message fallback', async () => {
    const h = makeHarness();
    h.setTaskBaseSha('sha-parent');
    const result = await settleTask(makeInput({ config: REVIEW_ON }), h.deps);
    expect(h.baseShaCalls).toEqual([{ projectRoot: '/proj', taskId: 7 }]);
    expect(result.verdict.verdict).toBe('review');
    expect(h.promptWrites[0]).toMatchObject({ beforeSha: 'sha-parent' });
    expect(h.runState.state.attempts['7']?.beforeSha).toBe('sha-parent');
  });

  test('a lazily created record with no matching commit gets a null beforeSha', async () => {
    const h = makeHarness();
    h.setStatus('in-progress');
    h.setValidation({ status: 'skipped' });
    await settleTask(makeInput(), h.deps);
    expect(h.runState.state.attempts['7']?.beforeSha).toBeNull();
  });

  test('an existing record never consults the commit-message fallback', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    await settleTask(makeInput({ config: REVIEW_ON }), h.deps);
    expect(h.baseShaCalls).toHaveLength(0);
  });

  test('an explicit beforeSha overrides the record and skips the fallback', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-record', 1);
    await settleTask(makeInput({ config: REVIEW_ON, beforeSha: 'sha-override' }), h.deps);
    expect(h.promptWrites[0]).toMatchObject({ beforeSha: 'sha-override' });
    // Persisted so a later repeat call without the flag rewrites the same range.
    expect(h.runState.state.attempts['7']?.beforeSha).toBe('sha-override');

    const lazy = makeHarness();
    lazy.setTaskBaseSha('sha-parent');
    await settleTask(makeInput({ config: REVIEW_ON, beforeSha: 'sha-override' }), lazy.deps);
    expect(lazy.baseShaCalls).toHaveLength(0);
    expect(lazy.promptWrites[0]).toMatchObject({ beforeSha: 'sha-override' });
  });

  test('an explicit beforeSha equal to HEAD fails the gate with no-commits', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-record', 1);
    const result = await settleTask(makeInput({ config: REVIEW_ON, beforeSha: 'sha-head' }), h.deps);
    expect(result.verdict).toMatchObject({ verdict: 'done', reason: 'no-commits' });
  });

  test('inlineReview returns review without writing a prompt file', async () => {
    const h = makeHarness();
    h.runState.state.attempts['7'] = newAttemptRecord('sha-before', 1);
    const result = await settleTask(makeInput({ config: REVIEW_ON, inlineReview: true }), h.deps);
    expect(result.verdict).toMatchObject({ verdict: 'review', reviewPromptFile: PROMPT_FILE });
    expect(h.promptWrites).toHaveLength(0);
    expect(h.runState.state.attempts['7']?.phase).toBe('awaiting-review');
  });
});

describe('findTaskBaseSha', () => {
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo }).toString().trim();

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-settle-git-'));
    git('init', '-q');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test("resolves the parent of the oldest commit whose message contains 'Task #<id>:'", () => {
    git('commit', '-q', '--allow-empty', '-m', 'initial');
    const base = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', '[proj] Task #7: first attempt');
    git('commit', '-q', '--allow-empty', '-m', '[proj] Task #70: a different task');
    git('commit', '-q', '--allow-empty', '-m', '[proj] Task #7: follow-up');
    expect(findTaskBaseSha(repo, 7)).toBe(base);
  });

  test('returns null when no commit matches', () => {
    git('commit', '-q', '--allow-empty', '-m', '[proj] Task #70: other');
    expect(findTaskBaseSha(repo, 7)).toBeNull();
  });

  test('returns null when the matching commit is the root commit', () => {
    git('commit', '-q', '--allow-empty', '-m', '[proj] Task #7: root');
    expect(findTaskBaseSha(repo, 7)).toBeNull();
  });

  test('returns null outside a git repository', () => {
    expect(findTaskBaseSha(path.join(repo, 'missing'), 7)).toBeNull();
  });
});

describe('writeReviewPromptFile', () => {
  let root: string;
  let dataDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-settle-prompt-'));
    dataDir = path.join(root, '.cairn');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 10, round: 3 }));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function archiveSeven() {
    fs.writeFileSync(
      path.join(dataDir, 'tasks.completed.json'),
      JSON.stringify({ tasks: [makeTask({ status: 'complete', title: 'Archived seven', tests: ['bun test test/x.test.ts'] })] }),
    );
  }

  test('writes the diff-range reviewer prompt with the test summary to .cairn_task_<id>_review_prompt.md', () => {
    archiveSeven();
    const file = writeReviewPromptFile({
      projectRoot: root,
      dataDir,
      taskId: 7,
      beforeSha: 'sha-before',
      testSummary: 'bun test test/x.test.ts: passed (4 pass, 0 fail) [30ms]',
    });

    expect(file).toBe(path.join(dataDir, '.cairn_task_7_review_prompt.md'));
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('**Task #7: Archived seven**');
    // Range variant: no embedded diff, the reviewer inspects the range itself.
    expect(content).not.toContain('```diff');
    expect(content).toContain('git diff sha-before..HEAD');
    expect(content).toContain('git log --oneline sha-before..HEAD');
    expect(content).toContain('git diff --name-only sha-before..HEAD');
    expect(content).toContain('## Test Validation (already run by cairn — do not re-run)');
    expect(content).toContain('bun test test/x.test.ts: passed (4 pass, 0 fail) [30ms]');
    expect(content).toContain(path.join(dataDir, 'reviews', 'round-3.md'));
    expect(fs.existsSync(path.join(dataDir, 'reviews'))).toBe(true);
  });

  test('without a summary, says validation ran in an earlier settle and points at the test log', () => {
    archiveSeven();
    const file = writeReviewPromptFile({ projectRoot: root, dataDir, taskId: 7, beforeSha: 'sha-before' });
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('## Test Validation (already run by cairn — do not re-run)');
    expect(content).toMatch(/earlier settle/i);
    expect(content).toContain(path.join(dataDir, '.cairn_task_7_tests.log'));
  });

  test('throws SettleError when the task is not in tasks.completed.json', () => {
    fs.writeFileSync(path.join(dataDir, 'tasks.completed.json'), JSON.stringify({ tasks: [] }));
    expect(() => writeReviewPromptFile({
      projectRoot: root,
      dataDir,
      taskId: 7,
      beforeSha: 'sha-before',
    })).toThrow(SettleError);
  });
});
