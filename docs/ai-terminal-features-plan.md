# AI-terminal features: implementation plan

Source: an external design review of what AI terminals, TUIs, and ACP
clients are adding (2026-10), mapped onto muis and expanded into a
buildable plan. This is a **planning document, not a commitment**. It is
the "what if we did all of it" version; the decisions still live in
`docs/features.md`, `ROADMAP.md`, and `docs/deferred.md`, and nothing here
overrides them.

Scope note: the review contained ~20 distinct ideas. Most overlap heavily
with existing planning docs, and several are already implemented. This
document consolidates them, records what exists today, and turns each into
a concrete workstream with risks and open questions.

A consolidated list of open questions is at the bottom; recommendations
are marked **[Recommend]**.

Legend:

- Status: **done** / **partial** / **absent** (against `main`, `117c6e8`).
- Effort: **S** (hours) / **M** (days) / **L** (1-2 weeks) / **XL**
  (multi-week, new subsystem).
- Verdict: **build** / **consider** / **defer** / **skip**.

---

## 0. Current baseline (what muis already has)

Grounding for every feature below. Do not re-plan what is done.

- **Stack:** Rust/Tauri 2 shell + `xterm.js` frontend; one
  `muis-worker` process per session owns the PTY.
- **Data model:** `Workspace` (called "session" in the UI) contains
  `Tab`s; each `Tab` = a pty (`pty_id`). `WorkerPool` is keyed by
  workspace id. There is no separate `Session` or `Process` entity.
  (`src-ui/src/sessions.ts`, `crates/muis-shell/src/bridge.rs`.)
- **Persistence:** none; workspaces and tabs are in-memory. Only the
  config file is written. (`crates/muis-shell/src/persist.rs`.)
- **ACP:** one shared `opencode acp` process (`AgentPool`,
  `crates/muis-shell/src/agent.rs`), `AcpClient` with
  initialize/new/load/prompt/cancel/close/setConfigOption + permission
  handling, model picker, tool-call cards, colored diffs, plan/steps,
  attachments, stop. Per-tab resume via `acpSessionId`.
  `docs/agent-integration.md`, `docs/acp-shared-backend-plan.md`.
- **Terminal agents:** opencode session-id capture via an auto-installed
  plugin (`muis-notify --agent-session`), silent agent-tab marking, and
  `opencode --continue`/`-s <id>` resume. Claude/Codex are deferred
  (unverifiable here).
- **Search:** titlebar cross-session search over **open** tabs +
  session/tab titles with `all|session|tab` scopes, regex/case
  (`src-ui/src/searchall.ts`); in-terminal `SearchAddon`.
- **Command palette:** `Ctrl+Shift+P`, ~12 hard-coded actions
  (`src-ui/src/commands.ts`, `main.ts` `openPalette`).
- **Notifications:** OSC 9/777/99 + `muis-notify` socket; done badges and
  toast policy (`notify.ts`, `done.ts`, `finish.ts`).
- **Dead-session detection already exists but is unused:** `worker.ts`
  (`onWorkerDead`/`isSessionDead`) has no caller in `main.ts`.
- **Absent:** worktree sessions, task orchestration, usage/cost
  accounting, remote API, unified permission centre, persisted activity
  timeline, attention queue, split panes (explicitly dropped), project
  profiles.

---

## 1. Feature index

| # | Feature | Status | Effort | Verdict |
|---|---|---|---|---|
| 1 | Live agent status + attention tracking | partial | M | build |
| 2 | Git worktree sessions | absent | L | consider |
| 3 | Universal search + historical index | partial | L | consider |
| 4 | Session checkpoints & recovery | partial | M | build |
| 5 | Command palette (action registry, Ctrl+K) | done (narrow) | S-M | build |
| 6 | Task orchestration across agents | absent | XL | defer |
| 7 | Unified permission/approval centre | partial | M | consider |
| 8 | Structured agent activity timeline | partial | L | consider |
| 9 | Cross-agent handoff | absent | L | defer |
| 10 | Usage & productivity dashboard | absent | M | consider |
| 11 | Prompt snippets / command library | partial | S | build |
| 12 | Cross-session diff viewer | partial | M | consider |
| 13 | Flexible layouts (splits/tab groups) | absent | L | skip |
| 14 | Attention queue | absent | S | build |
| 15 | Remote control API | absent | L | skip |
| 16 | Project profiles | partial | M | consider |
| 17 | Capability-aware ACP model | partial | M-L | build |
| 18 | Workspace/Session/Process separation | partial | L | consider |
| 19 | Conversational controls (fork/queue/steer) | partial | M-L | consider |
| 20 | Multi-agent command centre | absent | M | consider |

