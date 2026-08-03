import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createProgram, setupProjectContext, main } from '../src/index';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as summarizeModule from '../src/commands/summarize';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('createProgram', () => {
  test('creates a Commander program with correct name and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('ralph');
  });

  test('has --project-root option', () => {
    const program = createProgram();
    const opts = program.options.map((o) => o.long);
    expect(opts).toContain('--project-root');
  });

  test('has --version flag', () => {
    const program = createProgram();
    expect(program.version()).toBe('ralph 0.1.0');
  });

  test('registers ported commands (status, edit, logs)', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('edit');
    expect(commandNames).toContain('logs');
  });

  test('registers native run command (not a shell fallback)', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('run');
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd!.description()).not.toContain('[shell fallback]');
  });

  test('registers native narrate command (not a shell fallback)', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('narrate');
    const narrCmd = program.commands.find((c) => c.name() === 'narrate');
    expect(narrCmd!.description()).not.toContain('[shell fallback]');
  });

  test('registers native plan command (not a shell fallback)', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('plan');
    const planCmd = program.commands.find((c) => c.name() === 'plan');
    // Native commands don't have allowUnknownOption set to true
    expect(planCmd!.description()).toBe('Interactive planning session: discuss goals, generate tasks');
  });

  test('registers native init command', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('init');
  });

  test('registers native summarize command', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('summarize');
  });
});

describe('setupProjectContext', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'CAIRN_PROJECT_ROOT',
    'CAIRN_DATA_DIR',
    'CAIRN_LIB_DIR',
    'CAIRN_NARRATE_PYTHON',
    'CAIRN_PROJECT_NAME',
    'CAIRN_PROJECT_DESC',
    'CAIRN_HEALTH_CHECK',
    'CAIRN_TEST_CMD',
    'CAIRN_IMPL_FILE',
    'CAIRN_CLAUDE_MD_PATTERN',
    'CAIRN_TRUNCATE_TEXT',
    'CAIRN_NARRATION_ENABLED',
    'CAIRN_NARRATION_VOICE',
    'CAIRN_NTFY_TOPIC',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('sets CAIRN_PROJECT_ROOT env var', () => {
    const result = setupProjectContext();
    expect(process.env.CAIRN_PROJECT_ROOT).toBe(result.projectRoot);
    expect(result.projectRoot).toBeTruthy();
  });

  test('sets CAIRN_DATA_DIR to <projectRoot>/.ralph', () => {
    const result = setupProjectContext();
    expect(process.env.CAIRN_DATA_DIR).toBe(path.join(result.projectRoot, '.ralph'));
    expect(result.dataDir).toBe(path.join(result.projectRoot, '.ralph'));
  });

  test('sets CAIRN_LIB_DIR to <cairnRoot>/lib', () => {
    const result = setupProjectContext();
    expect(process.env.CAIRN_LIB_DIR).toBe(path.join(result.cairnRoot, 'lib'));
    expect(result.libDir).toBe(path.join(result.cairnRoot, 'lib'));
  });

  test('sets CAIRN_NARRATE_PYTHON', () => {
    const result = setupProjectContext();
    expect(process.env.CAIRN_NARRATE_PYTHON).toBe(
      path.join(result.cairnRoot, '.venv', 'bin', 'python3')
    );
  });

  test('sets config env vars', () => {
    setupProjectContext();
    // Config env vars should be set (at minimum project name)
    expect(process.env.CAIRN_PROJECT_NAME).toBeTruthy();
    expect(process.env.CAIRN_TRUNCATE_TEXT).toBeDefined();
  });

  test('respects --project-root override', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    try {
      const result = setupProjectContext(tmpDir);
      expect(result.projectRoot).toBe(tmpDir);
      expect(process.env.CAIRN_PROJECT_ROOT).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('auto-detects health check when not configured', () => {
    // Since we're running in the ralph project root which has package.json,
    // the health check may or may not be auto-detected. Just verify it's set.
    setupProjectContext();
    expect(process.env.CAIRN_HEALTH_CHECK).toBeDefined();
  });

  describe('data dir resolution', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('resolves an existing .cairn/ data dir', () => {
      fs.mkdirSync(path.join(tmpDir, '.cairn'));

      const result = setupProjectContext(tmpDir);

      expect(result.dataDir).toBe(path.join(tmpDir, '.cairn'));
      expect(process.env.CAIRN_DATA_DIR).toBe(path.join(tmpDir, '.cairn'));
    });

    test('falls back to an existing legacy .ralph/ data dir', () => {
      fs.mkdirSync(path.join(tmpDir, '.ralph'));

      const result = setupProjectContext(tmpDir);

      expect(result.dataDir).toBe(path.join(tmpDir, '.ralph'));
      expect(process.env.CAIRN_DATA_DIR).toBe(path.join(tmpDir, '.ralph'));
    });

    test('defaults to .cairn/ when neither layout exists', () => {
      const result = setupProjectContext(tmpDir);

      expect(result.dataDir).toBe(path.join(tmpDir, '.cairn'));
    });

    test('prefers .cairn/ when both layouts exist', () => {
      fs.mkdirSync(path.join(tmpDir, '.cairn'));
      fs.mkdirSync(path.join(tmpDir, '.ralph'));

      const result = setupProjectContext(tmpDir);

      expect(result.dataDir).toBe(path.join(tmpDir, '.cairn'));
    });
  });
});

