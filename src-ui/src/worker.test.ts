import { describe, expect, it, vi } from "vitest";
import { WorkerClient, type Transport } from "./worker";
import type { UiToWorker, WorkerToUi } from "./ipc";

function fakeTransport(): Transport & { sent: UiToWorker[]; cb: (s: string, f: WorkerToUi) => void } {
  const t = {
    sent: [] as UiToWorker[],
    cb: (_s: string, _f: WorkerToUi) => {},
    spawn: vi.fn(async (_s: string) => {}),
    send: vi.fn(async (_s: string, m: UiToWorker) => {
      t.sent.push(m);
    }),
    stop: vi.fn(async (_s: string) => {}),
    onEvent(cb: (s: string, f: WorkerToUi) => void) {
      t.cb = cb;
    },
  };
  return t;
}

describe("WorkerClient", () => {
  it("spawns the session then the pty, and routes output", async () => {
    const t = fakeTransport();
    const c = new WorkerClient(t);
    const got: Uint8Array[] = [];
    await c.spawnTab("s1", "t1", "/bin/sh", "/tmp", 80, 24,
      (d) => got.push(d),
      () => {},
    );
    expect(t.spawn).toHaveBeenCalledWith("s1");
    expect(t.sent[0]).toEqual({
      type: "spawn", pty_id: "t1", shell: "/bin/sh", cwd: "/tmp", cols: 80, rows: 24,
    });

    t.cb("s1", { type: "output", pty_id: "t1", data_b64: "aGk=" });
    expect(got.length).toBe(1);
    expect(Array.from(got[0])).toEqual([0x68, 0x69]);
  });

  it("does not respawn an already-spawned pty", async () => {
    const t = fakeTransport();
    const c = new WorkerClient(t);
    const noop = () => {};
    await c.spawnTab("s1", "t1", "/bin/sh", "/tmp", 80, 24, noop, noop);
    await c.spawnTab("s1", "t1", "/bin/sh", "/tmp", 80, 24, noop, noop);
    expect(t.sent.filter((m) => m.type === "spawn").length).toBe(1);
  });

  it("routes exits and drops output for killed tabs", async () => {
    const t = fakeTransport();
    const c = new WorkerClient(t);
    const exits: Array<number | null> = [];
    const outs: Uint8Array[] = [];
    const noop = () => {};
    await c.spawnTab("s1", "t1", "/bin/sh", "/tmp", 80, 24, (d) => outs.push(d), (code) => exits.push(code));
    t.cb("s1", { type: "exited", pty_id: "t1", code: 42 });
    expect(exits).toEqual([42]);

    await c.spawnTab("s1", "t2", "/bin/sh", "/tmp", 80, 24, (d) => outs.push(d), noop);
    await c.kill("s1", "t2");
    expect(t.sent.at(-1)).toEqual({ type: "kill", pty_id: "t2" });
    t.cb("s1", { type: "output", pty_id: "t2", data_b64: "aGk=" });
    expect(outs.length).toBe(0);
  });

  it("reports whole-worker death per session", async () => {    const t = fakeTransport();
    const c = new WorkerClient(t);
    const dead: string[] = [];
    c.onWorkerDead((s) => dead.push(s));
    t.cb("s9", { type: "error", pty_id: "", message: "worker process ended" });
    expect(dead).toEqual(["s9"]);
    expect(c.isSessionDead("s9")).toBe(true);
    expect(c.isSessionDead("s1")).toBe(false);
  });

  it("requests snapshots and routes them one-shot", async () => {
    const t = fakeTransport();
    const c = new WorkerClient(t);
    const snaps: Uint8Array[] = [];
    const noop = () => {};
    await c.spawnTab("s1", "t1", "/bin/sh", "/tmp", 80, 24, noop, noop);
    await c.snapshot("s1", "t1", (d) => snaps.push(d));
    expect(t.sent.at(-1)).toEqual({ type: "snapshot", pty_id: "t1" });
    t.cb("s1", { type: "snapshot_data", pty_id: "t1", data_b64: "aGk=" });
    expect(snaps.length).toBe(1);
    expect(Array.from(snaps[0])).toEqual([0x68, 0x69]);
    // Second snapshot_data without a request goes nowhere.
    t.cb("s1", { type: "snapshot_data", pty_id: "t1", data_b64: "aGk=" });
    expect(snaps.length).toBe(1);
  });
});
