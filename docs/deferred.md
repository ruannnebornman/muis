# Deferred work

Things deliberately parked, not blocked. Nothing here is next until the
core terminal feels good to use.

## Snor engine

- The side-panel slot API is already in place (`SidePanelRegistry`:
  register/toggle/single-visible/unregister, see
  `docs/archive/build-progress.md` Step 6). The docked right-side slot
  stays invisible until a panel registers.
- The engine itself is unwritten; no panel code exists yet.

## Make muis the default terminal on Veldmuis

Repo: **veldmuis**. Depends on a `veldmuis-muis` package existing first
(rollout Phase 3, `docs/rollout-plan.md`), which does not yet exist.

- `packages/veldmuis-terminal/PKGBUILD`: currently `depends=("wezterm"
  "fish" "atuin")` and ships `config.fish` + `wezterm.lua` through the
  managed user-defaults updater. Decide whether muis replaces wezterm or
  both stay with only the default changed.
- `packages/veldmuis-branding/kdeglobals`: `TerminalApplication=wezterm
  start --cwd .` / `TerminalService=org.wezfurlong.wezterm.desktop` →
  muis equivalents.
- `development/package-manifest.sh`: add `veldmuis-muis` to the core
  package order.
- `packages/veldmuis-calamares-config/installer-package-sets.sh`: add to
  the offline seed set.
- `development/run-ci-arch-builder.sh`: add muis build deps (rust,
  nodejs, npm, webkit2gtk-4.1, gtk3, libsoup3,
  libjavascriptcoregtk-4.1).
- `docs/packages.md`, `docs/index.md`: document the default terminal.

Full plan: `docs/rollout-plan.md` Phase 3 (package) and Phase 4
(default terminal).

## neofetch/fastfetch branding

- Net-new: neither repo ships a neofetch or fastfetch config today.
- muis already exports `TERM_PROGRAM=muis` for spawned shells
  (`crates/muis-worker/src/main.rs`), so fetch tools can detect it.
- Add a fastfetch preset/logo for muis/Veldmuis (ascii art + colors).

## Windows per-user installer (optional)

See `docs/windows.md`. Portable `muis-portable-*.zip` stays the supported
artifact; the optional per-user NSIS installer lives in the Windows doc.

## Remaining mock gaps

The archived `docs/archive/missing-features.md` audit is otherwise stale,
but two features it lists are genuinely still absent:

- Export / import the whole session state as JSON (the mock's sidebar
  export/import buttons). muis has automatic persistence only.
- Split panes: the mock models 1–3 panes per tab; muis has one terminal
  per tab.
