import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readRunState,
  updateRunState,
  getAttempt,
  clearAttempt,
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
});
