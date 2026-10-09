# muis features

Working list of features for muis: what the maintainer has asked for, and
proposals for the rest. This is a planning doc, not a status tracker — the
settled/locked state lives in `ROADMAP.md`, the design-gap audit in
`docs/archive/missing-features.md`, deferred/dropped work in
`docs/deferred.md`, and the build log in `docs/archive/build-progress.md`.

Maintainer requests are their own sections; proposals are tagged `[P]`.
Line references are approximate and drift with `main`.

## Implementation readiness

Triage of the maintainer requests below: what can be built as-is vs what
needs a decision first. Checked against `main` at `3ed1a7f` (v1.1.2).

### Implemented — test when it lands in the client

Branch `feature/ready-ux`, PR #43. Not yet exercised in a real client
session; check each once it is merged/released.

- **Date next to the clock** — done. Statusbar shows e.g.
  `Tue 2026-10-06 19:48:46` (`clock.ts`). Test: date matches the local
  day and rolls over at midnight.
- **Real muis icon in the titlebar** — done (bundled `assets/muis.png`).
  Test: looks crisp at normal and HiDPI scaling.
- **Native folder picker for new sessions** — done
  (`tauri-plugin-dialog`, `dialog:allow-open`). Test: picker opens at the
  active dir; cancel aborts; the non-Tauri prompt fallback still works.
- **Close session / Close tab in the context menu** — done. Test:
  right-click close for a tab and a session, busy confirmation, and that
  a background session's worker is stopped.

### Implemented — PR #46 (test when it lands in the client)

Branch `feature/decided-ux`. Also not yet exercised in a real client.

- **System monitor (CPU / RAM / GPU)** — total CPU %, whole percent;
  GPU pill hidden when unreadable; Rust sampler pushes events and pauses
  while the window is hidden. Test: values track reality; GPU pill
  appears only when a reading exists.
- **Kill the session when its last tab exits** — done, immediate (no
  grace). Test: `exit` in a session's only tab removes the session.
- **Version in the status bar** — done (`v1.1.2` from the Tauri bundle
  version). Crate/package dev versions are left alone: releases bump only
  `tauri.conf.json`, so aligning them would drift again each release.
- **Split new-tab (shell vs AI)** — done: `+` shell, `AI` agent tab,
  hidden unless the agent is on PATH; restores scrollback then relaunches
  the agent. Test: option hidden without the agent; agent launches on a
  new and a restored AI tab.
- **Less blue `＋ session` button** — done (neutral, accent on hover).
- **Reorder bottom-left items** — done, fixed order
  `cwd → git → session·tab → user`.
- **Drag-and-drop reorder** — done: drop between items; dragged active
  item stays active. Test: reorder tabs and sessions, active follows.

### Implemented after this list (PRs #47, #50)

Not in the original list; built during the ACP work. On `feature/decided-ux`
(merged), `feature/settings-and-tab-move`, and `feature/acp-pane`.

