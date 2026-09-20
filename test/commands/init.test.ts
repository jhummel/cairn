import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  initCoreFiles,
  parseBooleanInput,
  getConfigDefaults,
  promptForConfig,
  writeCairnJson,
  createInstructionsFile,
  migrateInstructionsFile,
  isPathGitIgnored,
  warnIfClaudeLocalMdNotIgnored,
  installNarrationHooks,
  installSlashCommands,
  installAgents,
  buildInitPermissionRules,
  installClaudeSettings,
  CAIRN_PRE_TOOL_USE_HOOK,
  showNextSteps,
  runInit,
  type PromptInterface,
  type ConfigDefaults,
  type SpawnSyncFn,
  type CheckIgnoreFn,
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-init-test-'));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('creates .cairn/ directory when it does not exist', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.statSync(dataDir).isDirectory()).toBe(true);
  });

  test('prints Created: .cairn/ when directory is new', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .cairn/');
  });

  test('prints .cairn/ directory already exists when it exists', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('.cairn/ directory already exists.');
    expect(stdoutLines).not.toContain('  Created: .cairn/');
  });

  test('creates .cairn/.gitignore with correct content', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    // Exact list, ordered: one line per current-prefix temp file, then the single
    // surviving legacy line, then instructions.md. Asserted exactly so a stray
    // legacy leftover can't hide behind a substring match.
    const entries = content.split('\n').filter((l) => l !== '' && !l.startsWith('#'));
    expect(entries).toEqual([
      '.cairn_complete',
      '.cairn_iterations.log',
      '.cairn_prev_notes',
      '.cairn_task_meta',
      '.cairn_completed_ids',
      '.cairn_tasks_snapshot.json',
      '.cairn_task_*_notes.md',
      '.cairn_task_*_tests.log',
      '.cairn_task_*_prompt.md',
      '.cairn_run_state.json',
      '.cairn_run_state.json.lock',
      '.cairn_hook_errors.log',
      '.ralph_task_*_notes.md',
      'instructions.md',
    ]);
  });

  test('keeps ignoring the legacy notes scratch file — agents are still handed that name', () => {
    // Not a compatibility leftover: buildSystemPrompt still tells every agent to
    // write .ralph_task_<id>_notes.md. Un-ignore it and each iteration leaves a
    // scratch file for the agent's own commit to sweep up.
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    const content = fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8');
    expect(content).toContain('.ralph_task_*_notes.md');
    // ...and nothing else under the legacy prefix survives.
    const legacyLines = content
      .split('\n')
      .filter((l) => l.startsWith('.ralph_') && l !== '.ralph_task_*_notes.md');
    expect(legacyLines).toEqual([]);
  });

  test('prints Created: .cairn/.gitignore', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .cairn/.gitignore');
  });

  test('does not overwrite existing .gitignore, but appends missing entries', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    const originalContent = '# custom\n';
    fs.writeFileSync(gitignorePath, originalContent);
    initCoreFiles(tmpDir, dataDir);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content.startsWith(originalContent)).toBe(true);
    expect(content).toContain('.cairn_run_state.json');
    expect(stdoutLines.join('\n')).not.toContain('Created: .cairn/.gitignore');
    expect(stdoutLines.join('\n')).toMatch(/Updated: \.cairn\/\.gitignore \(added \d+ entries\)/);
  });

  // --- existing-.gitignore append-only merge (round 17) ---

  test('an old-style file with only the legacy .ralph_* block gains the missing current entries', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    const legacyContent =
      '# Ralph temp files (tasks.json and planning-notes.md are tracked)\n' +
      '.ralph_complete\n' +
      '.ralph_iterations.log\n' +
      '.ralph_prev_notes\n' +
      '.ralph_task_meta\n' +
      '.ralph_completed_ids\n' +
      '.ralph_tasks_snapshot.json\n' +
      '.ralph_task_*_notes.md\n' +
      'instructions.md\n';
    fs.writeFileSync(gitignorePath, legacyContent);

    initCoreFiles(tmpDir, dataDir);

    const content = fs.readFileSync(gitignorePath, 'utf8');
    // Old content survives byte-for-byte, untouched.
    expect(content.startsWith(legacyContent)).toBe(true);
    // The entries missing from the legacy block are appended.
    expect(content).toContain('.cairn_run_state.json');
    expect(content).toContain('.cairn_run_state.json.lock');
    expect(content).toContain('.cairn_task_*_prompt.md');
    expect(content).toContain('.cairn_task_*_tests.log');
    expect(content).toContain('.cairn_hook_errors.log');
    const output = stdoutLines.join('\n');
    expect(output).toMatch(/Updated: \.cairn\/\.gitignore \(added 12 entries\)/);
  });

  test('a file that already has every entry mid-file is left unchanged with no output', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    // Every current entry is present, but not in GITIGNORE_CONTENT's order and
    // not at the end of the file — a trailing user line comes after them.
    const mixedContent =
      '# my custom header\n' +
      '.cairn_hook_errors.log\n' +
      '.cairn_run_state.json.lock\n' +
      '.cairn_run_state.json\n' +
      '.cairn_task_*_prompt.md\n' +
      '.cairn_task_*_tests.log\n' +
      '.cairn_task_*_notes.md\n' +
      '.cairn_tasks_snapshot.json\n' +
      '.cairn_completed_ids\n' +
      '.cairn_task_meta\n' +
      '.cairn_prev_notes\n' +
      '.cairn_iterations.log\n' +
      '.cairn_complete\n' +
      '.ralph_task_*_notes.md\n' +
      'instructions.md\n' +
      '# a trailing user comment, after every entry\n' +
      'node_modules/\n';
    fs.writeFileSync(gitignorePath, mixedContent);

    initCoreFiles(tmpDir, dataDir);

    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(mixedContent);
    expect(stdoutLines.join('\n')).not.toContain('.gitignore');
  });

  test('user-added lines are preserved when entries are appended', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    const userContent = '# my notes\nmy-scratch-dir/\n*.local\n';
    fs.writeFileSync(gitignorePath, userContent);

    initCoreFiles(tmpDir, dataDir);

    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content.startsWith(userContent)).toBe(true);
    expect(content).toContain('my-scratch-dir/');
    expect(content).toContain('*.local');
    expect(content).toContain('.cairn_run_state.json');
  });

  test('a second init on an already-merged file adds nothing', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '# custom\n');

    initCoreFiles(tmpDir, dataDir);
    const afterFirstMerge = fs.readFileSync(gitignorePath, 'utf8');

    stdoutLines = [];
    initCoreFiles(tmpDir, dataDir);

    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(afterFirstMerge);
    expect(stdoutLines.join('\n')).not.toContain('.gitignore');
  });

  test('init never touches the repository root .gitignore', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rootGitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(rootGitignorePath, '# root gitignore\nnode_modules/\n');

    initCoreFiles(tmpDir, dataDir);

    expect(fs.readFileSync(rootGitignorePath, 'utf8')).toBe('# root gitignore\nnode_modules/\n');
  });

  // --- round 18: mergeGitignoreEntries regression risks from round-17 review ---

  test('an unreadable existing .gitignore is reported on stderr but does not abort init', () => {
    if (process.getuid && process.getuid() === 0) {
      // chmod 0 doesn't block root from reading; nothing to assert as this user.
      return;
    }

    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '# custom\n');
    fs.chmodSync(gitignorePath, 0o000);

    const stderrLines: string[] = [];
    const errorSpy = spyOn(console, 'error').mockImplementation((...args: any[]) => {
      stderrLines.push(args.join(' '));
    });

    try {
      initCoreFiles(tmpDir, dataDir);
    } finally {
      fs.chmodSync(gitignorePath, 0o644);
      errorSpy.mockRestore();
    }

    // The unreadable .gitignore is reported, not thrown...
    const errOutput = stderrLines.join('\n');
    expect(errOutput).toContain('.cairn/.gitignore');
    expect(errOutput).toContain('Fix or remove it by hand');
    // ...and init still ran to completion: tasks.json/state.json were created.
    expect(fs.existsSync(path.join(dataDir, 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'state.json'))).toBe(true);
  });

  test('a "!" negated entry is left alone, not re-added, while other missing entries still get appended', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const gitignorePath = path.join(dataDir, '.gitignore');
    const userContent = '# custom\n!.cairn_iterations.log\n';
    fs.writeFileSync(gitignorePath, userContent);

    initCoreFiles(tmpDir, dataDir);

    const content = fs.readFileSync(gitignorePath, 'utf8');
    // The user's negation line is preserved byte-for-byte.
    expect(content.startsWith(userContent)).toBe(true);
    // The negated entry is never re-added as its own positive line.
    expect(content).not.toMatch(/^\.cairn_iterations\.log$/m);
    // Every other genuinely missing entry is still appended in the same run.
    expect(content).toContain('.cairn_run_state.json');
    expect(content).toContain('.cairn_hook_errors.log');
    expect(content).toContain('.cairn_task_*_prompt.md');
  });

  test('creates .cairn/tasks.json with project name and empty tasks', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    const tasksPath = path.join(dataDir, 'tasks.json');
    expect(fs.existsSync(tasksPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    expect(data.project).toBe(path.basename(tmpDir));
    expect(data.tasks).toEqual([]);
  });

  test('prints Created: .cairn/tasks.json', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .cairn/tasks.json');
  });

  test('prints tasks.json already exists when it exists', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const tasksPath = path.join(dataDir, 'tasks.json');
    fs.writeFileSync(tasksPath, JSON.stringify({ project: 'old', tasks: [{ id: 1 }] }));
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('tasks.json already exists.');
    expect(stdoutLines.join('\n')).not.toContain('Created: .cairn/tasks.json');
  });

  test('does not overwrite existing tasks.json', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const tasksPath = path.join(dataDir, 'tasks.json');
    const original = { project: 'myproject', tasks: [{ id: 99 }] };
    fs.writeFileSync(tasksPath, JSON.stringify(original));
    initCoreFiles(tmpDir, dataDir);
    const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    expect(data.tasks).toEqual([{ id: 99 }]);
  });

  test('is idempotent — running twice produces same files', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    const gitignoreAfterFirst = fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8');
    const tasksAfterFirst = fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8');

    consoleSpy.mockClear();
    initCoreFiles(tmpDir, dataDir);

    expect(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8')).toBe(gitignoreAfterFirst);
    expect(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8')).toBe(tasksAfterFirst);
  });

  test('second run prints already-exists messages', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    consoleSpy.mockClear();
    stdoutLines = [];
    initCoreFiles(tmpDir, dataDir);
    const output = stdoutLines.join('\n');
    expect(output).toContain('.cairn/ directory already exists.');
    expect(output).toContain('tasks.json already exists.');
    expect(stdoutLines).not.toContain('  Created: .cairn/');
    expect(output).not.toContain('Created: .cairn/tasks.json');
  });

  test('tasks.json project name matches directory basename', () => {
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectDir);
    const dataDir = path.join(projectDir, '.cairn');
    initCoreFiles(projectDir, dataDir);
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8'));
    expect(data.project).toBe('my-project');
  });

  // --- state.json tests ---

  test('creates state.json with { nextTaskId: 1 } on fresh init', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    const statePath = path.join(dataDir, 'state.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state).toEqual({ nextTaskId: 1 });
  });

  test('prints Created: .cairn/state.json on fresh init', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('Created: .cairn/state.json');
  });

  test('re-init with archive max id 15 seeds state.json with nextTaskId: 16', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const archive = { tasks: [{ id: 10 }, { id: 15 }, { id: 3 }] };
    fs.writeFileSync(path.join(dataDir, 'tasks.completed.json'), JSON.stringify(archive));
    initCoreFiles(tmpDir, dataDir);
    const statePath = path.join(dataDir, 'state.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state).toEqual({ nextTaskId: 16 });
  });

  test('leaves existing state.json untouched', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    const statePath = path.join(dataDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify({ nextTaskId: 99 }));
    initCoreFiles(tmpDir, dataDir);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state).toEqual({ nextTaskId: 99 });
  });

  test('prints state.json already exists. when state.json is present', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ nextTaskId: 5 }));
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('state.json already exists.');
    expect(stdoutLines.join('\n')).not.toContain('Created: .cairn/state.json');
  });

  // --- .cairn/ layout (current brand) ---

  test('creates .cairn/ directory and prints Created: .cairn/', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(stdoutLines.join('\n')).toContain('Created: .cairn/');
    expect(stdoutLines.join('\n')).not.toContain('Created: .ralph/');
  });

  test('prints .cairn/ directory already exists when it exists', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    initCoreFiles(tmpDir, dataDir);
    expect(stdoutLines.join('\n')).toContain('.cairn/ directory already exists.');
  });

  test('prints Created: .cairn/.gitignore and .cairn/tasks.json and .cairn/state.json', () => {
    const dataDir = path.join(tmpDir, '.cairn');
    initCoreFiles(tmpDir, dataDir);
    const output = stdoutLines.join('\n');
    expect(output).toContain('Created: .cairn/.gitignore');
    expect(output).toContain('Created: .cairn/tasks.json');
    expect(output).toContain('Created: .cairn/state.json');
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-defaults-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('returns sensible defaults when no cairn.json exists', () => {
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

  test('loads existing cairn.json values as defaults', () => {
    const existing = {
      projectName: 'my-cairn-app',
      projectDescription: 'A cairn app',
      healthCheck: 'make check',
      defaultTestCommand: 'bun test',
      implementationFile: 'DOCS.md',
      truncateText: false,
      summarize: { claudeMdPattern: '**/CLAUDE.md' },
      narration: { enabled: true, voice: 'af_sky', ntfyTopic: 'my-topic' },
    };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(existing, null, 2));
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.projectName).toBe('my-cairn-app');
    expect(defaults.narrationVoice).toBe('af_sky');
  });

  test('loads every field of an existing cairn.json as defaults', () => {
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
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(existing, null, 2));
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

  test('ignores a leftover ralph.json when deriving defaults', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'ralph.json'),
      JSON.stringify({ projectName: 'my-app', narration: { voice: 'af_sky' } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.projectName).toBe(path.basename(tmpDir));
    expect(defaults.narrationVoice).toBe('bf_emma');
  });

  test('partially populated cairn.json fills in missing fields with defaults', () => {
    const partial = { projectName: 'partial-app' };
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), JSON.stringify(partial));
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.projectName).toBe('partial-app');
    expect(defaults.implementationFile).toBe('IMPLEMENTATION.md');
    expect(defaults.truncateText).toBe(true);
    expect(defaults.narrationEnabled).toBe(false);
  });

  test('auto-detect does not override existing cairn.json healthCheck', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc' } })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'cairn.json'),
      JSON.stringify({ healthCheck: 'custom check' })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.healthCheck).toBe('custom check');
  });

  test('auto-detect is used when cairn.json healthCheck is empty', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc' } })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'cairn.json'),
      JSON.stringify({ healthCheck: '' })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.healthCheck).toBe('npm run type-check');
  });

  test('getConfigDefaults does not expose a reviewMaxIterations field', () => {
    const defaults = getConfigDefaults(tmpDir);
    expect((defaults as unknown as Record<string, unknown>).reviewMaxIterations).toBeUndefined();
  });

  test('ignores legacy review.maxIterations from cairn.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'cairn.json'),
      JSON.stringify({ review: { maxIterations: 5 } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect((defaults as unknown as Record<string, unknown>).reviewMaxIterations).toBeUndefined();
  });

  test('returns reviewPostTask default of false when no cairn.json', () => {
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewPostTask).toBe(false);
  });

  test('loads reviewPostTask: true from cairn.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'cairn.json'),
      JSON.stringify({ review: { maxIterations: 3, postTask: true } })
    );
    const defaults = getConfigDefaults(tmpDir);
    expect(defaults.reviewPostTask).toBe(true);
  });

  test('loads reviewPostTask: false from cairn.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'cairn.json'),
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

  test('promptForConfig does not prompt for review.maxIterations (dead key, removed)', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    const config = await promptForConfig(rl, baseDefaults);
    const maxIterQ = questions.find(q => q.toLowerCase().includes('max iterations'));
    expect(maxIterQ).toBeUndefined();
    expect((config.review as Record<string, unknown> | undefined)?.maxIterations).toBeUndefined();
  });

  test('promptForConfig prompts for reviewPostTask after narration prompts', async () => {
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
    // prompts: name, desc, health, test, impl, truncate, claudeMd, narration, reviewPostTask
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '']);
    const config = await promptForConfig(rl, { ...baseDefaults, reviewPostTask: false });
    expect(config.review?.postTask).toBe(false);
  });

  test('reviewPostTask is set to true when user answers y', async () => {
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', 'y']);
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

// --- writeCairnJson tests ---

describe('writeCairnJson', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-write-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('writes cairn.json with correct structure', () => {
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
    writeCairnJson(tmpDir, config);
    expect(fs.existsSync(path.join(tmpDir, 'cairn.json'))).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cairn.json'), 'utf8'));
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
    writeCairnJson(tmpDir, config);
    const raw = fs.readFileSync(path.join(tmpDir, 'cairn.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('overwrites existing cairn.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'cairn.json'), '{"old": true}');
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
    writeCairnJson(tmpDir, config);
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cairn.json'), 'utf8'));
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
    writeCairnJson(tmpDir, config);
    const raw = fs.readFileSync(path.join(tmpDir, 'cairn.json'), 'utf8');
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-instructions-test-'));
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
  const claudeLocalPath = () => path.join(tmpDir, 'CLAUDE.local.md');

  test('does nothing when user declines', async () => {
    const rl = createMockPrompt(['n']);
    await createInstructionsFile(tmpDir, rl, noopSpawn);
    expect(fs.existsSync(claudeLocalPath())).toBe(false);
    expect(stdoutLines.join('\n')).not.toContain('CLAUDE.local.md');
  });

  test('creates CLAUDE.local.md when user accepts', async () => {
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(tmpDir, rl, noopSpawn);
    expect(fs.existsSync(claudeLocalPath())).toBe(true);
  });

  test('prints Created: CLAUDE.local.md', async () => {
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(tmpDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Created: CLAUDE.local.md');
  });

  test('prompt mentions CLAUDE.local.md at the project root', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return 'y';
      },
      close: () => {},
    };
    await createInstructionsFile(tmpDir, rl, noopSpawn);
    expect(questions.some(q => q.includes('CLAUDE.local.md'))).toBe(true);
  });

  test('does not overwrite existing CLAUDE.local.md content', async () => {
    fs.writeFileSync(claudeLocalPath(), '# my notes\n');
    const rl = createMockPrompt(['y']);
    await createInstructionsFile(tmpDir, rl, noopSpawn);
    expect(fs.readFileSync(claudeLocalPath(), 'utf8')).toBe('# my notes\n');
    expect(stdoutLines.join('\n')).not.toContain('Created: CLAUDE.local.md');
  });

  test('launches $EDITOR with the file path', async () => {
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
      await createInstructionsFile(tmpDir, rl, captureSpawn);
      expect(spawnedCmd).toBe('/usr/bin/nano');
      expect(spawnedArgs[0]).toContain('CLAUDE.local.md');
    } finally {
      if (origEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = origEditor;
    }
  });

  test('falls back to vi when $EDITOR is not set', async () => {
    const rl = createMockPrompt(['y']);
    let spawnedCmd = '';
    const captureSpawn: SpawnSyncFn = (cmd) => { spawnedCmd = cmd; return { status: 0 }; };
    const origEditor = process.env.EDITOR;
    delete process.env.EDITOR;
    try {
      await createInstructionsFile(tmpDir, rl, captureSpawn);
      expect(spawnedCmd).toBe('vi');
    } finally {
      if (origEditor !== undefined) process.env.EDITOR = origEditor;
    }
  });

  test('prints path when editor fails to launch', async () => {
    const rl = createMockPrompt(['y']);
    const failSpawn: SpawnSyncFn = () => ({ status: 1, error: new Error('not found') });
    process.env.EDITOR = 'nonexistent-editor';
    await createInstructionsFile(tmpDir, rl, failSpawn);
    expect(stdoutLines.join('\n')).toContain('CLAUDE.local.md');
  });
});

// --- migrateInstructionsFile tests ---

describe('migrateInstructionsFile', () => {
  let tmpDir: string;
  let dataDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-migrate-instructions-test-'));
    dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  const claudeLocalPath = () => path.join(tmpDir, 'CLAUDE.local.md');
  const instructionsPath = () => path.join(dataDir, 'instructions.md');

  test('does nothing when instructions.md is absent — no prompt, nothing written', async () => {
    const rl = createMockPrompt([]);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(fs.existsSync(claudeLocalPath())).toBe(false);
  });

  test('does nothing when instructions.md is blank', async () => {
    fs.writeFileSync(instructionsPath(), '   \n');
    const rl = createMockPrompt([]);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(fs.existsSync(claudeLocalPath())).toBe(false);
    expect(fs.existsSync(instructionsPath())).toBe(true);
  });

  test('prompts to move, defaulting to yes', async () => {
    fs.writeFileSync(instructionsPath(), '* Always use TDD\n');
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(questions[0]).toContain('.cairn/instructions.md');
    expect(questions[0]).toContain('CLAUDE.local.md');
    expect(questions[0]).toContain('[Y/n]');
    // Empty input takes the yes default.
    expect(fs.existsSync(claudeLocalPath())).toBe(true);
  });

  test('declining leaves instructions.md in place and CLAUDE.local.md untouched', async () => {
    fs.writeFileSync(instructionsPath(), '* Always use TDD\n');
    const rl = createMockPrompt(['n']);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(fs.existsSync(claudeLocalPath())).toBe(false);
    expect(fs.existsSync(instructionsPath())).toBe(true);
  });

  test('accepting creates CLAUDE.local.md with the migrated content and deletes instructions.md', async () => {
    fs.writeFileSync(instructionsPath(), '* Always use TDD\n');
    const rl = createMockPrompt(['y']);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(fs.readFileSync(claudeLocalPath(), 'utf8')).toBe('* Always use TDD\n');
    expect(fs.existsSync(instructionsPath())).toBe(false);
  });

  test('appends to an existing CLAUDE.local.md with a blank line and heading, preserving prior content', async () => {
    fs.writeFileSync(claudeLocalPath(), '# Project notes\nBuild with bun.\n');
    fs.writeFileSync(instructionsPath(), '* Always use TDD\n');
    const rl = createMockPrompt(['y']);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    const content = fs.readFileSync(claudeLocalPath(), 'utf8');
    expect(content).toBe(
      '# Project notes\nBuild with bun.\n\n## Personal instructions (migrated from .cairn/instructions.md)\n\n* Always use TDD\n',
    );
    expect(fs.existsSync(instructionsPath())).toBe(false);
  });

  test('never overwrites existing CLAUDE.local.md content', async () => {
    fs.writeFileSync(claudeLocalPath(), '# Do not lose this\n');
    fs.writeFileSync(instructionsPath(), '* Always use TDD\n');
    const rl = createMockPrompt(['y']);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(fs.readFileSync(claudeLocalPath(), 'utf8')).toContain('# Do not lose this');
  });

  test('reports the migration', async () => {
    fs.writeFileSync(instructionsPath(), '* Always use TDD\n');
    const rl = createMockPrompt(['y']);
    await migrateInstructionsFile(tmpDir, dataDir, rl);
    expect(stdoutLines.join('\n')).toContain('Moved');
    expect(stdoutLines.join('\n')).toContain('.cairn/instructions.md');
    expect(stdoutLines.join('\n')).toContain('CLAUDE.local.md');
  });
});

// --- CLAUDE.local.md gitignore warning tests ---

describe('isPathGitIgnored', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-check-ignore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('returns true when check-ignore exits 0', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 0 });
    expect(isPathGitIgnored(tmpDir, 'CLAUDE.local.md', runFn)).toBe(true);
  });

  test('returns false when check-ignore exits 1 (not ignored)', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 1 });
    expect(isPathGitIgnored(tmpDir, 'CLAUDE.local.md', runFn)).toBe(false);
  });

  test('returns null (skip) outside a git repo — a fatal, non-0/1 exit', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 128 });
    expect(isPathGitIgnored(tmpDir, 'CLAUDE.local.md', runFn)).toBe(null);
  });

  test('returns null (skip) when the command errors (e.g. git not installed)', () => {
    const runFn: CheckIgnoreFn = () => ({ status: null, error: new Error('not found') });
    expect(isPathGitIgnored(tmpDir, 'CLAUDE.local.md', runFn)).toBe(null);
  });

  test('runs from projectRoot with the expected git invocation', () => {
    let seenCmd = '';
    let seenArgs: string[] = [];
    let seenOpts: { cwd: string } | undefined;
    const runFn: CheckIgnoreFn = (cmd, args, opts) => {
      seenCmd = cmd;
      seenArgs = args;
      seenOpts = opts;
      return { status: 0 };
    };
    isPathGitIgnored(tmpDir, 'CLAUDE.local.md', runFn);
    expect(seenCmd).toBe('git');
    expect(seenArgs).toEqual(['check-ignore', '-q', 'CLAUDE.local.md']);
    expect(seenOpts).toEqual({ cwd: tmpDir });
  });
});

