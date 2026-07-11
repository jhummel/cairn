import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { reserveTaskIds, seedNextId, getRound, bumpRound } from '../src/task-counter';

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

function readState(): { nextTaskId?: number; round?: number } {
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

  it('(d) preserves an existing round field (clobber regression)', () => {
    fs.writeFileSync(
      path.join(dataDir, 'state.json'),
      JSON.stringify({ nextTaskId: 7, round: 4 })
    );
    expect(reserveTaskIds(dataDir)).toEqual([7]);
    const state = readState();
    expect(state.nextTaskId).toBe(8);
    expect(state.round).toBe(4);
  });
});

describe('getRound', () => {
  it('(a) returns 1 on missing state.json and does not create the file', () => {
    expect(getRound(dataDir)).toBe(1);
    expect(fs.existsSync(path.join(dataDir, 'state.json'))).toBe(false);
  });

  it('returns 1 when round field is absent or invalid, without writing', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 5 }));
    expect(getRound(dataDir)).toBe(1);
    expect(readState().round).toBeUndefined();

    fs.writeFileSync(
      path.join(dataDir, 'state.json'),
      JSON.stringify({ nextTaskId: 5, round: 'oops' })
    );
    expect(getRound(dataDir)).toBe(1);
  });

  it('returns the persisted round', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ round: 6 }));
    expect(getRound(dataDir)).toBe(6);
  });
});

describe('bumpRound', () => {
  it('(b) increments and persists the round', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ round: 2 }));
    bumpRound(dataDir);
    expect(readState().round).toBe(3);
    expect(getRound(dataDir)).toBe(3);
  });

  it('(c) preserves nextTaskId when bumping round', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 9 }));
    bumpRound(dataDir);
    const state = readState();
    expect(state.nextTaskId).toBe(9);
    expect(state.round).toBe(2);
  });

  it('(e) seeds round: 2 when round is absent (absent === 1)', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 3 }));
    bumpRound(dataDir);
    expect(readState().round).toBe(2);
  });

  it('seeds round: 2 when state.json is missing entirely', () => {
    bumpRound(dataDir);
    expect(readState().round).toBe(2);
  });
});
