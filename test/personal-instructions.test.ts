import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadPersonalInstructions } from '../src/personal-instructions';

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
