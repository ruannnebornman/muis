# Snor: local AI plan

Status: **proposed / research**. Planning document, not a commitment.
Checked against `main` at `60515eb` (2026-10-19).

Snor is muis's own local AI: a user-supplied GGUF model loaded by
llama.cpp and surfaced in the reserved right side panel. This document
covers the architecture, a phased build, and the decisions still open.

## What exists today

- `docs/deferred.md` parks the **Snor engine**: the side-panel slot is
  ready, the engine is not.
- The slot exists: `SidePanelRegistry` (`src-ui/src/panels.ts`) with the
  docked right-side host in `src-ui/src/main.ts` (panel slot at
  `main.ts:1055`, `panelContent`/`renderPanelSlot` at `main.ts:2304`).
  Nothing is registered yet.
- `docs/agent-integration.md` Phase 5 decided that a future Snor would
  run as a **side-panel ACP engine** behind the same pane surface as
  external agents.
- The ACP pane for external agents (opencode) is implemented separately;
  it is not local inference.
- There is **no** existing plan for llama.cpp, GGUF loading, model
  download, GPU offload, or local inference anywhere in the docs.

So Snor is a new workstream. It should refine the deferred Snor line, not
replace the external-agent work.

## Goal

A local assistant that can answer questions about the current terminal
session without sending anything off the machine:

- explain an error or a block of output;
- summarize what just happened;
- suggest a command or a fix;
- answer follow-up questions in a persistent conversation.

It should work offline once the model is on disk, and it must not weaken
the terminal's process model.

## Non-goals (for v1)

- Replacing external agents or the ACP pane.
- Running a shell command or editing files automatically.
- Shipping model weights with muis.
- Making the model part of `muis-worker` or the UI process.
- Supporting every GPU/runtime combination on day one.

## Architecture

```
Tauri UI (src-ui)
  Snor side panel (SidePanelRegistry)
      | Tauri commands/events only; no direct network from the UI
muis-shell
  SnorEngine: supervises one llama-server child
      | HTTP 127.0.0.1:<random>, OpenAI-compatible, streaming
  llama-server (llama.cpp from Arch extra)
      | user-selected GGUF
muis-worker: unchanged, still owns every PTY
```

Rules:

- **One LLM process per app, not per session.** Model load is expensive;
  share it. Conversations are per workspace, but inference is shared.
- **The UI never talks to llama.cpp directly.** `src-ui/src/panels.ts`
  already states that panels use the same IPC patterns as terminals and
  never touch the network from the UI process. Keep that contract.
- **Do not put the model in `muis-shell`'s UI path or in `muis-worker`.**
  If llama.cpp is embedded later, it goes in a dedicated
  `crates/muis-llm` sidecar. One crash must not take the terminal down.
- **The one-worker-per-session rule is unchanged.** The LLM is a separate
  process class, not a PTY owner.

## Backend strategy

Start with **`llama-server` from Arch `extra` as a supervised child
process**, not an embedded library.

Why:

- crash isolation from the UI;
- no C++/CUDA/Vulkan build burden in muis itself;
- streaming, cancellation, context handling, and an OpenAI-compatible
  HTTP API come for free;
- Arch keeps the package updated and GPU-enabled;
- packaging stays a runtime dependency instead of a new build matrix.

Put it behind a small backend abstraction so an embedded implementation
can replace it later without changing the panel or the request protocol.
Long-term embedding is more portable (Windows, Flatpak, single artifact),
but it is the harder build problem and should not block v1.

## Phases

### Phase 0 - spike

- Install `llama.cpp` from `extra` and run `llama-server` with a small
  GGUF.
- Measure load time, tokens/s, RSS/VRAM on the GTX 1080 Ti, CPU fallback,
  and behaviour when the model does not fit.
- Verify streaming, cancellation, `--api-key`, loopback binding, and one
  shared server handling consecutive requests.
- Pick a realistic model class. 7-8B Q4 is the starting point for 8-11 GB
  of VRAM; tool-capable models only matter if tools are in scope.
- Decide the surface: custom Snor chat vs ACP.

Deliverable: a short spike note appended to this document, plus a
recommendation on the ACP question below.

### Phase 1 - process supervisor

New `crates/muis-shell/src/snor.rs` (or a `snor` module beside the
existing bridge):

- lazy start on first Snor use, not at app launch;
- allocate a free loopback port, then spawn `llama-server` with
  `--host 127.0.0.1`, `--port`, `--api-key`, `--model`, `--ctx-size`,
  `--n-gpu-layers`, and the package-supported flags for the web UI;
- health check before the first prompt;
- reap the child on natural exit, restart on crash, kill on app exit;
- one prompt at a time initially, with a visible queue; later allow
  `--parallel` if the memory budget supports it;
- requests stay stateless: send the conversation history on each turn.
  llama-server slots are an implementation detail, not the source of
  truth.

Commands and events (names are indicative):

- `snor_start`, `snor_stop`, `snor_send`, `snor_cancel`,
  `snor_status`;
- `snor-token`, `snor-done`, `snor-error` events.

The shell streams from llama-server's OpenAI-compatible endpoint; it does
not buffer the whole answer in the UI process.

### Phase 2 - config and model handling

The authoritative settings file is owned by the TypeScript `AppConfig`
(`src-ui/src/config.ts`) and persisted verbatim by `config_load` /
`config_save` in `crates/muis-shell/src/main.rs`. The Rust `AppConfig` in
`crates/muis-core/src/config.rs` is a legacy subset. Add Snor fields to
the TS model; add a Rust struct only for the settings the supervisor
needs at runtime.

