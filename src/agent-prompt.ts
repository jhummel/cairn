import { readFileSync, existsSync } from "fs";
import { join } from "path";

export function buildAgentArgs(
  name: string,
  description: string,
  projectRoot: string
): string[] {
  const agentPath = join(projectRoot, ".claude", "agents", `${name}.md`);

  if (!existsSync(agentPath)) {
    throw new Error(
      `Agent definition '${name}' not found at ${agentPath} — run \`ralph init\` to install default agents`
    );
  }

  const prompt = readFileSync(agentPath, "utf-8");

  return [
    "--agents",
    JSON.stringify({ [name]: { description, prompt } }),
    "--agent",
    name,
  ];
}
