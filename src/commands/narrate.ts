import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'child_process';
import {
  startNarrationServer,
  stopNarrationServer,
  type StartNarrationOpts,
} from '../narration';
import { resolveAnthropicApiKeyChain, warnIfLegacyApiKey } from '../config';

// TODO(#48): still the literal legacy /tmp paths — BRAND.socket is not wired up
// yet, and the pid file must move with it. Not compatibility fallbacks; tracked
// separately from the rename.
const DEFAULT_PID_FILE = '/tmp/ralph-tts.pid';
const DEFAULT_SOCKET_PATH = '/tmp/ralph-tts.sock';
const DEFAULT_VOICE = 'bf_emma';

export interface RunNarrateOpts {
  pythonPath?: string;
  libDir?: string;
  pidFile?: string;
  socketPath?: string;
  voice?: string;
  startServer?: (opts: StartNarrationOpts) => Promise<number>;
  stopServer?: (pid: number, socketPath?: string) => Promise<void>;
  spawnSyncFn?: typeof spawnSync;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runNarrate(action: string, opts: RunNarrateOpts = {}): Promise<void> {
  const pythonPath = opts.pythonPath ?? process.env.CAIRN_NARRATE_PYTHON ?? '';
  const libDir = opts.libDir ?? process.env.CAIRN_LIB_DIR ?? '';
  const pidFile = opts.pidFile ?? DEFAULT_PID_FILE;
  const socketPath = opts.socketPath ?? DEFAULT_SOCKET_PATH;
  const voice = opts.voice ?? process.env.CAIRN_NARRATION_VOICE ?? DEFAULT_VOICE;
  const startServer = opts.startServer ?? startNarrationServer;
  const stopServer = opts.stopServer ?? stopNarrationServer;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;

  // Validate python path before any action
  if (!pythonPath) {
    throw new Error(
      'CAIRN_NARRATE_PYTHON is not set. Run: python3.11 -m venv .venv && .venv/bin/pip install kokoro sounddevice anthropic',
    );
  }
  if (!fs.existsSync(pythonPath)) {
    throw new Error(
      `Narration venv not found at CAIRN_NARRATE_PYTHON: ${pythonPath}. Run: python3.11 -m venv .venv && .venv/bin/pip install kokoro sounddevice anthropic`,
    );
  }

  switch (action) {
    case 'on':
    case 'start': {
      // Check if already running
      if (fs.existsSync(pidFile)) {
        const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
          console.log(`Narration server already running (PID: ${existingPid})`);
          return;
        }
        // Stale PID file — remove it
        fs.unlinkSync(pidFile);
      }

      warnIfLegacyApiKey(resolveAnthropicApiKeyChain());

      console.log(`Starting narration server (voice: ${voice})...`);
      let pid: number;
      try {
        pid = await startServer({
          pythonPath,
          scriptPath: path.join(libDir, 'cairn_narrate_server.py'),
          voice,
          socketPath,
        });
      } catch (err) {
        // Clean up any PID file written during the attempt
        if (fs.existsSync(pidFile)) {
          fs.unlinkSync(pidFile);
        }
        throw err;
      }

      fs.writeFileSync(pidFile, String(pid));
      console.log(`Narration server started (PID: ${pid})`);
      console.log(`Socket: ${socketPath}`);
      break;
    }

    case 'off':
    case 'stop': {
      if (!fs.existsSync(pidFile)) {
        console.log('Narration server is not running');
        return;
      }

      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      await stopServer(pid, socketPath);
      fs.unlinkSync(pidFile);
      console.log(`Narration server stopped (PID: ${pid})`);
      break;
    }

    case 'status': {
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (!isNaN(pid) && isProcessAlive(pid)) {
          console.log(`Narration server: running (PID: ${pid})`);
          console.log(`Socket: ${socketPath}`);
          return;
        }
        // Stale PID file
        fs.unlinkSync(pidFile);
      }
      console.log('Narration server: stopped');
      break;
    }

    default: {
      // One-shot TTS: spawn cairn_narrate.py directly
      const scriptPath = path.join(libDir, 'cairn_narrate.py');
      spawnSyncFn(pythonPath, [scriptPath, action], { stdio: 'inherit' });
      break;
    }
  }
}
