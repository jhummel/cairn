import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Readable, Writable, PassThrough } from 'stream';
import { buildSystemPrompt, spawnClaude, runRun, type SystemPromptInput, type SpawnClaudeDeps, type RunRunOpts, type RunRunDeps } from '../../src/commands/run';
import { ProcessManager } from '../../src/process';
import type { RalphConfig, AgentInfo, Task } from '../../src/types';

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    projectName: 'test-project',
    projectDescription: '',
    healthCheck: '',
    defaultTestCommand: '',
    implementationFile: 'IMPLEMENTATION.md',
    truncateText: true,
    summarize: { claudeMdPattern: '' },
    narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    ...overrides,
  };
}

function makeInput(overrides: Partial<SystemPromptInput> = {}): SystemPromptInput {
  return {
    taskDir: '',
    taskAgent: '',
    projectRoot: '/projects/myapp',
    dataDir: '/projects/myapp/.ralph',
    config: makeConfig(),
    agents: [],
    iteration: 1,
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('includes project name', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('test-project');
  });

  test('includes project description when set', () => {
    const prompt = buildSystemPrompt(makeInput({
      config: makeConfig({ projectDescription: 'A cool app' }),
    }));
    expect(prompt).toContain('Project description: A cool app');
  });

  test('omits project description when empty', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).not.toContain('Project description:');
  });

  test('includes personal instructions from instructions.md', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'instructions.md'), '* Always use TDD\n* Be concise');

    const prompt = buildSystemPrompt(makeInput({ dataDir }));
    expect(prompt).toContain('PERSONAL INSTRUCTIONS:');
    expect(prompt).toContain('* Always use TDD');
    expect(prompt).toContain('* Be concise');
  });

  test('omits personal instructions when file missing', () => {
    const prompt = buildSystemPrompt(makeInput({ dataDir: path.join(tmpDir, 'nonexistent') }));
    expect(prompt).not.toContain('PERSONAL INSTRUCTIONS:');
  });

  // --- DIRECTORY section ---

  test('shows project root when taskDir is empty', () => {
    const prompt = buildSystemPrompt(makeInput({ taskDir: '' }));
    expect(prompt).toContain('Your working directory is: project root');
  });

  test('shows relative path when taskDir is set', () => {
    const prompt = buildSystemPrompt(makeInput({ taskDir: 'src/services/auth' }));
    expect(prompt).toContain('Your working directory is: src/services/auth');
  });

  // --- SPECIALIST INSTRUCTIONS ---

  test('includes specialist agent instructions when taskAgent matches', () => {
    const projectRoot = tmpDir;
    const agentsDir = path.join(projectRoot, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'db-expert.md'), `---
name: db-expert
description: Database specialist
model: opus
---

You are a database expert. Focus on migrations and schema design.`);

    const agents: AgentInfo[] = [
      { name: 'db-expert', description: 'Database specialist', model: 'opus', file: 'db-expert.md' },
    ];

    const prompt = buildSystemPrompt(makeInput({
      projectRoot,
      taskAgent: 'db-expert',
      agents,
    }));

    expect(prompt).toContain('SPECIALIST INSTRUCTIONS:');
    expect(prompt).toContain('You are a database expert. Focus on migrations and schema design.');
    // Should NOT include frontmatter
    expect(prompt).not.toContain('name: db-expert');
  });

  test('omits specialist section when no taskAgent', () => {
    const prompt = buildSystemPrompt(makeInput({ taskAgent: '' }));
    expect(prompt).not.toContain('SPECIALIST INSTRUCTIONS:');
  });

  test('omits specialist section when agent file not found', () => {
    const agents: AgentInfo[] = [
      { name: 'missing-agent', description: 'Gone', model: 'opus', file: 'missing-agent.md' },
    ];

    const prompt = buildSystemPrompt(makeInput({
      taskAgent: 'missing-agent',
      agents,
    }));
    expect(prompt).not.toContain('SPECIALIST INSTRUCTIONS:');
  });

  // --- WORKFLOW section ---

  test('includes workflow with tasks file path', () => {
    const prompt = buildSystemPrompt(makeInput({
      dataDir: '/projects/myapp/.ralph',
    }));
    expect(prompt).toContain('ralph task start');
    expect(prompt).toContain('/projects/myapp/.ralph/tasks.json');
  });

  test('includes default test instruction without defaultTestCommand', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('4. Run the tests listed in the task.');
    expect(prompt).not.toContain('If none are listed, run');
  });

  test('includes fallback test command when defaultTestCommand is set', () => {
    const prompt = buildSystemPrompt(makeInput({
      config: makeConfig({ defaultTestCommand: 'bun test' }),
    }));
    expect(prompt).toContain("If none are listed, run 'bun test' if available.");
  });

  test('includes iteration number in workflow', () => {
    const prompt = buildSystemPrompt(makeInput({ iteration: 5 }));
    expect(prompt).toContain('--iteration 5');
  });

  test('includes complete flag path', () => {
    const prompt = buildSystemPrompt(makeInput({
      dataDir: '/projects/myapp/.ralph',
    }));
    expect(prompt).toContain('/projects/myapp/.ralph/.ralph_complete');
  });

  // --- COMMIT PREFIX ---

  test('uses provided commitPrefix in git commit format', () => {
    const prompt = buildSystemPrompt(makeInput({ commitPrefix: 'ralph' }));
    expect(prompt).toContain('[ralph] Task #<id>: <title>');
  });

  test('derives commitPrefix from taskDir basename when not provided', () => {
    const prompt = buildSystemPrompt(makeInput({ taskDir: 'src/services/auth' }));
    expect(prompt).toContain('[auth] Task #<id>: <title>');
  });

  test('derives commitPrefix from projectRoot basename when taskDir empty and no override', () => {
    const prompt = buildSystemPrompt(makeInput({
      projectRoot: '/projects/myapp',
      taskDir: '',
    }));
    expect(prompt).toContain('[myapp] Task #<id>: <title>');
  });

  // --- DISCOVERY RULES ---

  test('includes discovery rules section', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('DISCOVER AND DOCUMENT:');
    expect(prompt).toContain('Max 3 discovered tasks per iteration');
  });

  // --- CRITICAL RULES ---

  test('includes critical rules section', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('CRITICAL RULES:');
    expect(prompt).toContain('Work on EXACTLY ONE task per iteration');
    expect(prompt).toContain("Set status to 'in-progress' BEFORE starting implementation");
  });

  // --- CONTEXT section ---

  test('includes context about fresh agent', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('This is a FRESH agent instance');
  });

  // --- SUBAGENT STRATEGY ---

  test('includes subagent strategy', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('SUBAGENT STRATEGY:');
    expect(prompt).toContain('10 parallel Sonnet subagents');
  });

  // --- Section ordering ---

  test('specialist instructions come before project context', () => {
    const projectRoot = tmpDir;
    const agentsDir = path.join(projectRoot, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'test-agent.md'), `---
name: test-agent
---

Agent body here.`);

    const agents: AgentInfo[] = [
      { name: 'test-agent', description: '', model: '', file: 'test-agent.md' },
    ];

    const prompt = buildSystemPrompt(makeInput({
      projectRoot,
      taskAgent: 'test-agent',
      agents,
    }));

    const specialistIdx = prompt.indexOf('SPECIALIST INSTRUCTIONS:');
    const projectIdx = prompt.indexOf('You are working on the');
    expect(specialistIdx).toBeLessThan(projectIdx);
  });

  test('workflow comes before discovery rules', () => {
    const prompt = buildSystemPrompt(makeInput());
    const workflowIdx = prompt.indexOf('YOUR WORKFLOW:');
    const discoveryIdx = prompt.indexOf('DISCOVER AND DOCUMENT:');
    expect(workflowIdx).toBeLessThan(discoveryIdx);
  });

  test('discovery rules come before critical rules', () => {
    const prompt = buildSystemPrompt(makeInput());
    const discoveryIdx = prompt.indexOf('DISCOVER AND DOCUMENT:');
    const criticalIdx = prompt.indexOf('CRITICAL RULES:');
    expect(discoveryIdx).toBeLessThan(criticalIdx);
  });

  // --- ralph task CLI integration ---

  test('uses ralph task start with iteration in step 1', () => {
    const prompt = buildSystemPrompt(makeInput({ iteration: 7 }));
    expect(prompt).toContain('ralph task start');
    expect(prompt).toMatch(/ralph task start[^\n]*--iteration\s+7/);
  });

  test('uses ralph task complete with --iteration and --notes-file', () => {
    const prompt = buildSystemPrompt(makeInput({ iteration: 3 }));
    expect(prompt).toContain('ralph task complete');
    expect(prompt).toMatch(/ralph task complete[^\n]*--iteration\s+3/);
    expect(prompt).toMatch(/ralph task complete[^\n]*--notes-file/);
  });

  test('references notes tempfile path under dataDir with id placeholder', () => {
    const dataDir = '/projects/myapp/.ralph';
    const prompt = buildSystemPrompt(makeInput({ dataDir }));
    expect(prompt).toContain(`${dataDir}/.ralph_task_<id>_notes.md`);
  });

  test('mentions ralph task add --file in DISCOVER AND DOCUMENT block', () => {
    const prompt = buildSystemPrompt(makeInput());
    const discoverIdx = prompt.indexOf('DISCOVER AND DOCUMENT:');
    const addIdx = prompt.indexOf('ralph task add --file');
    expect(discoverIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(discoverIdx);
    const criticalIdx = prompt.indexOf('CRITICAL RULES:');
    expect(addIdx).toBeLessThan(criticalIdx);
  });

  test('includes explicit ban on direct edits to tasks.json', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).toContain('Do NOT use Edit or Write on');
    expect(prompt).toContain('tasks.json');
  });

  test('does NOT contain old "Use Edit to set these fields" phrasing', () => {
    const prompt = buildSystemPrompt(makeInput());
    expect(prompt).not.toContain('Use Edit to set these fields');
  });
});

