# Flatpak

Fully self-contained Linux build: the GNOME runtime provides WebKitGTK, so
there are no host dependencies beyond Flatpak itself.

## Install

From the release bundle:

```sh
flatpak install --user muis-<version>.flatpak
```

Or, once the hosted repo exists:

```sh
flatpak install --user <repo> org.veldmuislinux.muis
```

## Run

```sh
flatpak run org.veldmuislinux.muis
```

## How the shell works

muis is a terminal, so it needs your real shell and host tools. Inside the
sandbox `muis-worker` detects Flatpak (`/.flatpak-info`) and starts the shell
on the **host** via `flatpak-spawn --host`, so you get your normal fish/bash,
your config, and all host commands (`git`, `pacman`, etc.). This uses the
`org.freedesktop.Flatpak` portal permission in the manifest.

## Permissions

The manifest requests, deliberately, for a terminal:

- `--share=network`
- `--filesystem=home` (your files)
- `--talk-name=org.freedesktop.Flatpak` (run the host shell)
- `--device=dri`, `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc`
- `--talk-name=org.freedesktop.Notifications`

## State

Follows XDG. Under Flatpak, config is redirected to
`~/.var/app/org.veldmuislinux.muis/config/muis/`.

## Build

CI builds this (`release.yml`, `flatpak` job) with
`flatpak/flatpak-github-actions`. Locally:

```sh
flatpak-builder --user --install --force-clean build-dir \
  packaging/flatpak/org.veldmuislinux.muis.yml
```

Requires `flatpak-builder`, `org.gnome.Sdk//48`, and the `rust-stable` and
`node20` SDK extensions. The build fetches crates and npm packages, so it
needs network access.
