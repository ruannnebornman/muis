import { describe, expect, it } from "vitest";
import { bellAction, configFromJSON, defaultConfig, effectiveFontSize } from "./config";

describe("AppConfig", () => {
  it("defaults to sessions shown, side tabs, system font", () => {
    expect(defaultConfig()).toEqual({
      showSessions: true,
      tabsOnTop: false,
      fontSize: null,
      theme: null,
      agentCommand: "opencode",
      agentResumeCommand: "opencode --continue",
      scrollback: 50000,
      keybindings: {},
      copyOnSelect: false,
      middleClickPaste: false,
      fontFamily: null,
      cursorStyle: "block",
      cursorBlink: true,
      bell: "none",
    });
    expect(configFromJSON("")).toEqual(defaultConfig());
  });

  it("reads cursor/font/bell settings and rejects junk", () => {
    const cfg = configFromJSON(
      '{"fontFamily":"JetBrains Mono","cursorStyle":"bar","cursorBlink":false,"bell":"visual"}',
    );
    expect(cfg.fontFamily).toBe("JetBrains Mono");
    expect(cfg.cursorStyle).toBe("bar");
    expect(cfg.cursorBlink).toBe(false);
    expect(cfg.bell).toBe("visual");
    expect(configFromJSON('{"cursorStyle":"nope","bell":"loud"}').cursorStyle).toBe("block");
    expect(configFromJSON('{"bell":"loud"}').bell).toBe("none");
  });

  it("maps bell modes to actions", () => {
    expect(bellAction("both")).toEqual({ visual: true, audible: true });
    expect(bellAction("none")).toEqual({ visual: false, audible: false });
    expect(bellAction("visual")).toEqual({ visual: true, audible: false });
    expect(bellAction("audible")).toEqual({ visual: false, audible: true });
  });

  it("reads the clipboard modes", () => {
    const cfg = configFromJSON('{"copyOnSelect":true,"middleClickPaste":true}');
    expect(cfg.copyOnSelect).toBe(true);
    expect(cfg.middleClickPaste).toBe(true);
    expect(configFromJSON('{"copyOnSelect":"yes"}').copyOnSelect).toBe(false);
  });

  it("keeps string keybindings and drops junk", () => {
    expect(configFromJSON('{"keybindings":{"close-tab":"ctrl+q","x":5}}').keybindings).toEqual({
      "close-tab": "ctrl+q",
    });
    expect(configFromJSON('{"keybindings":"nope"}').keybindings).toEqual({});
  });

  it("clamps the scrollback limit", () => {
    expect(configFromJSON('{"scrollback":100}').scrollback).toBe(1000);
    expect(configFromJSON('{"scrollback":999999}').scrollback).toBe(500000);
    expect(configFromJSON('{"scrollback":20000}').scrollback).toBe(20000);
    expect(configFromJSON('{"scrollback":"lots"}').scrollback).toBe(50000);
  });

  it("loads what it saves", () => {
    const cfg = {
      showSessions: false,
      tabsOnTop: true,
      fontSize: 13,
      theme: "nord",
      agentCommand: "aider",
      agentResumeCommand: "aider --resume",
      scrollback: 20000,
      keybindings: { "close-tab": "ctrl+q" },
      copyOnSelect: true,
      middleClickPaste: true,
      fontFamily: "Fira Code",
      cursorStyle: "bar",
      cursorBlink: false,
      bell: "both",
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
