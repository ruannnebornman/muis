import { describe, it, expect } from "vitest";
import { agentResumeForCommand } from "./agents";

describe("agentResumeForCommand", () => {
  it("recognises the known TUI agents", () => {
    expect(agentResumeForCommand("opencode")).toBe("opencode --continue");
    expect(agentResumeForCommand("claude")).toBe("claude --continue");
    expect(agentResumeForCommand("codex")).toBe("codex resume --last");
  });

  it("ignores arguments and absolute paths", () => {
    expect(agentResumeForCommand("opencode --model x")).toBe("opencode --continue");
    expect(agentResumeForCommand("/usr/bin/codex resume abc")).toBe("codex resume --last");
  });

  it("skips wrappers and leading assignments", () => {
    expect(agentResumeForCommand("FOO=bar sudo -E claude")).toBe("claude --continue");
    expect(agentResumeForCommand("command codex")).toBe("codex resume --last");
  });

  it("does not match the word inside other commands", () => {
    expect(agentResumeForCommand("cat codex.log")).toBeNull();
    expect(agentResumeForCommand('git commit -m "claude"')).toBeNull();
    expect(agentResumeForCommand("echo opencode")).toBeNull();
  });

  it("handles empty input", () => {
    expect(agentResumeForCommand("")).toBeNull();
    expect(agentResumeForCommand(null)).toBeNull();
    expect(agentResumeForCommand("   ")).toBeNull();
  });
});
