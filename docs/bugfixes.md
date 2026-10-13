# muis bugfixes

Reported bugs and small fixes. Documentation only — the implementation
agent fixes these. Feature requests live in `docs/features.md`, parked
work in `docs/deferred.md`, and the settled state in `ROADMAP.md`.

## Date/time in the status bar needs refinement

**Done** — the clock now reads `04 Oct 2026 14:23` (day-month-year, no
seconds, fixed width). PR #63.

The bottom-right clock pill renders `Sun 2026-10-04 14:23:05`
(`clockText`, `src-ui/src/clock.ts:12`). Refine the presentation:

- Seconds tick noisily and steal attention; drop them, or make the
  format configurable.
- Reconsider order/locale (`Sun 2026-10-04` vs `04 Oct 2026`).
- Check pill width/alignment so it does not jump when the date rolls
  over at midnight or the day name length changes.
- Confirm spacing with the CPU/RAM/GPU and version pills in the right
  statusbar group (`src-ui/src/main.ts:1032-1037`).

## Clicking a tab or session should focus the terminal

**Done** — selecting a tab or session focuses its terminal, so typing
works immediately. Skips reorder drags and an in-use search box
(`shouldFocusTerminal`, `src-ui/src/focus.ts`). In the `fix/bugfixes`
batch.

Selecting a tab or session changes the visible surface but leaves
keyboard focus where it was, so typing does not reach the terminal until
the user clicks the terminal itself. Desired: selecting a tab/session
focuses its terminal so the user can type immediately.

- Tab click sets `ws.active` and calls `renderAll()` with no focus call
  (`tabElement`, `src-ui/src/main.ts:989`).
- Session click switches the workspace the same way (`sessionElement`,
  `src-ui/src/main.ts:898`).
- Reuse the existing `focus-terminal` path, which focuses the active
  view's `term` (`src-ui/src/main.ts:1223-1226`); the active tab is the
  view marked `active` in `renderTerms` (`src-ui/src/main.ts:1018-1023`).
- Do not steal focus on a drag (reorder) or double-click (rename), and
  do not fight the search box while it is open.

## Closing the last tab should keep the session open

**Done** — closing the last tab keeps the session open with no tabs,
showing only the `+`/`AI` buttons. `closeTab` no longer removes the
workspace, `renderAll` no longer force-creates a terminal, and a new
session opens its tab explicitly (`src-ui/src/main.ts`,
`src-ui/src/sessions.ts`, mirrored in `crates/muis-core/src/session.rs`).
Process exit still tears the session down. In the `fix/bugfixes` batch.

Closing a session's last tab currently tears the whole session down
(`SessionStore.closeTab`, `src-ui/src/sessions.ts:132-134`, reached from
`closeTab`, `src-ui/src/main.ts:649`). Desired: closing the last tab
leaves the session open with no tabs, showing only the `+` (and `AI`)
tab buttons, so the session — its name, directory, and place in the
sidebar — survives for later even when there is no active work.

- Empty state: the tab bar already renders `+`/`AI` unconditionally
  (`renderTabs`, `src-ui/src/main.ts:911-929`), so once the session is
  kept the bar shows just the buttons; confirm the terminal area renders
  no stale surface when `ws.tabs` is empty (`renderTerms`,
  `src-ui/src/main.ts:1002-1024`).
- Session stays current: do not remove the workspace, so it remains in
  the sidebar and reads `0 tabs`.
- A new tab from an empty session seeds from `ws.dir`, since there is no
  active tab to inherit a cwd from (`newTabCwd`,
  `src-ui/src/sessions.ts:39-41`).
- Persistence: `SessionStore.toJSON`/`fromJSON` already round-trip an
  empty-tab workspace, so a kept session must survive restart.
- Distinguish from process exit: the decided behavior in
  `docs/features.md` ("Kill the session when its last tab dies") still
  tears a session down when its last tab's *process exits*
  (`dropSessionIfLastTab`, `src-ui/src/main.ts:685-706`). This request
  is about the user closing the tab. Whether a pty exit should also
  preserve the empty session is open, and this reverses the
  `closeTab` half of that decision.

## Reorder the bottom-right statusbar items

**Done** — the right group now reads `CPU, RAM, GPU, UTF-8 · <shell>,
version, clock`. See the "Statusbar pills double-line" fix below (same
commit, `fix/bugfixes`) for the empty-load-pill cleanup.

The right-side group should read, left to right: CPU/RAM/GPU, then the
`UTF-8 · <shell>` pill, then the muis version, then the clock at the far
right (most right).

- Current order is `CPU, RAM, GPU, version, clock, UTF-8·shell`
  (`statusbar.append`, `src-ui/src/main.ts:1039-1051`): the shell pill
  currently trails the clock.
