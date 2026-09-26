import type { UiToWorker, WorkerToUi } from "./ipc";
import { b64encode } from "./ipc";

/**
 * Transport to the shell process. The Tauri implementation lives in
 * main.ts; tests inject a fake. Frames are the UiToWorker/WorkerToUi
 * JSON objects locked by tests/fixtures/ipc-frames.jsonl.
 */
export interface Transport {
  spawn(sessionId: string): Promise<void>;
  send(sessionId: string, msg: UiToWorker): Promise<void>;
  stop(sessionId: string): Promise<void>;
  onEvent(cb: (sessionId: string, frame: WorkerToUi) => void): void;
}

/**
 * Routes worker frames to per-pty handlers. One client for the window;
 * the shell owns one worker process per session underneath.
 */
export class WorkerClient {
  private transport: Transport;
  private outputHandlers = new Map<string, (data: Uint8Array) => void>();
  private exitHandlers = new Map<string, (code: number | null) => void>();
  private snapshotHandlers = new Map<string, (data: Uint8Array) => void>();
  private spawned = new Set<string>();
  private deadSessions = new Set<string>();
  private deadHandlers = new Set<(sessionId: string) => void>();

  constructor(transport: Transport) {
    this.transport = transport;
    transport.onEvent((sessionId, frame) => this.route(sessionId, frame));
  }

  /** Spawn a tab's pty (idempotent per pty id). */
  async spawnTab(
    sessionId: string,
    ptyId: string,
    shell: string,
    cwd: string,
    cols: number,
    rows: number,
    onOutput: (data: Uint8Array) => void,
    onExit: (code: number | null) => void,
  ): Promise<void> {
    await this.transport.spawn(sessionId);
    this.outputHandlers.set(ptyId, onOutput);
    this.exitHandlers.set(ptyId, onExit);
    if (this.spawned.has(ptyId)) return;
    this.spawned.add(ptyId);
    await this.transport.send(sessionId, { type: "spawn", pty_id: ptyId, shell, cwd, cols, rows });
  }

  async write(sessionId: string, ptyId: string, data: Uint8Array): Promise<void> {
    await this.transport.send(sessionId, { type: "write", pty_id: ptyId, data_b64: b64encode(data) });
  }

  async resize(sessionId: string, ptyId: string, cols: number, rows: number): Promise<void> {
    await this.transport.send(sessionId, { type: "resize", pty_id: ptyId, cols, rows });
  }

  async kill(sessionId: string, ptyId: string): Promise<void> {
    this.spawned.delete(ptyId);
    this.outputHandlers.delete(ptyId);
    this.exitHandlers.delete(ptyId);
    this.snapshotHandlers.delete(ptyId);
    await this.transport.send(sessionId, { type: "kill", pty_id: ptyId });
  }

  /** Ask the worker for the tab's retained scrollback (one-shot). */
  async snapshot(
    sessionId: string,
    ptyId: string,
    onSnapshot: (data: Uint8Array) => void,
  ): Promise<void> {
    this.snapshotHandlers.set(ptyId, onSnapshot);
    await this.transport.send(sessionId, { type: "snapshot", pty_id: ptyId });
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.transport.stop(sessionId);
  }

  onWorkerDead(cb: (sessionId: string) => void): void {
    this.deadHandlers.add(cb);
  }

  private route(sessionId: string, frame: WorkerToUi): void {
    switch (frame.type) {
      case "output": {
        const h = this.outputHandlers.get(frame.pty_id);
        if (!h) return;
        // Base64 is ASCII-only by construction; no TextEncoder needed.
        const bin = atob(frame.data_b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        h(out);
        break;
      }
      case "exited": {
        const h = this.exitHandlers.get(frame.pty_id);
        this.spawned.delete(frame.pty_id);
        h?.(frame.code);
        break;
      }
      case "snapshot_data": {
        const h = this.snapshotHandlers.get(frame.pty_id);
        this.snapshotHandlers.delete(frame.pty_id);
        if (!h) break;
        const bin = atob(frame.data_b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        h(out);
        break;
      }
      case "error": {
        // Empty pty id + "worker process ended" means the whole worker
        // died: every tab in that session lost its pty at once.
        if (frame.pty_id === "" && frame.message === "worker process ended") {
          this.deadSessions.add(sessionId);
          for (const cb of this.deadHandlers) cb(sessionId);
        }
        break;
      }
      default:
        break;
    }
  }

  isSessionDead(sessionId: string): boolean {
    return this.deadSessions.has(sessionId);
  }
}
