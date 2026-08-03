import { Command } from 'commander';
import { join } from 'path';
import * as readline from 'readline';
import { findProjectRoot, findDataDir, resolveCairnRoot } from './utils';
import { loadConfig, autoDetectHealthCheck, setConfigEnvVars, discoverAgents } from './config';
import { runStatus } from './commands/status';
import { runEdit } from './commands/edit';
import { runLogs } from './commands/logs';
import { runInit } from './commands/init';
import { runSummarize } from './commands/summarize';
import { runPlan } from './commands/plan';
import { runRun } from './commands/run';
import { runNarrate } from './commands/narrate';
import { runMigrate } from './commands/migrate';
import { registerTaskCommands } from './commands/task';
import type { AgentInfo } from './types';
import { BRAND, LEGACY } from './brand';

const CAIRN_VERSION = '0.1.0';

/**
 * Resolve project context: project root, data dir, config, and set env vars.
 * Called before command dispatch.
 */
export function setupProjectContext(projectRootOverride?: string): {
  projectRoot: string;
  dataDir: string;
  cairnRoot: string;
  libDir: string;
} {
  // If an override is provided, set env var so findProjectRoot picks it up
  if (projectRootOverride) {
    process.env.CAIRN_PROJECT_ROOT = projectRootOverride;
  }

  const projectRoot = findProjectRoot();
  const cairnRoot = resolveCairnRoot();
  // Resolve (never reconstruct) the data dir: projects still on the legacy
  // layout must keep resolving to .ralph/, not to a nonexistent .cairn/.
  const dataDir = findDataDir(projectRoot);
  const libDir = join(cairnRoot, 'lib');

  // Set env vars for subcommands
  process.env.CAIRN_PROJECT_ROOT = projectRoot;
  process.env.CAIRN_DATA_DIR = dataDir;
  process.env.CAIRN_LIB_DIR = libDir;
  process.env.CAIRN_NARRATE_PYTHON = join(cairnRoot, '.venv', 'bin', 'python3');

  // Load config and set config env vars
  const config = loadConfig(projectRoot);
  if (!config.healthCheck) {
    config.healthCheck = autoDetectHealthCheck(projectRoot);
  }
  setConfigEnvVars(config);

  // Discover agents and set env vars
  const agents = discoverAgents(projectRoot);
  process.env.CAIRN_AGENTS_DIR = join(projectRoot, '.claude', 'agents');
  process.env.CAIRN_AGENTS_JSON = JSON.stringify(agents);

  return { projectRoot, dataDir, cairnRoot, libDir };
}

/**
 * Build and return the Commander program.
 * Exported for testing.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name(BRAND.name)
    .version(`${BRAND.name} ${CAIRN_VERSION}`, '--version, -v')
    .description('Agentic Task Orchestration for Claude Code')
    .option('--project-root <path>', 'Override project root detection')
    .allowUnknownOption(false);

  // --- Ported commands (stubs for now) ---

  program
    .command('status')
    .description('Show current task list overview')
    .action(() => {
      const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
      const dataDir = process.env.CAIRN_DATA_DIR!;
      runStatus(projectRoot, dataDir);
    });

  program
    .command('edit [target]')
    .description('Edit tasks.json (default), planning notes, or config')
    .action((target?: string) => {
      const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
      const dataDir = process.env.CAIRN_DATA_DIR!;
      runEdit(target ?? 'tasks', projectRoot, dataDir);
    });

  program
    .command('logs')
    .description('Show iteration log')
    .action(() => {
      const dataDir = process.env.CAIRN_DATA_DIR!;
      runLogs(dataDir);
    });

  program
    .command('init')
    .description(`Initialize ${BRAND.displayName} in the current project`)
    .action(async () => {
      const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
      const dataDir = process.env.CAIRN_DATA_DIR!;
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
      const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
      const dataDir = process.env.CAIRN_DATA_DIR!;
      await runSummarize({
        projectRoot,
        projectName: process.env.CAIRN_PROJECT_NAME ?? '',
        implFile: process.env.CAIRN_IMPL_FILE ?? 'IMPLEMENTATION.md',
        completedTasksPath: join(dataDir, 'tasks.completed.json'),
        claudeMdPattern: process.env.CAIRN_CLAUDE_MD_PATTERN ?? '',
        dataDir,
      });
    });

  // --- Native plan command ---

  program
    .command('plan')
    .description('Interactive planning session: discuss goals, generate tasks')
    .action(() => {
      const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
      const dataDir = process.env.CAIRN_DATA_DIR!;
      const projectName = process.env.CAIRN_PROJECT_NAME ?? '';
      let agents: AgentInfo[] = [];
      try {
        agents = JSON.parse(process.env.CAIRN_AGENTS_JSON ?? '[]') as AgentInfo[];
      } catch {
        // ignore parse errors
      }
      runPlan({ projectName, projectRoot, dataDir, agents });
    });

  // --- Native run command ---

  program
    .command('run [max]')
    .description('Execute tasks autonomously with fresh Claude agents')
    .action(async (max?: string) => {
      const projectRoot = process.env.CAIRN_PROJECT_ROOT!;
      const dataDir = process.env.CAIRN_DATA_DIR!;
      let agents: AgentInfo[] = [];
      try {
        agents = JSON.parse(process.env.CAIRN_AGENTS_JSON ?? '[]') as AgentInfo[];
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

  // --- Native migrate command ---

  program
    .command('migrate')
    .description(
      `Migrate this project from the legacy ${LEGACY.dataDir}/ layout to ${BRAND.dataDir}/ and refresh installed agents, commands, and hooks (stages, never commits)`
    )
    .action(() => {
      // Deliberately process.cwd(), not the discovered project root: migrate
      // operates on the current directory only and never walks upward.
      const code = runMigrate(process.cwd());
      if (code !== 0) process.exitCode = code;
    });

  // --- Task subcommand group ---
  registerTaskCommands(program);

  return program;
}

/**
 * Main entry point. Parses args and dispatches to commands.
 */
export async function main(argv?: string[]): Promise<void> {
  const args = argv ?? process.argv;

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
