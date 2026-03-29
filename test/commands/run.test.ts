import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Readable, Writable, PassThrough } from 'stream';
import { buildSystemPrompt, spawnClaude, type SystemPromptInput, type SpawnClaudeDeps } from '../../src/commands/run';
import { ProcessManager } from '../../src/process';
import type { RalphConfig, AgentInfo } from '../../src/types';

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
    expect(prompt).toContain("1. IMMEDIATELY set the task's status to 'in-progress'");
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
    expect(prompt).toContain('iteration-N');
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