---

## 2. Workstreams

### A. Agent awareness and attention

#### F1. Live agent status + attention tracking

**Intent.** A single status per agent session — working, waiting for
approval, asking a question, idle, completed, crashed, disconnected — and
a global "these sessions need you now" signal.

**Current state.** Partial. `activity.ts` tracks pty busy-ness; `done.ts`
tracks unviewed finishes; the ACP pane has `running/ready/started` flags
and renders permission cards. There is no unified enum and no cross-tab
attention concept. Worker death is detected (`worker.ts`) but never
consumed.

**Plan.**

1. Introduce a pure, unit-testable `AgentStatus` model (a reducer over
   existing events) in `src-ui/src/`: derive `{ working, needs-input,
   idle, done, exited, disconnected }` from the event streams already
   present (pty output/exit, command tracker, done tracker, ACP
   `session/update`, permission requests, worker-dead).
2. Consume `worker.ts` `onWorkerDead`/`isSessionDead` in `main.ts` and
   surface `disconnected` on the affected session/tab.
3. Per-session status in the sidebar + per-tab indicator; a global
   indicator for "needs you".
4. An attention shortcut that cycles sessions needing input/failed/done
   (merges with F14).
5. Optional desktop notification on "needs approval" / "finished while
   unfocused" (reuse `notify.ts`).

**Testing.** Reducer unit tests over scripted event sequences; a Rust
side test only if worker-dead plumbing changes.

**Risks / concerns.** Terminal tabs have no structured status; heuristics
can misfire. Prefer ACP-reported state where available and mark heuristic
states as best-effort.

#### F14. Attention queue

**Intent.** One shortcut cycles agents that need an answer, failed, or
finished — without noisy notifications.

**Current state.** Absent (`DoneTracker` only feeds the window-title
count).

**Plan.** Build directly on F1's status model: maintain an ordered
"attention" list and bind a shortcut to jump. Reuse `focus.ts` selection
rules.

**Effort.** S once F1 exists. **Verdict: build.** Ship F1+F14 together.

#### F20. Multi-agent command centre

**Intent.** One screen showing all running agents, status, waiting for
input, finished, needing attention; plus session groups/pins and an
activity feed.

**Current state.** Absent; the sessions sidebar is the closest surface.

**Plan.** A view built on F1's status model: a compact per-session row
(status, elapsed, last activity, project). Groups/pins and an activity
feed depend on F8. Start as a sidebar mode before a dedicated screen.

**Risks / concerns.** Value scales with agent count; validate the
status model first (F1).

---

### B. Parallel work and orchestration

#### F2. Git worktree sessions

**Intent.** Launch an agent session in an isolated git worktree (branch
or commit), with per-tab cwd/branch, and show changed files/dirty/conflict
state.

**Current state.** Absent. Only a `git_branch` command and statusbar pill
exist; there is no git plumbing for worktrees/status/diff.

**Plan.**

1. Rust git helpers in `crates/muis-shell` (or a `muis-core` module):
   `worktree_add`, `worktree_list`, `status`, `diff --stat` via `git2`
   or the `git` CLI (decide).
2. New-session option "worktree session": pick base ref, create under a
   convention path (respecting the existing central-worktree habit),
   set the tab cwd.
3. Statusbar/tab badges: branch, dirty, conflicts; a changed-files
   panel (shared with F12).
4. Cleanup policy: detect orphaned worktrees; never silently delete.

**Risks / concerns.** This is a new subsystem; destructive git
operations need guardrails; path/root conventions must be configurable.

#### F12. Cross-session diff viewer

**Intent.** Compare what two agents changed, or which files multiple
agents touched.

**Current state.** Per-tool diff rendering only, inside one ACP pane.

