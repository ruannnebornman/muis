import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SessionStore, isDefaultTitle, type Tab, type Workspace } from "./sessions";
import { xtermTheme, colorFor, MUIS_THEME } from "./theme";
import { defaultConfig, configFromJSON, effectiveFontSize, type AppConfig } from "./config";
import { WorkerClient, type Transport } from "./worker";
import { SearchController } from "./search";
import { SidePanelRegistry } from "./panels";
import { newActivityState, isTabBusy, anyTabBusy, forgetTab } from "./activity";
import { OscParser } from "./osc";
import type { UiToWorker, WorkerToUi } from "./ipc";
import { b64encode, b64decode } from "./ipc";
import "./style.css";

/**
 * muis frontend — a live mirror of ../wezterm-web/index.html.
 *
 * Chrome uses the mock's exact elements/classes (.titlebar, .sidebar,
 * .session, .tabbar, .tab, .statusbar, .search). Each tab owns one
 * xterm.js surface backed by a pty in the session's muis-worker.
 * Outside Tauri (plain browser dev) tabs echo.
 */

const IN_TAURI = "__TAURI_INTERNALS__" in window;

function reportDebugStage(stage: string, detail: unknown = undefined): void {
  if (!IN_TAURI) return;
  void invoke("debug_report", {
    json: JSON.stringify({ stage, detail }),
  }).catch(() => {});
}

