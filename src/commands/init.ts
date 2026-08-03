import * as fs from 'fs';
import * as path from 'path';
import { spawnSync as nodeSpawnSync } from 'child_process';
import type { CairnConfig } from '../types';
import { loadConfig, autoDetectHealthCheck } from '../config';
import { resolveCairnRoot } from '../utils';
import { seedNextId } from '../task-counter';
import { BRAND, LEGACY } from '../brand';

/**
 * Runtime temp-file names to ignore, minus the prefix. Exported because
 * `cairn migrate` appends the same set to an existing data-dir .gitignore —
 * two lists would silently drift apart.
 */
export const TEMP_IGNORE_SUFFIXES = [
  'complete',
  'iterations.log',
  'prev_notes',
  'task_meta',
  'completed_ids',
  'tasks_snapshot.json',
  'task_*_notes.md',
] as const;

export const GITIGNORE_CURRENT_HEADER =
  '# Runtime temp files (tasks.json and planning-notes.md are tracked)';
/** remove once all projects migrated — header and its ignoreBlock both go. */
export const GITIGNORE_LEGACY_HEADER =
  '# Legacy names — still written by older runs and read as a fallback' +
  ' (remove once all projects migrated)';

/** `prefix` + each suffix, one per line, newline-terminated. */
export function ignoreBlock(prefix: string): string {
  return TEMP_IGNORE_SUFFIXES.map((s) => `${prefix}${s}\n`).join('');
}

const GITIGNORE_CONTENT =
  `${GITIGNORE_CURRENT_HEADER}\n` +
  ignoreBlock(BRAND.tempPrefix) +
  `${GITIGNORE_LEGACY_HEADER}\n` +
  ignoreBlock(LEGACY.tempPrefix) +
  'instructions.md\n';

export interface PromptInterface {
  question(query: string): Promise<string>;
  close(): void;
}

export interface ConfigDefaults {
  projectName: string;
  projectDescription: string;
  healthCheck: string;
  defaultTestCommand: string;
  implementationFile: string;
  truncateText: boolean;
  claudeMdPattern: string;
  narrationEnabled: boolean;
  narrationVoice: string;
  ntfyTopic: string;
  reviewMaxIterations: number;
  reviewPostTask: boolean;
}

export function initCoreFiles(projectRoot: string, dataDir: string): void {
  // dataDir's basename reflects whichever layout the caller resolved (current
  // brand for a fresh init, legacy for a re-init on an existing project) — never
  // hardcode it, or messages lie about which directory was actually touched.
  const dirName = path.basename(dataDir);

  // Create the data directory
  if (fs.existsSync(dataDir)) {
    console.log(`  ${dirName}/ directory already exists.`);
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`  Created: ${dirName}/`);
  }

  // Create the .gitignore inside the data directory
  const gitignorePath = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT);
    console.log(`  Created: ${dirName}/.gitignore`);
  }

  // Create tasks.json inside the data directory
  const tasksPath = path.join(dataDir, 'tasks.json');
  if (fs.existsSync(tasksPath)) {
    console.log('  tasks.json already exists.');
  } else {
    const projectName = path.basename(projectRoot);
    fs.writeFileSync(tasksPath, JSON.stringify({ project: projectName, tasks: [] }, null, 2) + '\n');
    console.log(`  Created: ${dirName}/tasks.json`);
  }

  // Create state.json inside the data directory
  const statePath = path.join(dataDir, 'state.json');
  if (fs.existsSync(statePath)) {
    console.log('  state.json already exists.');
  } else {
    const nextTaskId = seedNextId(dataDir);
    fs.writeFileSync(statePath, JSON.stringify({ nextTaskId }, null, 2) + '\n');
    console.log(`  Created: ${dirName}/state.json`);
  }
}

/**
 * Parse boolean user input. Accepts y/yes/n/no (case-insensitive).
 * Empty or whitespace-only input returns the default.
 */
export function parseBooleanInput(input: string, defaultValue: boolean): boolean {
  const trimmed = input.trim();
  if (trimmed === '') return defaultValue;
  if (/^y/i.test(trimmed)) return true;
  if (/^n/i.test(trimmed)) return false;
  return defaultValue;
}

