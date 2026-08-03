import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolvePath, findProjectRoot, findDataDir, resolveCairnRoot, tempFilePath, findTempFilePath, allTempFilePaths } from '../src/utils';
import { resetLegacyWarnings } from '../src/brand';
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

describe('findProjectRoot — dual-read data directory discovery', () => {
  let tempDir: string;
  const originalEnv = process.env.CAIRN_PROJECT_ROOT;
  let originalError: typeof console.error;

  beforeEach(() => {
    tempDir = makeTempDir('dualread');
    delete process.env.CAIRN_PROJECT_ROOT;
    resetLegacyWarnings();
    originalError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    resetLegacyWarnings();
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.CAIRN_PROJECT_ROOT = originalEnv;
    } else {
      delete process.env.CAIRN_PROJECT_ROOT;
    }
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

  it('still finds a legacy .ralph/ directory', () => {
    const nested = join(tempDir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(tempDir, '.ralph'));
    expect(findProjectRoot(nested)).toBe(tempDir);
  });

  it('returns the nearest project root, even when the nearer one is legacy', () => {
    const child = join(tempDir, 'child');
    mkdirSync(child, { recursive: true });
    mkdirSync(join(tempDir, '.cairn'));
    mkdirSync(join(child, '.ralph'));
    expect(findProjectRoot(child)).toBe(child);
  });

  it('ignores a .cairn file that is not a directory', () => {
    writeFileSync(join(tempDir, '.cairn'), 'not a dir');
    mkdirSync(join(tempDir, '.ralph'));
    expect(findProjectRoot(tempDir)).toBe(tempDir);
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.ralph'));
  });

  it('warns exactly once when falling back to the legacy data directory', () => {
    const seen: string[] = [];
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    mkdirSync(join(tempDir, '.ralph'));
    findProjectRoot(tempDir);
    findProjectRoot(tempDir);
    findDataDir(tempDir);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('.ralph');
    expect(seen[0]).toContain('.cairn');
  });

  it('does not warn when the modern data directory is used', () => {
    const seen: string[] = [];
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    mkdirSync(join(tempDir, '.cairn'));
    findProjectRoot(tempDir);
    findDataDir(tempDir);
    expect(seen.length).toBe(0);
  });
});

describe('findDataDir', () => {
  let tempDir: string;
  let originalError: typeof console.error;

  beforeEach(() => {
    tempDir = makeTempDir('datadir');
    resetLegacyWarnings();
    originalError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    resetLegacyWarnings();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves to .cairn when it exists', () => {
    mkdirSync(join(tempDir, '.cairn'));
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.cairn'));
  });

  it('resolves to the legacy .ralph when only that exists', () => {
    mkdirSync(join(tempDir, '.ralph'));
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.ralph'));
  });

  it('prefers .cairn when both exist', () => {
    mkdirSync(join(tempDir, '.cairn'));
    mkdirSync(join(tempDir, '.ralph'));
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.cairn'));
  });

  it('defaults to .cairn for a project with neither, so new data is created there', () => {
    expect(findDataDir(tempDir)).toBe(join(tempDir, '.cairn'));
  });
});

describe('runtime temp file paths', () => {
  let tempDir: string;
  let originalError: typeof console.error;

  beforeEach(() => {
    tempDir = makeTempDir('temp-prefix');
    resetLegacyWarnings();
    originalError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
    resetLegacyWarnings();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('tempFilePath (write side)', () => {
    it('always builds the current-brand path, even when a legacy file exists', () => {
      writeFileSync(join(tempDir, '.ralph_completed_ids'), '[1]');
      expect(tempFilePath(tempDir, 'completed_ids')).toBe(join(tempDir, '.cairn_completed_ids'));
    });
  });

  describe('findTempFilePath (read side)', () => {
    it('prefers an existing current-brand file', () => {
      writeFileSync(join(tempDir, '.cairn_prev_notes'), 'new');
      writeFileSync(join(tempDir, '.ralph_prev_notes'), 'old');
      expect(findTempFilePath(tempDir, 'prev_notes')).toBe(join(tempDir, '.cairn_prev_notes'));
    });

    it('falls back to an existing legacy file', () => {
      writeFileSync(join(tempDir, '.ralph_prev_notes'), 'old');
      expect(findTempFilePath(tempDir, 'prev_notes')).toBe(join(tempDir, '.ralph_prev_notes'));
    });

    it('returns the current-brand path when neither exists', () => {
      expect(findTempFilePath(tempDir, 'prev_notes')).toBe(join(tempDir, '.cairn_prev_notes'));
    });

    it('warns once when falling back to a legacy temp file', () => {
      const messages: string[] = [];
      console.error = (...args: unknown[]) => { messages.push(args.join(' ')); };
      writeFileSync(join(tempDir, '.ralph_prev_notes'), 'old');
      findTempFilePath(tempDir, 'prev_notes');
      findTempFilePath(tempDir, 'prev_notes');
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('.ralph_prev_notes');
    });
  });

  describe('allTempFilePaths (cleanup side)', () => {
    it('lists both the current-brand and legacy paths', () => {
      expect(allTempFilePaths(tempDir, 'complete')).toEqual([
        join(tempDir, '.cairn_complete'),
        join(tempDir, '.ralph_complete'),
      ]);
    });
  });
});
