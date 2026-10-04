# Windows

Windows ships as a **portable, per-user artifact**: nothing installed, no
admin, no registry keys, no Start Menu entry. This is deliberate — muis
should run from a USB stick or a locked-down work machine without leaving
traces.

## What ships

`muis-portable-<version>.zip` containing, at the top level:

```text
muis.exe            Tauri shell (WebView2 window + xterm frontend)
muis-worker.exe     pty sidecar, resolved as a sibling of muis.exe
muis-notify.exe     CLI: send a notification to the running muis window
```

Unzip anywhere (Desktop, USB stick, `%LOCALAPPDATA%\muis`) and run
`muis.exe`.

## Requirements on the work machine

- 64-bit Windows 10 1803+ / Windows 11 (WebView2 ships with Windows).
- If WebView2 was stripped (rare LTSC): run the Evergreen Standalone
  Installer with `/passive` — per-user, no admin — then start muis.

## Building

CI does this: `.github/workflows/ci.yml` (`windows-portable` artifact) and
`.github/workflows/release.yml` (`windows` signed release asset).

Manual recipe on a Windows machine with Rust stable:

```powershell
cargo build --release -p muis-shell -p muis-worker -p muis-notify
Compress-Archive -Path target\release\muis.exe,target\release\muis-worker.exe,target\release\muis-notify.exe `
  -DestinationPath muis-portable-<version>.zip
```

The frontend is embedded in `muis.exe` at compile time from
`src-ui/dist` (rebuild it first with `npm run build`).

## Shells and state

Probe order: `pwsh` → `powershell` → `cmd`. State lives in
`%APPDATA%\muis` (sessions, snapshots). Deleting that folder resets muis
to first-run with no uninstall step needed.

## Verification

- v1.0.0 portable zip was tested on real Windows (maintainer).
- Re-check per release:
  - unzip anywhere and run `muis.exe`; no UAC/admin prompt, no install;
  - shell probe picks `pwsh` / `powershell` / `cmd`;
  - state is written to `%APPDATA%\muis`, and deleting it resets;
  - `muis-notify --body done` from a tab raises a toast.

## Per-user installer (optional, not planned)

A per-user NSIS installer would also avoid admin, but it *does* install
(Start Menu entry, uninstaller, registry). Portable stays the supported
artifact; revisit only if Start Menu integration is wanted. Tauri's
`crates/muis-shell/tauri.conf.json` `bundle.windows` is intentionally
empty until then.

## Why portable over installed

- No admin/UAC, so it runs on locked-down work machines.
- Nothing appears in Add/Remove Programs or the Start Menu.
- State is a single deletable folder; no uninstaller required.
- Same layout on every platform: `muis` + `muis-worker[.exe]` siblings.
