import { describe, expect, it } from "vitest";
import { MUIS_THEME, colorFor, sessionColorMap, xtermTheme, themeNames, THEMES } from "./theme";

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

  it("keeps session colors distinct and reorder-stable", () => {
    const names = ["muis", "ratopia-seed-seeker", "the-far-side", "veldmuis"];
    const colors = sessionColorMap(names);
    expect(new Set(colors.values()).size).toBe(names.length);
    const reordered = sessionColorMap([...names].reverse());
    for (const name of names) expect(reordered.get(name)).toBe(colors.get(name));
  });

  it("has 15 palette slots and can color 15 sessions distinctly", () => {
    const names = Array.from({ length: 15 }, (_, i) => `session-${i}`);
    const colors = sessionColorMap(names);
    expect(new Set(colors.values()).size).toBe(15);
    expect(colorFor("")).toBe("#7aa2f7");
  });

  it("ships the mock themes plus the default", () => {
    expect(themeNames()).toEqual([
      "default",
      "tokyo-night",
      "gruvbox",
      "dracula",
      "catppuccin",
      "nord",
    ]);
    expect(THEMES.nord.accent).toBe("#88c0d0");
  });

  it("recolors xterm accents only for non-default themes", () => {
    expect(xtermTheme()).toEqual(xtermTheme("default"));
    expect(xtermTheme(null).cursor).toBe(MUIS_THEME.accent);
    const nord = xtermTheme("nord");
    expect(nord.cursor).toBe("#88c0d0");
    expect(nord.blue).toBe("#88c0d0");
    expect(nord.background).toBe(MUIS_THEME.termBg);
  });
});
