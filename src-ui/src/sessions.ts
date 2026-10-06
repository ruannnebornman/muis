/**
 * Session store. Mirrors crates/muis-core/src/session.rs: same shapes,
 * same rules (visible-tab clamping, current-workspace clamping).
 * The Rust side is authoritative for persistence; this copy drives the UI.
 */

export interface Tab {
  id: string;
  title: string;
  cwd: string;
  /** User pinned the title; shell OSC 0/2 must not overwrite it. */
  manual?: boolean;
  /** AI tab: relaunch the configured agent when the tab starts. */
  agent?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  dir: string;
  tabs: Tab[];
  active: number;
}

/**
 * Auto-numbered titles ("Terminal 1", ...) are placeholders the shell
 * may replace via OSC 0/2. Anything else is the user's own name and the
 * shell must not overwrite it.
 */
export function isDefaultTitle(title: string): boolean {
  return /^Terminal \d+$/.test(title);
}

/**
 * cwd for a tab spawned from the active tab: follow that tab's live
 * shell-reported cwd (OSC 7), falling back to the workspace dir when
 * there is no active tab to inherit from.
 */
export function newTabCwd(ws: Workspace): string {
  return ws.tabs[ws.active]?.cwd || ws.dir;
}

export class SessionStore {  workspaces: Workspace[] = [];
  current = 0;
  private nextId = 1;

  ensureDefault(name: string, dir: string): void {
    if (this.workspaces.length === 0) {
      this.current = this.addWorkspace(name, dir);
      this.newTab("Terminal 1", dir);
    }
  }

  private mint(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  addWorkspace(name: string, dir: string): number {
    this.workspaces.push({ id: this.mint("w"), name, dir, tabs: [], active: 0 });
    return this.workspaces.length - 1;
  }

  removeWorkspace(index: number): boolean {
    if (index >= this.workspaces.length) return false;
    this.workspaces.splice(index, 1);
    if (this.workspaces.length === 0) this.current = 0;
    else if (this.current >= this.workspaces.length) this.current = this.workspaces.length - 1;
    else if (index < this.current) this.current--;
    return true;
  }

  switch(index: number): boolean {
    if (index >= this.workspaces.length) return false;
    this.current = index;
    return true;
  }

  /**
   * Reorder sessions by moving `from` to final index `to`. The same
   * workspace stays current after the move. Reorder only — never detachable.
   */
  moveWorkspace(from: number, to: number): boolean {
    if (from === to) return false;
    if (!this.inRange(from, this.workspaces.length) || !this.inRange(to, this.workspaces.length)) {
      return false;
    }
    const [w] = this.workspaces.splice(from, 1);
    this.workspaces.splice(to, 0, w);
    if (this.current === from) this.current = to;
    else if (from < this.current && to >= this.current) this.current--;
    else if (from > this.current && to <= this.current) this.current++;
    return true;
  }

  /**
   * Reorder the tabs of one workspace. The dragged active tab stays active.
   */
  moveTab(wsIndex: number, from: number, to: number): boolean {
    const ws = this.workspaces[wsIndex];
    if (!ws) return false;
    if (from === to) return false;
    if (!this.inRange(from, ws.tabs.length) || !this.inRange(to, ws.tabs.length)) return false;
    const [t] = ws.tabs.splice(from, 1);
    ws.tabs.splice(to, 0, t);
    if (ws.active === from) ws.active = to;
    else if (from < ws.active && to >= ws.active) ws.active--;
    else if (from > ws.active && to <= ws.active) ws.active++;
    return true;
  }

  /**
   * Move a tab out of one workspace and append it to another. The moved
   * tab becomes active in the target and the target becomes current. An
   * emptied source workspace is removed.
   */
  moveTabToWorkspace(fromWs: number, tabIndex: number, toWs: number): boolean {
    if (fromWs === toWs) return false;
    const src = this.workspaces[fromWs];
    const dst = this.workspaces[toWs];
    if (!src || !dst) return false;
    if (!this.inRange(tabIndex, src.tabs.length)) return false;
    const [t] = src.tabs.splice(tabIndex, 1);
    dst.tabs.push(t);
    dst.active = dst.tabs.length - 1;
    if (src.tabs.length === 0) {
      this.removeWorkspace(fromWs);
    } else if (tabIndex < src.active) {
      src.active--;
    } else if (src.active >= src.tabs.length) {
      src.active = src.tabs.length - 1;
    }
    this.current = this.workspaces.indexOf(dst);
    return true;
  }

  private inRange(i: number, len: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < len;
  }

  currentWorkspace(): Workspace | undefined {
    return this.workspaces[this.current];
  }

  newTab(title: string, cwd: string): string | undefined {
    const ws = this.currentWorkspace();
    if (!ws) return undefined;
    const id = this.mint("t");
    ws.tabs.push({ id, title, cwd, manual: false });
    ws.active = ws.tabs.length - 1;
    return id;
  }

  closeTab(wsIndex: number, tabIndex: number): boolean {
    const ws = this.workspaces[wsIndex];
    if (!ws || tabIndex >= ws.tabs.length) return false;
    ws.tabs.splice(tabIndex, 1);
    if (ws.tabs.length === 0) {
      // Closing the last tab closes its workspace (session) too.
      this.removeWorkspace(wsIndex);
      return true;
    }
    if (ws.active >= ws.tabs.length) ws.active = ws.tabs.length - 1;
    else if (tabIndex < ws.active) ws.active--;
    return true;
  }

  activeTab(): Tab | undefined {
    const ws = this.currentWorkspace();
    return ws?.tabs[ws.active];
  }

  /** Canonical persistence form. Tab/workspace ids AND the id counter
   *  survive, so restored tabs replay their own snapshot files and no
   *  id is ever reused after resume (matches the Rust store). */
  toJSON(): string {
    return JSON.stringify({
      workspaces: this.workspaces,
      current: this.current,
      next_id: this.nextId,
    });
  }

  static fromJSON(json: string): SessionStore {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error("session file is not JSON");
    }
    if (typeof raw !== "object" || raw === null) throw new Error("session file has no object");
    const r = raw as { workspaces?: unknown; current?: unknown; next_id?: unknown };
    if (!Array.isArray(r.workspaces)) throw new Error("session file has no workspaces");
    const s = new SessionStore();
    s.workspaces = r.workspaces as Workspace[];
    s.current = typeof r.current === "number" ? r.current : 0;
    if (s.current >= s.workspaces.length) s.current = 0;
    s.nextId = typeof r.next_id === "number" && r.next_id > 0 ? Math.floor(r.next_id) : 1;
    // Clamp the counter past every id in the file so resume never reuses one.
    for (const w of s.workspaces) {
      for (const t of [w.id, ...w.tabs.map((t) => t.id)]) {
        const m = /^([a-z]+)(\d+)$/.exec(t ?? "");
        if (m) s.nextId = Math.max(s.nextId, parseInt(m[2], 10) + 1);
      }
    }
    // An empty workspace list is a valid sessionless state (every session
    // was closed), so it loads rather than counting as a corrupt file.
    return s;
  }
}
