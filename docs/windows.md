# Windows

Windows ships as a **portable, per-user artifact**: nothing installed, no
admin, no registry keys, no Start Menu entry. This is deliberate — muis
should run from a USB stick or a locked-down work machine without leaving
traces.

## What ships

A single self-contained executable:

```text
muis-<version>-x86_64-windows.exe
```

`muis.exe` links the pty worker and the `muis-notify` CLI and re-execs
itself in hidden `--muis-worker` / `--muis-notify` modes, so there are no
sidecar files to keep next to it. Both modes run in the same consoleless
GUI process (release builds are `windows-subsystem`), so no CLI window ever
appears.

Download it, drop it anywhere (Desktop, USB stick, `%LOCALAPPDATA%\muis`),
and run it. There is no unzip step and no sibling binary to lose.

## Requirements on the work machine

- 64-bit Windows 10 1803+ / Windows 11 (WebView2 ships with Windows).
- If WebView2 was stripped (rare LTSC): run the Evergreen Standalone
  Installer with `/passive` — per-user, no admin — then start muis.

## Building

CI does this: `.github/workflows/ci.yml` (`windows-single-exe` artifact)
and `.github/workflows/release.yml` (`windows` release asset).

Manual recipe on a Windows machine with Rust stable:

```powershell
cargo build --release -p muis-shell
Copy-Item target\release\muis.exe "muis-<version>-x86_64-windows.exe"
```

Only the shell target is built: on Windows it links `muis-worker` and
`muis-notify` and re-execs itself, so no separate sidecars exist. The
frontend is embedded in `muis.exe` at compile time from `src-ui/dist`
(rebuild it first with `npm run build`).

## Shells and state

Probe order: `pwsh` → `powershell` → `cmd`. State lives in
`%APPDATA%\muis` (sessions, snapshots); diagnostics live in
`%LOCALAPPDATA%\muis\logs`. Deleting those folders resets muis to
first-run with no uninstall step needed.

## Diagnostics

Release builds have no console, so runtime diagnostics go to
`%LOCALAPPDATA%\muis\logs\muis.log`. If that file is missing after a launch
attempt, the process never started — an OS-level block (Defender/ASR or a
persistent "blocked" file attribute), not a muis failure.

## Verification

- Re-check per release:
  - download and run the exe; no UAC/admin prompt, no install, and no extra
    console window;
  - shell probe picks `pwsh` / `powershell` / `cmd`;
  - state is written to `%APPDATA%\muis`, and deleting it resets;
  - `muis.exe --muis-notify --body done` from a tab raises a toast (the
    opencode plugin reaches it through `MUIS_BIN`).

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
- Windows is one self-contained exe; Linux packages still ship
  `muis` + `muis-worker` + `muis-notify` as siblings.
