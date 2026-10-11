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
  ROUND_VERDICTS,
  reviewedTaskIds,
  countUnresolved,
  buildTriagePrompt,
  buildClosingPrompt,
  writeRoundReviewPromptFile,
  settleRoundReview,
  type RoundReviewPhase,
  type RoundReviewRecord,
} from '../src/round-review';
import { bumpRound } from '../src/task-counter';
import { TasksFileError } from '../src/tasks-file';

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

const section = (id: number, title: string, verdict: string, extra = '') =>
  `## Task #${id}: ${title}\nReviewed: 2026-10-01T00:00:00Z\n\n### Coverage\n- [COVERED] thing\n\n### Files Changed\n- src/a.ts\n\n### Gaps\n- a gap\n\n### Regression Risks\nNone\n\n### Verdict\n${verdict}\n${extra}\n---\n\n`;

const REALISTIC_REVIEW =
  '# Round 4 reviews\n\n' +
  section(
    10,
    'Unresolved one',
    'HAS_GAPS',
    '\n### Round Triage\nReviewed: 2026-10-02T00:00:00Z\n1. a gap: still applies. Planned fix (task #20): fix it.\n\n### Round Outcome\nReviewed: 2026-10-03T00:00:00Z\n1. Not fixed: #20 blocked.\n\n### Round Verdict\n\nUNRESOLVED\n',
  ) +
  section(
    11,
    'Resolved one',
    'HAS_RISKS',
    '\n### Round Triage\nReviewed: 2026-10-02T00:00:00Z\n1. a gap: still applies. Planned fix (task #21): fix it.\n\n### Round Outcome\nReviewed: 2026-10-03T00:00:00Z\n1. Fixed by #21 (abc1234). Differs from plan: no.\n\n### Round Verdict\nRESOLVED\n',
  ) +
  section(
    12,
    'Accepted one',
    'CLEAN',
    '\n### Round Triage\nReviewed: 2026-10-02T00:00:00Z\n1. a gap: not fixing, UNRESOLVED is only a word here.\n\n### Round Verdict\nACCEPTED\n',
  ) +
  section(
    13,
    'Triage only',
    'HAS_GAPS',
    '\n### Round Triage\nReviewed: 2026-10-02T00:00:00Z\n1. a gap: still applies. Planned fix (task #22): fix it.\n',
  ) +
  section(14, 'No round blocks', 'CLEAN') +
  section(11, 'Resolved one (re-review)', 'CLEAN');

describe('review file parsers', () => {
  test('ROUND_VERDICTS', () => {
    expect([...ROUND_VERDICTS]).toEqual(['RESOLVED', 'UNRESOLVED', 'ACCEPTED']);
  });
  test('reviewedTaskIds: file order, de-duplicated', () => {
    expect(reviewedTaskIds(REALISTIC_REVIEW)).toEqual([10, 11, 12, 13, 14]);
    expect(reviewedTaskIds('')).toEqual([]);
    expect(reviewedTaskIds('### Task #5: nested\n text ## Task #6: inline\n')).toEqual([]);
  });
  test('countUnresolved on a realistic file: UNRESOLVED + triage-without-verdict', () => {
    expect(countUnresolved(REALISTIC_REVIEW)).toBe(2);
  });
  test('countUnresolved: no sections → 0', () => {
    expect(countUnresolved('')).toBe(0);
    expect(countUnresolved('# Round\n\n### Round Triage\n\n### Round Verdict\nUNRESOLVED\n')).toBe(0);
  });
  test('countUnresolved: each kind alone', () => {
    const v = (verdict: string) =>
      section(1, 't', 'HAS_GAPS', `\n### Round Triage\nx\n\n### Round Verdict\n${verdict}\n`);
    expect(countUnresolved(v('UNRESOLVED'))).toBe(1);
    expect(countUnresolved(v('RESOLVED'))).toBe(0);
    expect(countUnresolved(v('ACCEPTED'))).toBe(0);
    expect(countUnresolved(v('UNRESOLVED, sort of'))).toBe(0);
    expect(countUnresolved(section(1, 't', 'CLEAN'))).toBe(0);
    expect(countUnresolved(section(1, 't', 'HAS_GAPS', '\n### Round Triage\nx\n'))).toBe(1);
    expect(countUnresolved(v('UNRESOLVED') + v('UNRESOLVED').replace('#1:', '#2:'))).toBe(2);
  });
  test('countUnresolved tolerates CRLF', () => {
    const text = section(1, 't', 'HAS_GAPS', '\n### Round Triage\nx\n\n### Round Verdict\nUNRESOLVED\n');
    expect(countUnresolved(text.replace(/\n/g, '\r\n'))).toBe(1);
  });
});

