import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { BRAND, LEGACY } from '../brand';
import {
  TEMP_IGNORE_SUFFIXES,
  GITIGNORE_CURRENT_HEADER,
  GITIGNORE_LEGACY_HEADER,
  NARRATION_HOOKS,
  installAgents,
  installSlashCommands,
  writeNarrationHooks,
} from './init';

/**
 * Convert a single project from the legacy `.ralph/` layout to `.cairn/`.
 *
 * remove once all projects migrated — this whole command exists only for the
 * compatibility window; when nothing is left on `.ralph/` it has no work to do.
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

/**
 * Bring the .gitignore *inside* the data dir up to date with the current temp
 * prefix. The file moves across with the directory unmodified, so it still lists
 * only the legacy names — every `.cairn_*` file a later run writes would show up
 * as untracked noise.
 *
 * Append-only and idempotent: existing lines (legacy ones included — they are
 * still read as a fallback) are never touched, and a name already listed is
 * never added twice. Missing file means a partial install: do nothing.
 *
 * Returns the names appended, empty when the file was already current or absent.
 */
export function refreshDataDirGitignore(dataDir: string): string[] {
  const gitignorePath = path.join(dataDir, '.gitignore');
  if (!isFile(gitignorePath)) return [];

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const listed = new Set(content.split('\n').map((l) => l.trim()));

  const missing = (prefix: string) =>
    TEMP_IGNORE_SUFFIXES.map((s) => `${prefix}${s}`).filter((name) => !listed.has(name));

  const current = missing(BRAND.tempPrefix);
  const legacy = missing(LEGACY.tempPrefix);
  if (current.length === 0 && legacy.length === 0) return [];

  // Same two-block layout `cairn init` writes: current names, then legacy ones.
  let addition = '';
  if (current.length > 0) addition += `${GITIGNORE_CURRENT_HEADER}\n${current.join('\n')}\n`;
  if (legacy.length > 0) addition += `${GITIGNORE_LEGACY_HEADER}\n${legacy.join('\n')}\n`;

  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gitignorePath, separator + addition);
  return [...current, ...legacy];
}

/**
 * Reinstall the artifacts `cairn init` puts under .claude/ and regenerate the
 * narration hooks, so a migrated project runs the current agents against the
 * current socket path.
 *
 * Strictly overwrite-by-filename: nothing is deleted, nothing outside the source
 * set is read or touched, so a project's own agents and commands survive. The
 * full set is installed even where none existed — a project that never ran
 * `init` gets them here, which is the whole point of the upgrade path.
 *
 * Hooks are the one exception: they are regenerated only where they already
 * exist. Creating them in a project that never opted in would wire up narration
 * nobody asked for.
 *
 * Returns the project-relative paths actually written; empty when everything was
 * already current.
 */
export function refreshClaudeArtifacts(cwd: string): string[] {
  const quiet = { skipUnchanged: true, log: () => {} };
  const written = [...installSlashCommands(cwd, undefined, quiet), ...installAgents(cwd, undefined, quiet)];

  const hooksDir = path.join(cwd, '.claude', 'hooks');
  if (NARRATION_HOOKS.some((h) => isFile(path.join(hooksDir, h.name)))) {
    written.push(...writeNarrationHooks(cwd, quiet));
  }
  return written;
}

/** git's --name-status letters, rendered the way `git status` words them. */
const STATUS_LABELS: Record<string, string> = {
  A: 'new file',
  M: 'modified',
  R: 'renamed',
  C: 'copied',
  D: 'deleted',
  T: 'typechange',
};

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

  /**
   * The closing summary: one `git status`-style line per thing this run staged.
   * git mv stages itself, everything else is staged explicitly — both land here,
   * so the user can see the migration's full footprint without diffing.
   */
  const stagedLines: string[] = [];
  const record = (label: string, detail: string) => {
    stagedLines.push(`  ${`${label}:`.padEnd(11)}${detail}`);
  };

  /** git mv when the path is tracked, plain rename when it is not. */
  const move = (fromAbs: string, toAbs: string): void => {
    const from = path.relative(cwd, fromAbs);
    const to = path.relative(cwd, toAbs);
    if (git(['mv', from, to], cwd).status === 0) {
      log(`  ${from} -> ${to} (staged)`);
      record('renamed', `${from} -> ${to}`);
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

  // The data dir's own .gitignore came across unmodified — teach it the current
  // temp names, or every later run leaves untracked noise behind.
  let ignoreUpdated = false;
  if (dataDir) {
    const added = refreshDataDirGitignore(dataDir);
    if (added.length > 0) {
      ignoreUpdated = true;
      const rel = path.relative(cwd, path.join(dataDir, '.gitignore'));
      // Untracked .gitignore: nothing to stage, but the edit still stands.
      const isStaged = git(['add', rel], cwd).status === 0;
      log(`  ${rel}: added ${added.length} ignore line(s) ${isStaged ? '(staged)' : '(untracked)'}`);
      if (isStaged) record('modified', rel);
    }
  }

  // Installed artifacts: current agents, commands, and hooks for the new socket.
  // Unlike the renames these are plain writes — without an explicit 'git add'
  // they sit unstaged, or untracked entirely in a project that never had them,
  // and 'git diff --cached' would understate the migration.
  const installed = refreshClaudeArtifacts(cwd);
  for (const rel of installed) {
    if (git(['add', '--', rel], cwd).status !== 0) {
      warn(`Warning: could not stage ${rel} (ignored by git?) — it is written but untracked.`);
      continue;
    }
    // Ask git how it sees the result rather than guessing new-vs-modified. Empty
    // output means the write matched HEAD exactly, so nothing was staged.
    const line = git(['diff', '--cached', '--name-status', '-M', '--', rel], cwd).stdout.trim();
    if (line === '') continue;
    record(STATUS_LABELS[line[0]!] ?? 'changed', rel);
  }

  if (moved === 0 && !ignoreUpdated && installed.length === 0) {
    log(`Already on the ${BRAND.dataDir}/ layout — nothing to do.`);
    return 0;
  }

  log('');
  if (stagedLines.length > 0) {
    log('Staged changes:');
    for (const line of stagedLines) log(line);
    log('');
  }
  if (moved === 0) {
    log(`Refreshed ${BRAND.displayName} artifacts in ${cwd}.`);
  } else {
    log(`Migrated ${cwd} to the ${BRAND.dataDir}/ layout (${moved} path(s) moved).`);
  }
  log(`Changes are STAGED, not committed. Review with 'git status' / 'git diff --cached', then commit.`);
  return 0;
}
