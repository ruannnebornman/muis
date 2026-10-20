# Deferred work

Parked, not blocked. Nothing here is next until the terminal itself is
solid and the project is otherwise quiet.

## On hold until muis is 100% sorted

- **Snor engine.** The side-panel slot API is already in place
  (`SidePanelRegistry`: register/toggle/single-visible/unregister, see
  `docs/archive/build-progress.md` Step 6). No panel code exists yet.
  Plan: `docs/snor-plan.md`. Revisit once the terminal is done.
- **neofetch/fastfetch branding.** Add a fastfetch preset/logo for
  muis/Veldmuis. muis already exports `TERM_PROGRAM=muis` for spawned
  shells (`crates/muis-worker/src/main.rs`).

## Removed platform targets

Windows (portable exe and installer), Flatpak, and AppImage were removed to
keep the build and release path focused on the Linux artifact Veldmuis
repackages (`muis-<version>-x86_64-linux.tar.gz`). Their CI jobs, packaging
files, docs, and platform-specific code are gone.

Restore from git history if support is revisited: start with the tree before
this removal, especially `.github/workflows/release.yml`, `packaging/flatpak/`,
`crates/muis-shell/tauri.conf.json`, and the platform branches in
`crates/muis-worker`.

## Deferred to later

- **Website** (rollout Phase 5): the download + showcase site.
- **Auto-update story:** package managers for Arch/Veldmuis; manual updates
  otherwise.
- **aarch64 package:** only if Veldmuis ever targets ARM.

## Abandoned

- **Veldmuis default terminal** (rollout Phase 4). Veldmuis ships Konsole
  as its default; muis is an optional `veldmuis-muis` package. The old
  `veldmuis-kaazrot`/wezterm default-terminal wiring is gone.
- **Export/import of session state.** It existed for the HTML preview
  mock only; not wanted.
- **Split panes.** Not wanted; muis is one terminal per tab.
