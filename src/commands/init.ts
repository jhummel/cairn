import * as fs from 'fs';
import * as path from 'path';
import type { RalphConfig } from '../types';
import { loadConfig, autoDetectHealthCheck } from '../config';

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

  return {
    projectName,
    projectDescription,
    healthCheck,
    defaultTestCommand,
    implementationFile,
    truncateText,
    summarize: { claudeMdPattern },
    narration: { enabled: narrationEnabled, voice: narrationVoice, ntfyTopic },
  };
}

/**
 * Write a RalphConfig to ralph.json in the project root.
 */
export function writeRalphJson(projectRoot: string, config: RalphConfig): void {
  const configPath = path.join(projectRoot, 'ralph.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
