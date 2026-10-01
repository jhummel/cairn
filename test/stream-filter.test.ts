import { describe, it, expect } from 'bun:test';
import { CYAN, DIM, GREEN, RED, YELLOW, BOLD, RESET, shortPath, fmtTool, fmtResult, processStream, renderEvent } from '../src/stream-filter';
import { Readable, Writable } from 'stream';

describe('narration/ntfy removal', () => {
  it('no longer exports sendToNarrate, sendNtfy', async () => {
    const mod: Record<string, unknown> = await import('../src/stream-filter');
    expect(mod.sendToNarrate).toBeUndefined();
    expect(mod.sendNtfy).toBeUndefined();
  });

  it('never calls fetch while rendering a full stream', async () => {
    const origFetch = globalThis.fetch;
    const calls: unknown[] = [];
    globalThis.fetch = ((...args: unknown[]) => { calls.push(args); return Promise.resolve(new Response('')); }) as unknown as typeof fetch;
    try {
      const events = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'm', permissionMode: 'plan' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
        JSON.stringify({ type: 'result', duration_ms: 1000, num_turns: 1, is_error: false }),
      ];
      const { writable } = collectWritable();
      await processStream(linesStream(events), writable, { taskId: 1 });
      expect(calls).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

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

// --- processStream tests ---

/** Helper: create a readable stream from an array of lines */
function linesStream(lines: string[]): Readable {
  const data = lines.join('\n') + '\n';
  return Readable.from(Buffer.from(data));
}

/** Helper: collect all writes to a writable into a string */
function collectWritable(): { writable: Writable; output: () => string } {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { writable, output: () => Buffer.concat(chunks).toString() };
}

describe('processStream', () => {
  it('skips empty lines', async () => {
    const { writable, output } = collectWritable();
    await processStream(linesStream(['', '  ', '']), writable);
    expect(output()).toBe('');
  });

  it('passes through non-JSON lines as-is', async () => {
    const { writable, output } = collectWritable();
    await processStream(linesStream(['hello world', 'not json {']), writable);
    const lines = output().trimEnd().split('\n');
    expect(lines).toEqual(['hello world', 'not json {']);
  });

  it('handles system/init events', async () => {
    const event = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet', permissionMode: 'plan' });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable);
    const out = output();
    expect(out).toContain('[init]');
    expect(out).toContain('claude-sonnet');
    expect(out).toContain('plan');
    expect(out).toContain(DIM);
  });

  it('ignores system events without subtype=init', async () => {
    const event = JSON.stringify({ type: 'system', subtype: 'other' });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable);
    expect(output()).toBe('');
  });

  it('handles assistant tool_use blocks', async () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/a/b/c/d/e.ts' } },
        ],
      },
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable);
    const out = output();
    expect(out).toContain('> ');
    expect(out).toContain('Read');
    expect(out).toContain('.../c/d/e.ts');
  });

  it('handles assistant text blocks with truncation (default)', async () => {
    const longText = 'A'.repeat(100);
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: longText }],
      },
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable, { truncateText: true });
    const out = output();
    // Should be truncated to 77 chars + '...'
    expect(out).toContain('A'.repeat(77) + '...');
    expect(out).toContain(YELLOW);
  });

  it('handles assistant text blocks without truncation', async () => {
    const text = 'line one\nline two\nline three';
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text }],
      },
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable, { truncateText: false });
    const out = output();
    expect(out).toContain('line one');
    expect(out).toContain('line two');
    expect(out).toContain('line three');
    // Each line should be indented and yellow
    const lines = out.trimEnd().split('\n');
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(line).toContain(YELLOW);
      expect(line).toContain(RESET);
    }
  });

  it('truncates first line of text to 80 chars when truncateText=true', async () => {
    const text = 'B'.repeat(80); // exactly 80, should be truncated (>80 triggers)
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable, { truncateText: true });
    const out = output();
    // 80 chars: len > 80 is false, so it should NOT be truncated
    expect(out).toContain('B'.repeat(80));
    expect(out).not.toContain('...');
  });

  it('truncates text longer than 80 chars', async () => {
    const text = 'C'.repeat(81);
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable, { truncateText: true });
    const out = output();
    expect(out).toContain('C'.repeat(77) + '...');
  });

  it('skips empty text blocks', async () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '   ' }] },
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable);
    expect(output()).toBe('');
  });

  it('handles result events', async () => {
    const event = JSON.stringify({
      type: 'result',
      duration_ms: 10000,
      total_cost_usd: 0.05,
      num_turns: 3,
      is_error: false,
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable);
    const out = output();
    expect(out).toContain('Done');
    expect(out).toContain('10s');
    expect(out).toContain('3 turns');
    expect(out).toContain('$0.0500');
  });

  it('handles error result events', async () => {
    const event = JSON.stringify({
      type: 'result',
      duration_ms: 5000,
      total_cost_usd: 0.01,
      num_turns: 1,
      is_error: true,
      errors: ['boom'],
    });
    const { writable, output } = collectWritable();
    await processStream(linesStream([event]), writable);
    const out = output();
    expect(out).toContain('FAILED');
    expect(out).toContain('boom');
  });

  it('handles multiple events in sequence', async () => {
    const events = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'opus', permissionMode: 'full' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'List files' } }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Working on it' }] },
      }),
      JSON.stringify({ type: 'result', duration_ms: 2000, total_cost_usd: 0.003, num_turns: 2, is_error: false }),
    ];
    const { writable, output } = collectWritable();
    await processStream(linesStream(events), writable);
    const out = output();
    expect(out).toContain('[init]');
    expect(out).toContain('Bash');
    expect(out).toContain('Working on it');
    expect(out).toContain('Done');
  });

  it('reads CAIRN_TRUNCATE_TEXT from env when option not provided', async () => {
    const originalEnv = process.env.CAIRN_TRUNCATE_TEXT;
    try {
      process.env.CAIRN_TRUNCATE_TEXT = 'false';
      const text = 'line1\nline2';
      const event = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
      });
      const { writable, output } = collectWritable();
      await processStream(linesStream([event]), writable);
      const out = output();
      // With truncateText=false, both lines should appear
      expect(out).toContain('line1');
      expect(out).toContain('line2');
      const lines = out.trimEnd().split('\n');
      expect(lines.length).toBe(2);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CAIRN_TRUNCATE_TEXT;
      } else {
        process.env.CAIRN_TRUNCATE_TEXT = originalEnv;
      }
    }
  });

  it('handles mixed JSON and non-JSON lines', async () => {
    const lines = [
      'some stderr output',
      JSON.stringify({ type: 'system', subtype: 'init', model: 'haiku', permissionMode: 'ask' }),
      'another non-json line',
    ];
    const { writable, output } = collectWritable();
    await processStream(linesStream(lines), writable);
    const out = output();
    expect(out).toContain('some stderr output');
    expect(out).toContain('[init]');
    expect(out).toContain('another non-json line');
  });
});

