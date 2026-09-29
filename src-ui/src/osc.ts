/**
 * Minimal OSC sequence observer. Watches pty output for:
 *   OSC 7 ; file://host/path BEL    -> current working directory
 *   OSC 0/2 ; title BEL|ST           -> window/tab title
 *   OSC 9 ; message BEL              -> desktop notification (iTerm2)
 *   OSC 777 ; notify ; title ; body  -> desktop notification (rxvt)
 *   OSC 99 ; meta ; payload ST       -> desktop notification (kitty)
 * Everything else passes through untouched (xterm still gets the full
 * byte stream). Sequences split across output chunks are reassembled.
 *
 * Fish on Veldmuis already emits cwd/title, so this works with zero shell
 * config. Other shells need an OSC 7 prompt hook (see README).
 */

export type NotifySource = "osc9" | "osc777" | "osc99";

export type NotifyEvent = {
  type: "notify";
  title: string | null;
  body: string;
  source: NotifySource;
  /** OSC 99 urgency: 0 low, 1 normal, 2 critical. */
  urgency?: number;
};

export type OscEvent =
  | { type: "cwd"; path: string }
  | { type: "title"; title: string }
  | { type: "cmd-start"; cmd?: string }
  | { type: "cmd-end"; exit: number | null }
  | NotifyEvent;

/** In-flight OSC 99 fragments, keyed by notification id. */
interface PendingNotify {
  title: string;
  body: string;
  urgency?: number;
}

/** Cap reassembled OSC 99 text to avoid unbounded growth from a stuck app. */
const MAX_NOTIFY_CHARS = 8192;

const ESC = 0x1b;
const BEL = 0x07;
const utf8 = new TextDecoder();

export class OscParser {
  private pending: number[] = [];
  private notifChunks = new Map<string, PendingNotify>();

  /** Feed raw pty bytes; returns any completed OSC events. */
  push(bytes: Uint8Array): OscEvent[] {
    const events: OscEvent[] = [];
    // Prepend any incomplete tail from the previous chunk.
    const buf = this.pending.length > 0
      ? [...this.pending, ...bytes]
      : [...bytes];
    this.pending = [];
    let i = 0;
    while (i < buf.length) {
      if (buf[i] === ESC && i + 1 < buf.length && buf[i + 1] === 0x5d /* ] */) {
        const end = findOscEnd(buf, i + 2);
        if (end === -1) {
          // Incomplete: hold for the next chunk (cap runaway growth).
          this.pending = buf.slice(i).slice(-4096);
          break;
        }
        const body = utf8.decode(Uint8Array.from(buf.slice(i + 2, end.termStart)));
        const ev = parseOscBody(body, this.notifChunks);
        if (ev) events.push(ev);
        i = end.next;
      } else {
        i++;
      }
    }
    return events;
  }
}

/** Locate the BEL or ST terminator from `from`. */
function findOscEnd(buf: number[], from: number): { termStart: number; next: number } | -1 {
  for (let i = from; i < buf.length; i++) {
    if (buf[i] === BEL) return { termStart: i, next: i + 1 };
    if (buf[i] === ESC) {
      if (i + 1 >= buf.length) return -1; // split ST, wait for more
      if (buf[i + 1] === 0x5c /* \ */) return { termStart: i, next: i + 2 };
      // Lone ESC inside OSC: malformed, skip the sequence start.
      return { termStart: i, next: i + 1 };
    }
  }
  return -1;
}

