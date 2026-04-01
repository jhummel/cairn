import { execSync, spawn as nodeSpawn, type ChildProcess } from "child_process";
import type { Readable, Writable } from "stream";
import {
  processStream,
  type ProcessStreamOptions,
} from "./stream-filter";
import { buildAgentArgs } from "./agent-prompt";
import type { Task } from "./types";
import type { RalphConfig } from "./types";

export function buildPostTaskReviewUserPrompt(opts: {
  task: {
    id: number;
    title: string;
    description: string;
    files?: string[];
    tests?: string[];
    directory?: string;
  };
  diff: string;
  log: string;
  files: string[];
}): string {
  const { task, diff, log, files } = opts;
  const filesList = task.files?.length ? task.files.join("\n") : "(none specified)";
  const testsList = task.tests?.length ? task.tests.join("\n") : "(none specified)";
  const changedFiles = files.length ? files.join("\n") : "(no files changed)";

  return `## Task Under Review

**Task #${task.id}: ${task.title}**
${task.directory ? `Directory: ${task.directory}` : ""}

### Description
${task.description}

### Expected Files
${filesList}

### Expected Tests
${testsList}

---

## Git Log (since task started)
${log || "(no commits)"}

## Changed Files
${changedFiles}

## Git Diff
\`\`\`diff
${diff || "(empty diff)"}
\`\`\`

---

Please review the above and append your findings to \`.ralph/review-post.md\` using the format specified in your system prompt.
`;
}

export function captureGitSha(projectRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot }).toString().trim();
  } catch {
    return null;
  }
}

type SpawnerSpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined>; stdio: any[] },
) => ChildProcess;

type SpawnerProcessStreamFn = (
  input: Readable,
  output: Writable,
  options?: ProcessStreamOptions,
) => Promise<void>;

export interface SpawnPostTaskReviewerOpts {
  projectRoot: string;
  dataDir: string;
  task: {
    id: number;
    title: string;
    description: string;
    files?: string[];
    tests?: string[];
    directory?: string;
  };
  diff: string;
  log: string;
  files: string[];
  streamOpts?: ProcessStreamOptions;
  deps?: {
    spawn?: SpawnerSpawnFn;
    processStreamFn?: SpawnerProcessStreamFn;
  };
}

export async function spawnPostTaskReviewer(
  opts: SpawnPostTaskReviewerOpts
): Promise<{ exitCode: number }> {
  const { projectRoot, task, diff, log, files, streamOpts, deps } = opts;

  const doSpawn: SpawnerSpawnFn = deps?.spawn ?? (nodeSpawn as any);
  const doProcessStream: SpawnerProcessStreamFn =
    deps?.processStreamFn ?? processStream;

  const env = { ...process.env, ANTHROPIC_API_KEY: "" };

  const userPrompt = buildPostTaskReviewUserPrompt({ task, diff, log, files });

  const args = [
    "-p",
    ...buildAgentArgs("post-task-reviewer", "Sr. Dev code reviewer", projectRoot),
    "--allowedTools",
    "Read,Glob,Grep,Edit,Write",
    "--output-format",
    "stream-json",
    "--model",
    "sonnet",
    "--verbose",
  ];

  const child = doSpawn("claude", args, {
    cwd: projectRoot,
    env,
    stdio: ["pipe", "pipe", "inherit"],
  });

  child.stdin!.write(userPrompt);
  child.stdin!.end();

  const streamPromise = doProcessStream(
    child.stdout!,
    process.stdout,
    streamOpts
  );

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code: number | null) => {
      resolve(code ?? 1);
    });
  });

  await streamPromise.catch(() => {});

  return { exitCode };
}

export function getGitDiff(
  projectRoot: string,
  beforeSha: string
): { diff: string; log: string; files: string[] } {
  const range = `${beforeSha}..HEAD`;
  const opts = { cwd: projectRoot };

  const diff = execSync(`git diff ${range}`, opts).toString().trim();
  const log = execSync(`git log --oneline ${range}`, opts).toString().trim();
  const filesRaw = execSync(`git diff --name-only ${range}`, opts).toString().trim();
  const files = filesRaw.split("\n").filter((f) => f.trim().length > 0);

  return { diff, log, files };
}

export interface RunPostTaskReviewOpts {
  projectRoot: string;
  dataDir: string;
  task: Task;
  taskStatus: string;
  beforeSha: string | null;
  config: RalphConfig;
  streamOpts?: ProcessStreamOptions;
  deps?: {
    captureGitSha?: typeof captureGitSha;
    getGitDiff?: typeof getGitDiff;
    spawnPostTaskReviewer?: typeof spawnPostTaskReviewer;
    log?: (...args: any[]) => void;
  };
}

export async function runPostTaskReview(opts: RunPostTaskReviewOpts): Promise<void> {
  const {
    projectRoot,
    dataDir,
    task,
    taskStatus,
    beforeSha,
    config,
    streamOpts,
    deps,
  } = opts;

  const log = deps?.log ?? console.log;
  const getSha = deps?.captureGitSha ?? captureGitSha;
  const getDiff = deps?.getGitDiff ?? getGitDiff;
  const spawnReviewer = deps?.spawnPostTaskReviewer ?? spawnPostTaskReviewer;

  try {
    if (!config.review?.postTask) {
      log("[review] Post-task review disabled in config");
      return;
    }

    if (taskStatus !== "complete") {
      log(`[review] Task #${task.id} not complete (status: ${taskStatus}), skipping review`);
      return;
    }

    if (beforeSha === null) {
      log(`[review] No beforeSha available, skipping review`);
      return;
    }

    const currentSha = getSha(projectRoot);
    if (currentSha === beforeSha) {
      log(`[review] Task #${task.id}: no commits made, skipping review`);
      return;
    }

    log(`[review] Starting post-task review for Task #${task.id}: ${task.title}`);

    const { diff, log: gitLog, files } = getDiff(projectRoot, beforeSha);

    await spawnReviewer({
      projectRoot,
      dataDir,
      task,
      diff,
      log: gitLog,
      files,
      streamOpts,
    });

    log(`[review] Post-task review complete for Task #${task.id}`);
  } catch (err: any) {
    log(`[review] Error during post-task review: ${err.message}`);
  }
}