**Plan.** Build on F2's git plumbing: a diff view keyed by working
directory, able to show a single tree's diff or two trees side by side.
The per-tool ACP diff stays as-is.

**Verdict.** Consider, only if F2 is built — they share the plumbing.

#### F6. Task orchestration across agents

**Intent.** Define a task with dependencies (A designs, B implements, C
tests, D reviews) and let muis coordinate.

**Current state.** Absent.

**Plan (if pursued).** A task-queue/dependency model over agent
sessions, driven by capability events (completion, needs-input).
Deliberately not a general multi-agent framework at first.

**Verdict: defer.** Depends on F1, F17, and multi-backend support; large
surface with weak payoff until multi-agent use is routine.

#### F9. Cross-agent handoff

**Intent.** Package a task's context (history, decisions, git diff, file
refs) and hand it to another agent backend.

**Current state.** Absent; only single-file attachments exist.

**Plan (if pursued).** Needs more than one usable backend (currently
opencode only) and F17. Defer.

**Verdict: defer** (revisit after Claude/Codex adapters).

---

### C. Search, history, and snippets

#### F3. Universal search + historical index

**Intent.** Search messages, tool calls, errors, command output,
projects/paths/branches/titles, and **closed** sessions, with filters
(`project:`, `agent:`, `type:`, `after:`).

**Current state.** Partial: open tabs + titles only, scopes/regex/case,
no history, no filters.

**Plan.**

1. An on-disk index (SQLite or a simple append log) fed by the existing
   notify/ACP event streams and command output; created only if the user
   opts in.
2. Extend `searchall.ts` query syntax with typed filters; keep the
   matcher pure and unit-tested.
3. Enter restores the session and jumps to the match.

**Risks / concerns.** Storage growth and indexing cost; privacy of
persisted content — needs a clear opt-in and retention policy.

#### F11. Prompt snippets / command library

**Intent.** Save reusable prompts, project instructions, and shell
commands; fuzzy search; placeholders like `{branch}` / `{test_command}`.

**Current state.** Partial: `history.ts` stores recent **search queries**
only.

**Plan.** A `SnippetStore` in `AppConfig` (or its own JSON), wired into
both the ACP input and shell tabs; placeholder expansion at use time;
fuzzy match. Store secrets separately (see F16).

**Effort.** S. **Verdict: build.**

#### F4. Session checkpoints and recovery

**Intent.** Restore tabs/selected tab/scroll/project; detect dead
sessions; record last agent state and pending input; reopen a closed tab;
named snapshots (`before-refactor`).

**Current state.** Not implemented: workspaces and tabs are in-memory,
with no session or scrollback restore.

**Plan.**

1. Wire dead-session detection into the UI (shared with F1).
2. "Reopen closed tab" stack (bounded) in `SessionStore`.
3. Named workspace snapshots (workspace/tab metadata + run metadata).
4. Scroll-position restore: xterm has `SerializeAddon`; capture cursor
   line in the snapshot.
5. Explicitly distinguish **UI restore** from **live process restore**.

**Risks / concerns.** Keep the existing tests green.

---

### D. Navigation, controls, and configuration

#### F5. Command palette (action registry)

**Intent.** `Ctrl+K` search over **any** action.

**Current state.** Done but narrow: `Ctrl+Shift+P`, ~12 hard-coded
actions.

**Plan.** Move to a registry where each action declares id, label,
optional shortcut, and enablement; keep `filterCommands`/`clampIndex`
pure. Decide the key binding.

**Risks / concerns.** `Ctrl+K` collides with common shell/agent
bindings; may need to keep `Ctrl+Shift+P`.

#### F13. Flexible layouts

**Intent.** Split panes, tab groups, project sidebar.

**Current state.** Absent; split panes explicitly dropped in
`docs/deferred.md` ("muis is one terminal per tab").

**Verdict: skip.** Contradicts an explicit prior decision; revisit only
if the maintainer reverses it.

#### F16. Project profiles

**Intent.** Per-project env vars, default agent, startup commands,
preferred layout; secrets stored separately.

**Current state.** Partial: workspace = name + dir; per-workspace themes;
global agent command. No env/startup/layout/secret handling.

