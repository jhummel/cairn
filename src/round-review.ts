import * as fs from 'fs';
import * as path from 'path';
import { BRAND } from './brand';
import { tempFilePath } from './utils';
import { bumpRound, getRound, readStateValue, updateStateValue } from './task-counter';
import { resolveReviewFilePath } from './post-task-reviewer';
import { loadArchivedTask } from './task-archiver';
import { findTaskCommits } from './settle';
import { readTasksFile } from './tasks-file';

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

/** What `checkAppendOnly` found; a violation carries the contents needed to act on it. */
export type AppendOnlyCheck =
  | { status: 'ok' }
  | { status: 'violated'; snapshot: string; current: string | null }
  | { status: 'snapshot-missing' };

/**
 * The append-only check alone: compare the review file with its snapshot and
 * write nothing. `current` is `null` when the review file cannot be read,
 * which counts as a violation.
 */
export function checkAppendOnly(dataDir: string, reviewFilePath: string): AppendOnlyCheck {
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
  return { status: 'violated', snapshot, current };
}

/**
 * Undo a violation `checkAppendOnly` found: keep the rejected content (when
 * there was any) in the rejected file, then write the snapshot back over the
 * review file. Returns whether the restore succeeded; never throws.
 */
export function restoreReviewFile(
  dataDir: string,
  reviewFilePath: string,
  violation: { snapshot: string; current: string | null },
): boolean {
  if (violation.current) {
    try {
      fs.writeFileSync(roundReviewRejectedPath(dataDir), violation.current);
    } catch {
      // best-effort diagnostic
    }
  }
  try {
    fs.writeFileSync(reviewFilePath, violation.snapshot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check and, on a violation, restore in one step. `settleRoundReview` does not
 * use this: it records the failed phase between the two steps.
 */
export function verifyAppendOnly(dataDir: string, reviewFilePath: string): AppendOnlyResult {
  const check = checkAppendOnly(dataDir, reviewFilePath);
  if (check.status !== 'violated') return check;
  return { status: 'violated', restored: restoreReviewFile(dataDir, reviewFilePath, check) };
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

/**
 * Start a new planning round (`cairn round new`): bump the round and remove
 * the stored review record, in one write under the state.json lock. Returns
 * the new round.
 *
 * The record is cleared unconditionally because a new round always makes it
 * obsolete, and its round number alone does not guarantee that it stops
 * matching: with no `round` key in state.json the current round reads as 1 and
 * the bump also yields 1, so a finished `{ round: 1, phase: 'done' }` record
 * would read as the new round's and its post-round review would be skipped.
 */
export function startNewRound(dataDir: string): number {
  return bumpRound(dataDir, { clear: [ROUND_REVIEW_STATE_KEY] });
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

export const ROUND_VERDICTS = ['RESOLVED', 'UNRESOLVED', 'ACCEPTED'] as const;
export type RoundVerdict = (typeof ROUND_VERDICTS)[number];

const TASK_HEADING_RE = /^## Task #(\d+):/;
const TRIAGE_HEADING = '### Round Triage';
const OUTCOME_HEADING = '### Round Outcome';
const VERDICT_HEADING = '### Round Verdict';

/** Lines of a review file, tolerant of CRLF and trailing whitespace. */
function reviewLines(text: string): string[] {
  return text.split('\n').map((line) => line.trimEnd());
}

/** Ids of the tasks that have a `## Task #<id>:` section, in file order, de-duplicated. */
export function reviewedTaskIds(reviewText: string): number[] {
  const ids: number[] = [];
  for (const line of reviewLines(reviewText)) {
    const m = TASK_HEADING_RE.exec(line);
    if (!m) continue;
    const id = Number(m[1]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * How many task sections the round review left open: a `### Round Verdict` of
 * `UNRESOLVED`, or a `### Round Triage` with no `### Round Verdict` at all (the
 * round review did not finish for that section). Text before the first task
 * heading belongs to no section and never counts.
 */
export function countUnresolved(reviewText: string): number {
  const sections: string[][] = [];
  for (const line of reviewLines(reviewText)) {
    if (TASK_HEADING_RE.test(line)) sections.push([]);
    else if (sections.length > 0) sections[sections.length - 1].push(line);
  }
  let count = 0;
  for (const lines of sections) {
    const hasTriage = lines.includes(TRIAGE_HEADING);
    let hasVerdict = false;
    let unresolved = false;
    lines.forEach((line, i) => {
      if (line !== VERDICT_HEADING) return;
      hasVerdict = true;
      const value = lines.slice(i + 1).find((l) => l.trim() !== '');
      if (value === 'UNRESOLVED') unresolved = true;
    });
    if (unresolved || (hasTriage && !hasVerdict)) count++;
  }
  return count;
}

/** countUnresolved for the file at `reviewFilePath`; 0 when it cannot be read. Never throws. */
export function countUnresolvedInFile(reviewFilePath: string): number {
  try {
    return countUnresolved(fs.readFileSync(reviewFilePath, 'utf8'));
  } catch {
    return 0;
  }
}

const BLOCK_FORMAT = [
  '```',
  TRIAGE_HEADING,
  'Reviewed: <ISO 8601 timestamp>',
  '1. <finding>: still applies. Planned fix (task #<id>): <what>.',
  '2. <finding>: not fixing, <reason>.',
  '',
  OUTCOME_HEADING,
  'Reviewed: <ISO 8601 timestamp>',
  '1. Fixed by #<id> (<short sha>). Differs from plan: <difference, if any>.',
  '',
  VERDICT_HEADING,
  'RESOLVED',
  '```',
  '',
  'Round verdicts (the line after `### Round Verdict` is exactly one of these words, nothing else on it):',
  '- `RESOLVED`: the fix landed, as planned or differently, with any difference stated.',
  '- `UNRESOLVED`: the fix task is blocked, or its own review raised concerns. Left for the user.',
  '- `ACCEPTED`: nothing needed fixing.',
].join('\n');

const APPEND_ONLY_RULE = [
  'APPEND-ONLY RULE:',
  '- The review file is a record. You add to it; you never change what is already there.',
  '- Make every change with the Edit tool, and only insert new lines with the Edit tool: each edit keeps every line that was already in the file, character for character and in the same order, and puts your new lines between them.',
  "- After you finish, a check run by the CLI compares the file against a copy taken before you started. If any existing line is changed, removed or reordered, the check restores the file and discards all of this pass's work.",
  '- Your blocks go inside a task section: after the value line under its existing `### Verdict` heading (and after any round blocks already there), before the `---` line that ends the section.',
].join('\n');

export function buildTriagePrompt(opts: {
  reviewFilePath: string;
  dataDir: string;
  tasks: Array<{ id: number; title: string; directory?: string; tests?: string[] }>;
}): string {
  const { reviewFilePath, dataDir, tasks } = opts;
  const testCommands: string[] = [];
  for (const t of tasks) {
    for (const cmd of t.tests ?? []) {
      if (!testCommands.includes(cmd)) testCommands.push(cmd);
    }
  }
  const taskList = tasks.length
    ? tasks.map((t) => `- #${t.id}: ${t.title}${t.directory ? ` (directory: ${t.directory})` : ''}`).join('\n')
    : '- (the review file has no task sections)';
  const testsBlock = testCommands.length
    ? [
        "TEST COMMANDS these tasks declared (distinct). Every fix task's `tests` array must be exactly these commands, in this order, so fixes are validated like the original tasks:",
        ...testCommands.map((c) => `- \`${c}\``),
        `As JSON: ${JSON.stringify(testCommands)}`,
      ].join('\n')
    : "TEST COMMANDS: these tasks declared no test commands. Use the project's standard checks as each fix task's `tests` array.";
  const fixFile1 = fixTaskFilePath(dataDir, 1);
  const fixFile2 = fixTaskFilePath(dataDir, 2);
  const fixFilePattern = fixTaskFilePath(dataDir, 0).replace(/0\.json$/, '<n>.json');

  return [
    'You are the post-round reviewer, running the TRIAGE pass for this planning round.',
    '',
    `REVIEW FILE: ${reviewFilePath}`,
    '',
    'It holds one section per reviewed task, written by the per-task reviewer: `## Task #<id>: <title>`, `Reviewed: ...`, `### Coverage`, `### Files Changed`, `### Gaps`, `### Regression Risks`, `### Verdict` (`CLEAN | HAS_GAPS | HAS_RISKS`), then a `---` line.',
    '',
    'Your job: read every finding, decide for each whether to fix it or leave it, create a fix task for what needs fixing, and record your decisions in the review file. You do not fix anything yourself. The normal task loop runs the fix tasks after you, and a later CLOSING pass records what happened.',
    '',
    "THE ROUND'S TASKS:",
    taskList,
    '',
    testsBlock,
    '',
    'STEP 1. READ',
    '- Read the whole review file. Read EVERY finding in every section: Gaps, Regression Risks, [PARTIAL] and [GAP] coverage markers, and "minor notes" written under a CLEAN verdict. Do not filter on the verdict: a CLEAN section can still carry a finding.',
    '- Verify each finding against the CURRENT tree (read the code, the tests, the docs it names). A later task may already have resolved it.',
    '- De-duplicate: findings in different sections that share one underlying issue are one issue.',
    `- If the file already has \`### Round Triage\` blocks, or \`tasks.json\` already holds fix tasks (open ${path.join(dataDir, 'tasks.json')} with the Read tool to check; reading it is fine), an earlier run of this pass was interrupted. Continue from there and do not create duplicates.`,
    '',
    'STEP 2. DECIDE, using this rubric',
    'FIX:',
    "- Behaviour that contradicts the task's spec.",
    '- Docs that state something false.',
    '- Anything touching safety or containment, even if minor.',
    'LEAVE, with a stated reason:',
    '- Theoretical or very unlikely cases.',
    '- Test-quality nits.',
    '- Process notes that can\'t be acted on (e.g. "TDD claim unverifiable").',
    '- Findings already resolved by a later task.',
    '',
    'STEP 3. CREATE FIX TASKS',
    '- One fix task per underlying issue. Group small related fixes in the same area into one task: each fix task costs a task-agent run plus a per-task review.',
    `- For fix task n (n = 1, 2, ...), write one JSON object with the Write tool to ${fixFilePattern} — that is ${fixFile1}, then ${fixFile2}, and so on. These are new scratch files; the Write tool is for them only.`,
    '- Fields:',
    '  - `"priority"`: integer.',
    '  - `"title"`: short.',
    '  - `"description"`: self-contained. The agent that runs it has not seen the review file: say what the finding was, which review section(s) raised it, what to change, and how to test it.',
    '  - `"directory"`: relative to the project root, `""` for the root.',
    '  - `"status": "pending"`.',
    '  - `"files"`: array of the files to change.',
    `  - \`"tests"\`: ${testCommands.length ? `exactly ${JSON.stringify(testCommands)}` : 'array of test commands'}.`,
    '  - `"dependencies": []`.',
    '  - `"model"`: `"opus"` or `"sonnet"`.',
    '  - NO `id` field. The CLI assigns it.',
    `- Then run exactly this, as a single command on its own: \`cairn task add --file ${fixFile1}\` (with the path of the file you just wrote). No \`&&\`, pipes, redirection, \`$\`, or backticks in the command: a hook denies anything else.`,
    '- Read the new task id from its `assigned id: <n>` output. You need it for the triage block.',
    '- Never edit `tasks.json` directly.',
    '- Do not try to unblock blocked tasks, and do not review work that did not complete.',
    '',
    'STEP 4. WRITE YOUR DECISIONS',
    'Block format:',
    '',
    BLOCK_FORMAT,
    '',
    'In this pass:',
    `- Under each task section that has findings, add a \`${TRIAGE_HEADING}\` block after that section's \`### Verdict\` value: one numbered line per finding, either "still applies. Planned fix (task #<id>): <what>." or "not fixing, <reason>.". For a de-duplicated issue, name the same fix task in each section that raised it.`,
    `- When nothing in a section needs a fix, also write \`${VERDICT_HEADING}\` with \`ACCEPTED\` right after the triage block (no outcome block).`,
    `- When a section has a planned fix, write only the triage block. \`${OUTCOME_HEADING}\` and \`${VERDICT_HEADING}\` for it belong to the closing pass.`,
    '- A section with no findings at all gets no blocks.',
    '',
    APPEND_ONLY_RULE,
    '',
    'FINAL RESPONSE: a single line, nothing else:',
    `TRIAGED: <n> fix task(s), see ${reviewFilePath}`,
    '',
  ].join('\n');
}

export interface FixTaskInfo {
  id: number;
  title: string;
  status: string;
  notes?: string;
  commits: string[];
}

function describeFixTask(t: FixTaskInfo): string {
  const notes = t.notes && t.notes.trim() ? t.notes.trim().split('\n').map((l) => `    ${l}`).join('\n') : '    (none)';
  const commits = t.commits.length
    ? `  Commits (inspect each): ${t.commits.map((sha) => `\`git show ${sha}\``).join(', ')}`
    : '  Commits: no commits were found for this task. Rely on the notes and the review section.';
  return [`- #${t.id}: ${t.title}`, `  Status: ${t.status}`, '  Completion notes:', notes, commits].join('\n');
}

export function buildClosingPrompt(opts: { reviewFilePath: string; fixTasks: FixTaskInfo[] }): string {
  const { reviewFilePath, fixTasks } = opts;
  const fixList = fixTasks.length
    ? fixTasks.map(describeFixTask).join('\n\n')
    : '- No fix tasks were recorded for this round. Every planned fix named in a triage block therefore did not land.';

  return [
    'You are the post-round reviewer, running the CLOSING pass for this planning round.',
    '',
    `REVIEW FILE: ${reviewFilePath}`,
    '',
    `An earlier TRIAGE pass added \`${TRIAGE_HEADING}\` blocks to task sections in that file and created fix tasks. The normal task loop has since run them. Your job: record, in the review file, what actually happened to each planned fix. You do not fix anything and you create no tasks.`,
    '',
    'FIX TASKS (status `complete` = finished and archived; `blocked` or any other status = did not finish; `missing` = not found anywhere):',
    fixList,
    '',
    'STEP 1. GATHER EVIDENCE',
    "- Learn what happened from each fix task's diff (`git show <sha>`), its completion notes above, and its own review section — NOT from the triage plan. The plan says what was intended; only the evidence says what was done.",
    "- The fix tasks' own `## Task #<id>` sections in the review file are EVIDENCE to read. They get no triage blocks and are not triaged: there is one fix pass per round, so concerns raised there are reported, not fixed.",
    '',
    'STEP 2. WRITE THE OUTCOMES',
    'Block format:',
    '',
    BLOCK_FORMAT,
    '',
    'In this pass:',
    `- For every task section that has a \`${TRIAGE_HEADING}\` and no \`${VERDICT_HEADING}\`, add \`${OUTCOME_HEADING}\` and then \`${VERDICT_HEADING}\`, after the triage block.`,
    `- \`${OUTCOME_HEADING}\`: a \`Reviewed:\` timestamp, then one numbered line per planned fix: "Fixed by #<id> (<short sha>). Differs from plan: <difference, if any>." When the fix differs from the plan, say how. When it did not land, say so and why (blocked, missing, incomplete). Never edit the triage block.`,
    `- \`${VERDICT_HEADING}\`: \`RESOLVED\` when the fix landed; \`UNRESOLVED\` when the fix task is blocked, missing or incomplete, or its own review raised concerns. A section with several planned fixes is \`RESOLVED\` only when all of them landed cleanly.`,
    `- Sections that already have a \`${VERDICT_HEADING}\` (for example \`ACCEPTED\`), and sections with no round blocks, stay as they are.`,
    '',
    APPEND_ONLY_RULE,
    '',
    'FINAL RESPONSE: a single line, nothing else:',
    `CLOSED: <resolved> resolved, <unresolved> unresolved, see ${reviewFilePath}`,
    '',
  ].join('\n');
}

/** A task from a plain read of `<dataDir>/tasks.json`; never repairs or writes. */
function readLiveTask(dataDir: string, taskId: number): { title?: unknown; status?: unknown; notes?: unknown } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8'));
    const tasks: unknown = Array.isArray(parsed) ? parsed : parsed?.tasks;
    if (!Array.isArray(tasks)) return undefined;
    return tasks.find((t) => t && typeof t === 'object' && t.id === taskId);
  } catch {
    return undefined;
  }
}

function fixTaskInfo(dataDir: string, id: number, commits: string[]): FixTaskInfo {
  const archived = loadArchivedTask(dataDir, id);
  if (archived) {
    return { id, title: archived.title, status: 'complete', notes: archived.notes, commits };
  }
  const live = readLiveTask(dataDir, id);
  if (live) {
    return {
      id,
      title: typeof live.title === 'string' ? live.title : '(untitled)',
      status: typeof live.status === 'string' ? live.status : 'unknown',
      notes: typeof live.notes === 'string' ? live.notes : undefined,
      commits,
    };
  }
  return { id, title: '(not found)', status: 'missing', commits };
}

/**
 * Write the post-round reviewer's prompt for `pass` to
 * roundReviewPromptFilePath and return that path. Triage takes the round's
 * task ids from the review file's headings because archived tasks carry no
 * round number.
 */
export function writeRoundReviewPromptFile(
  opts: { pass: 'triage' | 'closing'; projectRoot: string; dataDir: string; record: RoundReviewRecord },
  deps: { findTaskCommits?: typeof findTaskCommits } = {},
): string {
  const { pass, projectRoot, dataDir, record } = opts;
  const { reviewFilePath } = resolveReviewFilePath(projectRoot, dataDir);
  let prompt: string;
  if (pass === 'triage') {
    let reviewText = '';
    try {
      reviewText = fs.readFileSync(reviewFilePath, 'utf8');
    } catch {
      // No review file: the prompt lists no tasks.
    }
    const tasks = reviewedTaskIds(reviewText).map((id) => {
      const task = loadArchivedTask(dataDir, id);
      return task
        ? { id, title: task.title, directory: task.directory, tests: task.tests }
        : { id, title: '(not in archive)' };
    });
    prompt = buildTriagePrompt({ reviewFilePath, dataDir, tasks });
  } else {
    const commitsOf = deps.findTaskCommits ?? findTaskCommits;
    const fixTasks = record.fixTaskIds.map((id) => fixTaskInfo(dataDir, id, commitsOf(projectRoot, id)));
    prompt = buildClosingPrompt({ reviewFilePath, fixTasks });
  }
  const file = roundReviewPromptFilePath(dataDir);
  fs.writeFileSync(file, prompt);
  return file;
}

export type RoundReviewSettleVerdict =
  | { verdict: 'round-review-settled'; pass: 'triage' | 'closing'; phase: 'fixing' | 'done'; fixTasks: number[]; next: string }
  | { verdict: 'round-review-failed'; pass: 'triage' | 'closing'; reason: 'append-only-violated' | 'snapshot-missing'; next: string }
  | { verdict: 'no-round-review'; phase: RoundReviewPhase; next: string };

export interface RoundReviewSettleDeps {
  readTasksFile?: typeof readTasksFile;
  appendFileSync?: (p: string, c: string) => void;
  /** The state.json phase update; injectable so a lock timeout can be simulated. */
  advanceRoundReview?: typeof advanceRoundReview;
}

/**
 * Settle a post-round review pass that `cairn round next` handed out: run the
 * append-only check and advance the phase. Only a pending `triage` or
 * `closing` phase is settled; any other phase returns `no-round-review` and
 * changes nothing, which is what makes a repeat call idempotent.
 *
 * A failed check is terminal, never retried: a triage pass may already have
 * created fix tasks, so handing triage out again would duplicate them. Those
 * tasks stay in tasks.json and run as ordinary tasks, with no closing pass.
 *
 * On a violation the order is: detect (no writes), record phase `failed`, and
 * only then save the rejected content and restore the review file from the
 * snapshot. The restore must come last because it erases the evidence: a
 * restored file passes the check against its own snapshot.
 *
 * Throws TasksFileError (unreadable tasks.json) or FileLockError (state.json
 * lock timeout). The phase is then still pending, nothing has been written,
 * and the call can be repeated: a repeat sees the same review file and reaches
 * the same verdict, a violation included.
 *
 * The opposite window is a crash after `failed` is recorded and before the
 * restore. The failure is still reported (a repeat returns `no-round-review`
 * with phase `failed`, and round-done carries `roundReviewFailed: true`), but
 * the restore is not retried: the review file keeps the violating content and
 * no rejected copy is written. The snapshot holding the original content stays
 * in place until round-done removes it.
 */
export function settleRoundReview(
  input: { projectRoot: string; dataDir: string },
  deps: RoundReviewSettleDeps = {},
): RoundReviewSettleVerdict {
  const { projectRoot, dataDir } = input;
  const next = `Run: ${BRAND.name} round next`;
  const rec = readRoundReview(dataDir);
  if (rec.phase !== 'triage' && rec.phase !== 'closing') {
    return { verdict: 'no-round-review', phase: rec.phase, next };
  }
  const pass = rec.phase;
  const advance = deps.advanceRoundReview ?? advanceRoundReview;
  const { reviewFilePath } = resolveReviewFilePath(projectRoot, dataDir);
  const check = checkAppendOnly(dataDir, reviewFilePath);

  let verdict: RoundReviewSettleVerdict;
  if (check.status !== 'ok') {
    // Record the failure before restoring: if this throws, the violating file
    // is untouched and a repeat call detects the violation again.
    advance(dataDir, 'failed');
    if (check.status === 'violated') restoreReviewFile(dataDir, reviewFilePath, check);
    verdict = {
      verdict: 'round-review-failed',
      pass,
      reason: check.status === 'violated' ? 'append-only-violated' : 'snapshot-missing',
      next,
    };
  } else {
    if (pass === 'triage') {
      // tasks.json is read before the state.json lock is taken, never inside it.
      const tasks = (deps.readTasksFile ?? readTasksFile)(path.join(dataDir, 'tasks.json'), { dataDir }).data.tasks ?? [];
      const baseline = new Set(rec.baselineTaskIds);
      const fixTaskIds = tasks
        .map((t) => t.id)
        .filter((id) => !baseline.has(id))
        .sort((a, b) => a - b);
      if (fixTaskIds.length > 0) {
        advance(dataDir, 'fixing', { fixTaskIds });
        verdict = { verdict: 'round-review-settled', pass, phase: 'fixing', fixTasks: fixTaskIds, next };
      } else {
        advance(dataDir, 'done');
        verdict = { verdict: 'round-review-settled', pass, phase: 'done', fixTasks: [], next };
      }
    } else {
      advance(dataDir, 'done');
      verdict = { verdict: 'round-review-settled', pass, phase: 'done', fixTasks: [...rec.fixTaskIds], next };
    }
    // Only after the phase has advanced: a crash in between leaves a stale
    // snapshot, which the next pass overwrites, never a pending pass without one.
    try {
      fs.unlinkSync(roundReviewSnapshotPath(dataDir));
    } catch {
      // best-effort
    }
  }

  try {
    const reason = verdict.verdict === 'round-review-failed' ? ` (${verdict.reason})` : '';
    (deps.appendFileSync ?? fs.appendFileSync)(
      tempFilePath(dataDir, 'iterations.log'),
      `Round review ${pass}: ${verdict.verdict}${reason}\n`,
    );
  } catch {
    // best-effort
  }
  return verdict;
}
