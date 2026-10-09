/** Recent search queries, newest first, de-duplicated and capped. */
export class QueryHistory {
  private items: string[] = [];

  constructor(private readonly max = 20) {}

  add(query: string): void {
    const q = query.trim();
    if (!q) return;
    this.items = [q, ...this.items.filter((x) => x !== q)].slice(0, this.max);
  }

  list(): string[] {
    return this.items;
  }
}
