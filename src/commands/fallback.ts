import { spawnSync } from 'child_process';
import { join } from 'path';
import { resolveRalphRoot } from '../utils';

/**
 * Maps shell-fallback commands to their lib/ script filenames.
 * Commands NOT in this map delegate to bin/ralph instead.
 */
export const COMMAND_SCRIPT_MAP: Record<string, string> = {
  run: 'ralph_loop.sh',
};

/**
 * Commands that delegate to bin/ralph directly (not lib/ scripts).
 * init is sourced by bin/ralph; narrate is handled inline in bin/ralph.
 */
export const BIN_RALPH_COMMANDS = ['narrate'] as const;

/**
 * Shell fallback: delegates a command to the original shell scripts.
 *
 * - Commands in COMMAND_SCRIPT_MAP run via `bash <lib/script.sh> [args]`
 * - Commands in BIN_RALPH_COMMANDS run via `bin/ralph <command> [args]`
 * - Unknown commands fall back to `bin/ralph <command> [args]`
 */
export function shellFallback(command: string, args: string[]): void {
  const ralphRoot = resolveRalphRoot();
  const libDir = process.env.RALPH_LIB_DIR ?? join(ralphRoot, 'lib');
  const binRalph = join(ralphRoot, 'bin', 'ralph');

  const scriptName = COMMAND_SCRIPT_MAP[command];

  let executable: string;
  let spawnArgs: string[];

  if (scriptName) {
    // Lib script: run via bash
    executable = 'bash';
    spawnArgs = [join(libDir, scriptName), ...args];
  } else {
    // bin/ralph delegation (init, narrate, or unknown)
    executable = binRalph;
    spawnArgs = [command, ...args];
  }

  const result = spawnSync(executable, spawnArgs, {
    stdio: 'inherit',
    env: { ...process.env },
  });

  process.exit(result.status ?? 1);
}

/**
 * Force shell fallback: delegates the entire invocation to bin/ralph.
 * Used when RALPH_FORCE_SHELL=1.
 */
export function forceShellFallback(args: string[]): void {
  const ralphRoot = resolveRalphRoot();
  const binRalph = join(ralphRoot, 'bin', 'ralph');

  const result = spawnSync(binRalph, args, {
    stdio: 'inherit',
    env: { ...process.env },
  });

  process.exit(result.status ?? 1);
}
