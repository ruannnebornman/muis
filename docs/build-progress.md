# muis build progress

Autonomous build log. Each step: what changed, how it was verified.
Scaffold (steps 0) already done: Rust core/worker/shell + xterm UI,
Wayland dmabuf workaround, Tauri event capability, fit polling.

## Step 1 — Session persistence + restore (metadata + scrollback snapshots)
STATUS: done
- Shell: sessions_load/save, config_load/save, snapshot_store/read/remove
  (crates/muis-shell/src/persist.rs + commands). JSON validated before
  write; snapshot paths sanitized; missing files read empty.
- Worker: unchanged (Snapshot frames already existed).
- UI: SessionStore.toJSON/fromJSON with id-counter continuity, debounced
  save on every render, 30s snapshot loop, one-time scrollback replay per
  tab on restore, snapshot cleanup on tab close.
- Verified: cargo 26 + vitest 18 green; live: session file written with
  stable ids, tab-t2.scrollback holds real fish output (incl. OSC 7 cwd
  + OSC 0 title sequences — Step 5 will parse these); crafted 2-workspace
  file restored correctly (veldmuis session selected, dev+agents tabs,
  `veldmuis ›` prompt in restored cwd), confirmed via screenshot.

## Step 2 — Search UI find bar
STATUS: done
- New SearchController (src-ui/src/search.ts) over an adapter interface,
  bound to the active tab's real SearchAddon; find bar overlay in the
  terminal surface (input + prev/next/close, Enter/Shift+Enter/Esc,
  Ctrl+Shift+F toggles). Replaces the old prompt() placeholder.
- Verified: vitest 22 green (4 new controller tests), vite build clean,
  WebKit probe confirms .findbar present/hidden with 1 input + 3 buttons.

## Step 3 — Settings dialog + AppConfig wiring
STATUS: done
- AppConfig TS mirror with per-field fallback (config.ts + 5 tests);
  dialog (Ctrl+,) with sessions toggle, tabs-on-top, font size; applies
  live to all terminals, persists via config_load/save; sessions-hidden
  mode reuses the top tab row.
- Verified: vitest 27 green, cargo 26 green, vite+shell build clean,
  app relaunched running (config file correctly absent until Save).

## Step 4 — Dirty-tab + quit confirm
STATUS: done
- activity.ts: busy = pty alive and (younger than 60s or output within
  60s); exited tabs never busy; forget on close. 3 unit tests.
