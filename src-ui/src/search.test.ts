import { describe, expect, it, vi } from "vitest";
import { SearchController, type SearchAdapter } from "./search";

function adapter(): SearchAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    findNext: vi.fn((q: string) => {
      calls.push(`next:${q}`);
      return true;
    }),
    findPrevious: vi.fn((q: string) => {
      calls.push(`prev:${q}`);
      return true;
    }),
    clearDecorations: vi.fn(() => {
      calls.push("clear");
    }),
  };
}

describe("SearchController", () => {
  it("stays shut without an open bar or query", () => {
    const a = adapter();
    const c = new SearchController(() => a);
    expect(c.search("x")).toBe(false);
    expect(a.calls).toEqual([]);
  });

  it("searches forward and backward through the active addon", () => {
    const a = adapter();
    const c = new SearchController(() => a);
    expect(c.toggle()).toBe(true);
    expect(c.search("fish")).toBe(true);
    expect(c.next()).toBe(true);
    expect(c.previous()).toBe(true);
    expect(a.calls).toEqual(["next:fish", "next:fish", "prev:fish"]);
  });

  it("closing clears decorations and forgets the query", () => {
    const a = adapter();
    const c = new SearchController(() => a);
    c.toggle();
    c.search("fish");
    c.close();
    expect(c.isOpen()).toBe(false);
    expect(a.calls).toContain("clear");
    expect(c.next()).toBe(false);
  });

  it("tolerates a missing addon (tab with no terminal yet)", () => {
    const c = new SearchController(() => undefined);
    c.toggle();
    expect(c.search("fish")).toBe(false);
  });
});
