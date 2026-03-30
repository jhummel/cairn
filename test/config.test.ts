import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, autoDetectHealthCheck, discoverAgents, setConfigEnvVars } from '../src/config';
import { isValidConfig } from '../src/types';
import type { RalphConfig } from '../src/types';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `ralph-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all defaults when ralph.json does not exist', () => {
    const config = loadConfig(tmpDir);
    expect(config.projectName).toBe(path.basename(tmpDir));
    expect(config.projectDescription).toBe('');
    expect(config.healthCheck).toBe('');
    expect(config.defaultTestCommand).toBe('');
    expect(config.implementationFile).toBe('IMPLEMENTATION.md');
    expect(config.truncateText).toBe(true);
    expect(config.summarize.claudeMdPattern).toBe('');
    expect(config.narration.enabled).toBe(false);
    expect(config.narration.voice).toBe('bf_emma');
    expect(config.narration.ntfyTopic).toBe('');
  });

  it('loads a complete ralph.json', () => {
    const configData = {
      projectName: 'my-project',
      projectDescription: 'A test project',
      healthCheck: 'npm run check',
      defaultTestCommand: 'npm test',
      implementationFile: 'IMPL.md',
      truncateText: false,
      summarize: { claudeMdPattern: '**/CLAUDE.md' },
      narration: { enabled: true, voice: 'custom_voice', ntfyTopic: 'my-topic' },
    };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.projectName).toBe('my-project');
    expect(config.projectDescription).toBe('A test project');
    expect(config.healthCheck).toBe('npm run check');
    expect(config.defaultTestCommand).toBe('npm test');
    expect(config.implementationFile).toBe('IMPL.md');
    expect(config.truncateText).toBe(false);
    expect(config.summarize.claudeMdPattern).toBe('**/CLAUDE.md');
    expect(config.narration.enabled).toBe(true);
    expect(config.narration.voice).toBe('custom_voice');
    expect(config.narration.ntfyTopic).toBe('my-topic');
  });

  it('applies defaults for missing fields in partial ralph.json', () => {
    const configData = { projectName: 'partial-project' };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.projectName).toBe('partial-project');
    expect(config.projectDescription).toBe('');
    expect(config.healthCheck).toBe('');
    expect(config.defaultTestCommand).toBe('');
    expect(config.implementationFile).toBe('IMPLEMENTATION.md');
    expect(config.truncateText).toBe(true);
    expect(config.summarize.claudeMdPattern).toBe('');
    expect(config.narration.enabled).toBe(false);
    expect(config.narration.voice).toBe('bf_emma');
    expect(config.narration.ntfyTopic).toBe('');
  });

  it('applies defaults for partial narration object', () => {
    const configData = { narration: { enabled: true } };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.narration.enabled).toBe(true);
    expect(config.narration.voice).toBe('bf_emma');
    expect(config.narration.ntfyTopic).toBe('');
  });

  it('applies defaults for partial summarize object', () => {
    const configData = { summarize: {} };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.summarize.claudeMdPattern).toBe('');
  });

  it('uses directory basename as default projectName', () => {
    const namedDir = path.join(tmpDir, 'my-cool-project');
    fs.mkdirSync(namedDir);
    const config = loadConfig(namedDir);
    expect(config.projectName).toBe('my-cool-project');
  });

  it('defaults review.maxIterations to 3 when not specified', () => {
    const config = loadConfig(tmpDir);
    expect(config.review?.maxIterations).toBe(3);
  });

  it('loads review.maxIterations from ralph.json when specified', () => {
    const configData = { review: { maxIterations: 5 } };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));
    const config = loadConfig(tmpDir);
    expect(config.review?.maxIterations).toBe(5);
  });

  it('defaults review.maxIterations to 3 when review object is missing from ralph.json', () => {
    const configData = { projectName: 'my-project' };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));
    const config = loadConfig(tmpDir);
    expect(config.review?.maxIterations).toBe(3);
  });

  it('defaults review.maxIterations to 3 when review.maxIterations is missing', () => {
    const configData = { review: {} };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(configData));
    const config = loadConfig(tmpDir);
    expect(config.review?.maxIterations).toBe(3);
  });
});

describe('autoDetectHealthCheck', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects npm run type-check from package.json', () => {
    const pkg = { scripts: { 'type-check': 'tsc --noEmit' } };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

    expect(autoDetectHealthCheck(tmpDir)).toBe('npm run type-check');
  });

  it('ignores package.json without type-check script', () => {
    const pkg = { scripts: { test: 'jest' } };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

    expect(autoDetectHealthCheck(tmpDir)).toBe('');
  });

  it('ignores package.json without scripts field', () => {
    const pkg = { name: 'my-pkg' };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

    expect(autoDetectHealthCheck(tmpDir)).toBe('');
  });

  it('detects cargo check from Cargo.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');

    expect(autoDetectHealthCheck(tmpDir)).toBe('cargo check');
  });

  it('detects make check from Makefile with check target', () => {
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), 'all:\n\techo hello\n\ncheck:\n\techo checking');

    expect(autoDetectHealthCheck(tmpDir)).toBe('make check');
  });

  it('ignores Makefile without check target', () => {
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), 'all:\n\techo hello\n\nbuild:\n\techo building');

    expect(autoDetectHealthCheck(tmpDir)).toBe('');
  });

  it('returns empty string when no build system found', () => {
    expect(autoDetectHealthCheck(tmpDir)).toBe('');
  });

  it('prioritizes package.json type-check over Cargo.toml', () => {
    const pkg = { scripts: { 'type-check': 'tsc --noEmit' } };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');

    expect(autoDetectHealthCheck(tmpDir)).toBe('npm run type-check');
  });
});

describe('discoverAgents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when .claude/agents does not exist', () => {
    expect(discoverAgents(tmpDir)).toEqual([]);
  });

  it('returns empty array when .claude/agents is empty', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude', 'agents'), { recursive: true });
    expect(discoverAgents(tmpDir)).toEqual([]);
  });

  it('parses agent with full YAML frontmatter', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'test-agent.md'),
      `---
