/** View options. Mirrors muis-core AppConfig; persisted as JSON. */
export interface AppConfig {
  showSessions: boolean;
  tabsOnTop: boolean;
  /** Terminal font size in points. null = system fixed font + 2. */
  fontSize: number | null;
  /** Accent theme name; null keeps the default look. */
  theme: string | null;
}

export function defaultConfig(): AppConfig {
  return { showSessions: true, tabsOnTop: false, fontSize: null, theme: null };
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
    tabsOnTop: typeof r.tabsOnTop === "boolean" ? r.tabsOnTop : base.tabsOnTop,
    fontSize:
      typeof r.fontSize === "number" && r.fontSize >= 6 && r.fontSize <= 32
        ? Math.floor(r.fontSize)
        : base.fontSize,
    theme: typeof r.theme === "string" ? r.theme : base.theme,
  };
}

/** Effective point size: explicit setting, else 12 (system fixed + 2). */
export function effectiveFontSize(cfg: AppConfig): number {
  return cfg.fontSize ?? 12;
}
