# Agent integration (design)

Design for running CLI coding agents (opencode, Claude Code, Codex, …)
inside muis with exact per-tab sessions, completion notifications, and a
native structured agent surface.

Status: **draft / design only**. No implementation yet. Decisions are
recorded at the end; open questions are listed separately.

## Goals

- **Exact per-tab resume.** Restarting muis restores each agent tab to the
  same agent session it was on, not "the last session in this folder".
- **Completion/attention notifications** from agents, per tab.
- **A native agent surface (ACP)** for people who want a structured UI.
- **Keep muis a terminal.** Shell tabs stay universal; nothing about
  running arbitrary programs changes.

## Non-goals

- Replacing an agent's own TUI for users who prefer it. Agents can always
  run the classic way in a shell tab.
- Supporting every agent's quirks; target opencode, Claude Code, Codex
  first.
- Making ACP the only way to run an agent.

## Concepts

- **Terminal tab** — a pty + raw ANSI byte stream (xterm.js). Universal,
  agent-agnostic. This is what `+` opens (fish).
- **AI tab / ACP pane** — a structured agent surface. muis spawns an agent
  in ACP mode and renders its protocol, not a pty. This is what the `AI`
  button opens.
- **Agent session id** — the agent's own id used to resume (`opencode
  --session`, `claude --resume`, `codex resume`).

## Background: why there is no single mechanism

Research summary (2026-10):

- **OSC notifications (OSC 9 / 777 / 99)** are the one agent-agnostic
  *terminal* standard, but they carry no session id — notifications only.
  muis already parses them.
- **ACP (Agent Client Protocol)** is the one true standard that includes
  sessions, but it assumes the **editor hosts the agent**: the agent runs
  as a JSON-RPC subprocess and the client renders the conversation. A
  terminal cannot make an agent's TUI speak ACP; using ACP means muis
  becomes an ACP *client*.
- Every terminal/IDE that does this ships **per-agent adapters**: Warp
  installs a Claude/Codex/opencode plugin and auto-detects agents; Mux0
  hooks each agent for status; VS Code ships per-agent extensions.
- Notifier tools (agent-notify, codex-cli-notify) all patch per-agent
  config — Claude `settings.json` hooks, Codex `config.toml` notify,
  Gemini `settings.json` hooks.

Conclusion: keep **one contract on muis's side** and **thin per-agent
adapters**, and additionally accept OSC notifications from any agent that
emits them.

## Part 1 — Session identity for terminal-tab agents

### Contract

One helper, `muis-agent`, used by every adapter:

```
muis-agent --source <opencode|claude|codex> [--done] [payload-json|-]
```

- Reads the agent's payload (stdin JSON or argv) and extracts the session
  id generically: `session_id`, `sessionId`, `thread-id`, `threadId`,
  `resume_id`, …
- Sends it over the existing muis socket, routed to the originating tab by
  the `MUIS_TAB_ID` muis already injects (`muis-core::notify`).
- New notify fields: `agent_session: Option<String>` and
  `agent_done: bool`. A notify carrying `agent_session` updates the tab's
  session id; a notify with `agent_done` raises the done badge/toast.

### muis side

- `Tab.agentSession?: string`, persisted with sessions, restored on start.
- Resume template per agent, with a `{session}` placeholder:
  - opencode: `opencode --session {session}`
  - Claude Code: `claude --resume {session}`
  - Codex: `codex resume {session}`
- On restore, an agent tab with a stored id runs its resume template; a
  tab with no id falls back to the plain command (current behaviour).
- The existing `agentCommand` / `agentResumeCommand` config stays as the
  user-editable base; the template generalises it.

### Adapters

| Agent | Adapter | Events | Notes |
|---|---|---|---|
| opencode | plugin (`~/.config/opencode/plugins/muis.mjs`) | `session.created`, `session.updated`, `session.idle` | plugin has the session id and `$`; auto-loads |
| Claude Code | hook in `~/.claude/settings.json` | `SessionStart`, `Stop`, `Notification` | hook stdin JSON has `session_id`; no trust step |
| Codex | `notify` in `~/.codex/config.toml` | `agent-turn-complete` | trust-free (not a hook); payload has `thread-id` + `cwd`; fires only on turn completion |

Codex alternatives if `thread-id` is not the resumable id:

- `--dangerously-bypass-hook-trust` (opt-in setting) to use real
  `SessionStart`/`Stop` hooks — a blanket bypass, version-dependent.
- Managed hooks via `requirements.toml` — trusted by policy, needs
  admin/root.

Installers for these adapters must **merge** into existing config
(idempotent, back up first, never clobber) and be removable.

### Also fixes

- The opencode finish-notification gap (`docs/features.md` Known issues),
  via `session.idle` → `agent_done`.

## Part 2 — ACP panes (native agent surface)

- `AI` opens an ACP pane: muis spawns the agent in ACP mode
  (`opencode acp`, plus Claude/Codex adapters) and renders the protocol.
- Rendering scope (approx): streaming assistant text, reasoning, tool-call
  cards, permission prompts, diffs, plans/steps, session list + resume,
  input editor, attachments, cancel.
- Session management comes from ACP: uniform session ids, list, load,
  resume, and (where supported) fork.
- Launch config: agent command + args + cwd; per-agent ACP entrypoint.
- Known parity gaps: ACP adapters can lag the CLI; opencode's docs note
  some slash commands (`/undo`, `/redo`) are unsupported over ACP. The
  terminal route remains available for anything missing.

ACP pane is a **second product surface** (not xterm) and is scoped as its
own effort. Start with opencode (native ACP), then Claude and Codex via
adapters.

## Part 3 — Detect-and-offer (typing an agent in a shell)

When a user types `opencode`, `claude`, or `codex` in a `+` shell tab:

- Detect **before exec** via a shell preexec hook (fish `fish_preexec`,
  zsh `preexec`, bash `DEBUG` trap), which muis can install with its shell
  integration. (Detecting after launch would mean killing a running
  process; preexec avoids that.)
- Match conservatively: bare argv[0] in a known-agent allowlist, no
  pipelines/redirection, skip non-interactive shells, ignore
  aliases/functions unless resolved.
- Show a **chip**: "opencode detected — Open in AI panel?" One click opens
  an ACP pane with cwd + env carried over; otherwise the command runs in
  the terminal as normal.
- Setting: **auto-open** (off by default), per-agent allowlist, and an
  escape hatch (e.g. `MUIS_TERMINAL_AGENT=1`) to force terminal mode.
- Always keep a "reopen as terminal" action.

Pitfalls this avoids: false positives (words in strings, `which`,
heredocs), lost shell state (venv/exports/functions), and user surprise
(some people want the TUI, or the agent lacks ACP parity).

## Decision log

- `+` opens a fish shell tab; `AI` opens an ACP pane.
- Typing a known agent in a shell → **detect and offer** (not silent
  auto-convert).
- Terminal-tab agent resume → **one `muis-agent` contract + thin
  per-agent adapters** (opencode plugin, Claude hook, Codex `notify`).
- Fold completion notifications into the same wiring.
- ACP pane: build **opencode first**; Claude/Codex adapters later.
- ACP is a separate surface; terminal panes keep the hook-based path.

## Open questions

- Codex: confirm `thread-id` from the `notify` payload matches the id
  `codex resume` accepts (Codex is not installed on the dev machine used
  for this doc).
- Which ACP adapters to support for Claude and Codex, and how to keep them
  current.
- Do ACP panes also appear as sessions in the sidebar, or only as tabs?
- Multi-agent panes vs one agent per session.
- How much of Part 1 ships before Part 2 (Part 1 is independently useful).
- Config-file merge strategy and uninstall for the adapters.

## References

- Agent Client Protocol — <https://agentclientprotocol.com>
- opencode ACP — `opencode acp`; Zed agents page
- Claude Code hooks — session_id on hook stdin (`SessionStart`, `Stop`,
  `Notification`)
- Codex hooks / `notify` — `session_id` in hook payloads; trust model
  (`/hooks`, `--dangerously-bypass-hook-trust`, managed `requirements.toml`)
- Warp / Mux0 / cmux — per-agent adapter + auto-detect patterns
