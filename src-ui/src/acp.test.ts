import { describe, it, expect } from "vitest";
import { AcpClient, type PermissionRequest } from "./acp";

/** Fake transport: records lines the client writes, lets the test inject. */
function harness() {
  const out: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const permissions: PermissionRequest[] = [];
  const errors: string[] = [];
  let session = "";
  const client = new AcpClient(
    (line) => out.push(JSON.parse(line)),
    {
      onUpdate: (u) => updates.push(u),
      onPermission: (p) => permissions.push(p),
      onSession: (s) => (session = s),
      onError: (m) => errors.push(m),
    },
  );
  const last = () => out[out.length - 1];
  return { client, out, updates, permissions, errors, session: () => session, last };
}

describe("AcpClient", () => {
  it("initializes with protocol version and minimal capabilities", async () => {
    const h = harness();
    const p = h.client.initialize();
    expect(h.last().method).toBe("initialize");
    expect((h.last().params as any).protocolVersion).toBe(1);
    expect((h.last().params as any).clientCapabilities.terminal).toBe(false);
    h.client.receive(JSON.stringify({ jsonrpc: "2.0", id: h.last().id, result: {} }));
    await p;
  });

  it("times out initialize when the agent never answers", async () => {
    const h = harness();
    await expect(h.client.initialize(20)).rejects.toThrow(/timed out/);
  });

  it("ignores a late initialize reply after a timeout", async () => {
    const h = harness();
    const p = h.client.initialize(20);
    const id = h.last().id;
    await expect(p).rejects.toThrow(/timed out/);
    // A reply that arrives after the timeout must be dropped, not throw.
    expect(() =>
      h.client.receive(JSON.stringify({ jsonrpc: "2.0", id, result: {} })),
    ).not.toThrow();
  });

  it("creates a session and records its id", async () => {
    const h = harness();
    const p = h.client.newSession("/tmp/proj");
    const id = h.last().id;
    h.client.receive(JSON.stringify({ jsonrpc: "2.0", id, result: { sessionId: "ses_1" } }));
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
    h.client.receive(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }));
    await p;
    expect(h.session()).toBe("ses_9");
  });

  it("routes session/update notifications", () => {
    const h = harness();
    h.client.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "hi" } } },
      }),
    );
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].sessionUpdate).toBe("agent_message_chunk");
  });

  it("resolves a permission request", () => {
    const h = harness();
    h.client.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "session/request_permission",
        params: {
          sessionId: "ses_1",
          options: [
            { optionId: "allow", kind: "allow_once" },
            { optionId: "deny", kind: "reject_once" },
          ],
        },
      }),
    );
    expect(h.permissions).toHaveLength(1);
    h.client.resolvePermission(7, "allow");
    expect(h.last()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { outcome: { outcome: "selected", optionId: "allow" } },
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
    h.client.receive(
      JSON.stringify({ jsonrpc: "2.0", id: 11, method: "terminal/create", params: {} }),
    );
    expect((h.last() as any).error.code).toBe(-32601);
  });

  it("rejects on JSON-RPC errors", async () => {
    const h = harness();
    const p = h.client.prompt("go");
    h.client.receive(
      JSON.stringify({ jsonrpc: "2.0", id: h.last().id, error: { code: -1, message: "nope" } }),
    );
    await expect(p).rejects.toEqual({ code: -1, message: "nope" });
  });

  it("ignores non-JSON lines", () => {
    const h = harness();
    expect(() => h.client.receive("[stderr] noise")).not.toThrow();
    expect(h.updates).toHaveLength(0);
  });
});
