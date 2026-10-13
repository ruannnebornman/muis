/**
 * Selection focus policy. Selecting a tab or a session should move keyboard
 * focus to its terminal so the user can type immediately, but not while a
 * reorder drag is in flight (a drag is not a selection) or while the search
 * box is in use (so search is not disrupted).
 */
export function shouldFocusTerminal(opts: {
  /** A reorder drag is in progress. */
  dragging: boolean;
  /** The search input or its results currently own focus. */
  searchFocused: boolean;
}): boolean {
  return !opts.dragging && !opts.searchFocused;
}
