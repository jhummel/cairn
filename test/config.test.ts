import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, findConfigFile, autoDetectHealthCheck, discoverAgents, setConfigEnvVars } from '../src/config';
import { isValidConfig } from '../src/types';
import type { CairnConfig } from '../src/types';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `cairn-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Reads the dead legacy `review.maxIterations` key off a loaded config, for the "must stay gone" pins below. */
function reviewMaxIterations(config: CairnConfig): number | undefined {
  return (config.review as { maxIterations?: number } | undefined)?.maxIterations;
}

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all defaults when cairn.json does not exist', () => {
    const config = loadConfig(tmpDir);
    expect(config.projectName).toBe(path.basename(tmpDir));
    expect(config.projectDescription).toBe('');
    expect(config.healthCheck).toBe('');
    expect(config.defaultTestCommand).toBe('');
    expect(config.implementationFile).toBe('IMPLEMENTATION.md');
    expect(config.truncateText).toBe(true);
    expect(config.summarize.claudeMdPattern).toBe('');
  });

  it('loads a complete cairn.json', () => {
    const configData = {
      projectName: 'my-project',
      projectDescription: 'A test project',
      healthCheck: 'npm run check',
      defaultTestCommand: 'npm test',
      implementationFile: 'IMPL.md',
      truncateText: false,
      summarize: { claudeMdPattern: '**/CLAUDE.md' },
    };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.projectName).toBe('my-project');
    expect(config.projectDescription).toBe('A test project');
    expect(config.healthCheck).toBe('npm run check');
    expect(config.defaultTestCommand).toBe('npm test');
    expect(config.implementationFile).toBe('IMPL.md');
    expect(config.truncateText).toBe(false);
    expect(config.summarize.claudeMdPattern).toBe('**/CLAUDE.md');
  });

  it('applies defaults for missing fields in partial cairn.json', () => {
    const configData = { projectName: 'partial-project' };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.projectName).toBe('partial-project');
    expect(config.projectDescription).toBe('');
    expect(config.healthCheck).toBe('');
    expect(config.defaultTestCommand).toBe('');
    expect(config.implementationFile).toBe('IMPLEMENTATION.md');
    expect(config.truncateText).toBe(true);
    expect(config.summarize.claudeMdPattern).toBe('');
  });

  it('loads a legacy cairn.json with a narration block, silently ignoring the key', () => {
    const configData = {
      projectName: 'legacy',
      narration: { enabled: false, voice: 'bf_emma', ntfyTopic: 'x' },
    };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));

    const seen: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalStderrWrite = process.stderr.write;
    console.warn = (...args: unknown[]) => { seen.push(args.join(' ')); };
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    process.stderr.write = ((chunk: unknown) => { seen.push(String(chunk)); return true; }) as typeof process.stderr.write;
    let config: CairnConfig;
    try {
      config = loadConfig(tmpDir);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
      process.stderr.write = originalStderrWrite;
    }
    expect(seen).toEqual([]);
    expect(config.projectName).toBe('legacy');
    expect('narration' in config).toBe(false);
  });

  it('applies defaults for partial summarize object', () => {
    const configData = { summarize: {} };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));

    const config = loadConfig(tmpDir);
    expect(config.summarize.claudeMdPattern).toBe('');
  });

  it('uses directory basename as default projectName', () => {
    const namedDir = path.join(tmpDir, 'my-cool-project');
    fs.mkdirSync(namedDir);
    const config = loadConfig(namedDir);
    expect(config.projectName).toBe('my-cool-project');
  });

  it('does not emit review.maxIterations when not specified', () => {
    const config = loadConfig(tmpDir);
    expect(reviewMaxIterations(config)).toBeUndefined();
  });

  it('ignores legacy review.maxIterations from cairn.json instead of emitting it', () => {
    const configData = { review: { maxIterations: 5 } };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));
    const config = loadConfig(tmpDir);
    expect(reviewMaxIterations(config)).toBeUndefined();
  });

  it('loads cleanly when review object is missing from cairn.json', () => {
    const configData = { projectName: 'my-project' };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));
    const config = loadConfig(tmpDir);
    expect(reviewMaxIterations(config)).toBeUndefined();
  });

  it('loads cleanly when review.maxIterations is missing', () => {
    const configData = { review: {} };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(configData));
    const config = loadConfig(tmpDir);
    expect(reviewMaxIterations(config)).toBeUndefined();
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

  it('parses internal: true from frontmatter as boolean true', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'internal-agent.md'),
      `---
name: internal-agent
description: An internal agent
internal: true
---

Body text.`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].internal).toBe(true);
  });

  it('yields falsy internal for agent without internal field', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'public-agent.md'),
      `---
name: public-agent
description: A public agent
---

