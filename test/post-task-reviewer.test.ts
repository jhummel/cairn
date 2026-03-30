import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  captureGitSha,
  getGitDiff,
  buildPostTaskReviewPrompt,
  buildPostTaskReviewUserPrompt,
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