describe('warnIfClaudeLocalMdNotIgnored', () => {
  let tmpDir: string;
  let lines: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-warn-ignore-test-'));
    lines = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('warns when CLAUDE.local.md is not ignored', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 1 });
    warnIfClaudeLocalMdNotIgnored(tmpDir, runFn, (m) => lines.push(m));
    const output = lines.join('\n');
    expect(output).toContain('WARNING');
    expect(output).toContain('CLAUDE.local.md');
    expect(output).toContain('.gitignore');
  });

  test('does not warn when CLAUDE.local.md is already ignored', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 0 });
    warnIfClaudeLocalMdNotIgnored(tmpDir, runFn, (m) => lines.push(m));
    expect(lines).toEqual([]);
  });

  test('skips silently outside a git repo', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 128 });
    warnIfClaudeLocalMdNotIgnored(tmpDir, runFn, (m) => lines.push(m));
    expect(lines).toEqual([]);
  });

  test('does not edit .gitignore or git config', () => {
    const runFn: CheckIgnoreFn = () => ({ status: 1 });
    warnIfClaudeLocalMdNotIgnored(tmpDir, runFn, (m) => lines.push(m));
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);
  });
});

// --- installNarrationHooks tests ---

describe('installNarrationHooks', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hooks-test-'));
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

  test('hook scripts point at the cairn-tts socket', async () => {
    // The hooks are the socket's only clients, and findNarrationSocketPath reads
    // narrate.sh to decide where to bind — so this line is the authoritative one.
    const rl = createMockPrompt(['y']);
    await installNarrationHooks(tmpDir, true, rl);
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    for (const hook of ['narrate.sh', 'speak.sh', 'notify.sh']) {
      const content = fs.readFileSync(path.join(hooksDir, hook), 'utf8');
      expect(content).toContain('/tmp/cairn-tts.sock');
    }
  });

  test('prompt mentions the Cairn narration server and socket path', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return 'n';
      },
      close: () => {},
    };
    await installNarrationHooks(tmpDir, true, rl);
    const output = stdoutLines.join('\n');
    expect(output).toContain('Cairn narration server');
    expect(output).toContain('/tmp/cairn-tts.sock');
    expect(output).not.toContain('Ralph narration server');
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-slash-cmds-test-'));
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

  test('copies .md files from cairn commands/ to target .claude/commands/', () => {
    installSlashCommands(tmpDir);
    const destDir = path.join(tmpDir, '.claude', 'commands');
    expect(fs.existsSync(path.join(destDir, 'generate-tasks.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'review-tasks.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'codebase-audit.md'))).toBe(true);
  });

  test('copied files have the same content as source', () => {
    installSlashCommands(tmpDir);
    const { resolveCairnRoot } = require('../../src/utils');
    const cairnRoot = resolveCairnRoot();
    const srcDir = path.join(cairnRoot, 'commands');
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
    expect(output).toContain('codebase-audit.md');
  });

  test('handles missing commands/ dir gracefully', () => {
    // We can't easily remove the real commands/ dir, so we test by passing
    // a custom cairnRoot that doesn't have a commands/ directory
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-no-cmds-'));
    try {
      installSlashCommands(tmpDir, fakeCairnRoot);
      // Should not throw, just log a warning or do nothing
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(false);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('handles commands/ dir with no .md files gracefully', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-empty-cmds-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'commands'));
    fs.writeFileSync(path.join(fakeCairnRoot, 'commands', 'not-markdown.txt'), 'hi');
    try {
      installSlashCommands(tmpDir, fakeCairnRoot);
      // Directory might be created but no .md files copied
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('.md');
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('copies codebase-audit.md from mock cairnRoot to .claude/commands/ with correct content', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-audit-cmds-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'commands'));
    const auditContent = '# codebase-audit\nThis is the audit slash command.';
    fs.writeFileSync(path.join(fakeCairnRoot, 'commands', 'codebase-audit.md'), auditContent);
    try {
      installSlashCommands(tmpDir, fakeCairnRoot);
      const destPath = path.join(tmpDir, '.claude', 'commands', 'codebase-audit.md');
      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(destPath, 'utf8')).toBe(auditContent);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('installs cairn-run.md from a cairnRoot override pointing at the real repo root', () => {
    // Real repo root, not a fixture: this exercises the committed
    // commands/cairn-run.md that interactive rounds are launched from.
    const repoRoot = path.join(__dirname, '..', '..');
    const written = installSlashCommands(tmpDir, repoRoot);
    const destPath = path.join(tmpDir, '.claude', 'commands', 'cairn-run.md');
    expect(written).toContain(path.join('.claude', 'commands', 'cairn-run.md'));
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf8')).toBe(
      fs.readFileSync(path.join(repoRoot, 'commands', 'cairn-run.md'), 'utf8')
    );
  });

  test('cairn-run.md has description frontmatter and names every command, agent and tool the run loop needs', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const content = fs.readFileSync(path.join(repoRoot, 'commands', 'cairn-run.md'), 'utf8');
    expect(content).toMatch(/^---\ndescription: .+\n---\n/);
    for (const needle of [
      'cairn round next',
      'cairn round settle',
      '--reviewed',
      'cairn-task-agent',
      'post-task-reviewer',
      'SendMessage',
      'PushNotification',
      'bypassPermissions',
    ]) {
      expect(content).toContain(needle);
    }
  });

  test("cairn-run.md relaunches retries from the verdict's promptFile and model, not remembered values", () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const content = fs.readFileSync(path.join(repoRoot, 'commands', 'cairn-run.md'), 'utf8');
    expect(content).toContain('`{ verdict, taskId, mode, reason, failure?, promptFile, model, next }`');
    expect(content).toContain("the verdict's `model` and `promptFile`");
    expect(content).not.toContain('with the same prompt file');
    expect(content).not.toContain('If you no longer know the prompt file');
  });
});

