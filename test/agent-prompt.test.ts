import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildAgentArgs } from "../src/agent-prompt";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-agent-prompt-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildAgentArgs", () => {
  test("returns correct args array for existing agent file", () => {
    const agentsDir = join(tmpDir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "my-agent.md"), "# My Agent\nDo stuff.");

    const args = buildAgentArgs("my-agent", "Does stuff", tmpDir);

    expect(args).toHaveLength(4);
    expect(args[0]).toBe("--agents");
    expect(args[2]).toBe("--agent");
    expect(args[3]).toBe("my-agent");
  });

  test("JSON value contains name, description, and prompt", () => {
    const agentsDir = join(tmpDir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "reviewer.md"), "Review the code carefully.");

    const args = buildAgentArgs("reviewer", "Sr. Dev code reviewer", tmpDir);
    const parsed = JSON.parse(args[1]);

    expect(parsed).toEqual({
      reviewer: {
        description: "Sr. Dev code reviewer",
        prompt: "Review the code carefully.",
      },
    });
  });

  test("throws descriptive error when agent file is missing", () => {
    expect(() => buildAgentArgs("missing-agent", "Some agent", tmpDir)).toThrow(
      `Agent definition 'missing-agent' not found at ${join(tmpDir, ".claude", "agents", "missing-agent.md")} — run \`ralph init\` to install default agents`
    );
  });
});
