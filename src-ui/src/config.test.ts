import { describe, expect, it } from "vitest";
import { configFromJSON, defaultConfig, effectiveFontSize } from "./config";

describe("AppConfig", () => {
  it("defaults to sessions shown, side tabs, system font", () => {
    expect(defaultConfig()).toEqual({
      showSessions: true,
      tabsOnTop: false,
      fontSize: null,
      theme: null,
      agentCommand: "opencode",
      agentResumeCommand: "opencode --continue",
    });
    expect(configFromJSON("")).toEqual(defaultConfig());
  });

  it("loads what it saves", () => {
    const cfg = {
      showSessions: false,
      tabsOnTop: true,
      fontSize: 13,
      theme: "nord",
      agentCommand: "aider",
      agentResumeCommand: "aider --resume",
    };
    expect(configFromJSON(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("reads the AI tab commands and falls back on junk", () => {
    expect(configFromJSON('{"agentCommand":"claude"}').agentCommand).toBe("claude");
    expect(configFromJSON("").agentCommand).toBe("opencode");
    expect(configFromJSON('{"agentResumeCommand":"claude -c"}').agentResumeCommand).toBe(
      "claude -c",
    );
    expect(configFromJSON("").agentResumeCommand).toBe("opencode --continue");
  });

  it("ignores corrupt values field by field, never entirely", () => {
    const cfg = configFromJSON('{"showSessions":"yes","tabsOnTop":1,"fontSize":999}');
    expect(cfg).toEqual(defaultConfig());
  });

  it("reads a theme name and ignores junk", () => {
    expect(configFromJSON('{"theme":"nord"}').theme).toBe("nord");
    expect(configFromJSON('{"theme":5}').theme).toBeNull();
    expect(configFromJSON("").theme).toBeNull();
  });

  it("rejects non-JSON outright so corruption is visible", () => {
    expect(() => configFromJSON("{nope")).toThrow();
  });

  it("resolves the effective font size", () => {
    expect(effectiveFontSize(defaultConfig())).toBe(12);
    expect(effectiveFontSize({ ...defaultConfig(), fontSize: 14 })).toBe(14);
  });
});
