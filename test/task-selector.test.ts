import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadCompletedIds, selectNextTask, selectReadyTasks, buildIterationPrompt } from '../src/task-selector';
import type { Task } from '../src/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'priority' | 'status'>): Task {
  return {
    title: `Task ${overrides.id}`,
    dependencies: [],
    ...overrides,
  };
}

// ── loadCompletedIds ──────────────────────────────────────────────────────────

describe('loadCompletedIds', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cairn-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty set when no files exist', () => {
    const ids = loadCompletedIds(dir);
    expect(ids.size).toBe(0);
  });

  it('reads IDs from .cairn_completed_ids', () => {
    writeFileSync(join(dir, '.cairn_completed_ids'), JSON.stringify([1, 2, 3]));
    const ids = loadCompletedIds(dir);
    expect(ids).toEqual(new Set([1, 2, 3]));
  });

  it('reads IDs from tasks.completed.json (array of tasks)', () => {
    const tasks = [
      { id: 10, title: 'A', status: 'complete', priority: 1 },
      { id: 11, title: 'B', status: 'complete', priority: 2 },
    ];
    writeFileSync(join(dir, 'tasks.completed.json'), JSON.stringify(tasks));
    const ids = loadCompletedIds(dir);
    expect(ids).toEqual(new Set([10, 11]));
  });

  it('reads IDs from tasks.completed.json (object with tasks array)', () => {
    const data = {
      tasks: [
        { id: 20, title: 'C', status: 'complete', priority: 1 },
      ],
    };
    writeFileSync(join(dir, 'tasks.completed.json'), JSON.stringify(data));
    const ids = loadCompletedIds(dir);
    expect(ids).toEqual(new Set([20]));
  });

  it('unions both sources', () => {
    writeFileSync(join(dir, '.cairn_completed_ids'), JSON.stringify([1, 2]));
    const completedTasks = [{ id: 3, title: 'C', status: 'complete', priority: 1 }];
    writeFileSync(join(dir, 'tasks.completed.json'), JSON.stringify(completedTasks));
    const ids = loadCompletedIds(dir);
    expect(ids).toEqual(new Set([1, 2, 3]));
  });

  it('handles empty .cairn_completed_ids gracefully', () => {
    writeFileSync(join(dir, '.cairn_completed_ids'), '');
    const ids = loadCompletedIds(dir);
    expect(ids.size).toBe(0);
  });

  it('handles malformed JSON in .cairn_completed_ids gracefully', () => {
    writeFileSync(join(dir, '.cairn_completed_ids'), 'not-json');
    const ids = loadCompletedIds(dir);
    expect(ids.size).toBe(0);
  });

  it('handles malformed JSON in tasks.completed.json gracefully', () => {
    writeFileSync(join(dir, 'tasks.completed.json'), 'not-json');
    const ids = loadCompletedIds(dir);
    expect(ids.size).toBe(0);
  });
});

// ── selectNextTask ────────────────────────────────────────────────────────────

