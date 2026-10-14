/**
 * Resolving a terminal tab to the exact coding-agent session it should
 * resume. All pure, so main.ts wiring stays thin and testable.
 *
 * Two jobs:
 *  - `latchPatch`: validate a session id an agent plugin reports over
 *    `muis-notify` before the tab latches it. A report that leaked in from
 *    another project (its directory does not match the tab) is rejected.
 *  - `restoreCommand`: pick the command a restored agent tab should run.
 *    The stored session id is validated against the live session list; when
 *    it is missing or foreign, fall back to a title+directory lookup, then
 *    to the "last session in this folder" resume command.
 */
import type { Tab } from "./sessions";

/** One opencode session, as listed by `opencode session list --format json`. */
export interface AgentSessionInfo {
  id: string;
  title: string;
  directory: string;
  updated?: number;
}

/** Normalize a directory for comparison: trim and drop trailing slashes. */
export function normalizeDir(p: string | null | undefined): string {
  if (!p) return "";
  const s = p.trim().replace(/\/+$/, "");
  return s || "/";
}

/**
 * True when two directories are equal or one contains the other. A tab's
 * shell cwd can move into (or up from) the directory the agent was started
 * in, so a strict equality check would reject valid reports.
 */
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

/** Fields a tab gains when it latches a reported agent session. */
export interface AgentSessionPatch {
  agentSession: string;
  agentSessionDir?: string;
}

/**
 * Decide whether to latch a reported session id onto a tab. Returns the
 * fields to set, or null to ignore the report.
 *
 * A report carrying a directory must point at the tab's directory; a
 * directory-less report (older plugin) may only fill an empty slot, so a
 * blind report can never clobber an already-validated id.
 */
export function latchPatch(
  tab: Pick<Tab, "agentSession" | "agentSessionDir" | "cwd">,
  id: string | null | undefined,
  dir: string | null | undefined,
): AgentSessionPatch | null {
  if (!id) return null;
  const dir2 = dir || undefined;
  if (id === tab.agentSession) {
    // Same session: only worth saving when we finally learned its directory.
    if (dir2 && dir2 !== tab.agentSessionDir && dirsCompatible(dir2, tab.cwd)) {
      return { agentSession: id, agentSessionDir: dir2 };
    }
    return null;
  }
  if (dir2) {
    if (!dirsCompatible(dir2, tab.cwd)) return null;
  } else if (tab.agentSession) {
    return null;
  }
  return { agentSession: id, ...(dir2 ? { agentSessionDir: dir2 } : {}) };
}

/** The opencode session title behind a tab label ("OC | <title>"). */
export function opencodeTitleFromLabel(label: string): string {
  return label
    .replace(/^OC\s*\|\s*/, "")
    .replace(/[.…\u2026]+\s*$/, "")
    .trim();
}

/**
 * Best session for a restored tab, from opencode's session list: scoped to
 * the tab's directory, exact title match first, then prefix match (the tab
 * label may be truncated). Most recently updated wins ties. Null when
 * nothing matches.
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
  if (matches.length === 0) return null;
  matches = [...matches].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  return matches[0]?.id ?? null;
}

/** The command that resumes one exact opencode session. */
export function opencodeResume(id: string): string {
  return `opencode -s ${id}`;
}

export interface RestoreOptions {
  /** The tab existed in the saved session file (vs. opened this launch). */
  restored: boolean;
  /** Sessions from `opencode session list`; empty when unavailable. */
  sessions: AgentSessionInfo[];
  /** Fresh tab command (no session to resume). */
  agentCommand: string;
  /** Configured "resume last session" command, the final fallback. */
  agentResumeCommand: string;
}

/**
 * The command an agent tab should run on this launch. A restored tab tries
 * its stored session id (validated against the live list), then a
 * title+directory match, then the last-in-folder resume command; a new tab
 * starts fresh.
 */
export function restoreCommand(
  tab: Pick<
    Tab,
    "agent" | "agentSession" | "agentSessionDir" | "agentResume" | "title" | "cwd"
  >,
  o: RestoreOptions,
): string {
  if (!tab.agent) return "";
  if (!o.restored) return o.agentCommand.trim();

  if (tab.agentSession) {
    const known = o.sessions.find((s) => s.id === tab.agentSession);
    if (known) {
      if (dirsCompatible(known.directory, tab.cwd)) return opencodeResume(tab.agentSession);
    } else if (dirsCompatible(tab.agentSessionDir, tab.cwd)) {
      // Not in the list (offline / stale list) but its stored directory matches.
      return opencodeResume(tab.agentSession);
    }
  }

  const byTitle = pickSessionByTitle(o.sessions, tab.title, tab.cwd);
  if (byTitle) return opencodeResume(byTitle);

  return (tab.agentResume ?? o.agentResumeCommand).trim();
}
