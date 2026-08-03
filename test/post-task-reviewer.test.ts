import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import {
  captureGitSha,
  getGitDiff,
  buildPostTaskReviewUserPrompt,
  spawnPostTaskReviewer,
  runPostTaskReview,
} from "../src/post-task-reviewer";
import type { Task } from "../src/types";
import type { CairnConfig } from "../src/types";

let tmpDir: string;

function gitInit(dir: string) {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, message: string) {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "pipe" });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cairn-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("captureGitSha", () => {
  test("returns a valid 40-char hex SHA for a git repo", () => {
    gitInit(tmpDir);
    writeFileSync(join(tmpDir, "README.md"), "hello");
    gitCommit(tmpDir, "initial commit");

    const sha = captureGitSha(tmpDir);
    expect(sha).not.toBeNull();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("returns null for a non-git directory", () => {
    const sha = captureGitSha(tmpDir);
    expect(sha).toBeNull();
  });
});

describe("getGitDiff", () => {
  test("returns correct diff, log, and files after a commit", () => {
    gitInit(tmpDir);
    writeFileSync(join(tmpDir, "init.txt"), "initial");
    gitCommit(tmpDir, "initial commit");

    const beforeSha = captureGitSha(tmpDir)!;
    expect(beforeSha).not.toBeNull();

    writeFileSync(join(tmpDir, "newfile.ts"), "export const x = 1;");
    gitCommit(tmpDir, "add newfile");

    const result = getGitDiff(tmpDir, beforeSha);

    expect(result.diff).toContain("newfile.ts");
    expect(result.diff).toContain("export const x = 1;");
    expect(result.log).toContain("add newfile");
    expect(result.files).toContain("newfile.ts");
    expect(result.files.every((f) => f.trim().length > 0)).toBe(true);
  });

  test("returns empty diff/log/files when no commits since beforeSha", () => {
    gitInit(tmpDir);
    writeFileSync(join(tmpDir, "init.txt"), "initial");
    gitCommit(tmpDir, "initial commit");

    const sha = captureGitSha(tmpDir)!;
    const result = getGitDiff(tmpDir, sha);

    expect(result.diff).toBe("");
    expect(result.log).toBe("");
    expect(result.files).toEqual([]);
  });
});

describe("buildPostTaskReviewUserPrompt", () => {
  const sampleTask = {
    id: 42,
    title: "My awesome task",
    description: "Do something important",
    files: ["src/foo.ts"],
    tests: ["bun test"],
    directory: "src",
  };

  test("embeds task id and title", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "diff content",
      log: "abc123 commit msg",
      files: ["src/foo.ts"],
    });
    expect(prompt).toContain("42");
    expect(prompt).toContain("My awesome task");
  });

  test("embeds task description", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "diff content",
      log: "abc123 commit msg",
      files: ["src/foo.ts"],
    });
    expect(prompt).toContain("Do something important");
  });

  test("embeds git diff content", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n+export const x = 1;",
      log: "abc123 commit msg",
      files: ["src/foo.ts"],
    });
    expect(prompt).toContain("export const x = 1;");
  });

  test("embeds git log", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "",
      log: "abc123 my commit message",
      files: [],
    });
    expect(prompt).toContain("abc123 my commit message");
  });

  test("embeds changed files list", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "",
      log: "",
      files: ["src/foo.ts", "src/bar.ts"],
    });
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("src/bar.ts");
  });

  test("handles optional task fields being absent", () => {
    const minimalTask = { id: 1, title: "Min task", description: "Minimal" };
    const prompt = buildPostTaskReviewUserPrompt({
      task: minimalTask,
      diff: "",
      log: "",
      files: [],
    });
    expect(prompt).toContain("Min task");
    expect(prompt).toContain("Minimal");
  });

  test("references the injected reviewFilePath and omits review-post.md", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      reviewFilePath: "/abs/proj/.ralph/reviews/round-3.md",
    });
    expect(prompt).toContain("/abs/proj/.ralph/reviews/round-3.md");
    expect(prompt).not.toContain("review-post.md");
  });

  test("includes personal instructions when instructions.md exists in dataDir", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cairn-instr-test-"));
    try {
      writeFileSync(join(dataDir, "instructions.md"), "* Always use TDD");
      const prompt = buildPostTaskReviewUserPrompt({
        task: sampleTask,
        diff: "",
        log: "",
        files: [],
        dataDir,
      });
      expect(prompt).toContain("PERSONAL INSTRUCTIONS:");
      expect(prompt).toContain("* Always use TDD");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("omits personal instructions when instructions.md is missing from dataDir", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cairn-noinstr-test-"));
    try {
      const prompt = buildPostTaskReviewUserPrompt({
        task: sampleTask,
        diff: "",
        log: "",
        files: [],
        dataDir,
      });
      expect(prompt).not.toContain("PERSONAL INSTRUCTIONS:");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("spawnPostTaskReviewer", () => {
  const sampleTask = {
    id: 7,
    title: "Add widget",
    description: "Implement the widget feature",
    files: ["src/widget.ts"],
    tests: ["bun test"],
    directory: "src",
  };

  let spawnTmpDir: string;

  beforeEach(() => {
    spawnTmpDir = mkdtempSync(join(tmpdir(), "cairn-spawn-test-"));
    const agentDir = join(spawnTmpDir, ".claude", "agents");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "post-task-reviewer.md"), "You are a reviewer.");
  });

  afterEach(() => {
    rmSync(spawnTmpDir, { recursive: true, force: true });
  });

  function createMockChild() {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
    };
    child.stdin = stdin;
    child.stdout = stdout;
    return child;
  }

  test("spawns claude with correct args", async () => {
    const child = createMockChild();
    let spawnArgs: any[] = [];
    const mockSpawn = (cmd: string, args: string[], opts: any) => {
      spawnArgs = [cmd, args, opts];
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };
    const mockProcessStream = async () => {};

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "some diff",
      log: "some log",
      files: ["src/widget.ts"],
      deps: { spawn: mockSpawn, processStreamFn: mockProcessStream },
    });

    expect(spawnArgs[0]).toBe("claude");
    const args: string[] = spawnArgs[1];
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args).toContain("--verbose");
    expect(args).toContain("--allowedTools");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(
      `Read,Glob,Grep,Edit(/${spawnTmpDir}/.ralph/reviews/**),Write(/${spawnTmpDir}/.ralph/reviews/**)`
    );
    expect(args).toContain("--agents");
    expect(args).toContain("--agent");
    expect(args[args.indexOf("--agent") + 1]).toBe("post-task-reviewer");
  });

  test("allowlist rule follows the resolved data dir (.cairn/)", async () => {
    const child = createMockChild();
    let spawnArgs: string[] = [];
    const mockSpawn = (_cmd: string, args: string[]) => {
      spawnArgs = args;
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".cairn"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    const rule = `/${spawnTmpDir}/.cairn/reviews/**`;
    expect(spawnArgs[spawnArgs.indexOf("--allowedTools") + 1]).toBe(
      `Read,Glob,Grep,Edit(${rule}),Write(${rule})`
    );
  });

  test("allowlist rule covers the review file the prompt targets", async () => {
    const child = createMockChild();
    let spawnArgs: string[] = [];
    let stdinData = "";
    const mockSpawn = (_cmd: string, args: string[]) => {
      spawnArgs = args;
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };
    const child2 = child;
    child2.stdin.on("data", (chunk: Buffer) => {
      stdinData += chunk.toString();
    });

    const dataDir = join(spawnTmpDir, ".cairn");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "state.json"), JSON.stringify({ round: 7 }));

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir,
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    const allowed = spawnArgs[spawnArgs.indexOf("--allowedTools") + 1];
    // The rule is a directory glob; strip the trailing "**" and confirm the
    // prompt's target path sits underneath it.
    const rulePrefix = allowed
      .replace(/^.*Edit\(/, "")
      .replace(/\/\*\*\).*$/, "")
      .replace(/^\//, "");
    expect(stdinData).toContain(join(dataDir, "reviews", "round-7.md"));
    expect(join(dataDir, "reviews", "round-7.md").startsWith(rulePrefix)).toBe(true);
  });

  test("unsets ANTHROPIC_API_KEY in env", async () => {
    const child = createMockChild();
    let spawnOpts: any;
    const mockSpawn = (_cmd: string, _args: string[], opts: any) => {
      spawnOpts = opts;
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(spawnOpts.env.ANTHROPIC_API_KEY).toBe("");
  });

  test("writes user prompt to stdin", async () => {
    const child = createMockChild();
    let stdinData = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdinData += chunk.toString();
    });

    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "the diff",
      log: "the log",
      files: ["src/widget.ts"],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(stdinData).toContain("Task #7: Add widget");
    expect(stdinData).toContain("the diff");
    expect(stdinData).toContain("the log");
  });

  test("calls processStream on stdout", async () => {
    const child = createMockChild();
    let processStreamCalled = false;
    let processStreamInput: any;

    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };
    const mockProcessStream = async (input: any) => {
      processStreamCalled = true;
      processStreamInput = input;
    };

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: mockProcessStream },
    });

    expect(processStreamCalled).toBe(true);
    expect(processStreamInput).toBe(child.stdout);
  });

  test("returns exit code from child process", async () => {
    const child = createMockChild();
    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 42), 10);
      return child as any;
    };

    const result = await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(result.exitCode).toBe(42);
  });

  test("returns exit code 1 when close code is null", async () => {
    const child = createMockChild();
    const mockSpawn = () => {
      setTimeout(() => child.emit("close", null), 10);
      return child as any;
    };

    const result = await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(result.exitCode).toBe(1);
  });

  test("sets cwd to projectRoot", async () => {
    const child = createMockChild();
    let spawnOpts: any;
    const mockSpawn = (_cmd: string, _args: string[], opts: any) => {
      spawnOpts = opts;
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir: join(spawnTmpDir, ".ralph"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(spawnOpts.cwd).toBe(spawnTmpDir);
  });

  test("creates .ralph/reviews/ directory when missing", async () => {
    const child = createMockChild();
    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    const dataDir = join(spawnTmpDir, ".ralph");
    expect(existsSync(join(dataDir, "reviews"))).toBe(false);

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir,
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(existsSync(join(dataDir, "reviews"))).toBe(true);
  });

  test("prompt targets round-1.md when state.json has no round (lazy seed)", async () => {
    const child = createMockChild();
    let stdinData = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdinData += chunk.toString();
    });
    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    const dataDir = join(spawnTmpDir, ".ralph");
    mkdirSync(dataDir, { recursive: true });
    // No state.json -> round defaults to 1.

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir,
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(stdinData).toContain(".ralph/reviews/round-1.md");
  });

  test("prompt targets round-<N>.md when state.json has round: N", async () => {
    const child = createMockChild();
    let stdinData = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdinData += chunk.toString();
    });
    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    const dataDir = join(spawnTmpDir, ".ralph");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "state.json"), JSON.stringify({ round: 4 }));

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir,
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(stdinData).toContain(".ralph/reviews/round-4.md");
  });
});

