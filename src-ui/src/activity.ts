/**
 * Busy-tab tracking for close confirmations. A tab is "busy" while its
 * pty is alive and it produced output recently (or is very young) —
 * closing it would kill something the user probably still wants.
 * Pure time-in-millis logic so it unit-tests with fake clocks.
 */

export const BUSY_WINDOW_MS = 60000;

export interface ActivityState {
  /** Last output timestamp per tab, missing = never produced output. */
  lastOutputAt: Map<string, number>;
  /** Tabs whose pty already exited (never busy). */
  exited: Set<string>;
  /** When each tab's pty was spawned. */
  spawnedAt: Map<string, number>;
}

export function newActivityState(): ActivityState {
  return { lastOutputAt: new Map(), exited: new Set(), spawnedAt: new Map() };
}

export function isTabBusy(state: ActivityState, tabId: string, now: number): boolean {
  if (state.exited.has(tabId)) return false;
  const spawned = state.spawnedAt.get(tabId);
  if (spawned !== undefined && now - spawned < BUSY_WINDOW_MS) return true;
  const last = state.lastOutputAt.get(tabId);
  return last !== undefined && now - last < BUSY_WINDOW_MS;
}

export function anyTabBusy(state: ActivityState, tabIds: string[], now: number): boolean {
  return tabIds.some((id) => isTabBusy(state, id, now));
}

export function forgetTab(state: ActivityState, tabId: string): void {
  state.lastOutputAt.delete(tabId);
  state.exited.delete(tabId);
  state.spawnedAt.delete(tabId);
}
