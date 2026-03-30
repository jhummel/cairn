import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  initCoreFiles,
  parseBooleanInput,
  getConfigDefaults,
  promptForConfig,
  writeRalphJson,
  createInstructionsFile,
  installNarrationHooks,
  installSlashCommands,
  showNextSteps,
  runInit,
  type PromptInterface,
  type ConfigDefaults,
  type SpawnSyncFn,
} from '../../src/commands/init';

// --- initCoreFiles tests (existing) ---

describe('initCoreFiles', () => {
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;
  let tmpDir: string;

  beforeEach(() => {
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-init-test-'));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('creates .ralph/ directory when it does not exist', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.statSync(dataDir).isDirectory()).toBe(true);
  });

  test('prints Created: .ralph/ when directory is new', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .ralph/');
  });

  test('prints .ralph/ directory already exists when it exists', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(dataDir);
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('.ralph/ directory already exists.');
    expect(stdoutLines).not.toContain('  Created: .ralph/');
  });

  test('creates .ralph/.gitignore with correct content', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('.ralph_complete');
    expect(content).toContain('.ralph_iterations.log');
    expect(content).toContain('.ralph_prev_notes');
    expect(content).toContain('.ralph_task_meta');
    expect(content).toContain('.ralph_completed_ids');
    expect(content).toContain('instructions.md');
  });

  test('prints Created: .ralph/.gitignore', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .ralph/.gitignore');
  });

  test('does not overwrite existing .gitignore', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    const originalContent = '# custom\n';
    fs.writeFileSync(gitignorePath, originalContent);
    initCoreFiles(tmpDir, dataDir);
    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(originalContent);
    expect(stdoutLines.join('\n')).not.toContain('Created: .ralph/.gitignore');
  });

  test('creates .ralph/tasks.json with project name and empty tasks', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    const tasksPath = path.join(dataDir, 'tasks.json');
    expect(fs.existsSync(tasksPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    expect(data.project).toBe(path.basename(tmpDir));
    expect(data.tasks).toEqual([]);
  });

  test('prints Created: .ralph/tasks.json', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .ralph/tasks.json');
  });

  test('prints tasks.json already exists when it exists', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(dataDir);
    const tasksPath = path.join(dataDir, 'tasks.json');
    fs.writeFileSync(tasksPath, JSON.stringify({ project: 'old', tasks: [{ id: 1 }] }));
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('tasks.json already exists.');
    expect(stdoutLines.join('\n')).not.toContain('Created: .ralph/tasks.json');
  });

  test('does not overwrite existing tasks.json', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(dataDir);
    const tasksPath = path.join(dataDir, 'tasks.json');
    const original = { project: 'myproject', tasks: [{ id: 99 }] };
    fs.writeFileSync(tasksPath, JSON.stringify(original));
    initCoreFiles(tmpDir, dataDir);
    const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    expect(data.tasks).toEqual([{ id: 99 }]);
  });

  test('is idempotent — running twice produces same files', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    const gitignoreAfterFirst = fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8');
    const tasksAfterFirst = fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8');

    consoleSpy.mockClear();
    initCoreFiles(tmpDir, dataDir);

    expect(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8')).toBe(gitignoreAfterFirst);
    expect(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8')).toBe(tasksAfterFirst);
  });

  test('second run prints already-exists messages', () => {
    const dataDir = path.join(tmpDir, '.ralph');
    initCoreFiles(tmpDir, dataDir);
    consoleSpy.mockClear();
    stdoutLines = [];
    initCoreFiles(tmpDir, dataDir);
    const output = stdoutLines.join('\n');
    expect(output).toContain('.ralph/ directory already exists.');
    expect(output).toContain('tasks.json already exists.');
    expect(stdoutLines).not.toContain('  Created: .ralph/');
    expect(output).not.toContain('Created: .ralph/tasks.json');
  });

  test('tasks.json project name matches directory basename', () => {
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectDir);
    const dataDir = path.join(projectDir, '.ralph');
    initCoreFiles(projectDir, dataDir);
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8'));
    expect(data.project).toBe('my-project');
  });
});

// --- parseBooleanInput tests ---

