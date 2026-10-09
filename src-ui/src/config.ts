/** View options. Mirrors muis-core AppConfig; persisted as JSON. */
export interface AppConfig {
  showSessions: boolean;
  /** Terminal font size in points. null = system fixed font + 2. */
  fontSize: number | null;
  /** Accent theme name; null keeps the default look. */
  theme: string | null;
  /** Command the "new AI tab" action runs. Empty disables the AI option. */
  agentCommand: string;
  /** Command an AI tab runs when restored, so it resumes its last session. */
  agentResumeCommand: string;
  /** Terminal scrollback buffer, in lines (clamped 1000..500000). */
  scrollback: number;
  /** Chord overrides per action, e.g. { "close-tab": "ctrl+q" }. */
  keybindings: Record<string, string>;
  /** Copy the selection to the clipboard automatically. */
  copyOnSelect: boolean;
  /** Middle-click pastes the clipboard into the terminal. */
  middleClickPaste: boolean;
  /** Terminal font family; null keeps the muis default. */
  fontFamily: string | null;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  /** What the terminal bell does. */
  bell: "none" | "visual" | "audible" | "both";
  /** Statusbar segment visibility (id -> visible; absent = shown). */
  statusbar: Record<string, boolean>;
}

/** Whether a statusbar segment is shown (absent = shown). */
export function segmentVisible(map: Record<string, boolean>, id: string): boolean {
  return map[id] !== false;
}

export type BellMode = "none" | "visual" | "audible" | "both";

/** Visual/audible actions for a bell mode. */
export function bellAction(mode: BellMode): { visual: boolean; audible: boolean } {
  return {
    visual: mode === "visual" || mode === "both",
    audible: mode === "audible" || mode === "both",
  };
}

export function defaultConfig(): AppConfig {
  return {
    showSessions: true,
    fontSize: null,
    theme: null,
    agentCommand: "opencode",
    agentResumeCommand: "opencode --continue",
    scrollback: 50000,
    keybindings: {},
    copyOnSelect: false,
    middleClickPaste: false,
    fontFamily: null,
    cursorStyle: "block",
    cursorBlink: true,
    bell: "none",
    statusbar: {},
  };
}

/** Keep only boolean values from a raw map. */
function parseBoolMap(raw: unknown, base: Record<string, boolean>): Record<string, boolean> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return base;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Keep only non-empty string chord values. */
function parseKeybindings(raw: unknown, base: Record<string, string>): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return base;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** Clamp a scrollback value into a sane range. */
export function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return defaultConfig().scrollback;
  return Math.min(500000, Math.max(1000, Math.floor(value)));
}

export function configFromJSON(json: string): AppConfig {
  const base = defaultConfig();
  if (!json) return base;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("config file is not JSON");
  }
  if (typeof raw !== "object" || raw === null) throw new Error("config file has no object");
  const r = raw as Partial<Record<keyof AppConfig, unknown>>;
  return {
    showSessions: typeof r.showSessions === "boolean" ? r.showSessions : base.showSessions,
    fontSize:
      typeof r.fontSize === "number" && r.fontSize >= 6 && r.fontSize <= 32
        ? Math.floor(r.fontSize)
        : base.fontSize,
    theme: typeof r.theme === "string" ? r.theme : base.theme,
    agentCommand:
      typeof r.agentCommand === "string" ? r.agentCommand : base.agentCommand,
    agentResumeCommand:
      typeof r.agentResumeCommand === "string"
        ? r.agentResumeCommand
        : base.agentResumeCommand,
    scrollback:
      typeof r.scrollback === "number" ? clampScrollback(r.scrollback) : base.scrollback,
    keybindings: parseKeybindings(r.keybindings, base.keybindings),
    copyOnSelect: typeof r.copyOnSelect === "boolean" ? r.copyOnSelect : base.copyOnSelect,
    middleClickPaste:
      typeof r.middleClickPaste === "boolean" ? r.middleClickPaste : base.middleClickPaste,
    fontFamily:
      typeof r.fontFamily === "string" && r.fontFamily.trim() ? r.fontFamily.trim() : base.fontFamily,
    cursorStyle:
      r.cursorStyle === "block" || r.cursorStyle === "bar" || r.cursorStyle === "underline"
        ? r.cursorStyle
        : base.cursorStyle,
    cursorBlink: typeof r.cursorBlink === "boolean" ? r.cursorBlink : base.cursorBlink,
    bell:
      r.bell === "none" || r.bell === "visual" || r.bell === "audible" || r.bell === "both"
        ? r.bell
        : base.bell,
    statusbar: parseBoolMap(r.statusbar, base.statusbar),
  };
}

/** Effective point size: explicit setting, else 12 (system fixed + 2). */
export function effectiveFontSize(cfg: AppConfig): number {
  return cfg.fontSize ?? 12;
}
