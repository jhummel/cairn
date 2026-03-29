import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable, PassThrough } from 'stream';
import { EventEmitter } from 'events';
import {
  buildContext,
  buildClaudeMdPruning,
  buildSummarizePrompt,
  runSummarize,
} from '../../src/commands/summarize';
import type { SpawnFn } from '../../src/commands/summarize';

describe('buildContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns base message when no completed tasks file', () => {
    const ctx = buildContext(tmpDir, 'tasks.completed.json');
    expect(ctx).toBe('Updating from the central task list.');
  });

  it('appends completed tasks reference when file exists', () => {
    const completedPath = path.join(tmpDir, '.ralph', 'tasks.completed.json');
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
    fs.writeFileSync(completedPath, '{}');
    const ctx = buildContext(tmpDir, completedPath);
    expect(ctx).toContain('Updating from the central task list.');
    expect(ctx).toContain('tasks.completed.json');
    expect(ctx).toContain('Completed tasks are in');
  });

  it('uses relative path in context string', () => {
    const completedPath = path.join(tmpDir, '.ralph', 'tasks.completed.json');
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
    fs.writeFileSync(completedPath, '{}');
    const ctx = buildContext(tmpDir, completedPath);
    // Should be relative, not absolute
    expect(ctx).not.toContain(tmpDir);
    expect(ctx).toContain('.ralph/tasks.completed.json');
  });
});

describe('buildClaudeMdPruning', () => {
  it('includes custom pattern when provided', () => {
    const result = buildClaudeMdPruning('IMPLEMENTATION.md', '**/CLAUDE.md');
    expect(result).toContain('CLAUDE.MD PRUNING:');
    expect(result).toContain('**/CLAUDE.md');
    expect(result).toContain('IMPLEMENTATION.md');
  });

  it('uses generic lookup when no pattern provided', () => {
    const result = buildClaudeMdPruning('IMPLEMENTATION.md', '');
    expect(result).toContain('CLAUDE.MD PRUNING:');
    expect(result).toContain('look for any module-level CLAUDE.md');
    expect(result).not.toContain('**/');
  });

  it('always includes pruning rules', () => {
    const result = buildClaudeMdPruning('IMPLEMENTATION.md', '');
    expect(result).toContain('Remove entries that are no longer accurate');
    expect(result).toContain('Deduplicate entries');
    expect(result).toContain('strictly operational');
    expect(result).toContain('when in doubt, keep them');
  });
});

describe('buildSummarizePrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fresh project: no impl file, no completed tasks', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('IMPLEMENTATION.md');
    expect(prompt).toContain('my-project');
    expect(prompt).toContain('No existing IMPLEMENTATION.md');
    expect(prompt).toContain('create it from scratch');
    expect(prompt).toContain('Updating from the central task list.');
    // Should NOT contain completed tasks reference
    expect(prompt).not.toContain('Completed tasks are in');
  });

  it('existing impl file: instructs update in place', () => {
    const implPath = path.join(tmpDir, 'IMPLEMENTATION.md');
    fs.writeFileSync(implPath, '# Existing content\n');

    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('An existing IMPLEMENTATION.md is present');
    expect(prompt).toContain('update it in place');
    expect(prompt).not.toContain('create it from scratch');
  });

  it('with completed tasks: includes reference', () => {
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    const completedPath = path.join(ralphDir, 'tasks.completed.json');
    fs.writeFileSync(completedPath, '{}');

    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: completedPath,
      claudeMdPattern: '',
    });

    expect(prompt).toContain('Completed tasks are in');
    expect(prompt).toContain('.ralph/tasks.completed.json');
  });

  it('includes purpose description for summarize agent', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('You are updating IMPLEMENTATION.md');
    expect(prompt).toContain('test-proj');
    expect(prompt).toContain('PURPOSE:');
    expect(prompt).toContain('AUDIENCE:');
    expect(prompt).toContain('YOUR TASK:');
    expect(prompt).toContain('RULES:');
  });

  it('includes CLAUDE.md pruning section', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('CLAUDE.MD PRUNING:');
  });

  it('includes custom claudeMdPattern in pruning section', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: 'src/**/CLAUDE.md',
    });

    expect(prompt).toContain('src/**/CLAUDE.md');
  });

  it('uses custom implFile name', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'ARCHITECTURE.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('ARCHITECTURE.md');
    expect(prompt).not.toContain('IMPLEMENTATION.md');
  });

  it('includes structural guidance', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('System Overview');
    expect(prompt).toContain('Architecture');
    expect(prompt).toContain('Components');
  });
});

// Helper: create a fake child process for testing
function createFakeProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: () => boolean;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 12345;
  proc.kill = () => true;
  return proc;
}

