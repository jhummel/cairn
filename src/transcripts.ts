import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Subagent types `cairn watch` follows by default. */
export const DEFAULT_AGENT_TYPES: readonly string[] = ["cairn-task-agent", "post-task-reviewer"];

export interface AgentTranscript {
  id: string;
  jsonlPath: string;
  metaPath: string;
  agentType: string | undefined;
  description: string | undefined;
  mtimeMs: number;
}

export type FindSessionResult =
  | { ok: true; sessionDir: string | null }
  | { ok: false; error: string };

/** Claude Code's project slug: every non-alphanumeric character becomes `-`. */
export function projectSlug(projectRoot: string): string {
  return projectRoot.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function findSession(opts: {
  configDir: string;
  projectRoot: string;
  sessionId?: string;
}): FindSessionResult {
  const projectsDir = path.join(opts.configDir, "projects");
  if (!isDir(projectsDir)) {
    return { ok: false, error: `Claude projects directory not found: ${projectsDir}` };
  }
  const slugDir = path.join(projectsDir, projectSlug(opts.projectRoot));
  if (!isDir(slugDir)) {
    return { ok: false, error: `No Claude Code project directory found at: ${slugDir}` };
  }

  if (opts.sessionId !== undefined) {
    // A plain name only: a pinned id must not resolve outside the slug dir.
    if (!/^[A-Za-z0-9_-]+$/.test(opts.sessionId)) {
      return { ok: false, error: `Invalid session id: ${JSON.stringify(opts.sessionId)}` };
    }
    // Claude Code writes <session>.jsonl from the start but creates <session>/subagents/
    // only when the first subagent launches, so either one means the session exists.
    const sessionDir = path.join(slugDir, opts.sessionId);
    if (!isDir(sessionDir) && !fs.existsSync(`${sessionDir}.jsonl`)) {
      return { ok: false, error: `Session not found: neither ${sessionDir}.jsonl nor ${sessionDir}/ exists` };
    }
    return { ok: true, sessionDir };
  }

  let best: { dir: string; mtime: number } | null = null;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(slugDir);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    const sessionDir = path.join(slugDir, name);
    const sub = path.join(sessionDir, "subagents");
    try {
      const st = fs.statSync(sub);
      if (!st.isDirectory()) continue;
      if (!best || st.mtimeMs > best.mtime) best = { dir: sessionDir, mtime: st.mtimeMs };
    } catch {
      continue;
    }
  }
  return { ok: true, sessionDir: best ? best.dir : null };
}

function readMeta(metaPath: string): { agentType?: string; description?: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (parsed === null || typeof parsed !== "object") return {};
    return {
      agentType: typeof parsed.agentType === "string" ? parsed.agentType : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
    };
  } catch {
    return {};
  }
}

export function listAgentTranscripts(
  sessionDir: string,
  opts: { all?: boolean } = {},
): AgentTranscript[] {
  const subDir = path.join(sessionDir, "subagents");
  let names: string[];
  try {
    names = fs.readdirSync(subDir);
  } catch {
    return [];
  }
  const out: AgentTranscript[] = [];
  for (const name of names) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    const id = m[1];
    const jsonlPath = path.join(subDir, name);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(jsonlPath).mtimeMs;
    } catch {
      continue;
    }
    const metaPath = path.join(subDir, `agent-${id}.meta.json`);
    const meta = readMeta(metaPath);
    if (!opts.all && !(meta.agentType !== undefined && DEFAULT_AGENT_TYPES.includes(meta.agentType))) {
      continue;
    }
    out.push({ id, jsonlPath, metaPath, agentType: meta.agentType, description: meta.description, mtimeMs });
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}
