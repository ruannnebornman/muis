/**
 * Keyboard shortcut resolution. Pure: given a key event shape, return
 * the action the chrome should take (or null). Keeps the binding table
 * in one place and testable.
 */

export type ShortcutAction =
  | { type: "new-tab" }
  | { type: "close-tab" }
  | { type: "focus-search" }
  | { type: "focus-terminal" }
  | { type: "open-settings" }
  | { type: "switch-tab"; index: number }
  | { type: "cycle-tab"; delta: number }
  | { type: "close-overlay" };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const plainCtrl = e.ctrlKey && !e.shiftKey && !e.altKey;
  const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey;

  if (plainCtrl && lower === "t") return { type: "new-tab" };
  if (ctrlShift && lower === "t") return { type: "new-tab" };
  if (ctrlShift && lower === "w") return { type: "close-tab" };
  if (plainCtrl && lower === "f") return { type: "focus-search" };
  if (ctrlShift && key === "F12") return { type: "focus-terminal" };
  if (plainCtrl && key === ",") return { type: "open-settings" };

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const m = /^(?:Digit)?([1-9])$/.exec(e.code ?? "");
    const digit = m ? Number(m[1]) : /^[1-9]$/.test(key) ? Number(key) : 0;
    if (digit > 0) return { type: "switch-tab", index: digit - 1 };
  }

  if (e.ctrlKey && key === "PageDown") return { type: "cycle-tab", delta: 1 };
  if (e.ctrlKey && key === "PageUp") return { type: "cycle-tab", delta: -1 };

  if (key === "Escape") return { type: "close-overlay" };
  return null;
}
