/**
 * Minimal ACP (Agent Client Protocol) client.
 *
 * Transport-agnostic: it is handed a `write` function (one JSON-RPC line
 * out) and fed incoming lines via `receive`, so it can be unit-tested with
 * a fake transport and wired to Tauri separately. Protocol: JSON-RPC 2.0.
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

export class AcpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private sessionId = "";
  private configOptions: ConfigOption[] = [];

  constructor(
    private readonly write: (line: string) => void,
    private readonly handlers: AcpHandlers,
  ) {}

  get session(): string {
    return this.sessionId;
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
    // Notification from the agent.
    if (method === "session/update") {
      const params = (msg.params ?? {}) as Json;
      this.handlers.onUpdate((params.update ?? {}) as Record<string, unknown>);
      return;
    }
    // Request from the agent that we must answer.
    if (id !== undefined && typeof method === "string") {
      this.handleRequest(id as number, method, (msg.params ?? {}) as Json);
    }
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  private reply(id: number, result: unknown): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private handleRequest(id: number, method: string, params: Json): void {
    if (method === "session/request_permission") {
      this.handlers.onPermission({
        requestId: id,
        sessionId: String(params.sessionId ?? this.sessionId),
        toolCall: params.toolCall,
        options: (params.options ?? []) as PermissionOption[],
      });
      return;
    }
    // We advertise no fs/terminal capabilities, so anything else is
    // unsupported; answer so the agent is never left waiting.
    this.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "unsupported" } }),
    );
  }

  /** Answer a permission request. `optionId` null cancels. */
  resolvePermission(requestId: number, optionId: string | null): void {
    this.reply(
      requestId,
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
  }

  /**
   * Handshake. opencode acp can drop stdin written before it is ready, so
   * the caller retries; a per-attempt timeout keeps a dropped line from
   * hanging forever (the pending entry is cleared so a late reply is
   * ignored rather than resolving a stale promise).
   */
  initialize(timeoutMs = 1500): Promise<void> {
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
          resolve();
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
    });
  }

  async newSession(cwd: string): Promise<string> {
    const res = (await this.send("session/new", { cwd, mcpServers: [] })) as Json;
    this.sessionId = String(res.sessionId ?? "");
    this.readConfig(res);
    this.handlers.onSession(this.sessionId);
    return this.sessionId;
  }

  async loadSession(cwd: string, sessionId: string): Promise<void> {
    const res = (await this.send("session/load", { sessionId, cwd, mcpServers: [] })) as Json;
    this.sessionId = sessionId;
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
    await this.send("session/set_config_option", {
      sessionId: this.sessionId,
      configId,
      value,
    });
    const opt = this.configOptions.find((o) => o.id === configId);
    if (opt) opt.currentValue = value;
  }

  /** Send a prompt; resolves with the stop reason when the turn ends. */
  async prompt(text: string): Promise<string> {
    const res = (await this.send("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    })) as Json;
    return String(res?.stopReason ?? "end_turn");
  }

  cancel(): void {
    this.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this.sessionId },
      }),
    );
  }
}
