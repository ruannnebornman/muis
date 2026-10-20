import { describe, expect, it } from "vitest";
import { SESSION_FILE_VERSION, SessionStore, isDefaultTitle, newTabCwd, type Workspace } from "./sessions";

function store(): SessionStore {
  const s = new SessionStore();
  s.ensureDefault("home", "/home/user");
  return s;
}

describe("SessionStore", () => {
  it("starts with one workspace and one tab", () => {
    const s = store();
    expect(s.workspaces.length).toBe(1);
    expect(s.activeTab()?.title).toBe("Terminal 1");
  });

  it("rejects out-of-range switches", () => {
    const s = store();
    expect(s.switch(7)).toBe(false);
    expect(s.current).toBe(0);
  });

  it("keeps a visible tab per workspace across rapid switching", () => {
    const s = store();
    s.newTab("Terminal 2", "/home/user");
    s.addWorkspace("veldmuis", "/home/user/Projects/veldmuis");
    s.switch(1);
    s.newTab("v1", "/home/user/Projects/veldmuis");
    s.newTab("v2", "/home/user/Projects/veldmuis");
    s.switch(0);
    expect(s.activeTab()?.title).toBe("Terminal 2");
    s.switch(1);
    expect(s.activeTab()?.title).toBe("v2");
  });

  it("clamps the visible tab on close", () => {
    const s = store();
    s.newTab("Terminal 2", "/home/user");
    s.newTab("Terminal 3", "/home/user");
    expect(s.closeTab(0, 2)).toBe(true);
    expect(s.activeTab()?.title).toBe("Terminal 2");
    expect(s.closeTab(0, 5)).toBe(false);
  });

  it("keeps the session open when its last tab closes", () => {
    const s = store();
    expect(s.closeTab(0, 0)).toBe(true);
    expect(s.workspaces.length).toBe(1);
    expect(s.currentWorkspace()?.name).toBe("home");
    expect(s.currentWorkspace()?.tabs.length).toBe(0);
    expect(s.activeTab()).toBeUndefined();
    // A new tab seeds from the session dir when there is no active tab.
    const ws = s.currentWorkspace()!;
    expect(s.newTab("Terminal 1", newTabCwd(ws))).toBeDefined();
    expect(s.activeTab()?.cwd).toBe("/home/user");
  });

  it("keeps an emptied session current when its last tab closes", () => {
    const s = store();
    s.addWorkspace("b", "/tmp/b");
    s.switch(1);
    s.newTab("b1", "/tmp/b");
    s.addWorkspace("c", "/tmp/c");
    s.switch(2);
    s.newTab("c1", "/tmp/c");
    s.switch(1);
    expect(s.closeTab(1, 0)).toBe(true);
    expect(s.workspaces.length).toBe(3);
    expect(s.currentWorkspace()?.name).toBe("b");
    expect(s.currentWorkspace()?.tabs.length).toBe(0);
    expect(s.activeTab()).toBeUndefined();
  });





  it("knows placeholder titles from user names", () => {
    expect(isDefaultTitle("Terminal 1")).toBe(true);
    expect(isDefaultTitle("Terminal 23")).toBe(true);
    expect(isDefaultTitle("dev")).toBe(false);
    expect(isDefaultTitle("Terminal X")).toBe(false);
    expect(isDefaultTitle("~/D/c/veldmuis")).toBe(false);
  });

  it("defaults tabs to auto title and preserves a manual pin", () => {
    const s = store();
    expect(s.activeTab()?.manual).toBe(false);
    const t = s.activeTab();
    if (t) t.manual = true;
    expect(s.activeTab()?.manual).toBe(true);
  });

  it("new tabs follow the active tab's live cwd", () => {
    const s = store();
    const tab = s.activeTab();
    if (tab) tab.cwd = "/tmp/from-shell";
    expect(newTabCwd(s.currentWorkspace()!)).toBe("/tmp/from-shell");
  });

  it("reorders sessions and keeps the same workspace current", () => {
    const s = store();
    s.addWorkspace("b", "/tmp/b");
    s.addWorkspace("c", "/tmp/c");
    s.switch(2); // c current
    expect(s.moveWorkspace(0, 2)).toBe(true); // home -> end
    expect(s.workspaces.map((w) => w.name)).toEqual(["b", "c", "home"]);
    expect(s.currentWorkspace()?.name).toBe("c");
    expect(s.moveWorkspace(0, 9)).toBe(false);
    expect(s.moveWorkspace(1, 1)).toBe(false);
  });

  it("reorders tabs and keeps the active tab active", () => {
    const s = store();
    s.newTab("T2", "/tmp");
    s.newTab("T3", "/tmp");
    // tabs [Terminal 1, T2, T3], active = T3
    expect(s.moveTab(0, 0, 2)).toBe(true);
    expect(s.currentWorkspace()!.tabs.map((t) => t.title)).toEqual(["T2", "T3", "Terminal 1"]);
    expect(s.activeTab()?.title).toBe("T3");
    expect(s.moveTab(0, 0, 9)).toBe(false);
    expect(s.moveTab(0, 1, 1)).toBe(false);
  });

  it("moves a tab into another session and switches to it", () => {
    const s = store();
    s.newTab("T2", "/tmp"); // home: [Terminal 1, T2], active T2 (index 1)
    s.addWorkspace("b", "/tmp/b");
    s.switch(1);
    s.newTab("b1", "/tmp/b"); // b: [b1]
    s.switch(0);
    expect(s.moveTabToWorkspace(0, 1, 1)).toBe(true);
    expect(s.workspaces[0].tabs.map((t) => t.title)).toEqual(["Terminal 1"]);
    expect(s.workspaces[1].tabs.map((t) => t.title)).toEqual(["b1", "T2"]);
    expect(s.workspaces[1].active).toBe(1);
    expect(s.currentWorkspace()?.name).toBe("b");
    expect(s.moveTabToWorkspace(1, 0, 1)).toBe(false);
  });

  it("removes the source session when its last tab is moved out", () => {
    const s = store();
    s.addWorkspace("b", "/tmp/b");
    s.switch(1);
    s.newTab("b1", "/tmp/b"); // b: [b1]
    s.switch(0); // home: [Terminal 1]
    expect(s.moveTabToWorkspace(0, 0, 1)).toBe(true);
    expect(s.workspaces.length).toBe(1);
    expect(s.currentWorkspace()?.name).toBe("b");
    expect(s.currentWorkspace()!.tabs.map((t) => t.title)).toEqual(["b1", "Terminal 1"]);
  });

  it("new tabs fall back to the workspace dir without a live tab", () => {
    const ws: Workspace = { id: "w1", name: "home", dir: "/home/user", tabs: [], active: 0 };
    expect(newTabCwd(ws)).toBe("/home/user");
    ws.tabs.push({ id: "t1", title: "Terminal 1", cwd: "", manual: false });
    expect(newTabCwd(ws)).toBe("/home/user");
  });
});

