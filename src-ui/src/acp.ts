/**
 * ACP (Agent Client Protocol) client.
 *
 * One shared agent process carries many sessions. `AcpConnection` is the
 * transport: it owns the JSON-RPC id space, tracks pending requests, and
 * demultiplexes incoming lines to the `AcpClient` that owns a session id.
 * Transport-agnostic (it is handed a `write` function and fed lines via
 * `receive`), so it is unit-testable with a fake transport.
 *
 * Protocol: JSON-RPC 2.0.
 */

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface PermissionRequest {
  requestId: number;
  sessionId: string;
  toolCall?: unknown;
  options: PermissionOption[];
}

/** A session config option (e.g. the model select) from session/new. */
export interface ConfigOption {
  id: string;
  name: string;
  category?: string;
  type: string;
  currentValue?: string;
  options?: { value: string; name: string }[];
}

export interface AcpHandlers {
  /** session/update notification (agent_message_chunk, tool_call, …). */
  onUpdate: (update: Record<string, unknown>) => void;
  /** Agent asks the user to authorise a tool call. */
  onPermission: (req: PermissionRequest) => void;
  /** Session id assigned/confirmed by the agent. */
  onSession: (sessionId: string) => void;
  /** Config options (model, mode) offered for the session. */
  onConfig: (options: ConfigOption[]) => void;
  /** Transport/agent error worth showing in the pane. */
  onError: (message: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Simple `-`/`+` diff text for a tool-call card. */
export function diffLines(oldText: string, newText: string): string {
  const out: string[] = [];
  if (oldText) for (const line of oldText.split("\n")) out.push(`- ${line}`);
  if (newText) for (const line of newText.split("\n")) out.push(`+ ${line}`);
  return out.join("\n");
}

type Json = Record<string, unknown>;

/**
 * Shared transport over one agent process. Routes responses by request id
 * and notifications/requests by `sessionId` to the owning `AcpClient`.
 */
export class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly sessions = new Map<string, AcpClient>();
  /** Updates that arrived before their session registered (e.g. a load
   *  replay race); flushed when the client registers. */
  private readonly earlyUpdates = new Map<string, Record<string, unknown>[]>();
  private initialized = false;

  constructor(private readonly write: (line: string) => void) {}

  register(sessionId: string, client: AcpClient): void {
    this.sessions.set(sessionId, client);
    const buffered = this.earlyUpdates.get(sessionId);
    if (buffered) {
      this.earlyUpdates.delete(sessionId);
      for (const u of buffered) client.deliverUpdate(u);
    }
  }

  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * One handshake attempt. opencode acp can drop stdin written before it
   * is ready, so the caller retries; a per-attempt timeout keeps a dropped
   * line from hanging forever (the pending entry is cleared so a late
   * reply is ignored rather than resolving a stale promise). Cached on
   * success, so calling it again after a good handshake is a no-op.
   */
  initialize(timeoutMs = 1500): Promise<void> {
    if (this.initialized) return Promise.resolve();
    const id = this.nextId++;
    this.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "muis", version: "0.1.0" },
        },
      }),
    );
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("initialize timed out"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          this.initialized = true;
          resolve();
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  notify(method: string, params: unknown): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  respond(id: number, result: unknown): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private respondError(id: number, code: number, message: string): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  /** Feed one line of agent stdout. Unknown/garbled lines are ignored. */
  receive(line: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      return; // stderr diagnostics and non-JSON noise
    }
    const id = msg.id;
    const method = msg.method;
    // Response to one of our requests.
    if (id !== undefined && method === undefined) {
      const p = this.pending.get(id as number);
      if (!p) return;
      this.pending.delete(id as number);
      if (msg.error) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }
    // Notification from the agent, routed by session id.
    if (method === "session/update") {
      const params = (msg.params ?? {}) as Json;
      const sid = String(params.sessionId ?? "");
      const update = (params.update ?? {}) as Record<string, unknown>;
      const client = this.sessions.get(sid);
      if (client) {
        client.deliverUpdate(update);
      } else if (sid) {
        const arr = this.earlyUpdates.get(sid) ?? [];
        arr.push(update);
        this.earlyUpdates.set(sid, arr);
      }
      return;
    }
    // Request from the agent that we must answer.
    if (id !== undefined && typeof method === "string") {
      const params = (msg.params ?? {}) as Json;
      if (method === "session/request_permission") {
        const sid = String(params.sessionId ?? "");
        const client = this.sessions.get(sid);
        if (client) {
          client.deliverPermission({
            requestId: id as number,
            sessionId: sid,
            toolCall: params.toolCall,
            options: (params.options ?? []) as PermissionOption[],
          });
        } else {
          // No owner: do not leave the agent waiting.
          this.respond(id as number, { outcome: { outcome: "cancelled" } });
        }
        return;
      }
      this.respondError(id as number, -32601, "unsupported");
    }
  }

  /** Drop all state after the shared process dies, so a respawn starts clean. */
  reset(): void {
    for (const p of this.pending.values()) p.reject(new Error("agent exited"));
    this.pending.clear();
    this.sessions.clear();
    this.earlyUpdates.clear();
    this.initialized = false;
  }
}

