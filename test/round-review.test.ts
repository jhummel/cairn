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
} from '../src/round-review';

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
