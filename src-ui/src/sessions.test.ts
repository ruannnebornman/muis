import { describe, expect, it } from "vitest";
import { SessionStore, isDefaultTitle, type Workspace } from "./sessions";

function store(): SessionStore {
  const s = new SessionStore();
  s.ensureDefault("home", "/home/kaazrot");
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
    s.newTab("Terminal 2", "/home/kaazrot");
    s.addWorkspace("veldmuis", "/home/kaazrot/Documents/code/veldmuis");
    s.switch(1);
    s.newTab("v1", "/home/kaazrot/Documents/code/veldmuis");
    s.newTab("v2", "/home/kaazrot/Documents/code/veldmuis");
    s.switch(0);
    expect(s.activeTab()?.title).toBe("Terminal 2");
    s.switch(1);
    expect(s.activeTab()?.title).toBe("v2");
  });

  it("clamps the visible tab on close", () => {
    const s = store();
    s.newTab("Terminal 2", "/home/kaazrot");
    s.newTab("Terminal 3", "/home/kaazrot");
    expect(s.closeTab(0, 2)).toBe(true);
    expect(s.activeTab()?.title).toBe("Terminal 2");
    expect(s.closeTab(0, 5)).toBe(false);
  });

  it("closes the session when its last tab closes", () => {
    const s = store();
    expect(s.closeTab(0, 0)).toBe(true);
    expect(s.workspaces.length).toBe(0);
    expect(s.activeTab()).toBeUndefined();
    expect(s.currentWorkspace()).toBeUndefined();
    // A tab needs a workspace; adding one restores the invariant.
    expect(s.newTab("x", "/tmp")).toBeUndefined();
    const idx = s.addWorkspace("fresh", "/tmp");
    expect(s.newTab("x", "/tmp")).toBeDefined();
    expect(s.current).toBe(idx);
  });

  it("switches to a neighbor when the active session closes", () => {
    const s = store();
    s.addWorkspace("b", "/tmp/b");
    s.switch(1);
    s.newTab("b1", "/tmp/b");
    s.addWorkspace("c", "/tmp/c");
    s.switch(2);
    s.newTab("c1", "/tmp/c");
    s.switch(1);
    expect(s.closeTab(1, 0)).toBe(true);
    expect(s.workspaces.length).toBe(2);
    expect(s.currentWorkspace()?.name).toBe("c");
    expect(s.activeTab()?.title).toBe("c1");
  });

  it("serializes to the same shape as the Rust store", () => {
    const s = store();
    const back = JSON.parse(s.toJSON()) as { workspaces: Workspace[] };
    expect(back.workspaces[0].name).toBe("home");
    expect(back.workspaces[0].tabs[0].cwd).toBe("/home/kaazrot");
  });

  it("roundtrips through toJSON/fromJSON without reusing ids", () => {
    const s = store();
    s.newTab("Terminal 2", "/tmp");
    const back = SessionStore.fromJSON(s.toJSON());
    expect(back.workspaces.length).toBe(1);
    expect(back.activeTab()?.title).toBe("Terminal 2");
    // Counter continues past restored ids.
    const id = back.newTab("Terminal 3", "/tmp");
    expect(id).not.toBe("t1");
    expect(id).not.toBe("t2");
  });
  it("rejects corrupt session files instead of starting broken", () => {
    expect(() => SessionStore.fromJSON("not json")).toThrow();
    expect(() => SessionStore.fromJSON('{"nope":1}')).toThrow();
  });

  it("loads an empty workspace list as the sessionless state", () => {
    const s = SessionStore.fromJSON('{"workspaces":[],"current":0,"next_id":1}');
    expect(s.workspaces.length).toBe(0);
    expect(s.activeTab()).toBeUndefined();
    expect(s.currentWorkspace()).toBeUndefined();
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
    const back = SessionStore.fromJSON(s.toJSON());
    expect(back.activeTab()?.manual).toBe(true);
  });
});
