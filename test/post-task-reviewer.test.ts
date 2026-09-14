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
import { BRAND } from "../src/brand";

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
      reviewFilePath: "/abs/proj/.cairn/reviews/round-3.md",
    });
    expect(prompt).toContain("/abs/proj/.cairn/reviews/round-3.md");
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

  test("renders the test summary in a do-not-re-run Test Validation section", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      testSummary: "bun test: passed (12 pass, 0 fail) [900ms]\nFull output: /p/.cairn/.cairn_task_42_tests.log",
    });
    expect(prompt).toContain("## Test Validation (already run by cairn — do not re-run)");
    expect(prompt).toContain("bun test: passed (12 pass, 0 fail) [900ms]");
    expect(prompt).toContain("Full output: /p/.cairn/.cairn_task_42_tests.log");
  });

  test("omits the Test Validation section when no summary is passed", () => {
    const prompt = buildPostTaskReviewUserPrompt({ task: sampleTask, diff: "", log: "", files: [] });
    expect(prompt).not.toContain("## Test Validation");
  });

  test("diff-range variant omits the embedded diff and names the range commands", () => {
    const prompt = buildPostTaskReviewUserPrompt({
      task: sampleTask,
      diffRange: "abc123..HEAD",
      reviewFilePath: "/abs/proj/.cairn/reviews/round-3.md",
    });
    expect(prompt).not.toContain("```diff");
    expect(prompt).not.toContain("## Git Diff");
    expect(prompt).toContain("git diff abc123..HEAD");
    expect(prompt).toContain("git log --oneline abc123..HEAD");
    expect(prompt).toContain("git diff --name-only abc123..HEAD");
    expect(prompt).toContain("**Task #42: My awesome task**");
    expect(prompt).toContain("/abs/proj/.cairn/reviews/round-3.md");
  });

  test("embedded variant still renders the diff block", () => {
    const prompt = buildPostTaskReviewUserPrompt({ task: sampleTask, diff: "+x", log: "", files: [] });
    expect(prompt).toContain("## Git Diff");
    expect(prompt).toContain("```diff\n+x\n```");
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

  const GIT_RULES =
    "Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*),Bash(git rev-parse:*)";

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
      dataDir: join(spawnTmpDir, ".cairn"),
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
      `Read,Glob,Grep,Edit(/${spawnTmpDir}/.cairn/reviews/**),Write(/${spawnTmpDir}/.cairn/reviews/**),` +
        `${GIT_RULES}`
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
      `Read,Glob,Grep,Edit(${rule}),Write(${rule}),${GIT_RULES}`
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

  test("allowlist rule follows the actual dataDir even when it diverges from projectRoot/BRAND.dataDir", async () => {
    // Simulates a nested project (findProjectRoot walked upward to an ancestor)
    // or a CAIRN_PROJECT_ROOT override: the resolved dataDir does NOT live at
    // `${projectRoot}/${BRAND.dataDir}`. If the allowlist rule were ever built
    // from a hardcoded `${projectRoot}/${BRAND.dataDir}` guess instead of the
    // caller's resolved dataDir, it would name a different directory than the
    // one the prompt tells the reviewer to write to — every Edit/Write would
    // then be silently denied.
    const child = createMockChild();
    let spawnArgs: string[] = [];
    let stdinData = "";
    const mockSpawn = (_cmd: string, args: string[]) => {
      spawnArgs = args;
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };
    child.stdin.on("data", (chunk: Buffer) => {
      stdinData += chunk.toString();
    });

    const dataDir = join(spawnTmpDir, "nested", "actual-project", BRAND.dataDir);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "state.json"), JSON.stringify({ round: 3 }));

    await spawnPostTaskReviewer({
      projectRoot: spawnTmpDir,
      dataDir,
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    const wrongHardcodedRule = `/${join(spawnTmpDir, BRAND.dataDir)}/reviews/**`;
    const allowed = spawnArgs[spawnArgs.indexOf("--allowedTools") + 1];

    expect(allowed).not.toContain(wrongHardcodedRule);
    expect(allowed).toContain(`/${join(dataDir, "reviews")}/**`);
    expect(stdinData).toContain(join(dataDir, "reviews", "round-3.md"));
  });

  describe("Bash allowlist rules", () => {
    async function captureAllowedTools(tests?: string[]): Promise<string> {
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
        task: { ...sampleTask, tests },
        diff: "",
        log: "",
        files: [],
        deps: { spawn: mockSpawn, processStreamFn: async () => {} },
      });

      return spawnArgs[spawnArgs.indexOf("--allowedTools") + 1]!;
    }

    test("grants the enumerated read-only git subcommands", async () => {
      const allowed = await captureAllowedTools(["bun test"]);
      expect(allowed).toContain("Bash(git diff:*)");
      expect(allowed).toContain("Bash(git log:*)");
      expect(allowed).toContain("Bash(git show:*)");
      expect(allowed).toContain("Bash(git status:*)");
      expect(allowed).toContain("Bash(git rev-parse:*)");
    });

    test("never grants blanket git access", async () => {
      const allowed = await captureAllowedTools(["bun test"]);
      // Bash(git:*) would authorize git commit / git push / git reset.
      expect(allowed).not.toContain("Bash(git:*)");
      expect(allowed).not.toContain("Bash(git commit");
      expect(allowed).not.toContain("Bash(git push");
      expect(allowed).not.toContain("Bash(git reset");
    });

    // cairn validates tests before the review, so the reviewer never re-runs
    // them: the declared test commands must not reach the grant.
    test("grants no rule for any declared test command", async () => {
      const allowed = await captureAllowedTools([
        "bun test test/foo.test.ts",
        "npx tsc -p tsconfig.json",
        "cd services/api && bun test",
        "make build || make clean",
      ]);
      const rule = `/${spawnTmpDir}/.cairn/reviews/**`;
      expect(allowed).toBe(`Read,Glob,Grep,Edit(${rule}),Write(${rule}),${GIT_RULES}`);
      for (const fragment of ["bun test", "npx tsc", "cd services/api", "make build", "make clean"]) {
        expect(allowed).not.toContain(fragment);
      }
    });

    test("the grant is identical whether tests is absent, empty, or populated", async () => {
      const absent = await captureAllowedTools(undefined);
      expect(await captureAllowedTools([])).toBe(absent);
      expect(await captureAllowedTools(["bun test", "lint; typecheck"])).toBe(absent);
    });

    test("every Bash rule is a read-only git inspection rule", async () => {
      const allowed = await captureAllowedTools(["bun test"]);
      const bashRules = allowed.split(",").filter((r) => r.startsWith("Bash("));
      expect(bashRules).toEqual(GIT_RULES.split(","));
    });
  });

  describe("regression: no cairn task access, Edit/Write scoped to reviews dir", () => {
    // With cairn init no longer seeding project-wide `deny` rules for `cairn
    // task` subcommands (see CLAUDE.md), containment of the reviewer rests
    // entirely on this --allowedTools construction plus headless claude -p's
    // deny-by-default for un-allowlisted side effects. If a future change to
    // GIT_INSPECTION_RULES/the allowedTools array ever
    // widens the reviewer's Bash grants to include a `cairn` invocation, this
    // must fail immediately.
    test("--allowedTools grants no cairn task access and no Bash(cairn prefix at all", async () => {
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

      const allowed = spawnArgs[spawnArgs.indexOf("--allowedTools") + 1]!;
      expect(allowed).not.toContain("cairn task");
      expect(allowed).not.toContain("Bash(cairn");
    });

    test("Edit/Write grants are scoped to the reviews directory, not a blanket grant", async () => {
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

      const allowed = spawnArgs[spawnArgs.indexOf("--allowedTools") + 1]!;
      const reviewsRule = `/${spawnTmpDir}/.cairn/reviews/**`;
      expect(allowed).toContain(`Edit(${reviewsRule})`);
      expect(allowed).toContain(`Write(${reviewsRule})`);
      // No unscoped Edit/Write grant (e.g. bare "Edit" or "Write", or a grant
      // covering tasks.json / the project root) is present.
      expect(allowed).not.toContain("Edit,");
      expect(allowed).not.toContain("Write,");
      expect(allowed.split(",")).not.toContain("Edit");
      expect(allowed.split(",")).not.toContain("Write");
      expect(allowed).not.toContain("tasks.json");
      for (const rule of allowed.split(",")) {
        if (rule.startsWith("Edit(") || rule.startsWith("Write(")) {
          expect(rule).toContain("/reviews/");
        }
      }
    });
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
      dataDir: join(spawnTmpDir, ".cairn"),
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
      dataDir: join(spawnTmpDir, ".cairn"),
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

  test("writes the test summary to stdin when one is passed", async () => {
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
      dataDir: join(spawnTmpDir, ".cairn"),
      task: sampleTask,
      diff: "the diff",
      log: "",
      files: [],
      testSummary: "bun test: passed [5ms]",
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(stdinData).toContain("## Test Validation (already run by cairn — do not re-run)");
    expect(stdinData).toContain("bun test: passed [5ms]");
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
      dataDir: join(spawnTmpDir, ".cairn"),
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
      dataDir: join(spawnTmpDir, ".cairn"),
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
      dataDir: join(spawnTmpDir, ".cairn"),
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
      dataDir: join(spawnTmpDir, ".cairn"),
      task: sampleTask,
      diff: "",
      log: "",
      files: [],
      deps: { spawn: mockSpawn, processStreamFn: async () => {} },
    });

    expect(spawnOpts.cwd).toBe(spawnTmpDir);
  });

  test("creates .cairn/reviews/ directory when missing", async () => {
    const child = createMockChild();
    const mockSpawn = () => {
      setTimeout(() => child.emit("close", 0), 10);
      return child as any;
    };

    const dataDir = join(spawnTmpDir, ".cairn");
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

    const dataDir = join(spawnTmpDir, ".cairn");
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

    expect(stdinData).toContain(".cairn/reviews/round-1.md");
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

    const dataDir = join(spawnTmpDir, ".cairn");
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

    expect(stdinData).toContain(".cairn/reviews/round-4.md");
  });
});