describe('parseBooleanInput', () => {
  test('empty string returns default true', () => {
    expect(parseBooleanInput('', true)).toBe(true);
  });

  test('empty string returns default false', () => {
    expect(parseBooleanInput('', false)).toBe(false);
  });

  test('"y" returns true', () => {
    expect(parseBooleanInput('y', false)).toBe(true);
  });

  test('"Y" returns true', () => {
    expect(parseBooleanInput('Y', false)).toBe(true);
  });

  test('"yes" returns true', () => {
    expect(parseBooleanInput('yes', false)).toBe(true);
  });

  test('"YES" returns true', () => {
    expect(parseBooleanInput('YES', false)).toBe(true);
  });

  test('"n" returns false', () => {
    expect(parseBooleanInput('n', true)).toBe(false);
  });

  test('"N" returns false', () => {
    expect(parseBooleanInput('N', true)).toBe(false);
  });

  test('"no" returns false', () => {
    expect(parseBooleanInput('no', true)).toBe(false);
  });

  test('"NO" returns false', () => {
    expect(parseBooleanInput('NO', true)).toBe(false);
  });

  test('"yep" returns true (starts with y)', () => {
    expect(parseBooleanInput('yep', false)).toBe(true);
  });

  test('"nope" returns false (starts with n)', () => {
    expect(parseBooleanInput('nope', true)).toBe(false);
  });

  test('whitespace-only returns default', () => {
    expect(parseBooleanInput('  ', true)).toBe(true);
    expect(parseBooleanInput('  ', false)).toBe(false);
  });
});

// --- getConfigDefaults tests ---

describe('getConfigDefaults', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-defaults-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('returns sensible defaults when no ralph.json exists', () => {
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.projectName).toBe(path.basename(tmpDir));
    expect(defaults.projectDescription).toBe('');
    expect(defaults.healthCheck).toBe('');
    expect(defaults.defaultTestCommand).toBe('');
    expect(defaults.implementationFile).toBe('IMPLEMENTATION.md');
    expect(defaults.truncateText).toBe(true);
    expect(defaults.claudeMdPattern).toBe('');
    expect(defaults.narrationEnabled).toBe(false);
    expect(defaults.narrationVoice).toBe('bf_emma');
    expect(defaults.ntfyTopic).toBe('');
  });

  test('auto-detects health check from package.json with type-check script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc --noEmit' } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.healthCheck).toBe('npm run type-check');
  });

  test('loads existing ralph.json values as defaults', () => {
    const existing = {
      projectName: 'my-app',
      projectDescription: 'A cool app',
      healthCheck: 'make check',
      defaultTestCommand: 'bun test',
      implementationFile: 'DOCS.md',
      truncateText: false,
      summarize: { claudeMdPattern: '**/CLAUDE.md' },
      narration: { enabled: true, voice: 'af_sky', ntfyTopic: 'my-topic' },
    };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(existing, null, 2));
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.projectName).toBe('my-app');
    expect(defaults.projectDescription).toBe('A cool app');
    expect(defaults.healthCheck).toBe('make check');
    expect(defaults.defaultTestCommand).toBe('bun test');
    expect(defaults.implementationFile).toBe('DOCS.md');
    expect(defaults.truncateText).toBe(false);
    expect(defaults.claudeMdPattern).toBe('**/CLAUDE.md');
    expect(defaults.narrationEnabled).toBe(true);
    expect(defaults.narrationVoice).toBe('af_sky');
    expect(defaults.ntfyTopic).toBe('my-topic');
  });

  test('partially populated ralph.json fills in missing fields with defaults', () => {
    const partial = { projectName: 'partial-app' };
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), JSON.stringify(partial));
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.projectName).toBe('partial-app');
    expect(defaults.implementationFile).toBe('IMPLEMENTATION.md');
    expect(defaults.truncateText).toBe(true);
    expect(defaults.narrationEnabled).toBe(false);
  });

  test('auto-detect does not override existing ralph.json healthCheck', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc' } })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'ralph.json'),
      JSON.stringify({ healthCheck: 'custom check' })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.healthCheck).toBe('custom check');
  });

  test('auto-detect is used when ralph.json healthCheck is empty', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc' } })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'ralph.json'),
      JSON.stringify({ healthCheck: '' })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.healthCheck).toBe('npm run type-check');
  });

  test('returns reviewMaxIterations default of 3 when no ralph.json', () => {
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewMaxIterations).toBe(3);
  });

  test('loads reviewMaxIterations from ralph.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'ralph.json'),
      JSON.stringify({ review: { maxIterations: 5 } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewMaxIterations).toBe(5);
  });

  test('returns reviewPostTask default of false when no ralph.json', () => {
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewPostTask).toBe(false);
  });

  test('loads reviewPostTask: true from ralph.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'ralph.json'),
      JSON.stringify({ review: { maxIterations: 3, postTask: true } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewPostTask).toBe(true);
  });

  test('loads reviewPostTask: false from ralph.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'ralph.json'),
      JSON.stringify({ review: { maxIterations: 3, postTask: false } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewPostTask).toBe(false);
  });
});

