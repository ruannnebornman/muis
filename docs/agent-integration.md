# Agent integration (design)

Design for running CLI coding agents (opencode, Claude Code, Codex, …)
inside muis with a native structured agent surface, exact sessions where
possible, and completion notifications.

Status: **draft / design only**. ACP-first; terminal-tab session capture is
parked to Phase 4.

## Goals

- **Exact per-tab resume** of agent sessions (ACP panes first).
- **Completion/attention notifications** from agents, per tab.
- **A native agent surface (ACP)** — the near-term priority.
- **Keep muis a terminal.** Shell tabs stay universal and untouched.

## Non-goals

- Replacing an agent's own TUI for users who prefer it. Agents can always
  run the classic way in a shell tab, unchanged.
- Supporting every agent's quirks; target opencode, Claude Code, Codex.
- Making ACP the only way to run an agent.

## Concepts

- **Terminal tab** — a pty + raw ANSI byte stream (xterm.js). Universal,
  agent-agnostic. This is what `+` opens (fish).
- **AI tab / ACP pane** — a structured agent surface. muis spawns an agent
  in ACP mode and renders its protocol, not a pty. This is what `AI` opens.
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

## Phasing

1. **ACP pane for opencode** (native `opencode acp`), opened by `AI`.
2. **Detect-and-offer**: typing a known agent in a shell tab offers to open
   it as an ACP pane (no silent conversion).
3. **More ACP agents**: Claude Code and Codex via their ACP adapters.
4. **Parked — terminal-tab session capture** (former Part 1): per-agent
   hooks/plugins/notify to recover session ids for agents run the classic
   way, plus completion notifications for them.

Rationale for parking 4: users who deliberately run the terminal TUI tend
to want the agent's own UI and workflow, and often prefer muis not to
touch how their sessions resume. ACP panes get session management from the
protocol, so terminal-tab capture is only needed for the classic path —
useful, but not on the critical path to seeing ACP work.

**Design principle:** muis never alters a user-typed command. Any
terminal-tab session resume must be opt-in; by default a manually launched
agent is left exactly as the user ran it.

## Phase 1 — ACP pane (opencode)

- `AI` opens an ACP pane: muis spawns `opencode acp` and renders the
  protocol over JSON-RPC (stdio).
- Rendering scope (approx): streaming assistant text, reasoning, tool-call
  cards, permission prompts, diffs, plans/steps, session list + resume,
  input editor, attachments, cancel.
- Session management comes from ACP: uniform session ids, list, load,
  resume, fork where supported.
- Launch config: agent command + args + cwd; per-agent ACP entrypoint.
- Known parity gaps: ACP adapters can lag the CLI; opencode's docs note
  some slash commands (`/undo`, `/redo`) are unsupported over ACP. The
  terminal route stays available for anything missing.

## Phase 2 — Detect-and-offer

When a user types `opencode`, `claude`, or `codex` in a `+` shell tab:

- Detect **before exec** via a shell preexec hook (fish `fish_preexec`,
  zsh `preexec`, bash `DEBUG` trap), installed with muis's shell
  integration. (Detecting after launch would mean killing a running
  process; preexec avoids that.)
- Match conservatively: bare argv[0] in a known-agent allowlist, no
  pipelines/redirection, skip non-interactive shells, don't chase
  aliases/functions.
- Show a **chip**: "opencode detected — Open in AI panel?" One click opens
  an ACP pane with cwd + env carried over; otherwise the command runs in
  the terminal as normal.
- Setting: **auto-open** (off by default), per-agent allowlist, and an
  escape hatch (e.g. `MUIS_TERMINAL_AGENT=1`) to force terminal mode.
- Always keep a "reopen as terminal" action.

Pitfalls this avoids: false positives (words in strings, `which`,
heredocs), lost shell state (venv/exports/functions), and user surprise.

## Phase 3 — More ACP agents

- Claude Code and Codex via their ACP adapters (`claude-code-acp`, Zed's
  Codex adapter, or equivalents).
- Per-agent ACP launch config and any adapter capability flags.
- Keep the adapter set current as they evolve.

## Phase 4 (parked) — terminal-tab session identity

For agents run the classic way in a shell tab, recover the session id and
(only if opted in) resume it. One contract, thin per-agent adapters:

```
muis-agent --source <opencode|claude|codex> [--done] [payload-json|-]
```

- Extracts the session id generically (`session_id`, `sessionId`,
  `thread-id`, …) and sends it over the existing muis socket, routed by
  the `MUIS_TAB_ID` muis already injects.
- New notify fields `agent_session` and `agent_done`; `Tab.agentSession`
  persisted; per-agent resume templates (`{session}` placeholder).
- Adapters: opencode plugin, Claude hook (`settings.json`), Codex `notify`
  (`config.toml`, trust-free). Merge idempotently; back up; removable.
- Codex fallbacks if `thread-id` isn't the resumable id:
  `--dangerously-bypass-hook-trust` (opt-in) or managed `requirements.toml`.
- This also closes the opencode finish-notification gap — for terminal
  tabs. ACP panes get completion awareness from the protocol regardless.

## Decision log

- `+` opens a fish shell tab; `AI` opens an ACP pane.
- **ACP-first**: Phase 1 is the opencode ACP pane.
- Typing a known agent in a shell → **detect and offer** (not silent
  auto-convert).
- **Terminal-tab session capture parked to Phase 4**; users who choose the
  TUI keep it unmodified by default.
- Never alter a user-typed command; any terminal resume is opt-in.
- ACP is a separate surface; terminal panes are unaffected.

## Open questions

- **Interim terminal AI-tab resume.** The current AI tab restores with
  `agentResumeCommand` (`opencode --continue`, see `docs/features.md` and
  PR #47). Since ACP will own real sessions and terminal users may not want
  resume touched, should the terminal AI tab stop auto-resuming, or make it
  opt-in?
- Codex (Phase 4): confirm the `notify` payload's `thread-id` matches the
  id `codex resume` accepts.
- Do ACP panes appear in the sidebar as sessions, or only as tabs?
- One agent per session, or multiple agent panes per session?
- Claude/Codex ACP adapters: which to standardise on, and update policy.
- Config-file merge strategy and uninstall for any future adapters.

## References

- Agent Client Protocol — <https://agentclientprotocol.com>
- opencode ACP — `opencode acp`; Zed agents page
- Claude Code hooks — `session_id` on hook stdin (`SessionStart`, `Stop`,
  `Notification`)
- Codex hooks / `notify` — `session_id` in hook payloads; trust model
  (`/hooks`, `--dangerously-bypass-hook-trust`, managed `requirements.toml`)
- Warp / Mux0 / cmux — per-agent adapter + auto-detect patterns
