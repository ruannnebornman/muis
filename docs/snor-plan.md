# Snor: local AI plan

Status: **proposed / research**. Planning document, not a commitment.
Checked against `main` at `463b078` (2026-10-24); the Phase 0 spike in
this document ran on that commit.

Snor is muis's own local AI: a user-supplied GGUF model loaded by
llama.cpp and surfaced in the reserved right side panel. This document
covers the architecture, a phased build, and the decisions still open.

## What exists today

- `docs/deferred.md` parks the **Snor engine**: the side-panel slot is
  ready, the engine is not.
- The slot exists: `SidePanelRegistry` (`src-ui/src/panels.ts`) with the
  docked right-side host in `src-ui/src/main.ts` (`panelSlot` at
  `main.ts:409`, `panelContent`/`renderPanelSlot` at `main.ts:1496-1517`).
  Nothing is registered yet. The slot is still appended to the column
  container; it must move into the `.main` row before it can dock on the
  right.
- An earlier agent-integration plan (since removed from the tree) decided
  that a future Snor would run as a **side-panel ACP engine**. The ACP
  pane itself was also removed; muis now integrates external agents only
  through their terminal TUIs and the notification/restore hooks.
- There is **no** existing plan for llama.cpp, GGUF loading, model
  download, GPU offload, or local inference anywhere in the docs.

So Snor is a new workstream. It should refine the deferred Snor line, not
replace the terminal-agent work.

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

- Replacing terminal agents (opencode and friends).
- Running a shell command or editing files automatically.
- Giving the model internet access or network tools in v1.
- Shipping the engine, its GPU backend, or model weights with muis.
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
Long-term embedding keeps the install self-contained (single artifact),
but it is the harder build problem and should not block v1.

## Model tiers (v1)

Three presets, all GGUF Q4_K_M and Apache-2.0, with **`low` as the
default**. A tier only supplies defaults; `snor.modelPath` always wins.

| Tier | Model | File | Params | VRAM @ 8k | pp512 | gen | Role |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| low (default) | Qwen2.5-1.5B-Instruct | 1.04 GiB | 1.78B | 1.2 GB | 1018 t/s | 112-124 t/s | fast, CPU fallback |
| medium | Qwen3-4B-Instruct-2507 | 2.32 GiB | 4.02B | 3.6 GB | 476 t/s | 62 t/s | best quality/speed |
| high | Qwen3-8B | 4.68 GiB | 8.19B | 5.7 GB | 221 t/s | 32 t/s | hard errors, opt-in |

Measured on the GTX 1080 Ti with Vulkan; see the spike results for
method. CPU-only is only viable for `low` (about 10 t/s). `medium` is
the quality sweet spot, while `low` is the default because it is small,
fast, and usable without a GPU. Qwen3-8B is a hybrid thinking model:
disable thinking by default and expose a toggle later.

Why these files are larger than whisper's: whisper's `small` model is a
244M-parameter audio encoder/decoder (about 466 MB) built for one narrow
task. A chat model needs world knowledge and instruction following, so
even the 1.78B low tier is about 1 GiB. The Arch `whisper-cpp` package
itself is only 3.42 MiB because it contains binaries and libraries, not
weights.

Suggested tier rules:

- Auto-pick from **free** VRAM on first run: under 4 GB `low`, 4-8 GB
  `medium`, over 8 GB `high`; CPU-only forces `low`.
- Keep `ctx-size` at 8192 for all tiers; a larger context costs KV
  memory and prefill time.
- Store the source URL, file size, and sha256 for each preset so the
  downloader can verify; a custom GGUF skips this path.

## Quality evaluation

Spot check (2026-10-24): all three tiers were asked a recent, obscure
question ("the new Wakfu class") plus basic facts about the game. Every
tier got the basic facts wrong (genre and release year) and answered
with confident specifics instead of admitting ignorance. The correct
answer (Bellaphone, announced July 2026) is outside their 2024 cutoff;
the lower tiers fabricate rather than abstain.

| Task | low | medium | high |
| --- | --- | --- | --- |
| Explain a Rust E0308 error | correct, one fix | correct, both fixes | correct, both fixes |
| Summarize a failed test log | correct | correct, concise | correct, concise |
| Recent world knowledge | fabricated | partly, invented details | confidently wrong |
| Knows its cutoff | no | says 2024 | says 2024 |

