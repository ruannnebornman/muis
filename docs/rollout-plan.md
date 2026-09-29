# muis rollout plan

Goal: ship muis through these artifacts and one future channel.

1. **Arch package (`veldmuis-muis`)** — a signed pacman package in the
   Veldmuis repository, installed by default so muis is the terminal on a
   fresh Veldmuis system.
2. **AppImage** — a best-effort self-contained Linux binary for people not on
   Veldmuis, hosted on the website.
3. **Flatpak** — a guaranteed self-contained Linux package (the runtime
   provides WebKitGTK) so anyone can run muis with no host dependencies.
4. **AUR package (`muis`)** — for non-Veldmuis Arch/Manjaro users who want a
   native package without touching the Veldmuis repo or keyring.
5. **Windows zip** — a no-admin `muis-portable-<version>.zip`
   (`muis.exe` + `muis-worker.exe`) published on the muis GitHub Releases.
6. **Website** *(later)* — a download + showcase site (Windows zip, AppImage,
   Flatpak) for users outside Veldmuis.

Items 1, 2, 3, and 4 all ship the same `muis` binary; only `veldmuis-muis` is
Veldmuis-only.

This document is the plan only. Nothing here is implemented yet.

## Constraints (apply to every phase)

- **Two binaries, same directory.** `muis` resolves `muis-worker` as a
  sibling (`crates/muis-shell/src/main.rs:24`). Every channel must install
  both, side by side, and never one without the other.
- **Frontend is embedded.** `src-ui/dist` is compiled into `muis`; there is
  no separate web asset to install.
- **No admin on Windows.** Everything is per-user; state lives in
  `%APPDATA%\muis`.
- **Veldmuis Linux is Arch, not AppImage.** Veldmuis itself ships native
  pacman packages (`docs/architecture-rust-xterm.md:67,74`). The AppImage is a
  convenience download for Linux users who are not on Veldmuis.
- **AppImage must bundle `muis-worker` next to `muis`.** Tauri's sidecar
  (`bundle.externalBin`) names the file with the target triple; the AppDir must
  end up with `usr/bin/muis` and `usr/bin/muis-worker`, or `worker_path()` must
  also accept the triple-suffixed name (`crates/muis-shell/src/main.rs:24`).
- **AppImage is best-effort self-contained; Flatpak is the guarantee.**
  The AppImage attempts to bundle WebKitGTK/GTK/libsoup (built on an Ubuntu
  22.04 baseline for a low glibc floor) and degrade to a friendly error if a
  dependency is missing. Flatpak removes host dependencies entirely because the
  runtime provides WebKitGTK. AppImages also need `libfuse.so.2` unless run
  with `--appimage-extract-and-run`.
- **No separate "minimal" build.** The dependency weight is the webview, not
  optional features, so a stripped-down variant would not be meaningfully
  smaller. Instead, each channel handles prerequisites: native packages
  auto-resolve them (`depends=`), Flatpak bundles them, the AppImage tries to,
  and the docs list them per distro (`webkit2gtk-4.1` on Arch, etc.). Listing
  prerequisites is normal and not harmful.
- **No auto-update.** Package manager (Veldmuis) or manual download
  (AppImage/Windows).
- **Veldmuis packaging rules.** Packages are built by
  `development/build-all-packages.sh` (`makepkg --nodeps -f`) in the order in
  `development/package-manifest.sh`, inside the Arch builder container
  (`development/run-ci-arch-builder.sh`).

## Versioning (decided)

The muis repo is the version source of truth: semver git tags
`vMAJOR.MINOR.PATCH`, starting at **`v1.0.0`**.

- `MAJOR` stays at `1` until a large rewrite.
- `MINOR` (`1.x.0`) for feature-sized changes (a notable feature/PR landing).
- `PATCH` (`1.0.x`) for bug fixes and small patches.

