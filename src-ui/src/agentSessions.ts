/**
 * Resolving a terminal tab to the exact opencode session it should resume.
 *
 * The TUI plugin reports the session currently on screen (the only reliable
 * source across `/new` and `/resume`). The server plugin and the terminal
 * title are fallbacks. Everything here is pure so the restore rules stay
 * testable without opencode or Tauri.
 */
import type { Tab, Workspace } from "./sessions";

/** One opencode session, as listed by `opencode session list --format json`. */
export interface AgentSessionInfo {
  id: string;
  title: string;
  directory: string;
}

/** Normalize a directory for comparison: trim and drop trailing slashes. */
export function normalizeDir(p: string | null | undefined): string {
  if (!p) return "";
  const s = p.trim().replace(/\/+$/, "");
  return s || "/";
}

/** True when two directories are equal or one contains the other. */
export function dirsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = normalizeDir(a);
  const y = normalizeDir(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/** Only ids muis is willing to write into a shell. */
export function validSessionId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^ses_[A-Za-z0-9]+$/.test(id);
}

/** Fields a tab gains when it latches a reported agent session. */
export interface AgentSessionPatch {
  agentSession: string;
  agentSessionDir?: string;
}

/**
 * Decide whether to latch a reported session id onto a tab. A report that
 * carries a directory must point at the tab's directory, so an id from
 * another project never latches. A directory-less report is accepted: the
 * TUI plugin's route only carries the id, and it is by definition this tab.
 */
export function latchPatch(
  tab: Pick<Tab, "agentSession" | "agentSessionDir" | "cwd">,
  id: string | null | undefined,
  dir: string | null | undefined,
): AgentSessionPatch | null {
  if (!validSessionId(id)) return null;
  const directory = dir?.trim() || undefined;
  if (directory && !dirsCompatible(directory, tab.cwd)) return null;
  const sameSession = tab.agentSession === id;
  const sameDir = !directory || tab.agentSessionDir === directory;
  if (sameSession && sameDir) return null;
  return {
    agentSession: id,
    ...(directory ? { agentSessionDir: directory } : {}),
  };
}

/** argv0 wrappers that do not change which program actually runs. */
const WRAPPERS = new Set(["sudo", "command", "exec", "env", "nice", "time", "doas"]);

/**
 * True when a shell command line launches opencode (possibly through a
 * wrapper or leading assignments). Only argv0 is considered, so
 * `cat opencode.log` does not match.
 */
export function isOpencodeCommand(cmd: string | null | undefined): boolean {
  if (!cmd) return false;
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(t) || t.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  const prog = tokens[i]?.split("/").pop() ?? "";
  return prog === "opencode";
}

export type AgentReportResult = "ignored" | "latched" | "cleared";

/**
 * Apply one `muis-agent` report to the store. Returns what changed so the
 * caller knows whether to persist. A null/undefined session clears the tab
 * (opencode moved to its home screen); an unknown tab is ignored.
 */
export function applyAgentReport(
  workspaces: ReadonlyArray<Workspace>,
  tabId: string,
  session: string | null | undefined,
  dir: string | null | undefined,
): AgentReportResult {
  const ws = workspaces.find((w) => w.tabs.some((t) => t.id === tabId));
  const tab = ws?.tabs.find((t) => t.id === tabId);
  if (!tab) return "ignored";
  if (session === null || session === undefined) {
    if (!tab.agentSession && !tab.agentSessionDir && !tab.agentTitle) return "ignored";
    delete tab.agentSession;
    delete tab.agentSessionDir;
    delete tab.agentTitle;
    return "cleared";
  }
  const patch = latchPatch(tab, session, dir);
  if (!patch) return "ignored";
  if (tab.agentSession !== patch.agentSession) delete tab.agentSessionDir;
  tab.agentSession = patch.agentSession;
  if (patch.agentSessionDir) tab.agentSessionDir = patch.agentSessionDir;
  return "latched";
}

/**
 * Whether a finished command means opencode left the tab. Only a real
 * shell-reported end (OSC 133) counts: the idle fallback can fire during a
 * long model turn and must never clear a live session.
 */
