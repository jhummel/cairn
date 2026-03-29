import * as fs from 'fs';
import * as path from 'path';
import type { RalphConfig, AgentInfo } from './types';

/**
 * Load and parse ralph.json from projectRoot, applying defaults for missing fields.
 * Returns all defaults if ralph.json doesn't exist.
 */
export function loadConfig(projectRoot: string): RalphConfig {
  const configPath = path.join(projectRoot, 'ralph.json');

  let raw: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  const narrationRaw = (typeof raw.narration === 'object' && raw.narration !== null)
    ? raw.narration as Record<string, unknown>
    : {};

  const summarizeRaw = (typeof raw.summarize === 'object' && raw.summarize !== null)
    ? raw.summarize as Record<string, unknown>
    : {};

  return {
    projectName: typeof raw.projectName === 'string' ? raw.projectName : path.basename(projectRoot),
    projectDescription: typeof raw.projectDescription === 'string' ? raw.projectDescription : '',
    healthCheck: typeof raw.healthCheck === 'string' ? raw.healthCheck : '',
    defaultTestCommand: typeof raw.defaultTestCommand === 'string' ? raw.defaultTestCommand : '',
    implementationFile: typeof raw.implementationFile === 'string' ? raw.implementationFile : 'IMPLEMENTATION.md',
    truncateText: typeof raw.truncateText === 'boolean' ? raw.truncateText : true,
    summarize: {
      claudeMdPattern: typeof summarizeRaw.claudeMdPattern === 'string' ? summarizeRaw.claudeMdPattern : '',
    },
    narration: {
      enabled: typeof narrationRaw.enabled === 'boolean' ? narrationRaw.enabled : false,
      voice: typeof narrationRaw.voice === 'string' ? narrationRaw.voice : 'bf_emma',
      ntfyTopic: typeof narrationRaw.ntfyTopic === 'string' ? narrationRaw.ntfyTopic : '',
    },
  };
}

/**
 * Auto-detect a health check command based on project build system files.
 */
export function autoDetectHealthCheck(projectRoot: string): string {
  // Check package.json for type-check script
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.['type-check']) {
        return 'npm run type-check';
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // Check Cargo.toml
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo check';
  }

  // Check Makefile for check: target
  const makefilePath = path.join(projectRoot, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    const content = fs.readFileSync(makefilePath, 'utf-8');
    if (/^check:/m.test(content)) {
      return 'make check';
    }
  }

  return '';
}

/**
 * Discover Claude agents from .claude/agents/*.md files.
 * Parses YAML frontmatter between --- delimiters.
 */
export function discoverAgents(projectRoot: string): AgentInfo[] {
  const agentsDir = path.join(projectRoot, '.claude', 'agents');

  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort();
  const agents: AgentInfo[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    const meta: Record<string, string> = {};

    if (content.startsWith('---')) {
      const end = content.indexOf('---', 3);
      if (end !== -1) {
        const frontmatter = content.slice(3, end).trim();
        for (const line of frontmatter.split('\n')) {
          const match = line.match(/^(\w+)\s*:\s*(.+)$/);
          if (match) {
            meta[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
          }
        }
      }
    }

    agents.push({
      name: meta.name || file.replace(/\.md$/, ''),
      description: meta.description || '',
      model: meta.model || '',
      file,
    });
  }

  return agents;
}

/**
 * Set RALPH_* environment variables from a config object.
 * Matches the env var names from ralph_config.sh for shell fallback compatibility.
 */
export function setConfigEnvVars(config: RalphConfig): void {
  process.env.RALPH_PROJECT_NAME = config.projectName;
  process.env.RALPH_PROJECT_DESC = config.projectDescription;
  process.env.RALPH_HEALTH_CHECK = config.healthCheck;
  process.env.RALPH_TEST_CMD = config.defaultTestCommand;
  process.env.RALPH_IMPL_FILE = config.implementationFile;
  process.env.RALPH_CLAUDE_MD_PATTERN = config.summarize.claudeMdPattern;
  process.env.RALPH_TRUNCATE_TEXT = String(config.truncateText);
  process.env.RALPH_NARRATION_ENABLED = String(config.narration.enabled);
  process.env.RALPH_NARRATION_VOICE = config.narration.voice;
  process.env.RALPH_NTFY_TOPIC = config.narration.ntfyTopic;
}