- Desired: `CPU, RAM, GPU, UTF-8·shell, version, clock`.
- Purely reorder the `statusbar.append(...)` arguments; no rendering
  logic changes. The `marginLeft:auto` spacer (index 4,
  `src-ui/src/main.ts:1052`) stays unless the left group changes.
- Complements the bottom-left reorder already decided in
  `docs/features.md`.

## Middle-click a tab should close it

**Done** — middle-clicking a tab closes it via the same `closeTab` path as
the `✕` button (busy confirmation and last-tab handling included), using an
`auxclick` (button 1) handler so the select/reorder handlers are untouched
(`src-ui/src/main.ts`).

Middle-clicking a tab should do the same as clicking its `✕` close
button.

- The `✕` handler calls `closeTab(ws.id, tab.id)` (`tabElement`,
  `src-ui/src/main.ts:983-988`).
- Add a middle-button handler on the tab element (`auxclick` with
  `button === 1`, or `mousedown`) that runs the same `closeTab` path,
  including the busy confirmation and last-tab handling.
- Middle-click is `mousedown`/`auxclick`, not `click`, so it does not
  fire the tab's select handler or the reorder drag; make sure neither
  is triggered and that the tab's context menu is suppressed.
- The gesture is on the tab element only; xterm's own middle-click
  paste inside the terminal surface is unaffected.

## Settings button and search icon are too small

**Done** — the settings gear is now `font-size:30px` (~5x area) and the
search glyph 20px (matching the mock), via `.newtab.settings` and a new
`.search-glyph` class (`src-ui/src/style.css`, `src-ui/src/main.ts`).

Two chrome controls are hard to see/hit:

- **Settings button** — the `⚙` button to the right of the tabbar
  `+`/`AI` buttons (`el("button", "newtab settings", "⚙")`, from the
  settings/tab-move work). Make it roughly 5x its current size.
- **Search icon** — the `⌕` glyph at the left of the titlebar search box
  (`searchGlyph`, `src-ui/src/main.ts:270-271`). Make it bigger.

Both are sized by CSS: the gear by `.newtab.settings{font-size:14px}`
and the search glyph by `.search` (`font-size:12.5px`,
`src-ui/src/style.css:54-58`). Bump those and confirm the titlebar
(42px, `src-ui/src/style.css:38`) still fits without the controls
overflowing.

## CI pipeline is too slow

CI builds take too long; investigate and speed them up
(`.github/workflows/ci.yml`). Candidate directions:

- Five jobs (`rust`, `ui`, `browser-e2e`, `native-xvfb`, `windows`) each
  reinstall Tauri system deps and re-run `npm ci` / `npm run build`.
  Share the built frontend via an artifact, or drop jobs that duplicate
  a build.
- Rust has no `Swatinem/rust-cache` (only the npm cache is configured);
  add a Rust cache and check the `--locked` workspace test time.
- The `native-xvfb` job builds Rust + the UI and installs Xvfb/xauth/
  ImageMagick; see if it can reuse a cached build or only run on relevant
  paths.
- Consider path filters so docs-only PRs skip the heavy jobs.
- Measure first: capture per-job and per-step timings from a recent run
  to target the real bottleneck rather than guessing.

## Settings menu looks bad

The settings dialog looks unpolished and needs a visual pass
(`settingsOverlay`/`settingsBox`, `src-ui/src/main.ts:1268-1321`). The
current styling is a bare centered box with label/control rows and two
accent buttons (`src-ui/src/style.css:149-156`).

- Bring it in line with the Breeze chrome and
  `docs/target-mockup.png` instead of the plain modal.
- Improve spacing, row separation, section grouping/labels, and the
  Save/Cancel buttons (including hover/active/focus states).
- Recheck sizing (`min-width:300px`), overlay contrast, and overall
  balance with the rest of the UI.

## Remove the fish message on new terminals

Every new terminal spawned with fish prints fish's greeting banner
("Welcome to fish, the friendly interactive shell"), which is noise in a
tab that should start clean. Suppress it.

- muis spawns fish interactively with only the OSC 133 integration flag
  (`shell_argv`, `crates/muis-worker/src/main.rs:111-122`; integration
  constant at `main.rs:20`).
- Add fish's `-g`/`--no-greeting` flag alongside the existing
  `-C <integration>` so the greeting is not printed.
- Update the `shell_argv_adds_fish_integration` expectation
  (`crates/muis-worker/src/main.rs:473-492`).
- Fish only; other shells are unchanged.

## The "＋ session" popup is bad

