import * as fs from 'fs';
import * as path from 'path';
import { spawnSync as nodeSpawnSync } from 'child_process';
import type { RalphConfig } from '../types';
import { loadConfig, autoDetectHealthCheck } from '../config';
import { resolveRalphRoot } from '../utils';

const GITIGNORE_CONTENT = `# Ralph temp files (tasks.json and planning-notes.md are tracked)
.ralph_complete
.ralph_iterations.log
.ralph_prev_notes
.ralph_task_meta
.ralph_completed_ids
instructions.md
`;

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
  // Create .ralph/ directory
  if (fs.existsSync(dataDir)) {
    console.log('  .ralph/ directory already exists.');
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('  Created: .ralph/');
  }

  // Create .ralph/.gitignore
  const gitignorePath = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT);
    console.log('  Created: .ralph/.gitignore');
  }

  // Create .ralph/tasks.json
  const tasksPath = path.join(dataDir, 'tasks.json');
  if (fs.existsSync(tasksPath)) {
    console.log('  tasks.json already exists.');
  } else {
    const projectName = path.basename(projectRoot);
    fs.writeFileSync(tasksPath, JSON.stringify({ project: projectName, tasks: [] }, null, 2) + '\n');
    console.log('  Created: .ralph/tasks.json');
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
 * Get default config values for prompts. Loads from existing ralph.json if present,
 * otherwise uses sensible defaults. Auto-detects health check if not set.
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
 * Run interactive prompts for ralph.json configuration.
 * Uses the provided PromptInterface (real readline or mock for tests).
 */
export async function promptForConfig(
  rl: PromptInterface,
  defaults: ConfigDefaults,
): Promise<RalphConfig> {
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
 * Write a RalphConfig to ralph.json in the project root.
 */
export function writeRalphJson(projectRoot: string, config: RalphConfig): void {
  const configPath = path.join(projectRoot, 'ralph.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export type SpawnSyncResult = { status: number | null; error?: Error };
export type SpawnSyncFn = (cmd: string, args: string[], options: { stdio: 'inherit' }) => SpawnSyncResult;

/**
 * Offer to create .ralph/instructions.md and open it in $EDITOR.
 */
export async function createInstructionsFile(
  dataDir: string,
  rl: PromptInterface,
  spawnSyncFn: SpawnSyncFn = (cmd, args, opts) => nodeSpawnSync(cmd, args, opts),
): Promise<void> {
  const create = await promptBoolean(rl, 'Create .ralph/instructions.md for personal agent preferences?', false);
  if (!create) return;

  const instructionsPath = path.join(dataDir, 'instructions.md');
  if (!fs.existsSync(instructionsPath)) {
    fs.writeFileSync(instructionsPath, '');
    console.log('  Created: .ralph/instructions.md');
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
SOCKET="/tmp/ralph-tts.sock"
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
SOCKET="/tmp/ralph-tts.sock"
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
SOCKET="/tmp/ralph-tts.sock"
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
  console.log('  (These forward events to the Ralph narration server at /tmp/ralph-tts.sock)');

  const install = await promptBoolean(rl, 'Install hooks?', false);
  if (!install) return;

  fs.mkdirSync(hooksDir, { recursive: true });

  const writeHook = (name: string, content: string) => {
    const hookPath = path.join(hooksDir, name);
    fs.writeFileSync(hookPath, content);
    fs.chmodSync(hookPath, 0o755);
  };

  writeHook('narrate.sh', NARRATE_SH);
  writeHook('speak.sh', SPEAK_SH);
  writeHook('notify.sh', NOTIFY_SH);

  console.log('  Created: .claude/hooks/narrate.sh (PostToolUse)');
  console.log('  Created: .claude/hooks/speak.sh (Stop)');
  console.log('  Created: .claude/hooks/notify.sh (Notification)');
}

/**
 * Copy slash command .md files from ralph's commands/ directory
 * into the target project's .claude/commands/ directory.
 * Accepts an optional ralphRoot override for testing.
 */
export function installSlashCommands(projectRoot: string, ralphRoot?: string): void {
  const root = ralphRoot ?? resolveRalphRoot();
  const srcDir = path.join(root, 'commands');

  if (!fs.existsSync(srcDir)) {
    return;
  }

  const mdFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
  if (mdFiles.length === 0) return;

  const destDir = path.join(projectRoot, '.claude', 'commands');
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of mdFiles) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    console.log(`  Installed: .claude/commands/${file}`);
  }
}

/**
 * Print next steps after init.
 */
export function showNextSteps(): void {
  console.log('');
  console.log('Next steps:');
  console.log("  1. Run 'ralph plan' to start planning");
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
  console.log(`Initializing Ralph in: ${projectRoot}`);
  console.log('');

  initCoreFiles(projectRoot, dataDir);
  installSlashCommands(projectRoot);

  const defaults = getConfigDefaults(projectRoot);
  console.log('');
  const config = await promptForConfig(rl, defaults);
  writeRalphJson(projectRoot, config);
  console.log('');
  console.log('  Wrote: ralph.json');

  await createInstructionsFile(dataDir, rl, spawnSyncFn);
  await installNarrationHooks(projectRoot, config.narration.enabled, rl);
  showNextSteps();

  rl.close();
}
