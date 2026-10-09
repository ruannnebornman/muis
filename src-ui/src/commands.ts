/** Command palette model: a flat, filtered list of commands. */

export interface Command {
  id: string;
  title: string;
}

/** Case-insensitive substring filter; an empty query returns everything. */
export function filterCommands<T extends Command>(query: string, commands: T[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.title.toLowerCase().includes(q));
}

/** Clamp a list index into range (for arrow-key navigation). */
export function clampIndex(index: number, length: number): number {
  if (length === 0) return -1;
  return Math.max(0, Math.min(length - 1, index));
}
