import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readRunState,
  updateRunState,
  getAttempt,
  clearAttempt,
  newAttemptRecord,
  upsertAttemptRecord,
  ensureAttemptRecord,
  fileRunStateStore,
  type RunState,
  type AttemptRecord,
} from '../src/run-state';

describe('run-state', () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-run-state-test-'));
    dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('missing file returns empty default state', () => {
    const state = readRunState(dataDir);
    expect(state).toEqual({ iteration: 0, attempts: {} });
  });

  test('write/read round-trip', () => {
    updateRunState(dataDir, (state) => {
      state.iteration = 3;
      state.attempts['42'] = {
        beforeSha: 'abc123',
        iteration: 3,
        reverts: 1,
        stalls: 0,
        incompletes: 2,
        phase: 'executing',
      };
    });

    const state = readRunState(dataDir);
    expect(state.iteration).toBe(3);
    expect(state.attempts['42']).toEqual({
      beforeSha: 'abc123',
      iteration: 3,
      reverts: 1,
      stalls: 0,
      incompletes: 2,
      phase: 'executing',
    });
  });

  test('updateRunState returns the fn result', () => {
    const result = updateRunState(dataDir, (state) => {
      state.iteration = 7;
      return state.iteration * 2;
    });
    expect(result).toBe(14);
  });

  test('a corrupt file is tolerated and treated as empty', () => {
    const statePath = path.join(dataDir, '.cairn_run_state.json');
    fs.writeFileSync(statePath, '{ not valid json !!!');
    const state = readRunState(dataDir);
    expect(state).toEqual({ iteration: 0, attempts: {} });
  });

  test('the lock file is gone after an update', () => {
    updateRunState(dataDir, (state) => {
      state.iteration = 1;
    });
    const lockPath = path.join(dataDir, '.cairn_run_state.json.lock');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('the lock is released when fn throws', () => {
    expect(() =>
      updateRunState(dataDir, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');

    const lockPath = path.join(dataDir, '.cairn_run_state.json.lock');
    expect(fs.existsSync(lockPath)).toBe(false);

    // A subsequent update should still work (lock wasn't left held).
    updateRunState(dataDir, (state) => {
      state.iteration = 5;
    });
    expect(readRunState(dataDir).iteration).toBe(5);
  });

  test('getAttempt returns undefined when no attempt recorded', () => {
    expect(getAttempt(dataDir, '99')).toBeUndefined();
  });

  test('getAttempt returns the recorded attempt', () => {
    updateRunState(dataDir, (state) => {
      state.attempts['5'] = {
        beforeSha: null,
        iteration: 1,
        reverts: 0,
        stalls: 0,
        incompletes: 0,
        phase: 'awaiting-review',
      };
    });
    const attempt = getAttempt(dataDir, '5');
    expect(attempt).toEqual({
      beforeSha: null,
      iteration: 1,
      reverts: 0,
      stalls: 0,
      incompletes: 0,
      phase: 'awaiting-review',
    });
  });

  test('clearAttempt removes the attempt', () => {
    updateRunState(dataDir, (state) => {
      state.attempts['5'] = {
        beforeSha: null,
        iteration: 1,
        reverts: 0,
        stalls: 0,
        incompletes: 0,
        phase: 'executing',
      };
    });
    clearAttempt(dataDir, '5');
    expect(getAttempt(dataDir, '5')).toBeUndefined();
    // Other state (iteration) is untouched.
    expect(readRunState(dataDir).iteration).toBe(0);
  });

  describe('upsertAttemptRecord', () => {
    test('creates a fresh record with the given sha when none exists', () => {
      const state: RunState = { iteration: 4, attempts: {} };
      const record = upsertAttemptRecord(state, 9, 4, 'sha-head');
      expect(record).toEqual(newAttemptRecord('sha-head', 4));
      expect(state.attempts['9']).toBe(record);
    });

    test('an existing record keeps its beforeSha and counters and takes the new iteration', () => {
      const state: RunState = {
        iteration: 5,
        attempts: { '9': { ...newAttemptRecord('first-sha', 2), reverts: 1, stalls: 2 } },
      };
      const record = upsertAttemptRecord(state, 9, 5, 'new-head');
      expect(record).toEqual({ ...newAttemptRecord('first-sha', 5), reverts: 1, stalls: 2 });
      expect(state.attempts['9']).toBe(record);
    });

    test('a null head only lands on a brand-new record', () => {
      const state: RunState = { iteration: 0, attempts: {} };
      expect(upsertAttemptRecord(state, 1, 1, null).beforeSha).toBeNull();
      expect(upsertAttemptRecord(state, 1, 2, 'later-sha').beforeSha).toBeNull();
    });
  });

  describe('ensureAttemptRecord', () => {
    test('creates the record in the file store and returns it', () => {
      const record = ensureAttemptRecord(dataDir, 3, 1, 'sha-1', fileRunStateStore);
      expect(record).toEqual(newAttemptRecord('sha-1', 1));
      expect(getAttempt(dataDir, '3')).toEqual(newAttemptRecord('sha-1', 1));
    });

    test('a second call keeps the first beforeSha and bumps the iteration on disk', () => {
      ensureAttemptRecord(dataDir, 3, 1, 'sha-1', fileRunStateStore);
      const record = ensureAttemptRecord(dataDir, 3, 2, 'sha-2', fileRunStateStore);
      expect(record).toEqual(newAttemptRecord('sha-1', 2));
      expect(getAttempt(dataDir, '3')).toEqual(newAttemptRecord('sha-1', 2));
    });

    test('recreates the record with the given sha after it was cleared', () => {
      ensureAttemptRecord(dataDir, 3, 1, 'sha-1', fileRunStateStore);
      clearAttempt(dataDir, '3');
      ensureAttemptRecord(dataDir, 3, 2, 'sha-2', fileRunStateStore);
      expect(getAttempt(dataDir, '3')).toEqual(newAttemptRecord('sha-2', 2));
    });
  });
});
