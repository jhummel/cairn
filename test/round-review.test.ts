import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isAppendOnly,
  snapshotReviewFile,
  verifyAppendOnly,
  cleanupRoundReviewScratch,
  roundReviewPromptFilePath,
  roundReviewSnapshotPath,
  roundReviewRejectedPath,
  fixTaskFilePath,
  ROUND_REVIEW_STATE_KEY,
  readRoundReview,
  advanceRoundReview,
  decideRoundReview,
  type RoundReviewPhase,
  type RoundReviewRecord,
} from '../src/round-review';
import { bumpRound } from '../src/task-counter';

describe('isAppendOnly', () => {
  const snap = '# R\n\n---\n\nblock A\n\n---\n';
  test('append at end passes', () => expect(isAppendOnly(snap, snap + '\nblock B\n')).toBe(true));
  test('insert mid-file passes', () =>
    expect(isAppendOnly('a\nb\nc\n', 'a\nX\nb\nc\n')).toBe(true));
  test('changed line fails', () => expect(isAppendOnly('a\nb\nc\n', 'a\nB\nc\n')).toBe(false));
  test('deleted line fails', () => expect(isAppendOnly('a\nb\nc\n', 'a\nc\n')).toBe(false));
  test('reordered fails', () => expect(isAppendOnly('a\nb\nc\n', 'a\nc\nb\n')).toBe(false));
  test('trailing newline difference passes', () => {
    expect(isAppendOnly('a\nb\n', 'a\nb')).toBe(true);
    expect(isAppendOnly('a\nb', 'a\nb\n')).toBe(true);
  });
  test('duplicate lines use in-order matching', () => {
    expect(isAppendOnly('---\n\n---\n', '---\n\n---\n\n---\n')).toBe(true);
    expect(isAppendOnly('---\n---\n---\n', '---\n---\n')).toBe(false);
  });
  test('empty snapshot always passes', () => expect(isAppendOnly('', 'anything')).toBe(true));
});

describe('scratch paths', () => {
  test('names', () => {
    expect(roundReviewPromptFilePath('/d')).toBe('/d/.cairn_round_review_prompt.md');
    expect(roundReviewSnapshotPath('/d')).toBe('/d/.cairn_round_review_snapshot.md');
    expect(roundReviewRejectedPath('/d')).toBe('/d/.cairn_round_review_rejected.md');
    expect(fixTaskFilePath('/d', 3)).toBe('/d/reviews/.cairn_round_review_fix_3.json');
  });
});

describe('verifyAppendOnly / cleanup', () => {
  let dir: string;
  let review: string;
  const original = 'one\ntwo\nthree\n';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'));
    fs.mkdirSync(path.join(dir, 'reviews'));
    review = path.join(dir, 'reviews', 'round-21.md');
    fs.writeFileSync(review, original);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('ok leaves file identical', () => {
    snapshotReviewFile(dir, review);
    fs.appendFileSync(review, 'four\n');
    expect(verifyAppendOnly(dir, review)).toEqual({ status: 'ok' });
    expect(fs.readFileSync(review, 'utf8')).toBe(original + 'four\n');
  });

  for (const [name, bad] of [
    ['changed', 'one\nTWO\nthree\n'],
    ['deleted', 'one\nthree\n'],
    ['reordered', 'one\nthree\ntwo\n'],
  ] as const) {
    test(`${name} line is restored`, () => {
      snapshotReviewFile(dir, review);
      fs.writeFileSync(review, bad);
      expect(verifyAppendOnly(dir, review)).toEqual({ status: 'violated', restored: true });
      expect(fs.readFileSync(review, 'utf8')).toBe(original);
      expect(fs.readFileSync(roundReviewRejectedPath(dir), 'utf8')).toBe(bad);
    });
  }

  test('deleted review file is restored', () => {
    snapshotReviewFile(dir, review);
    fs.rmSync(review);
    expect(verifyAppendOnly(dir, review)).toEqual({ status: 'violated', restored: true });
    expect(fs.readFileSync(review, 'utf8')).toBe(original);
  });

  test('missing snapshot', () => {
    expect(verifyAppendOnly(dir, review)).toEqual({ status: 'snapshot-missing' });
    expect(fs.readFileSync(review, 'utf8')).toBe(original);
  });

  test('snapshot throws when review unreadable', () => {
    expect(() => snapshotReviewFile(dir, path.join(dir, 'nope.md'))).toThrow();
  });

  test('cleanup removes scratch, keeps the rest', () => {
    fs.writeFileSync(roundReviewPromptFilePath(dir), 'p');
    fs.writeFileSync(roundReviewSnapshotPath(dir), 's');
    fs.writeFileSync(roundReviewRejectedPath(dir), 'r');
    fs.writeFileSync(fixTaskFilePath(dir, 1), '{}');
    fs.writeFileSync(fixTaskFilePath(dir, 12), '{}');
    fs.writeFileSync(path.join(dir, 'tasks.json'), '{}');
    fs.writeFileSync(path.join(dir, 'state.json'), '{}');
    cleanupRoundReviewScratch(dir);
    expect(fs.existsSync(roundReviewPromptFilePath(dir))).toBe(false);
    expect(fs.existsSync(roundReviewSnapshotPath(dir))).toBe(false);
    expect(fs.existsSync(fixTaskFilePath(dir, 1))).toBe(false);
    expect(fs.existsSync(fixTaskFilePath(dir, 12))).toBe(false);
    expect(fs.existsSync(roundReviewRejectedPath(dir))).toBe(true);
    expect(fs.existsSync(review)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(true);
  });

  test('cleanup tolerates empty/missing dir', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-e-'));
    expect(() => cleanupRoundReviewScratch(empty)).not.toThrow();
    fs.rmSync(empty, { recursive: true });
    expect(() => cleanupRoundReviewScratch(empty)).not.toThrow();
  });
});