// --- spawnClaude tests ---

/** Create a mock ChildProcess-like EventEmitter with stdin/stdout */
function makeMockChild(exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    pid: number;
    kill: ReturnType<typeof mock>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.pid = 12345;
  child.kill = mock(() => {});
  return { child, exit: (code: number) => child.emit('close', code) };
}

function makeDeps(child: ReturnType<typeof makeMockChild>['child']): SpawnClaudeDeps {
  return {
    spawn: mock(() => child as any),
    processStreamFn: mock(async () => {}),
  };
}

describe('spawnClaude', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager({ kill: () => true });
  });

  afterEach(() => {
    pm.dispose();
  });

  test('spawns claude with correct args', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'do stuff',
      systemPrompt: 'you are helpful',
      model: 'opus',
      projectRoot: '/projects/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    // Let the spawn happen, then exit
    await Bun.sleep(10);
    exit(0);
    const result = await promise;

    expect(result.exitCode).toBe(0);

    const spawnCall = (deps.spawn as ReturnType<typeof mock>).mock.calls[0];
    const [cmd, args, opts] = spawnCall;

    expect(cmd).toBe('claude');
    expect(args).toContain('-p');
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('you are helpful');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--model');
    expect(args).toContain('opus');
    expect(args).toContain('--verbose');
  });

  test('unsets ANTHROPIC_API_KEY in child env', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    const spawnCall = (deps.spawn as ReturnType<typeof mock>).mock.calls[0];
    const opts = spawnCall[2];
    expect(opts.env.ANTHROPIC_API_KEY).toBe('');
  });

  test('sets cwd to projectRoot when taskDir is empty', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/projects/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    const opts = (deps.spawn as ReturnType<typeof mock>).mock.calls[0][2];
    expect(opts.cwd).toBe('/projects/app');
  });

  test('sets cwd to projectRoot + taskDir when taskDir is set', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/projects/app',
      taskDir: 'src/lib',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    const opts = (deps.spawn as ReturnType<typeof mock>).mock.calls[0][2];
    expect(opts.cwd).toBe('/projects/app/src/lib');
  });

  test('writes prompt to stdin and closes it', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    let writtenData = '';
    child.stdin.on('data', (chunk: Buffer) => {
      writtenData += chunk.toString();
    });

    const promise = spawnClaude({
      prompt: 'hello world',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    expect(writtenData).toBe('hello world');
  });

  test('pipes stdout through processStream', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    expect(deps.processStreamFn).toHaveBeenCalledTimes(1);
    // First arg should be the child's stdout
    const callArgs = (deps.processStreamFn as ReturnType<typeof mock>).mock.calls[0];
    expect(callArgs[0]).toBe(child.stdout);
  });

  test('passes streamOpts to processStream', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);
    const streamOpts = { truncateText: true, taskContext: 'Task #1' };

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      streamOpts,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    const callArgs = (deps.processStreamFn as ReturnType<typeof mock>).mock.calls[0];
    expect(callArgs[2]).toEqual(streamOpts);
  });

  test('registers child with ProcessManager', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);

    // While running, PID should be registered
    const pids = pm.registeredPids();
    expect(pids['claude']).toBe(12345);

    exit(0);
    await promise;

    // After exit, PID should be unregistered
    expect(pm.registeredPids()['claude']).toBeUndefined();
  });

  test('returns non-zero exit code on failure', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 60000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(1);
    const result = await promise;

    expect(result.exitCode).toBe(1);
  });

  test('kills child process on timeout', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 50, // very short timeout
      processManager: pm,
      deps,
    });

    // Wait for timeout to fire
    await Bun.sleep(100);
    // The kill should have been called
    expect(child.kill).toHaveBeenCalled();

    // Now close the child so the promise resolves
    exit(124);
    const result = await promise;
    expect(result.exitCode).toBe(124);
  });

  test('clears timeout on normal exit', async () => {
    const { child, exit } = makeMockChild();
    const deps = makeDeps(child);

    const promise = spawnClaude({
      prompt: 'test',
      systemPrompt: 'sys',
      model: 'sonnet',
      projectRoot: '/app',
      taskDir: '',
      timeout: 30000,
      processManager: pm,
      deps,
    });

    await Bun.sleep(10);
    exit(0);
    await promise;

    // child.kill should NOT have been called since we exited normally
    expect(child.kill).not.toHaveBeenCalled();
  });
});

