import { describe, it, expect } from "vitest";
import { clockText } from "./clock";

describe("clockText", () => {
  it("formats date and time together", () => {
    // Local components, so the test is timezone-independent.
    expect(clockText(new Date(2026, 9, 4, 14, 23, 5))).toBe("Sun 2026-10-04 14:23:05");
  });

  it("pads every numeric field", () => {
    expect(clockText(new Date(2026, 0, 9, 3, 4, 5))).toBe("Fri 2026-01-09 03:04:05");
  });

  it("has a stable shape", () => {
    expect(clockText(new Date(2026, 5, 15, 0, 0, 0))).toMatch(
      /^[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});
