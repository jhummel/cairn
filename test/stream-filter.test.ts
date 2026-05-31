import { describe, it, expect } from 'bun:test';
import { CYAN, DIM, GREEN, RED, YELLOW, BOLD, RESET, shortPath, fmtTool, fmtResult, processStream, sendToNarrate, sendNtfy } from '../src/stream-filter';
import { Readable, Writable } from 'stream';
import net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

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

  it('accepts narrate/ntfy options as no-ops without crashing', async () => {
    const event = JSON.stringify({ type: 'system', subtype: 'init', model: 'test', permissionMode: 'plan' });
    const { writable, output } = collectWritable();
    // These are no-op placeholders for task 3
    await processStream(linesStream([event]), writable, {
      narrate: (_text: string) => {},
      ntfy: (_msg: string, _opts?: Record<string, string>) => {},
      taskContext: 'test task',
    });
    const out = output();
    expect(out).toContain('[init]');
  });

  it('reads RALPH_TRUNCATE_TEXT from env when option not provided', async () => {
    const originalEnv = process.env.RALPH_TRUNCATE_TEXT;
    try {
      process.env.RALPH_TRUNCATE_TEXT = 'false';
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
        delete process.env.RALPH_TRUNCATE_TEXT;
      } else {
        process.env.RALPH_TRUNCATE_TEXT = originalEnv;
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

// --- sendToNarrate tests ---

describe('sendToNarrate', () => {
  it('skips if socketPath is empty', async () => {
    await sendToNarrate('hello', '');
  });

  it('skips if text is empty string', async () => {
    await sendToNarrate('', '/some/socket');
  });

  it('skips if text is whitespace only', async () => {
    await sendToNarrate('   ', '/some/socket');
  });

  it('skips if socket file does not exist', async () => {
    // Should complete without throwing
    await sendToNarrate('hello', '/nonexistent/socket/path.sock');
  });

  it('sends text to a real Unix domain socket', async () => {
    const socketPath = join(tmpdir(), `test-narrate-${Date.now()}.sock`);
    let received = '';
    const server = net.createServer((client) => {
      client.on('data', (data) => { received += data.toString(); });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      await sendToNarrate('hello from test', socketPath);
      // Give data time to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(received).toBe('hello from test');
    } finally {
      server.close();
      if (existsSync(socketPath)) unlinkSync(socketPath);
    }
  });
});

// --- sendNtfy tests ---

describe('sendNtfy', () => {
  it('skips if topic is empty', async () => {
    // Should not throw even without a real network
    await sendNtfy('message', '');
  });

  it('sends POST request to ntfy.sh/<topic>', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (url: any, init: any) => {
      calls.push({ url: url.toString(), init });
      return Promise.resolve(new Response('', { status: 200 }));
    };
    try {
      await sendNtfy('test message', 'my-topic');
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe('https://ntfy.sh/my-topic');
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.body).toBe('test message');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sets Title, Priority, Tags headers when provided', async () => {
    const calls: { headers: Record<string, string> }[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (_url: any, init: any) => {
      calls.push({ headers: init.headers as Record<string, string> });
      return Promise.resolve(new Response('', { status: 200 }));
    };
    try {
      await sendNtfy('msg', 'topic', { title: 'My Title', priority: '3', tags: 'check' });
      expect(calls[0].headers['Title']).toBe('My Title');
      expect(calls[0].headers['Priority']).toBe('3');
      expect(calls[0].headers['Tags']).toBe('check');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('omits headers not provided in opts', async () => {
    const calls: { headers: Record<string, string> }[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (_url: any, init: any) => {
      calls.push({ headers: init.headers as Record<string, string> });
      return Promise.resolve(new Response('', { status: 200 }));
    };
    try {
      await sendNtfy('msg', 'topic', { title: 'Only Title' });
      expect(calls[0].headers['Title']).toBe('Only Title');
      expect(calls[0].headers['Priority']).toBeUndefined();
      expect(calls[0].headers['Tags']).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('catches network errors silently', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('network error'));
    try {
      // Should not throw
      await sendNtfy('msg', 'topic');
    } finally {
      globalThis.fetch = origFetch;
    }
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

// --- processStream narration integration tests ---

describe('processStream narration', () => {
  it('calls narrate and ntfy on system/init when taskContext is set', async () => {
    const event = JSON.stringify({ type: 'system', subtype: 'init', model: 'test', permissionMode: 'plan' });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];
    const ntfyCalls: { msg: string; opts?: any }[] = [];

    await processStream(linesStream([event]), writable, {
      taskContext: 'implement feature X',
      narrate: (text) => { narrateCalls.push(text); },
      ntfy: (msg, opts) => { ntfyCalls.push({ msg, opts }); },
    });

    expect(narrateCalls).toContain('Starting work on: implement feature X');
    expect(ntfyCalls[0].msg).toBe('Starting: implement feature X');
    expect(ntfyCalls[0].opts?.title).toBe('Ralph');
    expect(ntfyCalls[0].opts?.tags).toBe('hammer');
  });

  it('does not call narrate/ntfy on system/init when taskContext is not set', async () => {
    const event = JSON.stringify({ type: 'system', subtype: 'init', model: 'test', permissionMode: 'plan' });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];
    const ntfyCalls: { msg: string }[] = [];

    await processStream(linesStream([event]), writable, {
      narrate: (text) => { narrateCalls.push(text); },
      ntfy: (msg) => { ntfyCalls.push({ msg }); },
    });

    expect(narrateCalls).toHaveLength(0);
    expect(ntfyCalls).toHaveLength(0);
  });

  it('calls narrate on assistant text blocks without taskContext', async () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Some assistant text' }] },
    });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];

    await processStream(linesStream([event]), writable, {
      narrate: (text) => { narrateCalls.push(text); },
    });

    expect(narrateCalls).toHaveLength(1);
    expect(narrateCalls[0]).toBe('Some assistant text');
  });

  it('prepends taskContext to narration of text blocks', async () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Working on something' }] },
    });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];

    await processStream(linesStream([event]), writable, {
      taskContext: 'my task',
      narrate: (text) => { narrateCalls.push(text); },
    });

    expect(narrateCalls[0]).toBe('[Task: my task]\nWorking on something');
  });

  it('truncates narration text to 1000 chars', async () => {
    const longText = 'X'.repeat(2000);
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: longText }] },
    });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];

    await processStream(linesStream([event]), writable, {
      narrate: (text) => { narrateCalls.push(text); },
    });

    expect(narrateCalls[0].length).toBe(1000);
  });

  it('does not call narrate for empty text blocks', async () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '   ' }] },
    });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];

    await processStream(linesStream([event]), writable, {
      narrate: (text) => { narrateCalls.push(text); },
    });

    expect(narrateCalls).toHaveLength(0);
  });

  it('calls narrate and ntfy on successful result events', async () => {
    const event = JSON.stringify({
      type: 'result',
      duration_ms: 10000,
      num_turns: 3,
      is_error: false,
    });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];
    const ntfyCalls: { msg: string; opts?: any }[] = [];

    await processStream(linesStream([event]), writable, {
      narrate: (text) => { narrateCalls.push(text); },
      ntfy: (msg, opts) => { ntfyCalls.push({ msg, opts }); },
    });

    expect(narrateCalls[0]).toContain('finished');
    expect(narrateCalls[0]).toContain('3 turns');
    expect(narrateCalls[0]).toContain('10 seconds');
    expect(ntfyCalls[0].opts?.tags).toBe('white_check_mark');
    expect(ntfyCalls[0].opts?.priority).toBe('3');
    expect(ntfyCalls[0].opts?.title).toBe('Ralph - Finished');
  });

  it('uses error tags/priority for failed result events', async () => {
    const event = JSON.stringify({
      type: 'result',
      duration_ms: 5000,
      num_turns: 1,
      is_error: true,
    });
    const { writable } = collectWritable();
    const ntfyCalls: { msg: string; opts?: any }[] = [];

    await processStream(linesStream([event]), writable, {
      ntfy: (msg, opts) => { ntfyCalls.push({ msg, opts }); },
    });

    expect(ntfyCalls[0].opts?.tags).toBe('x');
    expect(ntfyCalls[0].opts?.priority).toBe('4');
    expect(ntfyCalls[0].opts?.title).toBe('Ralph - Failed');
    expect(ntfyCalls[0].msg).toContain('failed');
  });

  it('includes taskContext in result summary', async () => {
    const event = JSON.stringify({
      type: 'result',
      duration_ms: 5000,
      num_turns: 2,
      is_error: false,
    });
    const { writable } = collectWritable();
    const narrateCalls: string[] = [];

    await processStream(linesStream([event]), writable, {
      taskContext: 'build system',
      narrate: (text) => { narrateCalls.push(text); },
    });

    expect(narrateCalls[0]).toContain('build system');
    expect(narrateCalls[0]).toContain('finished');
  });
});
