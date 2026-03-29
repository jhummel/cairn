/**
 * Shared interactive menu helper.
 * Displays options, prompts for input, dispatches to handlers, loops until exit.
 */

export interface MenuResult {
  exit: boolean;
  value?: string;
  [key: string]: unknown;
}

export interface MenuOption {
  key: string;       // Single character
  label: string;     // Display string (e.g., 'generate', 'quit')
  handler: () => Promise<MenuResult>;
}

export interface ReadlineInterface {
  question: (prompt: string) => Promise<string>;
  close: () => void;
}

/**
 * Format the menu prompt string, e.g. "[g]enerate  [e]dit  [q]uit"
 */
export function formatMenuPrompt(options: MenuOption[]): string {
  const parts = options.map(({ key, label }) => {
    const idx = label.toLowerCase().indexOf(key.toLowerCase());
    if (idx >= 0) {
      return `[${label[idx]}]${label.slice(idx + 1)}`;
    }
    return `[${key}] ${label}`;
  });
  return parts.join('  ');
}

/**
 * Run an interactive menu loop.
 * Displays options, prompts for input, dispatches to the matching handler.
 * Loops until a handler returns { exit: true }.
 *
 * @param options - Menu options with key, label, and async handler
 * @param rl - Injectable readline interface for testability
 * @returns The result from the handler that signaled exit
 */
export async function runMenu(options: MenuOption[], rl: ReadlineInterface): Promise<MenuResult> {
  const keyMap = new Map<string, MenuOption>();
  for (const opt of options) {
    keyMap.set(opt.key.toLowerCase(), opt);
  }

  const prompt = `\n${formatMenuPrompt(options)}\n> `;

  while (true) {
    const answer = await rl.question(prompt);
    const input = answer.trim().toLowerCase();

    if (!input || !keyMap.has(input)) {
      continue;
    }

    const option = keyMap.get(input)!;
    const result = await option.handler();

    if (result.exit) {
      return result;
    }
  }
}
