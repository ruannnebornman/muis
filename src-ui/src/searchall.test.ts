import { describe, expect, it } from "vitest";
import { collectMatches, type SearchableTab } from "./searchall";

function tab(over: Partial<SearchableTab>): SearchableTab {
  return {
    wsIndex: 0,
    tabId: "t1",
    wsName: "home",
    title: "Terminal 1",
    active: true,
    lines: [],
    ...over,
  };
}

const tabs: SearchableTab[] = [
  tab({ wsIndex: 0, tabId: "a", wsName: "home", title: "zsh", active: true, lines: ["hello world", "boring"] }),
  tab({ wsIndex: 1, tabId: "b", wsName: "dev", title: "logs", active: false, lines: ["HELLO again", "other"] }),
];

describe("collectMatches", () => {
  it("requires two characters", () => {
    expect(collectMatches("h", "all", 0, tabs).total).toBe(0);
  });

  it("matches case-insensitively across tabs and counts all hits", () => {
    const { total, items } = collectMatches("hello", "all", 0, tabs);
    expect(total).toBe(2);
    expect(items.map((i) => i.tabId)).toEqual(["a", "b"]);
    expect(items[1].crumb).toBe("dev › logs");
  });

  it("scopes to the current session", () => {
    const { total, items } = collectMatches("hello", "session", 0, tabs);
    expect(total).toBe(1);
    expect(items[0].tabId).toBe("a");
  });

  it("scopes to the active tab", () => {
    const { total } = collectMatches("hello", "tab", 0, tabs);
    expect(total).toBe(1);
  });

  it("matches tab names too", () => {
    const { items } = collectMatches("logs", "all", 0, tabs);
    expect(items.some((i) => i.text === "tab: logs")).toBe(true);
  });

  it("supports regex matching", () => {
    expect(collectMatches("h.llo", "all", 0, tabs, 50, { regex: true }).total).toBe(2);
    expect(collectMatches("(", "all", 0, tabs, 50, { regex: true }).total).toBe(0);
  });

  it("honours case sensitivity", () => {
    expect(collectMatches("HELLO", "all", 0, tabs, 50, { caseSensitive: true }).total).toBe(1);
    expect(collectMatches("hello", "all", 0, tabs, 50, { caseSensitive: true }).total).toBe(1);
    expect(collectMatches("hello", "all", 0, tabs, 50, { caseSensitive: false }).total).toBe(2);
  });

  it("caps the item list but keeps the total", () => {
    const many = tab({ tabId: "m", lines: Array.from({ length: 80 }, () => "x foo") });
    const { total, items } = collectMatches("foo", "all", 0, [many], 10);
    expect(total).toBe(80);
    expect(items).toHaveLength(10);
  });
});