// --- Mock PromptInterface helper ---

function createMockPrompt(answers: string[]): PromptInterface {
  let index = 0;
  return {
    question: async (_query: string): Promise<string> => {
      if (index >= answers.length) return '';
      return answers[index++];
    },
    close: () => {},
  };
}

// --- promptForConfig tests ---

describe('promptForConfig', () => {
  const baseDefaults: ConfigDefaults = {
    projectName: 'test-project',
    projectDescription: '',
    healthCheck: '',
    defaultTestCommand: '',
    implementationFile: 'IMPLEMENTATION.md',
    truncateText: true,
    claudeMdPattern: '',
    narrationEnabled: false,
    narrationVoice: 'bf_emma',
    ntfyTopic: '',
    reviewMaxIterations: 3,
    reviewPostTask: false,
  };

  test('all empty answers use defaults', async () => {
    // 8 prompts: name, desc, health, test, impl, truncate, claudeMd, narration
    const rl = createMockPrompt(['', '', '', '', '', '', '', '']);
    const config = await promptForConfig(rl, baseDefaults);
    expect(config.projectName).toBe('test-project');
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

  test('custom values override defaults', async () => {
    const rl = createMockPrompt([
      'my-app',           // project name
      'My application',   // description
      'make check',       // health check
      'bun test',         // test command
      'DOCS.md',          // impl file
      'n',                // truncate = false
      '**/CLAUDE.md',     // claudeMd pattern
      'y',                // narration enabled
      'af_sky',           // voice (conditional prompt)
      'my-topic',         // ntfy topic (conditional prompt)
    ]);
    const config = await promptForConfig(rl, baseDefaults);
    expect(config.projectName).toBe('my-app');
    expect(config.projectDescription).toBe('My application');
    expect(config.healthCheck).toBe('make check');
    expect(config.defaultTestCommand).toBe('bun test');
    expect(config.implementationFile).toBe('DOCS.md');
    expect(config.truncateText).toBe(false);
    expect(config.summarize.claudeMdPattern).toBe('**/CLAUDE.md');
    expect(config.narration.enabled).toBe(true);
    expect(config.narration.voice).toBe('af_sky');
    expect(config.narration.ntfyTopic).toBe('my-topic');
  });

  test('narration sub-prompts are skipped when narration is disabled', async () => {
    const rl = createMockPrompt([
      '', '', '', '', '', '', '', 'n',
    ]);
    const config = await promptForConfig(rl, baseDefaults);
    expect(config.narration.enabled).toBe(false);
    expect(config.narration.voice).toBe('bf_emma');
    expect(config.narration.ntfyTopic).toBe('');
  });

  test('narration sub-prompts appear when narration is enabled', async () => {
    const rl = createMockPrompt([
      '', '', '', '', '', '', '', 'y', 'custom_voice', 'notifications',
    ]);
    const config = await promptForConfig(rl, baseDefaults);
    expect(config.narration.enabled).toBe(true);
    expect(config.narration.voice).toBe('custom_voice');
    expect(config.narration.ntfyTopic).toBe('notifications');
  });

  test('narration sub-prompts use defaults on empty input', async () => {
    const defaults: ConfigDefaults = {
      ...baseDefaults,
      narrationEnabled: true,
      narrationVoice: 'bf_emma',
      ntfyTopic: 'existing-topic',
    };
    // 8 base prompts + 2 narration sub-prompts (empty = use defaults)
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', '']);
    const config = await promptForConfig(rl, defaults);
    expect(config.narration.enabled).toBe(true);
    expect(config.narration.voice).toBe('bf_emma');
    expect(config.narration.ntfyTopic).toBe('existing-topic');
  });

  test('boolean prompt shows Y/n when default is true', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await promptForConfig(rl, baseDefaults);
    // truncateText defaults to true → should show [Y/n]
    const truncateQ = questions.find(q => q.includes('Truncate'));
    expect(truncateQ).toContain('[Y/n]');
  });

  test('boolean prompt shows y/N when default is false', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await promptForConfig(rl, baseDefaults);
    // narrationEnabled defaults to false → should show [y/N]
    const narrationQ = questions.find(q => q.includes('narration'));
    expect(narrationQ).toContain('[y/N]');
  });

  test('re-init defaults are shown in prompt brackets', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    const defaults: ConfigDefaults = {
      ...baseDefaults,
      projectName: 'existing-app',
      implementationFile: 'DOCS.md',
    };
    await promptForConfig(rl, defaults);
    const nameQ = questions.find(q => q.includes('Project name'));
    expect(nameQ).toContain('existing-app');
    const implQ = questions.find(q => q.includes('Implementation file'));
    expect(implQ).toContain('DOCS.md');
  });

  test('empty answer for review.maxIterations uses default 3', async () => {
    // All prompts empty → review.maxIterations should default to 3
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '']);
    const config = await promptForConfig(rl, baseDefaults);
    expect(config.review?.maxIterations).toBe(3);
  });

  test('custom review.maxIterations value is used', async () => {
    // Prompts: name, desc, health, test, impl, truncate, claudeMd, narration, reviewMaxIterations
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '5']);
    const config = await promptForConfig(rl, baseDefaults);
    expect(config.review?.maxIterations).toBe(5);
  });

  test('review.maxIterations prompt shows default value in brackets', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await promptForConfig(rl, { ...baseDefaults, reviewMaxIterations: 3 });
    const reviewQ = questions.find(q => q.toLowerCase().includes('review') || q.toLowerCase().includes('max iterations'));
    expect(reviewQ).toBeDefined();
    expect(reviewQ).toContain('3');
  });

  test('promptForConfig prompts for reviewPostTask after reviewMaxIterations', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await promptForConfig(rl, { ...baseDefaults, reviewPostTask: false });
    const postTaskQ = questions.find(q => q.toLowerCase().includes('post') || q.toLowerCase().includes('posttask'));
    expect(postTaskQ).toBeDefined();
  });

  test('reviewPostTask defaults to false on empty input', async () => {
    // prompts: name, desc, health, test, impl, truncate, claudeMd, narration, reviewMaxIter, reviewPostTask
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', '']);
    const config = await promptForConfig(rl, { ...baseDefaults, reviewPostTask: false });
    expect(config.review?.postTask).toBe(false);
  });

  test('reviewPostTask is set to true when user answers y', async () => {
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', 'y']);
    const config = await promptForConfig(rl, { ...baseDefaults, reviewPostTask: false });
    expect(config.review?.postTask).toBe(true);
  });

  test('reviewPostTask shows [y/N] when default is false', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await promptForConfig(rl, { ...baseDefaults, reviewPostTask: false });
    const postTaskQ = questions.find(q => q.toLowerCase().includes('post') || q.toLowerCase().includes('posttask'));
    expect(postTaskQ).toContain('[y/N]');
  });
});

