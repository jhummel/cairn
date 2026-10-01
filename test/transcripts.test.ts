import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import {
  projectSlug,
  claudeConfigDir,
  findSession,
  listAgentTranscripts,
  DEFAULT_AGENT_TYPES,
} from "../src/transcripts";

let tmp: string;
const root = "/Users/x/my_repo.v2";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cairn-transcripts-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkSub(session: string, mtimeSec?: number): string {
  const dir = join(tmp, "projects", projectSlug(root), session, "subagents");
  mkdirSync(dir, { recursive: true });
  if (mtimeSec !== undefined) utimesSync(dir, mtimeSec, mtimeSec);
  return dir;
}

function mkAgent(dir: string, id: string, meta: string | null, mtimeSec: number) {
  const j = join(dir, `agent-${id}.jsonl`);
  writeFileSync(j, "{}\n");
  utimesSync(j, mtimeSec, mtimeSec);
  if (meta !== null) writeFileSync(join(dir, `agent-${id}.meta.json`), meta);
}

describe("projectSlug", () => {
  test("replaces non-alphanumerics", () => {
    expect(projectSlug("/Users/jhummel/Documents/_Repos/cairn")).toBe(
      "-Users-jhummel-Documents--Repos-cairn",
    );
    expect(projectSlug("/a/b_c.d")).toBe("-a-b-c-d");
  });
});

describe("claudeConfigDir", () => {
  test("override vs default", () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/x/y" })).toBe("/x/y");
    expect(claudeConfigDir({})).toBe(join(homedir(), ".claude"));
  });
});

describe("findSession", () => {
  test("missing projects dir names path", () => {
    const r = findSession({ configDir: tmp, projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(join(tmp, "projects"));
  });

  test("missing slug dir names path", () => {
    mkdirSync(join(tmp, "projects"));
    const r = findSession({ configDir: tmp, projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(join(tmp, "projects", projectSlug(root)));
  });

  test("no subagents yet -> null", () => {
    mkdirSync(join(tmp, "projects", projectSlug(root), "s1"), { recursive: true });
    expect(findSession({ configDir: tmp, projectRoot: root })).toEqual({ ok: true, sessionDir: null });
  });

  test("newest subagents mtime wins", () => {
    mkSub("old", 1000);
    const n = mkSub("new", 2000);
    const r = findSession({ configDir: tmp, projectRoot: root });
    expect(r).toEqual({ ok: true, sessionDir: join(n, "..") });
  });

  test("explicit sessionId and missing one", () => {
    mkSub("old", 1000);
    mkSub("new", 2000);
    const r = findSession({ configDir: tmp, projectRoot: root, sessionId: "old" });
    expect(r.ok && r.sessionDir).toContain("old");
    const bad = findSession({ configDir: tmp, projectRoot: root, sessionId: "nope" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain(join("nope", "subagents"));
  });
});

describe("listAgentTranscripts", () => {
  test("filters, sorts, handles bad meta", () => {
    const dir = mkSub("s");
    mkAgent(dir, "b", '{"agentType":"post-task-reviewer","description":"Review"}', 200);
    mkAgent(dir, "a", '{"agentType":"cairn-task-agent","description":"Task"}', 100);
    mkAgent(dir, "c", '{"agentType":"Explore"}', 150);
    mkAgent(dir, "d", null, 120);
    mkAgent(dir, "e", "{not json", 130);
    const session = join(dir, "..");
    const def = listAgentTranscripts(session);
    expect(def.map((t) => t.id)).toEqual(["a", "b"]);
    expect(def[0].description).toBe("Task");
    expect(def[0].jsonlPath).toBe(join(dir, "agent-a.jsonl"));
    expect(def[0].metaPath).toBe(join(dir, "agent-a.meta.json"));
    const all = listAgentTranscripts(session, { all: true });
    expect(all.map((t) => t.id)).toEqual(["a", "d", "e", "c", "b"]);
    expect(all[1].agentType).toBeUndefined();
    expect(all[2].agentType).toBeUndefined();
    expect(DEFAULT_AGENT_TYPES).toEqual(["cairn-task-agent", "post-task-reviewer"]);
  });
});
