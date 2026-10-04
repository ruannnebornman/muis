# Deferred work

Things deliberately parked, not blocked. Nothing here is next until the
core terminal feels good to use.

## Snor engine

- The side-panel slot API is already in place (`SidePanelRegistry`:
  register/toggle/single-visible/unregister, see `docs/build-progress.md`
  Step 6). The docked right-side slot stays invisible until a panel
  registers.
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

- Portable `muis-portable-*.zip` stays the supported artifact: nothing
  installed, no admin, no registry, no Start Menu entry. Preferred for
  locked-down/work machines.
- A per-user NSIS installer (`crates/muis-shell/tauri.conf.json` is
  intentionally `"windows": {}`) would not need admin either, but it does
  install. Only worth doing if someone wants Start Menu integration.
- Needs a real Windows box to build and verify.
