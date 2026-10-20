/**
 * Bounded restore pump. Starting every agent tab at once spikes CPU and
 * thrashes I/O, so at most `limit` starts are in flight and the next one is
 * staggered. Pure enough to test with an injected scheduler and start fn.
 */
import type { RestoreEntry } from "./agentSessions";

export const RESTORE_CONCURRENCY = 3;
export const RESTORE_STAGGER_MS = 300;

export interface RestorePumpOptions {
  limit?: number;
  staggerMs?: number;
  start: (entry: RestoreEntry) => Promise<void> | void;
  schedule?: (fn: () => void, ms: number) => void;
}

export class RestorePump {
  private queue: RestoreEntry[] = [];
  private active = 0;
  private readonly limit: number;
  private readonly staggerMs: number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(private readonly options: RestorePumpOptions) {
    this.limit = Math.max(1, options.limit ?? RESTORE_CONCURRENCY);
    this.staggerMs = options.staggerMs ?? RESTORE_STAGGER_MS;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  get inFlight(): number {
    return this.active;
  }

  get pending(): number {
    return this.queue.length;
  }

  push(entries: readonly RestoreEntry[]): void {
    this.queue.push(...entries);
    this.pump();
  }

  private pump(): void {
    if (this.active >= this.limit || this.queue.length === 0) return;
    const entry = this.queue.shift()!;
    this.active++;
    let run: Promise<void>;
    try {
      run = Promise.resolve(this.options.start(entry));
    } catch {
      run = Promise.resolve();
    }
    void run
      .catch(() => {})
      .finally(() => {
        this.active--;
        this.pump();
      });
    // Stagger the next start so a full window does not boot in one tick.
    this.schedule(() => this.pump(), this.staggerMs);
  }
}
