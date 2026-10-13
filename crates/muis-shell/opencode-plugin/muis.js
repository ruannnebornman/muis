// muis-plugin v2
// muis opencode plugin: report the active session id to the muis tab so
// the tab can resume that exact session, and notify muis when a turn
// finishes so the tab gets the done badge + toast.
//
// Installed by muis at ~/.config/opencode/plugins/muis.js. Must stay a
// .js/.ts file: opencode only auto-loads those extensions from its plugin
// directory, not .mjs. It calls the `muis-notify` binary, which muis ships
// and routes back to the tab via MUIS_TAB_ID (injected into every pty).
// On the Windows single-file build there is no `muis-notify` on PATH; muis
// sets MUIS_BIN to its own exe, which serves the same CLI via `--muis-notify`.
// No-op when muis is not running. The "muis-plugin" marker lets muis
// safely update its own file.
export const MuisPlugin = async ({ $ }) => {
  const bin = process.env.MUIS_BIN;
  const notify = (args = []) =>
    bin ? $`${bin} --muis-notify ${args}` : $`muis-notify ${args}`;

  let last = "";
  const report = async (id) => {
    if (!id || typeof id !== "string" || !id.startsWith("ses_") || id === last) return;
    last = id;
    try {
      await notify(["--agent-session", id]);
    } catch {
      // muis not running, or notify unavailable — nothing to do
    }
  };
  return {
    event: async ({ event }) => {
      const type = event?.type;
      if (typeof type !== "string" || !type.startsWith("session.")) return;
      const p = event.properties ?? {};
      await report(p.sessionID ?? p.sessionId ?? p.info?.id ?? p.session?.id);
      if (type === "session.idle") {
        try {
          await notify(["--title", "opencode", "--body", "turn finished"]);
        } catch {
          // muis not running
        }
      }
    },
  };
};
