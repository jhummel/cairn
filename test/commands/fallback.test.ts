import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as path from 'path';
import { resolveRalphRoot } from '../../src/utils';

// We'll mock spawnSync at the module level
let spawnSyncMock: ReturnType<typeof mock>;
let processExitMock: ReturnType<typeof spyOn>;

// The ralph repo root (this project)
const ralphRoot = resolveRalphRoot();

describe('shellFallback', () => {
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
    }
    // Set up env vars that shellFallback expects to be present
    process.env.RALPH_PROJECT_ROOT = '/tmp/test-project';
    process.env.RALPH_DATA_DIR = '/tmp/test-project/.ralph';
    process.env.RALPH_LIB_DIR = path.join(ralphRoot, 'lib');
    process.env.RALPH_NARRATE_PYTHON = path.join(ralphRoot, '.venv', 'bin', 'python3');

    processExitMock = spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    processExitMock.mockRestore();
  });

  test('plan command maps to lib/ralph_plan.sh', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('plan', []);

    expect(spawnMock).toHaveBeenCalled();
    const call = spawnMock.mock.calls[0];
    expect(call[0]).toBe('bash');
    expect(call[1]).toContain(path.join(ralphRoot, 'lib', 'ralph_plan.sh'));
    expect(processExitMock).toHaveBeenCalledWith(0);

    spawnMock.mockRestore();
  });

  test('run command maps to lib/ralph_loop.sh', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('run', ['--iterations', '5']);

    const call = spawnMock.mock.calls[0];
    expect(call[0]).toBe('bash');
    expect(call[1]).toContain(path.join(ralphRoot, 'lib', 'ralph_loop.sh'));
    // Args should be passed through
    expect(call[1]).toContain('--iterations');
    expect(call[1]).toContain('5');

    spawnMock.mockRestore();
  });

  test('narrate command delegates to bin/ralph narrate', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('narrate', ['--voice', 'bf_emma']);

    const call = spawnMock.mock.calls[0];
    expect(call[0]).toBe(path.join(ralphRoot, 'bin', 'ralph'));
    expect(call[1]).toEqual(['narrate', '--voice', 'bf_emma']);

    spawnMock.mockRestore();
  });

  test('sets required env vars in spawned process', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('plan', []);

    const call = spawnMock.mock.calls[0];
    const env = call[2]?.env as Record<string, string>;
    expect(env.RALPH_PROJECT_ROOT).toBe('/tmp/test-project');
    expect(env.RALPH_DATA_DIR).toBe('/tmp/test-project/.ralph');
    expect(env.RALPH_LIB_DIR).toBe(path.join(ralphRoot, 'lib'));
    expect(env.RALPH_NARRATE_PYTHON).toBeTruthy();

    spawnMock.mockRestore();
  });

  test('uses stdio inherit for interactive behavior', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('plan', []);

    const call = spawnMock.mock.calls[0];
    expect(call[2]?.stdio).toBe('inherit');

    spawnMock.mockRestore();
  });

  test('exits with shell script exit code', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 42, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('plan', []);

    expect(processExitMock).toHaveBeenCalledWith(42);

    spawnMock.mockRestore();
  });

  test('exits with code 1 when status is null', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: null, signal: 'SIGTERM', output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('plan', []);

    expect(processExitMock).toHaveBeenCalledWith(1);

    spawnMock.mockRestore();
  });

  test('unknown command falls back to bin/ralph', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { shellFallback } = await import('../../src/commands/fallback');
    shellFallback('unknown-cmd', ['--flag']);

    const call = spawnMock.mock.calls[0];
    expect(call[0]).toBe(path.join(ralphRoot, 'bin', 'ralph'));
    expect(call[1]).toEqual(['unknown-cmd', '--flag']);

    spawnMock.mockRestore();
  });
});

describe('forceShellFallback', () => {
  let processExitMock: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.RALPH_PROJECT_ROOT = '/tmp/test-project';
    process.env.RALPH_DATA_DIR = '/tmp/test-project/.ralph';
    process.env.RALPH_LIB_DIR = path.join(ralphRoot, 'lib');
    processExitMock = spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    processExitMock.mockRestore();
    delete process.env.RALPH_PROJECT_ROOT;
    delete process.env.RALPH_DATA_DIR;
    delete process.env.RALPH_LIB_DIR;
  });

  test('delegates entire invocation to bin/ralph', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { forceShellFallback } = await import('../../src/commands/fallback');
    forceShellFallback(['status', '--verbose']);

    const call = spawnMock.mock.calls[0];
    expect(call[0]).toBe(path.join(ralphRoot, 'bin', 'ralph'));
    expect(call[1]).toEqual(['status', '--verbose']);

    spawnMock.mockRestore();
  });

  test('passes all args through to bin/ralph', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { forceShellFallback } = await import('../../src/commands/fallback');
    forceShellFallback(['plan', '--some-flag', 'value']);

    const call = spawnMock.mock.calls[0];
    expect(call[0]).toBe(path.join(ralphRoot, 'bin', 'ralph'));
    expect(call[1]).toEqual(['plan', '--some-flag', 'value']);

    spawnMock.mockRestore();
  });

  test('exits with bin/ralph exit code', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 7, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { forceShellFallback } = await import('../../src/commands/fallback');
    forceShellFallback(['status']);

    expect(processExitMock).toHaveBeenCalledWith(7);

    spawnMock.mockRestore();
  });

  test('uses stdio inherit', async () => {
    const child_process = await import('child_process');
    const spawnMock = spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0, signal: null, output: [], pid: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
    } as any);

    const { forceShellFallback } = await import('../../src/commands/fallback');
    forceShellFallback(['help']);

    const call = spawnMock.mock.calls[0];
    expect(call[2]?.stdio).toBe('inherit');

    spawnMock.mockRestore();
  });
});

describe('COMMAND_SCRIPT_MAP', () => {
  test('exports correct command-to-script mapping', async () => {
    const { COMMAND_SCRIPT_MAP } = await import('../../src/commands/fallback');
    expect(COMMAND_SCRIPT_MAP.plan).toBe('ralph_plan.sh');
    expect(COMMAND_SCRIPT_MAP.run).toBe('ralph_loop.sh');
  });

  test('init, summarize, and narrate are not in script map', async () => {
    const { COMMAND_SCRIPT_MAP } = await import('../../src/commands/fallback');
    expect(COMMAND_SCRIPT_MAP).not.toHaveProperty('init');
    expect(COMMAND_SCRIPT_MAP).not.toHaveProperty('summarize');
    expect(COMMAND_SCRIPT_MAP).not.toHaveProperty('narrate');
  });
});

describe('BIN_RALPH_COMMANDS', () => {
  test('includes narrate (not init or summarize)', async () => {
    const { BIN_RALPH_COMMANDS } = await import('../../src/commands/fallback');
    expect(BIN_RALPH_COMMANDS).toContain('narrate');
    expect(BIN_RALPH_COMMANDS).not.toContain('init');
    expect(BIN_RALPH_COMMANDS).not.toContain('summarize');
  });
});
