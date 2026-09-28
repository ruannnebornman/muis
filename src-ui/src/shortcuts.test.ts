import { describe, expect, it } from "vitest";
import { resolveShortcut, type KeyLike } from "./shortcuts";

function key(over: Partial<KeyLike>): KeyLike {
  return { key: "", ctrlKey: false, shiftKey: false, altKey: false, ...over };
}

describe("resolveShortcut", () => {
  it("maps tab and window chords", () => {
    expect(resolveShortcut(key({ key: "t", ctrlKey: true }))).toEqual({ type: "new-tab" });
    expect(resolveShortcut(key({ key: "t", ctrlKey: true, shiftKey: true }))).toEqual({ type: "new-tab" });
    expect(resolveShortcut(key({ key: "w", ctrlKey: true, shiftKey: true }))).toEqual({ type: "close-tab" });
    expect(resolveShortcut(key({ key: "F12", ctrlKey: true, shiftKey: true }))).toEqual({ type: "focus-terminal" });
    expect(resolveShortcut(key({ key: ",", ctrlKey: true }))).toEqual({ type: "open-settings" });
  });

  it("finds with ctrl+f, not ctrl+shift+f", () => {
    expect(resolveShortcut(key({ key: "f", ctrlKey: true }))).toEqual({ type: "focus-search" });
    expect(resolveShortcut(key({ key: "f", ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("switches tabs with alt+digit using either key or code", () => {
    expect(resolveShortcut(key({ key: "3", altKey: true }))).toEqual({ type: "switch-tab", index: 2 });
    expect(resolveShortcut(key({ key: "¡", code: "Digit3", altKey: true }))).toEqual({
      type: "switch-tab",
      index: 2,
    });
  });

  it("cycles tabs with ctrl+page keys", () => {
    expect(resolveShortcut(key({ key: "PageDown", ctrlKey: true }))).toEqual({ type: "cycle-tab", delta: 1 });
    expect(resolveShortcut(key({ key: "PageUp", ctrlKey: true }))).toEqual({ type: "cycle-tab", delta: -1 });
  });

  it("reports escape and ignores plain keys", () => {
    expect(resolveShortcut(key({ key: "Escape" }))).toEqual({ type: "close-overlay" });
    expect(resolveShortcut(key({ key: "a" }))).toBeNull();
  });
});