Do not evaluate Snor on world knowledge. It has no internet in v1 and a
2024 cutoff. Evaluate the tasks it exists for:

1. explain an error;
2. summarize terminal output;
3. suggest a command;
4. answer from explicitly supplied context;
5. say "unknown" when the context does not contain the answer.

Score each prompt correct / partly / wrong, flag invented facts, and
record TTFT and tokens/s. A 20-30 prompt fixture is enough; keep it
opt-in and out of normal CI. `medium` is the minimum for context-heavy
answers; `low` is fine for short error explanations but tends to give a
single fix and to invent elsewhere.

System prompt rule to test: "Answer only from the supplied context. If
it is not there, say you do not know." This is the difference between a
usable investigation tool and a confident liar.

## Distribution: optional, like whisper.cpp

Verified precedent: the Arch `whisper-cpp` package is 3.42 MiB and ships
binaries, headers, and libraries only, with no GGML weights. Backends
are separate `ggml-*` packages, and models are fetched at runtime by
upstream's `models/download-ggml-model.sh` or by the frontend's model
manager.

Snor follows the same split:

- The engine is an optional runtime dependency: `llama-cpp` for the
  server and `ggml-vulkan` (or `ggml-cuda`) for GPU offload. The base
  muis install and startup do not change.
- Weights are never bundled or shipped in the repo or package. Settings
  provides an explicit **Download** for the selected tier with size,
  progress, resume, sha256 verification, and **Delete**. A **Browse**
  action accepts any user GGUF. No implicit downloads at launch or on
  first prompt.
- If the engine is missing, the panel shows a disabled state with the
  exact install hint. The app does not run `pacman` or escalate with
  sudo.
- The existing dialog plugin handles the file picker. The default model
  directory is `~/.local/share/muis/models/`, configurable in settings.
- Flatpak bundles the server and its shared libraries in an extension
  and must not assume a host `llama-server`. Windows stays deferred.
- CI uses the fake backend. Normal CI downloads no models; the tiny-GGUF
  smoke test is manual and opt-in.

## Network and internet access

The model has no network agency. `llama-server` serves tokens and makes
no outbound requests; v1 is offline, loopback-only, and read-only. The
process can reach the network at the OS level, but nothing in the design
uses it.

If internet access is wanted later, add it as an explicit capability,
not a model setting:

1. **Context injection first.** An "add URL" or "search result" action
   in the panel: `muis-shell` fetches with an allowlist, strips HTML,
   shows a context chip, and the user approves. The model never emits a
   URL that is fetched automatically.
2. **Approval-gated tools later (Phase 5).** The model requests
   search/fetch; the shell executes with per-call approval, an egress
   allowlist, size/time limits, no credentials, and redaction.

Design for prompt injection in fetched pages, SSRF (the fetcher must
block private, loopback, and metadata ranges), data exfiltration through
URLs or query strings, and secrets already present in terminal context.
Never execute commands suggested by fetched content. Prefer ACP if Snor
becomes fully agentic.

## Panel UX (v1)

The dock exists but is not wired: `panelSlot` is appended to `#app` (a
column), so it renders under the terminal. Move it into `.main` after
`center`, make it resizable (default 360-420 px), remember the width per
workspace, and add a toggle shortcut plus a statusbar button.
`SidePanelRegistry` needs a render callback or event so a registered
panel can own its body.

Layout:

- header: Snor title, model/tier, server status, context scope, close;
- context row: removable chips for everything attached to the request
  (`tab`, `workspace`, `opencode`, `docs`, `scrollback`);
- transcript: streaming output, stop, clear, retry, copy;
- composer: send, shortcut, queue indicator (one prompt at a time);
- sources: clickable file paths and session titles used for the answer;
- unconfigured state: "local AI is not installed or configured" with
  settings and install hints.

One Snor agent and one conversation per workspace in v1. No ACP, no
multi-agent thread sidebar. Closing the panel does not stop the
terminal.

Keep `low` as the global default. Workspace and session questions are
context-heavy: the panel offers a one-click switch to `medium` (and
remembers it for that workspace) when a context chip is added.

## Workspace and opencode context

