import { describe, expect, it } from "vitest";
import {
  anyTabBusy,
  forgetTab,
  isTabBusy,
  newActivityState,
} from "./activity";

describe("activity", () => {
  it("fresh tabs are busy (young), exited tabs never are", () => {
    const s = newActivityState();
    s.spawnedAt.set("t1", 1000);
    expect(isTabBusy(s, "t1", 2000)).toBe(true);
    s.exited.add("t1");
    expect(isTabBusy(s, "t1", 2000)).toBe(false);
  });

  it("recent output keeps a tab busy, old output does not", () => {
    const s = newActivityState();
    s.spawnedAt.set("t1", 0);
    s.lastOutputAt.set("t1", 100000);
    expect(isTabBusy(s, "t1", 100000 + 59000)).toBe(true);
    expect(isTabBusy(s, "t1", 100000 + 61000)).toBe(false);
    expect(isTabBusy(s, "ghost", 100000)).toBe(false);
  });

  it("aggregates across tabs and forgets closed ones", () => {
    const s = newActivityState();
    s.spawnedAt.set("t1", 0);
    s.spawnedAt.set("t2", 0);
    s.exited.add("t1");
    s.exited.add("t2");
    expect(anyTabBusy(s, ["t1", "t2"], 1000)).toBe(false);
    s.exited.delete("t2");
    s.lastOutputAt.set("t2", 1000);
    expect(anyTabBusy(s, ["t1", "t2"], 2000)).toBe(true);
    forgetTab(s, "t2");
    expect(anyTabBusy(s, ["t1", "t2"], 2000)).toBe(false);
  });
});