if (IN_TAURI) {
  reportDebugStage("frontend-module-loaded");
  window.addEventListener("error", (event) => {
    reportDebugStage("frontend-error", String(event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportDebugStage("frontend-unhandled-rejection", String(event.reason));
  });
}

class TauriTransport implements Transport {
  private handler: ((sessionId: string, frame: WorkerToUi) => void) | null = null;

  constructor() {
    // A rejected listen() means worker output can never arrive — record
    // it where debug_report() will pick it up (no devtools in release).
    void listen<{ session_id: string; frame: WorkerToUi }>("muis-worker-event", (e) => {
      this.handler?.(e.payload.session_id, e.payload.frame);
    }).catch((e: unknown) => {
      const w = window as unknown as { __muisErrors?: string[] };
      w.__muisErrors ??= [];
      w.__muisErrors.push(`event-listen failed: ${String(e)}`);
    });
  }

  async spawn(sessionId: string): Promise<void> {
    await invoke("worker_spawn", { sessionId });
  }

  async send(sessionId: string, msg: UiToWorker): Promise<void> {
    await invoke("worker_send", { sessionId, line: JSON.stringify(msg) });
  }

  async stop(sessionId: string): Promise<void> {
    await invoke("worker_stop", { sessionId });
  }

  onEvent(cb: (sessionId: string, frame: WorkerToUi) => void): void {
    this.handler = cb;
  }
}

class EchoTransport implements Transport {
  private handler: ((sessionId: string, frame: WorkerToUi) => void) | null = null;

  async spawn(): Promise<void> {}
  async stop(): Promise<void> {}
  onEvent(cb: (sessionId: string, frame: WorkerToUi) => void): void {
    this.handler = cb;
  }
  async send(sessionId: string, msg: UiToWorker): Promise<void> {
    if (msg.type === "write" && this.handler) {
      this.handler(sessionId, { type: "output", pty_id: msg.pty_id, data_b64: msg.data_b64 });
    }
  }
}

let store = new SessionStore();
const client = new WorkerClient(IN_TAURI ? new TauriTransport() : new EchoTransport());

/** View options; loaded from disk in init, edited in the settings dialog. */
let cfg: AppConfig = defaultConfig();

/** Pty liveness for dirty-tab / quit confirmations. */
const activity = newActivityState();

/** One OSC observer per tab (sequences split across frames reassemble). */
const oscParsers = new Map<string, OscParser>();

/**
 * Reserved extension slot (Snor assistant and future panels). Panels
 * dock right of the terminal; nothing is registered yet, so the slot
 * stays invisible until panel code lands.
 */
export const sidePanels = new SidePanelRegistry();

let shellCache: string | null = null;
let liveTestCommandCache: Promise<string | null> | null = null;
const liveTestCommandSent = new Set<string>();

/** Debug-build-only PTY input requested by the native Xvfb harness. */
function liveTestCommand(): Promise<string | null> {
  if (!IN_TAURI) return Promise.resolve(null);
  liveTestCommandCache ??= invoke<string | null>("live_test_command").catch(() => null);
  return liveTestCommandCache;
}

async function defaultShell(): Promise<string> {
  if (shellCache) return shellCache;
  try {
    shellCache = await invoke<string>("default_shell");
  } catch {
    shellCache = "/bin/sh";
  }
  return shellCache;
}

function shellBaseName(): string {
  const shell = shellCache ?? "";
  const parts = shell.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "shell";
}

interface TabView {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  box: HTMLElement;
}

const views = new Map<string, TabView>();

/** Scrollback search follows the visible tab. */
function activeSearch() {
  const ws = store.currentWorkspace();
  const active = ws?.tabs[ws.active];
  const view = active ? views.get(active.id) : undefined;
  return view?.search;
}
const searcher = new SearchController(activeSearch);

function shortPath(p: string): string {
  return p.replace(/^\/home\/kaazrot/, "~");
}

const enc = new TextEncoder();

/* ---------------- static skeleton (mock .window) ---------------- */

const app = document.getElementById("app")!;

const titlebar = document.createElement("div");
titlebar.className = "titlebar";
const tbLeft = document.createElement("div");
tbLeft.className = "tb-left";
if (IN_TAURI) tbLeft.setAttribute("data-tauri-drag-region", "");
const appIcon = document.createElement("div");
appIcon.className = "app-icon";
appIcon.textContent = "❯_";
const appTitle = document.createElement("div");
appTitle.className = "app-title";
appTitle.textContent = "muis";
tbLeft.append(appIcon, appTitle);

const tbRight = document.createElement("div");
tbRight.className = "tb-right";
const searchBox = document.createElement("div");
searchBox.className = "search";
const searchGlyph = document.createElement("span");
searchGlyph.textContent = "⌕";
const titleSearch = document.createElement("input");
titleSearch.id = "titleSearch";
titleSearch.placeholder = "search";
titleSearch.autocomplete = "off";
titleSearch.spellcheck = false;
const searchHint = document.createElement("span");
searchHint.className = "kbd";
searchHint.textContent = "ctrl shift f";
searchBox.append(searchGlyph, titleSearch, searchHint);
const winControls = document.createElement("div");
winControls.className = "win-controls";
const winMin = document.createElement("div");
winMin.className = "win-btn";
winMin.textContent = "─";
winMin.title = "Minimize";
const winMax = document.createElement("div");
winMax.className = "win-btn";
winMax.textContent = "▢";
winMax.title = "Maximize / restore";
const winClose = document.createElement("div");
winClose.className = "win-btn close";
winClose.textContent = "✕";
winClose.title = "Close";
winControls.append(winMin, winMax, winClose);
tbRight.append(searchBox, winControls);
titlebar.append(tbLeft, tbRight);

const mainRow = document.createElement("div");
mainRow.className = "main";
const sidebar = document.createElement("div");
sidebar.className = "sidebar";
const center = document.createElement("div");
center.className = "center";
const tabbar = document.createElement("div");
tabbar.className = "tabbar";
tabbar.id = "tabbar";
const termWrap = document.createElement("div");
termWrap.className = "term-wrap";
const statusbar = document.createElement("div");
statusbar.className = "statusbar";
center.append(tabbar, termWrap, statusbar);
mainRow.append(sidebar, center);

const panelSlot = document.createElement("div");
panelSlot.className = "sidepanel";
panelSlot.style.display = "none";

app.append(titlebar, mainRow, panelSlot);

/* ---------------- titlebar: search + window controls ---------------- */

titleSearch.addEventListener("input", () => {
  if (!searcher.isOpen()) searcher.toggle();
  searcher.search(titleSearch.value);
});
titleSearch.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    if (e.shiftKey) searcher.previous();
    else searcher.next();
  } else if (e.key === "Escape") {
    titleSearch.value = "";
    searcher.close();
    titleSearch.blur();
  }
});