describe('round-review phase tracking', () => {
  let dataDir: string;
  const statePath = () => path.join(dataDir, 'state.json');
  const rawState = (): Record<string, unknown> => JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  const writeState = (s: unknown) => fs.writeFileSync(statePath(), JSON.stringify(s));
  const none = (round: number): RoundReviewRecord => ({
    round,
    phase: 'none',
    baselineTaskIds: [],
    fixTaskIds: [],
  });

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-rr-phase-'));
    writeState({ nextTaskId: 10, round: 4 });
  });
  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  test('state key constant', () => expect(ROUND_REVIEW_STATE_KEY).toBe('roundReview'));

  describe('readRoundReview', () => {
    test('absent record → none for the current round', () => {
      expect(readRoundReview(dataDir)).toEqual(none(4));
    });
    test('missing state.json → none for round 1, file not created', () => {
      fs.rmSync(statePath());
      expect(readRoundReview(dataDir)).toEqual(none(1));
      expect(fs.existsSync(statePath())).toBe(false);
    });
    test('unparseable state.json → none', () => {
      fs.writeFileSync(statePath(), '{ nope');
      expect(readRoundReview(dataDir)).toEqual(none(1));
    });
    const malformed: Array<[string, unknown]> = [
      ['string', 'triage'],
      ['null', null],
      ['array', []],
      ['number', 3],
      ['unknown phase', { round: 4, phase: 'bogus', baselineTaskIds: [], fixTaskIds: [] }],
      ['stored none phase', { round: 4, phase: 'none', baselineTaskIds: [], fixTaskIds: [] }],
      ['missing phase', { round: 4, baselineTaskIds: [], fixTaskIds: [] }],
      ['non-numeric round', { round: '4', phase: 'triage', baselineTaskIds: [], fixTaskIds: [] }],
      ['missing round', { phase: 'triage', baselineTaskIds: [], fixTaskIds: [] }],
      ['non-array baseline', { round: 4, phase: 'triage', baselineTaskIds: 'x', fixTaskIds: [] }],
      ['missing fixTaskIds', { round: 4, phase: 'triage', baselineTaskIds: [] }],
      ['non-number ids', { round: 4, phase: 'triage', baselineTaskIds: ['1'], fixTaskIds: [] }],
    ];
    for (const [name, value] of malformed) {
      test(`malformed (${name}) → none`, () => {
        writeState({ round: 4, roundReview: value });
        expect(readRoundReview(dataDir)).toEqual(none(4));
      });
    }
    test('record from another round → none', () => {
      writeState({
        round: 4,
        roundReview: { round: 3, phase: 'fixing', baselineTaskIds: [1], fixTaskIds: [2] },
      });
      expect(readRoundReview(dataDir)).toEqual(none(4));
    });
    test('valid record for the current round is returned', () => {
      const rec = { round: 4, phase: 'fixing', baselineTaskIds: [1, 2], fixTaskIds: [9] };
      writeState({ round: 4, roundReview: rec });
      expect(readRoundReview(dataDir)).toEqual(rec as RoundReviewRecord);
    });
  });

  describe('advanceRoundReview', () => {
    type Stored = Exclude<RoundReviewPhase, 'none'>;
    const rank: Record<RoundReviewPhase, number> = {
      none: 0,
      triage: 1,
      fixing: 2,
      closing: 3,
      done: 4,
      failed: 4,
    };
    const stored: Stored[] = ['triage', 'fixing', 'closing', 'done', 'failed'];
    const all: RoundReviewPhase[] = ['none', ...stored];
    const seed = (phase: RoundReviewPhase) => {
      if (phase === 'none') return;
      writeState({
        nextTaskId: 10,
        round: 4,
        roundReview: { round: 4, phase, baselineTaskIds: [1], fixTaskIds: [2] },
      });
    };

    for (const from of all) {
      for (const to of stored) {
        const forward = rank[to] > rank[from];
        test(`${from} → ${to} ${forward ? 'advances' : 'is a no-op'}`, () => {
          seed(from);
          const before = fs.existsSync(statePath()) ? rawState() : null;
          const out = advanceRoundReview(dataDir, to);
          if (forward) {
            const arrays =
              from === 'none'
                ? { baselineTaskIds: [], fixTaskIds: [] }
                : { baselineTaskIds: [1], fixTaskIds: [2] };
            expect(out).toEqual({ round: 4, phase: to, ...arrays });
            expect(rawState().roundReview).toEqual({ round: 4, phase: to, ...arrays });
          } else {
            expect(out).toEqual({ round: 4, phase: from, baselineTaskIds: [1], fixTaskIds: [2] });
            expect(rawState()).toEqual(before!);
          }
          expect(readRoundReview(dataDir)).toEqual(out);
        });
      }
    }

    test('a no-op ignores its patch', () => {
      seed('closing');
      const out = advanceRoundReview(dataDir, 'fixing', { fixTaskIds: [99] });
      expect(out.fixTaskIds).toEqual([2]);
      expect(readRoundReview(dataDir).fixTaskIds).toEqual([2]);
    });

    test('preserves nextTaskId, round and unknown keys', () => {
      writeState({ nextTaskId: 10, round: 4, other: 'keep' });
      advanceRoundReview(dataDir, 'triage');
      expect(rawState()).toEqual({
        nextTaskId: 10,
        round: 4,
        other: 'keep',
        roundReview: { round: 4, phase: 'triage', baselineTaskIds: [], fixTaskIds: [] },
      });
    });

    test('works with no state.json (round 1)', () => {
      fs.rmSync(statePath());
      expect(advanceRoundReview(dataDir, 'triage')).toEqual({
        round: 1,
        phase: 'triage',
        baselineTaskIds: [],
        fixTaskIds: [],
      });
      expect(readRoundReview(dataDir).phase).toBe('triage');
    });

    test('patch arrays are stored and survive a later advance without a patch', () => {
      advanceRoundReview(dataDir, 'triage', { baselineTaskIds: [5, 6] });
      expect(readRoundReview(dataDir)).toEqual({
        round: 4,
        phase: 'triage',
        baselineTaskIds: [5, 6],
        fixTaskIds: [],
      });
      advanceRoundReview(dataDir, 'fixing', { fixTaskIds: [11, 12] });
      const out = advanceRoundReview(dataDir, 'closing');
      expect(out).toEqual({
        round: 4,
        phase: 'closing',
        baselineTaskIds: [5, 6],
        fixTaskIds: [11, 12],
      });
      expect(readRoundReview(dataDir)).toEqual(out);
    });

    test('after bumpRound the old record reads as none and a new triage can be stored', () => {
      advanceRoundReview(dataDir, 'done', { baselineTaskIds: [1], fixTaskIds: [2] });
      expect(bumpRound(dataDir)).toBe(5);
      expect(readRoundReview(dataDir)).toEqual(none(5));
      // The old-round record is discarded, not merged.
      expect(advanceRoundReview(dataDir, 'triage')).toEqual({
        round: 5,
        phase: 'triage',
        baselineTaskIds: [],
        fixTaskIds: [],
      });
      expect(rawState().roundReview).toEqual({
        round: 5,
        phase: 'triage',
        baselineTaskIds: [],
        fixTaskIds: [],
      });
    });

    test('a malformed stored value is treated as none and overwritten', () => {
      writeState({ round: 4, roundReview: 'garbage' });
      expect(advanceRoundReview(dataDir, 'fixing').phase).toBe('fixing');
      expect(readRoundReview(dataDir).phase).toBe('fixing');
    });
  });
});

