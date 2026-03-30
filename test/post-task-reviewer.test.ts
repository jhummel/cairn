import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import {
  captureGitSha,
  getGitDiff,
  buildPostTaskReviewPrompt,
  buildPostTaskReviewUserPrompt,
  spawnPostTaskReviewer,
} from "../src/post-task-reviewer";

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
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-test-"));
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

describe("buildPostTaskReviewPrompt", () => {
  test("contains coverage marker keywords", () => {
    const prompt = buildPostTaskReviewPrompt();
    expect(prompt).toContain("[DONE]");
    expect(prompt).toContain("[GAP]");
    expect(prompt).toContain("[PARTIAL]");
  });

  test("references review-post.md output file", () => {
    const prompt = buildPostTaskReviewPrompt();
    expect(prompt).toContain("review-post.md");
  });

  test("instructs use of Edit tool", () => {
    const prompt = buildPostTaskReviewPrompt();
    expect(prompt).toContain("Edit");
  });

  test("includes verdict keywords", () => {
    const prompt = buildPostTaskReviewPrompt();
    expect(prompt).toContain("CLEAN");
    expect(prompt).toContain("HAS_GAPS");
    expect(prompt).toContain("HAS_RISKS");
  });

  test("includes output format fields", () => {
    const prompt = buildPostTaskReviewPrompt();
    expect(prompt).toContain("Reviewed:");
    expect(prompt).toContain("Files Changed");
    expect(prompt).toContain("Gaps");
    expect(prompt).toContain("Regression Risks");
    expect(prompt).toContain("Verdict");
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
      projectRoot: "/fake/root",
      dataDir: "/fake/root/.ralph",
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
      "Read,Glob,Grep,Edit,Write"
    );
    expect(args).toContain("--append-system-prompt");
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
      projectRoot: "/fake/root",
      dataDir: "/fake/root/.ralph",
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
      projectRoot: "/fake/root",
      dataDir: "/fake/root/.ralph",
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
      projectRoot: "/fake/root",
      dataDir: "/fake/root/.ralph",
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
      projectRoot: "/fake/root",
      dataDir: "/fake/root/.ralph",
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
      projectRoot: "/fake/root",
      dataDir: "/fake/root/.ralph",
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
      projectRoot: "/my/project",
      dataDir: "/my/project/.ralph",
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(spawnOpts.cwd).toBe("/my/project");
  });
});