async function winControl(action: "min" | "max" | "close"): Promise<void> {
  if (!IN_TAURI) return;
  try {
    const win = getCurrentWindow();
    if (action === "min") await win.minimize();
    else if (action === "max") await win.toggleMaximize();
    else await win.close();
  } catch {
    /* capability missing — controls stay decorative */
  }
}
winMin.addEventListener("click", () => void winControl("min"));
winMax.addEventListener("click", () => void winControl("max"));
winClose.addEventListener("click", () => void winControl("close"));

/* ---------------- frameless resize handles ---------------- */

type ResizeEdgeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const RESIZE_EDGES: ReadonlyArray<[string, ResizeEdgeDirection]> = [
  ["n", "North"],
  ["s", "South"],
  ["e", "East"],
  ["w", "West"],
  ["ne", "NorthEast"],
  ["nw", "NorthWest"],
  ["se", "SouthEast"],
  ["sw", "SouthWest"],
];

if (IN_TAURI) {
  const layer = document.createElement("div");
  layer.className = "resize-layer";
  for (const [edge, dir] of RESIZE_EDGES) {
    const handle = document.createElement("div");
    handle.className = `resize-edge resize-${edge}`;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      void getCurrentWindow().startResizeDragging(dir).catch(() => {});
    });
    layer.append(handle);
  }
  document.body.append(layer);
}

/* ---------------- terminals ---------------- */

/** Size the shown surface once layout settles, retrying a few frames. */
function fitShown(sessionId: string, tab: Tab, view: TabView): void {
  const w = window as unknown as { __muisErrors?: string[] };
  let tries = 0;
  const attempt = () => {
    try {
      const dims = view.fit.proposeDimensions();
      if (dims && dims.cols >= 2 && dims.rows >= 2) {
        if (dims.cols !== view.term.cols || dims.rows !== view.term.rows) {
          view.term.resize(dims.cols, dims.rows);
        }
        if (IN_TAURI) {
          void client.resize(sessionId, tab.id, view.term.cols, view.term.rows).catch(() => {});
        }
        return;
      }
    } catch (e) {
      w.__muisErrors?.push(`fit failed: ${String(e)}`);
      return;
    }
    if (++tries < 30) {
      requestAnimationFrame(attempt);
    } else {
      w.__muisErrors?.push("fit gave up: surface never measurable");
    }
  };
  requestAnimationFrame(attempt);
}