/** Per-session view over a shared `AcpConnection`. One per AI tab. */
export class AcpClient {
  private sessionId = "";
  private configOptions: ConfigOption[] = [];

  constructor(
    private readonly conn: AcpConnection,
    private readonly handlers: AcpHandlers,
  ) {}

  get session(): string {
    return this.sessionId;
  }

  async newSession(cwd: string): Promise<string> {
    const res = (await this.conn.request("session/new", { cwd, mcpServers: [] })) as Json;
    this.sessionId = String(res.sessionId ?? "");
    this.conn.register(this.sessionId, this);
    this.readConfig(res);
    this.handlers.onSession(this.sessionId);
    return this.sessionId;
  }

  async loadSession(cwd: string, sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.configOptions = [];
    const res = (await this.conn.request("session/load", { sessionId, cwd, mcpServers: [] })) as Json;
    this.conn.register(sessionId, this);
    this.readConfig(res);
    this.handlers.onSession(sessionId);
  }

  private readConfig(res: Json): void {
    const options = Array.isArray(res.configOptions) ? (res.configOptions as ConfigOption[]) : [];
    this.configOptions = options;
    this.handlers.onConfig(options);
  }

  /** Change a session config option (e.g. the model). */
  async setConfigOption(configId: string, value: string): Promise<void> {
    await this.conn.request("session/set_config_option", {
      sessionId: this.sessionId,
      configId,
      value,
    });
    const opt = this.configOptions.find((o) => o.id === configId);
    if (opt) opt.currentValue = value;
  }

  /** Send a prompt (text + optional attachments); resolves with the stop reason. */
  async prompt(
    text: string,
    attachments: { uri: string; mimeType: string; text: string }[] = [],
  ): Promise<string> {
    const prompt: unknown[] = [];
    if (text) prompt.push({ type: "text", text });
    for (const a of attachments) {
      prompt.push({ type: "resource", resource: { uri: a.uri, mimeType: a.mimeType, text: a.text } });
    }
    const res = (await this.conn.request("session/prompt", {
      sessionId: this.sessionId,
      prompt,
    })) as Json;
    return String(res?.stopReason ?? "end_turn");
  }

  cancel(): void {
    this.conn.notify("session/cancel", { sessionId: this.sessionId });
  }

  /**
   * Close the session: frees agent-side state while the session persists on
   * disk (still resumable via loadSession). Does not touch the shared process.
   */
  async close(): Promise<void> {
    const sid = this.sessionId;
    if (!sid) return;
    this.sessionId = "";
    this.conn.unregister(sid);
    try {
      await this.conn.request("session/close", { sessionId: sid });
    } catch {
      // Best effort; the process may already be gone.
    }
  }

  /** Answer a permission request. `optionId` null cancels. */
  resolvePermission(requestId: number, optionId: string | null): void {
    this.conn.respond(
      requestId,
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
  }

  /** @internal routed by `AcpConnection`. */
  deliverUpdate(update: Record<string, unknown>): void {
    this.handlers.onUpdate(update);
  }

  /** @internal routed by `AcpConnection`. */
  deliverPermission(req: PermissionRequest): void {
    this.handlers.onPermission(req);
  }
}
