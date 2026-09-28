import { describe, expect, it } from "vitest";
import { OscParser } from "./osc";

const enc = new TextEncoder();
const ESC = "\x1b";

describe("OscParser", () => {
  it("reads OSC 7 cwd and strips the file://host prefix", () => {
    const p = new OscParser();
    const ev = p.push(enc.encode(`${ESC}]7;file://veldmuis/home/kaazrot\x07`));
    expect(ev).toEqual([{ type: "cwd", path: "/home/kaazrot" }]);
  });

  it("reads OSC 0/2 titles with BEL or ST terminators", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]0;~\x07`))).toEqual([{ type: "title", title: "~" }]);
    expect(p.push(enc.encode(`${ESC}]2;my task\x1b\\`))).toEqual([
      { type: "title", title: "my task" },
    ]);
  });

  it("ignores queries and other sequences", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]11;?\x07`))).toEqual([]);
    expect(p.push(enc.encode("plain output with \x1b[32m color"))).toEqual([]);
  });

  it("reassembles sequences split across chunks", () => {
    const p = new OscParser();
    const full = enc.encode(`prompt ${ESC}]7;file://h/tmp/work\x07 tail`);
    expect(p.push(full.slice(0, 12))).toEqual([]);
    expect(p.push(full.slice(12))).toEqual([{ type: "cwd", path: "/tmp/work" }]);
  });

  it("handles several sequences in one chunk", () => {
    const p = new OscParser();
    const ev = p.push(enc.encode(`${ESC}]7;file://h/a\x07${ESC}]0;b\x07`));
    expect(ev).toEqual([
      { type: "cwd", path: "/a" },
      { type: "title", title: "b" },
    ]);
  });

  it("percent-decodes paths and tolerates titles with semicolons", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]7;file://h/my%20docs\x07`))).toEqual([
      { type: "cwd", path: "/my docs" },
    ]);
    expect(p.push(enc.encode(`${ESC}]2;a;b\x07`))).toEqual([{ type: "title", title: "a;b" }]);
  });

  it("reads OSC 133 command markers and exit codes", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]133;A\x07${ESC}]133;B\x07`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]133;C\x07`))).toEqual([{ type: "cmd-start" }]);
    expect(p.push(enc.encode(`${ESC}]133;C;cmdline_url=echo%20hi%20there\x07`))).toEqual([
      { type: "cmd-start", cmd: "echo hi there" },
    ]);
    expect(p.push(enc.encode(`${ESC}]133;D;7\x1b\\`))).toEqual([{ type: "cmd-end", exit: 7 }]);
    expect(p.push(enc.encode(`${ESC}]133;D\x07`))).toEqual([{ type: "cmd-end", exit: null }]);
  });
});