`crates/muis-shell/tauri.conf.json` `version` mirrors the tag, and the release
workflow asserts tag == config version. Veldmuis keeps its own date-tagged
releases; its PKGBUILD pins the muis tag.

## Phase 0 decisions (Q&A)

- **Tauri CLI / AppImage toolchain** — yes: add `@tauri-apps/cli` as a dev
  dependency + a `tauri` script; the bundler downloads `linuxdeploy`/
  `appimagetool`. Target x86_64 only for now.
- **`muis-worker` in the AppImage** — the user downloads **one** `.AppImage`;
  it carries both binaries in `usr/bin/`. To be robust against Tauri's
  triple-suffixed sidecar naming, `worker_path()` will also accept a
  `muis-worker-*` sibling.
- **AppImage + Flatpak (decided)** — AppImage is best-effort self-contained
  (bundle WebKitGTK/GTK/libsoup; build on an Ubuntu 22.04 baseline; friendly
  error if something is missing). Flatpak is the guaranteed zero-dependency
  route. Both are shipped, also as a portfolio/showcase piece.
- **CI is the test bed** — build and smoke-test the AppImage and Flatpak in
  GitHub Actions containers (Arch, Fedora, Ubuntu), not on the dev machine.
- **Versioning** — see above (`v1.0.0`, semver).
- **`/home/kaazrot` hardcode** — `src-ui/src/main.ts:164` and
  `src-ui/src/main.ts:593` hardcode the home path; fix to use the real home
  (`default_cwd`/`home_dir`).
- **Phase split** — Phase 0 + Phase 1 may land as one PR if convenient.

---

## Phase 0 — Prerequisites and hygiene

**Repo: muis**

- Icons: `data/icons/hicolor/512x512/apps/muis.png` already exists (512×512)
  and `tauri.conf.json` points at it correctly. Add the conventional hicolor
  ladder (48/64/128/256) generated from `data/icons/muis-source.png` for
  crisp scaling, and confirm `data/muis.desktop` (`Exec=muis`, `Icon=muis`,
  `StartupWMClass=muis`).
- Add `@tauri-apps/cli` + a `tauri` npm script (x86_64 AppImage only).
- `worker_path()` fallback to accept a triple-suffixed `muis-worker-*` sibling
  so the AppImage carries the sidecar regardless of bundler naming.
- Replace the hardcoded `/home/kaazrot` (`src-ui/src/main.ts:164,593`) with the
  real home from `default_cwd`.
- Bundle `muis-worker` into the AppImage `usr/bin/` next to `muis` (via the
  `worker_path()` triple-suffix fallback and/or a post-bundle copy).
- AppImage: best-effort self-contained build. Configure the bundler to pull in
  GTK/WebKit/libsoup and build on an Ubuntu 22.04 baseline for a low glibc
  floor.
- Friendly missing-dependency handling lives in the AppImage `AppRun`/launcher,
  not the Rust binary: Tauri links `libwebkit2gtk-4.1` dynamically, so a missing
  library fails in the dynamic loader before app code runs. `AppRun` checks for
  the library and prints "install webkit2gtk-4.1 / libwebkit2gtk-4.1-0 /
  webkit2gtk4.1, or use the Flatpak" and exits non-zero.
- Prepare the Flatpak manifest (`org.veldmuislinux.muis.yml`) on the GNOME runtime;
  confirm the runtime supplies WebKitGTK.
- Prove the AppImage build: add the Tauri CLI, run
  `cargo tauri build --bundles appimage`, and confirm a pty opens.
- Decide the first release version and create the tag once the release
  workflow is in place (Phase 1), not before.

**Repo: veldmuis**

- Decide whether muis is a new package (`veldmuis-muis`) or folded into
  `veldmuis-terminal`. Recommended: new `veldmuis-muis` binary package, pulled
  in by `veldmuis-terminal` (Phase 3) so the metapackage stays the composition
  point.