// --- runRun tests ---

function makeTestConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    projectName: 'test-project',
    projectDescription: '',
    healthCheck: '',
    defaultTestCommand: 'bun test',
    implementationFile: 'IMPLEMENTATION.md',
    truncateText: true,
    summarize: { claudeMdPattern: '' },
    narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    priority: 1,
    title: 'Test task',
    status: 'pending',
    ...overrides,
  };
}

function makeRunDeps(overrides: Partial<RunRunDeps> = {}): RunRunDeps {
  return {
    loadCompletedIds: overrides.loadCompletedIds ?? mock(() => new Set<number>()),
    selectNextTask: overrides.selectNextTask ?? mock(() => null),
    buildIterationPrompt: overrides.buildIterationPrompt ?? mock(() => 'iteration prompt'),
    buildSystemPrompt: overrides.buildSystemPrompt ?? mock(() => 'system prompt'),
    runHealthCheck: overrides.runHealthCheck ?? mock(async () => ({ status: 'skipped' as const })),
    spawnClaude: overrides.spawnClaude ?? mock(async () => ({ exitCode: 0 })),
    validateTaskTests: overrides.validateTaskTests ?? mock(async () => ({ status: 'passed' as const })),
    archiveCompletedTasks: overrides.archiveCompletedTasks ?? mock(async () => ({ archivedCount: 0, prevNotes: null })),
    captureGitSha: overrides.captureGitSha ?? mock(() => null),
    runPostTaskReview: overrides.runPostTaskReview ?? mock(async () => {}),
    runPlan: overrides.runPlan ?? mock(async () => {}),
    createProcessManager: overrides.createProcessManager ?? mock(() => new ProcessManager({ kill: () => true })),
    prompt: overrides.prompt ?? mock(async () => 'y'),
    existsSync: overrides.existsSync ?? mock((p: string) => {
      // Default: tasks.json exists, temp files don't
      if (typeof p === 'string' && p.endsWith('tasks.json')) return true;
      return false;
    }),
    readTasksFile: overrides.readTasksFile ?? mock(() => ({
      data: { tasks: [makeTask()] },
      repaired: false,
      restored: false,
    })),
    snapshotTasksFile: overrides.snapshotTasksFile ?? mock(() => undefined),
    readdirSync: overrides.readdirSync ?? mock(() => []),
    mkdirSync: overrides.mkdirSync ?? mock(() => undefined),
    unlinkSync: overrides.unlinkSync ?? mock(() => undefined),
    appendFileSync: overrides.appendFileSync ?? mock(() => undefined),
    startNarrationServer: overrides.startNarrationServer ?? mock(async () => 99999),
    stopNarrationServer: overrides.stopNarrationServer ?? mock(async () => {}),
    checkNarrationHealth: overrides.checkNarrationHealth ?? mock(async () => true),
    sendToNarrate: overrides.sendToNarrate ?? mock(async () => {}),
    sendNtfy: overrides.sendNtfy ?? mock(async () => {}),
    log: overrides.log ?? mock(() => {}),
  };
}

function makeRunOpts(overrides: Partial<RunRunOpts> = {}): RunRunOpts {
  return {
    projectRoot: '/projects/myapp',
    dataDir: '/projects/myapp/.ralph',
    config: makeTestConfig(),
    agents: [],
    ...overrides,
  };
}

