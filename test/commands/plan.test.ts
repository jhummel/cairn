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
  buildPlanningPrompt,
  buildTaskGenPrompt,
  launchPlanningSession,
  launchTaskGeneration,
  reviewNotesLoop,
  reviewTasksLoop,
} from '../../src/commands/plan';
import type { AgentInfo } from '../../src/types';
import type { SpawnSyncReturns } from 'child_process';
import type { MenuOption, MenuResult, ReadlineInterface } from '../../src/menu';

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

describe('buildPlanningPrompt', () => {
  test('includes project name and root in prompt', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'test-project',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('PROJECT: test-project');
      expect(result).toContain(`PROJECT ROOT: ${tmpDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes planning assistant role', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('planning assistant');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes briefing materials section header', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('BRIEFING MATERIALS');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes planning-notes.md format specification', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('PLANNING-NOTES.MD FORMAT');
      expect(result).toContain('## Context');
      expect(result).toContain('## Goals');
      expect(result).toContain('## Approach');
      expect(result).toContain('## Rejected Alternatives');
      expect(result).toContain('## Rough Task Outline');
      expect(result).toContain('## Open Questions');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes rules section', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('RULES:');
      expect(result).toContain('planning-notes.md');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds CLAUDE.md content when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# My Project Guidelines');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('CLAUDE.md');
      expect(result).toContain('# My Project Guidelines');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds README.md content when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Read Me Please');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('README.md');
      expect(result).toContain('# Read Me Please');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds package.json content when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('package.json');
      expect(result).toContain('{"name":"test"}');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds Cargo.toml content when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('Cargo.toml');
      expect(result).toContain('[package]');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds Makefile content when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(tmpDir, 'Makefile'), 'build:\n\techo hi');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('Makefile');
      expect(result).toContain('build:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds planning-notes.md when file exists in dataDir', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'planning-notes.md'), '## Context\nPrior work here');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('planning-notes.md');
      expect(result).toContain('Prior work here');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds tasks.completed.json when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'tasks.completed.json'), '{"tasks":[{"id":1}]}');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain('tasks.completed.json');
      expect(result).toContain('"tasks"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds IMPLEMENTATION.md when file exists', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(tmpDir, 'IMPLEMENTATION.md'), '# Architecture\nSystem overview here');
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        implementationFile: 'IMPLEMENTATION.md',
      });
      expect(result).toContain('IMPLEMENTATION.md');
      expect(result).toContain('System overview here');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('omits sections for files that do not exist', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      // Should not contain embedded file content sections for missing files
      expect(result).not.toContain('--- CLAUDE.md ---');
      expect(result).not.toContain('--- README.md ---');
      expect(result).not.toContain('--- package.json ---');
      expect(result).not.toContain('--- planning-notes.md ---');
      expect(result).not.toContain('--- tasks.completed.json ---');
      expect(result).not.toContain('--- IMPLEMENTATION.md ---');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes agent list when agents are provided', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const agents: AgentInfo[] = [
      { name: 'reviewer', description: 'Code review specialist', model: 'opus', file: 'reviewer.md' },
      { name: 'tester', description: 'Test writer', model: 'sonnet', file: 'tester.md' },
    ];
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents,
      });
      expect(result).toContain('AVAILABLE SPECIALIST AGENTS');
      expect(result).toContain('reviewer');
      expect(result).toContain('Code review specialist');
      expect(result).toContain('(model: opus)');
      expect(result).toContain('tester');
      expect(result).toContain('Test writer');
      expect(result).toContain('(model: sonnet)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('omits agent section when agents array is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).not.toContain('AVAILABLE SPECIALIST AGENTS');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes agent description without trailing dash when description is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const agents: AgentInfo[] = [
      { name: 'helper', description: '', model: '', file: 'helper.md' },
    ];
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents,
      });
      expect(result).toContain('helper');
      expect(result).not.toContain('helper —');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes data dir path in format specification', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildPlanningPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
      });
      expect(result).toContain(ralphDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('buildTaskGenPrompt', () => {
  test('includes project name and root', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'my-app',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('PROJECT: my-app');
      expect(result).toContain(`PROJECT ROOT: ${tmpDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes tasks file path', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain(`TASKS FILE: ${path.join(ralphDir, 'tasks.json')}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes task generation assistant role', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('task generation assistant');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('embeds the tasks.json schema from src/tasks-schema.json', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('TASKS.JSON SCHEMA:');
      // Schema should contain key fields from tasks-schema.json
      expect(result).toContain('"$schema"');
      expect(result).toContain('"tasks"');
      expect(result).toContain('"priority"');
      expect(result).toContain('"dependencies"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes task structure guidelines', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('TASK STRUCTURE:');
      expect(result).toContain('id: unique integer');
      expect(result).toContain('priority: integer');
      expect(result).toContain('description: detailed implementation');
      expect(result).toContain('dependencies: array of task IDs');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes directory guidelines table', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('DIRECTORY GUIDELINES:');
      expect(result).toContain('Module work');
      expect(result).toContain('Cross-module');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes test command guidelines', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('TEST COMMAND GUIDELINES:');
      expect(result).toContain('prefer the project\'s own test scripts');
      expect(result).toContain('package.json');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes rules section', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('RULES:');
      expect(result).toContain('NEVER modify tasks with status \'complete\'');
      expect(result).toContain('Keep task IDs unique');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes agents section when agents provided', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const agents: AgentInfo[] = [
      { name: 'reviewer', description: 'Code review', model: 'opus', file: 'reviewer.md' },
      { name: 'tester', description: 'Test writer', model: 'sonnet', file: 'tester.md' },
    ];
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents,
        gitStatus: '',
      });
      expect(result).toContain('AVAILABLE SPECIALIST AGENTS');
      expect(result).toContain('reviewer');
      expect(result).toContain('Code review');
      expect(result).toContain('(model: opus)');
      expect(result).toContain('tester');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('omits agent section when agents array is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).not.toContain('AVAILABLE SPECIALIST AGENTS');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes git status when provided', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: 'On branch main\nnothing to commit',
      });
      expect(result).toContain('GIT STATUS:');
      expect(result).toContain('On branch main');
      expect(result).toContain('nothing to commit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('omits git status section when empty string', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).not.toContain('GIT STATUS:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes workflow steps', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain('YOUR WORKFLOW:');
      expect(result).toContain('Read planning-notes.md');
      expect(result).toContain('Present your proposed task breakdown');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('mentions model options in task structure', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain("'opus'");
      expect(result).toContain("'sonnet'");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes tasks file path in rules section', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const tasksFile = path.join(ralphDir, 'tasks.json');
      const result = buildTaskGenPrompt({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
      });
      expect(result).toContain(`ONLY write to: ${tasksFile}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Session launcher tests ──────────────────────────────────────────

function makeSpawnSyncSpy() {
  const calls: Array<{ command: string; args: readonly string[]; options: any }> = [];
  const spawnFn = (command: string, args: readonly string[], options: any): SpawnSyncReturns<Buffer> => {
    calls.push({ command, args, options });
    return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 123, output: [], signal: null };
  };
  return { spawnFn, calls };
}

function makeNotificationSpies() {
  const narrations: string[] = [];
  const ntfyCalls: Array<{ message: string; topic: string; opts?: any }> = [];
  return {
    narrations,
    ntfyCalls,
    narrate: async (text: string, _socketPath: string) => { narrations.push(text); },
    ntfy: async (message: string, topic: string, opts?: any) => { ntfyCalls.push({ message, topic, opts }); },
  };
}

describe('launchPlanningSession', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('spawns claude with --append-system-prompt and --allowedTools', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('claude');
      expect(calls[0].args).toContain('--append-system-prompt');
      expect(calls[0].args).toContain('--allowedTools');
      expect(calls[0].args).toContain('Read,Glob,Grep,Write,Edit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('passes the planning prompt as second arg after --append-system-prompt', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      const promptIdx = args.indexOf('--append-system-prompt');
      const prompt = args[promptIdx + 1];
      expect(prompt).toContain('planning assistant');
      expect(prompt).toContain('PROJECT: proj');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('sets cwd to projectRoot', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.cwd).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('clears ANTHROPIC_API_KEY in spawned env', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.env.ANTHROPIC_API_KEY).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('uses stdio inherit', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.stdio).toBe('inherit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('calls narration at start and end', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { narrations, narrate } = makeNotificationSpies();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
        narrateSocketPath: '/tmp/test.sock',
        sendToNarrateFn: narrate,
      });
      expect(narrations.length).toBeGreaterThanOrEqual(2);
      expect(narrations[0]).toContain('planning');
      expect(narrations[narrations.length - 1]).toContain('complete');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('calls ntfy at start and end', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { ntfyCalls, ntfy } = makeNotificationSpies();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
        ntfyTopic: 'test-topic',
        sendNtfyFn: ntfy,
      });
      expect(ntfyCalls.length).toBeGreaterThanOrEqual(2);
      expect(ntfyCalls[0].topic).toBe('test-topic');
      expect(ntfyCalls[ntfyCalls.length - 1].topic).toBe('test-topic');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('skips narration when socketPath is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { narrations, narrate } = makeNotificationSpies();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
        narrateSocketPath: '',
        sendToNarrateFn: narrate,
      });
      expect(narrations).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('skips ntfy when topic is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { ntfyCalls, ntfy } = makeNotificationSpies();
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
        ntfyTopic: '',
        sendNtfyFn: ntfy,
      });
      expect(ntfyCalls).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints launch banner messages', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const lines: string[] = [];
    consoleSpy.mockImplementation((...args: any[]) => { lines.push(args.join(' ')); });
    try {
      launchPlanningSession({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const output = lines.join('\n');
      expect(output).toContain('planning');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('launchTaskGeneration', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('spawns claude with --append-system-prompt and --allowedTools', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('claude');
      expect(calls[0].args).toContain('--append-system-prompt');
      expect(calls[0].args).toContain('--allowedTools');
      expect(calls[0].args).toContain('Read,Glob,Grep,Write,Edit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('passes the task gen prompt as second arg after --append-system-prompt', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      const promptIdx = args.indexOf('--append-system-prompt');
      const prompt = args[promptIdx + 1];
      expect(prompt).toContain('task generation assistant');
      expect(prompt).toContain('PROJECT: proj');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes user prompt as last positional arg', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      const lastArg = args[args.length - 1];
      expect(lastArg).toContain('planning-notes.md');
      expect(lastArg).toContain('task breakdown');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('sets cwd to projectRoot', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.cwd).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('clears ANTHROPIC_API_KEY in spawned env', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.env.ANTHROPIC_API_KEY).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('uses stdio inherit', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.stdio).toBe('inherit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('calls narration at start and end', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { narrations, narrate } = makeNotificationSpies();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
        narrateSocketPath: '/tmp/test.sock',
        sendToNarrateFn: narrate,
      });
      expect(narrations.length).toBeGreaterThanOrEqual(2);
      expect(narrations[0]).toContain('task generation');
      expect(narrations[narrations.length - 1]).toContain('complete');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('calls ntfy at start and end', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { ntfyCalls, ntfy } = makeNotificationSpies();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
        ntfyTopic: 'test-topic',
        sendNtfyFn: ntfy,
      });
      expect(ntfyCalls.length).toBeGreaterThanOrEqual(2);
      expect(ntfyCalls[0].topic).toBe('test-topic');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('skips narration when socketPath is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { narrations, narrate } = makeNotificationSpies();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
        narrateSocketPath: '',
        sendToNarrateFn: narrate,
      });
      expect(narrations).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('skips ntfy when topic is empty', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const { ntfyCalls, ntfy } = makeNotificationSpies();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
        ntfyTopic: '',
        sendNtfyFn: ntfy,
      });
      expect(ntfyCalls).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('passes gitStatus through to prompt', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: 'On branch main\nnothing to commit',
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      const promptIdx = args.indexOf('--append-system-prompt');
      const prompt = args[promptIdx + 1];
      expect(prompt).toContain('GIT STATUS:');
      expect(prompt).toContain('On branch main');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints launch banner messages', () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    const { spawnFn } = makeSpawnSyncSpy();
    const lines: string[] = [];
    consoleSpy.mockImplementation((...args: any[]) => { lines.push(args.join(' ')); });
    try {
      launchTaskGeneration({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: ralphDir,
        agents: [],
        gitStatus: '',
        spawnSyncFn: spawnFn,
      });
      const output = lines.join('\n');
      expect(output).toContain('task generation');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('reviewNotesLoop', () => {
  // Helper: create a mock readline that returns answers in sequence
  function mockRl(answers: string[]): ReadlineInterface {
    let idx = 0;
    return {
      question: async () => answers[idx++] ?? 'q',
      close: () => {},
    };
  }

  // Helper: capture a runMenu call's options without running the real menu
  function captureMenuOptions(): {
    captured: MenuOption[];
    runMenuFn: (options: MenuOption[], rl: ReadlineInterface) => Promise<MenuResult>;
  } {
    const captured: MenuOption[] = [];
    const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
      captured.push(...options);
      // Default: simulate quit
      return { exit: true, action: 'quit' };
    };
    return { captured, runMenuFn };
  }

  test('displays planning notes content before menu', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'planning-notes.md'), '## My Plan\nDo stuff.');
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      const { runMenuFn } = captureMenuOptions();

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      expect(output).toContain('## My Plan');
      expect(output).toContain('Do stuff.');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('shows "No planning notes yet" when file missing', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      const { runMenuFn } = captureMenuOptions();

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      expect(output).toContain('No planning notes yet');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('menu includes back option when hasBack is true', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      const { captured, runMenuFn } = captureMenuOptions();

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: true,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      const keys = captured.map(o => o.key);
      expect(keys).toContain('b');
      expect(keys).toContain('g');
      expect(keys).toContain('e');
      expect(keys).toContain('p');
      expect(keys).toContain('q');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('menu excludes back option when hasBack is false', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      const { captured, runMenuFn } = captureMenuOptions();

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      const keys = captured.map(o => o.key);
      expect(keys).not.toContain('b');
      expect(keys).toContain('g');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('generate handler calls launchTaskGenFn and returns continue signal', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'planning-notes.md'), '# Notes');
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      let taskGenCalled = false;

      // runMenuFn that invokes the 'g' handler
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const gen = options.find(o => o.key === 'g')!;
        return gen.handler();
      };

      const result = await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => { taskGenCalled = true; },
      });

      consoleSpy.mockRestore();
      expect(taskGenCalled).toBe(true);
      expect(result).toEqual({ exit: true, action: 'continue' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('generate handler warns when no planning notes exist', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
      let taskGenCalled = false;

      // runMenuFn that invokes 'g' then 'q'
      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const gen = options.find(o => o.key === 'g')!;
          return gen.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => { taskGenCalled = true; },
      });

      consoleSpy.mockRestore();
      expect(taskGenCalled).toBe(false);
      const output = lines.join('\n');
      expect(output).toContain('No planning-notes.md');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('edit handler calls editFn with planning-notes.md path', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'planning-notes.md'), '# Notes');
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      let editPath = '';

      // Invoke edit, then quit
      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const edit = options.find(o => o.key === 'e')!;
          return edit.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: (p: string) => { editPath = p; },
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(editPath).toBe(path.join(ralphDir, 'planning-notes.md'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('plan handler calls launchPlanningFn and loops back', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      let planCalled = false;

      // Invoke plan, then quit
      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const plan = options.find(o => o.key === 'p')!;
          return plan.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => { planCalled = true; },
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(planCalled).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('back handler returns back signal when hasBack is true', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const back = options.find(o => o.key === 'b')!;
        return back.handler();
      };

      const result = await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: true,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(result).toEqual({ exit: true, action: 'back' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('quit handler returns quit signal', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      const result = await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(result).toEqual({ exit: true, action: 'quit' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('quit handler prints notes path when notes exist', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(ralphDir, 'planning-notes.md'), '# Notes');
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewNotesLoop({
        dataDir: ralphDir,
        hasBack: false,
        runMenuFn,
        rl: mockRl([]),
        editFn: () => {},
        launchPlanningFn: () => {},
        launchTaskGenFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      expect(output).toContain('Planning notes saved');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('reviewTasksLoop', () => {
  // Helper: create a mock readline that returns answers in sequence
  function mockRl(answers: string[]): ReadlineInterface {
    let idx = 0;
    return {
      question: async () => answers[idx++] ?? 'q',
      close: () => {},
    };
  }

  // Helper: capture a runMenu call's options without running the real menu
  function captureMenuOptions(): {
    captured: MenuOption[];
    runMenuFn: (options: MenuOption[], rl: ReadlineInterface) => Promise<MenuResult>;
  } {
    const captured: MenuOption[] = [];
    const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
      captured.push(...options);
      return { exit: true, action: 'quit' };
    };
    return { captured, runMenuFn };
  }

  function writeTasksFile(ralphDir: string, tasks: object[] = []) {
    fs.writeFileSync(
      path.join(ralphDir, 'tasks.json'),
      JSON.stringify({ project: 'test', tasks }, null, 2),
    );
  }

  test('displays task summary before menu', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir, [
        { id: 1, priority: 1, title: 'Do thing', status: 'pending', directory: '', files: [], dependencies: [], tests: [] },
      ]);
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      const { runMenuFn } = captureMenuOptions();

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      expect(output).toContain('Do thing');
      expect(output).toContain('pending');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('shows "No tasks" message when tasks.json is missing', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      const { runMenuFn } = captureMenuOptions();

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      expect(output).toContain('No pending tasks');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('menu includes r, e, v, p, q options', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir);
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      const { captured, runMenuFn } = captureMenuOptions();

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      const keys = captured.map(o => o.key);
      expect(keys).toContain('r');
      expect(keys).toContain('e');
      expect(keys).toContain('v');
      expect(keys).toContain('p');
      expect(keys).toContain('q');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('run handler calls shellFallbackFn', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir, [
        { id: 1, priority: 1, title: 'Task 1', status: 'pending', directory: '', files: [], dependencies: [], tests: [] },
      ]);
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      let fallbackCalled = false;
      let fallbackCommand = '';

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const run = options.find(o => o.key === 'r')!;
        return run.handler();
      };

      const result = await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: (cmd: string, args: string[]) => {
          fallbackCalled = true;
          fallbackCommand = cmd;
        },
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(fallbackCalled).toBe(true);
      expect(fallbackCommand).toBe('run');
      expect(result).toEqual({ exit: true, action: 'run' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('run handler warns when no tasks.json exists', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
      let fallbackCalled = false;

      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const run = options.find(o => o.key === 'r')!;
          return run.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => { fallbackCalled = true; },
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(fallbackCalled).toBe(false);
      const output = lines.join('\n');
      expect(output).toContain('No tasks.json');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('edit handler calls editFn with tasks.json path', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir);
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      let editPath = '';

      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const edit = options.find(o => o.key === 'e')!;
          return edit.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: (p: string) => { editPath = p; },
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(editPath).toBe(path.join(ralphDir, 'tasks.json'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('view handler displays task summary and loops back', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir, [
        { id: 1, priority: 1, title: 'Build widget', status: 'pending', directory: '', files: [], dependencies: [], tests: [] },
      ]);
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const view = options.find(o => o.key === 'v')!;
          return view.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      // View handler should display the summary again
      expect(output).toContain('Build widget');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('plan handler calls launchPlanningFn and returns restart signal', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir);
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
      let planCalled = false;

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const plan = options.find(o => o.key === 'p')!;
        return plan.handler();
      };

      const result = await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => { planCalled = true; },
      });

      consoleSpy.mockRestore();
      expect(planCalled).toBe(true);
      expect(result).toEqual({ exit: true, action: 'plan' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('quit handler returns quit signal', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir);
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      const result = await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(result).toEqual({ exit: true, action: 'quit' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('quit handler prints tasks path when tasks.json exists', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      writeTasksFile(ralphDir, [
        { id: 1, priority: 1, title: 'Task 1', status: 'pending', directory: '', files: [], dependencies: [], tests: [] },
      ]);
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => {},
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      const output = lines.join('\n');
      expect(output).toContain('Tasks saved');
      expect(output).toContain('ralph run');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('edit handler warns when no tasks.json exists', async () => {
    const { tmpDir, ralphDir } = makeTempDir(true);
    try {
      const lines: string[] = [];
      const consoleSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
      let editCalled = false;

      let callCount = 0;
      const runMenuFn = async (options: MenuOption[], _rl: ReadlineInterface): Promise<MenuResult> => {
        callCount++;
        if (callCount === 1) {
          const edit = options.find(o => o.key === 'e')!;
          return edit.handler();
        }
        const quit = options.find(o => o.key === 'q')!;
        return quit.handler();
      };

      await reviewTasksLoop({
        dataDir: ralphDir,
        runMenuFn,
        rl: mockRl([]),
        shellFallbackFn: () => {},
        editFn: () => { editCalled = true; },
        launchPlanningFn: () => {},
      });

      consoleSpy.mockRestore();
      expect(editCalled).toBe(false);
      const output = lines.join('\n');
      expect(output).toContain('No tasks.json');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
