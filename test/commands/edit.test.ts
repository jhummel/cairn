import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// We spy on spawnSync to avoid actually launching an editor
import { runEdit } from '../../src/commands/edit';

describe('runEdit', () => {
  let tmpDir: string;
  let dataDir: string;
  let spawnSpy: ReturnType<typeof spyOn>;
  let stderrLines: string[];
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-edit-test-'));
    dataDir = path.join(tmpDir, '.ralph');
    fs.mkdirSync(dataDir);

    stderrLines = [];
    consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: any[]) => {
      stderrLines.push(args.join(' '));
    });

    // Default spy: pretend spawnSync succeeds
    spawnSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      signal: null,
      pid: 1234,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      error: undefined,
    } as any);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    spawnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  // --- target-to-path mapping ---

  test('default target (tasks) maps to tasks.json', () => {
    const tasksFile = path.join(dataDir, 'tasks.json');
    fs.writeFileSync(tasksFile, '{}');

    runEdit('tasks', tmpDir, dataDir);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain(tasksFile);
  });

  test('target "plan" maps to planning-notes.md', () => {
    const notesFile = path.join(dataDir, 'planning-notes.md');
    fs.writeFileSync(notesFile, '# notes');

    runEdit('plan', tmpDir, dataDir);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain(notesFile);
  });

  test('target "notes" maps to planning-notes.md', () => {
    const notesFile = path.join(dataDir, 'planning-notes.md');
    fs.writeFileSync(notesFile, '# notes');

    runEdit('notes', tmpDir, dataDir);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain(notesFile);
  });

  test('target "config" maps to cairn.json in projectRoot', () => {
    const configFile = path.join(tmpDir, 'cairn.json');
    fs.writeFileSync(configFile, '{}');

    runEdit('config', tmpDir, dataDir);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain(configFile);
  });

  test('target "config" never opens a leftover ralph.json', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), '{}');

    try {
      expect(() => runEdit('config', tmpDir, dataDir)).toThrow();
    } finally {
      exitSpy.mockRestore();
    }

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(stderrLines.join('\n')).toContain('File not found:');
  });

  test('target "config" opens cairn.json even when a ralph.json also exists', () => {
    const configFile = path.join(tmpDir, 'cairn.json');
    fs.writeFileSync(configFile, '{}');
    fs.writeFileSync(path.join(tmpDir, 'ralph.json'), '{}');

    runEdit('config', tmpDir, dataDir);

    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain(configFile);
    expect(args).not.toContain(path.join(tmpDir, 'ralph.json'));
  });

  // --- EDITOR env var ---

  test('uses EDITOR env var when set', () => {
    const tasksFile = path.join(dataDir, 'tasks.json');
    fs.writeFileSync(tasksFile, '{}');

    const origEditor = process.env.EDITOR;
    process.env.EDITOR = 'nano';
    try {
      runEdit('tasks', tmpDir, dataDir);
      const [cmd] = spawnSpy.mock.calls[0];
      expect(cmd).toBe('nano');
    } finally {
      if (origEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = origEditor;
    }
  });

  test('falls back to vi when EDITOR is not set', () => {
    const tasksFile = path.join(dataDir, 'tasks.json');
    fs.writeFileSync(tasksFile, '{}');

    const origEditor = process.env.EDITOR;
    delete process.env.EDITOR;
    try {
      runEdit('tasks', tmpDir, dataDir);
      const [cmd] = spawnSpy.mock.calls[0];
      expect(cmd).toBe('vi');
    } finally {
      if (origEditor !== undefined) process.env.EDITOR = origEditor;
    }
  });

  test('spawns with stdio inherit', () => {
    const tasksFile = path.join(dataDir, 'tasks.json');
    fs.writeFileSync(tasksFile, '{}');

    runEdit('tasks', tmpDir, dataDir);

    const [, , opts] = spawnSpy.mock.calls[0];
    expect(opts.stdio).toBe('inherit');
  });

  // --- error cases ---

  test('unknown target prints error and exits 1', () => {
    let exitCode: number | undefined;
    const exitSpy = spyOn(process, 'exit').mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });

    try {
      expect(() => runEdit('bogus', tmpDir, dataDir)).toThrow();
    } finally {
      exitSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    const combined = stderrLines.join('\n');
    expect(combined).toContain('Unknown target: bogus');
    expect(combined).toContain('Usage: cairn edit');
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test('missing file prints error and exits 1', () => {
    let exitCode: number | undefined;
    const exitSpy = spyOn(process, 'exit').mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });

    // tasks.json does NOT exist
    try {
      expect(() => runEdit('tasks', tmpDir, dataDir)).toThrow();
    } finally {
      exitSpy.mockRestore();
    }

    expect(exitCode).toBe(1);
    const combined = stderrLines.join('\n');
    expect(combined).toContain('File not found:');
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