// --- writeRalphJson tests ---

describe('writeRalphJson', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-write-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('writes ralph.json with correct structure', () => {
    const config = {
      projectName: 'my-app',
      projectDescription: 'A test app',
      healthCheck: 'make check',
      defaultTestCommand: 'bun test',
      implementationFile: 'IMPLEMENTATION.md',
      truncateText: true,
      summarize: { claudeMdPattern: '' },
      narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    };
    writeRalphJson(tmpDir, config);
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.json'), 'utf8'));
    expect(written.projectName).toBe('my-app');
    expect(written.projectDescription).toBe('A test app');
    expect(written.healthCheck).toBe('make check');
    expect(written.defaultTestCommand).toBe('bun test');
    expect(written.implementationFile).toBe('IMPLEMENTATION.md');
    expect(written.truncateText).toBe(true);
    expect(written.summarize.claudeMdPattern).toBe('');
    expect(written.narration.enabled).toBe(false);
    expect(written.narration.voice).toBe('bf_emma');
    expect(written.narration.ntfyTopic).toBe('');
  });

  test('file ends with newline', () => {
    const config = {
      projectName: 'x',
      projectDescription: '',
      healthCheck: '',
      defaultTestCommand: '',
      implementationFile: 'IMPLEMENTATION.md',
      truncateText: true,
      summarize: { claudeMdPattern: '' },
      narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    };
    writeRalphJson(tmpDir, config);
    const raw = fs.readFileSync(path.join(tmpDir, 'ralph.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('overwrites existing ralph.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), '{"old": true}');
    const config = {
      projectName: 'new-app',
      projectDescription: '',
      healthCheck: '',
      defaultTestCommand: '',
      implementationFile: 'IMPLEMENTATION.md',
      truncateText: true,
      summarize: { claudeMdPattern: '' },
      narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    };
    writeRalphJson(tmpDir, config);
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.json'), 'utf8'));
    expect(written.projectName).toBe('new-app');
    expect(written.old).toBeUndefined();
  });

  test('JSON is pretty-printed with 2-space indent', () => {
    const config = {
      projectName: 'x',
      projectDescription: '',
      healthCheck: '',
      defaultTestCommand: '',
      implementationFile: 'IMPLEMENTATION.md',
      truncateText: true,
      summarize: { claudeMdPattern: '' },
      narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
    };
    writeRalphJson(tmpDir, config);
    const raw = fs.readFileSync(path.join(tmpDir, 'ralph.json'), 'utf8');
    // Should match JSON.stringify with 2-space indent
    expect(raw).toBe(JSON.stringify(config, null, 2) + '\n');
  });
});

