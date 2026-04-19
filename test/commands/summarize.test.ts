import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable, PassThrough } from 'stream';
import { EventEmitter } from 'events';
import {
  buildUserPrompt,
  runSummarize,
} from '../../src/commands/summarize';
import type { SpawnFn } from '../../src/commands/summarize';

function makeTempDir(withRalphDir = false, withAgentFile = false): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  if (withRalphDir) {
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
  }
  if (withAgentFile) {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'summarizer.md'), 'You are a summarizer agent.');
  }
  return tmpDir;
}

describe('buildUserPrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes project name and impl file', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('my-project');
    expect(prompt).toContain('IMPLEMENTATION.md');
  });

  it('fresh project: no impl file, create from scratch', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('No existing IMPLEMENTATION.md');
    expect(prompt).toContain('create it from scratch');
  });

  it('existing impl file: instructs update in place', () => {
    fs.writeFileSync(path.join(tmpDir, 'IMPLEMENTATION.md'), '# Existing\n');

    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('An existing IMPLEMENTATION.md is present');
    expect(prompt).toContain('update it in place');
  });

  it('includes completed tasks reference when file exists', () => {
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    const completedPath = path.join(ralphDir, 'tasks.completed.json');
    fs.writeFileSync(completedPath, '{}');

    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: completedPath,
      claudeMdPattern: '',
    });

    expect(prompt).toContain('Completed tasks are in');
    expect(prompt).toContain('.ralph/tasks.completed.json');
  });

  it('no completed tasks reference when file missing', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).not.toContain('Completed tasks are in');
  });

  it('includes custom claudeMdPattern in pruning section', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: 'src/**/CLAUDE.md',
    });

    expect(prompt).toContain('src/**/CLAUDE.md');
    expect(prompt).toContain('CLAUDE.MD PRUNING:');
  });

  it('uses generic lookup when no claudeMdPattern', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('look for any module-level CLAUDE.md');
  });

  it('includes pruning rules', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('Remove entries that are no longer accurate');
    expect(prompt).toContain('Deduplicate entries');
    expect(prompt).toContain('strictly operational');
    expect(prompt).toContain('when in doubt, keep them');
  });

  it('uses custom implFile name', () => {
    const prompt = buildUserPrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'ARCHITECTURE.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('ARCHITECTURE.md');
    expect(prompt).not.toContain('IMPLEMENTATION.md');
  });

  it('includes PERSONAL INSTRUCTIONS when instructions.md exists in dataDir', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-data-'));
    try {
      fs.writeFileSync(path.join(dataDir, 'instructions.md'), '* Always use TDD');
      const prompt = buildUserPrompt({
        projectRoot: tmpDir,
        projectName: 'test-proj',
        implFile: 'IMPLEMENTATION.md',
        completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
        claudeMdPattern: '',
        dataDir,
      });
      expect(prompt).toContain('PERSONAL INSTRUCTIONS:');
      expect(prompt).toContain('* Always use TDD');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('omits PERSONAL INSTRUCTIONS when instructions.md is missing from dataDir', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-data-'));
    try {
      const prompt = buildUserPrompt({
        projectRoot: tmpDir,
        projectName: 'test-proj',
        implFile: 'IMPLEMENTATION.md',
        completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
        claudeMdPattern: '',
        dataDir,
      });
      expect(prompt).not.toContain('PERSONAL INSTRUCTIONS:');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// Helper: create a fake child process for testing
function createFakeProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: () => boolean;
  };
  proc.stdin = stdin;
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
    tmpDir = makeTempDir(true, true);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('spawns claude with --agents and --agent args', async () => {
    const fakeProc = createFakeProcess();
    let capturedCmd = '';
    let capturedArgs: string[] = [];

    const mockSpawn: SpawnFn = (cmd, args, _opts) => {
      capturedCmd = cmd;
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

    expect(capturedCmd).toBe('claude');
    expect(capturedArgs).toContain('-p');
    expect(capturedArgs).toContain('--agents');
    expect(capturedArgs).toContain('--agent');
    expect(capturedArgs).toContain('summarizer');
    expect(capturedArgs).toContain('--output-format');
    expect(capturedArgs).toContain('stream-json');
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('sonnet');
    expect(capturedArgs).toContain('--verbose');
    expect(capturedArgs).toContain('--dangerously-skip-permissions');
  });

  it('user prompt is written to stdin with dynamic context', async () => {
    const fakeProc = createFakeProcess();
    let stdinData = '';
    fakeProc.stdin.on('data', (chunk: Buffer) => { stdinData += chunk.toString(); });

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

    expect(stdinData).toContain('IMPLEMENTATION.md');
    expect(stdinData).toContain('test-proj');
    expect(stdinData).toContain('CLAUDE.MD PRUNING:');
  });

  it('reports line count when impl file exists after completion', async () => {
    const fakeProc = createFakeProcess();

    const mockSpawn: SpawnFn = (_cmd, _args, _opts) => {
      setTimeout(() => {
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

  it('prints banner header', async () => {
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
      return fakeProc as any;
    };

    const promise = runSummarize({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
      spawnFn: mockSpawn,
      timeoutMs: 50,
    });

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
    expect(allOutput).toContain('[init]');
    expect(allOutput).toContain('sonnet');
  });
});
