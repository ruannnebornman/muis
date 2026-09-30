# AUR package

`muis` on the AUR gives Arch and Manjaro users a native package without adding
the Veldmuis repository or its keyring. The package builds from source on the
user's machine.

## Install (users)

```sh
yay -S muis      # or: paru -S muis
```

## Publish / update (maintainer)

The AUR is a git repo per package. `aur/` in this repository is the source of
truth; mirror it into the AUR:

```sh
git clone ssh://aur@aur.archlinux.org/muis.git /tmp/aur-muis
cp aur/PKGBUILD aur/.SRCINFO /tmp/aur-muis/
cd /tmp/aur-muis
git add PKGBUILD .SRCINFO
git commit -m "muis 1.0.0"
git push
```

### Bump to a new release

```sh
# in this repo
cd aur
# 1. set pkgver to the new tag (without the leading v)
$EDITOR PKGBUILD
# 2. refresh the checksum of the release tarball
updpkgsums                       # or: makepkg -g >> PKGBUILD
# 3. regenerate .SRCINFO (required by the AUR)
makepkg --printsrcinfo > .SRCINFO
# 4. mirror PKGBUILD + .SRCINFO to the AUR repo and push
```

`makepkg --verifysource` is a quick check that the source URL and checksum are
right without a full build.

## Notes

- `fish` is an optional dependency (the last-command bar uses fish's OSC 133
  events); the shell otherwise follows `$SHELL`.
- Architecture: `x86_64` only for now.
- No Veldmuis keyring or repository is involved; AUR users build locally.
