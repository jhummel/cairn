import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import net from 'net';
import { checkNarrationHealth, stopNarrationServer, startNarrationServer } from '../src/narration';

function makeSockPath(): string {
  return join(tmpdir(), `ralph-narr-test-${Math.random().toString(36).slice(2)}.sock`);
}

// --- checkNarrationHealth ---

describe('checkNarrationHealth', () => {
  it('returns false when socket file does not exist', async () => {
    const result = await checkNarrationHealth('/nonexistent/path/test.sock');
    expect(result).toBe(false);
  });

  it('returns true when server responds with PONG', async () => {
    const sockPath = makeSockPath();
    const server = net.createServer((client) => {
      client.on('data', (data) => {
        if (data.toString().includes('PING')) {
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

  it('uses /tmp/ralph-tts.sock as default socketPath', async () => {
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

  it('uses /tmp/ralph-tts.sock as default socketPath', async () => {
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

    // Create a mock PONG server that listens before we call startNarrationServer
    const mockServer = net.createServer((client) => {
      client.on('data', (data) => {
        if (data.toString().includes('PING')) {
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

  it('throws after all 10 retries exhausted when health check always fails', async () => {
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

    expect(callCount).toBe(10);
  });
});