**Exit criteria:** self-containment decision made; Tauri CLI added; a built
AppImage resolves `muis-worker` and opens a pty; icons/desktop ready; home path
fixed.

---

## Phase 1 — muis release automation (Arch source, AppImage, Flatpak, Windows zip)

**Repo: muis.** New file: `.github/workflows/release.yml`.

Trigger: annotated tag `v*` (plus `workflow_dispatch` for dry runs).

Jobs:

1. **linux-tarball** (feeds the Veldmuis PKGBUILD)
   - `actions/setup-node@v5`, `dtolnay/rust-toolchain@stable`
   - install `webkit2gtk-4.1`, `gtk3`, `libsoup3`, `libjavascriptcoregtk-4.1`
   - `npm ci && npm run build --prefix src-ui`
   - `cargo build --release --locked -p muis-shell -p muis-worker`
   - stage `muis` + `muis-worker` + `data/muis.desktop` + icon
   - produce `muis-<version>-x86_64-linux.tar.gz` with a `sha256`
2. **appimage** (best-effort self-contained Linux download)
   - runs on `ubuntu-22.04` for a low glibc floor
   - same Rust/Node/webkit deps and `src-ui` build
   - install the Tauri CLI and run
     `cargo tauri build --bundles appimage -p muis-shell` (or `npm run tauri
     build -- --bundles appimage`) to emit `muis_<version>_amd64.AppImage`
   - assert the AppDir contains `usr/bin/muis` and `usr/bin/muis-worker`
   - smoke-test the AppImage in clean Arch/Ubuntu/Fedora containers
   - `sha256`
3. **flatpak** (guaranteed self-contained Linux download)
   - `flatpak-builder` with `org.veldmuislinux.muis.yml` on the GNOME runtime
   - build both binaries into the sandbox; bundle the `.flatpak`
   - publish `muis-<version>.flatpak` (or an ostree repo) + `sha256`
4. **windows-x86_64** (extends the existing `windows-portable` CI job)
   - `cargo build --release --locked -p muis-shell -p muis-worker`
   - `Compress-Archive` → `muis-portable-<version>.zip` (two exes, top level)
   - `sha256`
5. **release** — create the GitHub Release, attach the Linux tarball, the
   AppImage, the Flatpak, the Windows zip, and a `SHA256SUMS` file, with a
   short changelog. Nothing is published until all artifacts build.

Rationale for the Linux tarball even though Veldmuis installs via pacman: the
Veldmuis PKGBUILD fetches a source/release artifact, and a tagged tarball gives
a stable, checksummable `source=()` for `makepkg` (like `veldmuis`'s
`packages/calamares/PKGBUILD` fetching a GitHub release tarball). The AppImage
and Flatpak are separate builds for non-Veldmuis Linux users.

Alternative for Phase 3: the PKGBUILD can build from the git tag
(`source=("$pkgname-$pkgver.tar.gz::https://github.com/ruannnebornman/muis/archive/refs/tags/v$pkgver.tar.gz")`)
and run the UI + cargo build itself. That avoids depending on release binaries
on the Veldmuis builder, at the cost of a heavier container.

**Verification:** download the built artifacts on a clean Windows box and a
Veldmuis box; run both, check `muis-worker` is found and a pty opens; verify
`sha256`.

**Exit criteria:** `v1.0.0` tag produces a GitHub Release with the Windows zip,
the AppImage, the Flatpak, and the Linux source artifacts, all checksummed.

---

## Phase 2 — Download hardening (Windows zip, AppImage, Flatpak)

**Repo: muis** (release assets and docs only).

Windows:

- Document the portable flow in `docs/packaging-windows.md`: unzip, run
  `muis.exe`, WebView2 requirement, state location `%APPDATA%\muis`, how to
  reset (delete the folder).
- **(Optional, later)** code-sign `muis.exe`/`muis-worker.exe` to reduce
  SmartScreen friction; until then document "More info → Run anyway".