describe('summarize action', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['CAIRN_PROJECT_ROOT', 'CAIRN_DATA_DIR'];
  let tmpDir: string;

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function capturedSummarizeOpts(): Promise<any> {
    const spy = spyOn(summarizeModule, 'runSummarize').mockImplementation(async () => {});
    try {
      await main(['node', 'ralph', '--project-root', tmpDir, 'summarize']);
      return spy.mock.calls[0]?.[0];
    } finally {
      spy.mockRestore();
    }
  }

  test('points completedTasksPath at the resolved .cairn/ data dir', async () => {
    fs.mkdirSync(path.join(tmpDir, '.cairn'));

    const opts = await capturedSummarizeOpts();

    expect(opts.completedTasksPath).toBe(
      path.join(tmpDir, '.cairn', 'tasks.completed.json')
    );
  });

  test('points completedTasksPath at a legacy .ralph/ data dir', async () => {
    fs.mkdirSync(path.join(tmpDir, '.ralph'));

    const opts = await capturedSummarizeOpts();

    expect(opts.completedTasksPath).toBe(
      path.join(tmpDir, '.ralph', 'tasks.completed.json')
    );
  });
});

describe('main', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.CAIRN_PROJECT_ROOT = process.env.CAIRN_PROJECT_ROOT;
  });

  afterEach(() => {
    if (savedEnv.CAIRN_PROJECT_ROOT !== undefined) {
      process.env.CAIRN_PROJECT_ROOT = savedEnv.CAIRN_PROJECT_ROOT;
    } else {
      delete process.env.CAIRN_PROJECT_ROOT;
    }
  });

  test('--version outputs version string', async () => {
    const mockExit = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const logSpy = spyOn(process.stdout, 'write');

    try {
      await main(['node', 'ralph', '--version']);
    } catch {
      // Commander calls process.exit(0) after --version
    }

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('ralph 0.1.0');

    mockExit.mockRestore();
    logSpy.mockRestore();
  });

  test('status command outputs project info', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'ralph', 'status']);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(output).toContain('Project:');

    logSpy.mockRestore();
  });

  test('edit command opens file with editor', async () => {
    const spawnSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0, signal: null, pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    await main(['node', 'ralph', 'edit']);

    // Should have tried to open the ralph project's tasks.json in an editor
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, args] = spawnSpy.mock.calls[0];
    expect(args[0]).toContain('tasks.json');

    spawnSpy.mockRestore();
  });

  test('logs command prints log or "No iteration log found."', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'ralph', 'logs']);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
    // Either the log file exists and has content, or it doesn't exist
    const hasContent = output.length > 0;
    expect(hasContent || output.includes('No iteration log found.')).toBe(true);

    logSpy.mockRestore();
  });
});

describe('command registration', () => {
  test('all expected commands are registered', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    // Ported
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('edit');
    expect(commandNames).toContain('logs');
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('summarize');

    // Native plan command
    expect(commandNames).toContain('plan');

    // Native run and narrate
    expect(commandNames).toContain('run');
    expect(commandNames).toContain('narrate');
  });

  test('run command accepts optional [max] argument', () => {
    const program = createProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const args = runCmd!.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(false); // optional argument
  });

  test('narrate command accepts required <action> argument', () => {
    const program = createProgram();
    const narrCmd = program.commands.find((c) => c.name() === 'narrate');
    expect(narrCmd).toBeDefined();
    const args = narrCmd!.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true); // required argument
  });

  test('edit command accepts optional target argument', () => {
    const program = createProgram();
    const editCmd = program.commands.find((c) => c.name() === 'edit');
    expect(editCmd).toBeDefined();
    // Commander registers arguments; the [target] should be present
    const args = editCmd!.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(false); // optional argument
  });
});