describe("SessionStore persistence", () => {
  it("roundtrips workspaces, tabs, indices, and agent metadata", () => {
    const s = store();
    s.newTab("agent", "/home/user/project");
    const t = s.activeTab()!;
    t.manual = true;
    t.agentSession = "ses_abc123";
    t.agentSessionDir = "/home/user/project";
    t.agentTitle = "Fix the clock";
    s.addWorkspace("other", "/tmp");
    s.switch(1);
    s.newTab("o1", "/tmp");
    s.switch(0);

    const back = SessionStore.fromJSON(s.toJSON());
    expect(back.current).toBe(0);
    expect(back.workspaces.map((w) => w.name)).toEqual(["home", "other"]);
    expect(back.activeTab()?.title).toBe("agent");
    expect(back.activeTab()?.manual).toBe(true);
    expect(back.activeTab()?.agentSession).toBe("ses_abc123");
    expect(back.activeTab()?.agentSessionDir).toBe("/home/user/project");
    expect(back.activeTab()?.agentTitle).toBe("Fix the clock");
  });

  it("drops a closed tab from the serialized form", () => {
    const s = store();
    const id = s.newTab("agent", "/home/user/project");
    s.activeTab()!.agentSession = "ses_abc123";
    const index = s.currentWorkspace()!.tabs.findIndex((t) => t.id === id);
    s.closeTab(0, index);
    const back = SessionStore.fromJSON(s.toJSON());
    expect(back.currentWorkspace()?.tabs.some((t) => t.id === id)).toBe(false);
    expect(back.currentWorkspace()?.tabs.some((t) => t.agentSession)).toBe(false);
  });

  it("loads an empty workspace list instead of minting a default", () => {
    const back = SessionStore.fromJSON('{"workspaces":[],"current":0,"next_id":1}');
    expect(back.workspaces.length).toBe(0);
    expect(back.activeTab()).toBeUndefined();
  });

  it("clamps bad indices and drops malformed tabs/workspaces", () => {
    const json = JSON.stringify({
      workspaces: [
        null,
        { id: "w1", name: "home", dir: "/home", active: 99, tabs: [null, { id: "t1" }] },
      ],
      current: 9,
      next_id: 0,
    });
    const back = SessionStore.fromJSON(json);
    expect(back.workspaces.length).toBe(1);
    expect(back.workspaces[0].tabs.length).toBe(0);
    expect(back.workspaces[0].active).toBe(0);
    expect(back.current).toBe(0);
  });

  it("treats a file with no usable workspaces as corrupt", () => {
    expect(() => SessionStore.fromJSON('{"workspaces":[null,{}],"current":0,"next_id":1}'))
      .toThrow();
  });

  it("writes a version and refuses a newer one", () => {
    const s = store();
    const parsed = JSON.parse(s.toJSON()) as { version: number };
    expect(parsed.version).toBe(1);
    expect(SessionStore.fromJSON(s.toJSON()).workspaces.length).toBe(1);
    // Legacy files (no version) still load.
    const legacy = JSON.stringify({
      workspaces: [{ id: "w1", name: "home", dir: "/home", active: 0, tabs: [] }],
      current: 0,
      next_id: 1,
    });
    expect(SessionStore.fromJSON(legacy).workspaces.length).toBe(1);
    expect(() =>
      SessionStore.fromJSON(
        JSON.stringify({ version: 99, workspaces: [], current: 0, next_id: 1 }),
      ),
    ).toThrow();
  });

  it("rejects malformed top-level JSON", () => {
    expect(() => SessionStore.fromJSON("not json")).toThrow();
    expect(() => SessionStore.fromJSON("{}")).toThrow();
    expect(() => SessionStore.fromJSON('{"workspaces":{}}')).toThrow();
  });

  it("never accepts a non-ses session id from disk", () => {
    const json = JSON.stringify({
      workspaces: [{
        id: "w1",
        name: "home",
        dir: "/home",
        active: 0,
        tabs: [{
          id: "t1",
          title: "x",
          cwd: "/home",
          agentSession: "rm -rf /",
          agentSessionDir: "/home",
          agentTitle: "x",
        }],
      }],
      current: 0,
      next_id: 2,
    });
    const back = SessionStore.fromJSON(json);
    expect(back.activeTab()?.agentSession).toBeUndefined();
    // The title is still usable as a fallback.
    expect(back.activeTab()?.agentTitle).toBe("x");
  });

  it("continues ids past every restored id", () => {
    const s = store();
    s.newTab("T2", "/tmp");
    const back = SessionStore.fromJSON(s.toJSON());
    const id = back.newTab("T3", "/tmp");
    expect(id).not.toBe("t1");
    expect(id).not.toBe("t2");
  });
});
