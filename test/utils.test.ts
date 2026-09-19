import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolvePath, findProjectRoot, findDataDir, resolveCairnRoot, tempFilePath } from '../src/utils';
import { mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Helper to create unique temp directories
function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `cairn-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  const originalEnv = process.env.CAIRN_PROJECT_ROOT;

  beforeEach(() => {
    tempDir = makeTempDir('findroot');
    delete process.env.CAIRN_PROJECT_ROOT;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.CAIRN_PROJECT_ROOT = originalEnv;
    } else {
      delete process.env.CAIRN_PROJECT_ROOT;
    }
  });

  it('returns CAIRN_PROJECT_ROOT env var when set', () => {
    process.env.CAIRN_PROJECT_ROOT = '/some/explicit/path';
    expect(findProjectRoot(tempDir)).toBe('/some/explicit/path');
  });

  it('ignores CAIRN_PROJECT_ROOT with { ignoreEnv: true } and walks up from cwd', () => {
    process.env.CAIRN_PROJECT_ROOT = '/some/explicit/path';
    const nested = join(tempDir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(tempDir, '.cairn'));
    expect(findProjectRoot(nested, { ignoreEnv: true })).toBe(tempDir);
    // The default behavior must be untouched.
    expect(findProjectRoot(nested)).toBe('/some/explicit/path');
  });

  it('{ ignoreEnv: false } keeps the env var winning', () => {
    process.env.CAIRN_PROJECT_ROOT = '/some/explicit/path';
    mkdirSync(join(tempDir, '.cairn'));
    expect(findProjectRoot(tempDir, { ignoreEnv: false })).toBe('/some/explicit/path');
  });

  it('finds .cairn/ directory in the given cwd', () => {
    mkdirSync(join(tempDir, '.cairn'));
    expect(findProjectRoot(tempDir)).toBe(tempDir);
  });

  it('walks upward to find .cairn/ directory', () => {
    const nested = join(tempDir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(tempDir, '.cairn'));
    expect(findProjectRoot(nested)).toBe(tempDir);
  });

  it('ignores a .cairn entry that is not a directory', () => {
    const child = join(tempDir, 'child');
    mkdirSync(child, { recursive: true });
    mkdirSync(join(tempDir, '.cairn'));
    writeFileSync(join(child, '.cairn'), 'not a dir');
    expect(findProjectRoot(child)).toBe(tempDir);
  });

  it('does not treat a legacy .ralph/ directory as a project root', () => {
    const child = join(tempDir, 'child');
    mkdirSync(child, { recursive: true });
    mkdirSync(join(tempDir, '.cairn'));
    mkdirSync(join(child, '.ralph'));
    expect(findProjectRoot(child)).toBe(tempDir);
  });

  it('falls back to git root when no .cairn/ found', () => {
    // We're running inside the cairn repo, so git root should work
    // Use a directory inside our actual repo
    const result = findProjectRoot(join(process.cwd(), 'src'));
    // Should find the git root (our repo root)
    expect(existsSync(join(result, '.git'))).toBe(true);
  });

  it('falls back to cwd when nothing else matches', () => {
    // Use a temp dir with no .cairn/ and no git repo
    // We can't easily test this without being outside a git repo,
    // but we can test the priority: .cairn/ should win over git root
    mkdirSync(join(tempDir, '.cairn'));
    const nested = join(tempDir, 'deep');
    mkdirSync(nested);
    // nested has no .cairn/ itself, but parent does
    expect(findProjectRoot(nested)).toBe(tempDir);
  });

  it('stops at filesystem root without infinite loop', () => {
    // findProjectRoot on a random temp dir (no .cairn/) should not hang
    // It'll find a git root or fall back to cwd
    const result = findProjectRoot(tempDir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('resolveCairnRoot', () => {
  it('returns a directory that contains package.json', () => {
    const root = resolveCairnRoot();
    expect(existsSync(join(root, 'package.json'))).toBe(true);
  });

  it('returns a directory that contains src/utils.ts', () => {
    const root = resolveCairnRoot();
    expect(existsSync(join(root, 'src', 'utils.ts'))).toBe(true);
  });
});

describe('findDataDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('datadir');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // findDataDir composes <root>/.cairn unconditionally — it never probes the
  // filesystem — so what is or isn't on disk must not change the answer.

  it('composes <root>/.cairn when the directory already exists', () => {
    mkdirSync(join(tempDir, '.cairn'));
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.cairn'));
  });

  it('composes the same <root>/.cairn when nothing exists yet, so new data is created there', () => {
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.cairn'));
  });

  it('never composes a legacy .ralph path, even when one is present on disk', () => {
    mkdirSync(join(tempDir, '.ralph'));
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.cairn'));
  });
});

describe('tempFilePath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('temp-prefix');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds the current-brand path', () => {
    expect(tempFilePath(tempDir, 'completed_ids')).toBe(join(tempDir, '.cairn_completed_ids'));
  });

  it('builds the current-brand path even when a legacy file exists', () => {
    writeFileSync(join(tempDir, '.ralph_completed_ids'), '[1]');
    expect(tempFilePath(tempDir, 'completed_ids')).toBe(join(tempDir, '.cairn_completed_ids'));
  });
});