// --- createInstructionsFile tests ---

describe('createInstructionsFile', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-instructions-test-'));
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  const noopSpawn: SpawnSyncFn = () => ({ status: 0 });

  test('does nothing when user declines', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(['n']);
    await createInstructionsFile(dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(dataDir, 'instructions.md'))).toBe(false);
    expect(stdoutLines.join('\n')).not.toContain('instructions.md');
  });

  test('creates instructions.md when user accepts', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(dataDir, 'instructions.md'))).toBe(true);
  });

  test('prints Created: .ralph/instructions.md', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Created: .ralph/instructions.md');
  });

  test('does not overwrite existing instructions.md', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const instructionsPath = path.join(dataDir, 'instructions.md');
    fs.writeFileSync(instructionsPath, '# my notes\n');
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(dataDir, rl, noopSpawn);
    expect(fs.readFileSync(instructionsPath, 'utf8')).toBe('# my notes\n');
    expect(stdoutLines.join('\n')).not.toContain('Created: .ralph/instructions.md');
  });

  test('launches $EDITOR with the file path', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(['y']);
    let spawnedCmd = '';
    let spawnedArgs: string[] = [];
    const captureSpawn: SpawnSyncFn = (cmd, args) => {
      spawnedCmd = cmd;
      spawnedArgs = args;
      return { status: 0 };
    };
    const origEditor = process.env.EDITOR;
    process.env.EDITOR = '/usr/bin/nano';
    try {
      await createInstructionsFile(dataDir, rl, captureSpawn);
      expect(spawnedCmd).toBe('/usr/bin/nano');
      expect(spawnedArgs[0]).toContain('instructions.md');
    } finally {
      if (origEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = origEditor;
    }
  });

  test('falls back to vi when $EDITOR is not set', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(['y']);
    let spawnedCmd = '';
    const captureSpawn: SpawnSyncFn = (cmd) => { spawnedCmd = cmd; return { status: 0 }; };
    const origEditor = process.env.EDITOR;
    delete process.env.EDITOR;
    try {
      await createInstructionsFile(dataDir, rl, captureSpawn);
      expect(spawnedCmd).toBe('vi');
    } finally {
      if (origEditor !== undefined) process.env.EDITOR = origEditor;
    }
  });

  test('prints path when editor fails to launch', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(['y']);
    const failSpawn: SpawnSyncFn = () => ({ status: 1, error: new Error('not found') });
    process.env.EDITOR = 'nonexistent-editor';
    await createInstructionsFile(dataDir, rl, failSpawn);
    expect(stdoutLines.join('\n')).toContain('instructions.md');
  });

  test('adds instructions.md to .gitignore when missing', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const gitignorePath = path.join(dataDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '# other stuff\n');
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(dataDir, rl, noopSpawn);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('instructions.md');
  });

  test('does not duplicate instructions.md in .gitignore', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const gitignorePath = path.join(dataDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '# stuff\ninstructions.md\n');
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(dataDir, rl, noopSpawn);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const count = content.split('\n').filter(l => l === 'instructions.md').length;
    expect(count).toBe(1);
  });
});