/**
 * Get default config values for prompts. Loads from an existing cairn.json (or
 * legacy ralph.json — remove once all projects migrated) if present, otherwise
 * uses sensible defaults. Auto-detects health check if not set.
 */
export function getConfigDefaults(projectRoot: string): ConfigDefaults {
  const config = loadConfig(projectRoot);
  const autoHealth = autoDetectHealthCheck(projectRoot);

  return {
    projectName: config.projectName,
    projectDescription: config.projectDescription,
    healthCheck: config.healthCheck || autoHealth,
    defaultTestCommand: config.defaultTestCommand,
    implementationFile: config.implementationFile,
    truncateText: config.truncateText,
    claudeMdPattern: config.summarize.claudeMdPattern,
    narrationEnabled: config.narration.enabled,
    narrationVoice: config.narration.voice,
    ntfyTopic: config.narration.ntfyTopic,
    reviewMaxIterations: config.review?.maxIterations ?? 3,
    reviewPostTask: config.review?.postTask ?? false,
  };
}

/**
 * Prompt helper: ask a question with a default value shown in brackets.
 * Empty input returns the default.
 */
async function promptValue(
  rl: PromptInterface,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = await rl.question(`  ${label} [${defaultValue}]: `);
  return answer.trim() || defaultValue;
}

/**
 * Prompt helper for boolean values. Shows [Y/n] or [y/N] depending on default.
 */
async function promptBoolean(
  rl: PromptInterface,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = await rl.question(`  ${label} [${hint}]: `);
  return parseBooleanInput(answer, defaultValue);
}

/**
 * Run interactive prompts for the project configuration file.
 * Uses the provided PromptInterface (real readline or mock for tests).
 */
export async function promptForConfig(
  rl: PromptInterface,
  defaults: ConfigDefaults,
): Promise<CairnConfig> {
  const projectName = await promptValue(rl, 'Project name', defaults.projectName);
  const projectDescription = await promptValue(rl, 'Description (used in agent system prompts)', defaults.projectDescription);
  const healthCheck = await promptValue(rl, 'Health check command (auto-detected if blank)', defaults.healthCheck);
  const defaultTestCommand = await promptValue(rl, 'Default test command', defaults.defaultTestCommand);
  const implementationFile = await promptValue(rl, 'Implementation file', defaults.implementationFile);
  const truncateText = await promptBoolean(rl, 'Truncate agent text output?', defaults.truncateText);
  const claudeMdPattern = await promptValue(rl, 'CLAUDE.md glob pattern for summarize', defaults.claudeMdPattern);
  const narrationEnabled = await promptBoolean(rl, 'Enable TTS narration?', defaults.narrationEnabled);

  let narrationVoice = defaults.narrationVoice;
  let ntfyTopic = defaults.ntfyTopic;
  if (narrationEnabled) {
    narrationVoice = await promptValue(rl, 'Narration voice', defaults.narrationVoice);
    ntfyTopic = await promptValue(rl, 'ntfy push notification topic', defaults.ntfyTopic);
  }

  const reviewMaxIterationsStr = await promptValue(rl, 'Auto-review max iterations', String(defaults.reviewMaxIterations));
  const reviewMaxIterations = parseInt(reviewMaxIterationsStr, 10);
  const reviewPostTask = await promptBoolean(rl, 'Enable post-task review?', defaults.reviewPostTask);

  return {
    projectName,
    projectDescription,
    healthCheck,
    defaultTestCommand,
    implementationFile,
    truncateText,
    summarize: { claudeMdPattern },
    narration: { enabled: narrationEnabled, voice: narrationVoice, ntfyTopic },
    review: {
      maxIterations: Number.isNaN(reviewMaxIterations) ? defaults.reviewMaxIterations : reviewMaxIterations,
      postTask: reviewPostTask,
    },
  };
}

/**
 * Write a CairnConfig to cairn.json in the project root.
 */