function ensureView(sessionId: string, tab: Tab): TabView {
  let view = views.get(tab.id);
  if (view) {
    if (!view.box.isConnected) termWrap.append(view.box);
    return view;
  }

  const box = document.createElement("div");
  box.className = "tabbox";
  termWrap.append(box);

  const term = new Terminal({
    theme: xtermTheme(),
    fontFamily: MUIS_THEME.termFont,
    fontSize: effectiveFontSize(cfg),
    cursorBlink: true,
    scrollback: 50000,
  });
  const search = new SearchAddon();
  term.loadAddon(search);
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(box);

  if (IN_TAURI) {
    activity.spawnedAt.set(tab.id, Date.now());
    void (async () => {
      try {
        const shell = await defaultShell();
        const testCommand = await liveTestCommand();
        // Restored tabs replay on-disk scrollback first: read before the
        // pty exists, write after handlers are registered, so live output
        // can never overtake the replay.
        let replay = "";
        if (!replayedTabs.has(tab.id)) {
          replayedTabs.add(tab.id);
          try {
            replay = await invoke<string>("snapshot_read", { tabId: tab.id });
          } catch {
            /* no snapshot yet */
          }
        }
        await client.spawnTab(
          sessionId,
          tab.id,
          shell,
          tab.cwd,
          80,
          24,
          (data) => {
            activity.lastOutputAt.set(tab.id, Date.now());
            term.write(data);
            observeOsc(sessionId, tab, data);
            if (testCommand && !liveTestCommandSent.has(tab.id)) {
              liveTestCommandSent.add(tab.id);
              // Wait until the shell has emitted its first prompt/banner
              // before exercising the exact UI -> worker -> PTY input path.
              window.setTimeout(() => {
                void client
                  .write(sessionId, tab.id, enc.encode(`${testCommand}\n`))
                  .catch(() => {});
              }, 1000);
            }
          },
          (code) => {
            activity.exited.add(tab.id);
            term.writeln(`\r\n[process exited${code === null ? "" : ` (${code})`}]`);
            renderTabs();
            renderSessions();
          },
        );
        if (replay) term.write(b64decode(replay));
      } catch (e) {
        term.writeln(`\r\n[failed to spawn pty: ${String(e)}]`);
      }
    })();
    term.onData((data) => {
      void client.write(sessionId, tab.id, enc.encode(data));
    });
  } else {
    term.writeln("browser preview — local echo only; run in the Tauri window for real ptys.");
    term.onData((data) => term.write(data));
  }

  view = { term, fit, search, box };
  views.set(tab.id, view);
  return view;
}

/** Shell-reported cwd/title (OSC 7 / OSC 0,2). Chrome refreshes on change. */
function observeOsc(sessionId: string, tab: Tab, data: Uint8Array): void {
  let parser = oscParsers.get(tab.id);
  if (!parser) {
    parser = new OscParser();
    oscParsers.set(tab.id, parser);
  }
  let changed = false;
  for (const ev of parser.push(data)) {
    const wsNow = store.workspaces.find((w) => w.id === sessionId);
    const tabNow = wsNow?.tabs.find((t) => t.id === tab.id);
    if (!tabNow) continue;
    if (ev.type === "cwd" && tabNow.cwd !== ev.path) {
      tabNow.cwd = ev.path;
      changed = true;
    } else if (ev.type === "title" && ev.title && tabNow.title !== ev.title) {
      // Fish reports its abbreviated cwd as title. Take it only for
      // placeholder tabs; user-named tabs keep their names.
      if (isDefaultTitle(tabNow.title)) {
        tabNow.title = ev.title;
        changed = true;
      }
    }
  }
  if (changed) {
    renderTabs();
    renderSessions();
    renderStatusbar();
    scheduleSave();
  }
}

/** Tabs already replayed from disk this launch (once per tab id). */
const replayedTabs = new Set<string>();

function closeTab(sessionId: string, tabId: string): void {
  const owner = store.workspaces.find((w) => w.id === sessionId);
  const tab = owner?.tabs.find((t) => t.id === tabId);
  if (tab && isTabBusy(activity, tabId, Date.now())) {
    if (!window.confirm(`Close "${tab.title}"? A process is still running.`)) return;
  }
  const view = views.get(tabId);
  if (view) {
    if (IN_TAURI) {
      void client.kill(sessionId, tabId).catch(() => {});
      void invoke("snapshot_remove", { tabId }).catch(() => {});
    }
    view.term.dispose();
    view.box.remove();
    views.delete(tabId);
    oscParsers.delete(tabId);
    forgetTab(activity, tabId);
  }
  const wsIndex = store.workspaces.findIndex((w) => w.id === sessionId);
  const ws = store.workspaces[wsIndex];
  if (ws) {
    const tabIndex = ws.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex >= 0) store.closeTab(wsIndex, tabIndex);
  }
  renderAll();
}

