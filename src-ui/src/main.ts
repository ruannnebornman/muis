import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SessionStore, type Tab, type Workspace } from "./sessions";
import { xtermTheme, colorFor, applyTheme, themeNames, MUIS_THEME } from "./theme";
import { defaultConfig, configFromJSON, effectiveFontSize, type AppConfig } from "./config";
import { WorkerClient, type Transport } from "./worker";
import { SearchController } from "./search";
import { SidePanelRegistry } from "./panels";
import { newActivityState, isTabBusy, anyTabBusy, forgetTab } from "./activity";
import { OscParser, type NotifyEvent } from "./osc";
import { CommandTracker, tabLabel as tabLabelOf } from "./commandbar";
import { collectMatches, type SearchHit, type SearchScope, type SearchableTab } from "./searchall";
import { resolveShortcut } from "./shortcuts";
import { DoneTracker } from "./done";
import { NotifyRouter, notifyEventFromCli, type CliNotify } from "./notify";
import { expandHome, shortPath as shortPathOf } from "./paths";
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

/** Whether the muis window has keyboard focus; gates desktop notifications. */
let windowFocused = !IN_TAURI ? document.hasFocus() : true;
if (IN_TAURI) {
  const win = getCurrentWindow();
  void win
    .isFocused()
    .then((f) => {
      windowFocused = f;
    })
    .catch(() => {});
  void win
    .onFocusChanged(({ payload }) => {
      windowFocused = payload;
    })
    .catch(() => {});
} else {
  window.addEventListener("focus", () => {
    windowFocused = true;
  });
  window.addEventListener("blur", () => {
    windowFocused = false;
  });
}

/** Best-effort OS toast; no-op outside Tauri or without permission. */
async function sendDesktopNotification(title: string, body: string): Promise<void> {
  if (!IN_TAURI) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* notifications are best-effort */
  }
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

// `muis-notify` clients reach the shell over a local socket; the shell
// forwards each request here as a `muis-notify` event.
if (IN_TAURI) {
  void listen<CliNotify>("muis-notify", (e) => handleNotifyRequest(e.payload)).catch((e: unknown) => {
    const w = window as unknown as { __muisErrors?: string[] };
    w.__muisErrors ??= [];
    w.__muisErrors.push(`notify-listen failed: ${String(e)}`);
  });
}

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

/** Real home directory, set once from the backend (`default_cwd`). */
let homeDir = "";

