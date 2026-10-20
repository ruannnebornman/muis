// muis-tui-plugin v1
// muis opencode TUI plugin: watch the TUI route and report the session that
// is actually on screen. Server plugins never see user-driven navigation
// (opencode only publishes `tui.session.select` for inbound API calls), so
// this is the only way to follow `/new` and `/resume` exactly.
//
// Installed by muis at ~/.config/opencode/plugins/muis-tui.mjs and listed
// in the global ~/.config/opencode/tui.json. It calls `muis-agent` (or
// `MUIS_BIN --muis-agent` on the Windows single-exe build); the tab id comes
// from MUIS_TAB_ID, injected into every pty by muis. No-op outside muis.
import { spawn } from "node:child_process"

const SESSION_RE = /^ses_[A-Za-z0-9]+$/
const POLL_MS = 250

/** Resolve the agent CLI for this process (Windows single-exe vs sidecar). */
export function agentInvocation(env = process.env) {
  if (env.MUIS_AGENT_BIN) return { command: env.MUIS_AGENT_BIN, args: [] }
  const bin = env.MUIS_BIN
  return { command: bin || "muis-agent", args: bin ? ["--muis-agent"] : [] }
}

/** Fire one request and never block the TUI. */
export function sendAgent(args, env = process.env) {
  const { command, args: prefix } = agentInvocation(env)
  try {
    const child = spawn(command, [...prefix, ...args], {
      stdio: "ignore",
      windowsHide: true,
    })
    child.on("error", () => {})
    child.unref()
  } catch {
    // muis not running, or the helper is missing — nothing to do.
  }
}

/**
 * Track route changes. `report(id)` runs when a valid session becomes
 * current; `clear()` runs only after a session was seen and the TUI moves
 * away from it. The initial route is never cleared, so a restored tab keeps
 * its saved id while opencode boots into it.
 */
export function createRouteTracker(report, clear) {
  let last
  return (route) => {
    const raw = route?.name === "session" ? route.params?.sessionID : undefined
    const id = typeof raw === "string" && SESSION_RE.test(raw) ? raw : null
    if (id === last) return
    if (id) report(id)
    else if (last !== undefined) clear()
    last = id
  }
}

export const MuisTuiPlugin = async (api) => {
  const env = process.env
  const track = createRouteTracker(
    (id) => sendAgent(["session", id], env),
    () => sendAgent(["clear"], env),
  )
  const tick = () => {
    try {
      track(api?.route?.current)
    } catch {
      // Route store not ready yet.
    }
  }
  tick()
  const timer = setInterval(tick, POLL_MS)
  api?.lifecycle?.onDispose?.(() => clearInterval(timer))
}

export default {
  id: "muis-tui",
  tui: MuisTuiPlugin,
}