Snor should answer questions like:

- "How far is the opencode task `Remaining tasks in snor-plan.md`?"
- "Summarize what we are doing in that session."
- "Across the opencode sessions in this muis session, which feature doc
  is not being built on?"

The model cannot look any of this up. `muis-shell` must resolve the
state and pass a compact card; the model only synthesizes and explains.
Do not let it perform the join, filtering, or arithmetic.

### Context providers

Add a `ContextProvider` interface in `muis-shell`. Each provider returns
a small typed card with a title, items, token estimate, and redactions:

- `terminal`: active tab, cwd, selection, optionally the last N
  scrollback lines;
- `workspace`: repo root, branch, worktrees, git status/diff summary,
  open PRs;
- `docs`: docs files, last edit, related worktree/branch/PR;
- `opencode`: sessions, todos, recent prompts, assistant summaries,
  files edited.

The UI attaches cards as chips. Providers run in the shell; the UI does
not read files or use the network.

### opencode data

Prefer the muis opencode plugin as the source. It already reports the
session id, title, and directory; extend it to push a compact index on
`session.created`, `session.idle`, and todo changes. That gives live
session and todo state without reading private storage.

Fallback: read `~/.local/share/opencode/opencode.db` read-only, behind a
provider and a schema/version check. Never write. Use a read-only
connection and tolerate WAL. The DB is large (about 2 GB here); query by
session and time, not full scans. A prototype over the last 7 days found
23 muis sessions and the Snor session at 93 messages / 381 parts.

### Deterministic commands

The shell resolves these; the model never chooses the query:

- `/task <name>`: find the session, list todos (done/total), last
  activity, files edited, and the recent assistant summary;
- `/todos`: todo progress for the current session;
- `/sessions`: recent sessions in this workspace with title, dir,
  status, and last activity;
- `/docs`: docs edited recently vs docs with no recent edit and no open
  worktree, branch, or PR;
- `/diff`, `/worktrees`: git state;
- `/summarize`: current session or selected scrollback.

For "which doc is not being built on", compute the join in code: a doc
is idle when no recent session edited it **and** no worktree, branch, or
PR references it. References alone are not enough; in the prototype
every non-archive doc was merely referenced within 7 days.

### Budget and privacy

- Default to a 1-2k-token card; 4B prefill is about 5 s at 2k tokens.
  For long sessions use last-N turns plus files and todos, or map-reduce.
- Exclude raw tool output by default; include it only on request.
- Scope to the current workspace by default; global sessions need an
  explicit chip.
- Show every attached item, redact secrets before sending, and keep the
  conversation local.

### Scope

v1 ships curated providers and the commands above: no free-form
retrieval and no tools. The first tool slice is read-only and
approval-gated (`opencode_sessions`, `opencode_todos`, `read_doc`,
`git_status`). Writes and command execution stay in Phase 5.

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

### Phase 0 spike results (2026-10-24)

Environment: Arch, `llama-cpp` 0.6.0-1 (build b11429), `ggml-vulkan`
0.26.0-1, GTX 1080 Ti (11 GiB) with the Vulkan backend, i7-8700K, 31 GiB
RAM. Models were downloaded from Hugging Face and their sha256 checked
against the hub metadata.

| Model | File | Params | VRAM @ 8k | pp512 | tg |
| --- | ---: | ---: | ---: | ---: | ---: |
| Qwen2.5-1.5B-Instruct Q4_K_M | 1.04 GiB | 1.78B | 1.2 GB | 1018 t/s | 112-124 t/s |
| Qwen3-4B-Instruct-2507 Q4_K_M | 2.32 GiB | 4.02B | 3.6 GB | 476 t/s | 62 t/s |
| Qwen3-8B Q4_K_M | 4.68 GiB | 8.19B | 5.7 GB | 221 t/s | 32 t/s |

- CPU fallback (i7-8700K): the 1.5B generates about 9.6 t/s; 4B and 8B
  are not usable interactively. `low` is therefore also the CPU tier.
- Cold start with warm shader cache: 1.6 s / 8 s / 7.5 s. The first run
  can add shader compilation time. A missing model path exits nonzero
  with a clear error.
- Prefill dominates the UX on large scrollback. At 8k context a
  ~2k-token prompt costs roughly 1.5 s (1.5B), 5 s (4B), and 11 s (8B)
  before the first token.