describe('runSummarize', () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('spawns claude with correct arguments', async () => {
    const fakeProc = createFakeProcess();
    let capturedCmd = '';
    let capturedArgs: string[] = [];

    const mockSpawn: SpawnFn = (cmd, args, _opts) => {
      capturedCmd = cmd;
      capturedArgs = args as string[];
      // Close immediately
      setTimeout(() => {
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    await runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
    });

    expect(capturedCmd).toBe('claude');
    expect(capturedArgs).toContain('-p');
    expect(capturedArgs).toContain('--append-system-prompt');
    expect(capturedArgs).toContain('--output-format');
    expect(capturedArgs).toContain('stream-json');
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('sonnet');
    expect(capturedArgs).toContain('--dangerously-skip-permissions');
  });

  it('user prompt mentions the impl file', async () => {
    const fakeProc = createFakeProcess();
    let capturedArgs: string[] = [];

    const mockSpawn: SpawnFn = (cmd, args, _opts) => {
      capturedArgs = args as string[];
      setTimeout(() => {
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    await runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
    });

    // The -p argument value should contain the impl file name
    const pIndex = capturedArgs.indexOf('-p');
    expect(pIndex).toBeGreaterThanOrEqual(0);
    const userPrompt = capturedArgs[pIndex + 1];
    expect(userPrompt).toContain('IMPLEMENTATION.md');
  });

  it('reports line count when impl file exists after completion', async () => {
    const fakeProc = createFakeProcess();

    const mockSpawn: SpawnFn = (_cmd, _args, _opts) => {
      setTimeout(() => {
        // Simulate claude creating the file
        fs.writeFileSync(path.join(tmpDir, 'IMPLEMENTATION.md'), 'line1\nline2\nline3\n');
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    await runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
    });

    const output = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('IMPLEMENTATION.md updated');
    expect(output).toContain('4 lines');
  });

  it('reports "was not created" when impl file does not exist', async () => {
    const fakeProc = createFakeProcess();

    const mockSpawn: SpawnFn = (_cmd, _args, _opts) => {
      setTimeout(() => {
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    await runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
    });

    const output = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('IMPLEMENTATION.md was not created');
  });

  it('prints banner header and footer', async () => {
    const fakeProc = createFakeProcess();

    const mockSpawn: SpawnFn = (_cmd, _args, _opts) => {
      setTimeout(() => {
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    await runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
    });

    const output = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('=========');
    expect(output).toContain('Updating IMPLEMENTATION.md');
  });

  it('handles timeout by killing the process', async () => {
    const fakeProc = createFakeProcess();
    let killed = false;
    fakeProc.kill = () => { killed = true; return true; };

    const mockSpawn: SpawnFn = (_cmd, _args, _opts) => {
      // Never close — simulate a hanging process
      // The timeout will fire and kill it
      return fakeProc as any;
    };

    const promise = runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
      timeoutMs: 50, // 50ms timeout for fast test
    });

    // Wait a bit then simulate process exit after kill
    await new Promise(r => setTimeout(r, 80));
    fakeProc.stdout.end();
    fakeProc.emit('close', 1);

    await promise;

    expect(killed).toBe(true);
    const output = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('timed out');
  });

  it('sets cwd to projectRoot', async () => {
    const fakeProc = createFakeProcess();
    let capturedOpts: any = {};

    const mockSpawn: SpawnFn = (_cmd, _args, opts) => {
      capturedOpts = opts;
      setTimeout(() => {
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    await runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
    });

    expect(capturedOpts.cwd).toBe(tmpDir);
  });

  it('pipes stdout through processStream', async () => {
    const fakeProc = createFakeProcess();

    const mockSpawn: SpawnFn = (_cmd, _args, _opts) => {
      setTimeout(() => {
        // Send a stream-json line that processStream will handle
        fakeProc.stdout.write(JSON.stringify({
          type: 'system',
          subtype: 'init',
          model: 'sonnet',
          permissionMode: 'full',
        }) + '\n');
        fakeProc.stdout.end();
        fakeProc.emit('close', 0);
      }, 10);
      return fakeProc as any;
    };

    // Capture process.stdout writes
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as any;

    try {
      await runSummarize({
        projectRoot: tmpDir,
        projectName: 'test-proj',
        implFile: 'IMPLEMENTATION.md',
        completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
        claudeMdPattern: '',
        spawnFn: mockSpawn,
      });
    } finally {
      process.stdout.write = origWrite;
    }

    const allOutput = writes.join('');
    // processStream formats init events with [init] and model name
    expect(allOutput).toContain('[init]');
    expect(allOutput).toContain('sonnet');
  });
});