- **(Deferred)** the NSIS per-user installer (`"windows": {}` in
  `tauri.conf.json`) stays out of scope until there is a real Windows test box.

AppImage:

- New `docs/packaging-linux-appimage.md`: `chmod +x` then run; fuse2 present or
  use `--appimage-extract-and-run`; note any dependencies the bundler could not
  include; state follows XDG (`~/.config/muis`, `~/.local/share/muis`).
- CI smoke-tests the AppImage in clean Arch, Ubuntu, and Fedora containers and
  records what (if anything) is still required at runtime.

Flatpak:

- Publish `org.veldmuislinux.muis.yml` and the `.flatpak` (or an ostree repo).
- New `docs/packaging-flatpak.md`: `flatpak install`, `flatpak run
  org.veldmuislinux.muis`; state under `~/.var/app/org.veldmuislinux.muis/`.
- CI smoke-tests `flatpak install` + launch in a clean container.
- Decide distribution: self-hosted repo (simplest) vs Flathub (discovery, but
  review overhead).

All:

- Add a `SHA256SUMS` file to the release and a short "verify your download"
  section (checksums are the only integrity check until the Windows binaries
  are signed).

**Exit criteria:** a Windows user can unzip, run, and verify from the release
page alone; a Linux user can run the AppImage, or install the Flatpak for a
zero-dependency experience, and verify the download.

---

## Phase 2b — AUR package for non-Veldmuis Arch/Manjaro

**Repo: muis** (an `aur/` PKGBUILD) **+ the AUR**. No Veldmuis keyring involved.

- `aur/PKGBUILD` (`pkgname=muis`, architecture `x86_64`): `source=` the muis
  release tarball by tag + `sha256`; `makedepends=("rust" "nodejs" "npm")`;
  `depends=("webkit2gtk-4.1" "gtk3" "libsoup3" "libjavascriptcoregtk-4.1")`;
  same `build()`/`package()` shape as `veldmuis-muis` (both binaries as
  siblings, desktop file, icon).
- Publish the PKGBUILD to the AUR; users install with an AUR helper
  (`yay -S muis`), which builds locally — no Veldmuis repo and no keyring.
- Keep it in lockstep with releases; the same resolver used for Phase 3 can
  update it.
- AUR users update through their helper, fully independent of Veldmuis.

Rationale: this is the "native package without the Veldmuis keyring" path for
Arch-family users on Manjaro/EndeavourOS/etc. The AppImage remains the option
for everyone else.

**Exit criteria:** a Manjaro/Arch user can `yay -S muis` and run it without
adding the Veldmuis repo.

---

## Phase 3 — Veldmuis pacman package

**Repo: veldmuis.** Package directory: `packages/veldmuis-muis/`.

New `packages/veldmuis-muis/PKGBUILD`:

- `pkgname=veldmuis-muis`, `arch=("x86_64")`, `license=("MIT")`.
- `depends=("webkit2gtk-4.1" "gtk3" "libsoup3" "libjavascriptcoregtk-4.1"
  "fish" "git")` — mirror what the shell needs at runtime.
- `makedepends=("rust" "nodejs" "npm" "base-devel")`; note the builder uses
  `makepkg --nodeps`, so these must also be present in the container (below).
- `source=()` fetches the muis release artifact or the tag tarball plus a
  pinned `sha256`. `pkgver` = the pinned muis version.
- `build()`: `npm ci && npm run build` in `src-ui/`, then
  `cargo build --release --locked -p muis-shell -p muis-worker`.
- `package()` installs:
  - `target/release/muis` → `/usr/bin/muis`
  - `target/release/muis-worker` → `/usr/bin/muis-worker` (sibling, required)
  - `data/muis.desktop` → `/usr/share/applications/muis.desktop`
  - icon → `/usr/share/icons/hicolor/512x512/apps/muis.png`

Wiring changes (repo: veldmuis):