// --- installAgents tests ---

describe('installAgents', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-agents-test-'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('creates .claude/agents/ directory if it does not exist', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-agents-src-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'agents'));
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'test-agent.md'), '# test agent');
    try {
      installAgents(tmpDir, fakeCairnRoot);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'agents'))).toBe(true);
      expect(fs.statSync(path.join(tmpDir, '.claude', 'agents')).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('copies .md files from cairn agents/ to target .claude/agents/', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-agents-src-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'agents'));
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'planner.md'), '# planner');
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'summarizer.md'), '# summarizer');
    try {
      installAgents(tmpDir, fakeCairnRoot);
      const destDir = path.join(tmpDir, '.claude', 'agents');
      expect(fs.existsSync(path.join(destDir, 'planner.md'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'summarizer.md'))).toBe(true);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('copied files have the same content as source', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-agents-src-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'agents'));
    const content = '# agent content\nsome details here';
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'my-agent.md'), content);
    try {
      installAgents(tmpDir, fakeCairnRoot);
      const destContent = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'my-agent.md'), 'utf8');
      expect(destContent).toBe(content);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('logs installed message for each copied file', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-agents-src-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'agents'));
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'planner.md'), '# planner');
    try {
      installAgents(tmpDir, fakeCairnRoot);
      const output = stdoutLines.join('\n');
      expect(output).toContain('planner.md');
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('handles missing agents/ dir gracefully — no error, no files created', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-no-agents-'));
    try {
      expect(() => installAgents(tmpDir, fakeCairnRoot)).not.toThrow();
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'agents'))).toBe(false);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('handles agents/ dir with no .md files gracefully', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-empty-agents-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'agents'));
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'not-markdown.txt'), 'hi');
    try {
      expect(() => installAgents(tmpDir, fakeCairnRoot)).not.toThrow();
      const output = stdoutLines.join('\n');
      expect(output).not.toContain('.md');
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });

  test('copies actual cairn agents to .claude/agents/', () => {
    installAgents(tmpDir);
    const destDir = path.join(tmpDir, '.claude', 'agents');
    expect(fs.existsSync(path.join(destDir, 'planner.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'summarizer.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'post-task-reviewer.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'audit-planner.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'cairn-task-agent.md'))).toBe(true);
  });

  test('installs cairn-task-agent.md from a cairnRoot override pointing at the real repo root', () => {
    // Uses the real repo root as cairnRoot (rather than a fake fixture dir) so
    // this exercises the actual committed agents/cairn-task-agent.md file, not a
    // stand-in — the file /cairn-run's run agent depends on for every task launch.
    const repoRoot = path.join(__dirname, '..', '..');
    installAgents(tmpDir, repoRoot);
    const destPath = path.join(tmpDir, '.claude', 'agents', 'cairn-task-agent.md');
    expect(fs.existsSync(destPath)).toBe(true);
    const content = fs.readFileSync(destPath, 'utf8');
    expect(content).toContain('name: cairn-task-agent');
    expect(content).toContain('internal: true');
  });

  test('copies audit-planner.md from mock cairnRoot to .claude/agents/ with correct content', () => {
    const fakeCairnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-audit-agents-'));
    fs.mkdirSync(path.join(fakeCairnRoot, 'agents'));
    const agentContent = '# audit-planner\nThis is the audit planner agent.';
    fs.writeFileSync(path.join(fakeCairnRoot, 'agents', 'audit-planner.md'), agentContent);
    try {
      installAgents(tmpDir, fakeCairnRoot);
      const destPath = path.join(tmpDir, '.claude', 'agents', 'audit-planner.md');
      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(destPath, 'utf8')).toBe(agentContent);
    } finally {
      fs.rmSync(fakeCairnRoot, { recursive: true });
    }
  });
});