function shortPath(p: string): string {
  return shortPathOf(p, homeDir);
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
const searchResults = document.createElement("div");
searchResults.id = "searchResults";
searchResults.className = "results";
searchResults.style.display = "none";
searchBox.append(searchGlyph, titleSearch, searchHint, searchResults);
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
  renderSearchResults();
});
titleSearch.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    const first = searchResults.querySelector<HTMLElement>(".r-item");
    if (first) first.click();
  } else if (e.key === "Escape") {
    e.preventDefault();
    titleSearch.value = "";
    hideSearchResults();
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
  const head = document.createElement("div");
  head.className = "pane-head";
  const surface = document.createElement("div");
  surface.className = "tab-surface";
  box.append(head, surface);
  termWrap.append(box);

  const term = new Terminal({
    theme: xtermTheme(cfg.theme),
    fontFamily: MUIS_THEME.termFont,
    fontSize: effectiveFontSize(cfg),
    cursorBlink: true,
    scrollback: 50000,
  });
  const search = new SearchAddon();
  term.loadAddon(search);
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(surface);

  // While replaying saved scrollback, xterm re-parses the shell's captured
  // terminal queries (OSC 11, CPR, DA) and would answer them into the live
  // pty — the shell then echoes the answers as garbage on the prompt line.
  // Drop everything xterm emits during replay.
  let replaying = false;

  if (IN_TAURI) {
    activity.spawnedAt.set(tab.id, Date.now());
    void (async () => {
      try {
        const shell = await defaultShell();
        renderCommandHead(tab.id);
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
            armIdleFallback(tab.id);
            if (testCommand && !liveTestCommandSent.has(tab.id)) {
              liveTestCommandSent.add(tab.id);
              // Wait until the shell has emitted its first prompt/banner
              // before exercising the exact UI -> worker -> PTY input path.
              window.setTimeout(() => {
                trackInput(tab.id, `${testCommand}\n`);
                void client
                  .write(sessionId, tab.id, enc.encode(`${testCommand}\n`))
                  .catch(() => {});
              }, 1000);
            }
          },
          (code) => {
            activity.exited.add(tab.id);
            term.writeln(`\r\n[process exited${code === null ? "" : ` (${code})`}]`);
            if (!isTabVisible(tab.id)) {
              doneTabs.mark(tab.id);
              scheduleSave();
            }
            renderTabs();
            renderSessions();
            updateWindowTitle();
          },
        );
        if (replay) {
          replaying = true;
          term.write(b64decode(replay), () => {
            replaying = false;
          });
        }
      } catch (e) {
        term.writeln(`\r\n[failed to spawn pty: ${String(e)}]`);
      }
    })();
    term.onData((data) => {
      if (replaying) return; // never feed replayed-query answers to the pty
      trackInput(tab.id, data);
      void client.write(sessionId, tab.id, enc.encode(data));
    });
  } else {
    term.writeln("browser preview — local echo only; run in the Tauri window for real ptys.");
    term.onData((data) => {
      if (replaying) return;
      trackInput(tab.id, data);
      term.write(data);
    });
  }

  view = { term, fit, search, box };
  views.set(tab.id, view);
  renderCommandHead(tab.id);
  return view;
}

/** Shell-reported cwd/title (OSC 7 / OSC 0,2) and command markers (OSC 133). */
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
      // Fish reports its abbreviated cwd as title. Pinned (manual) tabs
      // keep their names.
      if (!tabNow.manual) {
        tabNow.title = ev.title;
        changed = true;
      }
    } else if (ev.type === "cmd-start") {
      // Prefer the shell-reported command line, then captured keystrokes,
      // then the on-screen line (input that bypassed the keyboard).
      const st = commandTracker.state(tabNow.id);
      const cmd = ev.cmd || st.input.trim() || currentInputLine(tabNow.id);
      commandTracker.onCmdStart(tabNow.id, cmd);
      renderCommandHead(tabNow.id);
    } else if (ev.type === "cmd-end") {
      finishCommand(tabNow.id, ev.exit);
    } else if (ev.type === "notify") {
      // Terminal agents report completion with OSC 9/777/99 (or the
      // muis-notify CLI). Badge the tab when the user was not looking at
      // it, and raise a desktop toast only while the window is unfocused.
      if (applyNotification(tabNow, ev)) changed = true;
    }
  }
  if (changed) {
    renderTabs();
    renderSessions();
    renderStatusbar();
    updateWindowTitle();
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
    forgetTabState(tabId);
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
  if (ws && ws.tabs.length === 0) {
    // A live workspace always shows a terminal. Only a fully closed
    // workspace (no sessions left) is allowed to stay empty.
    store.newTab("Terminal 1", ws.dir);
    renderAll();
    return;
  }
  // Looking at a tab acknowledges its finished command.
  const active = ws?.tabs[ws.active];
  if (active) doneTabs.clear(active.id);
  updateWindowTitle();
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
    const dir = expandHome(dirRaw, homeDir);
    const idx = store.addWorkspace(name, dir);
    store.switch(idx);
    renderAll();
  });
  footer.append(addBtn);
  sidebar.append(footer);
}

/** Stable per-session glyph (mock shows an icon per session). */
const SESSION_GLYPHS = ["◈", "⬢", "⬣", "✦", "⬔", "❖", "◆", "●"];
function sessionGlyph(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SESSION_GLYPHS[h % SESSION_GLYPHS.length];
}

function renameSession(w: Workspace): void {
  const name = window.prompt("Session name", w.name);
  if (name) {
    w.name = name;
    renderAll();
  }
}

