import { execSync, spawn as nodeSpawn, type ChildProcess } from "child_process";
import { mkdirSync } from "fs";
import * as path from "path";
import type { Readable, Writable } from "stream";
import {
  processStream,
  type ProcessStreamOptions,
} from "./stream-filter";
import { buildAgentArgs } from "./agent-prompt";
import { getRound } from "./task-counter";
import type { Task } from "./types";
import type { CairnConfig } from "./types";
import { loadPersonalInstructions } from "./personal-instructions";
import { GIT_INSPECTION_RULES, buildCommandRules } from "./claude-settings";

// Grant the reviewer exactly what a task declared in `tests` so it can actually
// re-run them. Granting the declared command also covers one-off invocations
// (e.g. `npx tsc -p tsconfig.json`) that a static config-derived rule would miss.
// The rule mechanics — and the read-only git list — are shared with `cairn init`'s
// settings.local.json seeding so the two grants can never drift apart.
function buildTestCommandRules(tests?: string[]): string[] {
  return buildCommandRules(tests ?? []);
}

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
  dataDir?: string;
  reviewFilePath: string;
}): string {
  const { task, diff, log, files, dataDir, reviewFilePath } = opts;
  const personalInstructions = dataDir ? loadPersonalInstructions(dataDir) : "";
  const filesList = task.files?.length ? task.files.join("\n") : "(none specified)";
  const testsList = task.tests?.length ? task.tests.join("\n") : "(none specified)";
  const changedFiles = files.length ? files.join("\n") : "(no files changed)";

  return `${personalInstructions}## Task Under Review

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

Please review the above and append your findings to \`${reviewFilePath}\` using the format specified in your system prompt.
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
  const { projectRoot, dataDir, task, diff, log, files, streamOpts, deps } = opts;

  const doSpawn: SpawnerSpawnFn = deps?.spawn ?? (nodeSpawn as any);
  const doProcessStream: SpawnerProcessStreamFn =
    deps?.processStreamFn ?? processStream;

  const env = { ...process.env, ANTHROPIC_API_KEY: "" };

  // The CLI owns round resolution and path computation — the reviewer agent must
  // never compute the round or target path itself. Pre-plan reviews land in
  // round-1.md (getRound's lazy seed).
  const round = getRound(dataDir);
  // Permission rules need an absolute path, and the caller's dataDir is the
  // ALREADY-RESOLVED data dir. Never rebuild it from a brand constant — see
  // the reviewFileRule note below.
  const absDataDir = path.resolve(projectRoot, dataDir);
  const reviewsDir = path.join(absDataDir, "reviews");
  mkdirSync(reviewsDir, { recursive: true });
  const reviewFilePath = path.join(reviewsDir, `round-${round}.md`);

  const userPrompt = buildPostTaskReviewUserPrompt({ task, diff, log, files, dataDir, reviewFilePath });

  // Permission-rule paths must be absolute (leading "//"). A relative glob like
  // Edit(.cairn/reviews/**) is resolved against the shell's CURRENT working
  // directory at evaluation time — so after the reviewer cd's into a service dir to
  // run tests, the rule no longer matches and every Edit/Write is silently denied
  // in -p mode (observed 2026-07-11: reviews lost or prepended at the top of the file).
  // A directory glob covers every round-<N>.md the reviewer may target.
  //
  // The rule is derived from reviewsDir — the same path the prompt tells the
  // reviewer to write — so the two can never diverge. Hardcoding a directory
  // name here instead (e.g. building the rule from `${projectRoot}/${BRAND.dataDir}`)
  // would silently break whenever the caller's actual dataDir isn't at that
  // guessed location — a nested project whose data dir was found by walking
  // upward from cwd, or a CAIRN_PROJECT_ROOT override pointing elsewhere. In
  // that case the granted glob and the path in the prompt would name genuinely
  // different directories, and every reviewer Edit/Write would be silently
  // denied with no error and no review output.
  const reviewFileRule = `/${reviewsDir}/**`;

  const allowedTools = [
    "Read",
    "Glob",
    "Grep",
    `Edit(${reviewFileRule})`,
    `Write(${reviewFileRule})`,
    ...GIT_INSPECTION_RULES,
    ...buildTestCommandRules(task.tests),
  ].join(",");

  const args = [
    "-p",
    ...buildAgentArgs("post-task-reviewer", "Sr. Dev code reviewer", projectRoot),
    "--allowedTools",
    allowedTools,
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
  config: CairnConfig;
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