// --- showNextSteps tests ---

// --- buildInitPermissionRules tests ---

describe('buildInitPermissionRules', () => {
  test('allows the five read-only git inspection subcommands', () => {
    const rules = buildInitPermissionRules({ healthCheck: '', defaultTestCommand: '' });
    expect(rules.allow).toContain('Bash(git diff:*)');
    expect(rules.allow).toContain('Bash(git log:*)');
    expect(rules.allow).toContain('Bash(git show:*)');
    expect(rules.allow).toContain('Bash(git status:*)');
    expect(rules.allow).toContain('Bash(git rev-parse:*)');
  });

  test('never allows a blanket git rule', () => {
    // A blanket grant would also authorize commit/push/reset, letting a review
    // agent rewrite the very work it is inspecting.
    const rules = buildInitPermissionRules({ healthCheck: '', defaultTestCommand: '' });
    expect(rules.allow).not.toContain('Bash(git:*)');
    expect(rules.allow).not.toContain('Bash(git *)');
  });

  test('derives allow rules from healthCheck and defaultTestCommand', () => {
    const rules = buildInitPermissionRules({
      healthCheck: 'npm run type-check',
      defaultTestCommand: 'npm test',
    });
    expect(rules.allow).toContain('Bash(npm run type-check:*)');
    expect(rules.allow).toContain('Bash(npm test:*)');
  });

  test('skips empty config values cleanly', () => {
    const rules = buildInitPermissionRules({ healthCheck: '', defaultTestCommand: '   ' });
    expect(rules.allow).not.toContain('Bash(:*)');
    expect(rules.allow?.every((r) => r.startsWith('Bash(git '))).toBe(true);
  });

  test('splits compound config commands on shell operators', () => {
    // Claude Code matches each subcommand of a compound command against the
    // allowlist independently, so a whole-string rule could never match.
    const rules = buildInitPermissionRules({
      healthCheck: 'cd src && bun run build',
      defaultTestCommand: '',
    });
    expect(rules.allow).toContain('Bash(cd src:*)');
    expect(rules.allow).toContain('Bash(bun run build:*)');
    expect(rules.allow).not.toContain('Bash(cd src && bun run build:*)');
  });

  test('does not repeat a command shared by healthCheck and defaultTestCommand', () => {
    const rules = buildInitPermissionRules({
      healthCheck: 'bun test',
      defaultTestCommand: 'bun test',
    });
    expect(rules.allow?.filter((r) => r === 'Bash(bun test:*)')).toHaveLength(1);
  });

  test('seeds no deny rules', () => {
    // A project-wide deny on `cairn task` subcommands binds every Claude
    // session in the project, including `cairn run`'s own execution agents —
    // it is NOT bypassed by --dangerously-skip-permissions. It was also never
    // necessary: in headless `claude -p` mode, anything with side effects is
    // deny-by-default unless allowlisted, so the reviewer's scoped
    // --allowedTools already prevented task-state mutation.
    const rules = buildInitPermissionRules({ healthCheck: '', defaultTestCommand: '' });
    expect(rules.deny ?? []).toEqual([]);
  });
});