describe('selectNextTask', () => {
  it('returns null when task list is empty', () => {
    expect(selectNextTask([], new Set())).toBeNull();
  });

  it('picks the in-progress task first', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending' }),
      makeTask({ id: 2, priority: 2, status: 'in-progress' }),
      makeTask({ id: 3, priority: 3, status: 'pending' }),
    ];
    expect(selectNextTask(tasks, new Set())?.id).toBe(2);
  });

  it('picks the first in-progress task when multiple exist', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 2, status: 'in-progress' }),
      makeTask({ id: 2, priority: 1, status: 'in-progress' }),
    ];
    expect(selectNextTask(tasks, new Set())?.id).toBe(1);
  });

  it('picks the highest-priority pending task with no deps', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 5, status: 'pending' }),
      makeTask({ id: 2, priority: 1, status: 'pending' }),
      makeTask({ id: 3, priority: 3, status: 'pending' }),
    ];
    expect(selectNextTask(tasks, new Set())?.id).toBe(2);
  });

  it('skips pending tasks whose deps are not yet satisfied', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending', dependencies: [99] }),
      makeTask({ id: 2, priority: 2, status: 'pending', dependencies: [] }),
    ];
    expect(selectNextTask(tasks, new Set())?.id).toBe(2);
  });

  it('satisfies deps via active complete tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 9, status: 'complete' }),
      makeTask({ id: 2, priority: 1, status: 'pending', dependencies: [1] }),
    ];
    expect(selectNextTask(tasks, new Set())?.id).toBe(2);
  });

  it('satisfies deps via completedIds set', () => {
    const tasks: Task[] = [
      makeTask({ id: 2, priority: 1, status: 'pending', dependencies: [1] }),
    ];
    expect(selectNextTask(tasks, new Set([1]))?.id).toBe(2);
  });

  it('satisfies deps via union of both sources', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 9, status: 'complete' }),
      makeTask({ id: 3, priority: 1, status: 'pending', dependencies: [1, 2] }),
    ];
    expect(selectNextTask(tasks, new Set([2]))?.id).toBe(3);
  });

  it('returns null when all pending tasks have unsatisfied deps', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending', dependencies: [99] }),
    ];
    expect(selectNextTask(tasks, new Set())).toBeNull();
  });

  it('ignores blocked tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'blocked' }),
    ];
    expect(selectNextTask(tasks, new Set())).toBeNull();
  });

  it('uses tasks-mixed.json fixture correctly', () => {
    // fixture: id=1 complete, id=2 in-progress (dep on 1), id=3 pending, id=4 blocked
    const fixture = require('./fixtures/tasks-mixed.json');
    const tasks: Task[] = fixture.tasks;
    // id=2 is in-progress, so it should be selected first
    expect(selectNextTask(tasks, new Set())?.id).toBe(2);
  });

  it('selects id=3 after id=2 is removed from fixture', () => {
    const fixture = require('./fixtures/tasks-mixed.json');
    const tasks: Task[] = fixture.tasks.filter((t: Task) => t.id !== 2);
    // id=3 has no deps; id=1 complete satisfies nothing for id=4 which needs 2 and 3
    const selected = selectNextTask(tasks, new Set([2]));
    expect(selected?.id).toBe(3);
  });
});

// ── selectReadyTasks ──────────────────────────────────────────────────────────

describe('selectReadyTasks', () => {
  it('returns empty array when task list is empty', () => {
    expect(selectReadyTasks([], new Set())).toEqual([]);
  });

  it('returns only pending tasks with all deps satisfied', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending', dependencies: [] }),
      makeTask({ id: 2, priority: 2, status: 'pending', dependencies: [99] }),
    ];
    expect(selectReadyTasks(tasks, new Set()).map(t => t.id)).toEqual([1]);
  });

  it('satisfies deps via active complete tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 9, status: 'complete' }),
      makeTask({ id: 2, priority: 1, status: 'pending', dependencies: [1] }),
    ];
    expect(selectReadyTasks(tasks, new Set()).map(t => t.id)).toEqual([2]);
  });

  it('satisfies deps via completedIds set', () => {
    const tasks: Task[] = [
      makeTask({ id: 2, priority: 1, status: 'pending', dependencies: [1] }),
    ];
    expect(selectReadyTasks(tasks, new Set([1])).map(t => t.id)).toEqual([2]);
  });

  it('satisfies deps via union of both sources', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 9, status: 'complete' }),
      makeTask({ id: 3, priority: 1, status: 'pending', dependencies: [1, 2] }),
    ];
    expect(selectReadyTasks(tasks, new Set([2])).map(t => t.id)).toEqual([3]);
  });

  it('sorts by priority ascending', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 5, status: 'pending' }),
      makeTask({ id: 2, priority: 1, status: 'pending' }),
      makeTask({ id: 3, priority: 3, status: 'pending' }),
    ];
    expect(selectReadyTasks(tasks, new Set()).map(t => t.id)).toEqual([2, 3, 1]);
  });

  it('caps results at limit', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending' }),
      makeTask({ id: 2, priority: 2, status: 'pending' }),
      makeTask({ id: 3, priority: 3, status: 'pending' }),
    ];
    const result = selectReadyTasks(tasks, new Set(), { limit: 2 });
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual([1, 2]);
  });

  it('excludes lower-priority tasks sharing a directory with a higher-priority batch member', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending', directory: 'src/foo' }),
      makeTask({ id: 2, priority: 2, status: 'pending', directory: 'src/bar' }),
      makeTask({ id: 3, priority: 3, status: 'pending', directory: 'src/foo' }),
    ];
    // id=3 conflicts with id=1 (same dir); id=2 is ok
    expect(selectReadyTasks(tasks, new Set()).map(t => t.id)).toEqual([1, 2]);
  });

  it('allows multiple tasks with no directory (empty string is not a conflict)', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending' }),
      makeTask({ id: 2, priority: 2, status: 'pending' }),
    ];
    expect(selectReadyTasks(tasks, new Set()).map(t => t.id)).toEqual([1, 2]);
  });

  it('treats in-progress task directories as occupied', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'in-progress', directory: 'src/foo' }),
      makeTask({ id: 2, priority: 2, status: 'pending', directory: 'src/foo' }),
      makeTask({ id: 3, priority: 3, status: 'pending', directory: 'src/bar' }),
    ];
    // id=2 excluded because src/foo is occupied by in-progress id=1
    expect(selectReadyTasks(tasks, new Set()).map(t => t.id)).toEqual([3]);
  });

  it('excludes in-progress tasks from the result', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'in-progress' }),
    ];
    expect(selectReadyTasks(tasks, new Set())).toHaveLength(0);
  });

  it('returns empty array when all pending tasks have unsatisfied deps', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'pending', dependencies: [99] }),
    ];
    expect(selectReadyTasks(tasks, new Set())).toEqual([]);
  });

  it('ignores blocked and complete tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 1, priority: 1, status: 'blocked' }),
      makeTask({ id: 2, priority: 2, status: 'complete' }),
    ];
    expect(selectReadyTasks(tasks, new Set())).toEqual([]);
  });
});

