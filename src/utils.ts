import { lstatSync, readlinkSync, existsSync, statSync } from 'fs';
import { resolve, dirname, basename, join, isAbsolute } from 'path';
import { execSync } from 'child_process';
import { BRAND, LEGACY, warnLegacyOnce } from './brand';

/**
 * Resolve symlinks to find the real path of a file or directory.
 * Port of resolve_path() from bin/ralph lines 7-16.
 */
export function resolvePath(target: string): string {
  let current = resolve(target);
  while (true) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return current;
    }
    if (!stat.isSymbolicLink()) break;
    const linkTarget = readlinkSync(current);
    if (isAbsolute(linkTarget)) {
      current = linkTarget;
    } else {
      current = resolve(dirname(current), linkTarget);
    }
  }
  return current;
}

/**
 * Name of the data directory present in `dir`, preferring the current brand
 * over the legacy one. Returns null when neither exists.
 */
function dataDirNameAt(dir: string): string | null {
  for (const name of [BRAND.dataDir, LEGACY.dataDir]) {
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isDirectory()) return name;
    } catch {
      // Not present (or not readable) — try the next candidate.
    }
  }
  return null;
}

function warnIfLegacyDataDir(name: string, dir: string): void {
  if (name !== LEGACY.dataDir) return;
  warnLegacyOnce(
    'data-dir',
    `Using legacy ${LEGACY.dataDir}/ data directory at ${dir}. ` +
      `${BRAND.displayName} now creates ${BRAND.dataDir}/; ` +
      `${LEGACY.dataDir}/ is still read but support will be removed in a future release.`
  );
}

/**
 * Resolve the data directory for a project root.
 *
 * Prefers an existing .cairn/, falls back to an existing legacy .ralph/, and
 * defaults to .cairn/ when neither exists so that new data is created under the
 * current brand. Always use this (never BRAND.dataDir) when building a path to
 * data that is expected to already exist.
 */
export function findDataDir(projectRoot: string): string {
  const name = dataDirNameAt(projectRoot);
  if (name) {
    warnIfLegacyDataDir(name, projectRoot);
    return join(projectRoot, name);
  }
  return join(projectRoot, BRAND.dataDir);
}

// ── Runtime temp files ────────────────────────────────────────────────────────
//
// Inside the data directory there is a SECOND naming tier: runtime temp files
// prefixed `.cairn_` (legacy `.ralph_`). The prefix is independent of the
// directory name — a project can be on `.cairn/` and still hold `.ralph_`-
// prefixed temp files, and vice versa.
//
// Several of these carry live cross-run state (completed IDs, prev notes, the
// tasks snapshot, the iteration log), so the same standing rule applies as for
// the data dir itself: build WRITE paths with `tempFilePath`, resolve READ
// paths with `findTempFilePath`. Writing `.cairn_` without a read fallback
// would silently discard whatever the legacy file was holding.

/**
 * Path for CREATING a runtime temp file — always the current brand's prefix.
 * `suffix` is the name minus the prefix, e.g. `'completed_ids'`.
 */
export function tempFilePath(dataDir: string, suffix: string): string {
  return join(dataDir, `${BRAND.tempPrefix}${suffix}`);
}

/**
 * Every path a given temp file could live at, current brand first. Use when a
 * caller needs to test or remove all candidates (existence checks behind an
 * injected `existsSync`, cleanup sweeps) rather than resolve a single path.
 */
export function allTempFilePaths(dataDir: string, suffix: string): string[] {
  return [
    join(dataDir, `${BRAND.tempPrefix}${suffix}`),
    join(dataDir, `${LEGACY.tempPrefix}${suffix}`),
  ];
}

/**
 * Path for READING a runtime temp file: an existing `.cairn_`-prefixed file,
 * else an existing legacy `.ralph_`-prefixed one, else the current-brand path
 * (so a missing-file caller reports the name it would create).
 */
export function findTempFilePath(dataDir: string, suffix: string): string {
  const [current, legacy] = allTempFilePaths(dataDir, suffix);
  if (existsSync(current)) return current;
  if (existsSync(legacy)) {
    warnLegacyOnce(
      `temp-file:${suffix}`,
      `Reading legacy ${LEGACY.tempPrefix}${suffix} in ${dataDir}. ` +
        `${BRAND.displayName} now writes ${BRAND.tempPrefix}${suffix}; ` +
        `the legacy name is still read but support will be removed in a future release.`
    );
    return legacy;
  }
  return current;
}

/**
 * Find the project root directory. Detection order:
 * 1. CAIRN_PROJECT_ROOT env var
 * 2. Walk upward from cwd looking for a .cairn/ (or legacy .ralph/) directory
 * 3. Git root via `git rev-parse --show-toplevel`
 * 4. Fall back to cwd
 *
 * Port of find_project_root() from bin/ralph lines 26-52.
 */
export function findProjectRoot(cwd?: string): string {
  const startDir = cwd ?? process.cwd();

  // 1. Env var
  if (process.env.CAIRN_PROJECT_ROOT) {
    return process.env.CAIRN_PROJECT_ROOT;
  }

  // 2. Walk upward looking for a data directory. Both names are checked at
  // every level so the *nearest* project wins, whichever layout it uses.
  let dir = resolve(startDir);
  while (dir !== dirname(dir)) {
    const name = dataDirNameAt(dir);
    if (name) {
      warnIfLegacyDataDir(name, dir);
      return dir;
    }
    dir = dirname(dir);
  }

  // 3. Git root
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: startDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (gitRoot) return gitRoot;
  } catch {
    // Not a git repo
  }

  // 4. CWD
  return startDir;
}

/**
 * Find the ralph repo root from the running script/binary.
 *
 * In dev mode (bun run src/index.ts): use import.meta to locate src/ → repo root.
 * In compiled binary: follow symlink back to repo.
 *
 * Falls back to walking up from this file's directory looking for package.json.
 */
export function resolveRalphRoot(): string {
  // In dev/bun mode, __dirname or import.meta.dir points into src/
  // This file is src/utils.ts, so repo root is one level up
  const thisDir = __dirname;
  const candidate = resolve(thisDir, '..');
  if (existsSync(join(candidate, 'package.json'))) {
    return candidate;
  }

  // Compiled binary mode: try to resolve the binary path back to the repo
  const binPath = process.argv[0];
  if (binPath) {
    const resolvedBin = resolvePath(binPath);
    // Binary could be at dist/ralph or bin/ralph, so check parent
    let dir = dirname(resolvedBin);
    for (let i = 0; i < 3; i++) {
      if (existsSync(join(dir, 'package.json'))) {
        return dir;
      }
      dir = dirname(dir);
    }
  }

  // Last resort: walk up from this file
  let dir = thisDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }

  throw new Error('Could not determine ralph repo root');
}
