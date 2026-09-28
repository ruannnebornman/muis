import { describe, expect, it } from "vitest";
import { DoneTracker } from "./done";

describe("DoneTracker", () => {
  it("marks, counts, clears and forgets", () => {
    const d = new DoneTracker();
    expect(d.count()).toBe(0);
    d.mark("a");
    d.mark("b");
    expect(d.count()).toBe(2);
    expect(d.has("a")).toBe(true);
    d.clear("a");
    expect(d.has("a")).toBe(false);
    expect(d.count()).toBe(1);
    d.forget("b");
    expect(d.count()).toBe(0);
  });

  it("marking twice is idempotent", () => {
    const d = new DoneTracker();
    d.mark("a");
    d.mark("a");
    expect(d.count()).toBe(1);
  });
});