describe("agents/post-task-reviewer.md", () => {
  const content = readFileSync(join(import.meta.dir, "..", "agents", "post-task-reviewer.md"), "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = match?.[1] ?? "";
  const body = match?.[2] ?? "";

  test("frontmatter restricts tools and caps turns", () => {
    expect(frontmatter.split("\n")).toContain("tools: Read, Grep, Glob, Bash, Edit, Write");
    expect(frontmatter.split("\n")).toContain("maxTurns: 50");
  });

  test("body no longer tells the reviewer to run the declared tests", () => {
    expect(body).not.toMatch(/run the task's declared test commands/i);
    expect(body).not.toContain("Expected Tests");
    expect(body).toContain("Test Validation");
    expect(body).toMatch(/already run by cairn/i);
  });

  test("body keeps git inspection guidance and the review output template", () => {
    expect(body).toContain("git show");
    expect(body).toContain("### Coverage");
    expect(body).toContain("### Verdict");
  });

  test("body requires a single-line final response", () => {
    expect(body).toContain("`PASS`");
    expect(body).toContain("`CONCERNS: <n>, see <review file path>`");
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
      dataDir: "/fake/.cairn",
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
      dataDir: "/fake/.cairn",
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
      dataDir: "/fake/.cairn",
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
      dataDir: "/fake/.cairn",
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
      dataDir: "/fake/.cairn",
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
      dataDir: "/proj/.cairn",
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
    expect(spawnerArgs.dataDir).toBe("/proj/.cairn");
    expect(spawnerArgs.task).toBe(task);
    expect(spawnerArgs.diff).toBe("the diff");
    expect(spawnerArgs.log).toBe("the log");
    expect(spawnerArgs.files).toEqual(["a.ts"]);
    expect(spawnerArgs.testSummary).toBeUndefined();
  });

  test("threads the test summary through to spawnPostTaskReviewer", async () => {
    let spawnerArgs: any;
    const { deps } = makeDeps({
      spawnPostTaskReviewer: async (opts: any) => {
        spawnerArgs = opts;
        return { exitCode: 0 };
      },
    });

    await runPostTaskReview({
      projectRoot: "/proj",
      dataDir: "/proj/.cairn",
      task: makeTask(),
      taskStatus: "complete",
      beforeSha: "beforesha111",
      config: makeConfig(),
      testSummary: "bun test: passed [5ms]",
      deps,
    });

    expect(spawnerArgs.testSummary).toBe("bun test: passed [5ms]");
  });

  test("catches and logs errors without throwing", async () => {
    const { deps, logs } = makeDeps({
      captureGitSha: () => "differentsha",
      getGitDiff: () => { throw new Error("git exploded"); },
    });

    // Should not throw
    await runPostTaskReview({
      projectRoot: "/fake",
      dataDir: "/fake/.cairn",
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
      dataDir: "/fake/.cairn",
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
