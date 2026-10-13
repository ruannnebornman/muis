import { describe, it, expect } from "vitest";
import { spawn, execSync } from "node:child_process";
import { AcpConnection, AcpClient } from "./acp";

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

describe.skipIf(!enabled)("AcpConnection against real opencode acp", () => {
  it("initializes and hosts two concurrent sessions on one process", async () => {
    const cwd = process.env.TMPDIR ?? "/tmp";
    const proc = spawn("opencode", ["acp"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buf = "";
    const conn = new AcpConnection((line) => proc.stdin.write(`${line}\n`));
    const noop = {
      onUpdate: () => {},
      onPermission: () => {},
      onSession: () => {},
      onConfig: () => {},
      onError: () => {},
    };
    const a = new AcpClient(conn, noop);
    const b = new AcpClient(conn, noop);
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i = buf.indexOf("\n");
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) conn.receive(line);
        i = buf.indexOf("\n");
      }
    });

    try {
      // opencode acp can drop stdin written before it is ready; retry the
      // handshake exactly like startAgent in main.ts does.
      let handshaken = false;
      for (let attempt = 0; attempt < 8 && !handshaken; attempt++) {
        try {
          await conn.initialize(1500);
          handshaken = true;
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      expect(handshaken).toBe(true);
      const [sidA, sidB] = await Promise.all([a.newSession(cwd), b.newSession(cwd)]);
      expect(sidA).toMatch(/^ses_/);
      expect(sidB).toMatch(/^ses_/);
      expect(sidA).not.toBe(sidB);
      expect(a.session).toBe(sidA);
      expect(b.session).toBe(sidB);
    } finally {
      proc.kill();
    }
  }, 30000);
});
