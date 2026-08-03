import { spawn } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import net from 'net';
import { BRAND } from './brand';

// ── Resolving the narration socket ────────────────────────────────────────────
//
// The socket's authoritative value does not live in /tmp — it lives in the
// project's `.claude/hooks/*.sh`, which are generated once at `cairn init` time
// and hardcode a `SOCKET="..."` line. Those hooks are the only clients; the
// server must bind wherever they dial, so the hook file is read first and wins
// over anything found in /tmp. Binding BRAND.socket unconditionally would leave
// narration silently dead in any project whose hooks name a different path: the
// server comes up fine, the hooks fire fine, and the events go nowhere.

/** `SOCKET="/tmp/..."` as written by the hook templates in src/commands/init.ts. */
const HOOK_SOCKET_RE = /^\s*SOCKET="([^"]+)"/m;

/**
 * Injection seam so tests can pin a /tmp probe instead of the real filesystem.
 * With a single candidate per path there is nothing left to probe for, so both
 * resolvers currently ignore it; it stays on the signatures because these are
 * the resolution entry points and a future candidate would need it back.
 */
export interface PathProbeDeps {
  exists?: (path: string) => boolean;
}

/**
 * Resolve the Unix socket the narration server should bind.
 *
 * 1. Whatever `<projectRoot>/.claude/hooks/narrate.sh` dials, when installed —
 *    the hooks are the clients, so they decide.
 * 2. Otherwise BRAND.socket, live or not, so a fresh server comes up there.
 */
export function findNarrationSocketPath(projectRoot?: string, _deps: PathProbeDeps = {}): string {
  if (projectRoot) {
    try {
      const hook = readFileSync(join(projectRoot, '.claude', 'hooks', 'narrate.sh'), 'utf8');
      const match = hook.match(HOOK_SOCKET_RE);
      if (match) return match[1];
    } catch {
      // No hooks installed (or unreadable) — fall through to the default path.
    }
  }

  return BRAND.socket;
}

/** Resolve the narration server's PID file. */
export function findNarrationPidFile(_deps: PathProbeDeps = {}): string {
  return BRAND.pidFile;
}

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
  const socketPath = opts.socketPath ?? findNarrationSocketPath();

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
  const sock = socketPath ?? findNarrationSocketPath();

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
  const sock = socketPath ?? findNarrationSocketPath();

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