export function shouldClearAgentOnCommandEnd(
  sawOsc: boolean,
  cmd: string | null | undefined,
): boolean {
  return sawOsc && isOpencodeCommand(cmd);
}

/** The opencode session title behind a tab label ("OC | <title>"). */
export function opencodeTitleFromLabel(label: string): string {
  return label
    .replace(/^OC\s*\|\s*/, "")
    .replace(/[.…\u2026]+\s*$/, "")
    .trim();
}

/** True when an OSC title came from opencode's session route. */
export function isOpencodeTitle(label: string): boolean {
  return /^OC\s*\|/.test(label);
}

/**
 * Best session for a restored tab, from opencode's session list: scoped to
 * the tab's directory, exact title match first, then prefix match (the tab
 * label may be truncated). Most recently listed wins ties.
 */
export function pickSessionByTitle(
  sessions: AgentSessionInfo[],
  label: string,
  cwd: string,
): string | null {
  const want = opencodeTitleFromLabel(label).toLowerCase();
  if (!want) return null;
  const pool = sessions.filter((s) => dirsCompatible(s.directory, cwd));
  if (pool.length === 0) return null;
  const norm = (s: AgentSessionInfo) => s.title.trim().toLowerCase();
  let matches = pool.filter((s) => norm(s) === want);
  if (matches.length === 0) matches = pool.filter((s) => norm(s).startsWith(want));
  return matches[0]?.id ?? null;
}

/** The command that resumes one exact opencode session. */
export function opencodeResume(id: string): string {
  return `opencode --session ${id}`;
}

/**
 * The session a restored tab should resume, or null to leave it as a plain
 * shell. Only sessions present in the live list for this directory are
 * eligible; a deleted session never launches a broken opencode.
 */
export function resolveRestoreSession(
  tab: Pick<Tab, "agentSession" | "agentSessionDir" | "agentTitle" | "title" | "cwd">,
  sessions: AgentSessionInfo[],
): string | null {
  if (!tab.agentSession && !tab.agentTitle) return null;
  const byDir = (id: string) => sessions.find(
    (s) =>
      s.id === id &&
      (dirsCompatible(s.directory, tab.cwd) ||
        (!s.directory && dirsCompatible(tab.agentSessionDir, tab.cwd))),
  );

  if (validSessionId(tab.agentSession)) {
    const known = byDir(tab.agentSession);
    if (known) return known.id;
    // The list is authoritative. A stored id that is not in it was deleted
    // (or belongs to another directory); fall through to the title match.
  }

  const label = tab.agentTitle || (isOpencodeTitle(tab.title) ? tab.title : "");
  const byTitle = label ? pickSessionByTitle(sessions, label, tab.cwd) : null;
  return validSessionId(byTitle) ? byTitle : null;
}

export interface RestoreEntry {
  wsIndex: number;
  tabIndex: number;
  tabId: string;
}

/** True when a tab has anything worth resolving on restore. */
export function isRestorableAgent(tab: Tab): boolean {
  return Boolean(tab.agentSession) || Boolean(tab.agentTitle);
}

/**
 * Restore order: the visible tab first, then the rest of the current
 * workspace, then every other workspace. Plain shell tabs are never queued.
 */
export function restoreQueue(
  workspaces: ReadonlyArray<{ tabs: readonly Tab[]; active: number }>,
  current: number,
): RestoreEntry[] {
  const out: RestoreEntry[] = [];
  const seen = new Set<string>();
  const push = (wsIndex: number, tabIndex: number): void => {
    const tab = workspaces[wsIndex]?.tabs[tabIndex];
    if (!tab || seen.has(tab.id) || !isRestorableAgent(tab)) return;
    seen.add(tab.id);
    out.push({ wsIndex, tabIndex, tabId: tab.id });
  };
  const ws = workspaces[current];
  if (ws) {
    // The tab the user was looking at before quitting comes up first.
    push(current, ws.active);
    for (let i = 0; i < ws.tabs.length; i++) push(current, i);
  }
  for (let w = 0; w < workspaces.length; w++) {
    if (w === current) continue;
    for (let i = 0; i < workspaces[w].tabs.length; i++) push(w, i);
  }
  return out;
}