function parseOscBody(
  body: string,
  notifChunks?: Map<string, PendingNotify>,
): OscEvent | null {
  const semi = body.indexOf(";");
  if (semi < 0) return null;
  const ps = body.slice(0, semi);
  const pt = body.slice(semi + 1);
  if (ps === "7") {
    // file://host/path — strip scheme+host, keep the path.
    const m = /^file:\/\/[^/]*(\/.*)?$/.exec(pt);
    if (!m) return null;
    let path = m[1] ?? "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    return { type: "cwd", path };
  }
  if (ps === "0" || ps === "2") {
    return { type: "title", title: pt };
  }
  if (ps === "9") {
    // OSC 9 ; message BEL. ConEmu overloads OSC 9 with numeric subcommands
    // (9;4 progress, 9;9 cwd); a leading all-digit field is not a message.
    const first = pt.split(";", 1)[0];
    if (first.length > 0 && /^\d+$/.test(first)) return null;
    const body = pt.trim();
    if (!body) return null;
    return { type: "notify", title: null, body, source: "osc9" };
  }
  if (ps === "777") {
    // OSC 777 ; notify ; title ; body BEL. Only the notify subtype is a
    // notification; other subtypes (e.g. container metadata) are ignored.
    const parts = pt.split(";");
    if (parts[0] !== "notify") return null;
    const title = (parts[1] ?? "").trim();
    const body = parts.slice(2).join(";").trim();
    if (!body && !title) return null;
    return { type: "notify", title: title || null, body, source: "osc777" };
  }
  if (ps === "99") {
    return parseOsc99(pt, notifChunks);
  }
  if (ps === "133") {
    // Semantic prompt markers (FinalTerm / OSC 133):
    //   A = prompt start, B = command start, C = command executed,
    //   D[;exit] = command finished. Only C/D drive the command bar.
    const kind = pt[0]?.toUpperCase();
    if (kind === "C") {
      // fish (and others) may append the command line, e.g.
      // `133;C;cmdline_url=echo%20hi`. Prefer it over keystroke capture.
      const params = pt.slice(1).replace(/^;/, "");
      const m = /(?:^|;)cmdline_url=([^;]*)/.exec(params);
      if (m) {
        let cmd = m[1];
        try {
          cmd = decodeURIComponent(cmd);
        } catch {
          /* keep raw */
        }
        return { type: "cmd-start", cmd };
      }
      return { type: "cmd-start" };
    }
    if (kind === "D") {
      const code = pt.slice(1).replace(/^;/, "").split(";")[0];
      const n = parseInt(code, 10);
      return { type: "cmd-end", exit: Number.isNaN(n) ? null : n };
    }
  }
  return null;
}

/**
 * OSC 99 (kitty) notification: `metadata ; payload`, where metadata is
 * colon-separated `key=value` pairs. Title/body fragments with the same
 * id accumulate until a fragment without `d=0` (done) arrives.
 */
function parseOsc99(
  pt: string,
  chunks?: Map<string, PendingNotify>,
): NotifyEvent | null {
  if (!chunks) return null;
  const semi = pt.indexOf(";");
  if (semi < 0) return null;
  const meta = parseNotifyMeta(pt.slice(0, semi));
  const payload = pt.slice(semi + 1);

  const kind = meta.p ?? "title";
  if (kind !== "title" && kind !== "body") return null; // close/icon/query...
  const text = decodeNotifyPayload(payload, meta.e === "1");
  if (text === null) return null;

  const id = meta.i ?? "";
  const cur = chunks.get(id) ?? { title: "", body: "" };
  if (kind === "title") cur.title += text;
  else cur.body += text;
  if (meta.u !== undefined) {
    const u = parseInt(meta.u, 10);
    if (!Number.isNaN(u)) cur.urgency = u;
  }

  if (cur.title.length + cur.body.length > MAX_NOTIFY_CHARS) {
    chunks.delete(id);
    return null;
  }

  // `d` defaults to 1 (complete); only an explicit 0 defers.
  if ((meta.d ?? "1") === "0") {
    chunks.set(id, cur);
    return null;
  }
  chunks.delete(id);
  if (!cur.title && !cur.body) return null;

  const ev: NotifyEvent = {
    type: "notify",
    title: cur.title || null,
    body: cur.body,
    source: "osc99",
  };
  if (cur.urgency !== undefined) ev.urgency = cur.urgency;
  return ev;
}

/** Parse `k=v:k=v` notification metadata; first `=` splits, empty keys skipped. */
function parseNotifyMeta(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(":")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/** Decode an OSC 99 payload; base64 when `e=1`, else plain UTF-8 text. */
function decodeNotifyPayload(payload: string, base64: boolean): string | null {
  if (!base64) return payload;
  try {
    const bin = atob(payload);
    return utf8.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
