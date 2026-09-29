/**
 * Path helpers for the chrome. Pure so they unit test without the DOM.
 */

/** Collapse the home prefix to `~` for display (e.g. status bar, sessions). */
export function shortPath(path: string, home: string): string {
  if (!home) return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

/** Expand a leading `~/` to the real home directory. */
export function expandHome(path: string, home: string): string {
  if (home && path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
}
