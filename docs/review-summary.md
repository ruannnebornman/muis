# muis spec review summary

Review of the muis design spec (HTML mock) against the current
implementation. Static review of the tree at `main` (`f7dad39`); tests
were not run.

## Scope / which HTML is the spec

There are two HTML mocks in play. Both are covered below.

- `../wezterm-web/index.html` — the **active** design target (Breeze
  chrome, blue accent). `README.md`, `ROADMAP.md`, `src-ui/src/style.css`
  and `src-ui/src/theme.ts` all name it as the source of truth.
- `design/mock.html` — the in-repo "muis chrome mock" (Muis Dark
  palette). Marked **superseded** by `AGENTS.md`, `README.md` and
  `style.css`, and kept for history.
- `docs/target-mockup.png` — rendered target for the active design.

Implementation reviewed: `src-ui/src/*` (TypeScript + xterm.js) and
`crates/*` (Rust worker + Tauri shell).

## Implemented vs not (active target)

Status: **yes** = matches the spec, **partial** = present with a
divergence, **no** = absent.

| Area | Spec (`wezterm-web/index.html`) | muis | Status |
| --- | --- | --- | --- |
| Titlebar | app icon, title, search box, min/max/close | `main.ts:173-221`, window API `main.ts:264-277` | yes |
| Frameless drag + edge resize | not in spec | `main.ts:279-316` (beyond spec) | n/a |
| Sessions sidebar | 248px, color tile + glyph, name, "n tabs · path", done badge, notify dot, "＋ session" | `main.ts:559-633` | yes |
| Sidebar export / import | `⤓ export`, `⤒ import` buttons | none | **no** |
| Tab bar | color dot, title, `✓ done`, `✕`, `+`, active top-accent | `main.ts:635-693` | yes |
| Last-command bar | `.pane-head`: `✓ cmd exit 0 · 12ms` / `shell — ready` / red on fail | `main.ts:1069-1144`, `commandbar.ts`, OSC 133 in `osc.ts:87-113` | yes |
| Terminal surface | browser fake | real PTY per tab, xterm.js, 50k scrollback (`main.ts:365-448`) | yes (beyond) |
| Status bar | `● session · tab` pill, cwd, git pill, user@host pill, clock, shell pill | `main.ts:717-757` | partial (no leading `●`) |
| Cross-session search | results dropdown, scopes, match count, breadcrumb rows, jump + highlight | `main.ts:1146-1242`, `searchall.ts` | yes |
| Right-click menus | rename session; rename tab (manual/auto); freeze/unfreeze title | `main.ts:1244-1310` | yes |
| Themes | default + tokyo-night, gruvbox, dracula, catppuccin, nord | `theme.ts:56-110`, settings dropdown `main.ts:939-945` | yes |
| Window title done count | `● (n) done — wezterm` | `main.ts:1312-1317` | yes |
| Keyboard shortcuts | `ctrl+shift+t`, `ctrl+shift+w`, `alt+1..9`, `ctrl+f` | `shortcuts.ts` | yes |
| Splits / panes grid | modelled (1-3 panes) but no create/remove UI | one terminal per tab | n/a |
| Glow toggle | defined, never wired | absent | n/a |
| Demo shell commands | `help`, `ls`, `neofetch`, `git`, `ssh`, `theme`, `vim` fakes | not ported (real shell) | intentional |

## Still missing

1. **Export / import session snapshot.** The spec's sidebar footer has
   two buttons; muis only has "＋ session" (`main.ts:573-586`). muis
   autosaves `sessions.json` + per-tab scrollback snapshots
   (`main.ts:804-831`), but there is no user-facing export/import and no
   Tauri command for it (`crates/muis-shell/src/main.rs:188-207`).
2. **Status-bar session pill leading `●`** present in the spec
   (`index.html:216`); muis renders the pill without it
   (`main.ts:733-736`).
3. **Session subtitle tooltip.** The spec sets `title="<path>"` on the
   `s-sub` line (`index.html:326`); muis renders the subtitle text with
   no tooltip (`main.ts:616-620`).

Everything else the earlier audit (`docs/missing-features.md`) listed as
missing is now implemented; that file is stale (see Notes).

## Intentional divergences

- **Theme switching UI.** Spec switches accents via a fake `theme
  <name>` shell command + `cycleTheme()` (`index.html:561-563`,
  `576-588`). muis uses the Settings dialog dropdown and persists the
  choice in `config.json` (`main.ts:939-993`) because the shell is real.
- **Shortcuts.** Spec `ctrl+shift+t/w`, `alt+1..9`, `ctrl+f`. muis
  keeps all of those, adds plain `ctrl+t` for new tab, and adds
  `ctrl+shift+F12` focus-terminal and `ctrl+,` settings
  (`shortcuts.ts`). Updated from the old audit, which had stale bindings.
- **Session glyph.** Spec stores a fixed glyph per session (`◈ ⬢ ...`);
  muis derives a stable glyph from the session name (`main.ts:589-595`).
- **Context-menu labels.** Spec prefixes labels with emoji; muis uses
  plain text (`main.ts:1287-1299`).
- **Search hint text.** Now matches the spec (`ctrl f`,
  `main.ts:197-199`); the old audit's mismatch no longer applies.
- **Inline highlight.** Spec paints matching lines in-pane; muis jumps
  with xterm's SearchAddon `findNext` (`main.ts:1232-1241`).

## muis beyond the spec

- One `muis-worker` process per session; PTY ownership never enters the
  UI process (`crates/muis-worker`, `crates/muis-shell/src/bridge.rs`).
- Session persistence with scrollback snapshots and restore
  (`crates/muis-shell/src/persist.rs`, `main.ts:816-831`).
- OSC 7 / 0 / 2 / 133 real cwd, title and command tracking (`osc.ts`).
- Real git-branch and user@host status segments
  (`main.rs:120-156`).
- Dirty-tab close and quit confirmation (`activity.ts`,
  `main.ts:835-841`).
- Frameless window drag + edge/corner resize
  (`main.ts:279-316`).
- Settings dialog (sessions panel, font size, theme).
- Side-panel extension slot for future panels (`panels.ts`,
  `main.ts:777-802`).

## Superseded in-repo mock (`design/mock.html`)

`design/mock.html` describes the old Muis Dark look: `#1b120d` / `#f3d7a0`
/ `#8f4b28`, a left column combining a sessions list with left tabs
(top-tabs as an option), a labeled "+ New Tab" button, and 8px radii.

The current Rust/Tauri `main` does **not** implement it; the app targets
the Breeze spec above. The feature set of `design/mock.html` was built
once in the earlier Qt prototype (ancestor commit `58ecd44`, branch
`feature/initial-prototype`: `src/MainWindow.*`, `SideTabBar.*`,
`SessionsPanel.*`) before the Rust rewrite replaced the tree. Treat
`design/mock.html` as history, not a checklist.

## Notes on existing docs

- `docs/missing-features.md` is out of date. Its items 1-4 and 6-8
  (last-command bar, cross-session search, context menus, themes, window
  title count, shortcuts, session glyphs) are implemented. Only its item
  5 (export/import) and the two cosmetic minors above remain.
- `config.tabsOnTop` is a dead field: mirrored in `config.ts`, persisted
  by the settings handler (`main.ts:975-983`), but never read by the
  renderer.

## Verification

- Every claim above is traced to a `file:line` in the reviewed tree.
- No build, unit test, or live run was performed for this review.