- `development/package-manifest.sh` — add `"veldmuis-muis"` to
  `veldmuis_core_package_order` (before `veldmuis-terminal`/`veldmuis-desktop`).
- `packages/veldmuis-terminal/PKGBUILD` — add `veldmuis-muis` to `depends` so
  a default install gets it (Phase 4 decides whether it replaces wezterm).
- `packages/veldmuis-calamares-config/installer-package-sets.sh` — add
  `veldmuis-muis` to the offline seed set (`veldmuis_offline_seed_packages`) so
  the offline installer includes it.
- `development/run-ci-arch-builder.sh` — add muis build deps to
  `common_packages` (e.g. `rust`, `nodejs`, `npm`, `webkit2gtk-4.1`, `gtk3`,
  `libsoup3`, `libjavascriptcoregtk-4.1`).
- `docs/packages.md` — document the new package in the composition section.
- `docs/index.md` — add a line under "Package composition" if it lists muis.

### Auto-latest during the daily refresh (no Veldmuis PR)

The daily `package-repo-refresh.yml` run should pick up the newest muis
release automatically, so a muis tag reaches `pacman -Syu` without a manual
Veldmuis PR. Model it on the existing AUR lock pattern
(`development/aur-packages.lock`):

- `development/muis-release.lock` — checked-in record of the muis version +
  tarball `sha256` currently built (the floor).
- `development/resolve-muis-release.sh` — queries the GitHub Releases API for
  the latest `v*` tag, verifies the tarball checksum (and signature if
  published), and rewrites the lock.
- `package-repo-refresh.yml` runs the resolver **before**
  `check-package-repo-refresh.sh`; the refresh check treats a changed muis
  lock as "refresh needed", and a small helper patches
  `packages/veldmuis-muis/` `pkgver`/`sha256sums` in the ephemeral checkout
  before `run-ci-arch-builder.sh packages`. Nothing is committed to `main`.
- Escape hatches: `VELDMUIS_MUIS_VERSION` pins an exact version for
  reproductions; the lock only moves forward.
- Optional, for prompt pickup instead of waiting for the 12:17 cron: add
  `packages/**` + the lock to the workflow's `push.paths`, or have the muis
  release workflow dispatch the Veldmuis refresh via a cross-repo token.

Note: the Veldmuis build still compiles muis from the pinned tarball and signs
the package with the Veldmuis key — only the version resolution is automated.

**Verification:** `development/build-all-packages.sh veldmuis-muis` in the
Arch builder container; inspect the `.pkg.tar.zst` for both binaries, the
desktop file, and the icon; install the built package on a Veldmuis box and
launch.

**Exit criteria:** `pacman -S veldmuis-muis` installs a working muis; a fresh
Veldmuis install (from the ISO or network installer) has muis present.

---

## Phase 4 — Make muis the default terminal

**Repo: veldmuis.** This is the behavioral change; keep it separate from
Phase 3 so packaging can land first.

- `packages/veldmuis-terminal/PKGBUILD`: currently depends on `wezterm` and
  ships `config.fish` + `wezterm.lua` through the managed user-defaults
  updater (`user-defaults-history.tsv`, `veldmuis-user-defaults-update`).
  Decide:
  - replace `wezterm` with `veldmuis-muis`, or
  - keep both and change the launcher/default (KDE default terminal, desktop
    shortcut) to `muis`.
- If muis reads its own config, the managed fish/wezterm user-defaults
  templates may need a muis equivalent (or be left alone if muis just needs
  the shell).
- Update `packages/veldmuis-branding` / KDE defaults if the default terminal
  app is set there.
- `docs/packages.md` and `docs/architecture.md` — note muis as the default
  terminal.

**Verification:** fresh install boots into a session where the terminal
launcher opens muis; the managed user-defaults updater still passes its
checks (`packages/veldmuis-terminal/test-veldmuis-user-defaults-update.sh`,
`development/check-managed-user-defaults-package.sh`).

