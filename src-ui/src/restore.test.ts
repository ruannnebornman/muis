import { describe, expect, it } from "vitest";
import type { RestoreEntry } from "./agentSessions";
import { RestorePump } from "./restore";

const entry = (id: string): RestoreEntry => ({ wsIndex: 0, tabIndex: 0, tabId: id });

function deferredStart() {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const start = (e: RestoreEntry) => {
    started.push(e.tabId);
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  return { started, releases, start };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("RestorePump", () => {
  it("starts at most the limit, then fills freed slots", async () => {
    const { started, releases, start } = deferredStart();
    const pump = new RestorePump({
      limit: 3,
      start,
      staggerMs: 0,
      schedule: (fn) => void setTimeout(fn, 0),
    });
    pump.push(["a", "b", "c", "d", "e"].map(entry));
    await tick();
    expect(started).toEqual(["a", "b", "c"]);
    expect(pump.inFlight).toBe(3);
    expect(pump.pending).toBe(2);

    releases[0]();
    await tick();
    expect(started).toEqual(["a", "b", "c", "d"]);
    expect(pump.inFlight).toBe(3);

    releases[1]();
    releases[2]();
    releases[3]();
    await tick();
    expect(started).toContain("e");
    expect(pump.inFlight).toBeLessThanOrEqual(3);
  });

  it("drains the whole queue", async () => {
    const started: string[] = [];
    const pump = new RestorePump({
      limit: 2,
      start: async (e) => {
        started.push(e.tabId);
      },
      staggerMs: 0,
      schedule: (fn) => void setTimeout(fn, 0),
    });
    pump.push(["a", "b", "c", "d"].map(entry));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started.sort()).toEqual(["a", "b", "c", "d"]);
    expect(pump.inFlight).toBe(0);
  });

  it("frees a slot when a start rejects", async () => {
    let calls = 0;
    const pump = new RestorePump({
      limit: 1,
      start: async () => {
        calls++;
        throw new Error("boom");
      },
      staggerMs: 0,
      schedule: (fn) => void setTimeout(fn, 0),
    });
    pump.push([entry("a"), entry("b")]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(2);
    expect(pump.inFlight).toBe(0);
  });
});
