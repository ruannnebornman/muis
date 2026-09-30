# Linux AppImage

Standalone Linux build of muis. One file, no installation.

## Run

```sh
chmod +x muis_<version>_amd64.AppImage
./muis_<version>_amd64.AppImage
```

If your system lacks `libfuse.so.2`, run it without FUSE:

```sh
./muis_<version>_amd64.AppImage --appimage-extract-and-run
```

## What it bundles

The AppImage is built to be self-contained: WebKitGTK 4.1, JavaScriptCore,
libsoup3, and GTK are bundled inside, along with both `muis` and `muis-worker`.
So it does not require `webkit2gtk-4.1` to be installed on the host.

## Requirements

- 64-bit Linux with a glibc at least as new as the build baseline
  (built on Ubuntu 22.04 for a low floor).
- `libfuse.so.2` to run in place, or `--appimage-extract-and-run`.

If a bundled library cannot load (for example, an older glibc), the dynamic
loader names the missing library; the Flatpak is the fully self-contained
alternative.

## State

Follows XDG, same as the packaged build:

- config: `~/.config/muis/muis.json`
- state: `~/.local/share/muis/` (`sessions.json`, `sessions/`)

## Build

CI builds this on `ubuntu-22.04` (`.github/workflows/release.yml`, `appimage`
job). Manually:

```sh
npm ci --prefix src-ui && npm run build --prefix src-ui
cargo build --release --locked -p muis-worker
(cd crates/muis-shell && ../../src-ui/node_modules/.bin/tauri build --bundles appimage)
```

`muis-worker` is placed beside `muis` inside the AppImage via
`bundle.linux.appimage.files` in `crates/muis-shell/tauri.conf.json`. The
AppImage lands in `target/release/bundle/appimage/`.
