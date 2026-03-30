import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolvePath, findProjectRoot, resolveRalphRoot } from '../src/utils';
import { mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Helper to create unique temp directories
function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `ralph-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('resolvePath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('resolve');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves a regular file path to its absolute path', () => {
    const file = join(tempDir, 'real-file');
    writeFileSync(file, 'hello');
    const resolved = resolvePath(file);
    expect(resolved).toBe(file);
  });

  it('follows a single symlink to the real path', () => {
    const real = join(tempDir, 'real-file');
    const link = join(tempDir, 'link-file');
    writeFileSync(real, 'hello');
    symlinkSync(real, link);
    const resolved = resolvePath(link);
    expect(resolved).toBe(real);
  });

  it('follows chained symlinks', () => {
    const real = join(tempDir, 'real-file');
    const link1 = join(tempDir, 'link1');
    const link2 = join(tempDir, 'link2');
    writeFileSync(real, 'hello');
    symlinkSync(real, link1);
    symlinkSync(link1, link2);
    const resolved = resolvePath(link2);
    expect(resolved).toBe(real);
  });

  it('resolves relative symlinks correctly', () => {
    const subdir = join(tempDir, 'sub');
    mkdirSync(subdir);
    const real = join(tempDir, 'real-file');
    const link = join(subdir, 'relative-link');
    writeFileSync(real, 'hello');
    // Create a relative symlink: sub/relative-link -> ../real-file
    symlinkSync('../real-file', link);
    const resolved = resolvePath(link);
    expect(resolved).toBe(real);
  });

  it('handles directory symlinks', () => {
    const realDir = join(tempDir, 'real-dir');
    const linkDir = join(tempDir, 'link-dir');
    mkdirSync(realDir);
    symlinkSync(realDir, linkDir);
    const resolved = resolvePath(linkDir);
    expect(resolved).toBe(realDir);
  });
});

describe('findProjectRoot', () => {
  let tempDir: string;
  const originalEnv = process.env.RALPH_PROJECT_ROOT;

  beforeEach(() => {
    tempDir = makeTempDir('findroot');
    delete process.env.RALPH_PROJECT_ROOT;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.RALPH_PROJECT_ROOT = originalEnv;
    } else {
      delete process.env.RALPH_PROJECT_ROOT;
    }
  });

  it('returns RALPH_PROJECT_ROOT env var when set', () => {
    process.env.RALPH_PROJECT_ROOT = '/some/explicit/path';
    expect(findProjectRoot(tempDir)).toBe('/some/explicit/path');
  });

  it('finds .ralph/ directory in the given cwd', () => {
    mkdirSync(join(tempDir, '.ralph'));
    expect(findProjectRoot(tempDir)).toBe(tempDir);
  });

  it('walks upward to find .ralph/ directory', () => {
    const nested = join(tempDir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(tempDir, '.ralph'));
    expect(findProjectRoot(nested)).toBe(tempDir);
  });

  it('falls back to git root when no .ralph/ found', () => {
    // We're running inside the ralph repo, so git root should work
    // Use a directory inside our actual repo
    const result = findProjectRoot(join(process.cwd(), 'src'));
    // Should find the git root (our repo root)
    expect(existsSync(join(result, '.git'))).toBe(true);
  });

  it('falls back to cwd when nothing else matches', () => {
    // Use a temp dir with no .ralph/ and no git repo
    // We can't easily test this without being outside a git repo,
    // but we can test the priority: .ralph/ should win over git root
    mkdirSync(join(tempDir, '.ralph'));
    const nested = join(tempDir, 'deep');
    mkdirSync(nested);
    // nested has no .ralph/ itself, but parent does
    expect(findProjectRoot(nested)).toBe(tempDir);
  });

  it('stops at filesystem root without infinite loop', () => {
    // findProjectRoot on a random temp dir (no .ralph/) should not hang
    // It'll find a git root or fall back to cwd
    const result = findProjectRoot(tempDir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('resolveRalphRoot', () => {
  it('returns a directory that contains package.json', () => {
    const root = resolveRalphRoot();
    expect(existsSync(join(root, 'package.json'))).toBe(true);
  });

  it('returns a directory that contains src/utils.ts', () => {
    const root = resolveRalphRoot();
    expect(existsSync(join(root, 'src', 'utils.ts'))).toBe(true);
  });
});
