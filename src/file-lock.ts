import * as fs from 'fs';

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

const LOCK_RETRY_MS = 15;
const LOCK_MAX_WAIT_MS = 15000;
const LOCK_STALE_MS = 60000;

/** Block the current thread for `ms` without spinning the CPU. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire a cross-process advisory lock via an O_EXCL lockfile, with bounded
 * retry/backoff. A lock older than LOCK_STALE_MS is treated as orphaned (the
 * holder crashed) and broken so the file can never deadlock permanently.
 * Returns the open fd; the caller must close it and unlink `lockPath`.
 */
export function acquireLock(lockPath: string): number {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  for (;;) {
    try {
      // 'wx' => O_CREAT | O_EXCL | O_WRONLY: fails if the lockfile exists.
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      } catch {
        // Lock metadata is best-effort; holding the fd is what matters.
      }
      return fd;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // Break a stale lock left by a crashed holder.
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Lock vanished between open and stat; retry immediately.
        continue;
      }

      if (Date.now() >= deadline) {
        throw new FileLockError(
          `Could not acquire tasks-file lock at ${lockPath} within ${LOCK_MAX_WAIT_MS}ms; ` +
            `another writer may be stuck. Remove the lockfile if no other ralph process is running.`
        );
      }
      sleepSync(LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS));
    }
  }
}
