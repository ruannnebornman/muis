/**
 * Notification anti-corruption layer. Every source — terminal OSC 9/777/99,
 * the `muis-notify` CLI, and muis's own command-finished event — is
 * normalized here into one `NotifyEvent`, then routed through one policy:
 * a tab the user is not looking at is badged as done, and a desktop toast
 * fires only while the muis window is unfocused. Identical notifications
 * from one tab inside a short window are dropped so a chatty agent cannot
 * re-badge the same completion repeatedly.
 */
import type { NotifyEvent } from "./osc";

export type { NotifyEvent } from "./osc";

/** Payload of a `muis-notify` request forwarded by the shell. */
export interface CliNotify {
  title?: string | null;
  body: string;
  tab_id?: string | null;
  urgency?: number;
}

/** Turn a `muis-notify` request into a notification event. */
export function notifyEventFromCli(req: CliNotify): NotifyEvent {
  const ev: NotifyEvent = { type: "notify", title: req.title ?? null, body: req.body, source: "cli" };
  if (req.urgency !== undefined) ev.urgency = req.urgency;
  return ev;
}

/** Turn a locally detected event (e.g. a long command ended) into one. */
export function notifyEventFromCommand(title: string | null, body: string): NotifyEvent {
  return { type: "notify", title, body, source: "command" };
}

export interface NotifyContext {
  /** The originating tab is the active tab of the shown workspace. */
  visible: boolean;
  /** The muis window currently has keyboard focus. */
  windowFocused: boolean;
}

export interface NotifyDecision {
  /** Badge the originating tab because the user was not looking at it. */
  markDone: boolean;
  /** Raise a desktop notification because the window is not focused. */
  toast: boolean;
}

export const NOTIFY_DEDUPE_MS = 1500;

export class NotifyRouter {
  private last = new Map<string, { key: string; at: number }>();

  constructor(private readonly dedupeMs: number = NOTIFY_DEDUPE_MS) {}

  /**
   * Route one notification from `tabId`. Returns null for a duplicate of the
   * tab's previous notification; otherwise the actions to apply.
   */
  route(tabId: string, ev: NotifyEvent, ctx: NotifyContext, now: number): NotifyDecision | null {
    const key = `${ev.source}\u0000${ev.title ?? ""}\u0000${ev.body}`;
    const prev = this.last.get(tabId);
    if (prev && prev.key === key && now - prev.at < this.dedupeMs) return null;
    this.last.set(tabId, { key, at: now });
    return { markDone: !ctx.visible, toast: !ctx.windowFocused };
  }

  forget(tabId: string): void {
    this.last.delete(tabId);
  }

  /** Time of the tab's most recent notification, or undefined. */
  lastAt(tabId: string): number | undefined {
    return this.last.get(tabId)?.at;
  }
}
