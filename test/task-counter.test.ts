import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  reserveTaskIds,
  seedNextId,
  getRound,
  bumpRound,
  readStateValue,
  updateStateValue,
} from '../src/task-counter';

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cairn-counter-test-'));
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
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 9, round: 1 }));
    bumpRound(dataDir);
    const state = readState();
    expect(state.nextTaskId).toBe(9);
    expect(state.round).toBe(2);
  });

  it('(e) sets round: 1 when round is absent (the first generation starts round 1)', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 3 }));
    expect(bumpRound(dataDir)).toBe(1);
    const state = readState();
    expect(state.round).toBe(1);
    expect(state.nextTaskId).toBe(3);
  });

  it('sets round: 1 when round is non-finite', () => {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ round: 'x' }));
    expect(bumpRound(dataDir)).toBe(1);
  });

  it('sets round: 1 when state.json is missing entirely', () => {
    bumpRound(dataDir);
    expect(readState().round).toBe(1);
  });
});

describe('readStateValue / updateStateValue', () => {
  const statePath = () => path.join(dataDir, 'state.json');
  const rawState = (): Record<string, unknown> => JSON.parse(fs.readFileSync(statePath(), 'utf-8'));

  it('readStateValue returns undefined for a missing file or key, and never creates the file', () => {
    expect(readStateValue(dataDir, 'roundReview')).toBeUndefined();
    expect(fs.existsSync(statePath())).toBe(false);
    fs.writeFileSync(statePath(), JSON.stringify({ nextTaskId: 3 }));
    expect(readStateValue(dataDir, 'roundReview')).toBeUndefined();
    fs.writeFileSync(statePath(), 'not json');
    expect(readStateValue(dataDir, 'roundReview')).toBeUndefined();
  });

  it('readStateValue returns the stored value', () => {
    fs.writeFileSync(statePath(), JSON.stringify({ roundReview: { a: [1, 2] } }));
    expect(readStateValue(dataDir, 'roundReview')).toEqual({ a: [1, 2] });
  });

  it('updateStateValue preserves nextTaskId, round and unknown keys', () => {
    fs.writeFileSync(statePath(), JSON.stringify({ nextTaskId: 42, round: 7, other: { x: 1 } }));
    const seen: unknown[] = [];
    const out = updateStateValue(dataDir, 'roundReview', (cur) => {
      seen.push(cur);
      return { phase: 'triage' };
    });
    expect(out).toEqual({ phase: 'triage' });
    expect(seen).toEqual([undefined]);
    expect(rawState()).toEqual({
      nextTaskId: 42,
      round: 7,
      other: { x: 1 },
      roundReview: { phase: 'triage' },
    });
  });

  it('updateStateValue passes the current value to fn and replaces it', () => {
    fs.writeFileSync(statePath(), JSON.stringify({ counter: 1 }));
    const out = updateStateValue(dataDir, 'counter', (cur) => (cur as number) + 1);
    expect(out).toBe(2);
    expect(readStateValue(dataDir, 'counter')).toBe(2);
  });

  it('updateStateValue creates a missing state.json holding just that key', () => {
    updateStateValue(dataDir, 'roundReview', () => 'v');
    expect(rawState()).toEqual({ roundReview: 'v' });
  });

  it('releases the lock, also when fn throws', () => {
    expect(() =>
      updateStateValue(dataDir, 'k', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(fs.existsSync(`${statePath()}.lock`)).toBe(false);
    expect(fs.existsSync(statePath())).toBe(false);
    updateStateValue(dataDir, 'k', () => 1);
    expect(fs.existsSync(`${statePath()}.lock`)).toBe(false);
  });

  it('reserveTaskIds and bumpRound afterwards still preserve the stored key', () => {
    fs.writeFileSync(statePath(), JSON.stringify({ nextTaskId: 5, round: 2 }));
    updateStateValue(dataDir, 'roundReview', () => ({ round: 2, phase: 'fixing' }));
    expect(reserveTaskIds(dataDir, 2)).toEqual([5, 6]);
    expect(bumpRound(dataDir)).toBe(3);
    expect(rawState()).toEqual({
      nextTaskId: 7,
      round: 3,
      roundReview: { round: 2, phase: 'fixing' },
    });
  });
});
