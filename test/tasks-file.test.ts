import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readTasksFile, TasksFileError } from '../src/tasks-file';

const VALID_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-valid.json');
const MISSING_COMMA_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-missing-comma.json');
const UNESCAPED_QUOTE_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-unescaped-quote.json');
const TRAILING_GARBAGE_FIXTURE = path.resolve(__dirname, 'fixtures/tasks-trailing-garbage.json');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ralph-test-'));
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
    fs.writeFileSync(path.join(tmpDir, '.ralph_tasks_snapshot.json'), snapshotContent);
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
    fs.writeFileSync(path.join(tmpDir, '.ralph_tasks_snapshot.json'), 'ALSO CORRUPT');
    expect(() => readTasksFile(filePath, { dataDir: tmpDir })).toThrow(TasksFileError);
    // corruption log has entries for parse, jsonrepair, and snapshot failures
    const log = readCorruptionLog();
    expect(log.length).toBeGreaterThanOrEqual(3);
    const stages = (log as any[]).map((e) => e.stage);
    expect(stages).toContain('parse');
    expect(stages).toContain('jsonrepair');
    expect(stages).toContain('snapshot');
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