export function writeCairnJson(projectRoot: string, config: CairnConfig): void {
  const configPath = path.join(projectRoot, BRAND.configFile);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export type SpawnSyncResult = { status: number | null; error?: Error };
export type SpawnSyncFn = (cmd: string, args: string[], options: { stdio: 'inherit' }) => SpawnSyncResult;

/**
 * Offer to create instructions.md inside the data directory and open it in $EDITOR.
 */
export async function createInstructionsFile(
  dataDir: string,
  rl: PromptInterface,
  spawnSyncFn: SpawnSyncFn = (cmd, args, opts) => nodeSpawnSync(cmd, args, opts),
): Promise<void> {
  const dirName = path.basename(dataDir);
  const create = await promptBoolean(rl, `Create ${dirName}/instructions.md for personal agent preferences?`, false);
  if (!create) return;

  const instructionsPath = path.join(dataDir, 'instructions.md');
  if (!fs.existsSync(instructionsPath)) {
    fs.writeFileSync(instructionsPath, '');
    console.log(`  Created: ${dirName}/instructions.md`);
  }

  // Ensure instructions.md is in .gitignore
  const gitignorePath = path.join(dataDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.split('\n').some(line => line === 'instructions.md')) {
      fs.appendFileSync(gitignorePath, 'instructions.md\n');
    }
  }

  // Open in $EDITOR (fall back to vi)
  const editor = process.env.EDITOR || 'vi';
  const result = spawnSyncFn(editor, [instructionsPath], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.log(`  Path: ${instructionsPath}`);
  }
}

const NARRATE_SH = `#!/bin/bash
# PostToolUse hook: narrates what just happened after each tool use
SOCKET="${BRAND.socket}"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty')
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty' | head -c 2000)
[ -z "$TOOL_NAME" ] && exit 0

PAYLOAD=$(jq -n --arg name "$TOOL_NAME" --arg input "$TOOL_INPUT" --arg output "$TOOL_OUTPUT" \\
  '{tool: $name, input: $input, output: $output}')

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$PAYLOAD" &
exit 0
`;

const SPEAK_SH = `#!/bin/bash
# Stop hook: speaks assistant responses via narration server
SOCKET="${BRAND.socket}"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.last_assistant_message // empty')
[ -z "$MESSAGE" ] && exit 0

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$MESSAGE" &
exit 0
`;

const NOTIFY_SH = `#!/bin/bash
# Notification hook: speaks when Claude needs user attention
SOCKET="${BRAND.socket}"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // empty')
[ -z "$MESSAGE" ] && exit 0

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$MESSAGE" &
exit 0
`;

/** The three narration hooks, in install order. */
export const NARRATION_HOOKS: ReadonlyArray<{ name: string; event: string; content: string }> = [
  { name: 'narrate.sh', event: 'PostToolUse', content: NARRATE_SH },
  { name: 'speak.sh', event: 'Stop', content: SPEAK_SH },
  { name: 'notify.sh', event: 'Notification', content: NOTIFY_SH },
];

/**
 * Shared knobs for the three installers. `cairn migrate` reuses them to refresh
 * an existing project, where re-reporting untouched files would be noise.
 */
export interface InstallOptions {
  /** Leave files whose destination is already byte-identical alone and omit them from the result. */
  skipUnchanged?: boolean;
  /** Where per-file lines go. Defaults to console.log. */
  log?: (message: string) => void;
}

function sameContent(srcPath: string, destPath: string): boolean {
  try {
    return fs.readFileSync(srcPath).equals(fs.readFileSync(destPath));
  } catch {
    return false;
  }
}

/**
 * Write hook scripts and return the project-relative paths actually written.
 * Overwrites by name only — anything else in the hooks directory is left alone.
 */
