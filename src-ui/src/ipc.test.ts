import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { b64decode, b64encode, decodeWorker, encodeLine, type UiToWorker } from "./ipc";

const UI_TAGS = new Set(["spawn", "write", "resize", "snapshot", "kill"]);
const WORKER_TAGS = new Set(["spawned", "output", "exited", "snapshot_data", "error"]);

describe("ipc", () => {
  it("encodes newline-delimited frames", () => {
    const line = encodeLine({ type: "kill", pty_id: "p1" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ type: "kill", pty_id: "p1" });
  });

  it("decodes worker frames", () => {
    const m = decodeWorker('{"type":"exited","pty_id":"p1","code":0}\n');
    expect(m).toEqual({ type: "exited", pty_id: "p1", code: 0 });
  });

  it("binary payloads survive base64", () => {
    const raw = new Uint8Array([0x1b, 0x5b, 0x33, 0x32, 0xff, 0x00, 0xfe]);
    expect(b64decode(b64encode(raw))).toEqual(raw);
  });

  it("shared fixture matches the Rust side", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixture = path.resolve(here, "../../tests/fixtures/ipc-frames.jsonl");
    const text = fs.readFileSync(fixture, "utf8");
    const seenUi = new Set<string>();
    const seenWorker = new Set<string>();
    let lines = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      lines++;
      const { dir, frame } = JSON.parse(line) as { dir: string; frame: { type: string } };
      if (dir === "ui") {
        expect(UI_TAGS.has(frame.type)).toBe(true);
        // Every UI fixture frame must survive a TS encode roundtrip.
        expect(JSON.parse(encodeLine(frame as unknown as UiToWorker))).toEqual(frame);
        seenUi.add(frame.type);
      } else if (dir === "worker") {
        expect(WORKER_TAGS.has(frame.type)).toBe(true);
        expect(decodeWorker(JSON.stringify(frame))).toEqual(frame);
        seenWorker.add(frame.type);
      } else {
        throw new Error(`bad dir in fixture: ${dir}`);
      }
    }
    expect(lines).toBeGreaterThanOrEqual(10);
    expect(seenUi).toEqual(UI_TAGS);
    expect(seenWorker).toEqual(WORKER_TAGS);
  });
});
