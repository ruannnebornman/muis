// muis-plugin v5
// muis opencode server plugin: notify muis when a turn finishes so the tab
// gets the done badge + toast, and report the exact session id as a fallback
// when the TUI plugin is unavailable.
//
// Installed by muis at ~/.config/opencode/plugins/muis.js. Must stay a
// .js/.ts file: opencode only auto-loads those extensions from its plugin
// directory, not .mjs. It calls the `muis-notify` and `muis-agent` binaries,
// which muis ships and routes back to the tab via MUIS_TAB_ID (injected into
// every pty). No-op when muis is not running. The "muis-plugin" marker lets
// muis safely update its own file.
export const MuisPlugin = async ({ $ }) => {
  const agentBin = process.env.MUIS_AGENT_BIN;
  const notify = (args = []) => $`muis-notify ${args}`;
  const reportAgent = (args = []) =>
    agentBin ? $`${agentBin} ${args}` : $`muis-agent ${args}`;

  // Session id -> { title, directory, parentID }, learned from
  // session.created/updated (session.idle itself only carries the id), so
  // the notification can name the project and the session.
  const sessions = new Map();
  let lastSession = "";

  // Server-side navigation is invisible to plugins, so this only catches
  // messages and turns. The TUI plugin is the exact source for /resume.
  const report = async (id) => {
    if (!id || typeof id !== "string" || !id.startsWith("ses_") || id === lastSession) return;
    const info = sessions.get(id);
    if (info?.parentID) return; // subagent session, not the tab's chat
    lastSession = id;
    const args = ["session", id];
    if (info?.directory) args.push("--dir", info.directory);
    try {
      await reportAgent(args);
    } catch {
      // muis not running, or the helper is unavailable
    }
  };

  return {
    "chat.message": async (input) => {
      await report(input?.sessionID);
    },
    event: async ({ event }) => {
      const type = event?.type;
      if (typeof type !== "string" || !type.startsWith("session.")) return;
      const p = event.properties ?? {};
      const info = p.info;
      if (info && typeof info.id === "string") {
        sessions.set(info.id, {
          title: typeof info.title === "string" ? info.title : "",
          directory: typeof info.directory === "string" ? info.directory : "",
          parentID: typeof info.parentID === "string" ? info.parentID : "",
        });
      }
      const id = p.sessionID ?? p.sessionId ?? info?.id ?? p.session?.id;

      if (type === "session.created" && info && !info.parentID) {
        await report(info.id);
      }

      if (type !== "session.idle") return;
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
