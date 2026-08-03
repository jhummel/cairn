import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import net from 'net';
import {
  checkNarrationHealth,
  stopNarrationServer,
  startNarrationServer,
  findNarrationSocketPath,
  findNarrationPidFile,
} from '../src/narration';
import { BRAND } from '../src/brand';

function makeSockPath(): string {
  return join(tmpdir(), `cairn-narr-test-${Math.random().toString(36).slice(2)}.sock`);
}

// --- checkNarrationHealth ---

describe('checkNarrationHealth', () => {
  it('returns false when socket file does not exist', async () => {
    const result = await checkNarrationHealth('/nonexistent/path/test.sock');
    expect(result).toBe(false);
  });

  it('returns true when server responds with PONG', async () => {
    const sockPath = makeSockPath();
    // Respond immediately on data — Bun's net module doesn't reliably fire the
    // server-side 'end' event on Unix socket half-close, so we can't use EOF-based
    // protocol in JS mock servers. The real Python server uses raw recv() which
    // correctly detects FIN at the OS level.
    const server = net.createServer((client) => {
      client.on('data', (chunk) => {
        if (chunk.toString().includes('PING')) {
          client.write('PONG\n');
        }
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(sockPath, resolve));
      const result = await checkNarrationHealth(sockPath);
      expect(result).toBe(true);
    } finally {
      server.close();
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it('returns false when server does not respond with PONG', async () => {
    const sockPath = makeSockPath();
    const server = net.createServer((client) => {
      // Accept connection but send wrong response
      client.on('data', () => {
        client.write('NOPE\n');
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(sockPath, resolve));
      const result = await checkNarrationHealth(sockPath);
      expect(result).toBe(false);
    } finally {
      server.close();
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it('returns false when connection times out (server accepts but never responds)', async () => {
    const sockPath = makeSockPath();
    const server = net.createServer((_client) => {
      // Accept connection but never write data — triggers timeout
    });

    try {
      await new Promise<void>((resolve) => server.listen(sockPath, resolve));
      const result = await checkNarrationHealth(sockPath);
      expect(result).toBe(false);
    } finally {
      server.close();
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  }, 5000);

  it('falls back to the resolved default socketPath', async () => {
    // Just verify the function works with no argument — should return false since no server
    const result = await checkNarrationHealth();
    // Default path almost certainly doesn't have a running server in test env
    expect(typeof result).toBe('boolean');
  });

});

// --- stopNarrationServer ---

describe('stopNarrationServer', () => {
  it('cleans up socket file when it exists', async () => {
    const sockPath = makeSockPath();
    // Create a dummy socket file
    writeFileSync(sockPath, '');

    // Use a harmless PID (1 = init, SIGTERM will be EPERM but we ignore it)
    // Better: use current process PID but send a signal that does nothing visible
    // Best: mock process.kill
    const origKill = process.kill.bind(process);
    const killCalls: Array<{ pid: number; sig: string }> = [];
    // @ts-ignore — override for testing
    process.kill = (pid: number, sig?: any) => {
      killCalls.push({ pid, sig });
      // Don't actually kill anything
    };

    try {
      await stopNarrationServer(12345, sockPath);
      expect(existsSync(sockPath)).toBe(false);
      expect(killCalls).toHaveLength(1);
      expect(killCalls[0].pid).toBe(12345);
      expect(killCalls[0].sig).toBe('SIGTERM');
    } finally {
      // @ts-ignore
      process.kill = origKill;
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it('does not throw when socket file does not exist', async () => {
    const origKill = process.kill.bind(process);
    // @ts-ignore
    process.kill = () => {};
    try {
      await expect(stopNarrationServer(99999, '/nonexistent/sock.sock')).resolves.toBeUndefined();
    } finally {
      // @ts-ignore
      process.kill = origKill;
    }
  });

  it('does not throw when process.kill throws (process already dead)', async () => {
    const sockPath = makeSockPath();
    const origKill = process.kill.bind(process);
    // @ts-ignore
    process.kill = () => { throw new Error('ESRCH'); };
    try {
      await expect(stopNarrationServer(99999, sockPath)).resolves.toBeUndefined();
    } finally {
      // @ts-ignore
      process.kill = origKill;
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it('falls back to the resolved default socketPath', async () => {
    const origKill = process.kill.bind(process);
    // @ts-ignore
    process.kill = () => {};
    try {
      // Should complete without throwing — default socket path just won't exist
      await expect(stopNarrationServer(99999)).resolves.toBeUndefined();
    } finally {
      // @ts-ignore
      process.kill = origKill;
    }
  });
});

// --- startNarrationServer ---

describe('startNarrationServer', () => {
  it('throws when pythonPath does not exist', async () => {
    let errMsg = '';
    try {
      await startNarrationServer({
        pythonPath: '/nonexistent/python',
        scriptPath: '/nonexistent/script.py',
        voice: 'en-US',
        socketPath: makeSockPath(),
      });
    } catch (e: any) {
      errMsg = e?.message ?? '';
    }
    expect(errMsg).toContain('/nonexistent/python');
  });

  it('spawns server and returns PID when server becomes healthy', async () => {
    const sockPath = makeSockPath();

    // Respond immediately on data — see comment in checkNarrationHealth tests
    // about Bun's Unix socket 'end' event limitation.
    const mockServer = net.createServer((client) => {
      client.on('data', (chunk) => {
        if (chunk.toString().includes('PING')) {
          client.write('PONG\n');
        }
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(sockPath, resolve));

    // Use 'true' as the python binary (it exits 0 immediately with no output).
    // The socket is already listening so health check will pass on first retry.
    // Mock sleep to avoid real 1s delay.
    const noopSleep = async (_ms: number) => {};
    try {
      const pid = await startNarrationServer({
        pythonPath: '/usr/bin/true',
        scriptPath: '/dev/null',
        voice: 'en-US',
        socketPath: sockPath,
        deps: { sleep: noopSleep },
      });
      expect(typeof pid).toBe('number');
      expect(pid).toBeGreaterThan(0);
    } finally {
      mockServer.close();
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  }, 5000);

  it('throws when health check fails after startup', async () => {
    const sockPath = makeSockPath();
    const noopSleep = async (_ms: number) => {};
    // No server listening — health check will always fail
    await expect(
      startNarrationServer({
        pythonPath: '/usr/bin/true',
        scriptPath: '/dev/null',
        voice: 'en-US',
        socketPath: sockPath,
        deps: { sleep: noopSleep },
      }),
    ).rejects.toThrow('Narration server failed health check after startup');
  }, 5000);

  it('retries until Nth attempt succeeds', async () => {
    const sockPath = makeSockPath();
    const noopSleep = async (_ms: number) => {};
    let callCount = 0;
    const checkHealth = async (_path: string) => {
      callCount++;
      return callCount >= 3; // fail first 2, succeed on 3rd
    };

    const pid = await startNarrationServer({
      pythonPath: '/usr/bin/true',
      scriptPath: '/dev/null',
      voice: 'en-US',
      socketPath: sockPath,
      deps: { checkHealth, sleep: noopSleep },
    });

    expect(typeof pid).toBe('number');
    expect(pid).toBeGreaterThan(0);
    expect(callCount).toBe(3);
  });

  it('does not call health check more times than needed (early exit)', async () => {
    const sockPath = makeSockPath();
    const noopSleep = async (_ms: number) => {};
    let callCount = 0;
    const checkHealth = async (_path: string) => {
      callCount++;
      return true; // succeed immediately on first call
    };

    await startNarrationServer({
      pythonPath: '/usr/bin/true',
      scriptPath: '/dev/null',
      voice: 'en-US',
      socketPath: sockPath,
      deps: { checkHealth, sleep: noopSleep },
    });

    expect(callCount).toBe(1);
  });

  it('throws after all 30 retries exhausted when health check always fails', async () => {
    const sockPath = makeSockPath();
    const noopSleep = async (_ms: number) => {};
    let callCount = 0;
    const checkHealth = async (_path: string) => {
      callCount++;
      return false;
    };

    await expect(
      startNarrationServer({
        pythonPath: '/usr/bin/true',
        scriptPath: '/dev/null',
        voice: 'en-US',
        socketPath: sockPath,
        deps: { checkHealth, sleep: noopSleep },
      }),
    ).rejects.toThrow('Narration server failed health check after startup');

    expect(callCount).toBe(30);
  });
});

// --- findNarrationSocketPath / findNarrationPidFile ---

/** A project root whose installed narrate.sh hook dials `socket`. */
function projectWithHook(socket: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'cairn-sockres-'));
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true });
  const body = socket === null
    ? '#!/bin/bash\n# no socket line here\nexit 0\n'
    : `#!/bin/bash\n# PostToolUse hook\nSOCKET="${socket}"\n[ ! -S "$SOCKET" ] && exit 0\n`;
  writeFileSync(join(root, '.claude', 'hooks', 'narrate.sh'), body);
  return root;
}

const NONE = { exists: () => false };

describe('findNarrationSocketPath', () => {
  const roots: string[] = [];
  const track = (r: string) => { roots.push(r); return r; };

  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('defaults to the current brand socket when nothing is installed or running', () => {
    expect(findNarrationSocketPath(undefined, NONE)).toBe('/tmp/cairn-tts.sock');
  });

  it('returns the current brand socket when it is already live', () => {
    expect(findNarrationSocketPath(undefined, { exists: (p) => p === BRAND.socket })).toBe('/tmp/cairn-tts.sock');
  });

  it('ignores a stale /tmp/ralph-tts.sock left by the pre-rename binary', () => {
    const exists = (p: string) => p === '/tmp/ralph-tts.sock';
    expect(findNarrationSocketPath(undefined, { exists })).toBe('/tmp/cairn-tts.sock');
  });

  it("follows the project's installed hook, which is the client that dials it", () => {
    const root = track(projectWithHook('/tmp/custom-tts.sock'));
    expect(findNarrationSocketPath(root, NONE)).toBe('/tmp/custom-tts.sock');
  });

  it('follows a current-brand hook too', () => {
    const root = track(projectWithHook('/tmp/cairn-tts.sock'));
    expect(findNarrationSocketPath(root, NONE)).toBe('/tmp/cairn-tts.sock');
  });

  it('the hook outranks a live socket at the other path', () => {
    const root = track(projectWithHook('/tmp/custom-tts.sock'));
    expect(findNarrationSocketPath(root, { exists: () => true })).toBe('/tmp/custom-tts.sock');
  });

  it('ignores a hook with no SOCKET assignment', () => {
    const root = track(projectWithHook(null));
    expect(findNarrationSocketPath(root, NONE)).toBe(BRAND.socket);
  });

  it('ignores a project with no hooks installed', () => {
    const root = track(mkdtempSync(join(tmpdir(), 'cairn-sockres-')));
    expect(findNarrationSocketPath(root, NONE)).toBe(BRAND.socket);
  });

  it('emits no warnings, whatever it resolves to', () => {
    const root = track(projectWithHook('/tmp/custom-tts.sock'));
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    try {
      findNarrationSocketPath(root, NONE);
      findNarrationSocketPath(undefined, NONE);
      findNarrationSocketPath(undefined, { exists: () => true });
    } finally {
      console.error = original;
    }
    expect(seen).toEqual([]);
  });
});

describe('findNarrationPidFile', () => {
  it('defaults to the current brand pid file', () => {
    expect(findNarrationPidFile(NONE)).toBe('/tmp/cairn-tts.pid');
  });

  it('returns the current brand pid file when it exists', () => {
    expect(findNarrationPidFile({ exists: (p) => p === BRAND.pidFile })).toBe('/tmp/cairn-tts.pid');
  });

  it('ignores a stale /tmp/ralph-tts.pid left by the pre-rename binary', () => {
    const exists = (p: string) => p === '/tmp/ralph-tts.pid';
    expect(findNarrationPidFile({ exists })).toBe('/tmp/cairn-tts.pid');
  });

  it('emits no warnings when a stale legacy pid file is present', () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    try {
      findNarrationPidFile({ exists: () => true });
    } finally {
      console.error = original;
    }
    expect(seen).toEqual([]);
  });
});