Clicking `＋ session` (`renderSessions`, `src-ui/src/main.ts:1506`) fires a
sequence of blocking native popups: `window.prompt("Session name:", …)`
and then a directory chooser — the native folder picker inside Tauri, or
a second `window.prompt("Session directory:", …)` in the browser preview
(`pickDirectory`/`addSession`, `src-ui/src/main.ts:1520-1543`). They are
unstyled, sit on top of the Breeze chrome, block the UI, and cannot be
themed or validated. Desired: a single in-app dialog (or inline form)
that collects the name and folder together, with validation and
quick-pick locations, instead of any `window.prompt`.

- Reuse the existing overlay pattern (`settingsOverlay`,
  `paletteOverlay`, `src-ui/src/main.ts:2107,2311`) so it matches the
  rest of the chrome and supports Esc / click-outside to close.
- Session rename should use the same dialog; it is also a
  `window.prompt` today (`renameSession`, `src-ui/src/main.ts:1553`).
- Keep a typed-path fallback behind the `IN_TAURI` guard so the browser
  preview and the Selenium suite still work without the native picker.
- This is the visual/UX half of "Native folder picker for new sessions"
  in `docs/features.md`; the button colour is tracked separately there.

## Agent-finished desktop notification says only "turn finished"

When an opencode turn ends, the plugin raises a desktop toast whose body
is the hardcoded string `turn finished` and whose title is the constant
`opencode` (`crates/muis-shell/opencode-plugin/muis.js:31`, on
`session.idle`). Every completion reads exactly the same and says nothing
about which tab/session or what finished. Desired: identify the source
and the work.

- Put the tab/session (or project directory) in the title and something
  meaningful in the body (the tab's OSC title, the last command, or a
  short summary) instead of the placeholder text.
- Match the shell-finished toast, which already reads
  `<lastCmd> finished` (`maybeNotifyFinished`,
  `src-ui/src/main.ts:2597-2615`).
- Keep the current gating: the toast fires only while the muis window is
  unfocused (`sendDesktopNotification`, `src-ui/src/main.ts:88-98`), and
  the tab still gets the done badge.

To test the desktop notification:

- Manual: focus a muis terminal, run
  `muis-notify --title "test" --body "hello"`, then unfocus the window —
  a toast should appear and the tab should be badged (routed via
  `notifyEventFromCli` → `applyNotification`,
  `src-ui/src/main.ts:2630-2663`).
- The OS toast itself is best-effort and hard to assert, so cover the
  routing and assert the plugin's `session.idle` payload is no longer the
  placeholder. The live X11 suite currently exercises only the OSC notify
  path (`tests/e2e/live-x11.sh:31-32`).

## Statusbar pills double-line when the window is not full screen

**Done** — at narrow widths the flex pills used to shrink and their text
wrapped to a second line ("CPU" / "25%"), doubling every pill. The row is
now `nowrap`, the pills no longer shrink, and the bar hides overflow, so
it stays one line. Also fixed the empty "load" pill that leaked between
GPU and the version (`src-ui/src/style.css`, `src-ui/src/main.ts`).

The right-side statusbar pills — CPU, RAM, GPU, the clock/date, and
`UTF-8 · <shell>` — render a weird double line when muis is not full
screen (e.g. floating or tiled to a smaller window). It looks bad.

- Direction: the pills are single-line at full screen but break once the
  window narrows. Check the `.statusbar` flex layout for wrap/overflow and
  whether the `.pill` border/height is duplicated or clipped when the row
  runs out of room (`src-ui/src/style.css`, `.statusbar`/`.pill`).
- Reflow, don't wrap: the pills should stay on one line and the statusbar
  should not gain a second border/row or a scrollbar-like line.
- Verify at a few window widths, including the minimum size, with all
  segments visible.

## Add tests

Cover the fixes above and the surrounding navigation behavior.

- Clock: `clock.test.ts` covers shape/padding; add a case for the refined
  format (and any configurable/locale variant).
- Tab/session selection focus: assert that selecting a tab or session
  focuses the active terminal, and that reorder/rename do not.
  Unit-test a decision helper instead of the DOM where practical.
- Empty session: after `closeTab` removes the last tab, the workspace is
  still present with `tabs.length === 0` and `current` unchanged; a new
  tab in it uses `ws.dir`; the state round-trips through
  `toJSON`/`fromJSON`.
- Keep the cross-session regression that exactly one terminal surface is
  visible (AGENTS.md) when touching terminal visibility or navigation,
  including the zero-tab case.
- Desktop notification: cover the `muis-notify` CLI → event mapping
  (`notifyEventFromCli`) and the plugin's `session.idle` payload; drive
  `muis-notify` in the live X11 suite and assert the tab badge.
- New-session dialog: assert the `＋ session` path no longer calls
  `window.prompt` and that a session is created with the entered name and
  folder (a decision/DOM helper where practical).
