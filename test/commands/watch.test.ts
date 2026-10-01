import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { projectSlug } from "../../src/transcripts";
import { runWatch, type WatchDeps } from "../../src/commands/watch";

let tmp: string;
const root = "/Users/x/watch-proj";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cairn-watch-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function subDir(session: string, mtimeSec?: number): string {
  const dir = join(tmp, "projects", projectSlug(root), session, "subagents");
  mkdirSync(dir, { recursive: true });
  if (mtimeSec !== undefined) utimesSync(dir, mtimeSec, mtimeSec);
  return dir;
}

function agent(
  dir: string,
  id: string,
  agentType: string,
  description: string | undefined,
  content: string,
  mtimeSec: number,
): string {
  const j = join(dir, `agent-${id}.jsonl`);
  writeFileSync(j, content);
  utimesSync(j, mtimeSec, mtimeSec);
  const meta: Record<string, string> = { agentType };
  if (description !== undefined) meta.description = description;
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
  return j;
}

function text(t: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } }) + "\n";
}

/**
 * Harness: runs `polls` polls. `between[i]` runs during the i-th sleep
 * (i.e. after poll i, before poll i+1).
 */
async function harness(
  opts: { sessionId?: string; all?: boolean },
  polls: number,
  between: Array<() => void> = [],
) {
  let out = "";
  let err = "";
  let count = 0;
  let sleeps = 0;
  const deps: WatchDeps = {
    configDir: tmp,
    sleep: async () => {
      const fn = between[sleeps++];
      if (fn) fn();
    },
    write: (s) => {
      out += s;
    },
    writeErr: (s) => {
      err += s;
    },
    shouldStop: () => ++count >= polls,
  };
  const code = await runWatch({ projectRoot: root, truncateText: false, ...opts }, deps);
  // strip ANSI
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  return { code, out: plain, err };
}

describe("runWatch", () => {
  test("replay then follow: existing then appended lines rendered exactly once", async () => {
    const dir = subDir("s1");
    const j = agent(dir, "a1", "cairn-task-agent", "Task #1", text("first") + text("second"), 1000);
    const r = await harness({}, 3, [() => appendFileSync(j, text("third"))]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toBe(
      "── Task #1 · cairn-task-agent ──\n  first\n  second\n  third\n",
    );
  });

  test("partial trailing line is held until complete", async () => {
    const dir = subDir("s1");
    const full = text("partial-done");
    const j = agent(dir, "a1", "cairn-task-agent", "Task #1", full.slice(0, 10), 1000);
    const seen: string[] = [];
    let out = "";
    let count = 0;
    let sleeps = 0;
    const code = await runWatch(
      { projectRoot: root, truncateText: false },
      {
        configDir: tmp,
        sleep: async () => {
          seen.push(out);
          if (sleeps++ === 0) appendFileSync(j, full.slice(10));
        },
        write: (s) => {
          out += s;
        },
        writeErr: () => {},
        shouldStop: () => ++count >= 2,
      },
    );
    expect(code).toBe(0);
    expect(seen[0]).not.toContain("partial-done");
    expect(out).toContain("partial-done");
    expect(out.match(/partial-done/g)!.length).toBe(1);
  });

  test("unparseable line is skipped", async () => {
    const dir = subDir("s1");
    agent(dir, "a1", "cairn-task-agent", "Task #1", text("one") + "{not json\n" + text("two"), 1000);
    const r = await harness({}, 1);
    expect(r.out).toBe("── Task #1 · cairn-task-agent ──\n  one\n  two\n");
  });

  test("switching: newer matching transcript -> drain, header, replay", async () => {
    const dir = subDir("s1");
    const j1 = agent(dir, "a1", "cairn-task-agent", "Task #1", text("old"), 1000);
    const r = await harness({}, 3, [
      () => {
        appendFileSync(j1, text("old-tail"));
        utimesSync(j1, 1500, 1500);
        agent(dir, "a2", "post-task-reviewer", "Review #1", text("new"), 2000);
      },
    ]);
    expect(r.out).toBe(
      "── Task #1 · cairn-task-agent ──\n  old\n  old-tail\n" +
        "── Review #1 · post-task-reviewer ──\n  new\n",
    );
  });

  test("header falls back to agent id without description", async () => {
    const dir = subDir("s1");
    agent(dir, "abc", "cairn-task-agent", undefined, text("x"), 1000);
    const r = await harness({}, 1);
    expect(r.out).toBe("── abc · cairn-task-agent ──\n  x\n");
  });

  test("filter: Explore/general-purpose ignored by default, shown with --all", async () => {
    const dir = subDir("s1");
    agent(dir, "e1", "Explore", "Look around", text("explore"), 1000);
    agent(dir, "g1", "general-purpose", "General", text("general"), 2000);
    const def = await harness({}, 2);
    expect(def.out).toBe("");
    expect(def.err).toBe("");
    const all = await harness({ all: true }, 2);
    expect(all.out).toBe("── General · general-purpose ──\n  general\n");
  });

  test("missing projects dir -> error naming path, exit 1", async () => {
    const r = await harness({}, 5);
    expect(r.code).toBe(1);
    expect(r.err).toContain(join(tmp, "projects"));
    expect(r.out).toBe("");
  });

  test("missing slug dir -> error naming path, exit 1", async () => {
    mkdirSync(join(tmp, "projects"), { recursive: true });
    const r = await harness({}, 5);
    expect(r.code).toBe(1);
    expect(r.err).toContain(join(tmp, "projects", projectSlug(root)));
  });

  test("no subagents yet -> no output, no error, then picks one up", async () => {
    mkdirSync(join(tmp, "projects", projectSlug(root)), { recursive: true });
    const quiet = await harness({}, 3);
    expect(quiet.code).toBe(0);
    expect(quiet.out).toBe("");
    expect(quiet.err).toBe("");

    const r = await harness({}, 3, [
      () => {},
      () => agent(subDir("s9"), "a1", "cairn-task-agent", "Task #9", text("late"), 1000),
    ]);
    expect(r.out).toBe("── Task #9 · cairn-task-agent ──\n  late\n");
  });

  test("--session pins the session", async () => {
    const d1 = subDir("old-session", 1000);
    agent(d1, "a1", "cairn-task-agent", "Pinned", text("pinned"), 1000);
    const d2 = subDir("new-session", 5000);
    agent(d2, "a2", "cairn-task-agent", "Newest", text("newest"), 5000);

    const pinned = await harness({ sessionId: "old-session" }, 2);
    expect(pinned.out).toBe("── Pinned · cairn-task-agent ──\n  pinned\n");

    const latest = await harness({}, 2);
    expect(latest.out).toBe("── Newest · cairn-task-agent ──\n  newest\n");
  });

  test("--session for a session with no subagents yet waits quietly, then picks one up", async () => {
    const slugDir = join(tmp, "projects", projectSlug(root));
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "fresh.jsonl"), "{}\n");
    const r = await harness({ sessionId: "fresh" }, 3, [
      () => {},
      () => agent(subDir("fresh"), "a1", "cairn-task-agent", "Task #1", text("late"), 1000),
    ]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toBe("── Task #1 · cairn-task-agent ──\n  late\n");
  });

  test("--session for an unknown session -> error naming path, exit 1", async () => {
    mkdirSync(join(tmp, "projects", projectSlug(root)), { recursive: true });
    const r = await harness({ sessionId: "nope" }, 3);
    expect(r.code).toBe(1);
    expect(r.err).toContain(join(tmp, "projects", projectSlug(root), "nope"));
  });
});
