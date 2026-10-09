import { describe, expect, it } from "vitest";
import { QueryHistory } from "./history";

describe("QueryHistory", () => {
  it("keeps newest first and de-duplicates", () => {
    const h = new QueryHistory(5);
    h.add("one");
    h.add("two");
    h.add("one");
    expect(h.list()).toEqual(["one", "two"]);
  });

  it("ignores blanks and caps the list", () => {
    const h = new QueryHistory(2);
    h.add("  ");
    h.add("a");
    h.add("b");
    h.add("c");
    expect(h.list()).toEqual(["c", "b"]);
  });
});