**Plan.** Extend the workspace record with a `profile` (env map, agent
override, startup command, layout ref). Secrets go to the OS keyring
(existing keyring integration), never the workspace metadata.

**Risks / concerns.** Env injection must go through the worker spawn path
(`muis-worker`), not the UI.

---

### E. Observability, governance, and protocol

#### F7. Unified permission/approval centre

**Intent.** One consistent interface for agent permission prompts.

**Current state.** Partial: ACP permission cards per pane. Terminal
agents have no approval channel.

**Plan.** Aggregate ACP permission requests into a single review surface
(queue, "approve all"," per-backend detail). **Preserve each backend's
security semantics** — never turn approval-required into auto-approved.

**Risks / concerns.** Only ACP exposes structured permissions today;
scope to ACP-only unless terminal adapters add a channel.

#### F8. Structured agent activity timeline

**Intent.** A filterable event model (prompt, working, tool invoked, file
changed, permission requested, idle, error, completed) that survives the
transcript.

**Current state.** Partial: ephemeral DOM in the agent log; nothing
structured or persisted.

**Plan.** Emit structured events from the ACP update stream and the
notify/osc sources into an in-memory (optionally persisted) store; UI
filter/timeline over it. Pairs with F1 and F3.

**Risks / concerns.** Persistence/privacy (same as F3); define the event
schema once.

#### F10. Usage & productivity dashboard

**Intent.** Per-session/project token/cost, runtime, tool-call/error
counts, model/backend.

**Current state.** Absent; only ACP `usage_update` token text; no cost.

**Plan.** Aggregate `usage_update` (and runtime/tool counts from F8) per
session and project. Clearly separate **reported / estimated /
unavailable**. Cost is only available where a backend reports it.

**Risks / concerns.** opencode ACP gives tokens, not cost; a token-only
dashboard may be of limited value — validate.

#### F17. Capability-aware ACP model

**Intent.** Model capabilities (session lifecycle, streaming,
permissions, input requests, cancellation, history/replay, file changes,
model selection, usage, recovery) and distinguish **unsupported** vs
**temporarily unavailable** vs **supported-but-inactive**.

**Current state.** Partial and substantial: `acp.ts` implements most of
the protocol; there is no explicit capability/tri-state model, replay is
limited to `session/load`, no fork.

**Plan.** Add a capability/state layer over `AcpClient` that normalizes
backend differences; UI reads capability state instead of guessing from
errors. This is the foundation for F1, F7, F8, F10, F19.

**Verdict: build** (foundational).

#### F19. Conversational controls

**Intent.** Queued prompts, mid-task steering, model/agent switching,
session branching/fork, undo/redo.

**Current state.** Partial: model switch + cancel. No queue, no
steering, no fork, no undo/redo (ACP `/undo` `/redo` unsupported by
opencode).

**Plan.** Add a prompt queue and optional steering if the backend
supports it; expose `session/fork` where advertised. Gate each control on
F17 capability state.

**Risks / concerns.** Much depends on opencode ACP support; don't
promise undo/redo.

#### F18. Workspace / Session / Process separation

**Intent.** Model the three concepts distinctly: a workspace (project
folder, tabs, layout, prefs), a session (conversation identity + history
+ backend), and a process (the running pty/agent).

**Current state.** Partial/conflated: `Workspace` is called "session" in
the UI and keys the worker; `Tab` is a pty; agent ids live on tabs.

**Plan (if pursued).** Introduce `Session` and `Process` as first-class
records; introduce a versioned on-disk store. This touches
the Rust model, the TS mirror, and the worker keying.

**Risks / concerns.** High churn, migration risk, and it collides with
the existing word "session" everywhere. Only worth it before layering
major features (F2, F6, F9, F16) that benefit from the distinction.

---

### F. Platform and integration

#### F15. Remote control API

**Intent.** A local authenticated API or remote interface to check agent
status, read output, and approve tasks.

**Current state.** Absent; Tauri IPC only.

**Verdict: skip** for a personal terminal. Security surface (auth,
exposure, permissions) is large relative to need. Revisit only if
requested.

---

## 3. Suggested sequencing

Do the small, high-value, low-risk items first; defer the subsystems.

1. **Foundation (S-M):** F5 palette registry, F11 snippets, F1+F14
   status model + attention queue, wire dead-session detection, F17
   capability layer.
2. **Recovery (M):** F4 checkpoints/reopen, F8 activity store.
3. **Surfaces (M):** F20 command centre, F7 permission centre, F10
   usage view — all on top of F1/F8/F17.
4. **Subsystems (L+):** F3 historical index, F2/F12 worktree + diff,
   F6/F9 orchestration/handoff, F16 project profiles.
5. **Out of scope unless reversed:** F13 splits, F15 remote control.

Cross-cutting prerequisites: define the **event schema** (F8) once; use
it for F1, F3, F10; keep every reducer pure and unit-tested; keep
provider-neutral naming; never violate the one-worker-per-session rule.

---

## 4. Questions and concerns

Each item names the feature it affects and carries a recommendation.

### Cross-cutting

- **Q1 (scope).** This list is very large. Should muis pursue the whole
  program, or only the foundation tier (F1/F5/F11/F14/F17/F4/F8)? The
  review mixes small wins with multi-week subsystems.
  **[Recommend]** Foundation tier first; re-evaluate the rest after.
- **Q2 (naming).** "Session" already means a workspace. Adding an agent
  `Session` concept (F18) will be ambiguous. Accept a rename (e.g.
  workspace = "project"), or keep the conflated model and avoid a
  first-class `Session`? **[Recommend]** avoid F18 now; use "agent
  session" consistently in the UI.

### F1/F14/F20 — status and attention

- **Q3.** Is busy/done enough today, or is the unified status model worth
  it? **[Recommend]** build: it is the base for F20/F7/F10.
- **Q4.** For terminal tabs (no structured status), do we accept
  best-effort heuristic status, clearly labeled? **[Recommend]** yes,
  with ACP state authoritative where present.

### F2/F12 — worktree and diff

- **Q5.** Is git worktree integration in scope at all? It is a new
  subsystem with destructive operations. **[Recommend]** only if
  parallel-agent use is a real workflow; otherwise defer.

### F3 — historical search

- **Q6.** Are we willing to persist conversation/command content to disk
  for search? Retention and opt-in policy? **[Recommend]** opt-in,
  bounded retention, explicit location.

### F4 — checkpoints

- **Q7.** Restore scroll position and "reopen closed tab" — worth the
  snapshot changes? **[Recommend]** yes for reopen-closed-tab (cheap);
  scroll position is a nice-to-have.

### F5 — palette

- **Q8.** `Ctrl+K` vs keeping `Ctrl+Shift+P`? **[Recommend]** keep
  `Ctrl+Shift+P`, add `Ctrl+K` only if it does not collide.

### F7 — permissions

- **Q9.** Scope the approval centre to ACP-only (terminal agents have no
  channel)? **[Recommend]** ACP-only; revisit with terminal adapters.

### F8/F10 — timeline and usage

- **Q10.** Persist the activity timeline, or keep it in-memory?
  **[Recommend]** in-memory first; persist only alongside F3.
- **Q11.** Is a token-only usage view useful when cost data is often
  absent? **[Recommend]** build only if opencode exposes enough.
- **Q12.** Which agent is the multi-backend target (Claude/Codex) and
  when? F9/F6/F19 partly depend on it. **[Recommend]** stay
  opencode-only until adapters are installable/verifiable.

### F16 — project profiles

- **Q13.** Add per-project env/startup/agent overrides, with secrets in
  the keyring? **[Recommend]** consider; keep secrets out of JSON.

### F17/F18 — architecture

- **Q14.** Build the capability/tri-state layer (F17)? **[Recommend]**
  yes — foundational, low-risk, and improves error handling.
- **Q15.** Do the `Workspace`/`Session`/`Process` refactor (F18)?
  **[Recommend]** defer unless a feature (F2/F6/F9/F16) forces it.

### F13/F15 — explicitly dropped

- **Q16.** Confirm splits (F13) and remote control (F15) stay out.
  **[Recommend]** skip both.

### F6/F9 — orchestration and handoff

- **Q17.** Pursue orchestration/handoff now or after multi-backend
  support? **[Recommend]** defer.