/* ---------------- chrome render ---------------- */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderAll(): void {
  const ws = store.currentWorkspace();
  if (!ws) return;
  if (ws.tabs.length === 0) {
    store.newTab("Terminal 1", ws.dir);
    renderAll();
    return;
  }
  document.title = `muis — ${ws.name}`;
  sidebar.style.display = cfg.showSessions ? "" : "none";
  renderSessions();
  renderTabs();
  renderTerms(ws);
  renderStatusbar();
  renderPanelSlot();
  scheduleSave();
}

function renderSessions(): void {
  sidebar.innerHTML = "";
  const label = el("div", "side-label");
  label.append(el("span", "", "Sessions"));
  sidebar.append(label);
  const list = el("div", "");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "6px";
  list.style.overflowY = "auto";
  store.workspaces.forEach((w, i) => {
    list.append(sessionElement(w, i === store.current));
  });
  sidebar.append(list);
  const footer = el("div", "side-footer");
  const addBtn = el("button", "btn primary", "＋ session");
  addBtn.style.flex = "1";
  addBtn.addEventListener("click", () => {
    const name = window.prompt("Session name:", `session-${store.workspaces.length + 1}`);
    if (!name) return;
    const dirRaw = window.prompt("Session directory:", store.currentWorkspace()?.dir ?? "~") ?? "~";
    const dir = dirRaw.startsWith("~/") ? `/home/kaazrot${dirRaw.slice(1)}` : dirRaw;
    const idx = store.addWorkspace(name, dir);
    store.switch(idx);
    renderAll();
  });
  footer.append(addBtn);
  sidebar.append(footer);
}

function sessionElement(w: Workspace, selected: boolean): HTMLElement {
  const idx = store.workspaces.indexOf(w);
  const d = el("div", "session" + (selected ? " active" : ""));
  const col = colorFor(w.name);
  // Finished background tabs in hidden sessions surface as a badge.
  const doneN = selected ? 0 : w.tabs.filter((t) => activity.exited.has(t.id)).length;
  const icon = el("div", "s-icon", (w.name[0] ?? "?").toUpperCase());
  icon.style.background = `${col}22`;
  icon.style.color = col;
  icon.style.border = `1px solid ${col}55`;
  const meta = el("div", "s-meta");
  meta.append(
    el("div", "s-name", w.name),
    el("div", "s-sub", `${w.tabs.length} tab${w.tabs.length > 1 ? "s" : ""} · ${shortPath(w.dir)}`),
  );
  d.append(icon, meta);
  if (doneN > 0) d.append(el("span", "s-badge", String(doneN)));
  const dot = el("div", "s-dot" + (doneN > 0 ? " notify" : ""));
  dot.style.background = col;
  dot.style.boxShadow = `0 0 8px ${col}`;
  d.append(dot);
  d.addEventListener("click", () => {
    store.switch(idx);
    renderAll();
  });
  d.addEventListener("dblclick", () => {
    const name = window.prompt("Session name", w.name);
    if (name) {
      w.name = name;
      renderAll();
    }
  });
  return d;
}

function renderTabs(): void {
  const ws = store.currentWorkspace();
  if (!ws) return;
  tabbar.innerHTML = "";
  ws.tabs.forEach((t, i) => {
    tabbar.append(tabElement(ws, t, i === ws.active));
  });
  const nb = el("button", "newtab", "+");
  nb.addEventListener("click", () => {
    store.newTab(`Terminal ${ws.tabs.length + 1}`, ws.dir);
    renderAll();
  });
  tabbar.append(nb);
}

function tabElement(ws: Workspace, tab: Tab, selected: boolean): HTMLElement {
  const d = el("div", "tab" + (selected ? " active" : "") + (activity.exited.has(tab.id) ? " done" : ""));
  const tcol = colorFor(tab.title);
  const dot = el("span", "t-dot");
  dot.style.background = tcol;
  const title = el("span", "", tab.title);
  d.append(dot, title);
  if (activity.exited.has(tab.id)) d.append(el("span", "t-done", "✓ done"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(ws.id, tab.id);
  });
  d.append(x);
  d.addEventListener("click", () => {
    ws.active = ws.tabs.findIndex((t) => t.id === tab.id);
    renderAll();
  });
  d.addEventListener("dblclick", () => {
    const name = window.prompt("Rename tab", tab.title);
    if (name) {
      tab.title = name;
      renderAll();
    }
  });
  return d;
}

