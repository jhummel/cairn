import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as narration from '../../src/narration';

// We import the module under test after setting up mocks
// Import type for testing
type RunNarrateOpts = {
  pythonPath?: string;
  libDir?: string;
  pidFile?: string;
  socketPath?: string;
  voice?: string;
  startServer?: typeof narration.startNarrationServer;
  stopServer?: typeof narration.stopNarrationServer;
  spawnSyncFn?: typeof childProcess.spawnSync;
};

// Lazy import to avoid issues with env at module load time
async function importRunNarrate() {
  const mod = await import('../../src/commands/narrate');
  return mod.runNarrate;
}

const TEST_PID_FILE = path.join(os.tmpdir(), `cairn-narr-test-${Math.random().toString(36).slice(2)}.pid`);
const TEST_SOCK_PATH = path.join(os.tmpdir(), `cairn-narr-test-${Math.random().toString(36).slice(2)}.sock`);

describe('runNarrate', () => {
  let origEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    origEnv = { ...process.env };
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    // Ensure PID/sock files don't exist before each test
    if (fs.existsSync(TEST_PID_FILE)) fs.unlinkSync(TEST_PID_FILE);
    if (fs.existsSync(TEST_SOCK_PATH)) fs.unlinkSync(TEST_SOCK_PATH);
  });

  afterEach(() => {
    process.env = origEnv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Clean up test files
    if (fs.existsSync(TEST_PID_FILE)) fs.unlinkSync(TEST_PID_FILE);
    if (fs.existsSync(TEST_SOCK_PATH)) fs.unlinkSync(TEST_SOCK_PATH);
  });

  // --- Python validation ---

  it('throws when CAIRN_NARRATE_PYTHON is not set', async () => {
    delete process.env.CAIRN_NARRATE_PYTHON;
    const { runNarrate } = await import('../../src/commands/narrate');
    await expect(runNarrate('status')).rejects.toThrow(/CAIRN_NARRATE_PYTHON/);
  });

  it('throws when CAIRN_NARRATE_PYTHON path does not exist', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/nonexistent/python/bin/python';
    const { runNarrate } = await import('../../src/commands/narrate');
    await expect(runNarrate('status')).rejects.toThrow(/not found|CAIRN_NARRATE_PYTHON/i);
  });

  // --- status ---

  it('status: reports stopped when PID file does not exist', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('status', { pidFile: TEST_PID_FILE });
    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('stopped');
  });

  it('status: reports stopped and removes stale PID file when process not alive', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    // Write a PID that definitely doesn't exist
    fs.writeFileSync(TEST_PID_FILE, '999999999');

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('status', { pidFile: TEST_PID_FILE });

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('stopped');
    expect(fs.existsSync(TEST_PID_FILE)).toBe(false);
  });

  it('status: reports running when PID file exists and process is alive', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    // Use current process PID — it's definitely alive
    fs.writeFileSync(TEST_PID_FILE, String(process.pid));

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('status', { pidFile: TEST_PID_FILE });

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('running');
    expect(output).toContain(String(process.pid));
  });

  // --- on/start ---

  it('on: reports already running when PID file exists with live process', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    fs.writeFileSync(TEST_PID_FILE, String(process.pid));

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('on', { pidFile: TEST_PID_FILE });

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('already running');
  });

  it('start: same as on — reports already running when alive', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    fs.writeFileSync(TEST_PID_FILE, String(process.pid));

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('start', { pidFile: TEST_PID_FILE });

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('already running');
  });

  it('on: starts server, writes PID file, reports started', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';

    let startCalled = false;
    const mockStart = async (_opts: narration.StartNarrationOpts) => {
      startCalled = true;
      return 42;
    };

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('on', {
      pidFile: TEST_PID_FILE,
      socketPath: TEST_SOCK_PATH,
      startServer: mockStart,
    });

    expect(startCalled).toBe(true);
    expect(fs.existsSync(TEST_PID_FILE)).toBe(true);
    expect(fs.readFileSync(TEST_PID_FILE, 'utf8').trim()).toBe('42');

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('started');
    expect(output).toContain('42');
  });

  it('on: cleans PID file when start fails', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';

    const mockStart = async (_opts: narration.StartNarrationOpts) => {
      throw new Error('Failed to start server');
    };

    const { runNarrate } = await import('../../src/commands/narrate');
    await expect(
      runNarrate('on', {
        pidFile: TEST_PID_FILE,
        socketPath: TEST_SOCK_PATH,
        startServer: mockStart,
      }),
    ).rejects.toThrow('Failed to start server');

    expect(fs.existsSync(TEST_PID_FILE)).toBe(false);
  });

  // --- off/stop ---

  it('off: reports not running when PID file does not exist', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('off', { pidFile: TEST_PID_FILE });

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('not running');
  });

  it('stop: same as off — reports not running when no PID file', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('stop', { pidFile: TEST_PID_FILE });

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('not running');
  });

  it('off: stops server, removes PID file, reports stopped', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    const fakePid = 54321;
    fs.writeFileSync(TEST_PID_FILE, String(fakePid));

    let stopCalledWithPid = 0;
    let stopCalledWithSock = '';
    const mockStop = async (pid: number, socketPath?: string) => {
      stopCalledWithPid = pid;
      stopCalledWithSock = socketPath ?? '';
    };

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('off', {
      pidFile: TEST_PID_FILE,
      socketPath: TEST_SOCK_PATH,
      stopServer: mockStop,
    });

    expect(stopCalledWithPid).toBe(fakePid);
    expect(stopCalledWithSock).toBe(TEST_SOCK_PATH);
    expect(fs.existsSync(TEST_PID_FILE)).toBe(false);

    const output = consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(output).toContain('stopped');
  });

  // --- one-shot TTS ---

  it('unknown action: spawns cairn_narrate.py with spawnSync', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    process.env.CAIRN_LIB_DIR = '/usr/lib/cairn';

    let capturedCmd = '';
    let capturedArgs: string[] = [];
    let capturedOpts: any = {};

    const mockSpawnSync = (cmd: string, args: readonly string[], opts?: any): any => {
      capturedCmd = cmd;
      capturedArgs = [...args];
      capturedOpts = opts ?? {};
      return { status: 0 };
    };

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('Hello world', {
      spawnSyncFn: mockSpawnSync as any,
    });

    expect(capturedCmd).toBe('/usr/bin/true');
    expect(capturedArgs).toContain('Hello world');
    expect(capturedArgs.some((a) => a.includes('cairn_narrate.py'))).toBe(true);
    expect(capturedOpts.stdio).toBe('inherit');
  });

  it('unknown action: uses CAIRN_LIB_DIR for script path', async () => {
    process.env.CAIRN_NARRATE_PYTHON = '/usr/bin/true';
    process.env.CAIRN_LIB_DIR = '/custom/lib';

    let capturedArgs: string[] = [];
    const mockSpawnSync = (_cmd: string, args: readonly string[], _opts?: any): any => {
      capturedArgs = [...args];
      return { status: 0 };
    };

    const { runNarrate } = await import('../../src/commands/narrate');
    await runNarrate('speak this text', { spawnSyncFn: mockSpawnSync as any });

    expect(capturedArgs.some((a) => a.includes('/custom/lib'))).toBe(true);
    expect(capturedArgs.some((a) => a.includes('cairn_narrate.py'))).toBe(true);
  });
});
