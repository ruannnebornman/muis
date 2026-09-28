/**
 * muis theme. Values mirror ../wezterm-web/index.html (:root tokens).
 * The old Muis Dark mock (design/mock.html) is superseded.
 */
export const MUIS_THEME = {
  termBg: "#1d2023",
  termFg: "#fcfcfc",
  chromeBg: "#232629",
  chromeFg: "#fcfcfc",
  dim: "#9ca4ab",
  accent: "#3daee9",
  accent2: "#7bbfb6",
  green: "#9ece6a",
  yellow: "#e0af68",
  red: "#da4453",
  selectedBg: "#31363b",
  selectedFg: "#fcfcfc",
  border: "#3a4147",
  borderDark: "#17191b",
  radius: 4,
  termFont: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace",
  uiFont: "'Noto Sans',system-ui,'Segoe UI',Roboto,sans-serif",
  uiSizePt: 10,
} as const;

/** Stable color per name — rename something and its color follows (mock). */
const PALETTE = [
  "#7aa2f7",
  "#9ece6a",
  "#e0af68",
  "#bb9af7",
  "#7dcfff",
  "#f7768e",
  "#56b6c2",
  "#c678dd",
];

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Accent themes from the mock (../wezterm-web/index.html). Each recolors
 * the terminal accents and the chrome accent variables; the Breeze
 * background/foreground stays put. `default` is the base Muis look.
 */
export interface ThemeSpec {
  accent: string;
  accent2: string;
  green: string;
  promptPath: string;
}

export const THEMES: Record<string, ThemeSpec> = {
  default: {
    accent: MUIS_THEME.accent,
    accent2: MUIS_THEME.accent2,
    green: MUIS_THEME.green,
    promptPath: MUIS_THEME.green,
  },
  "tokyo-night": {
    accent: "#7aa2f7",
    accent2: "#bb9af7",
    green: "#9ece6a",
    promptPath: "#9ece6a",
  },
  gruvbox: {
    accent: "#fabd2f",
    accent2: "#d3869b",
    green: "#b8bb26",
    promptPath: "#b8bb26",
  },
  dracula: {
    accent: "#bd93f9",
    accent2: "#ff79c6",
    green: "#50fa7b",
    promptPath: "#50fa7b",
  },
  catppuccin: {
    accent: "#89b4fa",
    accent2: "#cba6f7",
    green: "#a6e3a1",
    promptPath: "#a6e3a1",
  },
  nord: {
    accent: "#88c0d0",
    accent2: "#b48ead",
    green: "#a3be8c",
    promptPath: "#a3be8c",
  },
};

export function themeNames(): string[] {
  return Object.keys(THEMES);
}

/** Recolor the chrome accent variables for the given theme name. */
export function applyTheme(name: string | null): void {
  const t = THEMES[name ?? "default"] ?? THEMES.default;
  const r = document.documentElement.style;
  r.setProperty("--accent", t.accent);
  r.setProperty("--accent2", t.accent2);
  r.setProperty("--green", t.green);
  r.setProperty("--cyan", t.accent);
  r.setProperty("--prompt-user", t.accent);
  r.setProperty("--prompt-host", t.accent2);
  r.setProperty("--prompt-path", t.promptPath);
}

/** xterm.js theme mapping for the terminal surface. */
export function xtermTheme(name: string | null = null) {
  const base = {
    background: MUIS_THEME.termBg,
    foreground: MUIS_THEME.termFg,
    cursor: MUIS_THEME.accent,
    cursorAccent: MUIS_THEME.termBg,
    selectionBackground: "#3daee955",
    selectionForeground: MUIS_THEME.termFg,
    black: "#1d2023",
    red: "#f7768e",
    green: MUIS_THEME.green,
    yellow: MUIS_THEME.yellow,
    blue: MUIS_THEME.accent,
    magenta: "#bb9af7",
    cyan: MUIS_THEME.accent2,
    white: "#c5cddb",
    brightBlack: "#4a5258",
    brightRed: "#ff7a93",
    brightGreen: "#b8e986",
    brightYellow: "#e5c07b",
    brightBlue: "#7dcfff",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  };
  if (!name || name === "default" || !THEMES[name]) return base;
  const t = THEMES[name];
  return {
    ...base,
    cursor: t.accent,
    selectionBackground: `${t.accent}55`,
    green: t.green,
    blue: t.accent,
    cyan: t.accent2,
    brightGreen: t.green,
    brightBlue: t.accent,
    brightCyan: t.accent2,
  };
}
