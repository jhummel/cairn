import { Command } from 'commander';
import { join } from 'path';
import * as readline from 'readline';
import { findProjectRoot, resolveRalphRoot } from './utils';
import { loadConfig, autoDetectHealthCheck, setConfigEnvVars, discoverAgents } from './config';
import { shellFallback, forceShellFallback } from './commands/fallback';
import { runStatus } from './commands/status';
import { runEdit } from './commands/edit';
import { runLogs } from './commands/logs';
import { runInit } from './commands/init';
import { runSummarize } from './commands/summarize';
import { runPlan } from './commands/plan';
import { runRun } from './commands/run';
import { runNarrate } from './commands/narrate';
import type { AgentInfo } from './types';

const RALPH_VERSION = '0.1.0';

/** Shell-fallback commands that haven't been ported to TS yet */
const SHELL_FALLBACK_COMMANDS = [] as const;

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

  // Discover agents and set env var for shell fallback compatibility
  const agents = discoverAgents(projectRoot);
  process.env.RALPH_AGENTS_DIR = join(projectRoot, '.claude', 'agents');
  process.env.RALPH_AGENTS_JSON = JSON.stringify(agents);

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
      const projectRoot = process.env.RALPH_PROJECT_ROOT!;
      const dataDir = process.env.RALPH_DATA_DIR!;
      runEdit(target ?? 'tasks', projectRoot, dataDir);
    });

  program
    .command('logs')
    .description('Show iteration log')
    .action(() => {
      const dataDir = process.env.RALPH_DATA_DIR!;
      runLogs(dataDir);
    });

  program
    .command('init')
    .description('Initialize Ralph in the current project')
    .action(async () => {
      const projectRoot = process.env.RALPH_PROJECT_ROOT!;
      const dataDir = process.env.RALPH_DATA_DIR!;
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const promptInterface = {
        question: (query: string) =>
          new Promise<string>((resolve) => rl.question(query, resolve)),
        close: () => rl.close(),
      };
      await runInit(projectRoot, dataDir, promptInterface);
    });

  program
    .command('summarize')
    .description('Update implementation documentation')
    .action(async () => {
      const projectRoot = process.env.RALPH_PROJECT_ROOT!;
      await runSummarize({
        projectRoot,
        projectName: process.env.RALPH_PROJECT_NAME ?? '',
        implFile: process.env.RALPH_IMPL_FILE ?? 'IMPLEMENTATION.md',
        completedTasksPath: join(projectRoot, '.ralph', 'tasks.completed.json'),
        claudeMdPattern: process.env.RALPH_CLAUDE_MD_PATTERN ?? '',
      });
    });

  // --- Native plan command ---

  program
    .command('plan')
    .description('Interactive planning session: discuss goals, generate tasks')
    .action(async () => {
      const projectRoot = process.env.RALPH_PROJECT_ROOT!;
      const dataDir = process.env.RALPH_DATA_DIR!;
      const projectName = process.env.RALPH_PROJECT_NAME ?? '';
      let agents: AgentInfo[] = [];
      try {
        agents = JSON.parse(process.env.RALPH_AGENTS_JSON ?? '[]') as AgentInfo[];
      } catch {
        // ignore parse errors
      }
      const rlNative = readline.createInterface({ input: process.stdin, output: process.stdout });
      const rl = {
        question: (prompt: string) =>
          new Promise<string>((resolve) => rlNative.question(prompt, resolve)),
        close: () => rlNative.close(),
      };
      try {
        await runPlan({ projectName, projectRoot, dataDir, agents, rl });
      } finally {
        rl.close();
      }
    });

  // --- Native run command ---

  program
    .command('run [max]')
    .description('Execute tasks autonomously with fresh Claude agents')
    .action(async (max?: string) => {
      const projectRoot = process.env.RALPH_PROJECT_ROOT!;
      const dataDir = process.env.RALPH_DATA_DIR!;
      let agents: AgentInfo[] = [];
      try {
        agents = JSON.parse(process.env.RALPH_AGENTS_JSON ?? '[]') as AgentInfo[];
      } catch {
        // ignore parse errors
      }
      const cfg = loadConfig(projectRoot);
      if (!cfg.healthCheck) cfg.healthCheck = autoDetectHealthCheck(projectRoot);
      const config = cfg;
      const maxIterations = max !== undefined ? parseInt(max, 10) : 30;
      await runRun({ projectRoot, dataDir, config, agents, maxIterations });
    });

  // --- Native narrate command ---

  program
    .command('narrate <action>')
    .description('Control narration server (on/off/status) or speak text')
    .action(async (action: string) => {
      await runNarrate(action);
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
