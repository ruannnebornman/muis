/**
 * Statusbar clock text. Pure and locale-independent so the format is
 * testable: `04 Oct 2026 14:23`.
 *
 * Seconds are omitted: they tick noisily and steal attention. Every field
 * has a fixed width (zero-padded day, three-letter month, four-digit year,
 * zero-padded time), so the pill does not resize when the minute or the
 * day rolls over.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function clockText(now: Date): string {
  const date = `${pad(now.getDate())} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date} ${time}`;
}
