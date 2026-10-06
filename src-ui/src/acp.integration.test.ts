import { describe, it, expect } from "vitest";
import { spawn, execSync } from "node:child_process";
import { AcpClient } from "./acp";

/**
 * End-to-end check of the ACP client against the real `opencode acp`.
 * Gated: only runs with MUIS_ACP_IT=1 and opencode on PATH, so CI stays
 * offline. initialize + session/new make no model calls.
 */
function hasOpencode(): boolean {
  try {
    execSync("command -v opencode", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const enabled = process.env.MUIS_ACP_IT === "1" && hasOpencode();

describe.skipIf(!enabled)("AcpClient against real opencode acp", () => {
  it("initializes and creates a session", async () => {
    const proc = spawn("opencode", ["acp"], {
      cwd: process.env.TMPDIR ?? "/tmp",
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buf = "";
    const client = new AcpClient(
      (line) => proc.stdin.write(`${line}\n`),
      {
        onUpdate: () => {},
        onPermission: () => {},
        onSession: () => {},
        onError: () => {},
      },
    );
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i = buf.indexOf("\n");
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) client.receive(line);
        i = buf.indexOf("\n");
      }
    });

    try {
      // opencode acp drops stdin written in the first moments after spawn;
      // wait briefly before the first line (see startAgent in main.ts).
      await new Promise((r) => setTimeout(r, 700));
      await client.initialize();
      const sid = await client.newSession(process.env.TMPDIR ?? "/tmp");
      expect(sid).toMatch(/^ses_/);
      expect(client.session).toBe(sid);
    } finally {
      proc.kill();
    }
  }, 30000);
});
