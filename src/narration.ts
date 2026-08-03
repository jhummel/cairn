import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import net from 'net';

// TODO(#48): still the literal legacy socket path — BRAND.socket is not wired
// up yet. Not a compatibility fallback; tracked separately from the rename.
const DEFAULT_SOCKET_PATH = '/tmp/ralph-tts.sock';

export interface StartNarrationDeps {
  checkHealth?: (socketPath: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
}

export interface StartNarrationOpts {
  pythonPath: string;
  scriptPath: string;
  voice: string;
  socketPath?: string;
  deps?: StartNarrationDeps;
}

/**
 * Spawn the Python narration server as a detached child process.
 * Returns the PID. Verifies startup via health check after ~1s delay.
 */
export async function startNarrationServer(opts: StartNarrationOpts): Promise<number> {
  const socketPath = opts.socketPath ?? DEFAULT_SOCKET_PATH;

  if (!existsSync(opts.pythonPath)) {
    throw new Error(`Narration server python not found: ${opts.pythonPath}`);
  }

  const child = spawn(opts.pythonPath, [opts.scriptPath, '--voice', opts.voice, '--socket', socketPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error('Failed to spawn narration server: no PID');
  }

  const checkHealth = opts.deps?.checkHealth ?? checkNarrationHealth;
  const sleep = opts.deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const MAX_RETRIES = 30;
  for (let i = 0; i < MAX_RETRIES; i++) {
    await sleep(1000);
    const healthy = await checkHealth(socketPath);
    if (healthy) return pid;
  }

  throw new Error('Narration server failed health check after startup');
}

/**
 * Kill the narration server process and clean up the socket file.
 */
export async function stopNarrationServer(pid: number, socketPath?: string): Promise<void> {
  const sock = socketPath ?? DEFAULT_SOCKET_PATH;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process may already be dead — ignore
  }

  if (existsSync(sock)) {
    try {
      unlinkSync(sock);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * PING/PONG health check over Unix domain socket with 2s timeout.
 * Returns true if server responds with PONG.
 */
export async function checkNarrationHealth(socketPath?: string): Promise<boolean> {
  const sock = socketPath ?? DEFAULT_SOCKET_PATH;

  if (!existsSync(sock)) return false;

  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ path: sock });
    let responded = false;

    const cleanup = (result: boolean) => {
      if (responded) return;
      responded = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(2000);

    socket.on('connect', () => {
      socket.write('PING\n');
    });

    socket.on('data', (data) => {
      const response = data.toString().trim();
      cleanup(response.includes('PONG'));
    });

    socket.on('timeout', () => cleanup(false));
    socket.on('error', () => cleanup(false));
    socket.on('close', () => cleanup(false));
  });
}
