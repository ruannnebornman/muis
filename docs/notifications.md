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

## `muis-notify` usage

Hook-only tools call the CLI; OSC-speaking tools need nothing.

```sh
muis-notify --body "done"                     # inside muis: targets this tab
muis-notify --title "Aider" --body "ready"    # explicit title
aider --notifications-command "muis-notify --title Aider --body 'ready'"
# Claude Code Notification hook / Codex notify = ["muis-notify", "--body", "done"]
```

`--socket` and `--tab` default to `MUIS_SOCKET` and `MUIS_TAB_ID`, which
muis injects into every pty.

## Agent configs

Copy-paste setups. All of them rely on `MUIS_TAB_ID`/`MUIS_SOCKET` being
present in the pty, so `muis-notify` targets the current tab with no extra
flags.

### Codex CLI

`~/.codex/config.toml` (root-level keys must come before any `[table]`):

```toml
notify = ["muis-notify", "--body", "Codex turn complete"]

[tui]
notification_method = "osc9"
```

Codex appends its event JSON as an extra positional argument; `muis-notify`
ignores positionals, so the line above works as written.
`notification_method = "osc9"` also makes the built-in TUI path emit OSC 9,
which muis parses directly.

### Claude Code

`~/.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [
      { "hooks": [ { "type": "command", "command": "muis-notify --title 'Claude Code' --body 'needs attention'" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "muis-notify --title 'Claude Code' --body 'done'" } ] }
    ]
  }
}
```

Alternatively, set `"preferredNotifChannel": "iterm2"` to make Claude Code
emit OSC 9 (muis parses it) instead of using hooks — its `auto` channel
stays silent in terminals it does not recognize, and muis is not on that
list.

### Aider

```sh
aider --notifications --notifications-command "muis-notify --title Aider --body ready"
```

Or in `.aider.conf.yml`:

```yaml
notifications: true
notifications-command: "muis-notify --title Aider --body ready"
```

### OpenCode

`~/.config/opencode/plugin/notification.ts`:

```ts
export const MuisNotify = async ({ $ }) => ({
  event: async ({ event }) => {
    if (event.type === "session.idle") {
      await $`muis-notify --title opencode --body "session idle"`;
    }
  },
});
```

`session.idle` is deprecated in favour of `session.status` but still
emitted; switch the condition when the replacement lands.

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

### Phase 2 — OSC 99 rich protocol `[x]`

- Add OSC 99 with metadata parsing (`i`, `d`, `e`, `u`, `p`) and chunk
  reassembly: title/body chunks joined by id, base64 `e=1`, urgency.
- Cap payload growth; drop incomplete trains safely.
- Deferred: responding to the `p=?` capability query (needs a pty write
  path; it is detected and ignored for now, so OSC 99 senders fall back).
- **Test:** `osc.test.ts` / new `notify.test.ts` — two-chunk title+body,
  base64, out-of-order ids, oversized payload, non-99 passthrough.
- **Verify:** `npm test --prefix src-ui`.

### Phase 3 — Notification router + in-app surface `[x]`

- `src-ui/src/notify.ts`: pure `NotifyRouter` — per-tab dedupe within a
  short window, and "badge the tab when the user was not looking at it".
- Wire `notify` events in `observeOsc` into the existing attention
  surface (tab done badge, pulsing session dot, window-title count)
  instead of inventing new chrome — the design target
  (`wezterm-web/index.html`) defines no in-app toast.
- **Test:** `notify.test.ts` (visibility, dedupe window, source/content/
  tab identity, forget); chrome behavior is covered by the browser e2e.
- **Verify:** `npm test --prefix src-ui`, `npm run build --prefix src-ui`.

### Phase 4 — Desktop/OS notification delivery `[x]`

- `tauri-plugin-notification` (Rust dep + `notification:default`
  capability + `@tauri-apps/plugin-notification`), registered in
  `muis-shell`. Linux uses the freedesktop D-Bus service; Windows uses a
  toast.
- Frontend tracks window focus (`isFocused` + `onFocusChanged`) and fires
  a toast only while unfocused, so it never duplicates the in-app badge.
  Title falls back to the originating tab's title when the protocol only
  carried a body (OSC 9).
- Deferred: click-to-focus from the toast (the plugin's action support is
  platform-limited).
- **Test:** `notify.test.ts` covers the focus gate; Rust build validates
  the capability. Delivery itself is platform chrome (manual/e2e).
- **Verify:** `npm test --prefix src-ui`, `npm run build --prefix src-ui`,
  `cargo test --workspace --locked`.

### Phase 5 — `muis notify` command endpoint + env contract `[x]`

- New `muis-notify` binary (separate, console-subsystem) sends one JSON
  request over a local socket: unix abstract socket on Linux, named pipe
  on Windows (via `interprocess`), so there is no stale socket file.
- The shell serves the socket and forwards each request to the frontend
  as a `muis-notify` event; the frontend routes it to the originating tab
  through the same `NotifyRouter` as OSC notifications.
- Env contract: ptys get `TERM_PROGRAM=muis`, `MUIS_TAB_ID` (the tab id),
  and `MUIS_SOCKET` (inherited from the worker), so `muis-notify --body
  "done"` from inside a muis terminal targets the right tab with no args.
- Flatpak note: the socket lives in the sandbox, so host-side
  `muis-notify` cannot reach it; OSC still works there.
- **Test:** `muis-core::notify` serve/send roundtrip + request JSON;
  `muis-notify` arg parsing; worker `shell_argv` env forwarding (native
  and Flatpak); frontend `notifyEventFromCli` mapping.
- **Verify:** `cargo test --workspace --locked`, `npm test --prefix src-ui`.

### Phase 6 — Agent integrations + docs `[x]`

- Shipped copy-paste configs in the "Agent configs" section above: Codex
  CLI, Claude Code hooks, Aider, and an OpenCode plugin, plus the
  `preferredNotifChannel` OSC 9 note.
- `muis-notify` now ignores Codex's positional event JSON so
  `notify = ["muis-notify", "--body", ...]` works as written.
- README already points at this doc.
- **Test:** the native Xvfb smoke emits OSC 9/777/99 into the real PTY and
  asserts each reaches the frontend (`notify-received` debug stage).
- **Verify:** `bash tests/e2e/live-x11.sh`, `cargo test --workspace --locked`.

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
