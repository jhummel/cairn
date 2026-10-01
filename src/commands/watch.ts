import * as fs from 'fs';
import { findSession, listAgentTranscripts, type AgentTranscript } from '../transcripts';
import { renderEvent } from '../stream-filter';

/**
 * `cairn watch` — a read-only live view of the running `/cairn-run` subagent.
 *
 * Polls (never fs.watch, which is unreliable on macOS) the newest matching
 * subagent transcript, replays it from byte 0, then follows appended bytes.
 * Never touches run state, tasks.json, the hook or settle.
 */

export const WATCH_POLL_MS = 500;

export interface WatchOptions {
  projectRoot: string;
  /** Pin this Claude Code session instead of following the newest one. */
  sessionId?: string;
  /** Show every subagent, not only cairn-task-agent / post-task-reviewer. */
  all?: boolean;
  truncateText: boolean;
}

export interface WatchDeps {
  configDir: string;
  sleep: (ms: number) => Promise<void>;
  write: (text: string) => void;
  writeErr: (text: string) => void;
  /** Checked after every poll; returning true ends the loop. */
  shouldStop: () => boolean;
}

export function watchHeader(t: AgentTranscript): string {
  return `── ${t.description ?? t.id} · ${t.agentType ?? 'unknown'} ──`;
}

interface Follow {
  transcript: AgentTranscript;
  offset: number;
  partial: Buffer;
}

/** Read bytes appended since `f.offset`; return complete lines, buffering any trailing partial. */
function readAppended(f: Follow): string[] {
  let fd: number;
  try {
    fd = fs.openSync(f.transcript.jsonlPath, 'r');
  } catch {
    return [];
  }
  const chunks: Buffer[] = [f.partial];
  try {
    const size = fs.fstatSync(fd).size;
    if (size < f.offset) {
      // Truncated/replaced: start over.
      f.offset = 0;
      chunks.length = 0;
    }
    while (f.offset < size) {
      const buf = Buffer.alloc(Math.min(size - f.offset, 1 << 20));
      const n = fs.readSync(fd, buf, 0, buf.length, f.offset);
      if (n <= 0) break;
      chunks.push(buf.subarray(0, n));
      f.offset += n;
    }
  } catch {
    // best-effort; retry next poll
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
  const data = Buffer.concat(chunks);
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0a) {
      lines.push(data.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  f.partial = Buffer.from(data.subarray(start));
  return lines;
}

function renderLines(lines: string[], opts: WatchOptions, write: (s: string) => void): void {
  for (const line of lines) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) continue;
    let rendered: string[];
    try {
      rendered = renderEvent(event as Record<string, any>, { truncateText: opts.truncateText });
    } catch {
      continue;
    }
    for (const r of rendered) write(r + '\n');
  }
}

export async function runWatch(opts: WatchOptions, deps: WatchDeps): Promise<number> {
  const resolve = () =>
    findSession({ configDir: deps.configDir, projectRoot: opts.projectRoot, sessionId: opts.sessionId });

  const initial = resolve();
  if (!initial.ok) {
    deps.writeErr(`cairn watch: ${initial.error}\n`);
    return 1;
  }
  let sessionDir = initial.sessionDir;
  let current: Follow | null = null;
  const followed = new Set<string>();
  let first = true;

  for (;;) {
    if (!first && opts.sessionId === undefined) {
      const r = resolve();
      if (r.ok && r.sessionDir !== null) sessionDir = r.sessionDir;
    }
    first = false;

    // Drain the current transcript before considering a switch.
    if (current) renderLines(readAppended(current), opts, deps.write);

    if (sessionDir !== null) {
      const list = listAgentTranscripts(sessionDir, { all: opts.all });
      const newest = list.length > 0 ? list[list.length - 1] : undefined;
      if (
        newest &&
        !followed.has(newest.jsonlPath) &&
        (!current || newest.jsonlPath !== current.transcript.jsonlPath)
      ) {
        if (current && current.partial.length > 0) {
          // The old transcript is done; render a final unterminated line if it parses.
          renderLines([current.partial.toString('utf8')], opts, deps.write);
        }
        current = { transcript: newest, offset: 0, partial: Buffer.alloc(0) };
        followed.add(newest.jsonlPath);
        deps.write(watchHeader(newest) + '\n');
        renderLines(readAppended(current), opts, deps.write);
      }
    }

    if (deps.shouldStop()) break;
    await deps.sleep(WATCH_POLL_MS);
  }
  return 0;
}
