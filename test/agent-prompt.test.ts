import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildAgentArgs } from "../src/agent-prompt";
import { buildSystemPrompt, type SystemPromptInput } from "../src/commands/run";
import type { AgentInfo, CairnConfig } from "../src/types";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cairn-agent-prompt-test-"));
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
      `Agent definition 'missing-agent' not found at ${join(tmpDir, ".claude", "agents", "missing-agent.md")} — run \`cairn init\` to install default agents`
    );
  });
});

describe("buildSystemPrompt", () => {
  const baseConfig: CairnConfig = {
    projectName: "test-project",
    projectDescription: "",
    healthCheck: "",
    defaultTestCommand: "",
    implementationFile: "",
    truncateText: false,
    summarize: { claudeMdPattern: "" },
  };

  function makeInput(overrides: Partial<SystemPromptInput> = {}): SystemPromptInput {
    return {
      taskDir: "",
      taskAgent: "",
      projectRoot: tmpDir,
      dataDir: tmpDir,
      config: baseConfig,
      agents: [],
      iteration: 1,
      ...overrides,
    };
  }

  test("injects specialist body for a non-internal agent", () => {
    const agentsDir = join(tmpDir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "specialist.md"), "Do the specialist thing.");

    const agents: AgentInfo[] = [
      { name: "specialist", description: "A specialist", model: "sonnet", file: "specialist.md" },
    ];

    const prompt = buildSystemPrompt(makeInput({ taskAgent: "specialist", agents }));

    expect(prompt).toContain("Do the specialist thing.");
    expect(prompt).toContain("SPECIALIST INSTRUCTIONS:");
  });

  test("does NOT inject specialist body for an internal agent, and emits a warning", () => {
    const agentsDir = join(tmpDir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "post-task-reviewer.md"), "---\nname: post-task-reviewer\ninternal: true\n---\nReviewer body text.");

    const agents: AgentInfo[] = [
      { name: "post-task-reviewer", description: "Internal reviewer", model: "sonnet", file: "post-task-reviewer.md", internal: true },
    ];

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const prompt = buildSystemPrompt(makeInput({ taskAgent: "post-task-reviewer", agents }));

      expect(prompt).not.toContain("Reviewer body text.");
      expect(prompt).not.toContain("SPECIALIST INSTRUCTIONS:");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("post-task-reviewer");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
