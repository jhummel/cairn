import { execSync } from "child_process";

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