- closeTab confirms via native dialog when busy; beforeunload guards
  quitting with busy tabs (WebKit's own dialog).
- Verified: vitest 30 green, cargo 26 green, builds clean, app running.
  Dialogs use native UI (logic unit-tested; visual is platform chrome).

## Step 5 — CWD/title tracking (OSC 7/0/2)
STATUS: done
- osc.ts: streaming OSC observer (chunk-split reassembly, BEL/ST terms,
  file://host strip, percent-decode, query ignore). 6 unit tests.
- Tabs track `cd` via OSC 7 (cwd saved → restored); OSC 0/2 titles apply
  only to placeholder tabs (isDefaultTitle, tested) so user names like
  "dev"/"agents" survive. Fish on Veldmuis emits both with zero config;
  README documents a bash OSC 7 hook for other shells.
- Verified: vitest 37 green; live screenshot showed tracking working
  (tabs followed fish, then policy tightened); session file reset to the
  genuine first-run state afterwards; app relaunched running.

## Step 6 — Snor side-panel slot API
STATUS: done
- SidePanelRegistry (register/toggle/single-visible/unregister) with
  2 unit tests; docked right-side slot in main.ts (invisible until a
  panel registers) + panelContent() host for future panel code; mock
  variables styling. Engine itself stays parked per roadmap.
- Verified: vitest 39 green, cargo 26 green, builds clean, app running
  (no visual change expected — nothing registered).

## Step 7 — Windows portable packaging config + CI workflow
STATUS: done
- docs/packaging-windows.md: portable zip recipe (two exes, WebView2
  note, %APPDATA% state, per-user installer deferred to a Windows box).
- .github/workflows/ci.yml: rust (cargo test --locked with WebKit
  deps), ui (npm test+build), windows-portable (release build + zip
  artifact). YAML validated; the exact rust/CI commands re-run green
  locally. Cargo.lock un-ignored so --locked works in CI.
- Not verifiable here: actual Windows build/run, NSIS installer.

## Step 8 — Final full verification + docs
STATUS: done
- README: Use section (shortcuts, persistence paths, OSC note).
  ROADMAP v2: settled list extended, stale Qt-era tail removed, honest
  [~]/[ ] remainder (Snor engine, Windows installer HW check, CI first
  run, Veldmuis packaging side).
- Final: cargo 26 + vitest 39 green, vite+shell builds clean, embedded
  dist hash verified in binary, app relaunched: mock-mirror chrome,
  fish prompt, OSC auto-title (`~`), debug snapshot phoned home.
- Left running for review: branch feature/rust-tauri, uncommitted.
  Decisions needing you: Windows machine test, first push CI watch,
  commit/PR when ready.

## Totals
- cargo --workspace: 26 passed (16 core, 7 shell, 3 worker e2e)
- src-ui vitest: 39 passed across 9 files
- Screenshots: headless Chromium, WebKit probe, and 8 desktop captures
  drove 4 real fixes (xterm CSS, Tauri event capability, fit polling,
  dmabuf/NVIDIA workaround).

## Re-theme to wezterm-web (2026-09-26, user: "look like index.html")
STATUS: done
- style.css ported to the Breeze design system (verbatim tokens +
  titlebar/sidebar/tabbar/statusbar rules, mock class names kept);
  theme.ts + tests re-locked to the new palette; colorFor() name hashing
  ported with test.
- Custom titlebar (decorations:false, drag region, live search box bound
  to the active tab's SearchAddon, min/max/close via window API);
  overlay findbar removed in favor of titlebar search.
- Sidebar: 248px sessions, per-name color tiles, tab-count/path subs,
  done badges, + session button. Tabbar: dots, done states, dblclick
  rename, + button. Statusbar: session/tab pill, live cwd, git branch
  (new shell command), user@host (new sys_info), clock, shell pill.
- Shell: git_branch, sys_info (+2 tests); capabilities extended with
  window minimize/toggle-maximize/close (validated by build).
- Verified: cargo 26 + vitest 39 green, builds clean, embedded hash
  checked, app running with frameless window; screenshot confirms
  titlebar/search/controls, sidebar tile, browser tab, statusbar pills,
  live fish prompt. Side-tabs mode removed (no equivalent in target).

## Bugfix: escape-sequence garbage on restore/switch (2026-09-26)
STATUS: done
- Symptom: terminal top rows full of `^[[?1;2c`, `^[]11;rgb:...` text.
- Root cause: fish's terminal queries during init were answered by
  xterm through onData->worker->master, and the pty's default ECHO
  looped the replies back into the output stream (xterm can't parse
  its own replies, so they printed). Snapshot files captured it, so
  every restore replayed the garbage.
- Fix: worker clears ECHO via tcsetattr on the master fd at spawn
  (nix termios; fish sets its own discipline right after). Old
  snapshots deleted once (they regenerate clean).
- Test: spawned_shell_runs_with_echo_off (stty -a shows -echo).
- Verified: cargo 27 green, fresh launch shows clean `kaazrot ›`
  prompt, screenshot confirmed.

## Bugfix: active tab never highlighted (2026-09-26)
STATUS: done
- Root cause: tabElement rendered class `tab selected` but the ported
  mock CSS only styles `.tab.active` (leftover from the old Muis Dark
  mock, where the class WAS `selected`). Sessions used `active`, which
  is why they lit up and tabs didn't.
- Fix: one-line class rename to `active`.
- Verified: screenshot shows the blue top border on the active tab.

## Headless native testing + keyboard-only focus (2026-09-26)
STATUS: done
- User identified multi-monitor coordinate mismatch (muis on the right
  Samsung, test pointer on the LG). Removed all pointer positioning from
  live testing.
- Added Ctrl+Shift+J to focus the active terminal; Selenium browser test
  verifies it focuses xterm and types without clicking.
- Added `tests/e2e/live-x11.sh`: launches the real Tauri/WebKit app in
  Xvfb with isolated XDG state, uses xdotool keyboard only, checks a
  unique marker in a real PTY snapshot, rejects old echoed query garbage,
  and captures a screenshot artifact.
- CI workflow now has separate headless Selenium and native-Xvfb jobs.
  Browser suite passes 8/8, Vitest 39/39, Cargo 29/29; syntax/YAML
  checks pass.
- Installed Xvfb and xdotool test dependencies, then locally ran the
  native Xvfb test successfully without controlling any physical screen:
  `PASS: keyboard-only native Tauri PTY smoke`; screenshot at
  `tests/e2e/artifacts/live-x11/run.8XiQvs/screenshot.png`.
- Screenshot shows the real fish welcome/prompt and the unique echo
  marker. The test also verified the marker in the worker's saved PTY
  snapshot and that old echoed terminal-query garbage was absent.

## Live visual/input test harness
- STATUS: done
- `tests/e2e/muis.test.mjs`: Selenium tests for the browser preview;
  passes 8/8, including Ctrl+Shift+J focus and input without clicking.
- `tests/e2e/live.mjs`: launches native Tauri muis with isolated XDG
  config/state, activates via KWin, focuses xterm via Ctrl+Shift+J,
  types a unique `echo` marker, waits for real-PTY snapshot, checks for
  the old query garbage, and captures a desktop screenshot. It no longer
  uses pointer coordinates; the Xvfb runner is the verified repeatable
  CI path, while this KWin helper is an optional local Wayland route.
- Verified after final UI build: Cargo 29, Vitest 39, Selenium 8, live
  native Xvfb PTY smoke pass; CI YAML and runner syntax checks pass.

## Regression: only one terminal surface across session/tab switches
STATUS: done
- User screenshot showed two terminal prompts side by side after
  switching sessions. Root cause: `renderTerms()` only toggled active
  state for tabs in the newly selected workspace; the previously active
  workspace's xterm box stayed `.active` in the shared terminal host.
- Fix: on every terminal render, remove `.active` from all surviving
  terminal boxes first, then activate only the selected workspace's
  active tab. Background shells/PTYs remain alive but their view is hidden.
- Selenium regression creates a second session, switches sessions and
  tabs repeatedly, and asserts exactly one `.active` and one visible
  `.tabbox` at every transition.
- Verified: Selenium 8/8; screenshot
  `/tmp/opencode/muis-split-e2e/09-09-session-switches-one-terminal.png`
  shows only the selected session's terminal. Cargo 29, Vitest 39,
  Xvfb native PTY smoke pass; `git diff --check` clean.
