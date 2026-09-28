/**
 * Tracks tabs with a completed command the user hasn't looked at yet,
 * so the chrome can badge them and the window title can count them.
 */
export class DoneTracker {
  private done = new Set<string>();

  mark(id: string): void {
    this.done.add(id);
  }

  clear(id: string): void {
    this.done.delete(id);
  }

  has(id: string): boolean {
    return this.done.has(id);
  }

  count(): number {
    return this.done.size;
  }

  forget(id: string): void {
    this.done.delete(id);
  }
}
