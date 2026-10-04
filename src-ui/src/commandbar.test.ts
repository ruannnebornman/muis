import { describe, expect, it } from "vitest";
import { CommandTracker, tabLabel } from "./commandbar";

function tracker() {
  let t = 1000;
  const tr = new CommandTracker(() => t);
  return { tr, tick: (ms: number) => (t += ms) };
}

describe("CommandTracker", () => {
  it("starts on Enter with the typed command and ignores escapes", () => {
    const { tr, tick } = tracker();
    expect(tr.onInput("t", "ls -l")).toBe(false);
    expect(tr.onInput("t", "\x1b[A")).toBe(false); // arrow up
    expect(tr.onInput("t", "\r")).toBe(true);
    const st = tr.state("t");
    expect(st.running).toBe(true);
    expect(st.lastCmd).toBe("ls -l");
    tick(20);
    tr.onCmdEnd("t", 0);
    expect(tr.state("t").running).toBe(false);
    expect(tr.state("t").lastMs).toBe(20);
  });

  it("handles backspace and ctrl-c while typing", () => {
    const { tr } = tracker();
    tr.onInput("t", "echo x");
    tr.onInput("t", "\x7f\x7f");
    tr.onInput("t", "\x15"); // ctrl-u clears
    tr.onInput("t", "pwd\r");
    expect(tr.state("t").lastCmd).toBe("pwd");
  });

  it("lets the shell-reported command overwrite a provisional keystroke line", () => {
    const { tr } = tracker();
    tr.onInput("t", "cd in\r"); // user typed + Enter (before completion)
    expect(tr.state("t").lastCmd).toBe("cd in");
    tr.onCmdStart("t", "cd info/"); // fish rewrote the line
    expect(tr.state("t").lastCmd).toBe("cd info/");
    expect(tr.state("t").sawOsc).toBe(true);
  });

  it("marks OSC so the idle fallback stands down", () => {
    const { tr } = tracker();
    tr.onCmdStart("t", "sleep 5");
    expect(tr.state("t").sawOsc).toBe(true);
    expect(tr.state("t").running).toBe(true);
  });

  it("ignores a second end and a stray end", () => {
    const { tr } = tracker();
    tr.onCmdEnd("t", 0);
    expect(tr.state("t").lastExit).toBeNull();
    tr.onCmdStart("t", "make");
    tr.onCmdEnd("t", 2);
    tr.onCmdEnd("t", 9);
    expect(tr.state("t").lastExit).toBe(2);
  });

  it("forgets a tab", () => {
    const { tr } = tracker();
    tr.onCmdStart("t", "x");
    tr.forget("t");
    expect(tr.state("t").running).toBe(false);
    expect(tr.state("t").lastCmd).toBeNull();
  });
});

describe("tabLabel", () => {
  it("shows the last command, falling back to the shell title", () => {
    expect(tabLabel("~/code", false, "cargo test")).toBe("cargo test");
    expect(tabLabel("~/code", undefined, null)).toBe("~/code");
  });

  it("prefers a meaningful shell title over the last command", () => {
    // opencode-style session title wins; fish's cwd path is ignored.
    expect(tabLabel("opencode · fix bug", false, "opencode")).toBe("opencode · fix bug");
    expect(tabLabel("Terminal 1", false, null)).toBe("Terminal 1");
    expect(tabLabel("~/Documents/code/muis", false, "ls")).toBe("ls");
    expect(tabLabel("/etc", false, "ls")).toBe("ls");
  });

  it("keeps a pinned (manual) name", () => {
    expect(tabLabel("deploy", true, "cargo test")).toBe("deploy");
  });
});
