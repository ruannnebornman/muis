# Windows

Windows ships as a **portable, per-user artifact**: nothing installed, no
admin, no registry keys, no Start Menu entry. This is deliberate — muis
should run from a USB stick or a locked-down work machine without leaving
traces.

## What ships

A zip containing a single self-contained executable:

```text
muis-<version>-x86_64-windows.zip
└── muis.exe
```

It is zipped because a bare `.exe` download trips Chrome/Edge's "this type
of file can harm your computer" and SmartScreen's "isn't commonly
downloaded" warnings; `.zip` is not on their risky-type list, so the
download is quiet. Unzip it anywhere (Desktop, USB stick, `%LOCALAPPDATA%\muis`)
and run `muis.exe`.

`muis.exe` links the pty worker and the `muis-notify` / `muis-agent` CLIs
and runs them in hidden `--muis-worker` / `--muis-notify` / `--muis-agent`
modes, so there are no sidecar files to keep next to it. Both modes run in the same consoleless GUI
process (release builds are `windows-subsystem`), so no CLI window ever
appears.

On first run muis copies itself to
`%LOCALAPPDATA%\muis\bin\muis-worker-<stamp>.exe` and starts the worker from
that copy. It has to: a downloaded/extracted exe carries a Mark-of-the-Web,
and Windows denies a program starting such a file (`Access is denied`, os
error 5) even when you can force-launch it yourself — spawning the worker
from the unzipped `muis.exe` fails. A file muis writes has no MOTW, so the
copy starts fine. Old copies are pruned on the next launch.

## Requirements on the work machine

- 64-bit Windows 10 1803+ / Windows 11 (WebView2 ships with Windows).
- If WebView2 was stripped (rare LTSC): run the Evergreen Standalone
  Installer with `/passive` — per-user, no admin — then start muis.

## Building

CI does this: `.github/workflows/ci.yml` (`windows-single-exe` job,
`muis-windows` artifact) and `.github/workflows/release.yml` (`windows`
release asset).

Manual recipe on a Windows machine with Rust stable:

```powershell
cargo build --release -p muis-shell
Compress-Archive -Path target\release\muis.exe "muis-<version>-x86_64-windows.zip"
```

Only the shell target is built: on Windows it links `muis-worker`,
`muis-notify`, and `muis-agent`, so no separate sidecars exist. The frontend is embedded in
`muis.exe` at compile time from `src-ui/dist` (rebuild it first with
`npm run build`).

## Shells and state

Probe order: `pwsh` → `powershell` → `cmd`. State lives in
`%APPDATA%\muis` (config). Diagnostics live in
`%LOCALAPPDATA%\muis\logs` and the staged worker copy in
`%LOCALAPPDATA%\muis\bin`. Deleting those folders resets muis to first-run
with no uninstall step needed; the worker copy is re-staged on next launch.

## Diagnostics

Release builds have no console, so runtime diagnostics go to
`%LOCALAPPDATA%\muis\logs\muis.log`. If that file is missing after a launch
attempt, the process never started — an OS-level block (Defender/ASR or a
persistent "blocked" file attribute), not a muis failure.

If the log shows `failed to start worker … Access is denied. (os error 5)`,
the worker could not be started. muis already stages the worker into
`%LOCALAPPDATA%\muis\bin` to dodge the Mark-of-the-Web case; if it still
fails, a machine policy (Defender ASR "block exe unless prevalent/aged/
trusted", AppLocker/WDAC) is blocking unsigned executables, which needs an
exclusion or code signing.

## Verification

- Re-check per release:
  - download the zip, unzip, and run `muis.exe`; no UAC/admin prompt, no
    install, and no extra console window;
  - shell probe picks `pwsh` / `powershell` / `cmd`;
  - state is written to `%APPDATA%\muis`, and deleting it resets;
  - `muis.exe --muis-notify --body done` from a tab raises a toast (the
    opencode plugin reaches it through `MUIS_BIN`);
  - `muis.exe --muis-agent session ses_test` from a tab updates that tab's
    saved agent session (the TUI/server plugins reach it through `MUIS_BIN`).

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
- Windows is one self-contained exe (in a zip); Linux packages still ship
  `muis` + `muis-worker` + `muis-notify` as siblings.
