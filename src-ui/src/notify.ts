/**
 * Policy for terminal notifications (OSC 9 / 777 / 99). Turns a raw
 * notification from a pty into a chrome action: a tab the user is not
 * looking at is badged as done, same as a finished command. Identical
 * notifications from one tab inside a short window are dropped so a chatty
 * agent cannot re-badge the same completion repeatedly.
 */
import type { NotifyEvent } from "./osc";

export interface NotifyDecision {
  /** Badge the originating tab because the user was not looking at it. */
  markDone: boolean;
}

export const NOTIFY_DEDUPE_MS = 1500;

export class NotifyRouter {
  private last = new Map<string, { key: string; at: number }>();

  constructor(private readonly dedupeMs: number = NOTIFY_DEDUPE_MS) {}

  /**
   * Route one notification from `tabId`. Returns null for a duplicate of the
   * tab's previous notification; otherwise the actions to apply.
   */
  route(tabId: string, ev: NotifyEvent, visible: boolean, now: number): NotifyDecision | null {
    const key = `${ev.source}\u0000${ev.title ?? ""}\u0000${ev.body}`;
    const prev = this.last.get(tabId);
    if (prev && prev.key === key && now - prev.at < this.dedupeMs) return null;
    this.last.set(tabId, { key, at: now });
    return { markDone: !visible };
  }

  forget(tabId: string): void {
    this.last.delete(tabId);
  }
}
