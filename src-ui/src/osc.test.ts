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

  it("reads OSC 9 notifications with BEL or ST terminators", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]9;Build complete\x07`))).toEqual([
      { type: "notify", title: null, body: "Build complete", source: "osc9" },
    ]);
    expect(p.push(enc.encode(`${ESC}]9;needs input\x1b\\`))).toEqual([
      { type: "notify", title: null, body: "needs input", source: "osc9" },
    ]);
  });

  it("keeps semicolons in OSC 9 bodies but ignores ConEmu subcommands", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]9;a;b;c\x07`))).toEqual([
      { type: "notify", title: null, body: "a;b;c", source: "osc9" },
    ]);
    // 9;4 progress and 9;9 cwd are ConEmu extensions, not notifications.
    expect(p.push(enc.encode(`${ESC}]9;4;1;50\x07`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]9;9;/home/kaazrot\x07`))).toEqual([]);
  });

  it("reads OSC 777 notify with separate title and body", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]777;notify;Deploy;Success on prod\x07`))).toEqual([
      { type: "notify", title: "Deploy", body: "Success on prod", source: "osc777" },
    ]);
    // Body may itself contain semicolons; keep them.
    expect(p.push(enc.encode(`${ESC}]777;notify;T;a;b\x07`))).toEqual([
      { type: "notify", title: "T", body: "a;b", source: "osc777" },
    ]);
    // Title-only is allowed.
    expect(p.push(enc.encode(`${ESC}]777;notify;Heads up;\x07`))).toEqual([
      { type: "notify", title: "Heads up", body: "", source: "osc777" },
    ]);
  });

  it("ignores non-notify OSC 777 and empty notifications", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]777;container;abc\x07`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]777;notify;;\x07`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]9;   \x07`))).toEqual([]);
  });

  it("reassembles notification sequences split across chunks", () => {
    const p = new OscParser();
    const full = enc.encode(`x${ESC}]777;notify;Long;done now\x07y`);
    expect(p.push(full.slice(0, 10))).toEqual([]);
    expect(p.push(full.slice(10))).toEqual([
      { type: "notify", title: "Long", body: "done now", source: "osc777" },
    ]);
  });

  it("reads OSC 99 single-shot title and body", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]99;i=1;Hello\x1b\\`))).toEqual([
      { type: "notify", title: "Hello", body: "", source: "osc99" },
    ]);
    expect(p.push(enc.encode(`${ESC}]99;i=2:p=body;just body\x07`))).toEqual([
      { type: "notify", title: null, body: "just body", source: "osc99" },
    ]);
  });

  it("assembles OSC 99 title and body fragments by id", () => {
    const p = new OscParser();
    const both = p.push(
      enc.encode(
        `${ESC}]99;i=42:d=0:p=title;Build finished\x1b\\` +
          `${ESC}]99;i=42:p=body;42 files compiled in 3.7s\x1b\\`,
      ),
    );
    expect(both).toEqual([
      { type: "notify", title: "Build finished", body: "42 files compiled in 3.7s", source: "osc99" },
    ]);
  });

  it("defers OSC 99 fragments until a done fragment arrives", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]99;i=11:d=0:p=title;Hi\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=11:d=0:p=body; there\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=11:d=1:p=body;!\x1b\\`))).toEqual([
      { type: "notify", title: "Hi", body: " there!", source: "osc99" },
    ]);
  });

  it("decodes OSC 99 base64 payloads and urgency", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]99;i=7:p=body:e=1;aGVsbG8gd29ybGQ=\x1b\\`))).toEqual([
      { type: "notify", title: null, body: "hello world", source: "osc99" },
    ]);
    expect(p.push(enc.encode(`${ESC}]99;i=8:p=body:u=2;critical\x1b\\`))).toEqual([
      { type: "notify", title: null, body: "critical", source: "osc99", urgency: 2 },
    ]);
  });

  it("ignores OSC 99 queries and non-title/body payloads", () => {
    const p = new OscParser();
    expect(p.push(enc.encode(`${ESC}]99;i=9:p=?;\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=9:p=close;\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=9:p=icon;data\x1b\\`))).toEqual([]);
  });

  it("reassembles OSC 99 sequences split across chunks and decodes UTF-8", () => {
    const p = new OscParser();
    const full = enc.encode(`${ESC}]99;i=13:p=body;café done\x1b\\`);
    expect(p.push(full.slice(0, 12))).toEqual([]);
    expect(p.push(full.slice(12))).toEqual([
      { type: "notify", title: null, body: "café done", source: "osc99" },
    ]);
  });

  it("drops oversized OSC 99 trains and recovers for the next id", () => {
    const p = new OscParser();
    const chunk = "a".repeat(3000);
    expect(p.push(enc.encode(`${ESC}]99;i=5:d=0:p=title;${chunk}\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=5:d=0:p=body;${chunk}\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=5:d=1:p=body;${chunk}\x1b\\`))).toEqual([]);
    expect(p.push(enc.encode(`${ESC}]99;i=6:p=body;ok\x1b\\`))).toEqual([
      { type: "notify", title: null, body: "ok", source: "osc99" },
    ]);
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
