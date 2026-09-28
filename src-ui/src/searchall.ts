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

export function collectMatches(
  query: string,
  scope: SearchScope,
  currentWs: number,
  tabs: SearchableTab[],
  limit = 50,
): SearchOutcome {
  const q = query.trim().toLowerCase();
  const items: SearchHit[] = [];
  let total = 0;
  if (q.length < 2) return { total: 0, items };

  for (const t of tabs) {
    if (scope === "session" && t.wsIndex !== currentWs) continue;
    if (scope === "tab" && !(t.wsIndex === currentWs && t.active)) continue;

    if (`${t.wsName} ${t.title}`.toLowerCase().includes(q)) {
      total++;
      if (items.length < limit) {
        items.push({ wsIndex: t.wsIndex, tabId: t.tabId, crumb: `${t.wsName} › ${t.title}`, text: `tab: ${t.title}` });
      }
    }
    for (const line of t.lines) {
      if (!line.toLowerCase().includes(q)) continue;
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