// --- installClaudeSettings tests ---

describe('installClaudeSettings', () => {
  // Always a temp projectRoot: this repository's own .claude/settings.local.json
  // holds hand-accumulated rules that a test must never touch.
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  const config = { healthCheck: 'bun run build', defaultTestCommand: 'bun test' };

  function settingsPath(): string {
    return path.join(tmpDir, '.claude', 'settings.local.json');
  }

  function readSettings(): any {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-settings-init-test-'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('writes the settings file when the user accepts', async () => {
    const rl = createMockPrompt(['y']);
    await installClaudeSettings(tmpDir, config, rl);
    expect(fs.existsSync(settingsPath())).toBe(true);
  });

  test('defaults to yes on empty input', async () => {
    const rl = createMockPrompt(['']);
    await installClaudeSettings(tmpDir, config, rl);
    expect(fs.existsSync(settingsPath())).toBe(true);
  });

  test('shows a Y/n hint so the default reads as yes', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return '';
      },
      close: () => {},
    };
    await installClaudeSettings(tmpDir, config, rl);
    expect(questions.join('\n')).toContain('[Y/n]');
  });

  test('writes nothing when the user declines', async () => {
    const rl = createMockPrompt(['n']);
    const added = await installClaudeSettings(tmpDir, config, rl);
    expect(fs.existsSync(settingsPath())).toBe(false);
    expect(added).toEqual([]);
  });

  test('writes the git inspection and config-derived allow rules', async () => {
    const rl = createMockPrompt(['y']);
    await installClaudeSettings(tmpDir, config, rl);
    const allow = readSettings().permissions.allow;
    expect(allow).toContain('Bash(git diff:*)');
    expect(allow).toContain('Bash(git rev-parse:*)');
    expect(allow).toContain('Bash(bun run build:*)');
    expect(allow).toContain('Bash(bun test:*)');
  });

  test('writes no cairn task deny rules', async () => {
    const rl = createMockPrompt(['y']);
    await installClaudeSettings(tmpDir, config, rl);
    expect(readSettings().permissions.deny ?? []).toEqual([]);
  });

  test('returns the rules it added', async () => {
    const rl = createMockPrompt(['y']);
    const added = await installClaudeSettings(tmpDir, config, rl);
    expect(added).toContain('Bash(git diff:*)');
    expect(added).toContain('Bash(bun run build:*)');
  });

  test('reports the file and each rule it wrote', async () => {
    const rl = createMockPrompt(['y']);
    await installClaudeSettings(tmpDir, config, rl);
    const output = stdoutLines.join('\n');
    expect(output).toContain('.claude/settings.local.json');
    expect(output).toContain('Bash(git diff:*)');
    expect(output).toContain('Bash(bun run build:*)');
  });

  test('warns that the user must gitignore the settings file themselves', async () => {
    const rl = createMockPrompt(['y']);
    await installClaudeSettings(tmpDir, config, rl);
    const output = stdoutLines.join('\n');
    expect(output).toContain('WARNING');
    expect(output).toContain('.gitignore');
    expect(output).toContain('.claude/settings.local.json');
  });

  test('does not create or edit a .gitignore', async () => {
    const rl = createMockPrompt(['y']);
    await installClaudeSettings(tmpDir, config, rl);
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);
  });

  test('is idempotent — a second run adds nothing', async () => {
    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    const first = fs.readFileSync(settingsPath(), 'utf8');
    stdoutLines = [];

    const added = await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    expect(added).toEqual([]);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(first);
    expect(stdoutLines.join('\n')).toContain('already');
  });

  test('preserves rules the user already had', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' }, null, 2),
    );
    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    const settings = readSettings();
    expect(settings.permissions.allow[0]).toBe('Bash(ls:*)');
    expect(settings.permissions.allow).toContain('Bash(git diff:*)');
    expect(settings.model).toBe('opus');
  });

  test('reports a malformed settings file without throwing or overwriting it', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ not json');
    const added = await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    expect(added).toEqual([]);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ not json');
    expect(stdoutLines.join('\n')).toContain('Refusing to modify');
  });

  test('routes reporting through opts.log when provided', async () => {
    const lines: string[] = [];
    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']), {
      log: (m) => lines.push(m),
    });
    expect(lines.join('\n')).toContain('Bash(git diff:*)');
    expect(stdoutLines).toEqual([]);
  });

  // --- PreToolUse containment hook ---

  const cairnHookGroup = {
    matcher: 'Edit|Write|Bash',
    hooks: [{ type: 'command', command: 'cairn hook pre-tool-use' }],
  };

  test('the seeded hook spec targets cairn hook pre-tool-use on Edit|Write|Bash', () => {
    expect(CAIRN_PRE_TOOL_USE_HOOK).toEqual({
      event: 'PreToolUse',
      matcher: 'Edit|Write|Bash',
      command: 'cairn hook pre-tool-use',
    });
  });

  test('seeds the PreToolUse containment hook under the same prompt', async () => {
    const questions: string[] = [];
    const rl: PromptInterface = {
      question: async (query: string) => {
        questions.push(query);
        return 'y';
      },
      close: () => {},
    };
    await installClaudeSettings(tmpDir, config, rl);
    expect(questions).toHaveLength(1);
    expect(readSettings().hooks).toEqual({ PreToolUse: [cairnHookGroup] });
  });

  test('declining writes no hook', async () => {
    await installClaudeSettings(tmpDir, config, createMockPrompt(['n']));
    expect(fs.existsSync(settingsPath())).toBe(false);
  });

  test('explains the containment hook before prompting and reports adding it', async () => {
    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    const output = stdoutLines.join('\n');
    expect(output).toContain('containment hook');
    expect(output).toContain('hook:  PreToolUse (Edit|Write|Bash) → cairn hook pre-tool-use');
  });

  test('returns the hook among what it added', async () => {
    const added = await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    expect(added).toContain('PreToolUse hook: cairn hook pre-tool-use');
  });

  test("keeps the user's own hooks and adds the hook even when every rule is present", async () => {
    const userPre = { matcher: 'Bash', hooks: [{ type: 'command', command: './lint.sh' }] };
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        permissions: { allow: buildInitPermissionRules(config).allow },
        hooks: { PreToolUse: [userPre] },
      }),
    );

    const added = await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(added).toEqual(['PreToolUse hook: cairn hook pre-tool-use']);
    expect(readSettings().hooks.PreToolUse).toEqual([userPre, cairnHookGroup]);
    expect(stdoutLines.join('\n')).not.toContain('already has every rule');
  });

  test('reports a hooks-shape error and continues without throwing', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({ hooks: 'broken' }));
    const added = await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    expect(added).toEqual([]);
    expect(stdoutLines.join('\n')).toContain('Refusing to modify');
    expect(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).hooks).toBe('broken');
  });
});