function renderTerms(ws: Workspace): void {
  for (const [id, view] of views) {
    if (!store.workspaces.some((w) => w.tabs.some((t) => t.id === id))) {
      view.term.dispose();
      view.box.remove();
      views.delete(id);
      oscParsers.delete(id);
    } else {
      // Switching workspaces leaves their live xterm instances in the
      // shared terminal host. Hide every old surface first; then the
      // current workspace's active tab below is the only one displayed.
      view.box.classList.remove("active");
    }
  }
  for (const t of ws.tabs) {
    const view = ensureView(ws.id, t);
    const show = ws.tabs[ws.active]?.id === t.id;
    view.box.classList.toggle("active", show);
    if (show) fitShown(ws.id, t, view);
  }
}

/* ---------------- statusbar ---------------- */

const stSessionTab = el("span", "pill");
const stCwd = el("span", "", "");
const stGit = el("span", "pill", "");
const stUser = el("span", "pill", "");
const stClock = el("span", "", "");
const stShell = el("span", "pill", "");
statusbar.append(stSessionTab, stCwd, stGit, stUser, el("span", ""), stClock, stShell);
(statusbar.children[4] as HTMLElement).style.marginLeft = "auto";

const gitCache = new Map<string, string>();

function renderStatusbar(): void {
  const ws = store.currentWorkspace();
  const tab = ws?.tabs[ws.active];
  stSessionTab.innerHTML = "";
  if (ws && tab) {
    stSessionTab.append(el("b", "", ws.name), document.createTextNode(` · ${tab.title}`));
  }
  stCwd.textContent = tab ? shortPath(tab.cwd) : "";
  stUser.textContent = sysInfo ? `${sysInfo.user}@${sysInfo.host}` : "";
  stShell.textContent = `UTF-8 · ${shellBaseName() || "…"}`;
  if (tab) {
    const cwd = tab.cwd;
    const cached = gitCache.get(cwd);
    stGit.textContent = cached ?? "⎇ …";
    if (cached === undefined && IN_TAURI) {
      void invoke<string>("git_branch", { cwd })
        .then((branch) => {
          gitCache.set(cwd, branch ? `⎇ ${branch} ✓` : "⎇ —");
          if (store.currentWorkspace()?.tabs[ws?.active ?? -1]?.cwd === cwd) renderStatusbar();
        })
        .catch(() => {
          gitCache.set(cwd, "⎇ —");
        });
    }
  } else {
    stGit.textContent = "";
  }
}

function tickClock(): void {
  const f = () => {
    stClock.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  f();
  setInterval(f, 1000);
}

interface SysInfo {
  user: string;
  host: string;
}
let sysInfo: SysInfo | null = null;

/* ---------------- side panel slot ---------------- */

/** Content host for a visible panel; null when nothing is docked. */
export function panelContent(id: string): HTMLElement | null {
  if (sidePanels.visible() !== id) return null;
  return panelSlot.querySelector<HTMLElement>("[data-panel-body]");
}

function renderPanelSlot(): void {
  const id = sidePanels.visible();
  panelSlot.style.display = id ? "flex" : "none";
  if (!id) return;
  panelSlot.innerHTML = "";
  const def = sidePanels.list().find((p) => p.id === id);
  const head = el("div", "side-label");
  head.append(el("span", "", def?.title ?? id));
  const close = el("button", "btn", "×");
  close.addEventListener("click", () => {
    sidePanels.close();
    renderPanelSlot();
  });
  head.append(close);
  const body = el("div", "");
  body.setAttribute("data-panel-body", "");
  panelSlot.append(head, body);
}

/* ---------------- persistence ---------------- */

/** Persist sessions debounced: every chrome mutation funnels through renderAll(). */
let saveTimer: number | undefined;
function scheduleSave(): void {
  if (!IN_TAURI) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("sessions_save", { json: store.toJSON() }).catch(() => {});
  }, 500);
}

