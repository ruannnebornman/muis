# Notification endpoint — plan

Goal: make muis a first-class notification target for terminal agents and
console tools, so a task that finishes while you are in another tab or app
reaches you. One terminal-side endpoint, three ways for apps to use it:

1. **OSC escape sequences** (automatic, no app config beyond a channel
   setting) — OSC 9, OSC 777, OSC 99.
2. **`muis notify` command / local endpoint** for tools that only support
   a hook command (OpenCode, Aider, Claude hooks, Codex `notify`).
3. **Built-in finish detection** for tools that cooperate with nothing.

This is the same shape as WezTerm (`wezterm cli set-tab-title`) and cmux
(`cmux notify`): a protocol layer for tools that speak escapes, plus a
command endpoint for tools that do not. The existing wezterm-only wiring
stays out of muis; muis owns the endpoint itself.

## Background: what the tools expect today

| Tool | Terminal endpoint? | Detail |
|---|---|---|
| Codex | native | `tui.notification_method = auto\|osc9\|bel` (default `auto`, prefers **OSC 9**, falls back to BEL); `tui.notification_condition = unfocused\|always`; optional external `notify = [...]` |
| Claude Code | partial | `preferredNotifChannel = auto\|iterm2\|terminal_bell\|iterm2_with_bell\|kitty\|ghostty\|notifications_disabled`; `auto` only emits escapes in iTerm2/Ghostty/Kitty (OSC 9, kitty also OSC 99), elsewhere silent until set to `terminal_bell`; also a `Notification`/`Stop` hook |
| OpenCode | none | plugin/hook event API only; community plugins already target a terminal CLI (`cmux notify`) and fall back to `notify-send` |
| Aider | none | `--notifications` uses `notify-send`/`zenity`/bell or `--notifications-command "<cmd>"` |
| Warp/foot/Ghostty/WezTerm/iTerm2/Kitty | native | OSC 9 and/or OSC 777, Kitty also OSC 99. VTE stack (GNOME Terminal, Tilix) mostly BEL only. tmux needs `allow-passthrough on`. |

Protocols (no single standard; implement the de-facto set):

- **OSC 9** — `ESC ] 9 ; message BEL`. iTerm2 origin; widest support.
  ConEmu overloads `9;N` (progress, cwd) — a leading all-digit field is
  not a notification.
- **OSC 777** — `ESC ] 777 ; notify ; title ; body BEL`. rxvt-unicode
  origin; Ghostty/WezTerm/foot/Warp. Other `777;` subtypes are not
  notifications (new Konsole uses 777 for container metadata).
- **OSC 99** — kitty rich protocol: chunked `title`/`body`, `i` id,
  `d` done flag, `e` base64, `u` urgency, `w` when, `p=?` capability
  query. Best UX; Kitty/iTerm2/Ghostty/VSCode/Warp/Cursor.
- **BEL** — universal fallback; lower tier signal.

Focus policy: Codex defaults to notify only when `unfocused`; OSC 99 has
`w=`. muis should suppress the OS toast when the tab/window is already
focused, but always update the in-app tab badge/done state.

## Phases

Each phase is independently testable, mergeable, and leaves the app green.
`[ ]` todo · `[~]` in progress · `[x]` done+locked by tests.

### Phase 1 — Parse OSC 9 / OSC 777 notification events `[x]`

- Extend the streaming observer so `OscParser.push()` also emits
  `{ type: "notify", title, body, source }` for OSC 9 and OSC 777.
- Ignore ConEmu numeric OSC 9 subcommands and non-`notify` OSC 777.
- No UI wiring yet: pure protocol layer in `src-ui/src/osc.ts`.
- **Test:** `src-ui/src/osc.test.ts` — OSC 9 BEL/ST, OSC 777 title+body,
  body-with-semicolons, ConEmu/other-subtype ignores, split chunks.
- **Verify:** `npm test --prefix src-ui`.

### Phase 2 — OSC 99 rich protocol `[ ]`

- Add OSC 99 with metadata parsing (`i`, `d`, `e`, `u`, `p`) and chunk
  reassembly: title/body chunks joined by id, base64 `e=1`, urgency.
- Cap payload growth; drop incomplete trains safely.
- **Test:** `osc.test.ts` / new `notify.test.ts` — two-chunk title+body,
  base64, out-of-order ids, oversized payload, non-99 passthrough.
- **Verify:** `npm test --prefix src-ui`.

### Phase 3 — Notification router + in-app surface `[ ]`

- Pure `NotificationRouter`: dedupe, per-tab routing, focus-aware
  suppress, urgency, `done` badge integration (reuse `DoneTracker`).
- Wire into `observeOsc`: toast + tab badge; window title done count
  already exists.
- **Test:** router unit tests (fake clock/focus); browser e2e asserts the
  toast/badge appear for a fake OSC 9 injected into the preview.
- **Verify:** `npm test --prefix src-ui`, `npm test --prefix tests/e2e`.

### Phase 4 — Desktop/OS notification delivery `[ ]`

- Tauri command that posts to the freedesktop
  `org.freedesktop.Notifications` service on Linux and a Windows toast on
  Windows; frontend calls it only when the window/tab is unfocused.
- Click focuses the originating tab/window.
- **Test:** Rust unit for payload/escape-sanitizing; frontend test with a
  faked invoke; native Xvfb smoke asserts a toast is attempted.
- **Verify:** `cargo test --workspace --locked`, `npm test`,
  `tests/e2e/live-x11.sh`.

### Phase 5 — `muis notify` command endpoint + env contract `[ ]`

- A CLI/IPC entry (`muis notify --title T --body B [--urgency U]`) that
  routes to the right tab, plus pty env `TERM_PROGRAM=muis`,
  `MUIS_PANE`, `MUIS_SOCKET` so tools can auto-detect and target muis.
- **Test:** Rust IPC roundtrip in the shared fixture
  (`tests/fixtures/ipc-frames.jsonl`) tested from Rust and TS; socket
  routing test.
- **Verify:** `cargo test --workspace --locked`, `npm test`.

### Phase 6 — Agent integrations + docs `[ ]`

- Ship copy-paste configs: OpenCode plugin, Claude `Notification` hook,
  Codex `notify`, Aider `--notifications-command`, and the
  `preferredNotifChannel` note for Claude/Codex OSC 9.
- Document in `docs/notifications.md` (usage section) + README pointer.
- **Test:** a scripted preview that emits each protocol and shows the
  toast; docs commands exercised in CI where cheap.
- **Verify:** `npm test --prefix tests/e2e`, manual on Veldmuis.

### Phase 7 — Built-in long-command finish detection `[ ]`

- Reuse OSC 133 `cmd-end` + busy tracking: if a foreground command ran
  longer than a threshold and finished while unfocused, notify — covers
  every console app, agent or not. Optional process-name filter.
- **Test:** pure timing/policy unit tests with fake clock.
- **Verify:** `npm test --prefix src-ui`.

## Verification gates per phase

- UI phases: `npm test --prefix src-ui` and `npm run build --prefix src-ui`
  (tsc) green.
- Rust-touching phases: `cargo test --workspace --locked` green.
- Integration phases: Selenium browser suite and/or native Xvfb smoke.
- PR stays on a neutral branch; base `main`; CI must pass before review.