describe("runPostTaskReview", () => {
  const makeTask = (overrides?: Partial<Task>): Task => ({
    id: 10,
    priority: 1,
    title: "Test task",
    description: "Do the thing",
    status: "complete",
    files: ["src/foo.ts"],
    tests: ["bun test"],
    ...overrides,
  });

  const makeConfig = (overrides?: Partial<CairnConfig>): CairnConfig => ({
    projectName: "test",
    projectDescription: "test project",
    healthCheck: "bun test",
    defaultTestCommand: "bun test",
    implementationFile: "IMPLEMENTATION.md",
    truncateText: false,
    summarize: { claudeMdPattern: "**/*.md" },
    narration: { enabled: false, voice: "alloy", ntfyTopic: "" },
    review: { maxIterations: 30, postTask: true },
    ...overrides,
  });

  function makeDeps(overrides?: Record<string, any>) {
    const logs: string[] = [];
    return {
      deps: {
        captureGitSha: () => "abc123aftersha",
        getGitDiff: () => ({ diff: "some diff", log: "some log", files: ["src/foo.ts"] }),
        spawnPostTaskReviewer: async () => ({ exitCode: 0 }),
        log: (...args: any[]) => logs.push(args.join(" ")),
        ...overrides,
      },
      logs,
    };
  }

  test("skips when config.review.postTask is false", async () => {
    let spawnerCalled = false;
    const { deps, logs } = makeDeps({
      spawnPostTaskReviewer: async () => { spawnerCalled = true; return { exitCode: 0 }; },
    });

    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask(),
      taskStatus: "complete",
      beforeSha: "sha123",
      config: makeConfig({ review: { maxIterations: 30, postTask: false } }),
      deps,
    });

    expect(spawnerCalled).toBe(false);
    expect(logs.some((l) => l.includes("disabled"))).toBe(true);
  });

  test("skips when config.review is undefined", async () => {
    let spawnerCalled = false;
    const { deps, logs } = makeDeps({
      spawnPostTaskReviewer: async () => { spawnerCalled = true; return { exitCode: 0 }; },
    });

    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask(),
      taskStatus: "complete",
      beforeSha: "sha123",
      config: makeConfig({ review: undefined }),
      deps,
    });

    expect(spawnerCalled).toBe(false);
  });

  test("skips when taskStatus is not complete", async () => {
    let spawnerCalled = false;
    const { deps, logs } = makeDeps({
      spawnPostTaskReviewer: async () => { spawnerCalled = true; return { exitCode: 0 }; },
    });

    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask(),
      taskStatus: "in-progress",
      beforeSha: "sha123",
      config: makeConfig(),
      deps,
    });

    expect(spawnerCalled).toBe(false);
    expect(logs.some((l) => l.includes("not complete"))).toBe(true);
  });

  test("skips when beforeSha is null", async () => {
    let spawnerCalled = false;
    const { deps, logs } = makeDeps({
      spawnPostTaskReviewer: async () => { spawnerCalled = true; return { exitCode: 0 }; },
    });

    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask(),
      taskStatus: "complete",
      beforeSha: null,
      config: makeConfig(),
      deps,
    });

    expect(spawnerCalled).toBe(false);
    expect(logs.some((l) => l.includes("beforeSha"))).toBe(true);
  });

  test("skips when current SHA equals beforeSha (no commits)", async () => {
    let spawnerCalled = false;
    const { deps, logs } = makeDeps({
      captureGitSha: () => "samesha",
      spawnPostTaskReviewer: async () => { spawnerCalled = true; return { exitCode: 0 }; },
    });

    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask(),
      taskStatus: "complete",
      beforeSha: "samesha",
      config: makeConfig(),
      deps,
    });

    expect(spawnerCalled).toBe(false);
    expect(logs.some((l) => l.includes("no commits"))).toBe(true);
  });

  test("happy path calls getGitDiff and spawnPostTaskReviewer with correct args", async () => {
    let diffArgs: any;
    let spawnerArgs: any;
    const { deps } = makeDeps({
      captureGitSha: () => "aftersha999",
      getGitDiff: (root: string, sha: string) => {
        diffArgs = { root, sha };
        return { diff: "the diff", log: "the log", files: ["a.ts"] };
      },
      spawnPostTaskReviewer: async (opts: any) => {
        spawnerArgs = opts;
        return { exitCode: 0 };
      },
    });

    const task = makeTask({ id: 42, title: "My task" });

    await runPostTaskReview({
      projectRoot: "/proj",
      dataDir: "/proj/.ralph",
      task,
      taskStatus: "complete",
      beforeSha: "beforesha111",
      config: makeConfig(),
      deps,
    });

    // getGitDiff called with correct args
    expect(diffArgs.root).toBe("/proj");
    expect(diffArgs.sha).toBe("beforesha111");

    // spawnPostTaskReviewer called with correct args
    expect(spawnerArgs.projectRoot).toBe("/proj");
    expect(spawnerArgs.dataDir).toBe("/proj/.ralph");
    expect(spawnerArgs.task).toBe(task);
    expect(spawnerArgs.diff).toBe("the diff");
    expect(spawnerArgs.log).toBe("the log");
    expect(spawnerArgs.files).toEqual(["a.ts"]);
  });

  test("catches and logs errors without throwing", async () => {
    const { deps, logs } = makeDeps({
      captureGitSha: () => "differentsha",
      getGitDiff: () => { throw new Error("git exploded"); },
    });

    // Should not throw
    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask(),
      taskStatus: "complete",
      beforeSha: "beforesha",
      config: makeConfig(),
      deps,
    });

    expect(logs.some((l) => l.includes("git exploded"))).toBe(true);
  });

  test("logs start and completion messages on happy path", async () => {
    const { deps, logs } = makeDeps({
      captureGitSha: () => "aftersha",
    });

    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.ralph",
      task: makeTask({ id: 5 }),
      taskStatus: "complete",
      beforeSha: "beforesha",
      config: makeConfig(),
      deps,
    });

    expect(logs.some((l) => l.includes("Starting") || l.includes("starting") || l.includes("review"))).toBe(true);
    expect(logs.some((l) => l.includes("complete") || l.includes("finished") || l.includes("done"))).toBe(true);
  });
});
