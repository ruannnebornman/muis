/**
 * Cross-session search. Pure matching over a snapshot of the open tabs
 * and their scrollback lines, so it unit tests without xterm or the DOM.
 */

export type SearchScope = "all" | "session" | "tab";

export interface SearchableTab {
  wsIndex: number;
  tabId: string;
  wsName: string;
  title: string;
  /** True when this tab is the visible tab of the current workspace. */
  active: boolean;
  /** Scrollback lines, oldest first. */
  lines: string[];
}

export interface SearchHit {
  wsIndex: number;
  tabId: string;
  crumb: string;
  text: string;
}

export interface SearchOutcome {
  total: number;
  items: SearchHit[];
}

export interface MatchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

/** Build a line matcher; an invalid regex matches nothing. */
export function makeMatcher(query: string, opts: MatchOptions = {}): (s: string) => boolean {
  const q = query.trim();
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(q, opts.caseSensitive ? "" : "i");
    } catch {
      return () => false;
    }
    return (s) => re.test(s);
  }
  const needle = opts.caseSensitive ? q : q.toLowerCase();
  return (s) => (opts.caseSensitive ? s : s.toLowerCase()).includes(needle);
}

export function collectMatches(
  query: string,
  scope: SearchScope,
  currentWs: number,
  tabs: SearchableTab[],
  limit = 50,
  opts: MatchOptions = {},
): SearchOutcome {
  const items: SearchHit[] = [];
  let total = 0;
  if (query.trim().length < 2) return { total: 0, items };
  const matches = makeMatcher(query, opts);

  for (const t of tabs) {
    if (scope === "session" && t.wsIndex !== currentWs) continue;
    if (scope === "tab" && !(t.wsIndex === currentWs && t.active)) continue;

    if (matches(`${t.wsName} ${t.title}`)) {
      total++;
      if (items.length < limit) {
        items.push({ wsIndex: t.wsIndex, tabId: t.tabId, crumb: `${t.wsName} › ${t.title}`, text: `tab: ${t.title}` });
      }
    }
    for (const line of t.lines) {
      if (!matches(line)) continue;
      total++;
      if (items.length < limit) {
        items.push({
          wsIndex: t.wsIndex,
          tabId: t.tabId,
          crumb: `${t.wsName} › ${t.title}`,
          text: line.trim().slice(0, 140) || "(blank line)",
        });
      }
    }
  }
  return { total, items };
}
