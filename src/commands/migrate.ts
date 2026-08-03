import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { BRAND, LEGACY } from '../brand';

/**
 * Convert a single project from the legacy `.ralph/` layout to `.cairn/`.
 *
 * Scope is deliberately narrow: the current working directory only. There is no
 * scanning, no walking upward, and no commit — every rename is staged and left
 * for the user to review. Running it twice is a no-op.
 */

/** The four temp files that carry live cross-run state and must follow the rename. */
const STATEFUL_TEMP_SUFFIXES = [
  'completed_ids',
  'prev_notes',
  'iterations.log',
  'tasks_snapshot.json',
] as const;

export interface MigrateIo {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

interface GitResult {
  status: number;
  stdout: string;
}

function git(args: string[], cwd: string): GitResult {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { status: res.status ?? 1, stdout: res.stdout ?? '' };
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Run the migration. Returns the process exit code: 0 on success (including the
 * already-migrated no-op), 1 on any refusal. Refusals happen before the first
 * rename, so a rejected run never leaves a half-migrated project behind.
 */
export function runMigrate(cwd: string, io: MigrateIo = {}): number {
  const log = io.log ?? ((m: string) => console.log(m));
  const warn = io.warn ?? ((m: string) => console.error(m));
  const fail = io.error ?? ((m: string) => console.error(m));

  const legacyDir = path.join(cwd, LEGACY.dataDir);
  const currentDir = path.join(cwd, BRAND.dataDir);
  const legacyConfig = path.join(cwd, LEGACY.configFile);
  const currentConfig = path.join(cwd, BRAND.configFile);

  const hasLegacyDir = isDir(legacyDir);
  const hasCurrentDir = isDir(currentDir);
  const hasLegacyConfig = isFile(legacyConfig);
  const hasCurrentConfig = isFile(currentConfig);

  // --- Discovery: cwd only, both layouts considered ---

  if (!hasLegacyDir && !hasCurrentDir && !hasLegacyConfig && !hasCurrentConfig) {
    fail(
      `${cwd} is not a ${BRAND.displayName} or ${LEGACY.displayName} project ` +
        `(no ${BRAND.dataDir}/, ${LEGACY.dataDir}/, ${BRAND.configFile}, or ${LEGACY.configFile} here).\n` +
        `Run '${BRAND.name} migrate' from the project root.`
    );
    return 1;
  }

  if (hasLegacyDir && hasCurrentDir) {
    fail(
      `Both ${LEGACY.dataDir}/ and ${BRAND.dataDir}/ exist in ${cwd}. ` +
        `Refusing to guess which one is live — merge them by hand, then re-run.`
    );
    return 1;
  }

  if (hasLegacyConfig && hasCurrentConfig) {
    fail(
      `Both ${LEGACY.configFile} and ${BRAND.configFile} exist in ${cwd}. ` +
        `Refusing to guess which one is live — merge them by hand, then re-run.`
    );
    return 1;
  }

  // --- Preflight: git repo ---

  if (git(['rev-parse', '--is-inside-work-tree'], cwd).status !== 0) {
    fail(
      `${cwd} is not inside a git repository. ` +
        `Migration stages its renames with 'git mv', so the project must be under git.`
    );
    return 1;
  }

  // --- Preflight: no task may be mid-flight ---

  // The data dir may not exist yet (config-only project); tolerate that.
  const dataDirBefore = hasLegacyDir ? legacyDir : hasCurrentDir ? currentDir : null;
  if (dataDirBefore) {
    const tasksPath = path.join(dataDirBefore, 'tasks.json');
    if (isFile(tasksPath)) {
      let parsed: { tasks?: Array<{ id?: number; status?: string }> };
      try {
        parsed = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
      } catch (err) {
        fail(
          `Could not parse ${tasksPath}: ${(err as Error).message}\n` +
            `Fix the file before migrating — migration must be able to verify no task is in-progress.`
        );
        return 1;
      }
      const running = (parsed.tasks ?? []).filter((t) => t.status === 'in-progress');
      if (running.length > 0) {
        const ids = running.map((t) => `#${t.id}`).join(', ');
        fail(
          `Refusing to migrate: ${running.length} task(s) are in-progress (${ids}). ` +
            `Finish or reset them first — an agent mid-task would lose its data directory underneath it.`
        );
        return 1;
      }
    }
  }

  // --- Preflight: dirty tree is a warning, not a refusal ---

  const status = git(['status', '--porcelain'], cwd);
  if (status.status === 0 && status.stdout.trim() !== '') {
    warn(
      `Warning: the git working tree is not clean. Migration will stage its renames ` +
        `on top of your existing changes — review 'git status' before committing.`
    );
  }

  // --- Moves ---

  let moved = 0;

  /** git mv when the path is tracked, plain rename when it is not. */
  const move = (fromAbs: string, toAbs: string): void => {
    const from = path.relative(cwd, fromAbs);
    const to = path.relative(cwd, toAbs);
    if (git(['mv', from, to], cwd).status === 0) {
      log(`  ${from} -> ${to} (staged)`);
    } else {
      // Untracked or gitignored: git mv refuses, but the file still has to move.
      // There is nothing to stage in that case.
      fs.renameSync(fromAbs, toAbs);
      log(`  ${from} -> ${to} (untracked — moved, nothing to stage)`);
    }
    moved++;
  };

  if (hasLegacyDir) move(legacyDir, currentDir);
  if (hasLegacyConfig) move(legacyConfig, currentConfig);

  // Stateful temp files live inside the data dir, so rename them at its new path.
  const dataDir = isDir(currentDir) ? currentDir : null;
  if (dataDir) {
    for (const suffix of STATEFUL_TEMP_SUFFIXES) {
      const from = path.join(dataDir, `${LEGACY.tempPrefix}${suffix}`);
      const to = path.join(dataDir, `${BRAND.tempPrefix}${suffix}`);
      if (!fs.existsSync(from)) continue;
      if (fs.existsSync(to)) {
        warn(
          `Warning: both ${LEGACY.tempPrefix}${suffix} and ${BRAND.tempPrefix}${suffix} ` +
            `exist in ${dataDir} — leaving both in place.`
        );
        continue;
      }
      move(from, to);
    }
  }

  if (moved === 0) {
    log(`Already on the ${BRAND.dataDir}/ layout — nothing to do.`);
    return 0;
  }

  log('');
  log(`Migrated ${cwd} to the ${BRAND.dataDir}/ layout (${moved} path(s) moved).`);
  log(`Changes are STAGED, not committed. Review with 'git status' / 'git diff --cached', then commit.`);
  return 0;
}
