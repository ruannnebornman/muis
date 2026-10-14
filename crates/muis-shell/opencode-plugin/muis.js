// muis-plugin v3
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
  // Session id -> { title, directory }, learned from session.created/updated
  // (session.idle itself only carries the id).
  const sessions = new Map();

  const report = async (id) => {
    if (!id || typeof id !== "string" || !id.startsWith("ses_") || id === last) return;
    last = id;
    try {
      // Report the session's directory too, so muis can reject an id that
      // leaked in from another project before latching it to this tab.
      const dir = sessions.get(id)?.directory;
      const args = ["--agent-session", id];
      if (dir) args.push("--agent-session-dir", dir);
      await notify(args);
    } catch {
      // muis not running, or notify unavailable — nothing to do
    }
  };

  return {
    event: async ({ event }) => {
      const type = event?.type;
      if (typeof type !== "string" || !type.startsWith("session.")) return;
      const p = event.properties ?? {};
      const info = p.info;
      if (info && typeof info.id === "string") {
        sessions.set(info.id, {
          title: typeof info.title === "string" ? info.title : "",
          directory: typeof info.directory === "string" ? info.directory : "",
        });
      }
      const id = p.sessionID ?? p.sessionId ?? info?.id ?? p.session?.id;
      await report(id);
      if (type === "session.idle") {
        // Identify where (project/tab) in the title and what (the session
        // title) in the body, instead of the old constant text.
        const s = (id && sessions.get(id)) || {};
        const dir = typeof s.directory === "string" ? s.directory : "";
        const project = dir ? dir.replace(/\/+$/, "").split("/").pop() : "";
        const title = project || "opencode";
        const summary = typeof s.title === "string" ? s.title.trim() : "";
        const body = summary ? `${summary} has finished` : "opencode has finished";
        try {
          await notify(["--title", title, "--body", body]);
        } catch {
          // muis not running
        }
      }
    },
  };
};