function sessionElement(w: Workspace, selected: boolean): HTMLElement {
  const idx = store.workspaces.indexOf(w);
  const d = el("div", "session" + (selected ? " active" : ""));
  d.dataset.i = String(idx);
  const col = colorFor(w.name);
  // Finished background tabs in hidden sessions surface as a badge.
  const doneN = selected ? 0 : w.tabs.filter((t) => isTabDone(t.id)).length;
  const icon = el("div", "s-icon", sessionGlyph(w.name));
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
  d.addEventListener("dblclick", () => renameSession(w));
  return d;
}

function renderTabs(): void {
  tabbar.innerHTML = "";
  const ws = store.currentWorkspace();
  if (!ws) return;
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

function renameTab(ws: Workspace, tab: Tab): void {
  const name = window.prompt("Tab name", tab.title);
  if (name) {
    tab.title = name;
    tab.manual = true;
    renderAll();
  }
}

function toggleFreezeTitle(ws: Workspace, tab: Tab): void {
  tab.manual = !tab.manual;
  if (!tab.manual) {
    // Back to the shell-driven title: reset to the placeholder and let
    // the next OSC 0/2 update land.
    const i = ws.tabs.findIndex((t) => t.id === tab.id);
    tab.title = `Terminal ${i + 1}`;
  }
  renderTabs();
  scheduleSave();
}

/** Tab label: the last command run, unless the user pinned a name. */
function tabLabel(tab: Tab): string {
  return tabLabelOf(tab.title, tab.manual, commandTracker.state(tab.id).lastCmd);
}

function tabElement(ws: Workspace, tab: Tab, selected: boolean): HTMLElement {
  const done = isTabDone(tab.id);
  const d = el("div", "tab" + (selected ? " active" : "") + (done ? " done" : ""));
  d.dataset.i = String(ws.tabs.findIndex((t) => t.id === tab.id));
  const label = tabLabel(tab);
  const tcol = colorFor(label);
  const dot = el("span", "t-dot");
  dot.style.background = tcol;
  const title = el("span", "t-name", label);
  d.append(dot, title);
  if (done) d.append(el("span", "t-done", "✓ done"));
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
  d.addEventListener("dblclick", () => renameTab(ws, tab));
  return d;
}

function renderTerms(ws: Workspace | undefined): void {
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
  // No sessions: every terminal view was just disposed above.
  if (!ws) return;
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

const onShortcut = (e: KeyboardEvent): void => {
  const target = e.target as HTMLElement | null;
  if (target === titleSearch) return; // search box handles its own keys
  const ws = store.currentWorkspace();
  if (!ws) return;
  const action = resolveShortcut(e);
  if (!action) return;
  switch (action.type) {
    case "new-tab":
      e.preventDefault();
      store.newTab(`Terminal ${ws.tabs.length + 1}`, ws.dir);
      renderAll();
      break;
    case "close-tab": {
      e.preventDefault();
      const active = ws.tabs[ws.active];
      if (active) closeTab(ws.id, active.id);
      break;
    }
    case "focus-search":
      e.preventDefault();
      titleSearch.focus();
      titleSearch.select();
      break;
    case "focus-terminal": {
      e.preventDefault();
      const active = ws.tabs[ws.active];
      if (active) views.get(active.id)?.term.focus();
      break;
    }
    case "open-settings":
      e.preventDefault();
      openSettings();
      break;
    case "switch-tab":
      if (action.index < ws.tabs.length) {
        e.preventDefault();
        ws.active = action.index;
        renderAll();
      }
      break;
    case "cycle-tab": {
      e.preventDefault();
      const n = ws.tabs.length;
      if (n > 0) {
        ws.active = (ws.active + action.delta + n) % n;
        renderAll();
      }
      break;
    }
    case "cycle-session": {
      e.preventDefault();
      const n = store.workspaces.length;
      if (n > 0) {
        store.switch((store.current + action.delta + n) % n);
        renderAll();
      }
      break;
    }
    case "close-overlay":
      if (settingsOverlay.style.display !== "none") closeSettings();
      break;
  }
};
// Capture phase so the focused terminal cannot swallow these chords first.
window.addEventListener("keydown", onShortcut, true);

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
const optTheme = document.createElement("select");
for (const name of themeNames()) {
  const o = document.createElement("option");
  o.value = name;
  o.textContent = name;
  optTheme.append(o);
}

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
  settingsRow("Theme", optTheme),
  settingsButtons,
);
settingsOverlay.append(settingsBox);
document.body.append(settingsOverlay);

function openSettings(): void {
  optSessions.checked = cfg.showSessions;
  optFontSize.value = cfg.fontSize?.toString() ?? "";
  optTheme.value = cfg.theme ?? "default";
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
    theme: optTheme.value === "default" ? null : optTheme.value,
  };
  if (IN_TAURI) void invoke("config_save", { json: JSON.stringify(cfg) }).catch(() => {});
  applyTheme(cfg.theme);
  const nextTheme = xtermTheme(cfg.theme);
  const px = effectiveFontSize(cfg);
  for (const [, view] of views) {
    view.term.options.fontSize = px;
    view.term.options.theme = nextTheme;
  }
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

/* ---------------- last-command bar ---------------- */

const commandTracker = new CommandTracker();
const doneTabs = new DoneTracker();
const notifyRouter = new NotifyRouter();
const idleFallback = new Map<string, number>();

/** A tab is "done" when a finished command or pty exit needs attention. */
function isTabDone(tabId: string): boolean {
  return doneTabs.has(tabId) || activity.exited.has(tabId);
}

function isTabVisible(tabId: string): boolean {
  const ws = store.currentWorkspace();
  return ws?.tabs[ws.active]?.id === tabId;
}

function renderCommandHead(tabId: string): void {
  const view = views.get(tabId);
  if (!view) return;
  const head = view.box.querySelector<HTMLElement>(".pane-head");
  if (!head) return;
  const st = commandTracker.state(tabId);
  head.innerHTML = "";
  if (st.running) {
    head.append(el("span", "ok", "⏺"), el("span", "cmd-full", st.lastCmd ?? "…"));
    head.append(el("span", "dim exit", "running"));
    return;
  }
  if (!st.lastCmd) {
    head.append(el("span", "dim", `${shellBaseName() || "shell"} — ready`));
    return;
  }
  const ok = st.lastExit === 0 || st.lastExit === null;
  head.append(el("span", ok ? "ok" : "fail", ok ? "✓" : "✗"), el("span", "cmd-full", st.lastCmd));
  const bits: string[] = [];
  if (st.lastExit !== null) bits.push(`exit ${st.lastExit}`);
  if (st.lastMs !== null) bits.push(`${st.lastMs}ms`);
  if (bits.length) head.append(el("span", "dim exit", bits.join(" · ")));
}

/** Read the command from the on-screen line (fallback when keys weren't captured). */
function currentInputLine(tabId: string): string {
  const view = views.get(tabId);
  if (!view) return "";
  const buf = view.term.buffer.active;
  const line = buf.getLine(buf.baseY + buf.cursorY);
  const raw = line ? line.translateToString(true) : "";
  const marker = raw.lastIndexOf("❯");
  return (marker >= 0 ? raw.slice(marker + 1) : raw).trim();
}

/** With no OSC 133 (non-fish shells), infer completion from output settling. */
function armIdleFallback(tabId: string): void {
  const st = commandTracker.state(tabId);
  if (!st.running || st.sawOsc) return;
  window.clearTimeout(idleFallback.get(tabId));
  idleFallback.set(
    tabId,
    window.setTimeout(() => {
      const s = commandTracker.state(tabId);
      if (s.running && !s.sawOsc) finishCommand(tabId, null);
    }, 500),
  );
}

function trackInput(tabId: string, data: string): void {
  if (commandTracker.onInput(tabId, data)) {
    renderCommandHead(tabId);
    armIdleFallback(tabId);
  }
}

function finishCommand(tabId: string, exit: number | null): void {
  commandTracker.onCmdEnd(tabId, exit);
  window.clearTimeout(idleFallback.get(tabId));
  idleFallback.delete(tabId);
  renderCommandHead(tabId);
  // The tab now shows (and colors by) the command that just ran.
  renderTabs();
  if (!isTabVisible(tabId)) {
    doneTabs.mark(tabId);
    renderSessions();
    updateWindowTitle();
    scheduleSave();
  }
}

function forgetTabState(tabId: string): void {
  commandTracker.forget(tabId);
  doneTabs.forget(tabId);
  notifyRouter.forget(tabId);
  window.clearTimeout(idleFallback.get(tabId));
  idleFallback.delete(tabId);
}

/**
 * Surface one notification from a tab. Returns true when the chrome
 * changed (tab badged done) so callers can re-render.
 */
function applyNotification(tab: Tab, ev: NotifyEvent): boolean {
  const decision = notifyRouter.route(
    tab.id,
    ev,
    { visible: isTabVisible(tab.id), windowFocused },
    Date.now(),
  );
  if (!decision) return false;
  if (decision.toast) {
    void sendDesktopNotification(ev.title ?? tab.title ?? "muis", ev.body);
  }
  if (!decision.markDone) return false;
  doneTabs.mark(tab.id);
  return true;
}

/** A `muis-notify` request forwarded by the shell, routed to its tab. */
function handleNotifyRequest(req: CliNotify): void {
  if (!req?.tab_id) return;
  const ws = store.workspaces.find((w) => w.tabs.some((t) => t.id === req.tab_id));
  const tab = ws?.tabs.find((t) => t.id === req.tab_id);
  if (!tab) return;
  if (applyNotification(tab, notifyEventFromCli(req))) {
    renderTabs();
    renderSessions();
    renderStatusbar();
    updateWindowTitle();
    scheduleSave();
  }
}

/* ---------------- cross-session search ---------------- */

let searchScope: SearchScope = "all";

function hideSearchResults(): void {
  searchResults.style.display = "none";
  searchResults.innerHTML = "";
}

/** Snapshot the open tabs and their visible scrollback for matching. */
function searchableTabs(): SearchableTab[] {
  const out: SearchableTab[] = [];
  store.workspaces.forEach((w, wsIndex) => {
    w.tabs.forEach((t, ti) => {
      const view = views.get(t.id);
      const lines: string[] = [];
      if (view) {
        const buf = view.term.buffer.active;
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          lines.push(line ? line.translateToString(true) : "");
        }
      }
      out.push({
        wsIndex,
        tabId: t.id,
        wsName: w.name,
        title: t.title,
        active: wsIndex === store.current && ti === w.active,
        lines,
      });
    });
  });
  return out;
}