// --- installClaudeSettings: legacy deny-block migration ---
//
// An older `cairn init` seeded five `cairn task` deny rules. Because a
// project-wide deny binds `cairn run`'s own execution agents, such a project
// can never record a task completion — the loop re-runs one task forever. The
// settings file is gitignored, so nothing in `git status` reveals it; re-running
// `cairn init` is the only repair path.
describe('installClaudeSettings — legacy cairn task deny migration', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  const config = { healthCheck: 'bun run build', defaultTestCommand: 'bun test' };

  const LEGACY_DENY = [
    'Bash(cairn task start:*)',
    'Bash(cairn task complete:*)',
    'Bash(cairn task set-status:*)',
    'Bash(cairn task add:*)',
    'Bash(cairn task note:*)',
  ];

  function settingsPath(): string {
    return path.join(tmpDir, '.claude', 'settings.local.json');
  }

  function readSettings(): any {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  }

  function seed(settings: unknown): void {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  }

  beforeEach(() => {
    // Temp dir only — see the hazard note on the suite above.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-settings-migrate-test-'));
    stdoutLines = [];
    consoleSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      stdoutLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('strips a deny block containing only the legacy rules', async () => {
    seed({ permissions: { deny: LEGACY_DENY } });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(readSettings().permissions).not.toHaveProperty('deny');
  });

  test('keeps unrelated user deny rules while stripping the legacy ones', async () => {
    seed({ permissions: { deny: ['Bash(rm -rf:*)', ...LEGACY_DENY, 'Read(./secrets/**)'] } });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(readSettings().permissions.deny).toEqual(['Bash(rm -rf:*)', 'Read(./secrets/**)']);
  });

  test('reports each removed rule and why it mattered', async () => {
    seed({ permissions: { deny: LEGACY_DENY } });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    const output = stdoutLines.join('\n');
    for (const rule of LEGACY_DENY) expect(output).toContain(rule);
    expect(output).toContain('Removed');
  });

  test('reports removals even when there is nothing left to add', async () => {
    // Everything init would add is already present, so the additive merge is a
    // no-op — the removal must still be performed and reported.
    seed({
      permissions: {
        allow: [
          'Bash(git diff:*)',
          'Bash(git log:*)',
          'Bash(git show:*)',
          'Bash(git status:*)',
          'Bash(git rev-parse:*)',
          'Bash(bun run build:*)',
          'Bash(bun test:*)',
        ],
        deny: LEGACY_DENY,
      },
    });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(readSettings().permissions).not.toHaveProperty('deny');
    expect(stdoutLines.join('\n')).toContain('Removed');
  });

  test('matches the spaced spelling of the legacy rules', async () => {
    seed({ permissions: { deny: ['Bash(cairn task start *)', 'Bash(cairn task complete *)'] } });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(readSettings().permissions).not.toHaveProperty('deny');
  });

  test('leaves an already-clean file with no deny key', async () => {
    seed({ permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    const settings = readSettings();
    expect(settings.permissions).not.toHaveProperty('deny');
    expect(settings.permissions.allow[0]).toBe('Bash(ls:*)');
    expect(settings.model).toBe('opus');
    expect(stdoutLines.join('\n')).not.toContain('Removed');
  });

  test('no-ops cleanly when the settings file does not exist', async () => {
    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(readSettings().permissions).not.toHaveProperty('deny');
    expect(stdoutLines.join('\n')).not.toContain('Removed');
  });

  test('refuses a malformed file rather than rewriting it', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ not json');

    const added = await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(added).toEqual([]);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ not json');
    expect(stdoutLines.join('\n')).toContain('Refusing to modify');
  });

  test('declining the prompt removes nothing', async () => {
    seed({ permissions: { deny: LEGACY_DENY } });

    await installClaudeSettings(tmpDir, config, createMockPrompt(['n']));

    expect(readSettings().permissions.deny).toEqual(LEGACY_DENY);
  });

  test('is idempotent — a second run reports no further removals', async () => {
    seed({ permissions: { deny: LEGACY_DENY } });
    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));
    const first = fs.readFileSync(settingsPath(), 'utf8');
    stdoutLines = [];

    await installClaudeSettings(tmpDir, config, createMockPrompt(['y']));

    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(first);
    expect(stdoutLines.join('\n')).not.toContain('Removed');
  });
});