**Exit criteria:** muis is the terminal a new Veldmuis user actually gets.

---

## Phase 5 — Download + showcase website *(later)*

**Repo: new** `muis-site` (static site; host on GitHub Pages or Cloudflare
Pages — Veldmuis already uses Cloudflare R2 for release objects).

- Landing page: what muis is, screenshot/GIF of the Breeze chrome, feature
  list (sessions sidebar, tabs labeled by last command, cross-session search,
  themes, command bar).
- **Downloads** for all non-Veldmuis platforms, resolved from the GitHub
  Releases API (never hardcode a version):
  - Windows: `muis-portable-<version>.zip`, with the WebView2 note.
  - Linux AppImage: `muis_<version>_amd64.AppImage`, with the `chmod +x` and
    fuse2/`--appimage-extract-and-run` notes.
  - Linux Flatpak: `flatpak install` from the hosted repo (zero host deps).
  - Veldmuis users get a one-liner pointing at the pacman package; Arch/Manjaro
    users get the AUR package.
- Detect the visitor's OS and suggest the right artifact; show size + `sha256`
  for each.
- Mirror the release notes / changelog.
- No analytics by default; keep it static and cheap.

**Exit criteria:** a Windows or non-Veldmuis Linux visitor can download, verify,
and run from the site without touching GitHub.

---

## Phase 6 — Hardening and follow-ups

- Code signing for the Windows executables.
- NSIS per-user installer once a Windows test box exists.
- A muis package for `aarch64` if Veldmuis ever targets ARM.
- Auto-update story: Flatpak updates via `flatpak update`; package managers for
  Arch/Veldmuis; manual re-download for AppImage/Windows.
- CI: keep `ci.yml` green and add the release workflow to the same gates.

---

## Repo / file summary

| Phase | Repo | Key files |
| --- | --- | --- |
| 0 | muis | `crates/muis-shell/tauri.conf.json`, `crates/muis-shell/src/main.rs`, `data/` |
| 1 | muis | `.github/workflows/release.yml` (new), `.github/workflows/ci.yml` |
| 2 | muis | `docs/packaging-windows.md`, `docs/packaging-linux-appimage.md` (new), `docs/packaging-flatpak.md` (new), `org.veldmuislinux.muis.yml` (new), release assets |
| 2b | muis + AUR | `aur/PKGBUILD` (new) |
| 3 | veldmuis | `packages/veldmuis-muis/PKGBUILD` (new), `development/muis-release.lock` (new), `development/resolve-muis-release.sh` (new), `development/package-manifest.sh`, `packages/veldmuis-terminal/PKGBUILD`, `packages/veldmuis-calamares-config/installer-package-sets.sh`, `development/run-ci-arch-builder.sh`, `.github/workflows/package-repo-refresh.yml`, `docs/packages.md` |
| 4 | veldmuis | `packages/veldmuis-terminal/*`, `packages/veldmuis-branding/*`, `docs/*` |
| 5 | muis-site (new) | site sources, deploy config |
| 6 | both | signing, installer |

## Open questions

- Flatpak distribution: self-hosted repo vs Flathub? The app ID is
  `org.veldmuislinux.muis` (from `veldmuislinux.org`); Flathub verifies domain
  ownership.
- Does muis replace wezterm in `veldmuis-terminal`, or ship alongside?
- Should the Veldmuis PKGBUILD build from source (heavier container) or consume
  the muis release tarball?
- Windows code signing: now, later, or never?

## Notes

- The GNOME runtime provides WebKitGTK 4.1 (Tauri switched to webkit2gtk-4.1
  partly for Flatpak support), so the Flatpak needs no host dependencies. Pick
  a recent runtime so its glibc/WebKit match the Rust toolchain.
- AppImage builds must run on an Ubuntu 22.04 baseline for a low glibc floor.
