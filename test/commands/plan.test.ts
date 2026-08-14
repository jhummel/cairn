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
  buildDynamicContext,
  runPlan,
} from '../../src/commands/plan';
import type { AgentInfo } from '../../src/types';
import type { SpawnSyncReturns } from 'child_process';
import { getRound } from '../../src/task-counter';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

// Helper to create a temp dir with optional .cairn subdir
function makeTempDir(withCairnDir = false, withAgentFile = false): { tmpDir: string; cairnDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-plan-test-'));
  const cairnDir = path.join(tmpDir, '.cairn');
  if (withCairnDir) fs.mkdirSync(cairnDir);
  if (withAgentFile) {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'planner.md'), 'You are a planning assistant.');
  }
  return { tmpDir, cairnDir };
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
    const { cairnDir } = makeTempDir(true);
    try {
      const result = formatPlanningNotesStatus(cairnDir);
      expect(result).toContain('not found');
      expect(result).toContain('planning-notes.md');
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
    }
  });

  test('reports found when file exists', () => {
    const { cairnDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(cairnDir, 'planning-notes.md'), '# Notes');
      const result = formatPlanningNotesStatus(cairnDir);
      expect(result).toContain('found');
      expect(result).toContain(cairnDir);
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
    }
  });

  test('includes full path to planning notes', () => {
    const { cairnDir } = makeTempDir(true);
    try {
      const notesPath = path.join(cairnDir, 'planning-notes.md');
      const result = formatPlanningNotesStatus(cairnDir);
      expect(result).toContain(notesPath);
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
    }
  });
});

