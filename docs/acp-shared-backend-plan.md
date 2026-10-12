# ACP shared backend (one opencode process, many sessions)

Plan for running **one** `opencode acp` process that hosts **all** AI-tab
sessions, instead of one agent process per tab. This is the memory/scale
fix for the ACP pane (`docs/agent-integration.md`, Phase 1).

Status: **proposed; spike-verified 2026-10-12; not implemented.**
Companion to `docs/agent-integration.md` (Phase 6).

## Problem

The ACP pane spawns **one `opencode acp` child per AI tab** (`AgentPool`,
one process per tab in `crates/muis-shell/src/agent.rs`). The shell already
starts **every agent tab across all sessions on launch** (staggered, but all
of them), so memory scales with tab count, not with work:

- Each `opencode acp` process carries a **~380-400 MB base** runtime before
  any conversation.
- 4 agent tabs ≈ 4 × 400 MB base ≈ **~1.6 GB** just for the runtime.
- Most of that base is duplicated per tab (runtime, tools, provider
  clients, LSP), even when sessions are idle.

## Goal

One opencode ACP process, **N sessions** on it — same protocol, same
functionality, **base cost paid once**.

- **Non-goal:** replacing opencode, or dropping ACP. muis stays the ACP
  *client*; opencode stays the agent/server. This keeps all tooling,
  providers, context handling, and permissions.
- **Non-goal:** changing terminal tabs. Shell tabs are untouched.

## Spike findings (verified 2026-10-12, opencode 1.18.x)

Test method: spawn a single `opencode acp`, speak JSON-RPC over stdio
(`initialize` → `session/new` × N → concurrent `session/prompt`), watch
RSS.

- **Multiple sessions per process: works.** Two `session/new` returned two
  distinct session ids from the same process.
- **Per-session cwd: works.** Sessions created for two different project
  dirs on one process ran independently.
- **Concurrent prompts: works.** Two `session/prompt` requests fired
  without waiting both streamed back correct results and ended with
  `stopReason: end_turn`. No serialization observed.
- **Idle session cost is negligible; the base dominates.** Measured RSS:

  | process state | RSS |
  |---|---|
  | 0 sessions | ~398 MB |
  | 2 sessions (idle) | ~546 MB (transient) |
  | 4 sessions (idle) | ~409 MB |
  | 8 sessions (idle) | ~413 MB |
  | 2 sessions, both prompted | ~684-718 MB |

  So idle tabs add a few MB each; **only active conversation context**
  (tokens/model state) drives memory up — and that cost exists with or
  without multiplexing. Multiplexing removes the **repeated ~400 MB base**
  per tab.

**Conclusion:** one ~400 MB backend can host effectively as many tabs as
wanted; cost tracks *active* sessions, not tab count.

## Target architecture

### Rust (`crates/muis-shell/src/agent.rs`)

- `AgentPool` changes from *process-per-tab* to **one shared process + a
  session registry**:
  - one `Child` (the shared `opencode acp`), lazily spawned
  - `HashMap<tab_id, SessionHandle>` where a handle holds the ACP
    `sessionId`, cwd, and per-session config
- The stdout reader thread no longer routes by process id; every line is
  forwarded with the shared transport id, and the **frontend routes by
  `sessionId`** (already present in `session/update` payloads).
- New/renamed commands:
  - `agent_session_open(cwd) -> sessionId` (wraps `session/new`)
  - `agent_session_close(sessionId)` (ACP `session/close` where supported)
  - `agent_write(line)` / `agent_spawn()` operate on the single transport
  - keep `agent_kill` semantics at the process level for shutdown
- Correctly **reap** the child on natural exit (see "Related bug" below).

### Frontend (`src-ui/src/acp.ts`)

- Split today's one-session `AcpClient` into:
  - a **transport** (write queue + line demux), shared
  - a **session router** keyed by `sessionId`, each holding the per-tab
    state (pending requests, config options, rendering callbacks)
- `AcpClient` keeps its testable shape: handler-driven, transport-injected
  (fake transport in unit tests), so the routing logic is unit-testable
  without Tauri.
- One `AI` tab == one routed session; tabs do not own a process.

### Sessions, config, resume

- `session/new` takes `cwd` per session (verified) → multi-project is fine.
- `model`/mode config options are **per session**
  (`session/set_config_option`); store them on the session handle.
- Resume uses `session/load` with the persisted `acpSessionId`
  (already stored per tab), now against the shared process.
- opencode session storage is on disk, so a restarted shared process can
  `session/load` every known session (verify after implementation).

## Lifecycle

- **Lazy spawn:** start the shared `opencode acp` on the **first** AI pane,
  not at launch.
- **Do not auto-spawn every agent tab at startup.** Spawn a session when
  its tab is first viewed/activated; otherwise leave it inert. This alone
  removes the launch spike.
- **Idle kill:** keep the shared process for the app lifetime while any
  session is open; optionally terminate it after all sessions close, and
  respawn on demand.
- **Failure handling (single point of failure):** if the shared process
  dies, all tabs lose their agent. On `agent-exit`, respawn and
  `session/load` each open tab that had an `acpSessionId`, surfacing a
  "reconnecting" state per pane.

## Related bug found during the spike

`agent.rs` emits `AGENT_EXIT` from the reader thread but never calls
`child.wait()` on natural exit, so an exited agent becomes a zombie until
the pool entry is dropped. Fold the reap into this work (call `wait()` in
the reader/exit path, or from a dedicated reaper).

## Migration

1. Add the shared transport + session router behind the current interface.
2. Move AI tabs to `agent_session_open`; keep `acpSessionId` persistence.
3. Add lazy spawn + idle kill.
4. Add process-death recovery.
5. Remove the process-per-tab path and the per-tab `AgentPool` map.
6. Keep/extend tests: unit tests for the router with a fake transport, and
   an integration test that two sessions on one fake transport route
   independently.

## Task breakdown

- [x] Spike: confirm multi-session, multi-cwd, concurrent prompts, RSS.
- [ ] Approve design (this doc).
- [ ] Rust: shared process + session registry; `agent_session_open`/
      `agent_session_close`; reaper.
- [ ] Frontend: transport + `sessionId` router; keep `AcpClient` testable.
- [ ] Tab ↔ session mapping + persistence via existing `acpSessionId`.
- [ ] Lazy spawn on first view; no launch-time spawn of all agent tabs.
- [ ] Idle kill + respawn; process-death recovery via `session/load`.
- [ ] Tests (Rust + UI) including multi-session routing.
- [ ] Remove the process-per-tab path.
- [ ] Update `docs/agent-integration.md` status once landed.

## Open questions

- Does `opencode acp` expose `session/close`? If not, how to free an idle
  session (drop tab) without killing the shared process.
- Any concurrency cap on simultaneous prompts in one process? (None seen in
  the spike; confirm under load.)
- Should the shared process be per-app or per-project? (Spike says one
  process can serve multiple cwds, so per-app is fine; revisit if a
  long-lived session in one repo affects another.)
- After a shared-process restart, does `session/load` fully restore
  streaming state, or only history?
- Does `--pure` (no external plugins) meaningfully trim the ~400 MB base?

## References

- Agent Client Protocol — <https://agentclientprotocol.com>
- `opencode acp`, `opencode serve`, `opencode attach`, `opencode run
  --attach`
- `docs/agent-integration.md` — ACP plan (Phases 1-5)
- PR #50 — ACP pane (process-per-tab baseline)
