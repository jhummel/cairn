import { lstatSync, readlinkSync, existsSync, statSync } from 'fs';
import { resolve, dirname, basename, join, isAbsolute } from 'path';
import { execSync } from 'child_process';
import { BRAND } from './brand';

/**
 * Resolve symlinks to find the real path of a file or directory.
 * Port of resolve_path() from the original shell implementation.
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
 * Resolve the data directory for a project root.
 *
 * Always use this (never BRAND.dataDir directly) when building a path to data
 * that is expected to already exist, so every caller agrees on one location.
 */
export function findDataDir(projectRoot: string): string {
  return join(projectRoot, BRAND.dataDir);
}

// ── Runtime temp files ────────────────────────────────────────────────────────
//
// Inside the data directory there is a SECOND naming tier: runtime temp files
// prefixed `.cairn_`. The prefix is independent of the directory name.
//
// Several of these carry live cross-run state (completed IDs, prev notes, the
// tasks snapshot, the iteration log).

/**
 * Path for a runtime temp file. `suffix` is the name minus the prefix,
 * e.g. `'completed_ids'`.
 */
export function tempFilePath(dataDir: string, suffix: string): string {
  return join(dataDir, `${BRAND.tempPrefix}${suffix}`);
}

/**
 * Find the project root directory. Detection order:
 * 1. CAIRN_PROJECT_ROOT env var
 * 2. Walk upward from cwd looking for a .cairn/ directory
 * 3. Git root via `git rev-parse --show-toplevel`
 * 4. Fall back to cwd
 *
 * Port of find_project_root() from the original shell implementation.
 */
export function findProjectRoot(cwd?: string): string {
  const startDir = cwd ?? process.cwd();

  // 1. Env var
  if (process.env.CAIRN_PROJECT_ROOT) {
    return process.env.CAIRN_PROJECT_ROOT;
  }

  // 2. Walk upward looking for a data directory, so the *nearest* project wins.
  let dir = resolve(startDir);
  while (dir !== dirname(dir)) {
    try {
      if (statSync(join(dir, BRAND.dataDir)).isDirectory()) return dir;
    } catch {
      // Not present (or not readable) — keep walking.
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
 * Find the cairn repo root from the running script/binary.
 *
 * In dev mode (bun run src/index.ts): use import.meta to locate src/ → repo root.
 * In compiled binary: follow symlink back to repo.
 *
 * Falls back to walking up from this file's directory looking for package.json.
 */
export function resolveCairnRoot(): string {
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
    // Binary could be at dist/cairn or bin/cairn, so check parent
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

  throw new Error('Could not determine cairn repo root');
}
