import { describe, it, expect } from "vitest";
import { AcpConnection, AcpClient, diffLines, type PermissionRequest, type ConfigOption } from "./acp";

/** Fake transport: records lines, lets the test inject agent lines. */
function harness() {
  const out: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const permissions: PermissionRequest[] = [];
  const configs: ConfigOption[][] = [];
  const errors: string[] = [];
  let session = "";
  const conn = new AcpConnection((line) => out.push(JSON.parse(line)));
  const client = new AcpClient(conn, {
    onUpdate: (u) => updates.push(u),
    onPermission: (p) => permissions.push(p),
    onSession: (s) => (session = s),
    onConfig: (o) => configs.push(o),
    onError: (m) => errors.push(m),
  });
  const last = () => out[out.length - 1];
  const lastId = () => last().id as number;
  return {
    conn,
    client,
    out,
    updates,
    permissions,
    configs,
    errors,
    session: () => session,
    last,
    lastId,
  };
}

const updateLine = (sessionId: string, u: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });

describe("diffLines", () => {
  it("marks added lines with +", () => {
    expect(diffLines("", "a\nb")).toBe("+ a\n+ b");
  });
  it("marks removed lines with -", () => {
    expect(diffLines("a", "")).toBe("- a");
  });
  it("shows old then new", () => {
    expect(diffLines("x", "y")).toBe("- x\n+ y");
  });
});

describe("AcpConnection handshake", () => {
  it("initializes with protocol version and minimal capabilities", async () => {
    const h = harness();
    const p = h.conn.initialize();
    expect(h.last().method).toBe("initialize");
    expect((h.last().params as any).protocolVersion).toBe(1);
    expect((h.last().params as any).clientCapabilities.terminal).toBe(false);
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), result: {} }));
    await p;
    // Cached: a second call does not write another initialize.
    const before = h.out.length;
    await h.conn.initialize();
    expect(h.out.length).toBe(before);
  });

  it("times out initialize when the agent never answers", async () => {
    const h = harness();
    await expect(h.conn.initialize(20)).rejects.toThrow(/timed out/);
  });

  it("ignores a late initialize reply after a timeout", async () => {
    const h = harness();
    const p = h.conn.initialize(20);
    const id = h.lastId();
    await expect(p).rejects.toThrow(/timed out/);
    expect(() => h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id, result: {} }))).not.toThrow();
  });

  it("can retry initialize after a timeout", async () => {
    const h = harness();
    await expect(h.conn.initialize(20)).rejects.toThrow(/timed out/);
    const p = h.conn.initialize(2000);
    expect(h.last().method).toBe("initialize");
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), result: {} }));
    await p;
  });
});

describe("AcpClient", () => {
  it("creates a session and records its id", async () => {
    const h = harness();
    const p = h.client.newSession("/tmp/proj");
    const id = h.lastId();
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id, result: { sessionId: "ses_1" } }));
    await expect(p).resolves.toBe("ses_1");
    expect(h.session()).toBe("ses_1");
    expect(h.last().method).toBe("session/new");
  });

  it("loads an existing session", async () => {
    const h = harness();
    const p = h.client.loadSession("/tmp/proj", "ses_9");
    const req = h.last();
    expect(req.method).toBe("session/load");
    expect((req.params as any).sessionId).toBe("ses_9");
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }));
    await p;
    expect(h.session()).toBe("ses_9");
  });

  it("captures config options and can set one", async () => {
    const h = harness();
    const p = h.client.newSession("/tmp/proj");
    h.conn.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: h.lastId(),
        result: {
          sessionId: "ses_1",
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              currentValue: "a",
              options: [
                { value: "a", name: "A" },
                { value: "b", name: "B" },
              ],
            },
          ],
        },
      }),
    );
    await p;
    expect(h.configs.at(-1)?.[0].id).toBe("model");
    const setP = h.client.setConfigOption("model", "b");
    expect(h.last().method).toBe("session/set_config_option");
    expect((h.last().params as { value: string }).value).toBe("b");
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), result: {} }));
    await setP;
  });

  it("auto-cancels a permission request from an unknown session", () => {
    const h = harness();
    h.conn.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "session/request_permission",
        params: { sessionId: "ses_1", options: [{ optionId: "allow", kind: "allow_once" }] },
      }),
    );
    expect(h.last()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { outcome: { outcome: "cancelled" } },
    });
  });

  it("cancels a permission request", () => {
    const h = harness();
    h.client.resolvePermission(3, null);
    expect(h.last()).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { outcome: { outcome: "cancelled" } },
    });
  });

  it("answers unknown client requests instead of hanging", () => {
    const h = harness();
    h.conn.receive(
      JSON.stringify({ jsonrpc: "2.0", id: 11, method: "terminal/create", params: {} }),
    );
    expect((h.last() as any).error.code).toBe(-32601);
  });

  it("includes attachments as resource parts", async () => {
    const h = harness();
    const p = h.client.prompt("see file", [
      { uri: "file:///x", mimeType: "text/plain", text: "hi" },
    ]);
    const params = h.last().params as { prompt: unknown[] };
    expect(params.prompt[0]).toEqual({ type: "text", text: "see file" });
    expect(params.prompt[1]).toEqual({
      type: "resource",
      resource: { uri: "file:///x", mimeType: "text/plain", text: "hi" },
    });
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), result: { stopReason: "end_turn" } }));
    await p;
  });

  it("rejects on JSON-RPC errors", async () => {
    const h = harness();
    const p = h.client.prompt("go");
    h.conn.receive(
      JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), error: { code: -1, message: "nope" } }),
    );
    await expect(p).rejects.toEqual({ code: -1, message: "nope" });
  });

  it("ignores non-JSON lines", () => {
    const h = harness();
    expect(() => h.conn.receive("[stderr] noise")).not.toThrow();
    expect(h.updates).toHaveLength(0);
  });

  it("closes the session and stops routing its updates", async () => {
    const h = harness();
    const load = h.client.loadSession("/tmp/proj", "ses_5");
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), result: {} }));
    await load;
    const close = h.client.close();
    expect(h.last().method).toBe("session/close");
    h.conn.receive(JSON.stringify({ jsonrpc: "2.0", id: h.lastId(), result: {} }));
    await close;
    expect(h.client.session).toBe("");
    h.conn.receive(updateLine("ses_5", { sessionUpdate: "agent_message_chunk" }));
    expect(h.updates).toHaveLength(0);
  });
});