name: Test Agent
description: A test agent for testing
model: sonnet
---

This is the agent body.`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Test Agent');
    expect(agents[0].description).toBe('A test agent for testing');
    expect(agents[0].model).toBe('sonnet');
    expect(agents[0].file).toBe('test-agent.md');
  });

  it('uses filename (without .md) as default name when frontmatter lacks name', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'my-agent.md'),
      `---
description: No name field
---

Body content.`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('my-agent');
    expect(agents[0].description).toBe('No name field');
    expect(agents[0].model).toBe('');
  });

  it('handles agent file with no frontmatter', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'plain.md'), 'Just body text, no frontmatter.');

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('plain');
    expect(agents[0].description).toBe('');
    expect(agents[0].model).toBe('');
    expect(agents[0].file).toBe('plain.md');
  });

  it('discovers multiple agents sorted by filename', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'beta.md'),
      `---
name: Beta
---
`
    );
    fs.writeFileSync(
      path.join(agentsDir, 'alpha.md'),
      `---
name: Alpha
---
`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe('Alpha');
    expect(agents[1].name).toBe('Beta');
  });

  it('ignores non-.md files in agents directory', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'notes.txt'), 'not an agent');
    fs.writeFileSync(
      path.join(agentsDir, 'real.md'),
      `---
name: Real Agent
---
`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Real Agent');
  });

  it('strips quotes from frontmatter values', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'quoted.md'),
      `---
