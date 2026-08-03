import * as fs from 'fs';
import * as path from 'path';
import type { CairnConfig, AgentInfo } from './types';
import { BRAND, LEGACY, warnLegacyOnce } from './brand';

/**
 * Resolve the config file path for a project root.
 *
 * Prefers an existing cairn.json, falls back to an existing legacy ralph.json,
 * and defaults to cairn.json when neither exists so that new config is written
 * under the current brand. Always use this (never BRAND.configFile) when
 * reading or editing config that is expected to already exist.
 */
export function findConfigFile(projectRoot: string): string {
  const current = path.join(projectRoot, BRAND.configFile);
  if (fs.existsSync(current)) return current;

  const legacy = path.join(projectRoot, LEGACY.configFile);
  if (fs.existsSync(legacy)) {
    warnLegacyOnce(
      'config-file',
      `Using legacy ${LEGACY.configFile} at ${projectRoot}. ` +
        `${BRAND.displayName} now reads ${BRAND.configFile}; ` +
        `${LEGACY.configFile} is still read but support will be removed in a future release.`
    );
    return legacy;
  }

  return current;
}

/**
 * Load and parse cairn.json (or a legacy ralph.json) from projectRoot,
 * applying defaults for missing fields.
 * Returns all defaults if no config file exists.
 */
export function loadConfig(projectRoot: string): CairnConfig {
  const configPath = findConfigFile(projectRoot);

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

  const reviewRaw = (typeof raw.review === 'object' && raw.review !== null)
    ? raw.review as Record<string, unknown>
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
    review: {
      maxIterations: typeof reviewRaw.maxIterations === 'number' ? reviewRaw.maxIterations : 3,
      postTask: typeof reviewRaw.postTask === 'boolean' ? reviewRaw.postTask : false,
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
      ...(meta.internal === 'true' ? { internal: true } : {}),
    });
  }

  return agents;
}

/**
 * Set CAIRN_* environment variables from a config object, for subcommands to read.
 */
export function setConfigEnvVars(config: CairnConfig): void {
  process.env.CAIRN_PROJECT_NAME = config.projectName;
  process.env.CAIRN_PROJECT_DESC = config.projectDescription;
  process.env.CAIRN_HEALTH_CHECK = config.healthCheck;
  process.env.CAIRN_TEST_CMD = config.defaultTestCommand;
  process.env.CAIRN_IMPL_FILE = config.implementationFile;
  process.env.CAIRN_CLAUDE_MD_PATTERN = config.summarize.claudeMdPattern;
  process.env.CAIRN_TRUNCATE_TEXT = String(config.truncateText);
  process.env.CAIRN_NARRATION_ENABLED = String(config.narration.enabled);
  process.env.CAIRN_NARRATION_VOICE = config.narration.voice;
  process.env.CAIRN_NTFY_TOPIC = config.narration.ntfyTopic;
}

export interface AnthropicApiKeyResolution {
  key: string | undefined;
  source: 'cairn' | 'legacy' | 'plain' | 'none';
}

/**
 * Resolve the Anthropic API key the narration server should use.
 *
 * CAIRN_ANTHROPIC_API_KEY -> legacy RALPH_ANTHROPIC_API_KEY -> plain ANTHROPIC_API_KEY.
 * The main loop blanks ANTHROPIC_API_KEY before spawning `claude` (run.ts, plan.ts,
 * summarize.ts, post-task-reviewer.ts) to force Max-plan usage, so the prefixed names
 * are what still let the narration server reach a real key. Never normalize the
 * resolved value onto plain ANTHROPIC_API_KEY — that would defeat the blanking above.
 */
export function resolveAnthropicApiKeyChain(
  env: Record<string, string | undefined> = process.env
): AnthropicApiKeyResolution {
  if (env.CAIRN_ANTHROPIC_API_KEY) {
    return { key: env.CAIRN_ANTHROPIC_API_KEY, source: 'cairn' };
  }
  if (env.RALPH_ANTHROPIC_API_KEY) {
    return { key: env.RALPH_ANTHROPIC_API_KEY, source: 'legacy' };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { key: env.ANTHROPIC_API_KEY, source: 'plain' };
  }
  return { key: undefined, source: 'none' };
}

/**
 * Warn once when an Anthropic API key resolution fell back to the legacy
 * RALPH_ANTHROPIC_API_KEY name.
 */
export function warnIfLegacyApiKey(resolution: AnthropicApiKeyResolution): void {
  if (resolution.source !== 'legacy') return;
  warnLegacyOnce(
    'anthropic-api-key',
    `Using legacy RALPH_ANTHROPIC_API_KEY. ${BRAND.displayName} now reads CAIRN_ANTHROPIC_API_KEY; ` +
      `RALPH_ANTHROPIC_API_KEY is still read but support will be removed in a future release.`
  );
}
