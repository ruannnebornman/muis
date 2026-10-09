import { describe, expect, it } from "vitest";
import { clampIndex, filterCommands, type Command } from "./commands";

const commands: Command[] = [
  { id: "new-tab", title: "New terminal tab" },
  { id: "new-agent", title: "New AI tab" },
  { id: "close-tab", title: "Close tab" },
  { id: "settings", title: "Open settings" },
];

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands("", commands)).toHaveLength(4);
    expect(filterCommands("   ", commands)).toHaveLength(4);
  });

  it("matches case-insensitively anywhere in the title", () => {
    expect(filterCommands("TAB", commands).map((c) => c.id)).toEqual([
      "new-tab",
      "new-agent",
      "close-tab",
    ]);
    expect(filterCommands("ai", commands).map((c) => c.id)).toEqual(["new-agent"]);
    expect(filterCommands("sett", commands).map((c) => c.id)).toEqual(["settings"]);
  });

  it("returns nothing when there is no match", () => {
    expect(filterCommands("zzz", commands)).toEqual([]);
  });
});

describe("clampIndex", () => {
  it("keeps an index inside the list", () => {
    expect(clampIndex(0, 4)).toBe(0);
    expect(clampIndex(3, 4)).toBe(3);
    expect(clampIndex(9, 4)).toBe(3);
    expect(clampIndex(-2, 4)).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(clampIndex(0, 0)).toBe(-1);
  });
});
