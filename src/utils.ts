import { lstatSync, readlinkSync, existsSync, statSync } from 'fs';
import { resolve, dirname, basename, join, isAbsolute } from 'path';
import { execSync } from 'child_process';

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
 * Find the project root directory. Detection order:
 * 1. RALPH_PROJECT_ROOT env var
 * 2. Walk upward from cwd looking for .ralph/ directory
 * 3. Git root via `git rev-parse --show-toplevel`
 * 4. Fall back to cwd
 *
 * Port of find_project_root() from bin/ralph lines 26-52.
 */
export function findProjectRoot(cwd?: string): string {
  const startDir = cwd ?? process.cwd();

  // 1. Env var
  if (process.env.RALPH_PROJECT_ROOT) {
    return process.env.RALPH_PROJECT_ROOT;
  }

  // 2. Walk upward looking for .ralph/
  let dir = resolve(startDir);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.ralph')) && statSync(join(dir, '.ralph')).isDirectory()) {
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
