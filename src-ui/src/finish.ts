/**
 * Policy for notifying when a long foreground command finishes while the
 * window is unfocused. Pure and clock-free so it unit-tests directly; the
 * caller supplies the duration and focus/notification context.
 */

/** Commands shorter than this get the in-app badge only, never a toast. */
export const LONG_COMMAND_MS = 10_000;

export interface FinishContext {
  /** Command duration in ms, or null when unknown (idle fallback). */
  durationMs: number | null;
  /** A real OSC 133 cmd-end was seen, so the duration is trustworthy. */
  sawOsc: boolean;
  /** The muis window currently has keyboard focus. */
  windowFocused: boolean;
  /** An agent already notified for this tab during the command. */
  agentNotified: boolean;
}

/**
 * Toast only for a long command that ended while the window was unfocused
 * and no agent already notified for the same run, so a `codex`/`claude`
 * completion never produces two toasts.
 */
export function shouldToastOnFinish(
  ctx: FinishContext,
  thresholdMs: number = LONG_COMMAND_MS,
): boolean {
  if (!ctx.sawOsc) return false;
  if (ctx.windowFocused) return false;
  if (ctx.agentNotified) return false;
  return ctx.durationMs !== null && ctx.durationMs >= thresholdMs;
}
