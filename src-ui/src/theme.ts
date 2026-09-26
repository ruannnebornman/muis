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

/** xterm.js theme mapping for the terminal surface. */
export function xtermTheme() {
  return {
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
}
