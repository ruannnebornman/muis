/**
 * Statusbar clock text. Pure and locale-independent so the format is
 * testable: `Sun 2026-10-04 14:23`.
 *
 * Seconds are omitted: they tick noisily and steal attention. Every field
 * has a fixed width (three-letter day name, zero-padded date and time), so
 * the pill does not resize when the minute or the day rolls over.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function clockText(now: Date): string {
  const date = `${DAYS[now.getDay()]} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date} ${time}`;
}
