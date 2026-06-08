import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { acquireLock, sleepSync, FileLockError } from '../src/file-lock';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ralph-lock-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function release(fd: number, lockPath: string): void {
  try {
    fs.closeSync(fd);
  } catch {}
  try {
    fs.unlinkSync(lockPath);
  } catch {}
}

describe('sleepSync', () => {
  it('blocks for approximately the requested duration', () => {
    const start = Date.now();
    sleepSync(40);
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});

describe('acquireLock', () => {
  it('(1) acquires a lock (creating the lockfile), then releasing lets it be re-acquired', () => {
    const lockPath = path.join(tmpDir, 'tasks.json.lock');

    const fd = acquireLock(lockPath);
    expect(typeof fd).toBe('number');
    expect(fs.existsSync(lockPath)).toBe(true);

    release(fd, lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);

    // The lock is free again — a second acquire succeeds.
    const fd2 = acquireLock(lockPath);
    expect(typeof fd2).toBe('number');
    release(fd2, lockPath);
  });

  it('(2) a second acquire on a held (fresh) lock blocks/retries until the lock is released', async () => {
    const lockPath = path.join(tmpDir, 'tasks.json.lock');
    const sentinel = path.join(tmpDir, 'got-it');

    // Hold the lock in this process so the lockfile is fresh (not stale).
    const fd = acquireLock(lockPath);

    // Spawn a separate process that tries to acquire the same lock. Because the
    // lockfile is fresh, acquireLock there must block/retry rather than fail.
    const childScript = path.join(tmpDir, 'child.ts');
    const srcPath = path.resolve(__dirname, '../src/file-lock.ts');
    fs.writeFileSync(
      childScript,
      `import { acquireLock } from ${JSON.stringify(srcPath)};\n` +
        `import * as fs from 'fs';\n` +
        `const fd = acquireLock(process.argv[2]);\n` +
        `fs.writeFileSync(process.argv[3], 'ok');\n` +
        `fs.closeSync(fd);\n`
    );

    const child = Bun.spawn(['bun', childScript, lockPath, sentinel], {
      stdout: 'ignore',
      stderr: 'ignore',
    });

    // Give the child time to start and spin in its retry loop.
    await new Promise((r) => setTimeout(r, 400));
    // Still blocked: it has not acquired the lock, so no sentinel yet.
    expect(fs.existsSync(sentinel)).toBe(false);

    // Release the lock; the child should now acquire it and write the sentinel.
    release(fd, lockPath);

    await child.exited;
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it('(3) a stale lockfile (mtime older than the stale threshold) is broken and re-acquired', () => {
    const lockPath = path.join(tmpDir, 'tasks.json.lock');

    // Simulate an orphaned lock left by a crashed holder.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: 0 }));
    const old = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago, well past stale threshold
    fs.utimesSync(lockPath, old, old);

    // acquireLock must break the stale lock and return a fresh fd.
    const fd = acquireLock(lockPath);
    expect(typeof fd).toBe('number');
    expect(fs.existsSync(lockPath)).toBe(true);

    release(fd, lockPath);
  });

  it('(4) FileLockError is exported for callers to recognize lock failures', () => {
    expect(typeof FileLockError).toBe('function');
    const err = new FileLockError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FileLockError');
  });
});
