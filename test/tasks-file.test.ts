import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readTasksFile, writeTasksFile, mutateTasksFile, TasksFileError } from '../src/tasks-file';

const VALID_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-valid.json');
const MISSING_COMMA_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-missing-comma.json');
const UNESCAPED_QUOTE_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-unescaped-quote.json');
const TRAILING_GARBAGE_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-trailing-garbage.json');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cairn-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function copyFixture(fixturePath: string, name = 'tasks.json'): string {
  const dest = path.join(tmpDir, name);
  fs.copyFileSync(fixturePath, dest);
  return dest;
}

function readCorruptionLog(): string[] {
  const logPath = path.join(tmpDir, 'corruption.log');
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('readTasksFile', () => {
  it('(1) valid tasks.json round-trips untouched', () => {
    const filePath = copyFixture(VALID_FIXTURE);
    const result = readTasksFile(filePath, { dataDir: tmpDir });
    expect(result.repaired).toBe(false);
    expect(result.restored).toBe(false);
    expect(result.data.project).toBe('test-project');
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0].id).toBe(1);
    // No corruption log entry for a clean read
    const log = readCorruptionLog();
    expect(log).toHaveLength(0);
  });

  it('(2) missing-comma JSON is repaired via jsonrepair', () => {
    const filePath = copyFixture(MISSING_COMMA_FIXTURE);
    const result = readTasksFile(filePath, { dataDir: tmpDir });
    expect(result.repaired).toBe(true);
    expect(result.restored).toBe(false);
    expect(result.data.tasks).toBeDefined();
    expect(result.data.tasks[0].id).toBe(1);
    // corruption.log must have a repair entry
    const log = readCorruptionLog();
    expect(log).toHaveLength(1);
    const entry = log[0] as any;
    expect(entry.stage).toBe('parse');
    expect(typeof entry.ts).toBe('string');
    expect(new Date(entry.ts).toString()).not.toBe('Invalid Date');
    expect(typeof entry.error).toBe('string');
    expect(typeof entry.sha256).toBe('string');
    expect(entry.sha256).toHaveLength(64);
    expect(typeof entry.preview).toBe('string');
    expect(entry.preview.length).toBeLessThanOrEqual(500);
  });

  it('(3) unescaped-quote JSON is repaired', () => {
    const filePath = copyFixture(UNESCAPED_QUOTE_FIXTURE);
    const result = readTasksFile(filePath, { dataDir: tmpDir });
    expect(result.repaired).toBe(true);
    expect(result.restored).toBe(false);
    const log = readCorruptionLog();
    expect(log).toHaveLength(1);
    expect((log[0] as any).stage).toBe('parse');
  });

  it('(4) trailing-garbage JSON is repaired', () => {
    const filePath = copyFixture(TRAILING_GARBAGE_FIXTURE);
    const result = readTasksFile(filePath, { dataDir: tmpDir });
    expect(result.repaired).toBe(true);
    expect(result.restored).toBe(false);
    expect(result.data.tasks[0].id).toBe(1);
    const log = readCorruptionLog();
    expect(log).toHaveLength(1);
    expect((log[0] as any).stage).toBe('parse');
  });

  it('(5) empty file triggers the error path', () => {
    const filePath = path.join(tmpDir, 'tasks.json');
    fs.writeFileSync(filePath, '');
    expect(() => readTasksFile(filePath, { dataDir: tmpDir })).toThrow(TasksFileError);
    // corruption log must have an entry
    const log = readCorruptionLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
  });

  it('(6) missing file triggers the error path', () => {
    const filePath = path.join(tmpDir, 'nonexistent.json');
    expect(() => readTasksFile(filePath, { dataDir: tmpDir })).toThrow(TasksFileError);
  });

  it('(7) snapshot-present-and-valid recovers (restored:true, data from snapshot)', () => {
    // Write a truly corrupt tasks.json
    const filePath = path.join(tmpDir, 'tasks.json');
    fs.writeFileSync(filePath, 'THIS IS NOT JSON AT ALL !!!');
    // Write a valid snapshot
    const snapshotContent = JSON.stringify({
      project: 'restored-project',
      tasks: [{ id: 99, priority: 1, title: 'Snapshot task', status: 'pending' }],
    });
    fs.writeFileSync(path.join(tmpDir, '.cairn_tasks_snapshot.json'), snapshotContent);
    const result = readTasksFile(filePath, { dataDir: tmpDir });
    expect(result.restored).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.data.project).toBe('restored-project');
    expect(result.data.tasks[0].id).toBe(99);
    // corruption log must have at least 2 entries: parse failure + jsonrepair failure
    const log = readCorruptionLog();
    expect(log.length).toBeGreaterThanOrEqual(2);
    const stages = (log as any[]).map((e) => e.stage);
    expect(stages).toContain('parse');
    expect(stages).toContain('jsonrepair');
  });

  it('(8) snapshot-present-and-also-corrupted throws TasksFileError', () => {
    const filePath = path.join(tmpDir, 'tasks.json');
    fs.writeFileSync(filePath, 'CORRUPT');
    fs.writeFileSync(path.join(tmpDir, '.cairn_tasks_snapshot.json'), 'ALSO CORRUPT');
    expect(() => readTasksFile(filePath, { dataDir: tmpDir })).toThrow(TasksFileError);
    // corruption log has entries for parse, jsonrepair, and snapshot failures
    const log = readCorruptionLog();
    expect(log.length).toBeGreaterThanOrEqual(3);
    const stages = (log as any[]).map((e) => e.stage);
    expect(stages).toContain('parse');
    expect(stages).toContain('jsonrepair');
    expect(stages).toContain('snapshot');
  });

  describe('mutateTasksFile', () => {
    it('(m-a) writes tempfile BEFORE rename, then renames on success', () => {
      const filePath = copyFixture(VALID_FIXTURE);
      // The staging path is now per-process unique (`${filePath}.tmp.<pid>.<rand>`),
      // so match by prefix rather than an exact shared name.
      const tmpPrefix = `${filePath}.tmp`;
      const order: string[] = [];

      const origWrite = fs.writeFileSync.bind(fs);
      const origRename = fs.renameSync.bind(fs);

      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(
        ((p: any, c: any, o?: any) => {
          if (String(p).startsWith(tmpPrefix)) order.push('write');
          return origWrite(p, c, o);
        }) as typeof fs.writeFileSync
      );
      const renameSpy = spyOn(fs, 'renameSync').mockImplementation(
        ((from: any, to: any) => {
          if (String(from).startsWith(tmpPrefix)) order.push('rename');
          return origRename(from, to);
        }) as typeof fs.renameSync
      );

      try {
        mutateTasksFile(filePath, (data) => {
          data.tasks[0].title = 'mutated';
        });

        expect(order).toEqual(['write', 'rename']);
        expect(writeSpy).toHaveBeenCalled();
        expect(renameSpy).toHaveBeenCalled();

        const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(result.tasks[0].title).toBe('mutated');
      } finally {
        writeSpy.mockRestore();
        renameSpy.mockRestore();
      }
    });

    it('(m-b) rename produces the final file on successful fn return-value style', () => {
      const filePath = copyFixture(VALID_FIXTURE);

      mutateTasksFile(filePath, (data) => {
        return {
          project: data.project,
          tasks: [...data.tasks, { id: 2, priority: 2, title: 'added', status: 'pending' } as any],
        };
      });

      const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[1].id).toBe(2);
      expect(result.tasks[1].title).toBe('added');
      // No staging or lock files left behind.
      const leftovers = fs
        .readdirSync(tmpDir)
        .filter((f) => f.includes('tasks.json.tmp') || f === 'tasks.json.lock');
      expect(leftovers).toEqual([]);
    });

    it('(m-c) when fn throws, tasks.json is left untouched and the lock is released', () => {
      const filePath = copyFixture(VALID_FIXTURE);
      const originalBytes = fs.readFileSync(filePath);

      const unlinkSpy = spyOn(fs, 'unlinkSync');

      try {
        expect(() =>
          mutateTasksFile(filePath, () => {
            throw new Error('boom from fn');
          })
        ).toThrow('boom from fn');

        // The lockfile must be released (unlinked) even when fn throws.
        const lockUnlinks = unlinkSpy.mock.calls.filter(
          (c) => String(c[0]) === `${filePath}.lock`
        );
        expect(lockUnlinks.length).toBeGreaterThanOrEqual(1);

        // Original tasks.json is byte-for-byte untouched (no staging write happened).
        const afterBytes = fs.readFileSync(filePath);
        expect(afterBytes.equals(originalBytes)).toBe(true);

        // No staging or lock files left on disk.
        const leftovers = fs
          .readdirSync(tmpDir)
          .filter((f) => f.includes('tasks.json.tmp') || f === 'tasks.json.lock');
        expect(leftovers).toEqual([]);
      } finally {
        unlinkSpy.mockRestore();
      }
    });

    it('(m-d) preserves unknown/extra fields on task objects across the round-trip', () => {
      const filePath = path.join(tmpDir, 'tasks.json');
      const initial = {
        project: 'extra-fields-test',
        tasks: [
          {
            id: 1,
            priority: 1,
            title: 'has extras',
            status: 'pending',
            customField: 'survives',
            nested: { deeply: { value: 42 } },
            arrayField: [1, 2, 3],
          },
        ],
        topLevelExtra: 'also-survives',
      };
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));

      mutateTasksFile(filePath, (data) => {
        data.tasks[0].title = 'title changed';
      });

      const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(after.tasks[0].title).toBe('title changed');
      expect(after.tasks[0].customField).toBe('survives');
      expect(after.tasks[0].nested.deeply.value).toBe(42);
      expect(after.tasks[0].arrayField).toEqual([1, 2, 3]);
      expect(after.topLevelExtra).toBe('also-survives');
    });

    it('(m-e) writes a snapshot when opts.dataDir is provided', () => {
      const filePath = copyFixture(VALID_FIXTURE);
      const snapPath = path.join(tmpDir, '.cairn_tasks_snapshot.json');
      expect(fs.existsSync(snapPath)).toBe(false);

      mutateTasksFile(
        filePath,
        (data) => {
          data.tasks[0].title = 'snap-me';
        },
        { dataDir: tmpDir }
      );

      expect(fs.existsSync(snapPath)).toBe(true);
      const snapped = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
      expect(snapped.tasks[0].title).toBe('snap-me');
    });

    it('(m-e2) does NOT write a snapshot when opts.dataDir is absent', () => {
      const filePath = copyFixture(VALID_FIXTURE);

      mutateTasksFile(filePath, (data) => {
        data.tasks[0].title = 'no-snap';
      });

      // No snapshot file anywhere in tmpDir
      expect(fs.existsSync(path.join(tmpDir, '.cairn_tasks_snapshot.json'))).toBe(false);
    });

    it('(m-f) supports in-place mutation (fn returns void)', () => {
      const filePath = copyFixture(VALID_FIXTURE);
      mutateTasksFile(filePath, (data) => {
        data.tasks[0].title = 'in-place';
        // no return
      });
      const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(after.tasks[0].title).toBe('in-place');
    });

    it('(m-g) concurrent cross-process writers lose no updates and never corrupt JSON', async () => {
      const N_WORKERS = 5;
      const N_ITERS = 30;

      const filePath = path.join(tmpDir, 'tasks.json');
      const initial = {
        project: 'concurrent',
        tasks: Array.from({ length: N_WORKERS }, (_, i) => ({
          id: i,
          priority: 1,
          title: `t${i}`,
          status: 'pending',
          counter: 0,
        })),
      };
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));

      // Each worker increments ONLY its own task's counter N_ITERS times.
      // Without a cross-process lock (and with a shared tmp path), concurrent
      // read->modify->write cycles clobber each other => lost updates / corruption.
      const srcPath = path.resolve(__dirname, '../src/tasks-file.ts');
      const workerPath = path.join(tmpDir, 'worker.ts');
      fs.writeFileSync(
        workerPath,
        `import { mutateTasksFile } from ${JSON.stringify(srcPath)};
const [filePath, idxStr, itersStr] = process.argv.slice(2);
const idx = Number(idxStr);
const iters = Number(itersStr);
for (let k = 0; k < iters; k++) {
  mutateTasksFile(filePath, (data) => {
    data.tasks[idx].counter = (data.tasks[idx].counter ?? 0) + 1;
  });
}
`
      );

      const procs = Array.from({ length: N_WORKERS }, (_, i) =>
        Bun.spawn(['bun', 'run', workerPath, filePath, String(i), String(N_ITERS)], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
      );
      const codes = await Promise.all(procs.map((p) => p.exited));
      expect(codes.every((c) => c === 0)).toBe(true);

      // File must still be valid JSON (no corruption).
      const raw = fs.readFileSync(filePath, 'utf-8');
      const after = JSON.parse(raw);
      expect(after.tasks).toHaveLength(N_WORKERS);

      // No lost updates: every counter reached N_ITERS.
      for (let i = 0; i < N_WORKERS; i++) {
        expect(after.tasks[i].counter).toBe(N_ITERS);
      }

      // No stray tmp/lock files left behind.
      const leftovers = fs
        .readdirSync(tmpDir)
        .filter((f) => f.includes('tasks.json.tmp') || f === 'tasks.json.lock');
      expect(leftovers).toEqual([]);
    });
  });

  describe('corruption.log entry structure', () => {
    it('sha256 matches bytes of the corrupted content', () => {
      const filePath = copyFixture(MISSING_COMMA_FIXTURE);
      readTasksFile(filePath, { dataDir: tmpDir });
      const log = readCorruptionLog();
      const entry = log[0] as any;
      const rawBytes = fs.readFileSync(MISSING_COMMA_FIXTURE);
      const expected = crypto.createHash('sha256').update(rawBytes).digest('hex');
      expect(entry.sha256).toBe(expected);
    });

    it('preview is first 500 bytes of corrupted content as utf-8', () => {
      const filePath = copyFixture(MISSING_COMMA_FIXTURE);
      readTasksFile(filePath, { dataDir: tmpDir });
      const log = readCorruptionLog();
      const entry = log[0] as any;
      const rawBytes = fs.readFileSync(MISSING_COMMA_FIXTURE);
      const expected = rawBytes.slice(0, 500).toString('utf-8');
      expect(entry.preview).toBe(expected);
    });
  });
});
