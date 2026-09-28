import * as fs from 'fs';
import * as path from 'path';
import { tempFilePath } from './utils';
import { BRAND, NOTES_TEMP_PREFIX } from './brand';

/**
 * Round-scoped temp-file cleanup, shared by `cairn run`'s loop-exit sweep
 * (src/commands/run.ts) and `cairn round next`'s round-done branch
 * (src/commands/round.ts). Do not duplicate this regex/list elsewhere —
 * either caller widening its own copy without the other is exactly how the
 * two paths drifted before this module existed.
 *
 * Sweep ONLY at round end, never per-task: a task's `_tests.log` is named in
 * the reviewer's prompt and `_prompt.md` is re-read verbatim on a `retry`
 * relaunch, so removing either mid-round breaks the settle/retry/review
 * cycle.
 *
 * One exception survives even round end: a BLOCKED task's `_tests.log` is
 * kept, because it is the only full diagnostic for the block (the task's note
 * carries just a short failure summary). Only the log is kept — the blocked
 * task's prompt, review-prompt and notes scratch are still swept. Blocked
 * status comes from a plain read of `<dataDir>/tasks.json` (never
 * readTasksFile, which can repair/restore/write); if that read fails for any
 * reason, status is unknown and EVERY `_tests.log` is kept. A kept log goes at
 * the first round end after its task stops being blocked, or is overwritten by
 * validation if the task re-runs first.
 */

export interface SweepRoundTempFilesDeps {
  existsSync: (p: string) => boolean;
  unlinkSync: (p: string) => void;
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: 'utf-8') => string;
}

export function defaultSweepDeps(): SweepRoundTempFilesDeps {
  return {
    existsSync: fs.existsSync,
    unlinkSync: fs.unlinkSync,
    readdirSync: fs.readdirSync as (p: string) => string[],
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
  };
}

// Suffixes (prefix-less) of the run-scoped temp files removed at round end.
const TEMP_FILE_SUFFIXES = ['complete', 'prev_notes', 'completed_ids'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `.ralph_task_<id>_notes.md` or `.cairn_task_<id>_notes.md`, nothing else.
 *
 * NOTES_TEMP_PREFIX is the one the prompt actually hands out and is permanent,
 * so that branch is load-bearing — drop it and every iteration's scratch leaks.
 * BRAND.tempPrefix stays in the alternation defensively: an agent that spells
 * the file with the current prefix instead must not leave scratch behind.
 */
export const NOTES_TEMPFILE_RE = new RegExp(
  `^(?:${[NOTES_TEMP_PREFIX, BRAND.tempPrefix].map(escapeRegExp).join('|')})task_\\d+_notes\\.md$`
);

/**
 * `<tempPrefix>task_<id>_prompt.md`, `<tempPrefix>task_<id>_review_prompt.md`
 * and `<tempPrefix>task_<id>_tests.log` — never written with the legacy
 * NOTES_TEMP_PREFIX, so unlike NOTES_TEMPFILE_RE this has no alternation.
 */
export const TASK_SCOPED_TEMPFILE_RE = new RegExp(
  `^${escapeRegExp(BRAND.tempPrefix)}task_\\d+_(?:prompt\\.md|review_prompt\\.md|tests\\.log)$`
);

const TESTS_LOG_RE = new RegExp(`^${escapeRegExp(BRAND.tempPrefix)}task_(\\d+)_tests\\.log$`);

/**
 * Ids of the tasks whose `_tests.log` must survive the sweep: those with
 * status 'blocked' in tasks.json, or `'all'` when tasks.json is missing,
 * unreadable, unparseable or the wrong shape (status unknown => keep
 * diagnostics). Never throws.
 */
function blockedTaskIds(dataDir: string, deps: SweepRoundTempFilesDeps): Set<number> | 'all' {
  try {
    const parsed: unknown = JSON.parse(deps.readFileSync(path.join(dataDir, 'tasks.json'), 'utf-8'));
    const tasks = (parsed as { tasks?: unknown } | null)?.tasks;
    if (!Array.isArray(tasks)) return 'all';
    const ids = new Set<number>();
    for (const t of tasks) {
      if (t && typeof t === 'object' && (t as { status?: unknown }).status === 'blocked') {
        const id = (t as { id?: unknown }).id;
        if (typeof id === 'number') ids.add(id);
      }
    }
    return ids;
  } catch {
    return 'all';
  }
}

/**
 * Remove the run-scoped temp files a round leaves behind: the flat
 * `.cairn_complete` / `.cairn_prev_notes` / `.cairn_completed_ids` files, plus
 * every per-task `..._notes.md`, `..._prompt.md`, `..._review_prompt.md` and
 * `..._tests.log` scratch file in `dataDir` — except the `_tests.log` of a task
 * that tasks.json marks 'blocked' (every `_tests.log` when tasks.json can't be
 * read or parsed; see the module docblock). Best-effort throughout — a
 * failed unlink (or an unreadable dataDir) is swallowed, never thrown, so a
 * sweep failure can never change a caller's verdict or exit code.
 *
 * Deliberately narrow: only names matching `task_\d+_...` are touched, so
 * `.cairn_run_state.json(.lock)`, `.cairn_iterations.log`,
 * `.cairn_tasks_snapshot.json`, `.cairn_hook_errors.log`, `.gitignore`,
 * `state.json`, `tasks.json`, `tasks.completed.json`, `planning-notes.md` and
 * `reviews/` are never candidates.
 */
export function sweepRoundTempFiles(dataDir: string, deps: SweepRoundTempFilesDeps = defaultSweepDeps()): void {
  for (const suffix of TEMP_FILE_SUFFIXES) {
    const filePath = tempFilePath(dataDir, suffix);
    if (deps.existsSync(filePath)) {
      try {
        deps.unlinkSync(filePath);
      } catch {
        // best-effort
      }
    }
  }

  try {
    const entries = deps.readdirSync(dataDir);
    let keepLogs: Set<number> | 'all' | undefined;
    for (const name of entries) {
      if (NOTES_TEMPFILE_RE.test(name) || TASK_SCOPED_TEMPFILE_RE.test(name)) {
        const logMatch = TESTS_LOG_RE.exec(name);
        if (logMatch) {
          keepLogs ??= blockedTaskIds(dataDir, deps);
          if (keepLogs === 'all' || keepLogs.has(Number(logMatch[1]))) continue;
        }
        try {
          deps.unlinkSync(path.join(dataDir, name));
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // dataDir may be gone — best-effort
  }
}
