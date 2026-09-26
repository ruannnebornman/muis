# muis

muis is the terminal emulator for Veldmuis: Rust backend, xterm.js
frontend, Tauri native window. One codebase ships as the Arch system
package (Veldmuis default) and as a no-admin portable for Windows.

Chrome follows `../wezterm-web/index.html` (Breeze titlebar, sessions
sidebar, tabbar, statusbar). `design/mock.html` is superseded. VT
emulation is xterm.js, not ours.

## Layout

```text
crates/muis-core/    session model, config, shell probe, UI/worker IPC (no UI deps)
crates/muis-worker/  muis-worker binary: one process per session, pty via portable-pty
crates/muis-shell/   muis binary: Tauri 2 window (WebKitGTK on Linux, WebView2 on Windows)
src-ui/              TypeScript + xterm.js frontend (Vite)
tests/fixtures/      shared UI/worker IPC contract both sides test against
docs/                architecture notes, target mockup
design/mock.html     superseded Muis Dark mock (kept for history)
```

## Build

Needs Rust (rustup) and Node. From the repo root:

```sh
cargo build
cargo test --workspace
```

UI:

```sh
cd src-ui
npm install
npm test        # vitest: theme lock, session model, IPC fixture
npm run build   # tsc + vite -> dist/ (embedded by the Tauri shell)
```

Dev window (needs system WebKit):

```sh
cargo run -p muis-shell
```

## Use

- Ctrl+T new tab, × button closes (confirms when a process is busy),
  Ctrl+Shift+F12 focuses the terminal, Ctrl+Shift+F search, Ctrl+, settings.
- Sessions persist across restarts with scrollback snapshots
  (`~/.local/share/muis`, `%APPDATA%\muis` on Windows).
- Tabs track `cd` via OSC 7; fish on Veldmuis needs no setup.
- Quitting with busy tabs asks first.

## Tests

- `cargo test --workspace`: session switching/restore roundtrips,
  config load/save, shell probe, IPC roundtrips + shared fixture,
  and a live `muis-worker` stdio roundtrip (real pty, echo, snapshot,
  exit code 42).
- `npm test` in `src-ui`: theme values locked to the target HTML, session
  store behavior, same IPC fixture from the TS side.
- Selenium preview interaction tests (headless Chrome): build the UI,
  start `python3 -m http.server 4173 --directory src-ui/dist`, then run
  `MUIS_URL=http://127.0.0.1:4173 npm test --prefix tests/e2e`.
- Native no-desktop smoke test (real Tauri + WebKit + PTY): install
  Xvfb, xauth, and ImageMagick, then run:

  ```sh
  npm ci --prefix src-ui
  npm run build --prefix src-ui
  cargo build --locked -p muis-shell -p muis-worker
  npm ci --prefix tests/e2e
  npm run test:live:x11 --prefix tests/e2e
  ```

  A debug-only test hook sends a unique command through the UI/worker
  bridge. The test checks its real PTY snapshot and writes a screenshot
  artifact under `tests/e2e/artifacts/live-x11/`.
- CI runs all three layers: Rust/PTY, Selenium browser interactions,
  and native Tauri PTY smoke under Xvfb. The Xvfb test uses the same
  terminal-focus shortcut, not monitor coordinates.

## Shell integration (cwd + titles)

Fish on Veldmuis already reports cwd (OSC 7) and titles (OSC 0), so
tabs track `cd` with no setup. Other shells need a prompt hook, e.g.
bash:

```sh
muis_osc7() { printf '\e]7;file://%s%s\e\\' "$HOSTNAME" "$PWD"; }
PROMPT_COMMAND="muis_osc7${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
```

## Windows portable

Zip ships `muis.exe + muis-worker.exe` (per-user, no admin, uses the
built-in WebView2). Same binaries, same protocol, shells probed as
pwsh → powershell → cmd.
