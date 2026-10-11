import * as fs from 'fs';
import * as path from 'path';
import { BRAND } from './brand';
import { tempFilePath } from './utils';
import { getRound, readStateValue, updateStateValue } from './task-counter';

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

/**
 * Post-round review phase, tracked per planning round in `state.json` under
 * `ROUND_REVIEW_STATE_KEY`. It lives there rather than in the run-state file
 * because run state reads as empty when unparseable, which would re-run triage
 * on a review file that already has triage blocks.
 *
 * - `none`    — nothing stored for the current round (never written to disk).
 * - `triage`  — the triage pass was handed out and has not settled yet.
 * - `fixing`  — triage settled and created fix tasks the normal loop is running.
 * - `closing` — the closing pass was handed out and has not settled yet.
 * - `done`    — finished (also reached straight from `triage` when it created
 *               no fix tasks).
 * - `failed`  — the append-only check failed (terminal).
 *
 * The phase never moves backwards, so concerns raised against a fix task can
 * never start a second triage: one fix pass per round.
 */
export type RoundReviewPhase = 'none' | 'triage' | 'fixing' | 'closing' | 'done' | 'failed';

export interface RoundReviewRecord {
  round: number;
  phase: RoundReviewPhase;
  baselineTaskIds: number[];
  fixTaskIds: number[];
}

export const ROUND_REVIEW_STATE_KEY = 'roundReview';

const PHASE_RANK: Record<RoundReviewPhase, number> = {
  none: 0,
  triage: 1,
  fixing: 2,
  closing: 3,
  done: 4,
  failed: 4,
};

function isIdArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** The stored value as a record for `round`, or the `none` record if it is not a valid one. */
function toRecord(stored: unknown, round: number): RoundReviewRecord {
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const s = stored as Record<string, unknown>;
    const phase = s.phase;
    if (
      s.round === round &&
      typeof phase === 'string' &&
      phase !== 'none' &&
      Object.prototype.hasOwnProperty.call(PHASE_RANK, phase) &&
      isIdArray(s.baselineTaskIds) &&
      isIdArray(s.fixTaskIds)
    ) {
      return {
        round,
        phase: phase as RoundReviewPhase,
        baselineTaskIds: [...s.baselineTaskIds],
        fixTaskIds: [...s.fixTaskIds],
      };
    }
  }
  return { round, phase: 'none', baselineTaskIds: [], fixTaskIds: [] };
}

/**
 * The review record for the current planning round. Absent, malformed and
 * other-round stored values all read as phase `none`; never throws on bad
 * content and never writes.
 */
export function readRoundReview(dataDir: string): RoundReviewRecord {
  return toRecord(readStateValue(dataDir, ROUND_REVIEW_STATE_KEY), getRound(dataDir));
}

/**
 * Move the current round's review to phase `to`, forward only. A move to the
 * same or a lower rank (done and failed share the top rank) stores nothing new
 * and returns the current record, ignoring `patch`. Skipping forward is
 * allowed. A record left by an older round is discarded, not merged.
 */
export function advanceRoundReview(
  dataDir: string,
  to: Exclude<RoundReviewPhase, 'none'>,
  patch?: { baselineTaskIds?: number[]; fixTaskIds?: number[] },
): RoundReviewRecord {
  let result!: RoundReviewRecord;
  updateStateValue(dataDir, ROUND_REVIEW_STATE_KEY, (stored) => {
    // getRound is a lock-free read, safe inside the state.json lock.
    const current = toRecord(stored, getRound(dataDir));
    if (PHASE_RANK[to] <= PHASE_RANK[current.phase]) {
      // A lower-or-equal rank implies a valid stored record: write it back as is.
      result = current;
      return stored;
    }
    result = {
      round: current.round,
      phase: to,
      baselineTaskIds: [...(patch?.baselineTaskIds ?? current.baselineTaskIds)],
      fixTaskIds: [...(patch?.fixTaskIds ?? current.fixTaskIds)],
    };
    return result;
  });
  return result;
}

export type RoundReviewAction = 'task' | 'triage' | 'closing' | 'done';

/**
 * What `cairn round next` should hand out. Pure. A pending `triage` or
 * `closing` pass (handed out, not settled) is handed out again before any task
 * runs: that keeps fix tasks from running before triage has settled and keeps
 * an interrupted triage from being followed by a duplicate one.
 */
export function decideRoundReview(input: {
  enabled: boolean;
  phase: RoundReviewPhase;
  reviewFileExists: boolean;
  readyTasksRemain: boolean;
}): RoundReviewAction {
  const { enabled, phase, reviewFileExists, readyTasksRemain } = input;
  if (!enabled) return readyTasksRemain ? 'task' : 'done';
  if (phase === 'triage') return 'triage';
  if (phase === 'closing') return 'closing';
  if (readyTasksRemain) return 'task';
  if (phase === 'none') return reviewFileExists ? 'triage' : 'done';
  if (phase === 'fixing') return reviewFileExists ? 'closing' : 'done';
  return 'done';
}