- Streaming on `/v1/chat/completions` works; first token is 65-95 ms on
  short prompts. `/health` is the readiness check. Consecutive requests
  reuse the server and prefix cache.
- `--api-key` returns 401 without the key and the bind is loopback-only.
  This build serves its web UI on `/` but only with gzip, which browsers
  send; there is no `--no-webui` flag, so rely on loopback + key and
  revisit when llama.cpp exposes a disable switch.
- Cancellation: closing the stream aborts the task immediately (the log
  records `cancel task`); the next request was served in 44 ms.
- `-c` is **per slot**. The default `--parallel 4` allocates four
  contexts and splits VRAM and attention; `--parallel 1` is the right
  default for Snor.
- Streaming chat throughput is a little below `llama-bench`: about
  90 / 48 / 27 t/s for low / medium / high.
- Router mode (`--models-dir`, `--models-max 1`) can expose several
  models from one server and load them on demand. Useful for comparing
  tiers while testing, not required for v1.

Reproduction shape:
`llama-server --host 127.0.0.1 --port <p> --api-key <k> -m <gguf>
-c 8192 --parallel 1 -ngl 99`.

Not tested: out-of-VRAM model load, 7B/14B alternatives, tool calling
(out of scope for v1), long idle memory behaviour, and Flatpak/Windows.

### Phase 1 - process supervisor

New `crates/muis-shell/src/snor.rs` (or a `snor` module beside the
existing bridge):

- lazy start on first Snor use, not at app launch;
- allocate a free loopback port, then spawn `llama-server` with
  `--host 127.0.0.1`, `--port`, `--api-key`, `--model`, `--ctx-size`
  (per slot), `--n-gpu-layers`, and `--parallel 1`;
- health check (`/health`) before the first prompt;
- reap the child on natural exit, restart on crash, kill on app exit;
- one prompt at a time (`--parallel 1`) with a visible queue; later
  allow `--parallel N` only if the extra KV fits in free VRAM;
- cancel by closing the streaming connection; the spike confirmed the
  task aborts immediately and the next request is served;
- this build serves a web UI on `/` and has no `--no-webui` flag, so
  keep the loopback bind and per-launch key; revisit when llama.cpp
  exposes a disable switch;
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
- `snor.modelTier` (`low` | `medium` | `high`; default `low`);
- `snor.modelPath` (user-selected GGUF; overrides the tier; empty means
  unconfigured);
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
download models implicitly. Download is an explicit settings action with
the source URL, size, and sha256 stored in app metadata; a custom
`modelPath` bypasses the downloader.

### Phase 3 - side-panel UI

Register a `snor` panel through `SidePanelRegistry`. First fix the dock:
`panelSlot` currently sits below the main row; move it into `.main`,
make it resizable, and add a toggle. See "Panel UX (v1)".

- chat input, streaming output, stop, clear, model/status header;
- a visible "not configured" state with a link to settings;
- context chips showing exactly what is attached to the request;
- quick actions and slash commands (`/task`, `/todos`, `/sessions`,
  `/docs`, `/diff`, `/worktrees`, `/summarize`);
- a shortcut and a statusbar/server indicator;
- per-workspace conversation persistence, restored on reopen.

Context builder (see "Workspace and opencode context"):

- current workspace directory and git branch;
- active tab title and cwd;
- selected text;
- optionally the last N lines of scrollback, with an explicit toggle;
- the opencode session index and todo progress;
- docs edited recently vs idle docs.

Send a token-budgeted subset, never the whole buffer silently. Show what
was included so the user can remove it. Terminal output routinely
contains secrets.

### Phase 4 - packaging

- Arch: `llama.cpp` as an `optdepends` (or `depends` if it becomes a
  hard requirement), with a note on package flavours (CPU/CUDA/Vulkan).
- CI: fake backend for unit tests; no model downloads in normal CI; an
  optional manual tiny-GGUF smoke job.

Packaging follows the whisper.cpp split: the engine is optional and
weights are never bundled; the settings dialog owns an explicit
download. See "Distribution: optional, like whisper.cpp".

### Phase 5 - actions (only if wanted)

v1 is read-only. Then, in order:

1. "insert this command into the prompt" with an explicit user action;
2. approval-gated **read-only** tools first (`opencode_sessions`,
   `opencode_todos`, `read_doc`, `git_status`) so follow-up questions
   do not need a pre-attached card;
3. approval-gated write/execute tools (edit, run command);
4. only then a real ACP adapter or a second tool/permission UI.

If Snor must act on files or commands, prefer reintroducing ACP and
reusing a shared agent surface over building a parallel tool UI.

## ACP fork

An earlier agent-integration plan (removed from the tree) decided Snor
would be a side-panel ACP engine. The ACP pane is no longer present, so
that decision would have to be re-made. ACP is the right surface **if
Snor is an agent**; for a read-only chat assistant it adds
session/tool/permission semantics that are not needed.

Recommendation:

- **v1:** custom side-panel chat with a small streaming API.
- **If Snor must act:** reintroduce ACP and reuse one shared agent surface.

Treat the old Phase 5 decision as historical; it no longer constrains v1.

## Decisions (2026-10-24)

The Phase 0 spike settles the v1 surface, backend, and distribution:

- **Surface:** custom side-panel chat. No ACP session, tool, or
  permission semantics in v1. Revisit ACP only if Snor must read, edit,
  or run things.
- **Backend:** supervised `llama-server` child from Arch `llama-cpp`
  with the Vulkan backend, started lazily on first use.
- **Default tier:** `low` (Qwen2.5-1.5B-Instruct Q4_K_M). `medium` and
  `high` are opt-in; `snor.modelPath` overrides every tier.
- **Concurrency:** one prompt at a time (`--parallel 1`) with a visible
  queue. Cancel by closing the stream.
- **Privacy:** no tools, no shell, and no network in v1. Context is
  explicit, token-budgeted, and visible.
- **Distribution:** engine and weights stay out of the base install; the
  settings menu performs an explicit download and never bundles or
  fetches implicitly.
- **Lifecycle:** one shared server per app, lazy start. The unload
  policy (close panel, idle timeout, or keep resident) is still open.
- **Panel:** right dock, resizable (360-420 px), toggle + statusbar
  button. The reserved slot must move from the column container into
  the `.main` row first.
- **Workspace context:** curated `ContextProvider` cards and
  deterministic slash commands in v1. Read-only tools come next; no
  free-form retrieval or model-chosen queries.
- **opencode source:** the muis plugin pushes a compact session/todo
  index. Fall back to a read-only, schema-checked query of
  `opencode.db`; never write to it.
- **Tier in context mode:** `low` stays the global default; `medium` is
  offered and remembered per workspace when context is attached.

## Questions and concerns

1. **Product scope.** Is Snor a chat assistant ("explain this error",
   "summarize this output"), or a real agent that can read files, edit,
   and run commands? This decides custom chat vs ACP and changes the
   effort from days to weeks.
2. **ACP surface (settled).** The old plan targeted a side-panel ACP
   engine, but ACP was removed with the agent pane. v1 is custom chat;
   revisit ACP only if Snor must act.
3. **Embedded vs external.** "From extra" is Arch-only and keeps GPU
   builds out of muis. Embedding gives portability but brings
   C++/CUDA/Vulkan build and packaging complexity. Is the first target
   Arch only?
4. **Model distribution.** User-supplied GGUF, or a muis downloader and
   catalog? If a catalog: which models, quants, checksums, licenses,
   default for 8-11 GB VRAM, and what happens on CPU-only machines?
5. **Licensing.** llama.cpp is fine to ship, but model weights have
   varying licenses. Never bundle weights without explicit permission.
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
    document. The deferred entry should link here once the open decisions
    are resolved.
14. **Internet access.** Should the model be able to search or fetch at
    all? v1 says no: the engine has no egress and the model cannot emit
    a URL that is fetched automatically. Later, prefer explicit context
    injection over tool calling. See "Network and internet access".
15. **opencode coupling.** Plugin-pushed index vs direct database
    access. Prefer the plugin; the database fallback needs a
    schema/version check and must stay read-only.

Questions 1-5, 7, 10, 11, and 14 are settled for v1 by the decisions
above; 6 (unload policy), 8 (redaction details), 9, 12, 13, and 15
remain open implementation work.