export function writeNarrationHooks(projectRoot: string, opts: InstallOptions = {}): string[] {
  const log = opts.log ?? ((m: string) => console.log(m));
  const hooksDir = path.join(projectRoot, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const written: string[] = [];
  for (const hook of NARRATION_HOOKS) {
    const hookPath = path.join(hooksDir, hook.name);
    const rel = path.join('.claude', 'hooks', hook.name);
    if (opts.skipUnchanged && fs.existsSync(hookPath) && fs.readFileSync(hookPath, 'utf8') === hook.content) {
      continue;
    }
    fs.writeFileSync(hookPath, hook.content);
    fs.chmodSync(hookPath, 0o755);
    written.push(rel);
    log(`  Created: .claude/hooks/${hook.name} (${hook.event})`);
  }
  return written;
}

/**
 * Offer to install Claude Code narration hooks (only when narration is enabled).
 */
export async function installNarrationHooks(
  projectRoot: string,
  narrationEnabled: boolean,
  rl: PromptInterface,
): Promise<void> {
  if (!narrationEnabled) return;

  const hooksDir = path.join(projectRoot, '.claude', 'hooks');

  if (fs.existsSync(hooksDir) && fs.existsSync(path.join(hooksDir, 'narrate.sh'))) {
    console.log('  Narration hooks already installed.');
    return;
  }

  console.log('');
  console.log("Narration is enabled. Install Claude Code hooks for standalone 'claude' usage?");
  console.log(`  (These forward events to the ${BRAND.displayName} narration server at ${BRAND.socket})`);

  const install = await promptBoolean(rl, 'Install hooks?', false);
  if (!install) return;

  writeNarrationHooks(projectRoot);
}

/**
 * Copy every .md file out of one of cairn's source directories into the
 * matching .claude/ directory of the target project.
 *
 * Overwrite by filename only: files the project added itself are never removed
 * and never inspected. Returns the project-relative paths actually written.
 */
function installMdDir(
  projectRoot: string,
  root: string,
  dirName: 'commands' | 'agents',
  opts: InstallOptions,
): string[] {
  const log = opts.log ?? ((m: string) => console.log(m));
  const srcDir = path.join(root, dirName);

  if (!fs.existsSync(srcDir)) {
    return [];
  }

  const mdFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
  if (mdFiles.length === 0) return [];

  const destDir = path.join(projectRoot, '.claude', dirName);
  fs.mkdirSync(destDir, { recursive: true });

  const written: string[] = [];
  for (const file of mdFiles) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    if (opts.skipUnchanged && sameContent(srcPath, destPath)) continue;
    fs.copyFileSync(srcPath, destPath);
    written.push(path.join('.claude', dirName, file));
    log(`  Installed: .claude/${dirName}/${file}`);
  }
  return written;
}

/**
 * Copy slash command .md files from cairn's commands/ directory
 * into the target project's .claude/commands/ directory.
 * Accepts an optional cairnRoot override for testing.
 */
export function installSlashCommands(
  projectRoot: string,
  cairnRoot?: string,
  opts: InstallOptions = {},
): string[] {
  return installMdDir(projectRoot, cairnRoot ?? resolveCairnRoot(), 'commands', opts);
}

/**
 * Copy agent .md files from cairn's agents/ directory
 * into the target project's .claude/agents/ directory.
 * Accepts an optional cairnRoot override for testing.
 */
export function installAgents(
  projectRoot: string,
  cairnRoot?: string,
  opts: InstallOptions = {},
): string[] {
  return installMdDir(projectRoot, cairnRoot ?? resolveCairnRoot(), 'agents', opts);
}

/**
 * Print next steps after init.
 */
export function showNextSteps(): void {
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Run '${BRAND.name} plan' to start planning`);
  console.log('');
}

/**
 * Top-level init entrypoint: creates files, prompts for config, handles instructions.md and hooks.
 */
export async function runInit(
  projectRoot: string,
  dataDir: string,
  rl: PromptInterface,
  spawnSyncFn?: SpawnSyncFn,
): Promise<void> {
  console.log('');
  console.log(`Initializing ${BRAND.displayName} in: ${projectRoot}`);
  console.log('');

  initCoreFiles(projectRoot, dataDir);
  installSlashCommands(projectRoot);
  installAgents(projectRoot);

  const defaults = getConfigDefaults(projectRoot);
  console.log('');
  const config = await promptForConfig(rl, defaults);
  writeCairnJson(projectRoot, config);
  console.log('');
  console.log(`  Wrote: ${BRAND.configFile}`);

  await createInstructionsFile(dataDir, rl, spawnSyncFn);
  await installNarrationHooks(projectRoot, config.narration.enabled, rl);
  showNextSteps();

  rl.close();
}