describe('decideRoundReview', () => {
  const d = (
    enabled: boolean,
    phase: RoundReviewPhase,
    reviewFileExists: boolean,
    readyTasksRemain: boolean,
  ) => decideRoundReview({ enabled, phase, reviewFileExists, readyTasksRemain });
  const phases: RoundReviewPhase[] = ['none', 'triage', 'fixing', 'closing', 'done', 'failed'];

  test('flag off: task while ready tasks remain, else done — whatever the phase or file', () => {
    for (const phase of phases) {
      for (const file of [true, false]) {
        expect(d(false, phase, file, true)).toBe('task');
        expect(d(false, phase, file, false)).toBe('done');
      }
    }
  });

  test('pending triage / closing are handed out again, even with ready tasks or no file', () => {
    for (const file of [true, false]) {
      for (const ready of [true, false]) {
        expect(d(true, 'triage', file, ready)).toBe('triage');
        expect(d(true, 'closing', file, ready)).toBe('closing');
      }
    }
  });

  test('ready tasks run first for none / fixing / done / failed', () => {
    for (const phase of ['none', 'fixing', 'done', 'failed'] as const) {
      for (const file of [true, false]) expect(d(true, phase, file, true)).toBe('task');
    }
  });

  test('none with no ready tasks: triage if the review file exists, else done', () => {
    expect(d(true, 'none', true, false)).toBe('triage');
    expect(d(true, 'none', false, false)).toBe('done');
  });

  test('fixing with no ready tasks: closing if the review file exists, else done', () => {
    expect(d(true, 'fixing', true, false)).toBe('closing');
    expect(d(true, 'fixing', false, false)).toBe('done');
  });

  test('done / failed → done', () => {
    for (const file of [true, false]) {
      expect(d(true, 'done', file, false)).toBe('done');
      expect(d(true, 'failed', file, false)).toBe('done');
    }
  });
});