function renderSearchResults(): void {
  const q = titleSearch.value.trim();
  if (q.length < 2) {
    hideSearchResults();
    return;
  }
  const { total, items } = collectMatches(q, searchScope, store.current, searchableTabs());
  searchResults.innerHTML = "";
  const head = el("div", "r-head");
  head.append(el("span", "", `${total} match${total === 1 ? "" : "es"}`));
  const scopes = el("span", "r-scopes");
  for (const [value, label] of [
    ["all", "Everywhere"],
    ["session", "Session"],
    ["tab", "Tab"],
  ] as const) {
    const b = el("button", "r-scope" + (searchScope === value ? " on" : ""), label);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      searchScope = value;
      renderSearchResults();
      titleSearch.focus();
    });
    scopes.append(b);
  }
  head.append(scopes);
  searchResults.append(head);
  if (total === 0) {
    searchResults.append(el("div", "r-empty", `no matches for “${q}”`));
  } else {
    for (const hit of items) {
      const item = el("div", "r-item");
      item.append(el("div", "r-crumb", hit.crumb), el("div", "r-line", hit.text));
      item.addEventListener("click", () => jumpToResult(hit, q));
      searchResults.append(item);
    }
  }
  searchResults.style.display = "block";
}

function jumpToResult(hit: SearchHit, q: string): void {
  store.switch(hit.wsIndex);
  const ws = store.currentWorkspace();
  const ti = ws?.tabs.findIndex((t) => t.id === hit.tabId) ?? -1;
  if (ws && ti >= 0) ws.active = ti;
  hideSearchResults();
  titleSearch.blur();
  renderAll();
  // Focus on the next tick: the Enter that picked this result must not
  // land in xterm (which would run the typed line).
  window.setTimeout(() => {
    const view = views.get(hit.tabId);
    if (!view) return;
    try {
      view.search.findNext(q);
    } catch {
      /* no match in the xterm buffer */
    }
    view.term.focus();
  }, 0);
}

