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
  type PromptInterface,
  type ConfigDefaults,
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
