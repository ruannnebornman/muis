import { describe, expect, it } from "vitest";
import { LONG_COMMAND_MS, shouldToastOnFinish, type FinishContext } from "./finish";

const ctx = (over: Partial<FinishContext> = {}): FinishContext => ({
  durationMs: LONG_COMMAND_MS,
  sawOsc: true,
  windowFocused: false,
  agentNotified: false,
  ...over,
});

describe("shouldToastOnFinish", () => {
  it("toasts a long command that ended while unfocused", () => {
    expect(shouldToastOnFinish(ctx())).toBe(true);
  });

  it("stays quiet for a short command", () => {
    expect(shouldToastOnFinish(ctx({ durationMs: 5_000 }))).toBe(false);
    expect(shouldToastOnFinish(ctx({ durationMs: LONG_COMMAND_MS - 1 }))).toBe(false);
  });

  it("toasts at exactly the threshold", () => {
    expect(shouldToastOnFinish(ctx({ durationMs: LONG_COMMAND_MS }))).toBe(true);
  });

  it("stays quiet while the window is focused", () => {
    expect(shouldToastOnFinish(ctx({ windowFocused: true }))).toBe(false);
  });

  it("stays quiet without a real OSC 133 end or a duration", () => {
    expect(shouldToastOnFinish(ctx({ sawOsc: false }))).toBe(false);
    expect(shouldToastOnFinish(ctx({ durationMs: null }))).toBe(false);
  });

  it("stays quiet when an agent already notified", () => {
    expect(shouldToastOnFinish(ctx({ agentNotified: true }))).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(shouldToastOnFinish(ctx({ durationMs: 3_000 }), 1_000)).toBe(true);
    expect(shouldToastOnFinish(ctx({ durationMs: 3_000 }), 5_000)).toBe(false);
  });
});