// --- processStream taskId prefix tests ---

describe('processStream taskId prefix', () => {
  it('prefixes every output line with [#<id>] when taskId is provided', async () => {
    const events = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet', permissionMode: 'plan' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls', description: '' } }] },
      }),
      JSON.stringify({ type: 'result', duration_ms: 1000, total_cost_usd: 0, num_turns: 1, is_error: false }),
    ];
    const { writable, output } = collectWritable();
    await processStream(linesStream(events), writable, { taskId: 5 });
    const lines = output().trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^\[#5\] /);
    }
  });

  it('does not prefix lines when taskId is omitted — byte-for-byte unchanged', async () => {
    const event = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet', permissionMode: 'plan' });
    const { writable: w1, output: out1 } = collectWritable();
    const { writable: w2, output: out2 } = collectWritable();
    await processStream(linesStream([event]), w1);
    await processStream(linesStream([event]), w2, {});
    expect(out1()).toBe(out2());
    expect(out1()).not.toContain('[#');
  });
});

describe('renderEvent', () => {
  it('renders an assistant tool_use block in transcript shape', () => {
    const e = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b' } }] } };
    expect(renderEvent(e, { truncateText: true })).toEqual([`  > ${fmtTool({ name: 'Read', input: { file_path: '/a/b' } })}`]);
  });

  it('truncates text to the first line when truncateText is true', () => {
    const e = { type: 'assistant', message: { content: [{ type: 'text', text: 'one\ntwo\nthree' }] } };
    expect(renderEvent(e, { truncateText: true })).toEqual([`  ${YELLOW}one${RESET}`]);
  });

  it('truncates long first lines to 80 chars', () => {
    const e = { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(100) }] } };
    expect(renderEvent(e, { truncateText: true })).toEqual([`  ${YELLOW}${'x'.repeat(77)}...${RESET}`]);
  });

  it('renders all text lines when truncateText is false', () => {
    const e = { type: 'assistant', message: { content: [{ type: 'text', text: 'one\ntwo' }] } };
    expect(renderEvent(e, { truncateText: false })).toEqual([`  ${YELLOW}one${RESET}`, `  ${YELLOW}two${RESET}`]);
  });

  it('renders a mixed content array in order', () => {
    const e = { type: 'assistant', message: { content: [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', name: 'Glob', input: { pattern: '*.ts' } },
      { type: 'text', text: '   ' },
    ] } };
    expect(renderEvent(e, { truncateText: true })).toEqual([
      `  ${YELLOW}hello${RESET}`,
      `  > ${fmtTool({ name: 'Glob', input: { pattern: '*.ts' } })}`,
    ]);
  });

  it('renders system init', () => {
    expect(renderEvent({ type: 'system', subtype: 'init', model: 'm', permissionMode: 'plan' }, { truncateText: true }))
      .toEqual([`  ${DIM}[init]${RESET} m | plan`]);
  });

  it('renders a result event', () => {
    const e = { type: 'result', duration_ms: 2000, total_cost_usd: 0.5, num_turns: 3, is_error: false };
    expect(renderEvent(e, { truncateText: true })).toEqual([`  ${fmtResult(e)}`]);
  });

  it('returns [] for user tool_result events', () => {
    const e = { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } };
    expect(renderEvent(e, { truncateText: true })).toEqual([]);
  });

  it('returns [] for unknown types', () => {
    expect(renderEvent({ type: 'weird' }, { truncateText: false })).toEqual([]);
    expect(renderEvent({}, { truncateText: false })).toEqual([]);
  });
});