describe("AcpConnection multi-session routing", () => {
  function twoClients() {
    const out: Record<string, unknown>[] = [];
    const conn = new AcpConnection((line) => out.push(JSON.parse(line)));
    const seen: Record<"a" | "b", Record<string, unknown>[]> = { a: [], b: [] };
    const handlers = (key: "a" | "b") => ({
      onUpdate: (u: Record<string, unknown>) => seen[key].push(u),
      onPermission: () => {},
      onSession: () => {},
      onConfig: () => {},
      onError: () => {},
    });
    return { conn, a: new AcpClient(conn, handlers("a")), b: new AcpClient(conn, handlers("b")), seen, out };
  }

  const lastId = (out: Record<string, unknown>[]): number => out[out.length - 1].id as number;

  it("routes each session's updates to its own client", async () => {
    const { conn, a, b, seen, out } = twoClients();
    const pa = a.loadSession("/tmp/a", "ses_a");
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(out), result: {} }));
    await pa;
    const pb = b.loadSession("/tmp/b", "ses_b");
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(out), result: {} }));
    await pb;

    conn.receive(updateLine("ses_a", { sessionUpdate: "agent_message_chunk", text: "hi-a" }));
    conn.receive(updateLine("ses_b", { sessionUpdate: "agent_message_chunk", text: "hi-b" }));
    expect(seen.a).toHaveLength(1);
    expect(seen.b).toHaveLength(1);
    expect(seen.a[0].text).toBe("hi-a");
    expect(seen.b[0].text).toBe("hi-b");
  });

  it("buffers updates that arrive before the session registers (load replay)", async () => {
    const { conn, a, seen, out } = twoClients();
    const pa = a.loadSession("/tmp/a", "ses_early");
    // Replay updates land before the load response.
    conn.receive(updateLine("ses_early", { sessionUpdate: "user_message_chunk", text: "u" }));
    conn.receive(updateLine("ses_early", { sessionUpdate: "agent_message_chunk", text: "a" }));
    expect(seen.a).toHaveLength(0);
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(out), result: {} }));
    await pa;
    expect(seen.a).toHaveLength(2);
    expect(seen.a.map((u) => u.text)).toEqual(["u", "a"]);
  });

  it("does not cross-deliver one session's updates to another", async () => {
    const { conn, a, b, seen, out } = twoClients();
    const pa = a.newSession("/tmp/a");
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(out), result: { sessionId: "ses_a" } }));
    await pa;
    const pb = b.newSession("/tmp/b");
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(out), result: { sessionId: "ses_b" } }));
    await pb;

    conn.receive(updateLine("ses_a", { sessionUpdate: "agent_message_chunk", text: "only-a" }));
    expect(seen.a).toHaveLength(1);
    expect(seen.b).toHaveLength(0);
  });

  it("routes a permission request to its owning session", async () => {
    const out: Record<string, unknown>[] = [];
    const conn = new AcpConnection((line) => out.push(JSON.parse(line)));
    const perms: PermissionRequest[] = [];
    const a = new AcpClient(conn, {
      onUpdate: () => {},
      onPermission: (p) => perms.push(p),
      onSession: () => {},
      onConfig: () => {},
      onError: () => {},
    });
    const pa = a.loadSession("/tmp/a", "ses_a");
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(out), result: {} }));
    await pa;
    conn.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "session/request_permission",
        params: { sessionId: "ses_a", options: [{ optionId: "allow", kind: "allow_once" }] },
      }),
    );
    expect(perms).toHaveLength(1);
    expect(perms[0].sessionId).toBe("ses_a");
    a.resolvePermission(42, "allow");
    expect(out.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    });
  });

  it("reset rejects in-flight requests and clears routing", async () => {
    const { conn, a } = twoClients();
    const pa = a.newSession("/tmp/a");
    conn.reset();
    await expect(pa).rejects.toThrow(/exited/);
  });
});