// --- installNarrationHooks tests ---

describe('installNarrationHooks', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-hooks-test-'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('does nothing when narration is disabled', async () => {
    const rl = createMockPrompt([]);
    await installNarrationHooks(tmpDir, false, rl);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'hooks'))).toBe(false);
  });

  test('does nothing when user declines', async () => {
    const rl = createMockPrompt(['n']);
    await installNarrationHooks(tmpDir, true, rl);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'hooks'))).toBe(false);
  });

  test('creates hook scripts when user accepts', async () => {
    const rl = createMockPrompt(['y']);
    await installNarrationHooks(tmpDir, true, rl);
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'narrate.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'speak.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'notify.sh'))).toBe(true);
  });

  test('prints Created messages for each hook', async () => {
    const rl = createMockPrompt(['y']);
    await installNarrationHooks(tmpDir, true, rl);
    const output = stdoutLines.join('\n');
    expect(output).toContain('.claude/hooks/narrate.sh (PostToolUse)');
    expect(output).toContain('.claude/hooks/speak.sh (Stop)');
    expect(output).toContain('.claude/hooks/notify.sh (Notification)');
  });

  test('hook scripts are executable', async () => {
    const rl = createMockPrompt(['y']);
    await installNarrationHooks(tmpDir, true, rl);
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    const stat = fs.statSync(path.join(hooksDir, 'narrate.sh'));
    // Check owner execute bit
    expect(stat.mode & 0o100).toBeTruthy();
  });

  test('hook scripts start with #!/bin/bash shebang', async () => {
    const rl = createMockPrompt(['y']);
    await installNarrationHooks(tmpDir, true, rl);
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    for (const hook of ['narrate.sh', 'speak.sh', 'notify.sh']) {
      const content = fs.readFileSync(path.join(hooksDir, hook), 'utf8');
      expect(content).toMatch(/^#!\/bin\/bash/);
    }
  });

  test('prints already installed when hooks exist', async () => {
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'narrate.sh'), '#!/bin/bash\n');
    const rl = createMockPrompt([]);
    await installNarrationHooks(tmpDir, true, rl);
    expect(stdoutLines.join('\n')).toContain('already installed');
  });
});

// --- installSlashCommands tests ---

