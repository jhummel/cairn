import { describe, test, expect } from 'bun:test';
import { runMenu, formatMenuPrompt, type MenuOption } from '../src/menu';

/**
 * Mock readline interface that returns predetermined answers in sequence.
 */
function mockReadline(answers: string[]): { question: (prompt: string) => Promise<string>; close: () => void } {
  let index = 0;
  return {
    question: async (_prompt: string) => {
      if (index >= answers.length) {
        throw new Error('Mock readline ran out of answers');
      }
      return answers[index++];
    },
    close: () => {},
  };
}

describe('formatMenuPrompt', () => {
  test('formats options with bracketed first char', () => {
    const options: MenuOption[] = [
      { key: 'g', label: 'generate', handler: async () => ({ exit: true }) },
      { key: 'q', label: 'quit', handler: async () => ({ exit: true }) },
    ];
    const result = formatMenuPrompt(options);
    expect(result).toContain('[g]enerate');
    expect(result).toContain('[q]uit');
  });

  test('formats label with key anywhere in word', () => {
    const options: MenuOption[] = [
      { key: 'e', label: 'edit', handler: async () => ({ exit: true }) },
    ];
    const result = formatMenuPrompt(options);
    expect(result).toContain('[e]dit');
  });

  test('uses key prefix when key is not in label', () => {
    const options: MenuOption[] = [
      { key: 'x', label: 'something', handler: async () => ({ exit: true }) },
    ];
    const result = formatMenuPrompt(options);
    expect(result).toContain('[x] something');
  });
});

describe('runMenu', () => {
  test('single selection exits immediately', async () => {
    const options: MenuOption[] = [
      { key: 'q', label: 'quit', handler: async () => ({ exit: true, value: 'quit' }) },
      { key: 'c', label: 'continue', handler: async () => ({ exit: false }) },
    ];
    const rl = mockReadline(['q']);
    const result = await runMenu(options, rl);
    expect(result).toEqual({ exit: true, value: 'quit' });
  });

  test('loop continues on non-exit handler', async () => {
    let continueCount = 0;
    const options: MenuOption[] = [
      { key: 'c', label: 'continue', handler: async () => { continueCount++; return { exit: false }; } },
      { key: 'q', label: 'quit', handler: async () => ({ exit: true, value: 'done' }) },
    ];
    const rl = mockReadline(['c', 'c', 'q']);
    const result = await runMenu(options, rl);
    expect(continueCount).toBe(2);
    expect(result).toEqual({ exit: true, value: 'done' });
  });

  test('invalid input re-prompts', async () => {
    let handlerCalled = false;
    const options: MenuOption[] = [
      { key: 'q', label: 'quit', handler: async () => { handlerCalled = true; return { exit: true }; } },
    ];
    // 'z' is invalid, then 'q' is valid
    const rl = mockReadline(['z', '', 'q']);
    const result = await runMenu(options, rl);
    expect(handlerCalled).toBe(true);
    expect(result).toEqual({ exit: true });
  });

  test('case-insensitive matching', async () => {
    const options: MenuOption[] = [
      { key: 'q', label: 'quit', handler: async () => ({ exit: true, value: 'quit' }) },
    ];
    const rl = mockReadline(['Q']);
    const result = await runMenu(options, rl);
    expect(result).toEqual({ exit: true, value: 'quit' });
  });

  test('handler result is returned on exit', async () => {
    const options: MenuOption[] = [
      { key: 'g', label: 'generate', handler: async () => ({ exit: true, value: 'generate', data: 42 }) },
      { key: 'q', label: 'quit', handler: async () => ({ exit: true, value: 'quit' }) },
    ];
    const rl = mockReadline(['g']);
    const result = await runMenu(options, rl);
    expect(result).toEqual({ exit: true, value: 'generate', data: 42 });
  });

  test('trims whitespace from input', async () => {
    const options: MenuOption[] = [
      { key: 'q', label: 'quit', handler: async () => ({ exit: true }) },
    ];
    const rl = mockReadline(['  q  ']);
    const result = await runMenu(options, rl);
    expect(result).toEqual({ exit: true });
  });
});
