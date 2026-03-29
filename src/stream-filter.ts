// ANSI color constants matching lib/ralph_stream_filter.py
export const CYAN = '\x1b[36m';
export const DIM = '\x1b[2m';
export const GREEN = '\x1b[32m';
export const RED = '\x1b[31m';
export const YELLOW = '\x1b[33m';
export const BOLD = '\x1b[1m';
export const RESET = '\x1b[0m';

/**
 * Shorten an absolute path to the last 3 components.
 * e.g. '/a/b/c/d/e' → '.../c/d/e'
 */
export function shortPath(path: string): string {
  const parts = path.split('/');
  if (parts.length > 3) {
    return '.../' + parts.slice(-3).join('/');
  }
  return path;
}

interface ToolBlock {
  name?: string;
  input?: Record<string, string>;
}

/**
 * Format a tool_use content block into a one-line colored summary.
 */
export function fmtTool(block: ToolBlock): string {
  const name = block.name ?? '?';
  const inp = block.input ?? {};

  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write': {
      const path = inp.file_path ?? '';
      return `${CYAN}${name}${RESET} ${DIM}${shortPath(path)}${RESET}`;
    }
    case 'Bash': {
      const cmd = inp.command ?? '';
      const desc = inp.description ?? '';
      const label = desc ? desc : (cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd);
      return `${CYAN}Bash${RESET} ${DIM}${label}${RESET}`;
    }
    case 'Glob': {
      return `${CYAN}Glob${RESET} ${DIM}${inp.pattern ?? ''}${RESET}`;
    }
    case 'Grep': {
      const pat = inp.pattern ?? '';
      const path = inp.path ?? '';
      const suffix = path ? ` in ${shortPath(path)}` : '';
      return `${CYAN}Grep${RESET} ${DIM}${pat}${suffix}${RESET}`;
    }
    case 'Task': {
      const desc = inp.description ?? 'subagent';
      return `${CYAN}Task${RESET} ${DIM}${desc}${RESET}`;
    }
    default:
      return `${CYAN}${name}${RESET}`;
  }
}

interface ResultEvent {
  duration_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  errors?: string[];
}

/**
 * Format the final result summary with duration, cost, turns, and error status.
 */
export function fmtResult(event: ResultEvent): string {
  const dur = (event.duration_ms ?? 0) / 1000;
  const cost = event.total_cost_usd ?? 0;
  const turns = event.num_turns ?? 0;
  const isError = event.is_error ?? false;

  const durStr = Math.round(dur).toString();
  const costStr = cost.toFixed(4);

  if (isError) {
    const errors = event.errors ?? [];
    const errMsg = errors.length > 0 ? errors[0] : 'unknown error';
    return `${RED}FAILED${RESET} ${DIM}${durStr}s | ${turns} turns | $${costStr}${RESET} -- ${errMsg}`;
  } else {
    return `${GREEN}Done${RESET} ${DIM}${durStr}s | ${turns} turns | $${costStr}${RESET}`;
  }
}