describe('installSlashCommands', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-slash-cmds-test-'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('creates .claude/commands/ directory', () => {
    installSlashCommands(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(true);
  });

  test('copies .md files from ralph commands/ to target .claude/commands/', () => {
    installSlashCommands(tmpDir);
    const destDir = path.join(tmpDir, '.claude', 'commands');
    // Should have copied generate-tasks.md and review-tasks.md
    expect(fs.existsSync(path.join(destDir, 'generate-tasks.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'review-tasks.md'))).toBe(true);
  });

  test('copied files have the same content as source', () => {
    installSlashCommands(tmpDir);
    const { resolveRalphRoot } = require('../../src/utils');
    const ralphRoot = resolveRalphRoot();
    const srcDir = path.join(ralphRoot, 'commands');
    const destDir = path.join(tmpDir, '.claude', 'commands');

    for (const file of fs.readdirSync(srcDir).filter((f: string) => f.endsWith('.md'))) {
      const srcContent = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const destContent = fs.readFileSync(path.join(destDir, file), 'utf8');
      expect(destContent).toBe(srcContent);
    }
  });

  test('is idempotent — re-run overwrites existing files', () => {
    installSlashCommands(tmpDir);
    const destFile = path.join(tmpDir, '.claude', 'commands', 'generate-tasks.md');
    // Tamper with the file
    fs.writeFileSync(destFile, 'tampered content');
    // Re-run
    installSlashCommands(tmpDir);
    const content = fs.readFileSync(destFile, 'utf8');
    expect(content).not.toBe('tampered content');
  });

  test('logs installed/updated for each file', () => {
    installSlashCommands(tmpDir);
    const output = stdoutLines.join('\n');
    expect(output).toContain('generate-tasks.md');
    expect(output).toContain('review-tasks.md');
  });

  test('handles missing commands/ dir gracefully', () => {
    // We can't easily remove the real commands/ dir, so we test by passing
    // a custom ralphRoot that doesn't have a commands/ directory
    const fakeRalphRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-no-cmds-'));
    try {
      installSlashCommands(tmpDir, fakeRalphRoot);
      // Should not throw, just log a warning or do nothing
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(false);
    } finally {
      fs.rmSync(fakeRalphRoot, { recursive: true });
    }
  });

  test('handles commands/ dir with no .md files gracefully', () => {
    const fakeRalphRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-empty-cmds-'));
    fs.mkdirSync(path.join(fakeRalphRoot, 'commands'));
    fs.writeFileSync(path.join(fakeRalphRoot, 'commands', 'not-markdown.txt'), 'hi');
    try {
      installSlashCommands(tmpDir, fakeRalphRoot);
      // Directory might be created but no .md files copied
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('.md');
    } finally {
      fs.rmSync(fakeRalphRoot, { recursive: true });
    }
  });
});

// --- showNextSteps tests ---

describe('showNextSteps', () => {
  test('prints ralph plan suggestion', () => {
    const lines: string[] = [];
    const spy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      lines.push(args.join(' '));
    });
    showNextSteps();
    spy.mockRestore();
    expect(lines.join('\n')).toContain('ralph plan');
    expect(lines.join('\n')).toContain('Next steps');
  });
});

// --- runInit tests ---

describe('runInit', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-init-test-'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  const noopSpawn: SpawnSyncFn = () => ({ status: 0 });

  // All prompts: 8 ralph.json + 1 instructions (N) + skip hooks (narration disabled)
  function allDefaultAnswers(): string[] {
    return ['', '', '', '', '', '', '', '', 'n'];
  }

  test('creates .ralph/ dir, tasks.json, and ralph.json', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'ralph.json'))).toBe(true);
  });

  test('prints initializing banner with project root', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Initializing Ralph in:');
    expect(stdoutLines.join('\n')).toContain(tmpDir);
  });

  test('prints Wrote: ralph.json', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Wrote: ralph.json');
  });

  test('prints Next steps at end', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Next steps');
  });

  test('installs hooks when narration enabled and user accepts', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    // 10 config prompts (narration='y', voice='', ntfy='', reviewMaxIter='', reviewPostTask='') + instructions='n' + install hooks='y'
    const rl = createMockPrompt(['', '', '', '', '', '', '', 'y', '', '', '', '', 'n', 'y']);
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'narrate.sh'))).toBe(true);
  });

  test('skips hooks when narration disabled', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    // .claude/commands/ exists (slash commands are always installed),
    // but hooks dir should not exist
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'hooks'))).toBe(false);
  });

  test('installs slash commands unconditionally', async () => {
    const dataDir = path.join(tmpDir, '.ralph');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'generate-tasks.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'review-tasks.md'))).toBe(true);
  });
});
