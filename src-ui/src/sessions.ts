/**
 * Session store. Mirrors crates/muis-core/src/session.rs: same shapes,
 * same rules (visible-tab clamping, current-workspace clamping).
 * The Rust side is authoritative for persistence; this copy drives the UI.
 */

export interface Tab {
  id: string;
  title: string;
  cwd: string;
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

  currentWorkspace(): Workspace | undefined {
    return this.workspaces[this.current];
  }

  newTab(title: string, cwd: string): string | undefined {
    const ws = this.currentWorkspace();
    if (!ws) return undefined;
    const id = this.mint("t");
    ws.tabs.push({ id, title, cwd });
    ws.active = ws.tabs.length - 1;
    return id;
  }

  closeTab(wsIndex: number, tabIndex: number): boolean {
    const ws = this.workspaces[wsIndex];
    if (!ws || tabIndex >= ws.tabs.length) return false;
    ws.tabs.splice(tabIndex, 1);
    if (ws.tabs.length === 0) ws.active = 0;
    else if (ws.active >= ws.tabs.length) ws.active = ws.tabs.length - 1;
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
    if (s.workspaces.length === 0) throw new Error("session file has no workspaces");
    return s;
  }
}
