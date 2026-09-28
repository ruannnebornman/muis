# Missing features — mock vs muis

Audit of the design target (`wezterm-web/index.html`) against what the
app currently implements. Mock references are `index.html:line`; muis
references are paths under `src-ui/src` and `crates/`.

The mock is a browser demo: its shell commands are fake. muis runs a
real PTY, so the demo commands are intentionally not ported. This list
is only about UI/UX the mock defines that the real app does not have.

## 1. Last-command bar (pane header)

The mock renders a bar directly below the tab bar, above the terminal
body, showing the last command's result.

- Mock: `.pane-head` — `index.html:143`, rendered at `index.html:361`,
  content from `lastCmdHTML()` at `index.html:426`. Shows
  `✓ <command> exit 0 · 12ms`, or `zsh — ready` before any command, and
  turns red on non-zero exit.
- muis: no equivalent. The area below the tab bar is the xterm surface
  directly (`main.ts:626`). The status bar shows session/cwd/git/user
  (`main.ts:648`), not the last command.

Implementation note: a real version needs the shell to report command
boundaries, exit code, and timing (OSC 133 semantic prompt markers plus
a shell hook). muis's OSC parser currently handles only OSC 7 (cwd) and
OSC 0/2 (title) — `src-ui/src/osc.ts`.

## 2. Cross-session search with results panel

- Mock: the title-bar search box opens a results dropdown. Live search
  over all panes and session/tab names, minimum 2 chars, scope buttons
  (Everywhere / Session / Tab), match count, breadcrumbed result rows
  (`session › tab` + line text), click a result to switch session/tab,
  highlight matching lines, and scroll to the first hit. Enter opens the
  first result.
  - `index.html:191` (markup), `index.html:431-483` (search + jump +
    highlight), `index.html:699-707` (input wiring).
- muis: the same search box is wired to the active terminal's xterm
  SearchAddon only (`main.ts:237-253`, `src-ui/src/search.ts`). No
  results panel, scope selector, match count, cross-tab/session search,
  or in-pane highlighting/jump.

## 3. Right-click context menus

- Mock: right-click a session → Rename session. Right-click a tab →
  Rename tab (with manual/auto hint) and Freeze / Use automatic title.
  - `index.html:708-742`.
- muis: rename exists but only via double-click on the session/tab
  (`main.ts:573-579`, `main.ts:616-622`). No context menu, and no
  explicit freeze/unfreeze control (auto title is guarded by
  `isDefaultTitle`, `src-ui/src/sessions.ts:26`).

## 4. Themes

- Mock: five themes (tokyo-night, gruvbox, dracula, catppuccin, nord)
  that recolor terminal accents, switchable via a `theme` command and
  persisted in the saved state.
  - `index.html:232-242` (palettes), `index.html:576-588` (apply/cycle),
    `index.html:661` (persist index).
- muis: a single fixed theme — `src-ui/src/theme.ts` (`MUIS_THEME`,
  `xtermTheme()`). No theme switching or accent recoloring.

## 5. Export / import session snapshot

- Mock: sidebar footer has `export` and `import` buttons that download /
  load the whole session state as JSON.
  - `index.html:206-208`, `index.html:666-686`.
- muis: automatic persistence only (`sessions.json` + per-tab scrollback
  snapshots, `main.ts:735-762`). No user-facing export/import.

## 6. Window title "done" count

- Mock: the window/document title shows how many background tabs
  finished while you were elsewhere: `● (n) done — wezterm`.
  - `index.html:392-395`.
- muis: the title is fixed to `muis — <session>` (`main.ts:508`). Tab
  "done" badges exist (`main.ts:605`), but the title count does not.

## 7. Keyboard shortcuts

- Mock: `ctrl+shift+t` new tab, `ctrl+shift+w` close tab, `alt+1..9`
  switch tab, `ctrl+f` focus search (`index.html:692-698`).
- muis: `ctrl+t` new tab, `ctrl+shift+f` search, `ctrl+shift+F12` focus
  terminal, `ctrl+,` settings (`main.ts:787-816`).
- Missing: `ctrl+shift+w` close tab, `alt+1..9` tab switching.
- Divergent by design (real-terminal conflicts): new tab is `ctrl+t`
  not `ctrl+shift+t`, search is `ctrl+shift+f` not `ctrl+f`.

## 8. Session icon glyphs

- Mock: each session carries its own glyph (`◈ ⬢ ⬣ ✦ ⬔`) shown in the
  colored icon tile (`index.html:255-273`, applied at `index.html:325`).
- muis: the first letter of the session name (`main.ts:554`), no
  per-session glyph.

## Minor / cosmetic

- Status bar session pill: mock has a leading `●` (`index.html:216`);
  muis does not (`main.ts:664-667`).
- Search hint text: mock `ctrl f` (`index.html:191`); muis
  `ctrl shift f` (`main.ts:195`).
- Session subtitle has a `title` tooltip in the mock
  (`index.html:326`); muis sets none.

## Present in the mock's data model but not really a feature

- Split panes: the mock models 1-3 panes per tab and a `.panes.cols-N`
  grid (`index.html:139-140`, `index.html:353-371`), but there is no UI
  to create or remove a split. muis has one terminal per tab.
- Glow toggle: `toggleGlow()` is defined but never wired to anything
  (`index.html:589`).
- `.toolbar` / `.tool` CSS is defined but unused (`index.html:173-175`).
- Demo shell commands (`help`, `ls`, `neofetch`, `htop`, `git`, `ssh`,
  `theme`, `vim`, `sudo`) are browser fakes (`index.html:484-575`) and
  are intentionally not ported.

## muis has beyond the mock

For completeness, these exist in the app and not in the mock:

- Real PTY per tab via `muis-worker` (one process per session).
- Real git branch lookup for the status bar.
- Settings dialog (show sessions panel, terminal font size) with
  persisted config (`main.ts:818-890`).
- OSC 7 / 0 / 2 tracking of cwd and title from the real shell.
- Scrollback snapshot save/restore across restarts.
- Busy-tab close and quit confirmation.
- Frameless window drag + edge/corner resize grips.
- Side-panel extension slot for future panels.

## Internal note

- `tabsOnTop` is a persisted config field (`src-ui/src/config.ts:4`) but
  is never read by the renderer — a dead setting not present in the mock
  either.
