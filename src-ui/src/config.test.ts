import { describe, expect, it } from "vitest";
import { configFromJSON, defaultConfig, effectiveFontSize } from "./config";

describe("AppConfig", () => {
  it("defaults to sessions shown, side tabs, system font", () => {
    expect(defaultConfig()).toEqual({ showSessions: true, tabsOnTop: false, fontSize: null });
    expect(configFromJSON("")).toEqual(defaultConfig());
  });

  it("loads what it saves", () => {
    const cfg = { showSessions: false, tabsOnTop: true, fontSize: 13 };
    expect(configFromJSON(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("ignores corrupt values field by field, never entirely", () => {
    const cfg = configFromJSON('{"showSessions":"yes","tabsOnTop":1,"fontSize":999}');
    expect(cfg).toEqual(defaultConfig());
  });

  it("rejects non-JSON outright so corruption is visible", () => {
    expect(() => configFromJSON("{nope")).toThrow();
  });

  it("resolves the effective font size", () => {
    expect(effectiveFontSize(defaultConfig())).toBe(11);
    expect(effectiveFontSize({ ...defaultConfig(), fontSize: 14 })).toBe(14);
  });
});
