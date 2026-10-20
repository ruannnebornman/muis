// muis-plugin v4
// muis opencode plugin: notify muis when a turn finishes so the tab gets
// the done badge + toast.
//
// Installed by muis at ~/.config/opencode/plugins/muis.js. Must stay a
// .js/.ts file: opencode only auto-loads those extensions from its plugin
// directory, not .mjs. It calls the `muis-notify` binary, which muis ships
// and routes back to the tab via MUIS_TAB_ID (injected into every pty).
// No-op when muis is not running. The "muis-plugin" marker lets muis
// safely update its own file.
export const MuisPlugin = async ({ $ }) => {
  const notify = (args = []) => $`muis-notify ${args}`;

  // Session id -> { title, directory }, learned from session.created/updated
  // (session.idle itself only carries the id), so the notification can name
  // the project and the session.
  const sessions = new Map();

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
      if (type !== "session.idle") return;
      const id = p.sessionID ?? p.sessionId ?? info?.id ?? p.session?.id;
      // Identify where (project/tab) in the title and what (the session
      // title) in the body, instead of a constant text.
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
    },
  };
};
