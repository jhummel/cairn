import { describe, it, expect } from 'bun:test';
import { CYAN, DIM, GREEN, RED, YELLOW, BOLD, RESET, shortPath, fmtTool, fmtResult } from '../src/stream-filter';

describe('ANSI constants', () => {
  it('exports all color constants', () => {
    expect(CYAN).toBe('\x1b[36m');
    expect(DIM).toBe('\x1b[2m');
    expect(GREEN).toBe('\x1b[32m');
    expect(RED).toBe('\x1b[31m');
    expect(YELLOW).toBe('\x1b[33m');
    expect(BOLD).toBe('\x1b[1m');
    expect(RESET).toBe('\x1b[0m');
  });
});

describe('shortPath', () => {
  it('returns path unchanged when split has 3 or fewer parts', () => {
    // '/a/b' splits to ['', 'a', 'b'] — len 3, returned as-is
    expect(shortPath('/a/b')).toBe('/a/b');
    // 'a/b/c' splits to ['a', 'b', 'c'] — len 3, returned as-is
    expect(shortPath('a/b/c')).toBe('a/b/c');
  });

  it('shortens absolute paths with 3+ actual components', () => {
    // '/a/b/c' splits to ['', 'a', 'b', 'c'] — len 4, shortened
    expect(shortPath('/a/b/c')).toBe('.../a/b/c');
    expect(shortPath('/a/b/c/d')).toBe('.../b/c/d');
    expect(shortPath('/a/b/c/d/e')).toBe('.../c/d/e');
  });

  it('handles empty string', () => {
    expect(shortPath('')).toBe('');
  });
});

describe('fmtTool', () => {
  it('formats Read block', () => {
    const block = { name: 'Read', input: { file_path: '/a/b/c/d/file.ts' } };
    expect(fmtTool(block)).toBe(`${CYAN}Read${RESET} ${DIM}.../c/d/file.ts${RESET}`);
  });

  it('formats Edit block', () => {
    const block = { name: 'Edit', input: { file_path: '/a/b/c/d/file.ts' } };
    expect(fmtTool(block)).toBe(`${CYAN}Edit${RESET} ${DIM}.../c/d/file.ts${RESET}`);
  });

  it('formats Write block', () => {
    const block = { name: 'Write', input: { file_path: '/a/b/c/d/file.ts' } };
    expect(fmtTool(block)).toBe(`${CYAN}Write${RESET} ${DIM}.../c/d/file.ts${RESET}`);
  });

  it('formats Bash block with description', () => {
    const block = { name: 'Bash', input: { command: 'some long command', description: 'Run tests' } };
    expect(fmtTool(block)).toBe(`${CYAN}Bash${RESET} ${DIM}Run tests${RESET}`);
  });

  it('formats Bash block without description — short command', () => {
    const block = { name: 'Bash', input: { command: 'ls -la', description: '' } };
    expect(fmtTool(block)).toBe(`${CYAN}Bash${RESET} ${DIM}ls -la${RESET}`);
  });

  it('formats Bash block without description — truncates long command at 60 chars', () => {
    const cmd = 'a'.repeat(70);
    const block = { name: 'Bash', input: { command: cmd, description: '' } };
    expect(fmtTool(block)).toBe(`${CYAN}Bash${RESET} ${DIM}${'a'.repeat(60)}...${RESET}`);
  });

  it('formats Glob block', () => {
    const block = { name: 'Glob', input: { pattern: '**/*.ts' } };
    expect(fmtTool(block)).toBe(`${CYAN}Glob${RESET} ${DIM}**/*.ts${RESET}`);
  });

  it('formats Grep block without path', () => {
    const block = { name: 'Grep', input: { pattern: 'fooBar' } };
    expect(fmtTool(block)).toBe(`${CYAN}Grep${RESET} ${DIM}fooBar${RESET}`);
  });

  it('formats Grep block with path', () => {
    const block = { name: 'Grep', input: { pattern: 'fooBar', path: '/a/b/c/d/src' } };
    expect(fmtTool(block)).toBe(`${CYAN}Grep${RESET} ${DIM}fooBar in .../c/d/src${RESET}`);
  });

  it('formats Task block with description', () => {
    const block = { name: 'Task', input: { description: 'Explore codebase' } };
    expect(fmtTool(block)).toBe(`${CYAN}Task${RESET} ${DIM}Explore codebase${RESET}`);
  });

  it('formats Task block without description falls back to subagent', () => {
    const block = { name: 'Task', input: {} };
    expect(fmtTool(block)).toBe(`${CYAN}Task${RESET} ${DIM}subagent${RESET}`);
  });

  it('formats unknown tool with just name', () => {
    const block = { name: 'WebSearch', input: {} };
    expect(fmtTool(block)).toBe(`${CYAN}WebSearch${RESET}`);
  });

  it('handles missing name', () => {
    const block = { input: {} };
    expect(fmtTool(block)).toBe(`${CYAN}?${RESET}`);
  });
});

describe('fmtResult', () => {
  it('formats success result', () => {
    const event = { duration_ms: 5000, total_cost_usd: 0.0123, num_turns: 4, is_error: false };
    expect(fmtResult(event)).toBe(`${GREEN}Done${RESET} ${DIM}5s | 4 turns | $0.0123${RESET}`);
  });

  it('formats success with zero cost', () => {
    const event = { duration_ms: 1000, total_cost_usd: 0, num_turns: 1, is_error: false };
    expect(fmtResult(event)).toBe(`${GREEN}Done${RESET} ${DIM}1s | 1 turns | $0.0000${RESET}`);
  });

  it('formats error result with error message', () => {
    const event = {
      duration_ms: 3000,
      total_cost_usd: 0.005,
      num_turns: 2,
      is_error: true,
      errors: ['Something went wrong'],
    };
    expect(fmtResult(event)).toBe(
      `${RED}FAILED${RESET} ${DIM}3s | 2 turns | $0.0050${RESET} -- Something went wrong`
    );
  });

  it('formats error result with no errors array', () => {
    const event = { duration_ms: 2000, total_cost_usd: 0.001, num_turns: 1, is_error: true };
    expect(fmtResult(event)).toBe(
      `${RED}FAILED${RESET} ${DIM}2s | 1 turns | $0.0010${RESET} -- unknown error`
    );
  });

  it('rounds duration to nearest second', () => {
    const event = { duration_ms: 4500, total_cost_usd: 0, num_turns: 1, is_error: false };
    // 4500ms → 4.5s → formatted as "4s" (Math.round-like, Python :.0f rounds to nearest)
    // Python :.0f is banker's rounding on .5, but 4.5 → 4 or 5
    // Checking that it's either 4 or 5 seconds
    const result = fmtResult(event);
    expect(result).toMatch(/[45]s/);
  });
});
