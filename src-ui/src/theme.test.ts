import { describe, expect, it } from "vitest";
import { MUIS_THEME, colorFor } from "./theme";

/**
 * Locks the look to ../wezterm-web/index.html. Restyle there first,
 * then update here and theme.ts together.
 */
describe("muis theme", () => {
  it("matches the mock palette", () => {
    expect(MUIS_THEME.termBg).toBe("#1d2023");
    expect(MUIS_THEME.termFg).toBe("#fcfcfc");
    expect(MUIS_THEME.chromeBg).toBe("#232629");
    expect(MUIS_THEME.accent).toBe("#3daee9");
    expect(MUIS_THEME.accent2).toBe("#7bbfb6");
    expect(MUIS_THEME.green).toBe("#9ece6a");
    expect(MUIS_THEME.red).toBe("#da4453");
    expect(MUIS_THEME.radius).toBe(4);
  });

  it("colors names stably (rename follows color)", () => {
    expect(colorFor("veldmuis")).toBe(colorFor("veldmuis"));
    expect(colorFor("a")).not.toBe(colorFor("b"));
    expect(colorFor("")).toBe("#7aa2f7");
  });
});