// ── buildIterationPrompt ──────────────────────────────────────────────────────

describe('buildIterationPrompt', () => {
  const baseTask: Task = {
    id: 5,
    priority: 1,
    title: 'My Task',
    description: 'Do the thing',
    status: 'pending',
    directory: 'src/foo',
    files: ['src/foo.ts', 'test/foo.test.ts'],
    tests: ['bun test test/foo.test.ts'],
    dependencies: [],
  };

  it('includes iteration header', () => {
    const prompt = buildIterationPrompt(baseTask, 3, 10, null, 5);
    expect(prompt).toMatch(/^Iteration 3 of 10\./);
  });

  it('includes task id and title', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).toContain('YOUR ASSIGNED TASK (#5):');
    expect(prompt).toContain('Title: My Task');
  });

  it('includes description when present', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).toContain('Description: Do the thing');
  });

  it('omits description when absent', () => {
    const task = { ...baseTask, description: undefined };
    const prompt = buildIterationPrompt(task, 1, 10, null, 5);
    expect(prompt).not.toContain('Description:');
  });

  it('includes directory when present', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).toContain('Directory: src/foo');
  });

  it('omits directory when absent', () => {
    const task = { ...baseTask, directory: undefined };
    const prompt = buildIterationPrompt(task, 1, 10, null, 5);
    expect(prompt).not.toContain('Directory:');
  });

  it('includes files list', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).toContain('Files: src/foo.ts, test/foo.test.ts');
  });

  it('omits files when empty', () => {
    const task = { ...baseTask, files: [] };
    const prompt = buildIterationPrompt(task, 1, 10, null, 5);
    expect(prompt).not.toContain('Files:');
  });

  it('includes tests list', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).toContain('Tests: bun test test/foo.test.ts');
  });

  it('includes in-progress warning when task is in-progress', () => {
    const task = { ...baseTask, status: 'in-progress' as const };
    const prompt = buildIterationPrompt(task, 1, 10, null, 5);
    expect(prompt).toContain('NOTE: This task was started by a previous iteration but not completed.');
  });

  it('omits in-progress warning for pending tasks', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).not.toContain('NOTE: This task was started');
  });

  it('includes prev notes when provided', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, 'Fixed the bug', 5);
    expect(prompt).toContain('FROM PREVIOUS ITERATION: Fixed the bug');
  });

  it('omits prev notes block when null', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).not.toContain('FROM PREVIOUS ITERATION:');
  });

  it('omits prev notes block when empty string', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, '', 5);
    expect(prompt).not.toContain('FROM PREVIOUS ITERATION:');
  });

  it('includes remaining task count minus one', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt).toContain('Remaining tasks after this one: 4');
  });

  it('ends with "Begin work."', () => {
    const prompt = buildIterationPrompt(baseTask, 1, 10, null, 5);
    expect(prompt.trimEnd()).toMatch(/Begin work\.$/);
  });
});