/** Every 30s each live tab's scrollback is snapshotted to disk. */
function startSnapshotLoop(): void {
  if (!IN_TAURI) return;
  window.setInterval(() => {
    for (const ws of store.workspaces) {
      for (const t of ws.tabs) {
        if (!views.has(t.id)) continue;
        void client
          .snapshot(ws.id, t.id, (data) => {
            void invoke("snapshot_store", { tabId: t.id, dataB64: b64encode(data) }).catch(() => {});
          })
          .catch(() => {});
      }
    }
  }, 30000);
}

/* ---------------- quit guard + shortcuts ---------------- */

window.addEventListener("beforeunload", (e) => {
  const ids = store.workspaces.flatMap((w) => w.tabs.map((t) => t.id));
  if (anyTabBusy(activity, ids, Date.now())) {
    // WebKit shows its own confirmation dialog.
    e.preventDefault();
  }
});

window.addEventListener("resize", () => {
  const ws = store.currentWorkspace();
  const active = ws?.tabs[ws.active];
  const view = active ? views.get(active.id) : undefined;
  if (!ws || !active || !view) return;
  try {
    view.fit.fit();
  } catch {
    /* ignore */
  }
  if (IN_TAURI) void client.resize(ws.id, active.id, view.term.cols, view.term.rows).catch(() => {});
});

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target === titleSearch) return; // search box handles its own keys
  const ws = store.currentWorkspace();
  if (!ws) return;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    store.newTab(`Terminal ${ws.tabs.length + 1}`, ws.dir);
    renderAll();
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    titleSearch.focus();
    titleSearch.select();
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === "F12") {
    // Explicit keyboard route into xterm. Useful for keyboard-only users
    // and native-window automation: neither relies on global coordinates.
    e.preventDefault();
    const active = ws.tabs[ws.active];
    if (active) views.get(active.id)?.term.focus();
  }
  if (e.key === "," && e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    openSettings();
  }
  if (e.key === "Escape" && settingsOverlay.style.display !== "none") {
    closeSettings();
  }
});

/* ---------------- settings dialog ---------------- */

const settingsOverlay = document.createElement("div");
settingsOverlay.className = "settings-overlay";
settingsOverlay.style.display = "none";
const settingsBox = document.createElement("div");
settingsBox.className = "settings-box";
const settingsTitle = document.createElement("h2");
settingsTitle.textContent = "Settings";

function settingsRow(label: string, input: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.className = "settings-row";
  const span = document.createElement("span");
  span.textContent = label;
  row.append(span, input);
  return row;
}

const optSessions = document.createElement("input");
optSessions.type = "checkbox";
const optFontSize = document.createElement("input");
optFontSize.type = "number";
optFontSize.min = "6";
optFontSize.max = "32";
optFontSize.placeholder = "System";
optFontSize.title = "Empty = default size";

const settingsButtons = document.createElement("div");
settingsButtons.className = "settings-buttons";
const settingsSave = document.createElement("button");
settingsSave.textContent = "Save";
const settingsCancel = document.createElement("button");
settingsCancel.textContent = "Cancel";
settingsButtons.append(settingsSave, settingsCancel);
settingsBox.append(
  settingsTitle,
  settingsRow("Show sessions panel", optSessions),
  settingsRow("Terminal font size", optFontSize),
  settingsButtons,
);
settingsOverlay.append(settingsBox);
document.body.append(settingsOverlay);

function openSettings(): void {
  optSessions.checked = cfg.showSessions;
  optFontSize.value = cfg.fontSize?.toString() ?? "";
  settingsOverlay.style.display = "flex";
}

function closeSettings(): void {
  settingsOverlay.style.display = "none";
}

