import { describe, it, expect, afterEach, beforeEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadPersonalInstructions,
  resetPersonalInstructionsDeprecationWarning,
} from '../src/personal-instructions';

describe('loadPersonalInstructions', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty string when file is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    expect(loadPersonalInstructions(tmpDir)).toBe('');
  });

  it('returns empty string for empty file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '');
    expect(loadPersonalInstructions(tmpDir)).toBe('');
  });

  it('returns empty string for whitespace-only file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '\n  \n\t');
    expect(loadPersonalInstructions(tmpDir)).toBe('');
  });

  it('returns formatted block for normal content', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '* Always use TDD\n');
    expect(loadPersonalInstructions(tmpDir)).toBe('\nPERSONAL INSTRUCTIONS:\n* Always use TDD\n\n');
  });

  it('preserves leading/trailing whitespace in multi-line content', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    const content = '* Always use TDD\n* Write clean code\n';
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), content);
    expect(loadPersonalInstructions(tmpDir)).toBe(`\nPERSONAL INSTRUCTIONS:\n${content}\n`);
  });
});

describe('loadPersonalInstructions deprecation warning', () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetPersonalInstructionsDeprecationWarning();
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('warns once on stderr and still returns the formatted content', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '* Always use TDD\n');

    const result = loadPersonalInstructions(tmpDir);

    expect(result).toBe('\nPERSONAL INSTRUCTIONS:\n* Always use TDD\n\n');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const message = stderrSpy.mock.calls[0][0] as string;
    expect(message).toContain('deprecated');
    expect(message).toContain('CLAUDE.local.md');
    expect(message).toContain('cairn init');
  });

  it('warns only once across multiple calls in the same process', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '* Always use TDD\n');

    loadPersonalInstructions(tmpDir);
    loadPersonalInstructions(tmpDir);
    loadPersonalInstructions(tmpDir);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('does not warn when the file is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    loadPersonalInstructions(tmpDir);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('does not warn when the file is blank', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '  \n');
    loadPersonalInstructions(tmpDir);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