- **Visible Settings button** (gear) and **tab-into-session drag** (#47).
- **ACP pane** (Phase 1 of `docs/agent-integration.md`): `AI` opens a
  native agent surface — streaming text/thoughts, tool-call cards with
  diffs, permissions, stop; exact `session/load` resume (#50).
- **Exact session capture (opencode)**: a plugin reports the session id
  via `muis-notify --agent-session`; the tab resumes with
  `opencode -s <id>` instead of `--continue` (#50).
- **Auto-mark agent tabs**: a tab whose last command was
  opencode/claude/codex is remembered as an agent tab (#50).
- **Staggered agent restore**: a queue with a core-scaled concurrency
  window (capped at 4), visible-tab-first, `nice`d spawns (#50).
- **opencode completion notify**: the plugin reports `session.idle`; the
  tab gets the done badge/toast (#50).
- **ACP polish** (#50): plan/steps cards, colored diffs, permission cards
  (tool + path), model picker, attachments, Stop unblocks the input.
- **ACP Phase 2 detect-and-offer** (#50): typing a known agent in a shell
  offers to open it in the AI panel.
- **ACP Phase 5 decided** (not built): ACP panes as tabs *and* a
  session-linked side panel (Snor-ready); multiple ACP tabs allowed.

### Implemented — terminal base (PR #54)

First pass of the terminal-base list, each with tests:

- **Configurable scrollback** (`scrollback`, 1000..500000) + Settings +
  **Clear scrollback** in the tab menu.
- **Custom keybindings from config** (`keybindings` action → chord).
- **Copy-on-select** + **middle-click paste** (`copyOnSelect`,
  `middleClickPaste`; config-file only for now).
- **Font family, cursor style/blink, bell** with Settings rows; bell
  flashes the pane and/or beeps.

### Implemented — terminal fix (PR #52)

- **opencode TUI not filling the pane**: refit after `spawnTab` + a
  per-terminal `ResizeObserver` (the pty resize had raced the spawn).

### Implemented — terminal base pass 2 (PR #55)

Each with tests:

- **Command palette** (`Ctrl+Shift+P`).
- **Configurable statusbar segments** (Settings checkboxes).
- **Regex + case search** (`Aa` / `.*` toggles).
- **Search history** (Up/Down cycles recent queries).
- **Per-workspace accent themes** (`workspaceThemes`).
- **OSC 8 hyperlinks** (`open_url` opens http(s) in the browser).
- **Dropped the dead `tabsOnTop`** field (no behavior to wire).
- **Reset saved sessions**: `muis --reset-sessions` CLI flag, and a
  Danger-zone **Reset sessions & restart** Settings button (confirmed).

### Still wanted

Terminal base:

- **Background opacity** — needs a transparent window + compositor config,
  not just CSS.
- **Notification-click focuses the tab** and **notification grouping** —
  the notification plugin exposes no JS click/action callback.
- **Sixel/iTerm2 images** and **ligatures** — extra xterm addons/deps.
- **Integration**: "Open with muis here" file-manager action; more `muis`
  CLI flags; restore-on-login / systemd unit (packaging pass).

ACP:

- Phase 3/4 for Claude/Codex (deferred until those CLIs are installed).
- Phase 5 (side-panel ACP + session linkage; Snor) — parked.

Deferred/platform: single Windows exe, Windows installer, Flatpak,
aarch64, website, auto-update, Snor engine.

### PR map

- **Merged**: #43, #45, #46, #47, #50, #52, #53, #54.
- **Open**: #55 terminal base pass 2 — `feature/terminal-base-2`.
- Superseded by #53: #48, #49 (close them). #51 `docs/bugfixes` is
  separate.

### Deferred

- **Single Windows exe** — deferred; the portable `muis-portable-*.zip`
  stays the supported Windows artifact until there is a Windows box to
  verify a self-contained exe on (`docs/windows.md`, `docs/deferred.md`).

### Resolved or dropped since this list started

- Done in `main`: CWD-aware new tabs (ROADMAP settled); automatic tab
  titles from the shell and long-command finish toasts (`feature/tab-title-finish-notify`);
  CI runs green on PRs and `main`.
- **opencode project title** — already works on 1.1.x (opencode's OSC
  title is shown verbatim on the tab); the client just needs updating from
  1.0.0. See the section below.
- Dropped (`docs/deferred.md`): split panes, export/import of session
  state, making muis the Veldmuis default terminal.
- Deferred (`docs/deferred.md`): Windows per-user installer, Snor engine,
  neofetch/fastfetch branding.

## Maintainer requests

### System monitor in the status bar (CPU / RAM / GPU)

Show live CPU, RAM, and GPU usage at the bottom right of the status bar,
next to the existing clock (`src-ui/src/main.ts:795-847`). The statusbar
already appends user, git branch, clock, and shell; the monitor would sit
with the clock group on the right.

Implementation sketch:

- Backend: add a `system_stats` Tauri command beside `sys_info`
  (`crates/muis-shell/src/main.rs:167-180`) returning CPU %, RAM
  used/total, and GPU % (nullable). CPUs/RAM via the `sysinfo` crate;
  GPU best-effort — `nvidia-smi --query-gpu=utilization.gpu` on NVIDIA,
  `/sys/class/drm/card*/device/gpu_busy_percent` on AMD/Intel, blank on
  Windows portable when unavailable.
- Frontend: poll on an interval (e.g. 2 s, pause when the window is
  hidden) and render compact pills. Keep the first sample discounted —
  CPU % needs a delta between two reads.
- Tests: unit-test the formatting/fallback logic with injected samples;
  a Rust test that the command never panics and returns well-formed
  numbers on this machine.

Decided (2026-10-06):

- CPU shown as a single total, not per-core.
- Whole-percent values, no decimals.
- GPU pill hidden entirely when no reading is available (no `—`
  placeholder).
- Sampling lives in Rust: a background task emits Tauri events on a fixed
  cadence; the frontend only listens. Add an off-switch/pause when the
  window is hidden so the task does not sample needlessly.

### Date next to the clock

The clock is time-only today (`tickClock`, `src-ui/src/main.ts:837-847`).
Add the local date next to it (e.g. `Sun 2026-10-04 14:23:05`), matching
the statusbar pill styling. Small, self-contained change; the interesting
part is only the format/locale and whether it updates at midnight.

### Show the muis version in the status bar

Show the muis version at the bottom right (with the clock / system-info
group, `src-ui/src/main.ts:795-847`). Nothing currently surfaces the
version.

Implemented (PR #46): the statusbar shows `v<version>` read from the Tauri
bundle version via `@tauri-apps/api/app` `getVersion()` (needs
`core:app:allow-version`).

- `crates/muis-shell/tauri.conf.json` is the single version authority;
  releases bump only that file.
- The dev versions (`crates/muis-shell/Cargo.toml` `0.1.0`,
  `src-ui/package.json` `1.0.0`) are intentionally left alone — aligning
  them would just drift again at the next release.

### Split "new tab" button: shell vs AI

The `+` button currently always opens a plain shell tab. Split it into a
two-option control: **New terminal (fish)** and **New AI tab**.

- "New terminal" is the current behavior (probe fish on Linux, pwsh on
  Windows — shell probe in `muis-core`).
- "New AI tab" opens a tab whose startup command launches the configured
  AI agent (Codex, Claude Code, …) instead of a plain shell. muis
  already detects these agents from OSC 9/777/99 escapes
  (`docs/archive/notifications.md`), so the tab can also carry an agent label.
- UI: split button (primary `+` = shell, chevron/menu = AI) or a small
  chooser popover. The agent command and args should be configurable in
  `AppConfig` (`src-ui/src/config.ts`) so the choice is not hardcoded.
Decided (2026-10-06):

- One configured agent (a single command from config, e.g. opencode), not
  a menu of agents.
- If the configured agent is not found on PATH, hide the AI option so only
  a normal shell tab is offered.
- On restart, restore the tab's scrollback and relaunch the configured
  agent. Whether to pass the agent a "continue/resume last session" flag
  is part of the agent's config.

Still open (minor): the exact config shape (command + args) and where the
PATH probe lives.

### Less blue "＋ session" button

The sidebar add-session button (`＋ session`, `src-ui/src/main.ts:647`) uses
`.btn.primary` — solid Breeze blue `#3daee9` (`src-ui/src/style.css:93`).
It reads as too saturated/blue next to the muted sidebar. Options:

- Drop to the neutral `.btn` style and keep the accent only on hover.
- Keep a blue tint but desaturate/darken it (e.g. a dimmed accent, no
  full-saturation fill).
- Make it a subtle outlined button with an accent border instead of a
  filled background.

Decided (2026-10-06): neutral button like the rest of the chrome, with the
accent colour only on hover. Not the solid blue fill, and intentionally
more muted than the mock (its footer had export/import, not an add
button — `docs/archive/missing-features.md`).

### Native folder picker for new sessions

Adding a session currently asks for the directory with a manual text
prompt — `window.prompt("Session directory:", ...)` (`src-ui/src/main.ts:652`;
the name is the same at `main.ts:650`). Picking a folder should be a real
native chooser, not typing a path.

- Add `tauri-plugin-dialog` (Rust dep in `crates/muis-shell/Cargo.toml`,
  JS `@tauri-apps/plugin-dialog` in `src-ui/package.json`) and grant
  `dialog:allow-open` in `crates/muis-shell/capabilities/main.json`.
- Call `open({ directory: true, defaultPath: <active session dir> })` and
  use the returned path. Keep a prompt / inline field for the session
  *name* (or derive it from the chosen folder's basename).
- Keep a typed-path fallback behind the existing `IN_TAURI` guard so the
  browser preview and Selenium tests still work without the native dialog.
- Nice-to-have: quick-pick locations (home, active session dir) and typing
  a path manually for remote/network locations.

Open questions: one combined dialog (name + folder) vs two steps, and
whether the folder picker should also apply to changing an existing
session's directory.

### Reorder the bottom-left items

Decided (2026-10-06): the status bar's left group, in a fixed order (no
configurable segments):

`cwd → git branch → session·tab → user`

Current order is `session·tab → cwd → git → user`
(`renderStatusbar`, `src-ui/src/main.ts`, appended at `main.ts:803`).
Implementation just reorders the `statusbar.append(...)` calls and the
`marginLeft:auto` spacer that pushes the right group.

### Window/tab title should name the opencode project

Resolved (2026-10-06) — already works on `main` (1.1.x); no code change.

- opencode sets a terminal title over OSC (`OC | Muis features doc: CPU
  /RAM/GPU overlay`). muis's `OscParser` stores it in the tab's `title`
  (`observeOsc`, `src-ui/src/main.ts:551-557`), and `tabLabel()` displays a
  meaningful shell title over the last command (`commandbar.ts`,
  `isMeaningfulShellTitle`).
- The rename dialog prefills `tab.title` (`renameTab`), which is why the
  opencode title was visible there but not on the tab: the installed
  client is `veldmuis-muis 1.0.0`, older than `417b953` (shipped 1.1.0)
  that added the label rule. It appears once the client is updated.
- The maintainer's "update tab name from the opencode task" request is the
  same mechanism: opencode's OSC title already carries the task.

Decided:

- Show opencode's OSC title verbatim (no trimming, e.g. keep `OC | …`).
- Tab label only; the OS window title keeps the session name.

### Use the real muis icon in the titlebar

The top-left titlebar icon is currently a CSS gradient tile with the text
glyph `❯_` (`appIcon`, `src-ui/src/main.ts:232-234`; `.app-icon`,
`src-ui/src/style.css:51`). Replace it with the actual muis artwork.

- Assets already exist: `data/icons/hicolor/{48,64,128,256,512}/apps/muis.png`,
  the source `data/icons/muis-source.png`, and the Tauri bundle icon
  `crates/muis-shell/icons/icon.ico`.
- Frontend: swap the text glyph for an `<img>`/background image, import the
  PNG through Vite so it lands in `dist/` and the embedded frontend, and
  keep the current 22 px rounded tile dimensions. A crisp small size
  (48 or 64) avoids scaling blur in the 22 px slot.
- Also confirm the titlebar matches the frameless window: the OS taskbar
  icon is a separate Tauri bundle icon, not this element, so both should
  ideally use the same artwork.
- Open question: keep the Breeze-blue tile behind the icon as a fallback,
  or show the raw artwork edge to edge.

### Kill the session when its last tab dies

Two cases to distinguish:

- User closes the last tab: already handled — `store.closeTab` removes the
  workspace when its last tab goes (`src-ui/src/sessions.ts:84-87`, test
  `src-ui/src/sessions.test.ts:45`, merged in the close-session-on-last-tab
  branch).
- Process exit/kill: **gap**. When a pty exits, muis only marks the tab
  exited and prints `[process exited]` (`src-ui/src/main.ts:482-483`); the
  dead tab — and therefore a session whose only tab died — stays open.
  Desired: if the last tab in a session exits, tear down that session
  (dispose views, remove snapshot, switch to a neighbouring session).

Decided (2026-10-06): remove the session immediately when its last tab's
process exits — no grace state. Applies the same whether the session is
active or in the background.

### Close from the context menu (sessions and tabs)

Context menus already exist (`openCtx`, `src-ui/src/main.ts:1386-1408`):
sessions offer only "Rename session" (`main.ts:1417`), tabs offer
"Rename tab" / "Freeze title" (`main.ts:1423-1429`). Add:

- **Close session** to the session menu — dispose every tab view, kill
  each worker, remove snapshots, then `store.removeWorkspace`. Confirm
  when any tab is busy (reuse the `isTabBusy` rule from `closeTab`,
  `main.ts:573-599`).
- **Close tab** to the tab menu — the existing `closeTab(ws.id, tab.id)`
  path, which already confirms, kills, and cascades to the session.

Open questions: behaviour when the last session is closed (quit the app,
or open a fresh default session), a "Close others"/"Close all" variant,
and whether to add a hint/kbd label on the menu items.

### Drag-and-drop reorder (no detach)

Let the user drag tabs within the tab bar and sessions within the sidebar
to reorder them. Explicitly **reorder only** — dragging must not detach a
tab into a new window, spawn a split, or move a tab between sessions.

- Sessions: reorder `store.workspaces` and keep `store.current` pointing
  at the same workspace after the move (`src-ui/src/sessions.ts`).
- Tabs: reorder `ws.tabs` within the active workspace and fix `ws.active`
  to follow the dragged tab (the active-tab index, `sessions.ts:80-92`).
- UI: HTML5 drag events on `.session` / `.tab` (`main.ts:678`, `main.ts`
  tab render) with a drop-indicator line between items; reorder happens on
  drop, not during drag.
- Distinguish a drag from the existing click/select and from double-click
  rename; suppress the context menu on a drag.
- Persistence: the reordered array is what `scheduleSave` already writes,
  and restore should keep the new order.
- Tests: pure reorder helpers (index moves incl. same-index and
  last-to-first) unit-tested on both the TS store and, if mirrored, the
  Rust session model.

Decided (2026-10-06):

- Drop between items only: show an insertion line, drop is disabled while
  hovering the bar itself.
- The dragged item keeps its active/current state after the reorder.

### Single Windows exe that spawns its own worker

Ship one downloadable `muis.exe` for Windows that carries and launches
`muis-worker` (and, if needed, `muis-notify`) itself, instead of the
three-file portable zip (`docs/windows.md`).

- Embed the sidecars at build time (`include_bytes!`) and extract them on
  startup to a stable per-user dir, e.g.
  `%LOCALAPPDATA%\muis\bin\<version>\muis-worker.exe`, then resolve the
  worker from there. `worker_path`/`find_worker_in` already look next to
  the shell exe (`crates/muis-shell/src/main.rs:26-58`); the change is to
  also check the extraction dir and extract-if-missing/stale.
- Gate extraction on an embedded version marker so upgrading `muis.exe`
  refreshes the worker, and clean older `bin\<version>` dirs.
- `muis-notify` either gets extracted alongside (hooks keep working via a
  stable path) or becomes a mode of the same binary (`muis.exe --notify
  ...`), removing the second file entirely.
- Still one worker process per session (AGENTS.md) — this only changes
  how the binary reaches disk, not PTY ownership.
- CI: the `windows-portable` job builds and uploads a single exe rather
  than zipping three. Linux/Arch packaging is unaffected and keeps
  shipping separate files.

Open questions: keep the 3-file zip as a fallback artifact, whether notify
is embedded or folded into `muis.exe`, and the extraction/cleanup policy
(per-user app dir, not `%TEMP%`, to reduce AV/SmartScreen noise).

## Known issues

Bugs reported against muis. Documentation only — the implementation agent
fixes these.

### opencode TUI sometimes does not fill the terminal

**Fixed (PR #52).** The pty resize raced `spawnTab()` (the worker dropped
it, leaving the pty at the default 80x24) and a single one-shot fit missed
later layout changes; the fix refits after spawn and adds a per-terminal
`ResizeObserver`. Confirm on a real session with two opencode tabs.

Sometimes opencode's TUI does not render across the full terminal: it
draws into only part of the pane and the rest is left blank, even though
the tab is active. Seen with two opencode tabs open.

- Evidence: `docs/images/opencode-partial-terminal.png` (full-window
  screenshot, 1920x1069, opened 2026-10-04).
- Likely direction: xterm.js fit / pty-resize timing. The pty may be
  sized before the WebKit layout settles, or a background tab is not
  re-fit when it becomes active, so opencode receives stale rows/cols and
  does not repaint until the next resize. Check the fit addon and the
  resize frame sent to `muis-worker` on tab create/session restore/tab
  switch.
- Reproduce: open opencode in a tab, open a second opencode tab, switch
  between them, observe whether the pane fills.

## Proposals

Ideas worth considering, roughly grouped. None are committed.

### Sessions & tabs

- [P] `Ctrl+Shift+W` close tab and `Alt+1..9` jump to tab (parity with
  the mock; currently only `Ctrl+T` / `Ctrl+Shift+F` exist).
- [x] CWD-aware new tabs — done (new tabs inherit the active tab's cwd).
- ~~Split panes~~ — dropped; muis is one terminal per tab
  (`docs/deferred.md`).
- [P] Per-session color customization (glyphs already exist —
  `sessionGlyph`, `src-ui/src/main.ts`).

### Terminal & shell integration

- [P] Last-command bar: `✓ cmd · exit 0 · 12ms` via OSC 133 semantic
  prompt markers plus a shell hook (`docs/archive/missing-features.md` §1).
- [P] OSC 8 hyperlink handling (click to open URLs in the browser).
- [P] Sixel / iTerm2 inline-image support.
- [P] Configurable scrollback limit and instant scrollback-clear.
- [P] Terminal bell / visual bell and audible-bell config.
- [P] Copy-on-select and middle-click paste modes.
- [P] Custom keybindings loaded from config.

### Search

- [P] Cross-session search results panel with scope buttons
  (Everywhere / Session / Tab), match count, and click-to-jump
  (`docs/archive/missing-features.md` §2).
- [P] In-terminal regex search and case-sensitivity toggle.
- [P] Search history.

### Appearance & config

- [P] Multiple color themes with a `theme` command and persistence
  (`docs/archive/missing-features.md` §4).
- [P] Configurable statusbar segments (show/hide each pill).
- [P] Font family picker, ligatures toggle, cursor style/blink.
- [P] Background opacity/transparency where the compositor allows it.
- [P] Per-workspace themes.

### Notifications & agents

- [P] Notification click focuses the originating tab (deep link back).
- [P] Per-tab agent status indicator (idle / working / done).
- [P] Desktop notification grouping for long agent runs.

### Window & platform

- [~] Context menus for sessions/tabs — rename/freeze already exist;
  adding Close is a maintainer request above.
- [P] Window title `● (n) done` count (`docs/archive/missing-features.md` §6).
- ~~Export / import whole session state as JSON~~ — dropped; mock-only,
  not wanted (`docs/deferred.md`).
- ~~Windows per-user installer~~ — deferred; portable zip stays the
  supported artifact (`docs/windows.md`, `docs/deferred.md`).
- [P] Tabs-on-top setting actually wired up (`tabsOnTop` is currently a
  dead config field).

### System & integration

- [P] "Open with muis here" file-manager action on Veldmuis.
- [P] `muis` CLI flags: `--cwd`, `--command`, `--new-tab`.
- [P] Restore-on-login / systemd user unit for Veldmuis packaging.
- [P] Command palette (`Ctrl+Shift+P`) over all actions.

## Already beyond the design mock

Real PTY per session, OSC 7/0/2 cwd+title tracking, scrollback
snapshots, git branch in the statusbar, settings dialog, busy/quit
confirmations, and the side-panel slot. Full list in
`docs/archive/missing-features.md` → "muis has beyond the mock".
