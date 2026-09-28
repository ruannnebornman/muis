/**
 * Last-command bar state machine. Pure and clock-injected so it unit
 * tests without a terminal. main.ts feeds it keystrokes (provisional
 * command line) and OSC 133 markers (authoritative), then renders.
 *
 * Precedence for the command text:
 *   1. the shell-reported line (`cmdline_url` on OSC 133;C)
 *   2. captured keystrokes
 *   3. the on-screen prompt line (caller fallback)
 */

export interface CommandState {
  lastCmd: string | null;
  lastExit: number | null;
  lastMs: number | null;
  running: boolean;
  startedAt: number | null;
  /** Raw typed line (best effort; shell completion can rewrite it). */
  input: string;
  /** A real OSC 133 marker was seen: trust it over the idle fallback. */
  sawOsc: boolean;
}

function blank(): CommandState {
  return {
    lastCmd: null,
    lastExit: null,
    lastMs: null,
    running: false,
    startedAt: null,
    input: "",
    sawOsc: false,
  };
}

export class CommandTracker {
  private states = new Map<string, CommandState>();

  constructor(private now: () => number = () => Date.now()) {}

  state(id: string): CommandState {
    let s = this.states.get(id);
    if (!s) {
      s = blank();
      this.states.set(id, s);
    }
    return s;
  }

  forget(id: string): void {
    this.states.delete(id);
  }

  /**
   * Accumulate keystrokes. Returns true when Enter started a command so
   * the caller can render the running state immediately.
   */
  onInput(id: string, data: string): boolean {
    const st = this.state(id);
    if (data.startsWith("\x1b")) return false; // escape sequences
    let began = false;
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        const cmd = st.input.trim();
        st.input = "";
        if (cmd && !st.running) {
          st.lastCmd = cmd;
          st.running = true;
          st.startedAt = this.now();
          st.lastExit = null;
          st.lastMs = null;
          began = true;
        }
      } else if (ch === "\x7f" || ch === "\b") {
        st.input = st.input.slice(0, -1);
      } else if (ch === "\x03" || ch === "\x15") {
        st.input = ""; // ctrl-c / ctrl-u
      } else if (ch >= " ") {
        st.input += ch;
      }
    }
    return began;
  }

  /** OSC 133;C. `cmd` (shell-reported line) always wins for the label. */
  onCmdStart(id: string, cmd?: string): void {
    const st = this.state(id);
    st.sawOsc = true;
    const clean = cmd?.trim();
    if (!st.running) {
      st.running = true;
      st.startedAt = this.now();
      st.lastExit = null;
      st.lastMs = null;
      st.lastCmd = clean || st.lastCmd;
    } else if (clean) {
      st.lastCmd = clean;
    }
  }

  /** OSC 133;D (or the idle fallback with exit = null). */
  onCmdEnd(id: string, exit: number | null): void {
    const st = this.state(id);
    if (!st.running) return;
    st.running = false;
    st.lastExit = exit;
    st.lastMs = st.startedAt === null ? null : Math.max(1, Math.round(this.now() - st.startedAt));
    st.startedAt = null;
  }
}