Proposed fields (group under one `snor` object, or keep flat `snor*`
keys if the config format stays flat):

- `snor.enabled` (default `false`);
- `snor.modelPath` (user-selected GGUF; empty means unconfigured);
- `snor.serverPath` (optional override; otherwise probe `llama-server`);
- `snor.contextSize`;
- `snor.gpuLayers` (default from a small hardware probe, with CPU
  fallback);
- `snor.temperature`;
- `snor.systemPrompt`;
- `snor.contextLines` and context toggles.

Model and server path validation belongs in the shell, not only the
settings dialog. Use the existing dialog plugin for the file picker.
Model files live wherever the user puts them; a default under
`~/.local/share/muis/models/` is fine but must be configurable. Do not
download models implicitly.

### Phase 3 - side-panel UI

Register a `snor` panel through `SidePanelRegistry` and render it in the
existing slot:

- chat input, streaming output, stop, clear, model/status header;
- a visible "not configured" state with a link to settings;
- context chips showing exactly what is attached to the request;
- a shortcut and a statusbar/server indicator;
- per-workspace conversation persistence, restored on reopen.

Context builder:

- current workspace directory and git branch;
- active tab title and cwd;
- selected text;
- optionally the last N lines of scrollback, with an explicit toggle.

Send a token-budgeted subset, never the whole buffer silently. Show what
was included so the user can remove it. Terminal output routinely
contains secrets.

### Phase 4 - packaging

- Arch: `llama.cpp` as an `optdepends` (or `depends` if it becomes a
  hard requirement), with a note on package flavours (CPU/CUDA/Vulkan).
- Flatpak: bundle `llama-server` and its shared libraries, or use a
  runtime extension. Do not assume the host binary is reachable.
- Windows: bundle `llama-server.exe` plus DLLs, or defer until the
  embedded backend exists. The portable zip stays the primary artifact.
- CI: fake backend for unit tests; no model downloads in normal CI; an
  optional manual tiny-GGUF smoke job.

### Phase 5 - actions (only if wanted)

v1 is read-only. Then, in order:

1. "insert this command into the prompt" with an explicit user action;
2. approval-gated tools (read file, run command, edit);
3. only then a real ACP adapter or a second tool/permission UI.

If Snor must act on files or commands, prefer implementing ACP and
reusing the existing ACP pane over building a parallel tool surface.

## ACP fork

`docs/agent-integration.md` already decided that Snor would be a
side-panel ACP engine. That is the right surface **if Snor is an agent**.
For a read-only chat assistant it adds session/tool/permission semantics
that are not needed.

Recommendation:

- **v1:** custom side-panel chat with a small streaming API.
- **If Snor must act:** implement ACP and reuse the existing pane.

Revise the Phase 5 decision if v1 is chat-only; keep it if the goal is a
local coding agent.

## Questions and concerns

1. **Product scope.** Is Snor a chat assistant ("explain this error",
   "summarize this output"), or a real agent that can read files, edit,
   and run commands? This decides custom chat vs ACP and changes the
   effort from days to weeks.
2. **ACP conflict.** `docs/agent-integration.md` says Snor is a
   side-panel ACP engine. Custom chat revises that decision. Is that
   acceptable, or should ACP stay the target surface?
3. **Embedded vs external.** "From extra" is Arch-only and keeps GPU
   builds out of muis. Embedding gives portability but brings
   C++/CUDA/Vulkan build and packaging complexity. Is the first target
   Arch only, with Windows/Flatpak later?
4. **Model distribution.** User-supplied GGUF, or a muis downloader and
   catalog? If a catalog: which models, quants, checksums, licenses,
   default for 8-11 GB VRAM, and what happens on CPU-only machines?
5. **Licensing.** llama.cpp is fine to ship, but model weights have
   varying licenses. Never bundle weights without explicit permission.
   Flatpak and Windows still need a concrete story for the server and its
   shared libraries.
6. **Memory and lifecycle.** A loaded model can be several GB; opencode
   already costs roughly 400 MB. When does it load and unload? Lazy on
   first open? Idle timeout? One shared model across all workspaces?
7. **Concurrency.** What happens when two tabs prompt at once? Serialize,
   queue with visible state, or use `llama-server --parallel` with more
   memory? Cancellation must actually stop generation.
8. **Context and privacy.** How much scrollback goes into a prompt? Is it
   opt-in per request, per workspace, or global? Terminal output routinely
   contains secrets and tokens. Needs a visible "what was sent" view and
   redaction rules.
9. **Prompt injection.** Terminal output and file contents are untrusted.
   If Snor gets tools, a malicious README or log line must not trigger
   commands. Tool use needs approval and a narrow capability model.
10. **Local server security.** Bind loopback only, use a random port and
    a per-launch API key, disable the web UI when supported, and kill the
    child on app exit. Other local processes can still reach a loopback
    port.
11. **Quality expectations.** Small local models are weak at coding and
    tool use. Decide the minimum acceptable model/quant and set
    expectations in the UI, or the feature will feel broken next to
    opencode.
12. **Testing.** No GPU or large model in CI. Tests need a fake backend
    and, if needed, a tiny GGUF fixture. Keep inference tests opt-in.
13. **Docs ownership.** This plan should become the canonical Snor
    document. The deferred entry and the Phase 5 ACP decision should link
    here once the open decisions are resolved.