describe('runRun', () => {
  // --- No tasks.json handling ---

  test('prompts to launch planner when tasks.json missing and user says yes', async () => {
    const runPlan = mock(async () => {});
    let planCalled = false;
    // existsSync returns false for tasks.json initially, then true after plan runs
    const existsSync = mock((p: string) => {
      if (typeof p === 'string' && p.endsWith('tasks.json')) return planCalled;
      return false;
    });

    const deps = makeRunDeps({
      existsSync,
      runPlan: mock(async () => { planCalled = true; }),
      selectNextTask: mock(() => null), // no tasks after plan
      prompt: mock(async () => 'y'),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.prompt).toHaveBeenCalled();
    expect(deps.runPlan).toHaveBeenCalled();
  });

  test('exits with error when tasks.json missing and user declines planner', async () => {
    const existsSync = mock((p: string) => {
      if (typeof p === 'string' && p.endsWith('tasks.json')) return false;
      return false;
    });

    const deps = makeRunDeps({
      existsSync,
      prompt: mock(async () => 'n'),
    });

    await expect(runRun(makeRunOpts(), deps)).rejects.toThrow('tasks.json not found');
  });

  // --- PATH augmentation ---

  test('augments PATH with standard directories', async () => {
    const originalPath = process.env.PATH;
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps);

    expect(process.env.PATH).toContain('.bun/bin');
    expect(process.env.PATH).toContain('.cargo/bin');
    expect(process.env.PATH).toContain('/opt/homebrew/bin');
    expect(process.env.PATH).toContain('/usr/local/bin');

    // Restore
    process.env.PATH = originalPath;
  });

  // --- Complete flag ---

  test('breaks loop when .ralph_complete flag exists', async () => {
    const existsSync = mock((p: string) => {
      if (typeof p === 'string' && p.endsWith('.ralph_complete')) return true;
      if (typeof p === 'string' && p.endsWith('tasks.json')) return true;
      return false;
    });

    const deps = makeRunDeps({ existsSync });

    await runRun(makeRunOpts(), deps);

    // spawnClaude should never be called since we break on complete flag
    expect(deps.spawnClaude).not.toHaveBeenCalled();
  });

  // --- Task selection ---

  test('breaks loop when no task is selected', async () => {
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.spawnClaude).not.toHaveBeenCalled();
  });

  test('loads completed IDs each iteration', async () => {
    let callCount = 0;
    const selectNextTask = mock(() => {
      callCount++;
      if (callCount <= 1) return makeTask();
      return null;
    });

    const deps = makeRunDeps({ selectNextTask });

    await runRun(makeRunOpts(), deps);

    expect(deps.loadCompletedIds).toHaveBeenCalled();
  });

  // --- Full iteration flow ---

  test('runs full iteration: health check → prompts → spawn → validate → archive', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1, title: 'Build feature', directory: 'src', model: 'opus' });
    const selectNextTask = mock(() => {
      callCount++;
      if (callCount <= 1) return task;
      return null;
    });

    const deps = makeRunDeps({
      selectNextTask,
      runHealthCheck: mock(async () => ({ status: 'ok' as const })),
      spawnClaude: mock(async () => ({ exitCode: 0 })),
      validateTaskTests: mock(async () => ({ status: 'passed' as const })),
      archiveCompletedTasks: mock(async () => ({ archivedCount: 1, prevNotes: 'did stuff' })),
    });

    await runRun(makeRunOpts(), deps);

    // All steps should have been called
    expect(deps.runHealthCheck).toHaveBeenCalledTimes(1);
    expect(deps.buildIterationPrompt).toHaveBeenCalledTimes(1);
    expect(deps.buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(deps.spawnClaude).toHaveBeenCalledTimes(1);
    expect(deps.validateTaskTests).toHaveBeenCalledTimes(1);
    expect(deps.archiveCompletedTasks).toHaveBeenCalledTimes(1);
  });

  test('passes health check failure output to iteration prompt', async () => {
    let callCount = 0;
    const task = makeTask();
    const selectNextTask = mock(() => {
      callCount++;
      return callCount <= 1 ? task : null;
    });

    const healthOutput = 'BUILD HEALTH CHECK FAILED:\nerror stuff';
    const deps = makeRunDeps({
      selectNextTask,
      runHealthCheck: mock(async () => ({ status: 'failed' as const, output: healthOutput })),
    });

    await runRun(makeRunOpts(), deps);

    // buildIterationPrompt should have been called
    const call = (deps.buildIterationPrompt as ReturnType<typeof mock>).mock.calls[0];
    // The iteration prompt itself is built, then health failure is prepended before passing to spawnClaude
    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].prompt).toContain(healthOutput);
  });

  test('creates task directory before spawning', async () => {
    let callCount = 0;
    const task = makeTask({ directory: 'src/new-module' });
    const selectNextTask = mock(() => {
      callCount++;
      return callCount <= 1 ? task : null;
    });

    const deps = makeRunDeps({ selectNextTask });

    await runRun(makeRunOpts(), deps);

    expect(deps.mkdirSync).toHaveBeenCalled();
    const mkdirCall = (deps.mkdirSync as ReturnType<typeof mock>).mock.calls[0];
    expect(mkdirCall[0]).toBe('/projects/myapp/src/new-module');
  });

  // --- Iteration limits ---

  test('respects maxIterations', async () => {
    // Always return a task, so the loop is limited by maxIterations
    const task = makeTask();
    const deps = makeRunDeps({
      selectNextTask: mock(() => task),
    });

    await runRun(makeRunOpts({ maxIterations: 3 }), deps);

    expect(deps.spawnClaude).toHaveBeenCalledTimes(3);
  });

  test('defaults maxIterations to 30', async () => {
    // We'll verify by checking selectNextTask calls don't exceed 30
    let iterations = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        iterations++;
        return iterations <= 30 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    // Should have called spawnClaude exactly 30 times (default max)
    expect(deps.spawnClaude).toHaveBeenCalledTimes(30);
  });

  // --- prevNotes threading ---

  test('carries prevNotes from archive to next iteration prompt', async () => {
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 2 ? makeTask({ id: callCount }) : null;
      }),
      archiveCompletedTasks: mock(async () => ({
        archivedCount: 1,
        prevNotes: callCount === 1 ? 'notes from first task' : null,
      })),
    });

    await runRun(makeRunOpts(), deps);

    // Second call to buildIterationPrompt should have prevNotes
    const calls = (deps.buildIterationPrompt as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(2);
    // First iteration: no prevNotes
    expect(calls[0][3]).toBeNull(); // prevNotes arg
    // Second iteration: has prevNotes from first archive
    expect(calls[1][3]).toBe('notes from first task');
  });

  // --- Model resolution ---

  test('uses task model (defaults to opus)', async () => {
    let callCount = 0;
    const task = makeTask({ model: 'sonnet' });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].model).toBe('sonnet');
  });

  test('defaults to opus when task has no model', async () => {
    let callCount = 0;
    const task = makeTask(); // no model specified
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].model).toBe('opus');
  });

  // --- Agent model override ---

  test('overrides model from agent frontmatter when task uses default opus', async () => {
    let callCount = 0;
    const task = makeTask({ agent: 'fast-agent' }); // no explicit model → defaults to opus
    const agents: AgentInfo[] = [
      { name: 'fast-agent', description: 'Fast', model: 'sonnet', file: 'fast-agent.md' },
    ];

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts({ agents }), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].model).toBe('sonnet');
  });

  test('does not override model when task explicitly sets model', async () => {
    let callCount = 0;
    const task = makeTask({ agent: 'fast-agent', model: 'sonnet' });
    const agents: AgentInfo[] = [
      { name: 'fast-agent', description: 'Fast', model: 'opus', file: 'fast-agent.md' },
    ];

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts({ agents }), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    // Task explicitly set sonnet, agent says opus, but agent override only applies when task uses default opus
    expect(spawnCall[0].model).toBe('sonnet');
  });

  // --- ProcessManager lifecycle ---

  test('creates and disposes ProcessManager', async () => {
    let disposed = false;
    const mockPm = new ProcessManager({ kill: () => true });
    const origDispose = mockPm.dispose.bind(mockPm);
    mockPm.dispose = () => { disposed = true; origDispose(); };

    const deps = makeRunDeps({
      createProcessManager: mock(() => mockPm),
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.createProcessManager).toHaveBeenCalled();
    expect(disposed).toBe(true);
  });

  // --- Cleanup temp files ---

  test('cleans up temp files on exit', async () => {
    const unlinkCalls: string[] = [];
    const existsSync = mock((p: string) => {
      if (typeof p === 'string' && p.endsWith('tasks.json')) return true;
      if (typeof p === 'string' && (p.endsWith('.ralph_complete') || p.endsWith('.ralph_prev_notes') || p.endsWith('.ralph_completed_ids'))) return true;
      return false;
    });

    const deps = makeRunDeps({
      existsSync,
      selectNextTask: mock(() => null),
      unlinkSync: mock((p: string) => { unlinkCalls.push(p); }),
    });

    await runRun(makeRunOpts(), deps);

    // Should attempt to clean up temp files
    expect(unlinkCalls.some(p => p.endsWith('.ralph_complete'))).toBe(true);
    expect(unlinkCalls.some(p => p.endsWith('.ralph_prev_notes'))).toBe(true);
    expect(unlinkCalls.some(p => p.endsWith('.ralph_completed_ids'))).toBe(true);
  });

  // --- RALPH_TASK_CONTEXT env ---

  test('sets RALPH_TASK_CONTEXT env var during iteration', async () => {
    let capturedContext: string | undefined;
    let callCount = 0;
    const task = makeTask({ title: 'Build the widget' });

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      spawnClaude: mock(async () => {
        capturedContext = process.env.RALPH_TASK_CONTEXT;
        return { exitCode: 0 };
      }),
    });

    await runRun(makeRunOpts(), deps);

    expect(capturedContext).toBe('Build the widget');
  });

  // --- Validate tests receives correct task ---

  test('passes current task to validateTaskTests', async () => {
    let callCount = 0;
    const task = makeTask({ id: 42, title: 'Important task', tests: ['bun test'] });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const validateCall = (deps.validateTaskTests as ReturnType<typeof mock>).mock.calls[0];
    expect(validateCall[0].task.id).toBe(42);
    expect(validateCall[0].tasksFilePath).toBe('/projects/myapp/.ralph/tasks.json');
    expect(validateCall[0].projectRoot).toBe('/projects/myapp');
  });

  // --- Tasks file read for task list ---

  test('reads tasks.json to get task list for selectNextTask', async () => {
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2, status: 'complete' })];
    const deps = makeRunDeps({
      readTasksFile: mock(() => ({ data: { tasks }, repaired: false, restored: false })),
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.readTasksFile).toHaveBeenCalled();
    const selectCall = (deps.selectNextTask as ReturnType<typeof mock>).mock.calls[0];
    expect(selectCall[0]).toHaveLength(2);
  });

  // --- Timeout passed to spawnClaude ---

  test('passes timeout to spawnClaude (default 900s)', async () => {
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].timeout).toBe(900_000); // 900 seconds in ms
  });

  test('passes custom timeout to spawnClaude', async () => {
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts({ iterationTimeout: 600 }), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].timeout).toBe(600_000);
  });

  // --- Multiple iterations ---

  test('runs multiple iterations until no tasks remain', async () => {
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        if (callCount <= 3) return makeTask({ id: callCount });
        return null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.spawnClaude).toHaveBeenCalledTimes(3);
    expect(deps.archiveCompletedTasks).toHaveBeenCalledTimes(3);
  });

  // --- buildIterationPrompt args ---

  test('passes correct args to buildIterationPrompt', async () => {
    let callCount = 0;
    const task = makeTask({ id: 5, title: 'My task' });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts({ maxIterations: 10 }), deps);

    const call = (deps.buildIterationPrompt as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toEqual(task);     // task
    expect(call[1]).toBe(1);           // iteration (1-indexed)
    expect(call[2]).toBe(10);          // maxIterations
    expect(call[3]).toBeNull();        // prevNotes (first iteration)
    expect(typeof call[4]).toBe('number'); // totalRemaining
  });

  // --- buildSystemPrompt args ---

  test('passes correct args to buildSystemPrompt', async () => {
    let callCount = 0;
    const task = makeTask({ id: 5, directory: 'src/lib', agent: 'test-agent' });
    const agents: AgentInfo[] = [
      { name: 'test-agent', description: 'Tester', model: 'sonnet', file: 'test-agent.md' },
    ];

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts({ agents }), deps);

    const call = (deps.buildSystemPrompt as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0].taskDir).toBe('src/lib');
    expect(call[0].taskAgent).toBe('test-agent');
    expect(call[0].projectRoot).toBe('/projects/myapp');
    expect(call[0].dataDir).toBe('/projects/myapp/.ralph');
    expect(call[0].agents).toEqual(agents);
    expect(call[0].iteration).toBe(1);
  });

  // --- spawnClaude receives processManager ---

  test('passes processManager to spawnClaude', async () => {
    let callCount = 0;
    const mockPm = new ProcessManager({ kill: () => true });
    const deps = makeRunDeps({
      createProcessManager: mock(() => mockPm),
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].processManager).toBe(mockPm);

    mockPm.dispose();
  });

  // --- Remaining count calculation ---

  test('calculates remaining tasks for iteration prompt', async () => {
    const tasks = [
      makeTask({ id: 1, status: 'pending' }),
      makeTask({ id: 2, status: 'pending', priority: 2 }),
      makeTask({ id: 3, status: 'complete', priority: 3 }),
    ];

    let callCount = 0;
    const deps = makeRunDeps({
      readTasksFile: mock(() => ({ data: { tasks }, repaired: false, restored: false })),
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? tasks[0] : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    // totalRemaining should count pending + in-progress tasks
    const call = (deps.buildIterationPrompt as ReturnType<typeof mock>).mock.calls[0];
    expect(call[4]).toBe(2); // 2 pending tasks
  });

  // --- Iteration logging ---

  test('writes iteration log header on startup', async () => {
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps);

    const calls = (deps.appendFileSync as ReturnType<typeof mock>).mock.calls;
    // First call should be the header
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const [logPath, content] = calls[0];
    expect(logPath).toContain('.ralph_iterations.log');
    expect(content).toContain('Ralph Execution Loop Started');
  });

  test('logs iteration start with task info', async () => {
    let callCount = 0;
    const task = makeTask({ id: 7, title: 'Build widget' });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const calls = (deps.appendFileSync as ReturnType<typeof mock>).mock.calls;
    const startLog = calls.find(([, content]: [string, string]) =>
      content.includes('Iteration 1') && content.includes('#7') && content.includes('Build widget')
    );
    expect(startLog).toBeDefined();
  });

  test('logs iteration completion with status', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1 });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      spawnClaude: mock(async () => ({ exitCode: 0 })),
    });

    await runRun(makeRunOpts(), deps);

    const calls = (deps.appendFileSync as ReturnType<typeof mock>).mock.calls;
    const endLog = calls.find(([, content]: [string, string]) =>
      content.includes('Iteration 1') && content.includes('SUCCESS')
    );
    expect(endLog).toBeDefined();
  });

  test('logs timeout status in iteration log', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1 });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      spawnClaude: mock(async () => ({ exitCode: 124 })),
    });

    await runRun(makeRunOpts(), deps);

    const calls = (deps.appendFileSync as ReturnType<typeof mock>).mock.calls;
    const timeoutLog = calls.find(([, content]: [string, string]) =>
      content.includes('TIMEOUT')
    );
    expect(timeoutLog).toBeDefined();
  });

  test('logs failure status with exit code', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1 });
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      spawnClaude: mock(async () => ({ exitCode: 2 })),
    });

    await runRun(makeRunOpts(), deps);

    const calls = (deps.appendFileSync as ReturnType<typeof mock>).mock.calls;
    const failLog = calls.find(([, content]: [string, string]) =>
      content.includes('FAILED') && content.includes('exit code: 2')
    );
    expect(failLog).toBeDefined();
  });

  // --- Narration lifecycle ---

  test('starts narration server when config.narration.enabled', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'af_sarah', ntfyTopic: '' } });
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts({ config }), deps);

    expect(deps.startNarrationServer).toHaveBeenCalledTimes(1);
  });

  test('does not start narration server when disabled', async () => {
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps); // default config has narration.enabled: false

    expect(deps.startNarrationServer).not.toHaveBeenCalled();
  });

  test('registers narration PID with ProcessManager', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'bf_emma', ntfyTopic: '' } });
    const mockPm = new ProcessManager({ kill: () => true });
    const registerSpy = spyOn(mockPm, 'register');

    const deps = makeRunDeps({
      createProcessManager: mock(() => mockPm),
      startNarrationServer: mock(async () => 55555),
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts({ config }), deps);

    expect(registerSpy).toHaveBeenCalledWith('narration', 55555);
    mockPm.dispose();
  });

  test('stops narration server on loop exit', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'bf_emma', ntfyTopic: '' } });
    const deps = makeRunDeps({
      startNarrationServer: mock(async () => 55555),
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts({ config }), deps);

    expect(deps.stopNarrationServer).toHaveBeenCalledTimes(1);
    const stopCall = (deps.stopNarrationServer as ReturnType<typeof mock>).mock.calls[0];
    expect(stopCall[0]).toBe(55555);
  });

  test('checks narration health each iteration and restarts if dead', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'bf_emma', ntfyTopic: '' } });
    let callCount = 0;
    let healthCheckCount = 0;

    const deps = makeRunDeps({
      startNarrationServer: mock(async () => 55555),
      checkNarrationHealth: mock(async () => {
        healthCheckCount++;
        // Return unhealthy on 2nd check only (iteration 2)
        return healthCheckCount !== 2;
      }),
      selectNextTask: mock(() => {
        callCount++;
        // Return task for first 2 iterations, then null
        return callCount <= 2 ? makeTask({ id: callCount }) : null;
      }),
    });

    await runRun(makeRunOpts({ config }), deps);

    // Health check runs each iteration (3 loops: 2 with tasks + 1 that finds no task)
    expect(deps.checkNarrationHealth).toHaveBeenCalledTimes(3);
    // start: initial(1) + restart on iter 2(1) = 2
    expect(deps.startNarrationServer).toHaveBeenCalledTimes(2);
    // stopNarrationServer called for dead server + final cleanup
    expect(deps.stopNarrationServer).toHaveBeenCalled();
  });

  test('passes narrate callback in streamOpts when narration enabled', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'bf_emma', ntfyTopic: '' } });
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts({ config }), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].streamOpts.narrate).toBeDefined();
    expect(typeof spawnCall[0].streamOpts.narrate).toBe('function');
  });

  test('does not pass narrate callback when narration disabled', async () => {
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].streamOpts.narrate).toBeUndefined();
  });

  test('continues without narration if server fails to start', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'bf_emma', ntfyTopic: '' } });
    const deps = makeRunDeps({
      startNarrationServer: mock(async () => { throw new Error('spawn failed'); }),
      selectNextTask: mock(() => null),
    });

    // Should not throw — graceful degradation
    await runRun(makeRunOpts({ config }), deps);

    expect(deps.stopNarrationServer).not.toHaveBeenCalled();
  });

  // --- Final summary ---

  test('prints final summary with iteration count', async () => {
    let callCount = 0;
    const logs: string[] = [];
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 3 ? makeTask({ id: callCount }) : null;
      }),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    await runRun(makeRunOpts(), deps);

    const summaryLine = logs.find(l => l.includes('Iterations completed: 3'));
    expect(summaryLine).toBeDefined();
  });

  test('prints tasks completed count in final summary', async () => {
    let callCount = 0;
    const logs: string[] = [];
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 2 ? makeTask({ id: callCount }) : null;
      }),
      archiveCompletedTasks: mock(async () => ({ archivedCount: 1, prevNotes: null })),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    await runRun(makeRunOpts(), deps);

    const summaryLine = logs.find(l => l.includes('Tasks archived: 2'));
    expect(summaryLine).toBeDefined();
  });

  test('sends ntfy notification on completion when ntfyTopic is set', async () => {
    const config = makeTestConfig({ narration: { enabled: false, voice: 'bf_emma', ntfyTopic: 'my-topic' } });
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts({ config }), deps);

    expect(deps.sendNtfy).toHaveBeenCalled();
    const ntfyCall = (deps.sendNtfy as ReturnType<typeof mock>).mock.calls[0];
    expect(ntfyCall[1]).toBe('my-topic');
  });

  test('does not send ntfy when ntfyTopic is empty', async () => {
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.sendNtfy).not.toHaveBeenCalled();
  });

  test('narrates final summary when narration is enabled', async () => {
    const config = makeTestConfig({ narration: { enabled: true, voice: 'bf_emma', ntfyTopic: '' } });
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts({ config }), deps);

    // sendToNarrate should be called with some summary text
    expect(deps.sendToNarrate).toHaveBeenCalled();
  });

  test('sends completion ntfy with tada tags when all tasks complete', async () => {
    const config = makeTestConfig({ narration: { enabled: false, voice: 'bf_emma', ntfyTopic: 'my-topic' } });
    const existsSync = mock((p: string) => {
      if (typeof p === 'string' && p.endsWith('tasks.json')) return true;
      // Complete flag exists after first iteration
      if (typeof p === 'string' && p.endsWith('.ralph_complete')) return true;
      return false;
    });
    const deps = makeRunDeps({
      existsSync,
    });

    await runRun(makeRunOpts({ config }), deps);

    const ntfyCall = (deps.sendNtfy as ReturnType<typeof mock>).mock.calls[0];
    expect(ntfyCall[0]).toContain('complete');
    expect(ntfyCall[2]).toMatchObject({ tags: 'tada' });
  });

  test('passes ntfy callback in streamOpts when ntfyTopic is set', async () => {
    const config = makeTestConfig({ narration: { enabled: false, voice: 'bf_emma', ntfyTopic: 'my-topic' } });
    let callCount = 0;
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts({ config }), deps);

    const spawnCall = (deps.spawnClaude as ReturnType<typeof mock>).mock.calls[0];
    expect(spawnCall[0].streamOpts.ntfy).toBeDefined();
    expect(typeof spawnCall[0].streamOpts.ntfy).toBe('function');
  });

  // --- Post-task review integration ---

  test('captureGitSha is called before spawnClaude', async () => {
    const callOrder: string[] = [];
    let callCount = 0;
    const task = makeTask({ id: 1, title: 'Test task' });

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      captureGitSha: mock((p: string) => {
        callOrder.push('captureGitSha');
        return 'abc123';
      }),
      spawnClaude: mock(async () => {
        callOrder.push('spawnClaude');
        return { exitCode: 0 };
      }),
    });

    await runRun(makeRunOpts(), deps);

    expect(deps.captureGitSha).toHaveBeenCalledTimes(1);
    const shaIdx = callOrder.indexOf('captureGitSha');
    const spawnIdx = callOrder.indexOf('spawnClaude');
    expect(shaIdx).toBeLessThan(spawnIdx);
  });

  test('runPostTaskReview is called after validation when task is complete', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1, title: 'Test task' });

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      captureGitSha: mock(() => 'sha-before'),
      readTasksFile: mock(() => ({
        data: { tasks: [{ ...task, status: 'complete' as const }] },
        repaired: false,
        restored: false,
      })),
      runPostTaskReview: mock(async () => {}),
    });

    const config = makeTestConfig({ review: { postTask: true, maxIterations: 5 } });
    await runRun(makeRunOpts({ config }), deps);

    expect(deps.runPostTaskReview).toHaveBeenCalledTimes(1);
    const reviewCall = (deps.runPostTaskReview as ReturnType<typeof mock>).mock.calls[0][0];
    expect(reviewCall.projectRoot).toBe('/projects/myapp');
    expect(reviewCall.task).toEqual(task);
    expect(reviewCall.beforeSha).toBe('sha-before');
    expect(reviewCall.taskStatus).toBe('complete');
  });

  test('runPostTaskReview is NOT called when review.postTask is false', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1, title: 'Test task' });

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      captureGitSha: mock(() => 'sha-before'),
      readTasksFile: mock(() => ({
        data: { tasks: [{ ...task, status: 'complete' as const }] },
        repaired: false,
        restored: false,
      })),
      runPostTaskReview: mock(async () => {}),
    });

    // No review config (undefined)
    await runRun(makeRunOpts(), deps);

    expect(deps.runPostTaskReview).not.toHaveBeenCalled();
  });

  test('runPostTaskReview is NOT called when task status is not complete', async () => {
    let callCount = 0;
    const task = makeTask({ id: 1, title: 'Test task' });

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? task : null;
      }),
      captureGitSha: mock(() => 'sha-before'),
      readTasksFile: mock(() => ({
        data: { tasks: [{ ...task, status: 'in-progress' as const }] },
        repaired: false,
        restored: false,
      })),
      runPostTaskReview: mock(async () => {}),
    });

    const config = makeTestConfig({ review: { postTask: true, maxIterations: 5 } });
    await runRun(makeRunOpts({ config }), deps);

    expect(deps.runPostTaskReview).not.toHaveBeenCalled();
  });

  // --- Defensive I/O: readTasksFile + snapshot + corruption counter + notes tempfile sweep ---

  test('main-loop read goes through readTasksFile with dataDir option', async () => {
    let callCount = 0;
    const readTasksFile = mock(() => ({
      data: { tasks: [makeTask()] },
      repaired: false,
      restored: false,
    }));
    const deps = makeRunDeps({
      readTasksFile,
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    expect(readTasksFile).toHaveBeenCalled();
    const call = (readTasksFile as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toContain('tasks.json');
    expect(call[1]).toEqual({ dataDir: '/projects/myapp/.ralph' });
  });

  test('post-task-review re-read goes through readTasksFile (not readFileSync)', async () => {
    const task = makeTask({ id: 1, title: 'Test task' });
    let selectCalls = 0;
    let readCalls = 0;
    const readTasksFile = mock(() => {
      readCalls++;
      return {
        data: { tasks: [{ ...task, status: 'complete' as const }] },
        repaired: false,
        restored: false,
      };
    });

    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        selectCalls++;
        return selectCalls <= 1 ? task : null;
      }),
      readTasksFile,
      captureGitSha: mock(() => 'sha'),
      runPostTaskReview: mock(async () => {}),
    });

    const config = makeTestConfig({ review: { postTask: true, maxIterations: 5 } });
    await runRun(makeRunOpts({ config }), deps);

    // Main-loop read (iter 1) + post-review re-read (iter 1) + main-loop read (iter 2, returns null)
    expect(readCalls).toBeGreaterThanOrEqual(2);
    expect(deps.runPostTaskReview).toHaveBeenCalledTimes(1);
  });

  test('corruptionEvents increments by 1 when readTasksFile returns repaired:true', async () => {
    const logs: string[] = [];
    const readTasksFile = mock(() => ({
      data: { tasks: [makeTask()] },
      repaired: true,
      restored: false,
    }));
    const deps = makeRunDeps({
      readTasksFile,
      selectNextTask: mock(() => null),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    await runRun(makeRunOpts(), deps);

    const line = logs.find(l => l.includes('corruption events recovered'));
    expect(line).toBeDefined();
    expect(line).toContain('1 corruption events recovered');
  });

  test('corruptionEvents increments by 1 when readTasksFile returns restored:true', async () => {
    const logs: string[] = [];
    const readTasksFile = mock(() => ({
      data: { tasks: [makeTask()] },
      repaired: false,
      restored: true,
    }));
    const deps = makeRunDeps({
      readTasksFile,
      selectNextTask: mock(() => null),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    await runRun(makeRunOpts(), deps);

    const line = logs.find(l => l.includes('corruption events recovered'));
    expect(line).toBeDefined();
    expect(line).toContain('1 corruption events recovered');
  });

  test('corruptionEvents accumulates across multiple calls (main + post-review)', async () => {
    const task = makeTask({ id: 1 });
    let selectCalls = 0;
    const readTasksFile = mock(() => ({
      data: { tasks: [{ ...task, status: 'complete' as const }] },
      repaired: true,
      restored: false,
    }));
    const logs: string[] = [];
    const deps = makeRunDeps({
      selectNextTask: mock(() => {
        selectCalls++;
        return selectCalls <= 1 ? task : null;
      }),
      readTasksFile,
      captureGitSha: mock(() => 'sha'),
      runPostTaskReview: mock(async () => {}),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    const config = makeTestConfig({ review: { postTask: true, maxIterations: 5 } });
    await runRun(makeRunOpts({ config }), deps);

    // 3 reads: main-iter1 + post-review + main-iter2 — all repaired
    const line = logs.find(l => l.includes('corruption events recovered'));
    expect(line).toBeDefined();
    expect(line).toContain('3 corruption events recovered');
  });

  test('final summary emits exact corruption-events line when N > 0', async () => {
    const readTasksFile = mock(() => ({
      data: { tasks: [makeTask()] },
      repaired: true,
      restored: false,
    }));
    const logs: string[] = [];
    const deps = makeRunDeps({
      readTasksFile,
      selectNextTask: mock(() => null),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    await runRun(makeRunOpts(), deps);

    const line = logs.find(l => l.includes('corruption events recovered'));
    expect(line).toBe('\u26a0 1 corruption events recovered this run \u2014 see /projects/myapp/.ralph/corruption.log');
  });

  test('final summary omits corruption-events line when N === 0', async () => {
    const logs: string[] = [];
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
      log: mock((...args: unknown[]) => { logs.push(args.map(String).join(' ')); }),
    });

    await runRun(makeRunOpts(), deps);

    const line = logs.find(l => l.includes('corruption events recovered'));
    expect(line).toBeUndefined();
  });

  test('ntfy body includes corruption count when ntfyTopic is set and corruption occurred', async () => {
    const config = makeTestConfig({ narration: { enabled: false, voice: 'bf_emma', ntfyTopic: 'my-topic' } });
    const readTasksFile = mock(() => ({
      data: { tasks: [makeTask()] },
      repaired: true,
      restored: false,
    }));
    const deps = makeRunDeps({
      readTasksFile,
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts({ config }), deps);

    expect(deps.sendNtfy).toHaveBeenCalled();
    const ntfyCall = (deps.sendNtfy as ReturnType<typeof mock>).mock.calls[0];
    const body = ntfyCall[0];
    expect(body).toContain('1 corruption');
  });

  test('ntfy body does NOT mention corruption when zero corruption events', async () => {
    const config = makeTestConfig({ narration: { enabled: false, voice: 'bf_emma', ntfyTopic: 'my-topic' } });
    const deps = makeRunDeps({
      selectNextTask: mock(() => null),
    });

    await runRun(makeRunOpts({ config }), deps);

    const ntfyCall = (deps.sendNtfy as ReturnType<typeof mock>).mock.calls[0];
    expect(ntfyCall[0]).not.toContain('corruption');
  });

  test('snapshotTasksFile is called after successful main-loop read', async () => {
    let callCount = 0;
    const snapshotTasksFile = mock(() => undefined);
    const deps = makeRunDeps({
      snapshotTasksFile,
      selectNextTask: mock(() => {
        callCount++;
        return callCount <= 1 ? makeTask() : null;
      }),
    });

    await runRun(makeRunOpts(), deps);

    expect(snapshotTasksFile).toHaveBeenCalled();
    const call = (snapshotTasksFile as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toContain('tasks.json');
    expect(call[1]).toBe('/projects/myapp/.ralph');
  });

  test('cleanup sweeps .ralph_task_<id>_notes.md files from dataDir at run end', async () => {
    const readdirSync = mock(() => [
      '.ralph_task_1_notes.md',
      '.ralph_task_42_notes.md',
      '.ralph_task_999_notes.md',
      'other.md',
      'tasks.json',
      '.ralph_task_notes.md', // missing <id> — should NOT match
    ]);
    const unlinked: string[] = [];
    const deps = makeRunDeps({
      readdirSync,
      selectNextTask: mock(() => null),
      unlinkSync: mock((p: string) => { unlinked.push(p); }),
    });

    await runRun(makeRunOpts(), deps);

    expect(readdirSync).toHaveBeenCalledWith('/projects/myapp/.ralph');
    expect(unlinked.some(p => p.endsWith('.ralph_task_1_notes.md'))).toBe(true);
    expect(unlinked.some(p => p.endsWith('.ralph_task_42_notes.md'))).toBe(true);
    expect(unlinked.some(p => p.endsWith('.ralph_task_999_notes.md'))).toBe(true);
    expect(unlinked.some(p => p.endsWith('other.md'))).toBe(false);
    expect(unlinked.some(p => p === '/projects/myapp/.ralph/tasks.json')).toBe(false);
    expect(unlinked.some(p => p.endsWith('.ralph_task_notes.md') && !/_\d+_/.test(p))).toBe(false);
  });

  test('notes-tempfile sweep does not crash when readdirSync throws', async () => {
    const readdirSync = mock(() => { throw new Error('ENOENT'); });
    const deps = makeRunDeps({
      readdirSync,
      selectNextTask: mock(() => null),
    });

    // Should not throw — readdirSync failure must be swallowed
    await runRun(makeRunOpts(), deps);
  });
});