Body text.`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].internal).toBeFalsy();
  });

  it('yields falsy internal for agent with no frontmatter', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'plain.md'), 'Just body text.');

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].internal).toBeFalsy();
  });

  it('marks every bundled non-executor agent as internal (planner, audit-planner, summarizer, post-task-reviewer)', () => {
    // Regression guard for the bug fixed in task #82: these four agents are
    // never appropriate as a task executor's specialist prompt (planner talks
    // to a user, audit-planner is read-only recon, summarizer only writes
    // IMPLEMENTATION.md, post-task-reviewer only writes review files). If any
    // of them loses its `internal: true` frontmatter, run.ts's guard in
    // buildSystemPrompt silently stops firing and its body gets injected
    // verbatim into a headless executor agent.
    const realAgentsDir = path.join(__dirname, '..', 'agents');
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const file of fs.readdirSync(realAgentsDir).filter(f => f.endsWith('.md'))) {
      fs.copyFileSync(path.join(realAgentsDir, file), path.join(agentsDir, file));
    }

    const agents = discoverAgents(tmpDir);
    const internalNames = ['planner', 'audit-planner', 'summarizer', 'post-task-reviewer'];
    for (const name of internalNames) {
      const agent = agents.find(a => a.name === name);
      expect(agent).toBeDefined();
      expect(agent!.internal).toBe(true);
    }
  });

  it('parses cairn-task-agent frontmatter, including the camelCase maxTurns key, without breaking other keys', () => {
    // cairn-task-agent.md declares a numeric `maxTurns` key alongside the usual
    // string fields. The frontmatter parser's key regex (`\w+`) already matches
    // camelCase, but this pins that down so a future change to the parser (e.g.
    // switching to a stricter key pattern) can't silently drop maxTurns or, worse,
    // corrupt neighboring keys like `internal`.
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'cairn-task-agent.md'),
      `---
name: cairn-task-agent
description: Executes one Cairn task from a prompt file written by \`cairn round next\`. Internal — launched by /cairn-run only.
internal: true
maxTurns: 150
---

Body text.`
    );

    const agents = discoverAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('cairn-task-agent');
    expect(agents[0].internal).toBe(true);
  });
});

describe('setConfigEnvVars', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'CAIRN_PROJECT_NAME',
    'CAIRN_PROJECT_DESC',
    'CAIRN_HEALTH_CHECK',
    'CAIRN_TEST_CMD',
    'CAIRN_IMPL_FILE',
    'CAIRN_CLAUDE_MD_PATTERN',
    'CAIRN_TRUNCATE_TEXT',
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

  it('sets all CAIRN_* env vars from config', () => {
    const config: CairnConfig = {
      projectName: 'test-proj',
      projectDescription: 'A desc',
      healthCheck: 'npm run check',
      defaultTestCommand: 'npm test',
      implementationFile: 'IMPL.md',
      truncateText: false,
      summarize: { claudeMdPattern: '**/CLAUDE.md' },
    };

    setConfigEnvVars(config);

    expect(process.env.CAIRN_PROJECT_NAME).toBe('test-proj');
    expect(process.env.CAIRN_PROJECT_DESC).toBe('A desc');
    expect(process.env.CAIRN_HEALTH_CHECK).toBe('npm run check');
    expect(process.env.CAIRN_TEST_CMD).toBe('npm test');
    expect(process.env.CAIRN_IMPL_FILE).toBe('IMPL.md');
    expect(process.env.CAIRN_CLAUDE_MD_PATTERN).toBe('**/CLAUDE.md');
    expect(process.env.CAIRN_TRUNCATE_TEXT).toBe('false');
  });

  it('converts booleans to lowercase strings', () => {
    const config: CairnConfig = {
      projectName: 'proj',
      projectDescription: '',
      healthCheck: '',
      defaultTestCommand: '',
      implementationFile: 'IMPLEMENTATION.md',
      truncateText: true,
      summarize: { claudeMdPattern: '' },
    };

    setConfigEnvVars(config);

    expect(process.env.CAIRN_TRUNCATE_TEXT).toBe('true');
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
    tmpDir = path.join(os.tmpdir(), `cairn-config-posttask-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults review.postTask to false when no cairn.json exists', () => {
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });

  it('defaults review.postTask to false when review object is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify({ projectName: 'x' }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });

  it('defaults review.postTask to false when review.postTask is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify({ review: { maxIterations: 5 } }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });

  it('loads review.postTask: true from cairn.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify({ review: { maxIterations: 3, postTask: true } }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(true);
  });

  it('loads review.postTask: false from cairn.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify({ review: { maxIterations: 3, postTask: false } }));
    const config = loadConfig(tmpDir);
    expect(config.review?.postTask).toBe(false);
  });
});

describe('loadConfig — config file discovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads cairn.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify({ projectName: 'modern' }));
    expect(loadConfig(tmpDir).projectName).toBe('modern');
  });

  it('returns defaults when no config file exists', () => {
    expect(loadConfig(tmpDir).projectName).toBe(path.basename(tmpDir));
  });

  it('ignores a ralph.json left behind by an unmigrated project', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify({ projectName: 'legacy' }));
    expect(loadConfig(tmpDir).projectName).toBe(path.basename(tmpDir));
  });

  it('emits no warnings when loading config', () => {
    const seen: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    try {
      fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify({ projectName: 'modern' }));
      loadConfig(tmpDir);
    } finally {
      console.error = originalError;
    }
    expect(seen.length).toBe(0);
  });
});

describe('findConfigFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves to cairn.json when it exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), '{}');
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'cairn.json'));
  });

  it('resolves to cairn.json even when only a ralph.json exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), '{}');
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'cairn.json'));
  });

  it('defaults to cairn.json when neither exists, so new config is created there', () => {
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'cairn.json'));
  });
});
