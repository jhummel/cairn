import { Command } from 'commander';
import { join } from 'path';
import { findProjectRoot, resolveRalphRoot } from './utils';
import { loadConfig, autoDetectHealthCheck, setConfigEnvVars } from './config';
import { shellFallback, forceShellFallback } from './commands/fallback';
import { runStatus } from './commands/status';

const RALPH_VERSION = '0.1.0';

/** Shell-fallback commands that haven't been ported to TS yet */
const SHELL_FALLBACK_COMMANDS = ['plan', 'run', 'summarize', 'init', 'narrate'] as const;

/** Ported commands with stub handlers (filled in by tasks 8-11) */
const PORTED_COMMANDS = ['status', 'edit', 'logs'] as const;

/**
 * Resolve project context: project root, data dir, config, and set env vars.
 * Called before command dispatch.
 */
export function setupProjectContext(projectRootOverride?: string): {
  projectRoot: string;
  dataDir: string;
  ralphRoot: string;
  libDir: string;
} {
  // If an override is provided, set env var so findProjectRoot picks it up
  if (projectRootOverride) {
    process.env.RALPH_PROJECT_ROOT = projectRootOverride;
  }

  const projectRoot = findProjectRoot();
  const ralphRoot = resolveRalphRoot();
  const dataDir = join(projectRoot, '.ralph');
  const libDir = join(ralphRoot, 'lib');

  // Set env vars for subcommands and shell fallback
  process.env.RALPH_PROJECT_ROOT = projectRoot;
  process.env.RALPH_DATA_DIR = dataDir;
  process.env.RALPH_LIB_DIR = libDir;
  process.env.RALPH_NARRATE_PYTHON = join(ralphRoot, '.venv', 'bin', 'python3');

  // Load config and set config env vars
  const config = loadConfig(projectRoot);
  if (!config.healthCheck) {
    config.healthCheck = autoDetectHealthCheck(projectRoot);
  }
  setConfigEnvVars(config);

  return { projectRoot, dataDir, ralphRoot, libDir };
}

// shellFallback and forceShellFallback are imported from ./commands/fallback
// Re-export for backward compatibility with existing tests
export { shellFallback, forceShellFallback } from './commands/fallback';

/**
 * Build and return the Commander program.
 * Exported for testing.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('ralph')
    .version(`ralph ${RALPH_VERSION}`, '--version, -v')
    .description('Agentic Task Orchestration for Claude Code')
    .option('--project-root <path>', 'Override project root detection')
    .allowUnknownOption(false);

  // --- Ported commands (stubs for now) ---

  program
    .command('status')
    .description('Show current task list overview')
    .action(() => {
      const projectRoot = process.env.RALPH_PROJECT_ROOT!;
      const dataDir = process.env.RALPH_DATA_DIR!;
      runStatus(projectRoot, dataDir);
    });

  program
    .command('edit [target]')
    .description('Edit tasks.json (default), planning notes, or config')
    .action((target?: string) => {
      console.log(`edit ${target ?? 'tasks'}: not yet implemented`);
    });

  program
    .command('logs')
    .description('Show iteration log')
    .action(() => {
      console.log('logs: not yet implemented');
    });

  // --- Shell fallback commands ---

  for (const cmd of SHELL_FALLBACK_COMMANDS) {
    program
      .command(cmd)
      .description(`[shell fallback] ${cmd}`)
      .allowUnknownOption(true)
      .action((_options, command) => {
        const args = command.args ?? [];
        shellFallback(cmd, args);
      });
  }

  return program;
}

/**
 * Main entry point. Parses args and dispatches to commands.
 */
export async function main(argv?: string[]): Promise<void> {
  const args = argv ?? process.argv;

  // RALPH_FORCE_SHELL=1 → delegate everything to the shell version
  if (process.env.RALPH_FORCE_SHELL === '1') {
    // Strip 'node'/'bun' and script path from args to get the raw command
    const cmdArgs = args.slice(2);
    forceShellFallback(cmdArgs);
    return; // shellFallback calls process.exit, but for testing clarity
  }

  const program = createProgram();

  // Hook into Commander to set up project context before any command runs
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    setupProjectContext(opts.projectRoot);
  });

  await program.parseAsync(args);
}

// Run when executed directly
const isDirectExecution = typeof Bun !== 'undefined'
  ? Bun.main === (import.meta as any).path
  : require.main === module;

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
