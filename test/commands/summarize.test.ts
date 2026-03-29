import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildContext,
  buildClaudeMdPruning,
  buildSummarizePrompt,
} from '../../src/commands/summarize';

describe('buildContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns base message when no completed tasks file', () => {
    const ctx = buildContext(tmpDir, 'tasks.completed.json');
    expect(ctx).toBe('Updating from the central task list.');
  });

  it('appends completed tasks reference when file exists', () => {
    const completedPath = path.join(tmpDir, '.ralph', 'tasks.completed.json');
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
    fs.writeFileSync(completedPath, '{}');
    const ctx = buildContext(tmpDir, completedPath);
    expect(ctx).toContain('Updating from the central task list.');
    expect(ctx).toContain('tasks.completed.json');
    expect(ctx).toContain('Completed tasks are in');
  });

  it('uses relative path in context string', () => {
    const completedPath = path.join(tmpDir, '.ralph', 'tasks.completed.json');
    fs.mkdirSync(path.join(tmpDir, '.ralph'));
    fs.writeFileSync(completedPath, '{}');
    const ctx = buildContext(tmpDir, completedPath);
    // Should be relative, not absolute
    expect(ctx).not.toContain(tmpDir);
    expect(ctx).toContain('.ralph/tasks.completed.json');
  });
});

describe('buildClaudeMdPruning', () => {
  it('includes custom pattern when provided', () => {
    const result = buildClaudeMdPruning('IMPLEMENTATION.md', '**/CLAUDE.md');
    expect(result).toContain('CLAUDE.MD PRUNING:');
    expect(result).toContain('**/CLAUDE.md');
    expect(result).toContain('IMPLEMENTATION.md');
  });

  it('uses generic lookup when no pattern provided', () => {
    const result = buildClaudeMdPruning('IMPLEMENTATION.md', '');
    expect(result).toContain('CLAUDE.MD PRUNING:');
    expect(result).toContain('look for any module-level CLAUDE.md');
    expect(result).not.toContain('**/');
  });

  it('always includes pruning rules', () => {
    const result = buildClaudeMdPruning('IMPLEMENTATION.md', '');
    expect(result).toContain('Remove entries that are no longer accurate');
    expect(result).toContain('Deduplicate entries');
    expect(result).toContain('strictly operational');
    expect(result).toContain('when in doubt, keep them');
  });
});

describe('buildSummarizePrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fresh project: no impl file, no completed tasks', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('IMPLEMENTATION.md');
    expect(prompt).toContain('my-project');
    expect(prompt).toContain('No existing IMPLEMENTATION.md');
    expect(prompt).toContain('create it from scratch');
    expect(prompt).toContain('Updating from the central task list.');
    // Should NOT contain completed tasks reference
    expect(prompt).not.toContain('Completed tasks are in');
  });

  it('existing impl file: instructs update in place', () => {
    const implPath = path.join(tmpDir, 'IMPLEMENTATION.md');
    fs.writeFileSync(implPath, '# Existing content\n');

    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('An existing IMPLEMENTATION.md is present');
    expect(prompt).toContain('update it in place');
    expect(prompt).not.toContain('create it from scratch');
  });

  it('with completed tasks: includes reference', () => {
    const ralphDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(ralphDir);
    const completedPath = path.join(ralphDir, 'tasks.completed.json');
    fs.writeFileSync(completedPath, '{}');

    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'my-project',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: completedPath,
      claudeMdPattern: '',
    });

    expect(prompt).toContain('Completed tasks are in');
    expect(prompt).toContain('.ralph/tasks.completed.json');
  });

  it('includes purpose description for summarize agent', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('You are updating IMPLEMENTATION.md');
    expect(prompt).toContain('test-proj');
    expect(prompt).toContain('PURPOSE:');
    expect(prompt).toContain('AUDIENCE:');
    expect(prompt).toContain('YOUR TASK:');
    expect(prompt).toContain('RULES:');
  });

  it('includes CLAUDE.md pruning section', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('CLAUDE.MD PRUNING:');
  });

  it('includes custom claudeMdPattern in pruning section', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: 'src/**/CLAUDE.md',
    });

    expect(prompt).toContain('src/**/CLAUDE.md');
  });

  it('uses custom implFile name', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'ARCHITECTURE.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('ARCHITECTURE.md');
    expect(prompt).not.toContain('IMPLEMENTATION.md');
  });

  it('includes structural guidance', () => {
    const prompt = buildSummarizePrompt({
      projectRoot: tmpDir,
      projectName: 'test-proj',
      implFile: 'IMPLEMENTATION.md',
      completedTasksPath: path.join(tmpDir, '.ralph', 'tasks.completed.json'),
      claudeMdPattern: '',
    });

    expect(prompt).toContain('System Overview');
    expect(prompt).toContain('Architecture');
    expect(prompt).toContain('Components');
  });
});