// Wording that would tell the agent to change what is already in the file.
const FORBIDDEN_INSTRUCTIONS = [
  /\b(rewrite|replace|overwrite|delete|remove|modify|update) (the |an? |any |that |its |each |every )?(existing|verdict|section|finding|triage block|review file|line)/i,
  /\buse the Write tool\b/i,
];
const expectAppendOnly = (prompt: string) => {
  expect(prompt).toContain('APPEND-ONLY');
  expect(prompt).toContain('only insert new lines with the Edit tool');
  expect(prompt).toMatch(/restores the file and discards all of this pass's work/);
  expect(prompt).toMatch(/changed, removed or reordered/);
  for (const re of FORBIDDEN_INSTRUCTIONS) expect(prompt).not.toMatch(re);
};

describe('buildTriagePrompt', () => {
  const dataDir = '/abs/proj/.cairn';
  const reviewFilePath = '/abs/proj/.cairn/reviews/round-4.md';
  const prompt = buildTriagePrompt({
    reviewFilePath,
    dataDir,
    tasks: [
      { id: 10, title: 'First', directory: '', tests: ['bun run typecheck', 'bun test'] },
      { id: 11, title: 'Second', directory: 'src', tests: ['bun test', 'bun run lint'] },
      { id: 12, title: '(not in archive)' },
    ],
  });

  test('names the review path and each task', () => {
    expect(prompt).toContain(reviewFilePath);
    expect(prompt).toContain('#10: First');
    expect(prompt).toContain('#11: Second');
    expect(prompt).toContain('#12: (not in archive)');
  });
  test('carries the de-duplicated test commands and the exactly-these rule', () => {
    expect(prompt).toContain('["bun run typecheck","bun test","bun run lint"]');
    expect(prompt.split('- `bun test`').length - 1).toBe(1);
    expect(prompt).toMatch(/`tests` array must be exactly/);
  });
  test('no declared tests → says so instead of an empty list', () => {
    const p = buildTriagePrompt({ reviewFilePath, dataDir, tasks: [{ id: 1, title: 'x' }] });
    expect(p).toMatch(/declared no test commands/);
  });
  test('reading instructions', () => {
    expect(prompt).toMatch(/EVERY finding/);
    expect(prompt).toContain('[PARTIAL]');
    expect(prompt).toContain('[GAP]');
    expect(prompt).toMatch(/CLEAN/);
    expect(prompt).toMatch(/do not filter on the verdict/i);
    expect(prompt).toMatch(/CURRENT tree/);
    expect(prompt).toMatch(/de-duplicate/i);
  });
  test('rubric rows', () => {
    for (const row of [
      "contradicts the task's spec",
      'state something false',
      'safety or containment, even if minor',
      'Theoretical or very unlikely cases',
      'Test-quality nits',
      'TDD claim unverifiable',
      'already resolved by a later task',
    ]) {
      expect(prompt).toContain(row);
    }
    expect(prompt).toMatch(/^FIX/m);
    expect(prompt).toMatch(/^LEAVE, with a stated reason/m);
  });
  test('block headings and verdicts', () => {
    for (const h of ['### Round Triage', '### Round Outcome', '### Round Verdict']) expect(prompt).toContain(h);
    for (const v of ROUND_VERDICTS) expect(prompt).toContain(v);
    expect(prompt).toContain('Reviewed: <ISO 8601 timestamp>');
  });
  test('fix-task creation: file path pattern, fields, exact command', () => {
    expect(prompt).toContain(fixTaskFilePath(dataDir, 1));
    expect(prompt).toContain(fixTaskFilePath(dataDir, 2));
    expect(prompt).toContain(`cairn task add --file ${fixTaskFilePath(dataDir, 1)}`);
    for (const f of ['priority', 'title', 'description', 'directory', '"status": "pending"', 'files', 'tests', '"dependencies": []', 'model']) {
      expect(prompt).toContain(f);
    }
    expect(prompt).toMatch(/NO `id`/);
    expect(prompt).toContain('assigned id: <n>');
    expect(prompt).toMatch(/hook denies/);
    expect(prompt).toMatch(/never edit `tasks\.json` directly/i);
    expect(prompt).toMatch(/do not create duplicates/i);
    expect(prompt).toMatch(/unblock/);
  });
  test('final response line and append-only rule', () => {
    expect(prompt).toContain(`TRIAGED: <n> fix task(s), see ${reviewFilePath}`);
    expectAppendOnly(prompt);
  });
});

describe('buildClosingPrompt', () => {
  const reviewFilePath = '/abs/proj/.cairn/reviews/round-4.md';
  const prompt = buildClosingPrompt({
    reviewFilePath,
    fixTasks: [
      { id: 20, title: 'Fix A', status: 'complete', notes: 'did the thing\nsecond line', commits: ['aaa111', 'bbb222'] },
      { id: 21, title: 'Fix B', status: 'blocked', notes: 'validation failed', commits: [] },
      { id: 22, title: '(not found)', status: 'missing', commits: [] },
    ],
  });

  test('lists each fix task with status, notes and commits', () => {
    expect(prompt).toContain(reviewFilePath);
    expect(prompt).toContain('#20: Fix A');
    expect(prompt).toMatch(/Status: complete/);
    expect(prompt).toContain('did the thing');
    expect(prompt).toContain('second line');
    expect(prompt).toContain('`git show aaa111`');
    expect(prompt).toContain('`git show bbb222`');
    expect(prompt).toContain('#21: Fix B');
    expect(prompt).toMatch(/Status: blocked/);
    expect(prompt).toContain('validation failed');
    expect(prompt).toMatch(/Status: missing/);
  });
  test('handles an empty commit list', () => {
    expect(prompt.split('no commits were found').length - 1).toBe(2);
    expect(prompt).toMatch(/rely on the notes and the review section/i);
  });
  test('handles no fix tasks at all', () => {
    const p = buildClosingPrompt({ reviewFilePath, fixTasks: [] });
    expect(p).toMatch(/No fix tasks were recorded/);
    expectAppendOnly(p);
  });
  test('evidence, outcome and verdict instructions', () => {
    expect(prompt).toMatch(/EVIDENCE/);
    expect(prompt).toMatch(/one fix pass per round/);
    expect(prompt).toMatch(/NOT from the triage plan/);
    expect(prompt).toContain('### Round Triage');
    expect(prompt).toContain('### Round Outcome');
    expect(prompt).toContain('### Round Verdict');
    expect(prompt).toContain('RESOLVED');
    expect(prompt).toContain('UNRESOLVED');
    expect(prompt).toContain('Differs from plan:');
  });
  test('final response line and append-only rule', () => {
    expect(prompt).toContain(`CLOSED: <resolved> resolved, <unresolved> unresolved, see ${reviewFilePath}`);
    expectAppendOnly(prompt);
  });
});

describe('writeRoundReviewPromptFile', () => {
  let projectRoot: string;
  let dataDir: string;
  let reviewFile: string;
  const record = (fixTaskIds: number[]): RoundReviewRecord => ({
    round: 4,
    phase: 'triage',
    baselineTaskIds: [],
    fixTaskIds,
  });

  beforeEach(() => {
    projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-rr-prompt-')));
    dataDir = path.join(projectRoot, '.cairn');
    fs.mkdirSync(path.join(dataDir, 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 30, round: 4 }));
    reviewFile = path.join(dataDir, 'reviews', 'round-4.md');
    fs.writeFileSync(reviewFile, REALISTIC_REVIEW);
    fs.writeFileSync(
      path.join(dataDir, 'tasks.completed.json'),
      JSON.stringify({
        tasks: [
          { id: 10, priority: 1, title: 'Unresolved one', status: 'complete', tests: ['bun run typecheck', 'bun test'] },
          { id: 11, priority: 1, title: 'Resolved one', status: 'complete', tests: ['bun test'] },
          { id: 99, priority: 1, title: 'Older round task', status: 'complete', tests: ['make old'] },
          { id: 20, priority: 1, title: 'Fix A', status: 'complete', notes: 'fixed A' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: [{ id: 21, priority: 1, title: 'Fix B', status: 'blocked', notes: 'blocked: validation failed twice' }],
      }),
    );
  });
  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  test('triage: writes to the prompt path, ids from the review headings', () => {
    const file = writeRoundReviewPromptFile({ pass: 'triage', projectRoot, dataDir, record: record([]) });
    expect(file).toBe(roundReviewPromptFilePath(dataDir));
    const prompt = fs.readFileSync(file, 'utf8');
    expect(prompt).toContain(reviewFile);
    expect(prompt).toContain('#10: Unresolved one');
    expect(prompt).toContain('#11: Resolved one');
    for (const id of [12, 13, 14]) expect(prompt).toContain(`#${id}: (not in archive)`);
    expect(prompt).not.toContain('Older round task');
    expect(prompt).not.toContain('make old');
    expect(prompt).toContain('["bun run typecheck","bun test"]');
    expect(prompt).toContain(fixTaskFilePath(dataDir, 1));
    expect(prompt).toContain('TRIAGED:');
  });

  test('triage: missing review file still writes a prompt with no tasks', () => {
    fs.rmSync(reviewFile);
    const file = writeRoundReviewPromptFile({ pass: 'triage', projectRoot, dataDir, record: record([]) });
    expect(fs.readFileSync(file, 'utf8')).toContain(reviewFile);
  });

  test('closing: archived, blocked-from-tasks.json and missing fix tasks, with commits', () => {
    const asked: Array<[string, number]> = [];
    const file = writeRoundReviewPromptFile(
      { pass: 'closing', projectRoot, dataDir, record: record([20, 21, 22]) },
      {
        findTaskCommits: (root, id) => {
          asked.push([root, id]);
          return id === 20 ? ['c0ffee1'] : [];
        },
      },
    );
    expect(file).toBe(roundReviewPromptFilePath(dataDir));
    expect(asked).toEqual([[projectRoot, 20], [projectRoot, 21], [projectRoot, 22]]);
    const prompt = fs.readFileSync(file, 'utf8');
    expect(prompt).toContain(reviewFile);
    expect(prompt).toContain('#20: Fix A');
    expect(prompt).toMatch(/Status: complete/);
    expect(prompt).toContain('fixed A');
    expect(prompt).toContain('`git show c0ffee1`');
    expect(prompt).toContain('#21: Fix B');
    expect(prompt).toMatch(/Status: blocked/);
    expect(prompt).toContain('blocked: validation failed twice');
    expect(prompt).toContain('#22: ');
    expect(prompt).toMatch(/Status: missing/);
    expect(prompt).toContain('CLOSED:');
  });

  test('closing: unparseable tasks.json → missing, no throw; default findTaskCommits outside git → no commits', () => {
    fs.writeFileSync(path.join(dataDir, 'tasks.json'), '{ nope');
    const file = writeRoundReviewPromptFile({ pass: 'closing', projectRoot, dataDir, record: record([21]) });
    const prompt = fs.readFileSync(file, 'utf8');
    expect(prompt).toMatch(/Status: missing/);
    expect(prompt).toContain('no commits were found');
  });
});

describe('settleRoundReview', () => {
  let projectRoot: string;
  let dataDir: string;
  const NEXT = 'Run: cairn round next';
  const ORIGINAL = '## Task #1: A\nline two\nline three\n---\n';
  const reviewFile = () => path.join(dataDir, 'reviews', 'round-4.md');
  const snapshot = () => roundReviewSnapshotPath(dataDir);
  const rejected = () => roundReviewRejectedPath(dataDir);
  const logFile = () => path.join(dataDir, '.cairn_iterations.log');
  const rawState = (): string => fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
  const writeTasks = (tasks: Array<{ id: number; status?: string }>) =>
    fs.writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: tasks.map((t) => ({
          priority: 1,
          title: `T${t.id}`,
          description: 'd',
          status: 'pending',
          files: [],
          dependencies: [],
          tests: [],
          ...t,
        })),
      }),
    );
  const settle = () => settleRoundReview({ projectRoot, dataDir });
  /** Review file + snapshot in place, phase advanced to `pass`. */
  const handOut = (pass: 'triage' | 'closing', ids: { baseline?: number[]; fix?: number[] } = {}) => {
    snapshotReviewFile(dataDir, reviewFile());
    advanceRoundReview(dataDir, 'triage', { baselineTaskIds: ids.baseline ?? [] });
    if (pass === 'closing') {
      advanceRoundReview(dataDir, 'fixing', { fixTaskIds: ids.fix ?? [] });
      advanceRoundReview(dataDir, 'closing');
    }
  };

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-rr-settle-'));
    dataDir = path.join(projectRoot, '.cairn');
    fs.mkdirSync(path.join(dataDir, 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 50, round: 4 }));
    fs.writeFileSync(reviewFile(), ORIGINAL);
    writeTasks([]);
  });
  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  test('clean triage with new tasks: fixing, fixTasks are exactly the non-baseline ids, ascending', () => {
    writeTasks([{ id: 3, status: 'blocked' }]);
    handOut('triage', { baseline: [3] });
    fs.appendFileSync(reviewFile(), '### Round Triage\n');
    writeTasks([{ id: 12 }, { id: 3, status: 'blocked' }, { id: 11 }]);

    expect(settle()).toEqual({
      verdict: 'round-review-settled',
      pass: 'triage',
      phase: 'fixing',
      fixTasks: [11, 12],
      next: NEXT,
    });
    expect(readRoundReview(dataDir)).toEqual({ round: 4, phase: 'fixing', baselineTaskIds: [3], fixTaskIds: [11, 12] });
    expect(fs.existsSync(snapshot())).toBe(false);
    expect(fs.readFileSync(reviewFile(), 'utf8')).toBe(ORIGINAL + '### Round Triage\n');
    expect(fs.readFileSync(logFile(), 'utf8')).toBe('Round review triage: round-review-settled\n');
  });

  test('clean triage with no new tasks goes straight to done', () => {
    handOut('triage');
    expect(settle()).toEqual({ verdict: 'round-review-settled', pass: 'triage', phase: 'done', fixTasks: [], next: NEXT });
    expect(readRoundReview(dataDir).phase).toBe('done');
    expect(fs.existsSync(snapshot())).toBe(false);
  });

  test('baseline tasks are never counted as fix tasks', () => {
    writeTasks([{ id: 3, status: 'blocked' }, { id: 4, status: 'blocked' }]);
    handOut('triage', { baseline: [3, 4] });
    expect(settle()).toMatchObject({ verdict: 'round-review-settled', phase: 'done', fixTasks: [] });
    expect(readRoundReview(dataDir).fixTaskIds).toEqual([]);
  });

  test('clean closing: done with the recorded fixTaskIds', () => {
    handOut('closing', { baseline: [3], fix: [11, 12] });
    fs.appendFileSync(reviewFile(), '### Round Outcome\n');
    writeTasks([{ id: 99 }]);
    expect(settle()).toEqual({ verdict: 'round-review-settled', pass: 'closing', phase: 'done', fixTasks: [11, 12], next: NEXT });
    expect(readRoundReview(dataDir)).toEqual({ round: 4, phase: 'done', baselineTaskIds: [3], fixTaskIds: [11, 12] });
    expect(fs.existsSync(snapshot())).toBe(false);
    expect(fs.readFileSync(logFile(), 'utf8')).toBe('Round review closing: round-review-settled\n');
  });

  for (const [label, bad] of [
    ['changed', '## Task #1: A\nline TWO\nline three\n---\nnew\n'],
    ['deleted', '## Task #1: A\nline three\n---\nnew\n'],
    ['reordered', '## Task #1: A\nline three\nline two\n---\n'],
  ] as const) {
    for (const pass of ['triage', 'closing'] as const) {
      test(`a ${label} original line in ${pass}: failed, file restored, rejected content saved`, () => {
        handOut(pass, { fix: [11] });
        fs.writeFileSync(reviewFile(), bad);
        writeTasks([{ id: 11 }]);

        expect(settle()).toEqual({ verdict: 'round-review-failed', pass, reason: 'append-only-violated', next: NEXT });
        expect(fs.readFileSync(reviewFile(), 'utf8')).toBe(ORIGINAL);
        expect(fs.readFileSync(rejected(), 'utf8')).toBe(bad);
        expect(readRoundReview(dataDir).phase).toBe('failed');
        expect(fs.readFileSync(logFile(), 'utf8')).toBe(`Round review ${pass}: round-review-failed (append-only-violated)\n`);
        // Fix tasks a failed triage created stay in tasks.json.
        expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8')).tasks.map((t: { id: number }) => t.id)).toEqual([11]);
      });
    }
  }

  test('missing snapshot: failed with snapshot-missing, review file untouched', () => {
    handOut('triage');
    fs.unlinkSync(snapshot());
    const edited = 'completely different\n';
    fs.writeFileSync(reviewFile(), edited);

    expect(settle()).toEqual({ verdict: 'round-review-failed', pass: 'triage', reason: 'snapshot-missing', next: NEXT });
    expect(fs.readFileSync(reviewFile(), 'utf8')).toBe(edited);
    expect(fs.existsSync(rejected())).toBe(false);
    expect(readRoundReview(dataDir).phase).toBe('failed');
  });

  test('a repeat call after each kind of settle is no-round-review and changes nothing', () => {
    const scenarios: Array<[() => void, RoundReviewPhase]> = [
      [() => { handOut('triage'); writeTasks([{ id: 11 }]); }, 'fixing'],
      [() => handOut('triage'), 'done'],
      [() => handOut('closing', { fix: [11] }), 'done'],
      [() => { handOut('triage'); fs.writeFileSync(reviewFile(), 'x\n'); }, 'failed'],
      [() => { handOut('triage'); fs.unlinkSync(snapshot()); }, 'failed'],
    ];
    for (const [setup, phase] of scenarios) {
      fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 50, round: 4 }));
      fs.writeFileSync(reviewFile(), ORIGINAL);
      fs.rmSync(logFile(), { force: true });
      writeTasks([]);
      setup();
      expect(settle().verdict).not.toBe('no-round-review');
      const stateBefore = rawState();
      const reviewBefore = fs.readFileSync(reviewFile(), 'utf8');
      const logBefore = fs.readFileSync(logFile(), 'utf8');

      expect(settle()).toEqual({ verdict: 'no-round-review', phase, next: NEXT });
      expect(rawState()).toBe(stateBefore);
      expect(fs.readFileSync(reviewFile(), 'utf8')).toBe(reviewBefore);
      expect(fs.readFileSync(logFile(), 'utf8')).toBe(logBefore);
    }
  });

  for (const phase of ['none', 'fixing', 'done', 'failed'] as const) {
    test(`phase ${phase}: no-round-review, nothing changed`, () => {
      snapshotReviewFile(dataDir, reviewFile());
      if (phase !== 'none') advanceRoundReview(dataDir, phase, { fixTaskIds: [11] });
      fs.writeFileSync(reviewFile(), 'violating content\n');
      writeTasks([{ id: 11 }, { id: 12 }]);
      const stateBefore = rawState();

      expect(settle()).toEqual({ verdict: 'no-round-review', phase, next: NEXT });
      expect(rawState()).toBe(stateBefore);
      expect(fs.readFileSync(reviewFile(), 'utf8')).toBe('violating content\n');
      expect(fs.existsSync(snapshot())).toBe(true);
      expect(fs.existsSync(rejected())).toBe(false);
      expect(fs.existsSync(logFile())).toBe(false);
    });
  }

  test('tasks.json is read outside the state lock, and the phase is advanced before the log line', () => {
    handOut('triage');
    const lock = path.join(dataDir, 'state.json.lock');
    let lockHeldDuringRead = false;
    let phaseAtAppend: string | undefined;
    const verdict = settleRoundReview(
      { projectRoot, dataDir },
      {
        readTasksFile: () => {
          if (fs.existsSync(lock)) lockHeldDuringRead = true;
          return { data: { tasks: [{ id: 21 }] } as never, repaired: false, restored: false };
        },
        appendFileSync: () => {
          phaseAtAppend = readRoundReview(dataDir).phase;
        },
      },
    );
    expect(verdict).toMatchObject({ phase: 'fixing', fixTasks: [21] });
    expect(lockHeldDuringRead).toBe(false);
    expect(phaseAtAppend).toBe('fixing');
  });

  test('a failing iteration-log append never changes the verdict', () => {
    handOut('triage');
    const verdict = settleRoundReview(
      { projectRoot, dataDir },
      { appendFileSync: () => { throw new Error('disk full'); } },
    );
    expect(verdict.verdict).toBe('round-review-settled');
  });

  test('a TasksFileError propagates and leaves the phase pending', () => {
    handOut('triage');
    expect(() =>
      settleRoundReview({ projectRoot, dataDir }, { readTasksFile: () => { throw new TasksFileError('unreadable'); } }),
    ).toThrow(TasksFileError);
    expect(readRoundReview(dataDir).phase).toBe('triage');
    expect(fs.existsSync(snapshot())).toBe(true);
  });
});
