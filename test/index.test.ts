import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createProgram, setupProjectContext, main } from '../src/index';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

  test('registers shell fallback commands (plan, run, summarize, init, narrate)', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('plan');
    expect(commandNames).toContain('run');
    expect(commandNames).toContain('summarize');
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('narrate');
  });
});

describe('setupProjectContext', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'RALPH_PROJECT_ROOT',
    'RALPH_DATA_DIR',
    'RALPH_LIB_DIR',
    'RALPH_NARRATE_PYTHON',
    'RALPH_PROJECT_NAME',
    'RALPH_PROJECT_DESC',
    'RALPH_HEALTH_CHECK',
    'RALPH_TEST_CMD',
    'RALPH_IMPL_FILE',
    'RALPH_CLAUDE_MD_PATTERN',
    'RALPH_TRUNCATE_TEXT',
    'RALPH_NARRATION_ENABLED',
    'RALPH_NARRATION_VOICE',
    'RALPH_NTFY_TOPIC',
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

  test('sets RALPH_PROJECT_ROOT env var', () => {
    const result = setupProjectContext();
    expect(process.env.RALPH_PROJECT_ROOT).toBe(result.projectRoot);
    expect(result.projectRoot).toBeTruthy();
  });

  test('sets RALPH_DATA_DIR to <projectRoot>/.ralph', () => {
    const result = setupProjectContext();
    expect(process.env.RALPH_DATA_DIR).toBe(path.join(result.projectRoot, '.ralph'));
    expect(result.dataDir).toBe(path.join(result.projectRoot, '.ralph'));
  });

  test('sets RALPH_LIB_DIR to <ralphRoot>/lib', () => {
    const result = setupProjectContext();
    expect(process.env.RALPH_LIB_DIR).toBe(path.join(result.ralphRoot, 'lib'));
    expect(result.libDir).toBe(path.join(result.ralphRoot, 'lib'));
  });

  test('sets RALPH_NARRATE_PYTHON', () => {
    const result = setupProjectContext();
    expect(process.env.RALPH_NARRATE_PYTHON).toBe(
      path.join(result.ralphRoot, '.venv', 'bin', 'python3')
    );
  });

  test('sets config env vars', () => {
    setupProjectContext();
    // Config env vars should be set (at minimum project name)
    expect(process.env.RALPH_PROJECT_NAME).toBeTruthy();
    expect(process.env.RALPH_TRUNCATE_TEXT).toBeDefined();
  });

  test('respects --project-root override', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
    try {
      const result = setupProjectContext(tmpDir);
      expect(result.projectRoot).toBe(tmpDir);
      expect(process.env.RALPH_PROJECT_ROOT).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('auto-detects health check when not configured', () => {
    // Since we're running in the ralph project root which has package.json,
    // the health check may or may not be auto-detected. Just verify it's set.
    setupProjectContext();
    expect(process.env.RALPH_HEALTH_CHECK).toBeDefined();
  });
});

describe('main', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.RALPH_FORCE_SHELL = process.env.RALPH_FORCE_SHELL;
    savedEnv.RALPH_PROJECT_ROOT = process.env.RALPH_PROJECT_ROOT;
    delete process.env.RALPH_FORCE_SHELL;
  });

  afterEach(() => {
    if (savedEnv.RALPH_FORCE_SHELL !== undefined) {
      process.env.RALPH_FORCE_SHELL = savedEnv.RALPH_FORCE_SHELL;
    } else {
      delete process.env.RALPH_FORCE_SHELL;
    }
    if (savedEnv.RALPH_PROJECT_ROOT !== undefined) {
      process.env.RALPH_PROJECT_ROOT = savedEnv.RALPH_PROJECT_ROOT;
    } else {
      delete process.env.RALPH_PROJECT_ROOT;
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

  test('edit command runs stub', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'ralph', 'edit']);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(output).toContain('edit tasks: not yet implemented');

    logSpy.mockRestore();
  });

  test('logs command runs stub', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    await main(['node', 'ralph', 'logs']);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(output).toContain('logs: not yet implemented');

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

    // Shell fallback
    expect(commandNames).toContain('plan');
    expect(commandNames).toContain('run');
    expect(commandNames).toContain('summarize');
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('narrate');
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