describe('formatCompletedCount', () => {
  test('returns null when file missing', () => {
    const { cairnDir } = makeTempDir(true);
    try {
      expect(formatCompletedCount(cairnDir)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
    }
  });

  test('returns null when tasks array is empty', () => {
    const { cairnDir } = makeTempDir(true);
    try {
      fs.writeFileSync(
        path.join(cairnDir, 'tasks.completed.json'),
        JSON.stringify({ tasks: [] })
      );
      expect(formatCompletedCount(cairnDir)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
    }
  });

  test('returns count string when tasks exist', () => {
    const { cairnDir } = makeTempDir(true);
    try {
      fs.copyFileSync(
        path.join(FIXTURES_DIR, 'tasks-completed.json'),
        path.join(cairnDir, 'tasks.completed.json')
      );
      const result = formatCompletedCount(cairnDir);
      expect(result).not.toBeNull();
      expect(result).toContain('Previously completed:');
      expect(result).toContain('task(s)');
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
    }
  });

  test('returns null on malformed JSON', () => {
    const { cairnDir } = makeTempDir(true);
    try {
      fs.writeFileSync(path.join(cairnDir, 'tasks.completed.json'), 'not json');
      expect(formatCompletedCount(cairnDir)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(cairnDir), { recursive: true });
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
    const { tmpDir, cairnDir } = makeTempDir(true);
    try {
      displayPreflight('my-project', cairnDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Project: my-project');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints planning notes status', () => {
    const { tmpDir, cairnDir } = makeTempDir(true);
    try {
      displayPreflight('proj', cairnDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('planning-notes.md');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints previously completed count when file has tasks', () => {
    const { tmpDir, cairnDir } = makeTempDir(true);
    try {
      fs.copyFileSync(
        path.join(FIXTURES_DIR, 'tasks-completed.json'),
        path.join(cairnDir, 'tasks.completed.json')
      );
      displayPreflight('proj', cairnDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Previously completed:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('does not print completed count when file is missing', () => {
    const { tmpDir, cairnDir } = makeTempDir(true);
    try {
      displayPreflight('proj', cairnDir);
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('Previously completed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints starting fresh message when tasks.json missing', () => {
    const { tmpDir, cairnDir } = makeTempDir(true);
    try {
      displayPreflight('proj', cairnDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('starting fresh');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('prints tasks summary when tasks.json exists', () => {
    const { tmpDir, cairnDir } = makeTempDir(true);
    try {
      fs.copyFileSync(
        path.join(FIXTURES_DIR, 'tasks-mixed.json'),
        path.join(cairnDir, 'tasks.json')
      );
      displayPreflight('proj', cairnDir);
      const output = stdoutLines.join('\n');
      expect(output).toContain('Existing tasks.json');
      expect(output).toContain('Status:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('buildDynamicContext', () => {
  test('includes project name and root', () => {
    const result = buildDynamicContext({
      projectName: 'test-project',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents: [],
    });
    expect(result).toContain('PROJECT: test-project');
    expect(result).toContain('PROJECT ROOT: /tmp/test');
  });

  test('includes data dir path', () => {
    const result = buildDynamicContext({
      projectName: 'proj',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents: [],
    });
    expect(result).toContain('DATA DIR: /tmp/test/.cairn');
  });

  test('includes agent list when agents are provided', () => {
    const agents: AgentInfo[] = [
      { name: 'reviewer', description: 'Code review specialist', model: 'opus', file: 'reviewer.md' },
      { name: 'tester', description: 'Test writer', model: 'sonnet', file: 'tester.md' },
    ];
    const result = buildDynamicContext({
      projectName: 'proj',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents,
    });
    expect(result).toContain('AVAILABLE SPECIALIST AGENTS');
    expect(result).toContain('reviewer');
    expect(result).toContain('Code review specialist');
    expect(result).toContain('(model: opus)');
    expect(result).toContain('tester');
    expect(result).toContain('Test writer');
    expect(result).toContain('(model: sonnet)');
  });

  test('omits agent section when agents array is empty', () => {
    const result = buildDynamicContext({
      projectName: 'proj',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents: [],
    });
    expect(result).not.toContain('AVAILABLE SPECIALIST AGENTS');
  });

  test('includes agent name without trailing dash when description is empty', () => {
    const agents: AgentInfo[] = [
      { name: 'helper', description: '', model: '', file: 'helper.md' },
    ];
    const result = buildDynamicContext({
      projectName: 'proj',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents,
    });
    expect(result).toContain('helper');
    expect(result).not.toContain('helper —');
  });

  test('includes PERSONAL INSTRUCTIONS block when instructions.md exists in dataDir', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-plan-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '* Always use TDD');
      const result = buildDynamicContext({
        projectName: 'proj',
        projectRoot: '/tmp/test',
        dataDir: tmpDir,
        agents: [],
      });
      expect(result).toContain('PERSONAL INSTRUCTIONS:');
      expect(result).toContain('* Always use TDD');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('omits PERSONAL INSTRUCTIONS block when instructions.md does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-plan-test-'));
    try {
      const result = buildDynamicContext({
        projectName: 'proj',
        projectRoot: '/tmp/test',
        dataDir: tmpDir,
        agents: [],
      });
      expect(result).not.toContain('PERSONAL INSTRUCTIONS:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('excludes internal agents from the agents section while keeping normal agents', () => {
    const agents: AgentInfo[] = [
      { name: 'post-task-reviewer', description: 'Internal reviewer', model: 'sonnet', file: 'post-task-reviewer.md', internal: true },
      { name: 'specialist', description: 'Useful agent', model: 'opus', file: 'specialist.md' },
    ];
    const result = buildDynamicContext({
      projectName: 'proj',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents,
    });
    expect(result).not.toContain('post-task-reviewer');
    expect(result).toContain('specialist');
    expect(result).toContain('AVAILABLE SPECIALIST AGENTS');
  });

  test('omits agent section entirely when all agents are internal', () => {
    const agents: AgentInfo[] = [
      { name: 'post-task-reviewer', description: 'Internal reviewer', model: 'sonnet', file: 'post-task-reviewer.md', internal: true },
    ];
    const result = buildDynamicContext({
      projectName: 'proj',
      projectRoot: '/tmp/test',
      dataDir: '/tmp/test/.cairn',
      agents,
    });
    expect(result).not.toContain('post-task-reviewer');
    expect(result).not.toContain('AVAILABLE SPECIALIST AGENTS');
  });
});

// ── runPlan tests ──────────────────────────────────────────

function makeSpawnSyncSpy() {
  const calls: Array<{ command: string; args: readonly string[]; options: any }> = [];
  const spawnFn = (command: string, args: readonly string[], options: any): SpawnSyncReturns<Buffer> => {
    calls.push({ command, args, options });
    return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 123, output: [], signal: null };
  };
  return { spawnFn, calls };
}

describe('runPlan', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('calls displayPreflight before spawning claude', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn } = makeSpawnSyncSpy();
    const lines: string[] = [];
    consoleSpy.mockImplementation((...args: any[]) => { lines.push(args.join(' ')); });
    try {
      runPlan({
        projectName: 'my-proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const output = lines.join('\n');
      expect(output).toContain('Project: my-proj');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('spawns claude with --agents and --agent args', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('claude');
      expect(calls[0].args).toContain('--agents');
      expect(calls[0].args).toContain('--agent');
      expect(calls[0].args).toContain('planner');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('spawns claude with --allowedTools including Agent for slash command support', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      expect(args).toContain('--allowedTools');
      const idx = args.indexOf('--allowedTools');
      expect(args[idx + 1]).toBe('Read,Glob,Grep,Write,Edit,Agent,Bash(cairn task next-id:*)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('pre-approves cairn task next-id so ID allocation does not prompt mid-generation', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      const idx = args.indexOf('--allowedTools');
      const allowedTools = args[idx + 1];
      expect(allowedTools).toContain('Bash(cairn task next-id:*)');
      // Scoped strictly to next-id: no other cairn task subcommand or bare Bash grant.
      expect(allowedTools).not.toContain('Bash(cairn task:*)');
      expect(allowedTools).not.toMatch(/Bash\(cairn task (start|complete|note|set-status|add):/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('append-system-prompt contains dynamic context', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'my-app',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      expect(args).toContain('--append-system-prompt');
      const promptIdx = args.indexOf('--append-system-prompt');
      const prompt = args[promptIdx + 1];
      expect(prompt).toContain('PROJECT: my-app');
      expect(prompt).toContain(`PROJECT ROOT: ${tmpDir}`);
      expect(prompt).toContain(`DATA DIR: ${cairnDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('sets cwd to projectRoot', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.cwd).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('clears ANTHROPIC_API_KEY in spawned env', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.env.ANTHROPIC_API_KEY).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('uses stdio inherit for interactive session', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls[0].options.stdio).toBe('inherit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('includes agents in dynamic context when provided', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    const agents: AgentInfo[] = [
      { name: 'reviewer', description: 'Code review', model: 'opus', file: 'reviewer.md' },
    ];
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents,
        spawnSyncFn: spawnFn,
      });
      const args = calls[0].args;
      const promptIdx = args.indexOf('--append-system-prompt');
      const prompt = args[promptIdx + 1];
      expect(prompt).toContain('reviewer');
      expect(prompt).toContain('AVAILABLE SPECIALIST AGENTS');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('returns void (synchronous, no menu loops)', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn } = makeSpawnSyncSpy();
    try {
      const result = runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('bumps the planning round in state.json', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn } = makeSpawnSyncSpy();
    try {
      expect(getRound(cairnDir)).toBe(1);
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(getRound(cairnDir)).toBe(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('bumps the round even though spawnSyncFn is a stub', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn, calls } = makeSpawnSyncSpy();
    try {
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      expect(calls).toHaveLength(1);
      const statePath = path.join(cairnDir, 'state.json');
      expect(fs.existsSync(statePath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(state.round).toBe(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('preserves an existing nextTaskId across the bump', () => {
    const { tmpDir, cairnDir } = makeTempDir(true, true);
    const { spawnFn } = makeSpawnSyncSpy();
    try {
      fs.writeFileSync(path.join(cairnDir, 'state.json'), JSON.stringify({ nextTaskId: 42 }));
      runPlan({
        projectName: 'proj',
        projectRoot: tmpDir,
        dataDir: cairnDir,
        agents: [],
        spawnSyncFn: spawnFn,
      });
      const state = JSON.parse(fs.readFileSync(path.join(cairnDir, 'state.json'), 'utf8'));
      expect(state.nextTaskId).toBe(42);
      expect(state.round).toBe(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
