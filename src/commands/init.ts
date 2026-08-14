import * as fs from 'fs';
import * as path from 'path';
import { spawnSync as nodeSpawnSync } from 'child_process';
import type { CairnConfig } from '../types';
import { loadConfig, autoDetectHealthCheck } from '../config';
import { resolveCairnRoot } from '../utils';
import { seedNextId } from '../task-counter';
import { BRAND, NOTES_TEMP_PREFIX } from '../brand';
import {
  ClaudeSettingsError,
  GIT_INSPECTION_RULES,
  buildCommandRules,
  mergeClaudeSettings,
  removeSettingsRules,
  type PermissionRules,
} from '../claude-settings';

/** Runtime temp-file names to ignore, minus the prefix. */
const TEMP_IGNORE_SUFFIXES = [
  'complete',
  'iterations.log',
  'prev_notes',
  'task_meta',
  'completed_ids',
  'tasks_snapshot.json',
  'task_*_notes.md',
] as const;

const GITIGNORE_CURRENT_HEADER =
  '# Runtime temp files (tasks.json and planning-notes.md are tracked)';

/** `prefix` + each suffix, one per line, newline-terminated. */
function ignoreBlock(prefix: string): string {
  return TEMP_IGNORE_SUFFIXES.map((s) => `${prefix}${s}\n`).join('');
}

const GITIGNORE_CONTENT =
  `${GITIGNORE_CURRENT_HEADER}\n` +
  ignoreBlock(BRAND.tempPrefix) +
  // A permanent exception, not a compatibility leftover: buildSystemPrompt hands
  // every agent a NOTES_TEMP_PREFIX-spelled `task_<id>_notes.md` as its scratch
  // file. Drop this line and each iteration leaves a scratch file for the
  // agent's own commit to pick up.
  `${NOTES_TEMP_PREFIX}task_*_notes.md\n` +
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
 * Get default config values for prompts. Loads from an existing cairn.json if
 * present, otherwise uses sensible defaults. Auto-detects health check if not set.
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
 * Shared knobs for the three installers, which write into a project's `.claude/`
 * tree and report each file they touch. `skipUnchanged` lets a re-run skip files
 * whose destination is already byte-identical to the source, instead of
 * rewriting and re-reporting a no-op. `log` lets a caller redirect or capture
 * the per-file reporting instead of the `console.log` default.
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
 * The permission baseline `cairn init` seeds into a project.
 *
 * Allow: read-only git inspection, plus whatever the project configured as its
 * health check and default test command (empty values contribute nothing).
 *
 * No deny rules are seeded. A project-wide `deny` in `.claude/settings.local.json`
 * binds every Claude session in the project, including `cairn run`'s own execution
 * agents — it is NOT bypassed by `--dangerously-skip-permissions`. It was also
 * never necessary: in headless `claude -p` mode, anything with side effects is
 * deny-by-default unless allowlisted (there is nobody to prompt), so the
 * reviewer's scoped `--allowedTools` already prevented task-state mutation.
 */
/**
 * Deny rules a previous version of `cairn init` seeded, which re-running init
 * must now retract.
 *
 * They are not merely obsolete, they are actively destructive: a project-wide
 * deny binds every Claude session in the project — including `cairn run`'s own
 * execution agents, which it is NOT bypassed by `--dangerously-skip-permissions`
 * — so every agent's `cairn task start`/`complete` call is silently blocked.
 * Tasks never leave `pending`, and the loop re-runs the same task indefinitely
 * while reporting SUCCESS. `.claude/settings.local.json` is gitignored, so
 * nothing in `git status` hints at the cause. Re-running `cairn init` is the
 * only repair path a user can reach, so it has to do the repair.
 */
export const LEGACY_CAIRN_TASK_DENY_RULES: readonly string[] = [
  'Bash(cairn task start:*)',
  'Bash(cairn task complete:*)',
  'Bash(cairn task set-status:*)',
  'Bash(cairn task add:*)',
  'Bash(cairn task note:*)',
];

export function buildInitPermissionRules(
  config: Pick<CairnConfig, 'healthCheck' | 'defaultTestCommand'>,
): PermissionRules {
  return {
    allow: [
      ...GIT_INSPECTION_RULES,
      ...buildCommandRules([config.healthCheck, config.defaultTestCommand]),
    ],
  };
}

/**
 * Offer to seed the project's `.claude/settings.local.json` permission baseline.
 *
 * Prompted rather than silent, and defaulted to yes: these rules apply to every
 * Claude session in the project, not just Cairn's, so the user gets a visible
 * confirmation. Returns the rules actually added — empty when the user declined,
 * when everything was already present, or when the existing file was unreadable.
 *
 * Also strips `LEGACY_CAIRN_TASK_DENY_RULES` — a project seeded by the previous
 * version of init has a broken `cairn run` until they are gone. Removals are
 * reported but not returned: the return value feeds init's "what did I write"
 * summary, and a retraction is not something written.
 *
 * `opts.skipUnchanged` is not consulted: the merge is additive and the removal
 * targets a fixed, Cairn-authored rule set, so nothing the user wrote is ever
 * rewritten, and a file needing neither is not touched at all.
 */
export async function installClaudeSettings(
  projectRoot: string,
  config: Pick<CairnConfig, 'healthCheck' | 'defaultTestCommand'>,
  rl: PromptInterface,
  opts: InstallOptions = {},
): Promise<string[]> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const rules = buildInitPermissionRules(config);

  log('');
  log('Seed .claude/settings.local.json with permission rules?');
  log('  (Allows read-only git inspection plus your health check and test commands.');
  log('   Your own rules are kept and never rewritten. The only thing removed is a');
  log('   legacy "cairn task" deny block seeded by an older cairn init, which breaks');
  log('   cairn run.)');

  const write = await promptBoolean(rl, 'Write permission rules?', true);
  if (!write) return [];

  let removal;
  let result;
  try {
    removal = removeSettingsRules(projectRoot, { deny: [...LEGACY_CAIRN_TASK_DENY_RULES] });
    result = mergeClaudeSettings(projectRoot, rules);
  } catch (err) {
    if (err instanceof ClaudeSettingsError) {
      // The message names the file and explains the manual fix. Init is nearly
      // done at this point, so report and continue rather than abort.
      log(`  ${err.message}`);
      return [];
    }
    throw err;
  }

  const removed = [...removal.removedAllow, ...removal.removedDeny];
  if (removed.length > 0) {
    log('  Removed a legacy deny block from .claude/settings.local.json:');
    for (const rule of removed) log(`    deny:  ${rule}`);
    log('    These blocked cairn run agents from recording task state, so the loop');
    log('    re-ran one task forever while reporting success.');
  }

  const added = [...result.addedAllow, ...result.addedDeny];
  if (added.length === 0) {
    if (removed.length === 0) log('  .claude/settings.local.json already has every rule.');
    return [];
  }

  log(`  ${result.created ? 'Created' : 'Updated'}: .claude/settings.local.json`);
  for (const rule of result.addedAllow) log(`    allow: ${rule}`);
  for (const rule of result.addedDeny) log(`    deny:  ${rule}`);

  log('');
  log('  WARNING: add .claude/settings.local.json to your .gitignore yourself.');
  log('    Claude Code only excludes that path when Claude Code itself creates the');
  log("    file, and it writes that entry to your global git excludes — not to this");
  log('    repository. Cairn does not edit .gitignore or your git config for you.');

  return added;
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
  await installClaudeSettings(projectRoot, config, rl);
  showNextSteps();

  rl.close();
}