name: "Quoted Name"
description: 'Single quoted'
model: opus
---
`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Quoted Name');
    expect(agents[0].description).toBe('Single quoted');
    expect(agents[0].model).toBe('opus');
  });
});

describe('setConfigEnvVars', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'RALPH_PROJECT_NAME',
    'RALPH_PROJECT_DESC',
    'RALPH_HEALTH_CHECK',
    'RALPH_TEST_CMD',
    'RALPH_IMPL_FILE',
    'RALPH_CLAUDE_MD_PATTERN',
    'RALPH_TRUNCATE_TEXT',
    'RALPH_NARRATION_ENABLED',
    'RALPH_NARRATION_VOICE',
    'RALPH_NTFY_TOPIC',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('sets all RALPH_* env vars from config', () => {
    const config: RalphConfig = {
      projectName: 'test-proj',
      projectDescription: 'A desc',
      healthCheck: 'npm run check',
      defaultTestCommand: 'npm test',
      implementationFile: 'IMPL.md',
      truncateText: false,
      summarize: { claudeMdPattern: '**/CLAUDE.md' },
      narration: { enabled: true, voice: 'custom', ntfyTopic: 'topic' },
    };

    setConfigEnvVars(config);

    expect(process.env.RALPH_PROJECT_NAME).toBe('test-proj');
    expect(process.env.RALPH_PROJECT_DESC).toBe('A desc');
    expect(process.env.RALPH_HEALTH_CHECK).toBe('npm run check');
    expect(process.env.RALPH_TEST_CMD).toBe('npm test');
    expect(process.env.RALPH_IMPL_FILE).toBe('IMPL.md');
    expect(process.env.RALPH_CLAUDE_MD_PATTERN).toBe('**/CLAUDE.md');
    expect(process.env.RALPH_TRUNCATE_TEXT).toBe('false');
    expect(process.env.RALPH_NARRATION_ENABLED).toBe('true');
    expect(process.env.RALPH_NARRATION_VOICE).toBe('custom');
    expect(process.env.RALPH_NTFY_TOPIC).toBe('topic');
  });

  it('converts booleans to lowercase strings', () => {
    const config: RalphConfig = {
      projectName: 'proj',
      projectDescription: '',
      healthCheck: '',
      defaultTestCommand: '',
      implementationFile: 'IMPLEMENTATION.md',
      truncateText: true,
      summarize: { claudeMdPattern: '' },
      narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    };

    setConfigEnvVars(config);

    expect(process.env.RALPH_TRUNCATE_TEXT).toBe('true');
    expect(process.env.RALPH_NARRATION_ENABLED).toBe('false');
  });
});

describe('isValidConfig review.postTask', () => {
  const baseConfig = {
    projectName: 'proj',
    projectDescription: '',
    healthCheck: '',
    defaultTestCommand: '',
    implementationFile: 'IMPLEMENTATION.md',
    truncateText: true,
    summarize: { claudeMdPattern: '' },
    narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
  };

  it('accepts config with review.postTask: false', () => {
    expect(isValidConfig({ ...baseConfig, review: { maxIterations: 3, postTask: false } })).toBe(true);
  });

  it('accepts config with review.postTask: true', () => {
    expect(isValidConfig({ ...baseConfig, review: { maxIterations: 3, postTask: true } })).toBe(true);
  });

  it('accepts config with review omitted entirely', () => {
    expect(isValidConfig(baseConfig)).toBe(true);
  });

  it('rejects config with review.postTask as a string', () => {
    expect(isValidConfig({ ...baseConfig, review: { maxIterations: 3, postTask: 'yes' } })).toBe(false);
  });

  it('rejects config with review.postTask as a number', () => {
    expect(isValidConfig({ ...baseConfig, review: { maxIterations: 3, postTask: 1 } })).toBe(false);
  });

  it('rejects config with review present but postTask missing', () => {
    expect(isValidConfig({ ...baseConfig, review: { maxIterations: 3 } })).toBe(false);
  });
});

describe('loadConfig review.postTask', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `ralph-config-posttask-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults review.postTask to false when no ralph.json exists', () => {
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });

  it('defaults review.postTask to false when review object is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify({ projectName: 'x' }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });

  it('defaults review.postTask to false when review.postTask is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify({ review: { maxIterations: 5 } }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });

  it('loads review.postTask: true from ralph.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify({ review: { maxIterations: 3, postTask: true } }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(true);
  });

  it('loads review.postTask: false from ralph.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify({ review: { maxIterations: 3, postTask: false } }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });
});