/* ---------------- context menu ---------------- */

const ctxMenu = document.createElement("div");
ctxMenu.className = "ctxmenu";
ctxMenu.style.display = "none";
document.body.append(ctxMenu);

function closeCtx(): void {
  ctxMenu.style.display = "none";
  ctxMenu.innerHTML = "";
}

function openCtx(
  x: number,
  y: number,
  items: { label: string; hint?: string; fn: () => void }[],
): void {
  ctxMenu.innerHTML = "";
  for (const it of items) {
    const d = el("div", "ctx-item");
    d.append(el("span", "ctx-label", it.label));
    if (it.hint) d.append(el("span", "ctx-hint", it.hint));
    d.addEventListener("click", (e) => {
      e.stopPropagation();
      closeCtx();
      it.fn();
    });
    ctxMenu.append(d);
  }
  ctxMenu.style.display = "block";
  const w = ctxMenu.offsetWidth || 200;
  const h = ctxMenu.offsetHeight || 120;
  ctxMenu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
  ctxMenu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
}

document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  const sEl = target.closest<HTMLElement>(".session");
  const tEl = sEl ? null : target.closest<HTMLElement>(".tab");
  if (sEl) {
    e.preventDefault();
    const w = store.workspaces[Number(sEl.dataset.i)];
    if (w) openCtx(e.clientX, e.clientY, [{ label: "Rename session", fn: () => renameSession(w) }]);
  } else if (tEl) {
    e.preventDefault();
    const ws = store.currentWorkspace();
    const tab = ws?.tabs[Number(tEl.dataset.i)];
    if (ws && tab) {
      openCtx(e.clientX, e.clientY, [
        { label: "Rename tab", hint: tab.manual ? "manual" : "auto", fn: () => renameTab(ws, tab) },
        {
          label: tab.manual ? "Use automatic title" : "Freeze current title",
          fn: () => toggleFreezeTitle(ws, tab),
        },
      ]);
    }
  } else {
    closeCtx();
  }
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!searchBox.contains(target)) hideSearchResults();
  if (!ctxMenu.contains(target)) closeCtx();
});

/* ---------------- window title ---------------- */

function updateWindowTitle(): void {
  const n = doneTabs.count();
  document.title = n > 0 ? `● (${n}) done — muis` : `muis — ${store.currentWorkspace()?.name ?? ""}`;
}

/* ---------------- init ---------------- */

async function init(): Promise<void> {
  reportDebugStage("init-start");
  let home = "~";
  let resumed = false;
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
      if (saved) {
        store = SessionStore.fromJSON(saved);
        resumed = true;
      }
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
  homeDir = home.startsWith("/") ? home : "";
  // Only mint a default session on a fresh start. A resumed empty store
  // means the user closed every session and quit that way on purpose.
  if (store.workspaces.length === 0 && !resumed) store.ensureDefault("home", home);
  applyTheme(cfg.theme);
  renderAll();
  reportDebugStage("initial-render-complete", { workspaces: store.workspaces.length, views: views.size });
  installDebugHook();
  startSnapshotLoop();
  tickClock();
}

void init();
