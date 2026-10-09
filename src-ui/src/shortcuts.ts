/**
 * Keyboard shortcut resolution. Pure: given a key event shape, return
 * the action the chrome should take (or null). Keeps the binding table
 * in one place and testable.
 */

export type ShortcutAction =
  | { type: "new-tab" }
  | { type: "new-agent-tab" }
  | { type: "close-tab" }
  | { type: "focus-search" }
  | { type: "focus-terminal" }
  | { type: "open-settings" }
  | { type: "command-palette" }
  | { type: "switch-tab"; index: number }
  | { type: "cycle-tab"; delta: number }
  | { type: "cycle-session"; delta: number }
  | { type: "close-overlay" };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

/** Actions that carry no parameters, so a chord override maps cleanly. */
const SIMPLE_ACTIONS = new Set([
  "new-tab",
  "new-agent-tab",
  "close-tab",
  "focus-search",
  "focus-terminal",
  "open-settings",
  "command-palette",
  "close-overlay",
]);

const MODS = new Set(["ctrl", "control", "shift", "alt", "meta", "cmd", "super"]);

/** Whether a keyboard event matches a chord like "ctrl+shift+w". */
export function matchesChord(e: KeyLike, chord: string): boolean {
  const parts = chord.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const key = [...parts].reverse().find((p) => !MODS.has(p));
  if (!key) return false;
  const want = (names: string[]): boolean => parts.some((p) => names.includes(p));
  if (!!e.ctrlKey !== want(["ctrl", "control"])) return false;
  if (!!e.shiftKey !== want(["shift"])) return false;
  if (!!e.altKey !== want(["alt"])) return false;
  if (!!e.metaKey !== want(["meta", "cmd", "super"])) return false;
  const k = (e.key ?? "").toLowerCase();
  const code = (e.code ?? "").toLowerCase();
  return k === key || code === key || code === `key${key}`;
}

export function resolveShortcut(e: KeyLike, overrides?: Record<string, string>): ShortcutAction | null {
  if (overrides) {
    for (const [action, chord] of Object.entries(overrides)) {
      if (SIMPLE_ACTIONS.has(action) && matchesChord(e, chord)) {
        return { type: action } as ShortcutAction;
      }
    }
  }
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const plainCtrl = e.ctrlKey && !e.shiftKey && !e.altKey;
  const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey;

  if (plainCtrl && lower === "t") return { type: "new-tab" };
  if (ctrlShift && lower === "t") return { type: "new-tab" };
  if (ctrlShift && lower === "a") return { type: "new-agent-tab" };
  if (ctrlShift && lower === "w") return { type: "close-tab" };
  // ctrl+shift+f is the reliable binding (ctrl+f is consumed by the
  // focused terminal / browser find before the chrome sees it).
  if (ctrlShift && lower === "f") return { type: "focus-search" };
  if (plainCtrl && lower === "f") return { type: "focus-search" };
  if (ctrlShift && key === "F12") return { type: "focus-terminal" };
  if (plainCtrl && key === ",") return { type: "open-settings" };
  if (ctrlShift && lower === "p") return { type: "command-palette" };

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const m = /^(?:Digit)?([1-9])$/.exec(e.code ?? "");
    const digit = m ? Number(m[1]) : /^[1-9]$/.test(key) ? Number(key) : 0;
    if (digit > 0) return { type: "switch-tab", index: digit - 1 };
  }

  // Tabs: ctrl+tab forwards, ctrl+shift+tab back.
  if (e.ctrlKey && (key === "Tab" || e.code === "Tab")) {
    return { type: "cycle-tab", delta: e.shiftKey ? -1 : 1 };
  }
  // Sessions: ctrl+page down/up moves between workspaces.
  if (e.ctrlKey && key === "PageDown") return { type: "cycle-session", delta: 1 };
  if (e.ctrlKey && key === "PageUp") return { type: "cycle-session", delta: -1 };

  if (key === "Escape") return { type: "close-overlay" };
  return null;
}
