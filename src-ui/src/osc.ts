/**
 * Minimal OSC sequence observer. Watches pty output for:
 *   OSC 7 ; file://host/path BEL  -> current working directory
 *   OSC 0/2 ; title BEL|ST         -> window/tab title
 * Everything else passes through untouched (xterm still gets the full
 * byte stream). Sequences split across output chunks are reassembled.
 *
 * Fish on Veldmuis already emits both, so this works with zero shell
 * config. Other shells need an OSC 7 prompt hook (see README).
 */

export type OscEvent = { type: "cwd"; path: string } | { type: "title"; title: string };

const ESC = 0x1b;
const BEL = 0x07;

export class OscParser {
  private pending: number[] = [];

  /** Feed raw pty bytes; returns any completed OSC 7/0/2 events. */
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
        const body = String.fromCharCode(...buf.slice(i + 2, end.termStart));
        const ev = parseOscBody(body);
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

function parseOscBody(body: string): OscEvent | null {
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
  return null;
}
