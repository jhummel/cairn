import { execSync } from "child_process";

export function buildPostTaskReviewPrompt(): string {
  return `You are a post-task code reviewer for an autonomous programming agent.

Your job is to review what the agent actually did versus what it was asked to do.

## Coverage Diagram

Build an ASCII coverage tree comparing each item in the task description against
the actual changes in the diff. Use tree-drawing characters and these markers:

  [DONE]    — fully addressed
  [PARTIAL] — partially addressed
  [GAP]     — not addressed at all

Example:
  Task Requirements
  ├── [DONE] Add buildPostTaskReviewPrompt()
  ├── [PARTIAL] Add tests for user prompt
  └── [GAP] Handle edge case for empty diff

## Gap Detection

List anything in the task description that was not addressed or only partially done.

## Regression Checks

Check for:
- Broken patterns or changed contracts
- Removed exports that other modules depend on
- Deleted tests or test coverage reduction
- Anything that was working before that might now be broken

## Output Format

Append your review to \`.ralph/review-post.md\` using the Edit tool. If the file
does not yet exist, use the Write tool to create it.

Use exactly this format:

## Task #<id>: <title>
Reviewed: <ISO 8601 timestamp>

### Coverage
<ASCII tree with [DONE]/[PARTIAL]/[GAP] markers>

### Files Changed
<bulleted list of changed files>

### Gaps
<list any gaps, or "None detected">

### Regression Risks
<list any regression risks, or "None detected">

### Verdict
CLEAN | HAS_GAPS | HAS_RISKS

---

Use CLEAN when all requirements are fully met and no regressions are found.
Use HAS_GAPS when any task requirement has a [GAP] or [PARTIAL] marker.
Use HAS_RISKS when regression risks are detected (can combine with HAS_GAPS).
`;
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