function applySettings(): void {
  const size = optFontSize.value.trim();
  cfg = {
    showSessions: optSessions.checked,
    tabsOnTop: cfg.tabsOnTop,
    fontSize: size === "" ? null : Math.max(6, Math.min(32, Math.floor(Number(size)) || 0)) || null,
  };
  if (IN_TAURI) void invoke("config_save", { json: JSON.stringify(cfg) }).catch(() => {});
  const px = effectiveFontSize(cfg);
  for (const [, view] of views) view.term.options.fontSize = px;
  closeSettings();
  renderAll();
}

settingsSave.addEventListener("click", applySettings);
settingsCancel.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

/* ---------------- diagnosis hook ---------------- */

/**
 * Headless diagnosis hook: window.__muisDebug() reports terminal
 * geometry and any window errors as JSON. Used with WebKit2.WebView
 * when the Tauri window itself can't be inspected.
 */
function installDebugHook(): void {
  const w = window as unknown as {
    __muisErrors?: string[];
    __muisDebug?: () => unknown;
  };
  w.__muisErrors = [];
  window.addEventListener("error", (e) => {
    w.__muisErrors?.push(String(e.message));
  });
  w.__muisDebug = () => {
    const boxes = [...document.querySelectorAll(".tabbox")].map((b) => {
      const bEl = b as HTMLElement;
      const r = bEl.getBoundingClientRect();
      const cs = getComputedStyle(bEl);
      return { active: bEl.classList.contains("active"), w: r.width, h: r.height, display: cs.display };
    });
    const tabs = [...document.querySelectorAll("#tabbar .tab")].map((t) => ({
      cls: (t as HTMLElement).className,
      text: (t as HTMLElement).innerText.slice(0, 20),
    }));
    const termRect = termWrap.getBoundingClientRect();
    return {
      href: location.href,
      errors: w.__muisErrors ?? [],
      views: [...views.entries()].map(([id, v]) => ({ id, cols: v.term.cols, rows: v.term.rows })),
      boxes,
      tabs,
      store: JSON.parse(store.toJSON()),
      termRect: { w: termRect.width, h: termRect.height },
      fonts: document.fonts?.status ?? "unknown",
    };
  };
  // In the Tauri window there are no devtools: phone the snapshot home.
  if (IN_TAURI) {
    setTimeout(() => {
      try {
        const snap = JSON.stringify((w.__muisDebug as () => unknown)());
        void invoke("debug_report", { json: snap }).catch(() => {});
      } catch {
        /* ignore */
      }
    }, 3000);
  }
}

/* ---------------- init ---------------- */

async function init(): Promise<void> {
  reportDebugStage("init-start");
  let home = "~";
  if (IN_TAURI) {
    try {
      home = await invoke<string>("default_cwd");
      reportDebugStage("default-cwd-loaded");
    } catch {
      reportDebugStage("default-cwd-failed");
    }
    try {
      const info = await invoke<SysInfo>("sys_info");
      sysInfo = info;
      reportDebugStage("system-info-loaded");
    } catch {
      reportDebugStage("system-info-failed");
    }
    // Resume where we left off; corrupt files start fresh (never broken).
    try {
      const saved = await invoke<string>("sessions_load");
      if (saved) store = SessionStore.fromJSON(saved);
      reportDebugStage("sessions-loaded", Boolean(saved));
    } catch {
      reportDebugStage("sessions-load-failed");
    }
    try {
      const raw = await invoke<string>("config_load");
      if (raw) cfg = configFromJSON(raw);
      reportDebugStage("config-loaded", Boolean(raw));
    } catch {
      reportDebugStage("config-load-failed");
    }
  }
  if (store.workspaces.length === 0) store.ensureDefault("home", home);
  renderAll();
  reportDebugStage("initial-render-complete", { workspaces: store.workspaces.length, views: views.size });
  installDebugHook();
  startSnapshotLoop();
  tickClock();
}

void init();
