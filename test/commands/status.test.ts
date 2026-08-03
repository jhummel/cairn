import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runStatus } from '../../src/commands/status';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

describe('runStatus', () => {
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('prints project name and root path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain(`Project: ${path.basename(tmpDir)}`);
      expect(output).toContain(`Root:    ${tmpDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints Not initialized when .ralph does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));

    try {
      runStatus(tmpDir, path.join(tmpDir, '.ralph'));
      const output = stdoutLines.join('\n');
      expect(output).toContain('Not initialized');
      expect(output).toContain("Run 'cairn init' first.");
      expect(output).not.toContain('ralph init');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('does not print task list when .ralph does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));

    try {
      runStatus(tmpDir, path.join(tmpDir, '.ralph'));
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('tasks.json');
      expect(output).not.toContain('Status:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints No tasks.json found when tasks.json is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('No tasks.json found');
      expect(output).toContain("Run 'cairn plan' to create one.");
      expect(output).not.toContain('ralph plan');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints No pending tasks when tasks.json is empty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-empty.json'), path.join(ralphDir, 'tasks.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('No pending tasks.');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints status counts for mixed tasks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-mixed.json'), path.join(ralphDir, 'tasks.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Status:');
      expect(output).toContain('1 blocked');
      expect(output).toContain('1 complete');
      expect(output).toContain('1 in-progress');
      expect(output).toContain('1 pending');
      expect(output).toContain('(4 total)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints task rows with correct icons', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-mixed.json'), path.join(ralphDir, 'tasks.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('✓ #1');
      expect(output).toContain('▶ #2');
      expect(output).toContain('○ #3');
      expect(output).toContain('✗ #4');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints task with priority, title', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-mixed.json'), path.join(ralphDir, 'tasks.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('[P9]');
      expect(output).toContain('Setup project');
      expect(output).toContain('[P8]');
      expect(output).toContain('Build feature');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints task directory when present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-mixed.json'), path.join(ralphDir, 'tasks.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('[src/feature]');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints task dependencies when present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-mixed.json'), path.join(ralphDir, 'tasks.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      // Task 2 depends on [1], task 4 depends on [2, 3]
      expect(output).toContain('(depends on: 1)');
      expect(output).toContain('(depends on: 2,3)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints previously completed count when tasks.completed.json exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'tasks-completed.json'), path.join(ralphDir, 'tasks.completed.json'));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Previously completed: 2 task(s)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('does not print completed count when tasks.completed.json is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('Previously completed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('does not print completed count when tasks.completed.json has no tasks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    fs.writeFileSync(path.join(ralphDir, 'tasks.completed.json'), JSON.stringify({ tasks: [] }));

    try {
      runStatus(tmpDir, ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('Previously completed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
