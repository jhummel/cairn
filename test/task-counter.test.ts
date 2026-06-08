import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { reserveTaskIds, seedNextId } from '../src/task-counter';

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ralph-counter-test-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function writeTasks(file: string, ids: number[]): void {
  const tasks = ids.map((id) => ({ id, title: `t${id}`, status: 'pending' }));
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify({ tasks }, null, 2));
}

function readState(): { nextTaskId: number } {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf-8'));
}

describe('seedNextId', () => {
  it('(a) seeds from archive: max archived id 15 + empty active → 16', () => {
    writeTasks('tasks.completed.json', [10, 15, 3]);
    writeTasks('tasks.json', []);
    expect(seedNextId(dataDir)).toBe(16);
  });

  it('(f) floors at 1 when no prior ids exist', () => {
    expect(seedNextId(dataDir)).toBe(1);
  });

  it('tolerates a missing tasks.completed.json and reads active ids', () => {
    writeTasks('tasks.json', [4, 7]);
    expect(seedNextId(dataDir)).toBe(8);
  });

  it('takes the max across both archive and active', () => {
    writeTasks('tasks.completed.json', [5, 20]);
    writeTasks('tasks.json', [22, 1]);
    expect(seedNextId(dataDir)).toBe(23);
  });
});

describe('reserveTaskIds', () => {
  it('(d) lazy-seeds when state.json is absent', () => {
    writeTasks('tasks.completed.json', [15]);
    writeTasks('tasks.json', []);
    expect(fs.existsSync(path.join(dataDir, 'state.json'))).toBe(false);

    const ids = reserveTaskIds(dataDir);
    expect(ids).toEqual([16]);
    expect(readState().nextTaskId).toBe(17);
  });

  it('(b) a single reserve increments by 1', () => {
    writeTasks('tasks.json', []); // seeds to 1
    expect(reserveTaskIds(dataDir)).toEqual([1]);
    expect(reserveTaskIds(dataDir)).toEqual([2]);
    expect(readState().nextTaskId).toBe(3);
  });

  it('(c) a block reserve of count=3 returns 3 contiguous ids and advances by 3', () => {
    writeTasks('tasks.json', []);
    const ids = reserveTaskIds(dataDir, 3);
    expect(ids).toEqual([1, 2, 3]);
    expect(readState().nextTaskId).toBe(4);

    // Next reserve continues from where the block left off.
    expect(reserveTaskIds(dataDir)).toEqual([4]);
  });

  it('(e) two sequential reserves never overlap', () => {
    writeTasks('tasks.json', []);
    const first = reserveTaskIds(dataDir, 2);
    const second = reserveTaskIds(dataDir, 2);
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([3, 4]);
    const overlap = first.filter((id) => second.includes(id));
    expect(overlap).toEqual([]);
  });

  it('(f) floors at 1 when no prior ids and no state', () => {
    const ids = reserveTaskIds(dataDir);
    expect(ids).toEqual([1]);
    expect(readState().nextTaskId).toBe(2);
  });

  it('respects an existing state.json over the lazy seed', () => {
    writeTasks('tasks.completed.json', [100]);
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 50 }));
    expect(reserveTaskIds(dataDir)).toEqual([50]);
    expect(readState().nextTaskId).toBe(51);
  });

  it('defaults count to 1 and rejects non-positive counts', () => {
    writeTasks('tasks.json', []);
    expect(() => reserveTaskIds(dataDir, 0)).toThrow();
    expect(() => reserveTaskIds(dataDir, -2)).toThrow();
  });
});