describe('showNextSteps', () => {
  test('prints cairn plan suggestion', () => {
    const lines: string[] = [];
    const spy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      lines.push(args.join(' '));
    });
    showNextSteps();
    spy.mockRestore();
    expect(lines.join('\n')).toContain('cairn plan');
    expect(lines.join('\n')).toContain('Next steps');
  });
});

// --- runInit tests ---

describe('runInit', () => {
  let tmpDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-run-init-test-'));
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

  // 8 base config prompts + reviewPostTask (narration disabled, so voice/ntfy are skipped);
  // remaining prompts (create CLAUDE.local.md, install settings) fall back to their defaults
  // once the mock's answers run out.
  function allDefaultAnswers(): string[] {
    return ['', '', '', '', '', '', '', '', 'n'];
  }

  test('creates .cairn/ dir, tasks.json, and cairn.json', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'cairn.json'))).toBe(true);
  });

  test('creates .cairn/ dir, tasks.json, and cairn.json', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'cairn.json'))).toBe(true);
    expect(stdoutLines.join('\n')).toContain('Created: .cairn/');
  });

  test('prints initializing banner with project root', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Initializing Cairn in:');
    expect(stdoutLines.join('\n')).toContain(tmpDir);
  });

  test('prints Wrote: cairn.json', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Wrote: cairn.json');
  });

  test('prints Next steps at end', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(stdoutLines.join('\n')).toContain('Next steps');
  });

  test('installs hooks when narration enabled and user accepts', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    // 9 config prompts (narration='y', voice='', ntfy='', reviewPostTask='') + create CLAUDE.local.md='n' + install hooks='y'
    const rl = createMockPrompt(['', '', '', '', '', '', '', 'y', '', '', '', 'n', 'y']);
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    const hooksDir = path.join(tmpDir, '.claude', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'narrate.sh'))).toBe(true);
  });

  test('skips hooks when narration disabled', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    // .claude/commands/ exists (slash commands are always installed),
    // but hooks dir should not exist
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'hooks'))).toBe(false);
  });

  test('seeds .claude/settings.local.json (prompt defaults to yes)', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.permissions.allow).toContain('Bash(git diff:*)');
    expect(settings.permissions.deny ?? []).toEqual([]);
  });

  test('seeds the PreToolUse containment hook with default answers', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf8'),
    );
    expect(settings.hooks.PreToolUse).toEqual([
      { matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: 'cairn hook pre-tool-use' }] },
    ]);
  });

  test('skips the settings file when the user declines', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    // 9 config prompts (narration disabled, so voice/ntfy are skipped),
    // create CLAUDE.local.md='n', then settings='n'.
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', 'n', 'n']);
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.local.json'))).toBe(false);
  });

  test('installs slash commands unconditionally', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'generate-tasks.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'review-tasks.md'))).toBe(true);
  });

  test('migrates a pre-existing instructions.md into CLAUDE.local.md when accepted', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'instructions.md'), '* Always use TDD\n');
    // 9 config prompts (8 base + reviewPostTask, all default) +
    // migrate='y' + create/open CLAUDE.local.md='n'.
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', 'y', 'n']);
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.local.md'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'CLAUDE.local.md'), 'utf8')).toBe('* Always use TDD\n');
    expect(fs.existsSync(path.join(dataDir, 'instructions.md'))).toBe(false);
  });

  test('declining the migration prompt keeps instructions.md and skips CLAUDE.local.md', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'instructions.md'), '* Always use TDD\n');
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', 'n', 'n']);
    await runInit(tmpDir, dataDir, rl, noopSpawn);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.local.md'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'instructions.md'))).toBe(true);
  });

  test('warns when the migrated CLAUDE.local.md is not gitignored', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'instructions.md'), '* Always use TDD\n');
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', 'y', 'n']);
    const notIgnored: CheckIgnoreFn = () => ({ status: 1 });
    await runInit(tmpDir, dataDir, rl, noopSpawn, notIgnored);
    const output = stdoutLines.join('\n');
    expect(output).toContain('add CLAUDE.local.md to your .gitignore yourself');
  });

  test('does not warn when CLAUDE.local.md is already gitignored', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'instructions.md'), '* Always use TDD\n');
    const rl = createMockPrompt(['', '', '', '', '', '', '', '', '', 'y', 'n']);
    const ignored: CheckIgnoreFn = () => ({ status: 0 });
    await runInit(tmpDir, dataDir, rl, noopSpawn, ignored);
    expect(stdoutLines.join('\n')).not.toContain('add CLAUDE.local.md');
  });

  test('does not check gitignore status when there is no CLAUDE.local.md', async () => {
    const dataDir = path.join(tmpDir, '.cairn');
    const rl = createMockPrompt(allDefaultAnswers());
    let called = false;
    const spy: CheckIgnoreFn = () => { called = true; return { status: 1 }; };
    await runInit(tmpDir, dataDir, rl, noopSpawn, spy);
    expect(called).toBe(false);
  });
});
