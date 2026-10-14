import { describe, it, expect } from "vitest";
import {
  dirsCompatible,
  latchPatch,
  normalizeDir,
  opencodeTitleFromLabel,
  pickSessionByTitle,
  restoreCommand,
  type AgentSessionInfo,
} from "./agentSessions";

const MUIS = "/home/kaazrot/Projects/muis";
const SPIKE = "/tmp/opencode/acp-spike/proj-a";

const sess = (
  id: string,
  title: string,
  directory: string,
  updated = 0,
): AgentSessionInfo => ({ id, title, directory, updated });

describe("normalizeDir", () => {
  it("trims and drops trailing slashes", () => {
    expect(normalizeDir("/a/b/")).toBe("/a/b");
    expect(normalizeDir("  /a/b  ")).toBe("/a/b");
    expect(normalizeDir("/")).toBe("/");
    expect(normalizeDir("")).toBe("");
    expect(normalizeDir(null)).toBe("");
  });
});

describe("dirsCompatible", () => {
  it("accepts equals and parent/child paths", () => {
    expect(dirsCompatible("/a/b", "/a/b/")).toBe(true);
    expect(dirsCompatible("/a/b", "/a/b/c")).toBe(true);
    expect(dirsCompatible("/a/b/c", "/a/b")).toBe(true);
  });

  it("rejects siblings and unrelated paths without a boundary", () => {
    expect(dirsCompatible("/a/b", "/a/c")).toBe(false);
    expect(dirsCompatible("/a/b", "/a/bc")).toBe(false);
    expect(dirsCompatible("/a/b", null)).toBe(false);
    expect(dirsCompatible("", "/a")).toBe(false);
  });
});

describe("latchPatch", () => {
  it("latches a session whose directory matches the tab", () => {
    expect(latchPatch({ cwd: MUIS }, "ses_1", MUIS)).toEqual({
      agentSession: "ses_1",
      agentSessionDir: MUIS,
    });
  });

  it("rejects a session reported from another project", () => {
    expect(latchPatch({ cwd: MUIS }, "ses_spike", SPIKE)).toBeNull();
  });

  it("never clobbers a validated id with a directory-less report", () => {
    expect(latchPatch({ cwd: MUIS, agentSession: "ses_1" }, "ses_2", null)).toBeNull();
  });

  it("fills an empty slot from a directory-less (older-plugin) report", () => {
    expect(latchPatch({ cwd: MUIS }, "ses_1", null)).toEqual({ agentSession: "ses_1" });
  });

  it("records the directory once it learns it for the same session", () => {
    expect(latchPatch({ cwd: MUIS, agentSession: "ses_1" }, "ses_1", MUIS)).toEqual({
      agentSession: "ses_1",
      agentSessionDir: MUIS,
    });
    expect(
      latchPatch({ cwd: MUIS, agentSession: "ses_1", agentSessionDir: MUIS }, "ses_1", MUIS),
    ).toBeNull();
  });

  it("lets a tab switch sessions within the same project", () => {
    expect(
      latchPatch({ cwd: MUIS, agentSession: "ses_1", agentSessionDir: MUIS }, "ses_2", MUIS),
    ).toEqual({ agentSession: "ses_2", agentSessionDir: MUIS });
  });

  it("ignores an empty id", () => {
    expect(latchPatch({ cwd: MUIS }, "", MUIS)).toBeNull();
    expect(latchPatch({ cwd: MUIS }, null, MUIS)).toBeNull();
  });
});

describe("opencodeTitleFromLabel", () => {
  it("strips the window-title prefix and a truncation ellipsis", () => {
    expect(opencodeTitleFromLabel("OC | ACP updates and fixes")).toBe("ACP updates and fixes");
    expect(opencodeTitleFromLabel("OC | Windows 11 SmartScreen blocking muis:…")).toBe(
      "Windows 11 SmartScreen blocking muis:",
    );
    expect(opencodeTitleFromLabel("plain")).toBe("plain");
  });
});

describe("pickSessionByTitle", () => {
  const sessions = [
    sess("ses_acp", "ACP updates and fixes", MUIS, 100),
    sess("ses_spike", "New session - 2026-10-13T14:57:21Z", SPIKE, 200),
    sess("ses_other", "Unrelated", MUIS, 50),
  ];

  it("matches by title, scoped to the tab directory", () => {
    expect(pickSessionByTitle(sessions, "OC | ACP updates and fixes", MUIS)).toBe("ses_acp");
  });

  it("never picks a session from another directory", () => {
    expect(pickSessionByTitle(sessions, "OC | New session", MUIS)).toBeNull();
  });

  it("matches a truncated label by prefix", () => {
    const s = [sess("ses_w", "Windows 11 SmartScreen blocking muis: options", MUIS, 1)];
    expect(pickSessionByTitle(s, "OC | Windows 11 SmartScreen blocking muis:…", MUIS)).toBe(
      "ses_w",
    );
  });

  it("prefers the most recently updated on ties", () => {
    const s = [sess("old", "Same", MUIS, 1), sess("new", "Same", MUIS, 9)];
    expect(pickSessionByTitle(s, "OC | Same", MUIS)).toBe("new");
  });

  it("returns null when nothing matches", () => {
    expect(pickSessionByTitle(sessions, "OC | Nope", MUIS)).toBeNull();
    expect(pickSessionByTitle([], "OC | ACP updates and fixes", MUIS)).toBeNull();
  });
});

describe("restoreCommand", () => {
  const opts = { restored: true, sessions: [], agentCommand: "opencode", agentResumeCommand: "opencode --continue" };
  const base = { agent: true, title: "OC | ACP updates and fixes", cwd: MUIS };

  it("returns nothing for a non-agent tab", () => {
    expect(restoreCommand({ ...base, agent: false }, opts)).toBe("");
  });

  it("starts fresh for a new tab", () => {
    expect(restoreCommand({ ...base }, { ...opts, restored: false })).toBe("opencode");
  });

  it("uses a stored id that the live list confirms for this directory", () => {
    const sessions = [sess("ses_1", "ACP updates and fixes", MUIS)];
    expect(restoreCommand({ ...base, agentSession: "ses_1" }, { ...opts, sessions })).toBe(
      "opencode -s ses_1",
    );
  });

  it("trusts a stored id with a matching directory even when the list is empty", () => {
    expect(
      restoreCommand({ ...base, agentSession: "ses_1", agentSessionDir: MUIS }, opts),
    ).toBe("opencode -s ses_1");
  });

  it("rejects a stored id that belongs to another project and recovers by title", () => {
    // The reported bug: t8 latched a spike session id from another directory.
    const sessions = [
      sess("ses_spike", "New session - 2026-10-13T14:57:21Z", SPIKE, 200),
      sess("ses_acp", "ACP updates and fixes", MUIS, 100),
    ];
    expect(
      restoreCommand({ ...base, agentSession: "ses_spike" }, { ...opts, sessions }),
    ).toBe("opencode -s ses_acp");
  });

  it("falls back to the resume command when nothing matches", () => {
    expect(restoreCommand({ ...base, agentResume: "opencode --continue" }, opts)).toBe(
      "opencode --continue",
    );
    expect(restoreCommand({ ...base }, opts)).toBe("opencode --continue");
  });
});
