import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  formatBanner,
  formatPlanningNotesStatus,
  formatCompletedCount,
  formatTasksSummary,
  displayPreflight,
} from '../../src/commands/plan';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

// Helper to create a temp dir with optional .ralph subdir
function makeTempDir(withRalphDir = false): { tmpDir: string; ralphDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-plan-test-'));
  const ralphDir = path.join(tmpDir, '.ralph');
  if (withRalphDir) fs.mkdirSync(ralphDir);
  return { tmpDir, ralphDir };
}

describe('formatBanner', () => {
  test('includes project name', () => {
    const result = formatBanner('my-project');
    expect(result).toContain('my-project');
  });

  test('wraps with newlines', () => {
    const result = formatBanner('my-project');
    expect(result).toMatch(/^\n/);
    expect(result).toMatch(/\n$/);
  });

  test('formats as expected', () => {
    expect(formatBanner('my-project')).toBe('\n  Project: my-project\n');
  });
});

describe('formatPlanningNotesStatus', () => {
  test('reports not found when file missing', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      const result = formatPlanningNotesStatus(ralphDir);
      expect(result).toContain('not found');
      expect(result).toContain('planning-notes.md');
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });

  test('reports found when file exists', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'planning-notes.md'), '# Notes');
      const result = formatPlanningNotesStatus(ralphDir);
      expect(result).toContain('found');
      expect(result).toContain(ralphDir);
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });

  test('includes full path to planning notes', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      const notesPath = path.join(ralphDir, 'planning-notes.md');
      const result = formatPlanningNotesStatus(ralphDir);
      expect(result).toContain(notesPath);
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });
});

describe('formatCompletedCount', () => {
  test('returns null when file missing', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      expect(formatCompletedCount(ralphDir)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });

  test('returns null when tasks array is empty', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(
        path.join(ralphDir, 'tasks.completed.json'),
        JSON.stringify({ tasks: [] })
      );
      expect(formatCompletedCount(ralphDir)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });

  test('returns count string when tasks exist', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      fs.copyFileSync(
        path.join(FIXTURES_DIR, 'tasks-completed.json'),
        path.join(ralphDir, 'tasks.completed.json')
      );
      const result = formatCompletedCount(ralphDir);
      expect(result).not.toBeNull();
      expect(result).toContain('Previously completed:');
      expect(result).toContain('task(s)');
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });

  test('returns null on malformed JSON', () => {
    const { ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'tasks.completed.json'), 'not json');
      expect(formatCompletedCount(ralphDir)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(ralphDir), { recursive: true });
    }
  });
});

describe('formatTasksSummary', () => {
  test('returns no pending tasks message for empty array', () => {
    expect(formatTasksSummary([])).toBe('  No pending tasks.');
  });

  test('includes status counts', () => {
    const tasks = [
      { id: 1, priority: 1, title: 'Task A', status: 'pending' as const },
      { id: 2, priority: 2, title: 'Task B', status: 'complete' as const },
    ];
    const result = formatTasksSummary(tasks);
    expect(result).toContain('1 pending');
    expect(result).toContain('1 complete');
    expect(result).toContain('(2 total)');
  });

  test('renders correct status icons', () => {
    const tasks = [
      { id: 1, priority: 1, title: 'Done', status: 'complete' as const },
      { id: 2, priority: 1, title: 'Running', status: 'in-progress' as const },
      { id: 3, priority: 1, title: 'Waiting', status: 'pending' as const },
      { id: 4, priority: 1, title: 'Blocked', status: 'blocked' as const },
    ];
    const result = formatTasksSummary(tasks);
    expect(result).toContain('✓ #1');
    expect(result).toContain('▶ #2');
    expect(result).toContain('○ #3');
    expect(result).toContain('✗ #4');
  });

  test('includes priority in task rows', () => {
    const tasks = [{ id: 1, priority: 5, title: 'My Task', status: 'pending' as const }];
    const result = formatTasksSummary(tasks);
    expect(result).toContain('[P5]');
    expect(result).toContain('My Task');
  });

  test('includes directory when present', () => {
    const tasks = [
      { id: 1, priority: 1, title: 'Task', status: 'pending' as const, directory: 'src/feature' },
    ];
    const result = formatTasksSummary(tasks);
    expect(result).toContain('[src/feature]');
  });

  test('includes dependencies when present', () => {
    const tasks = [
      { id: 2, priority: 1, title: 'Task B', status: 'pending' as const, dependencies: [1] },
    ];
    const result = formatTasksSummary(tasks);
    expect(result).toContain('(depends on: 1)');
  });

  test('omits dependencies when empty', () => {
    const tasks = [
      { id: 1, priority: 1, title: 'Task', status: 'pending' as const, dependencies: [] },
    ];
    const result = formatTasksSummary(tasks);
    expect(result).not.toContain('depends on');
  });
});

describe('displayPreflight', () => {
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

  test('prints project name banner', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      displayPreflight('my-project', ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Project: my-project');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints planning notes status', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      displayPreflight('proj', ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('planning-notes.md');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints previously completed count when file has tasks', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.copyFileSync(
        path.join(FIXTURES_DIR, 'tasks-completed.json'),
        path.join(ralphDir, 'tasks.completed.json')
      );
      displayPreflight('proj', ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Previously completed:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('does not print completed count when file is missing', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      displayPreflight('proj', ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('Previously completed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints starting fresh message when tasks.json missing', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      displayPreflight('proj', ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('starting fresh');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints tasks summary when tasks.json exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.copyFileSync(
        path.join(FIXTURES_DIR, 'tasks-mixed.json'),
        path.join(ralphDir, 'tasks.json')
      );
      displayPreflight('proj', ralphDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Existing tasks.json');
      expect(output).toContain('Status:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
