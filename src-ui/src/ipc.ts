/**
 * IPC frame types. Must match crates/muis-core/src/ipc.rs exactly —
 * tests/fixtures/ipc-frames.jsonl locks both sides together.
 */

export type UiToWorker =
  | { type: "spawn"; pty_id: string; shell: string; cwd: string; cols: number; rows: number }
  | { type: "write"; pty_id: string; data_b64: string }
  | { type: "resize"; pty_id: string; cols: number; rows: number }
  | { type: "snapshot"; pty_id: string }
  | { type: "kill"; pty_id: string };

export type WorkerToUi =
  | { type: "spawned"; pty_id: string }
  | { type: "output"; pty_id: string; data_b64: string }
  | { type: "exited"; pty_id: string; code: number | null }
  | { type: "snapshot_data"; pty_id: string; data_b64: string }
  | { type: "error"; pty_id: string; message: string };

export function encodeLine(msg: UiToWorker): string {
  return JSON.stringify(msg) + "\n";
}

export function decodeWorker(line: string): WorkerToUi {
  return JSON.parse(line.trim()) as WorkerToUi;
}

export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function textToB64(text: string): string {
  return b64encode(new TextEncoder().encode(text));
}
