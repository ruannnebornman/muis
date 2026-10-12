import { describe, it, expect } from "vitest";
import { clockText } from "./clock";

describe("clockText", () => {
  it("formats date and time together, without seconds", () => {
    // Local components, so the test is timezone-independent.
    expect(clockText(new Date(2026, 9, 4, 14, 23, 5))).toBe("04 Oct 2026 14:23");
  });

  it("drops seconds entirely", () => {
    expect(clockText(new Date(2026, 9, 4, 14, 23, 59))).toBe("04 Oct 2026 14:23");
  });

  it("pads every numeric field", () => {
    expect(clockText(new Date(2026, 0, 9, 3, 4, 5))).toBe("09 Jan 2026 03:04");
  });

  it("has a stable shape", () => {
    expect(clockText(new Date(2026, 5, 15, 0, 0, 0))).toMatch(
      /^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/,
    );
  });

  it("keeps a constant width as the minute rolls over", () => {
    const before = clockText(new Date(2026, 9, 4, 14, 23, 59));
    const after = clockText(new Date(2026, 9, 4, 14, 24, 0));
    expect(before.length).toBe(after.length);
  });

  it("keeps a constant width across month-name lengths", () => {
    const september = clockText(new Date(2026, 8, 4, 0, 0, 0));
    const october = clockText(new Date(2026, 9, 4, 0, 0, 0));
    expect(september.length).toBe(october.length);
  });
});
