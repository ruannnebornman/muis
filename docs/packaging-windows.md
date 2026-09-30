# Windows portable packaging

No admin required: everything installs and runs per-user.

## What ships

`muis-portable-<version>.zip` containing, at the top level:

```text
muis.exe            Tauri shell (WebView2 window + xterm frontend)
muis-worker.exe     pty sidecar, resolved as a sibling of muis.exe
muis-notify.exe     CLI: send a notification to the running muis window
```

No installer, no registry keys, no services. Unzip anywhere
(Desktop, USB stick, `%LOCALAPPDATA%\muis`) and run `muis.exe`.

## Requirements on the work machine

- 64-bit Windows 10 1803+ / Windows 11 (WebView2 ships with Windows).
- If WebView2 was stripped (rare LTSC): run the Evergreen Standalone
  Installer with `/passive` — per-user, no admin — then start muis.

## Building the zip (CI does this; manual recipe identical)

On a Windows machine with Rust stable:

```powershell
cargo build --release -p muis-shell -p muis-worker -p muis-notify
Compress-Archive -Path target\release\muis.exe,target\release\muis-worker.exe,target\release\muis-notify.exe `
  -DestinationPath muis-portable-<version>.zip
```

The frontend is embedded in `muis.exe` at compile time from
`src-ui/dist` (rebuild it first with `npm run build`).

## Shells

Probe order: `pwsh` → `powershell` → `cmd`. State lives in
`%APPDATA%\muis` (sessions, snapshots). Deleting that folder resets
muis to first-run with no uninstall step needed.

## Per-user installer (later, needs a Windows test box)

Tauri NSIS/WiX config in `crates/muis-shell/tauri.conf.json` is
intentionally minimal (`"windows": {}`) until installer behavior is
verified on real Windows: per-user Start Menu shortcut, no UAC.
The portable zip above is the supported artifact until then.
