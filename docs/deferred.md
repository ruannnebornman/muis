# Deferred work

Parked, not blocked. Nothing here is next until the terminal itself is
solid and the project is otherwise quiet.

## On hold until muis is 100% sorted

- **Snor engine.** The side-panel slot API is already in place
  (`SidePanelRegistry`: register/toggle/single-visible/unregister, see
  `docs/archive/build-progress.md` Step 6). No panel code exists yet.
  Revisit once the terminal is done.
- **neofetch/fastfetch branding.** Add a fastfetch preset/logo for
  muis/Veldmuis. muis already exports `TERM_PROGRAM=muis` for spawned
  shells (`crates/muis-worker/src/main.rs`).

## Deferred to later

- **Windows installer and code signing.** Portable `muis-portable-*.zip`
  stays the supported artifact; see `docs/windows.md`.
- **Website** (rollout Phase 5): the download + showcase site.
- **Auto-update story:** Flatpak via `flatpak update`, package managers
  for Arch/Veldmuis, manual re-download for AppImage/Windows.
- **Flatpak distribution:** self-hosted repo vs Flathub.
- **aarch64 package:** only if Veldmuis ever targets ARM.

## Abandoned

- **Veldmuis default terminal** (rollout Phase 4). Veldmuis ships Konsole
  as its default; muis is an optional `veldmuis-muis` package. The old
  `veldmuis-kaazrot`/wezterm default-terminal wiring is gone.
- **Export/import of session state.** It existed for the HTML preview
  mock only; not wanted.
- **Split panes.** Not wanted; muis is one terminal per tab.
