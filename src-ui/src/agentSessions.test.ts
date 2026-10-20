import { describe, expect, it } from "vitest";
import {
  dirsCompatible,
  isOpencodeCommand,
  isOpencodeTitle,
  isRestorableAgent,
  latchPatch,
  normalizeDir,
  opencodeTitleFromLabel,
  pickSessionByTitle,
  resolveRestoreSession,
  restoreQueue,
  shouldClearAgentOnCommandEnd,
  validSessionId,
  type AgentSessionInfo,
  applyAgentReport,
} from "./agentSessions";
import type { Tab, Workspace } from "./sessions";

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: "t1",
  title: "Terminal 1",
  cwd: "/home/user/project",
  ...over,
});

const session = (over: Partial<AgentSessionInfo> = {}): AgentSessionInfo => ({
  id: "ses_abc123",
  title: "Fix the clock",
  directory: "/home/user/project",
  ...over,
});

describe("agent session ids and directories", () => {
  it("accepts only ses_ plus alphanumerics", () => {
    expect(validSessionId("ses_abc123")).toBe(true);
    expect(validSessionId("ses_")).toBe(false);
    expect(validSessionId("abc123")).toBe(false);
    expect(validSessionId("ses_ab-c")).toBe(false);
    expect(validSessionId("ses_ab\nrm")).toBe(false);
    expect(validSessionId(null)).toBe(false);
  });

  it("normalizes and compares directories by prefix", () => {
    expect(normalizeDir("/a/b///")).toBe("/a/b");
    expect(normalizeDir("")).toBe("");
    expect(dirsCompatible("/a/b", "/a/b/")).toBe(true);
    expect(dirsCompatible("/a/b/c", "/a/b")).toBe(true);
    expect(dirsCompatible("/a/b", "/a/bc")).toBe(false);
    expect(dirsCompatible("", "/a/b")).toBe(false);
  });
});

describe("latchPatch", () => {
  it("latches a valid id and its directory", () => {
    expect(latchPatch(tab(), "ses_abc123", "/home/user/project")).toEqual({
      agentSession: "ses_abc123",
      agentSessionDir: "/home/user/project",
    });
  });

  it("accepts a directory-less report from the TUI route", () => {
    expect(latchPatch(tab(), "ses_abc123", null)).toEqual({
      agentSession: "ses_abc123",
    });
  });

  it("rejects invalid ids and a different project", () => {
    expect(latchPatch(tab(), "nope", null)).toBeNull();
    expect(latchPatch(tab(), "ses_abc123", "/other/project")).toBeNull();
  });

  it("does nothing when the same session and directory are already set", () => {
    const t = tab({ agentSession: "ses_abc123", agentSessionDir: "/home/user/project" });
    expect(latchPatch(t, "ses_abc123", "/home/user/project")).toBeNull();
    expect(latchPatch(t, "ses_abc123", null)).toBeNull();
    // A newly learned directory is still worth saving.
    expect(latchPatch(tab({ agentSession: "ses_abc123" }), "ses_abc123", "/home/user/project"))
      .toEqual({ agentSession: "ses_abc123", agentSessionDir: "/home/user/project" });
  });
});

describe("agent command recognition", () => {
  it("recognizes opencode directly and through wrappers", () => {
    expect(isOpencodeCommand("opencode")).toBe(true);
    expect(isOpencodeCommand("/usr/local/bin/opencode")).toBe(true);
    expect(isOpencodeCommand("sudo -E opencode --session ses_x")).toBe(true);
    expect(isOpencodeCommand("FOO=1 exec opencode")).toBe(true);
    expect(isOpencodeCommand("env FOO=bar opencode")).toBe(true);
  });

  it("keeps a session through the idle fallback and clears on a real end", () => {
    expect(shouldClearAgentOnCommandEnd(true, "opencode --session ses_x")).toBe(true);
    expect(shouldClearAgentOnCommandEnd(false, "opencode --session ses_x")).toBe(false);
    expect(shouldClearAgentOnCommandEnd(true, "ls")).toBe(false);
  });

  it("does not match opencode in arguments or filenames", () => {
    expect(isOpencodeCommand("cat opencode.log")).toBe(false);
    expect(isOpencodeCommand("echo opencode")).toBe(false);
    expect(isOpencodeCommand("")).toBe(false);
    expect(isOpencodeCommand(null)).toBe(false);
  });
});

describe("opencode title parsing", () => {
  it("strips the route prefix and truncation ellipsis", () => {
    expect(isOpencodeTitle("OC | Fix the clock")).toBe(true);
    expect(isOpencodeTitle("~/project")).toBe(false);
    expect(opencodeTitleFromLabel("OC | Fix the clock")).toBe("Fix the clock");
    expect(opencodeTitleFromLabel("OC | A very long title that was trun…")).toBe(
      "A very long title that was trun",
    );
  });

  it("picks an exact title in the tab's directory before a prefix", () => {
    const sessions = [
      session({ id: "ses_prefix", title: "Fix the clock again" }),
      session({ id: "ses_exact", title: "Fix the clock" }),
      session({ id: "ses_other", title: "Fix the clock", directory: "/elsewhere" }),
      session({ id: "ses_prefix2", title: "Fix the clockwork" }),
      session({ id: "ses_older", title: "An older chat" }),
    ];
    expect(pickSessionByTitle(sessions, "OC | Fix the clock", "/home/user/project")).toBe(
      "ses_exact",
    );
    expect(pickSessionByTitle(sessions, "OC | An older ch", "/home/user/project")).toBe(
      "ses_older",
    );
    expect(pickSessionByTitle(sessions, "OC | Nope", "/home/user/project")).toBeNull();
  });
});

