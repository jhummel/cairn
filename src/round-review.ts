import * as fs from 'fs';
import * as path from 'path';
import { BRAND } from './brand';
import { tempFilePath } from './utils';

/**
 * Post-round review support, mode-neutral (no Commander, no process.exit).
 * A round reviewer appends blocks to `.cairn/reviews/round-<N>.md` but must
 * never change or delete an existing line; the CLI snapshots the file before
 * the agent runs and verifies afterwards, restoring the snapshot on violation.
 */

export function roundReviewPromptFilePath(dataDir: string): string {
  return tempFilePath(dataDir, 'round_review_prompt.md');
}

export function roundReviewSnapshotPath(dataDir: string): string {
  return tempFilePath(dataDir, 'round_review_snapshot.md');
}

export function roundReviewRejectedPath(dataDir: string): string {
  return tempFilePath(dataDir, 'round_review_rejected.md');
}

export function fixTaskFilePath(dataDir: string, n: number): string {
  return path.join(dataDir, 'reviews', `${BRAND.tempPrefix}round_review_fix_${n}.json`);
}

function toLines(text: string): string[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n');
}

/** True iff the snapshot's lines are a subsequence of the current lines. */
export function isAppendOnly(snapshot: string, current: string): boolean {
  if (snapshot === '') return true;
  const snap = toLines(snapshot);
  const cur = toLines(current);
  let i = 0;
  for (const line of cur) {
    if (i < snap.length && line === snap[i]) i++;
  }
  return i === snap.length;
}

export function snapshotReviewFile(dataDir: string, reviewFilePath: string): void {
  const content = fs.readFileSync(reviewFilePath);
  fs.writeFileSync(roundReviewSnapshotPath(dataDir), content);
}

export type AppendOnlyResult =
  | { status: 'ok' }
  | { status: 'violated'; restored: boolean }
  | { status: 'snapshot-missing' };

export function verifyAppendOnly(dataDir: string, reviewFilePath: string): AppendOnlyResult {
  let snapshot: string;
  try {
    snapshot = fs.readFileSync(roundReviewSnapshotPath(dataDir), 'utf8');
  } catch {
    return { status: 'snapshot-missing' };
  }
  let current: string | null = null;
  try {
    current = fs.readFileSync(reviewFilePath, 'utf8');
  } catch {
    current = null;
  }
  if (current !== null && isAppendOnly(snapshot, current)) return { status: 'ok' };

  if (current) {
    try {
      fs.writeFileSync(roundReviewRejectedPath(dataDir), current);
    } catch {
      // best-effort diagnostic
    }
  }
  try {
    fs.writeFileSync(reviewFilePath, snapshot);
    return { status: 'violated', restored: true };
  } catch {
    return { status: 'violated', restored: false };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cleanupRoundReviewScratch(dataDir: string): void {
  for (const p of [roundReviewPromptFilePath(dataDir), roundReviewSnapshotPath(dataDir)]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // best-effort
    }
  }
  try {
    const reviewsDir = path.join(dataDir, 'reviews');
    const re = new RegExp(`^${escapeRegExp(BRAND.tempPrefix)}round_review_fix_\\d+\\.json$`);
    for (const name of fs.readdirSync(reviewsDir)) {
      if (!re.test(name)) continue;
      try {
        fs.unlinkSync(path.join(reviewsDir, name));
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}
