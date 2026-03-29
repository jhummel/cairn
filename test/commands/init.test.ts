import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initCoreFiles } from '../../src/commands/init';

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
    // Create a subdirectory with a known name
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectDir);
    const dataDir = path.join(projectDir, '.ralph');
    initCoreFiles(projectDir, dataDir);
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8'));
    expect(data.project).toBe('my-project');
  });
});