describe("resolveRestoreSession", () => {
  const sessions = [
    session({ id: "ses_exact", title: "Fix the clock" }),
    session({ id: "ses_older", title: "An older chat" }),
  ];

  it("prefers the exact stored id", () => {
    expect(resolveRestoreSession(tab({ agentSession: "ses_older" }), sessions)).toBe("ses_older");
  });

  it("falls back to the title when the stored id is gone", () => {
    expect(
      resolveRestoreSession(
        tab({ agentSession: "ses_deleted", agentTitle: "Fix the clock" }),
        sessions,
      ),
    ).toBe("ses_exact");
  });

  it("never launches a deleted session that also has no title match", () => {
    expect(resolveRestoreSession(tab({ agentSession: "ses_deleted" }), sessions)).toBeNull();
  });

  it("does not launch a session from another directory", () => {
    expect(
      resolveRestoreSession(
        tab({ cwd: "/elsewhere", agentSession: "ses_exact" }),
        sessions,
      ),
    ).toBeNull();
  });

  it("does nothing for a plain shell tab", () => {
    expect(resolveRestoreSession(tab(), sessions)).toBeNull();
  });
});

describe("restoreQueue", () => {
  const ws = (id: string, active: number, tabs: Tab[]): Workspace => ({
    id,
    name: id,
    dir: "/p",
    tabs,
    active,
  });

  it("queues only tabs with agent metadata", () => {
    const workspaces = [
      ws("a", 0, [
        tab({ id: "plain" }),
        tab({ id: "exact", agentSession: "ses_x" }),
        tab({ id: "title", agentTitle: "Fix the clock" }),
      ]),
    ];
    expect(restoreQueue(workspaces, 0).map((e) => e.tabId)).toEqual(["exact", "title"]);
    expect(isRestorableAgent(tab())).toBe(false);
    expect(isRestorableAgent(tab({ agentSession: "ses_x" }))).toBe(true);
  });

  it("orders the visible tab, the current workspace, then the rest", () => {
    const workspaces = [
      ws("a", 1, [
        tab({ id: "a0" }),
        tab({ id: "a1", agentSession: "ses_a1" }),
        tab({ id: "a2", agentSession: "ses_a2" }),
      ]),
      ws("b", 0, [tab({ id: "b0", agentSession: "ses_b0" })]),
    ];
    expect(restoreQueue(workspaces, 0).map((e) => e.tabId)).toEqual(["a1", "a2", "b0"]);
  });

  it("never resurrects a closed tab", () => {
    const closed = tab({ id: "gone", agentSession: "ses_gone" });
    const workspaces = [ws("a", 0, [tab({ id: "kept", agentSession: "ses_kept" })])];
    // The closed tab simply is not in the store anymore.
    expect(workspaces[0].tabs).not.toContain(closed);
    expect(restoreQueue(workspaces, 0).map((e) => e.tabId)).toEqual(["kept"]);
  });
});

describe("applyAgentReport", () => {
  const workspaces = (): Workspace[] => [{
    id: "w1",
    name: "home",
    dir: "/p",
    active: 0,
    tabs: [tab({
      agentSession: "ses_old",
      agentSessionDir: "/home/user/project",
      agentTitle: "Old",
    })],
  }];

  it("latches a new exact session and keeps the title for fallback", () => {
    const ws = workspaces();
    expect(applyAgentReport(ws, "t1", "ses_new", "/home/user/project")).toBe("latched");
    expect(ws[0].tabs[0].agentSession).toBe("ses_new");
    expect(ws[0].tabs[0].agentSessionDir).toBe("/home/user/project");
    expect(ws[0].tabs[0].agentTitle).toBe("Old");
  });

  it("clears session and title when opencode goes home", () => {
    const ws = workspaces();
    expect(applyAgentReport(ws, "t1", null, null)).toBe("cleared");
    expect(ws[0].tabs[0].agentSession).toBeUndefined();
    expect(ws[0].tabs[0].agentSessionDir).toBeUndefined();
    expect(ws[0].tabs[0].agentTitle).toBeUndefined();
    // Clearing twice changes nothing.
    expect(applyAgentReport(ws, "t1", null, null)).toBe("ignored");
  });

  it("ignores unknown tabs, invalid ids, and other directories", () => {
    const ws = workspaces();
    expect(applyAgentReport(ws, "missing", "ses_x", null)).toBe("ignored");
    expect(applyAgentReport(ws, "t1", "bad", null)).toBe("ignored");
    expect(applyAgentReport(ws, "t1", "ses_x", "/elsewhere")).toBe("ignored");
    expect(ws[0].tabs[0].agentSession).toBe("ses_old");
  });
});
