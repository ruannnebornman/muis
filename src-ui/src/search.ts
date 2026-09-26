/**
 * Scrollback search controller. Pure logic over a minimal addon
 * interface so it unit-tests without xterm; main.ts binds it to the
 * find bar DOM and the active tab's real SearchAddon.
 */
export interface SearchAdapter {
  findNext(term: string): boolean;
  findPrevious(term: string): boolean;
  clearDecorations(): void;
}

export class SearchController {
  private adapter: () => SearchAdapter | undefined;
  private query = "";
  private open = false;

  constructor(adapter: () => SearchAdapter | undefined) {
    this.adapter = adapter;
  }

  isOpen(): boolean {
    return this.open;
  }

  getQuery(): string {
    return this.query;
  }

  toggle(): boolean {
    this.open = !this.open;
    if (!this.open) {
      this.query = "";
      this.adapter()?.clearDecorations();
    }
    return this.open;
  }

  close(): void {
    if (this.open) this.toggle();
  }

  /** Returns false when there is nothing to search (closed/empty). */
  search(query: string, backwards = false): boolean {
    if (!this.open || !query) return false;
    this.query = query;
    const adapter = this.adapter();
    if (!adapter) return false;
    return backwards ? adapter.findPrevious(query) : adapter.findNext(query);
  }

  next(): boolean {
    return this.search(this.query);
  }

  previous(): boolean {
    return this.search(this.query, true);
  }
}
