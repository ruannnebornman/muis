# muis architecture pivot: Rust + xterm.js in Tauri

Date: 2026-09-26. Discussion + recommendation. Packaging/Veldmuis details are context only here.

## 1. Goals (settled)

- Linux: normal Arch package, Veldmuis default terminal. No portable-Linux needed. Arch-only.
- Windows: portable, no admin. Unzip-and-run exe and/or per-user small installer.
- Look: match `design/mock.html` exactly (Muis Dark `#1b120d` / `#f3d7a0` / `#8f4b28`, sessions column, side default + top option, 8px radii).
- Feel: open once, keep open. Long-running sessions, multiple agents/tasks, scrollback + session restore matters more than cold-start ms.
- Stack direction: Rust backend + xterm.js frontend in a native window (Tauri 2). No browser-tab workflow.
- RAM overhead acceptable if it buys function + looks. Otherwise user keeps PowerShell/WezTerm.

## 2. Recommendation

One codebase, two artifacts from the same Rust + TS source:

```
muis/
  src-core/   Rust: workspaces/sessions, pty spawn, scrollback snapshots, IPC
  src-ui/     TS + xterm.js (webgl, search, serialize, ligatures) + CSS from mock.html
  src-shell/  Tauri 2 window: Linux (WebKitGTK) + Windows (WebView2)
  src-worker/ muis-pty-worker binary: one process per session (see §4)
```

- Frontend: xterm.js. It is the only way to hit mock.html 1:1 without hand-painting Qt, and it brings search, GPU render, images/sixel-ish, link handling, serialize for backups — all things qtermwidget lags on.
- Shell: Tauri 2. Same UI ships on both OSes. No browser needed; it is a real `.desktop` app on Veldmuis and a real `.exe` window on Windows.
- Backend: Rust with `portable-pty` (handles POSIX pty + Windows ConPTY behind one API), session manifest + scrollback snapshots on disk.

Why not alternatives:

- Stay Qt Widgets + qtermwidget: fastest, leanest, but custom chrome is paint-code pain, VT feature gap stays, and Windows portability becomes a second project (ship Qt DLLs).
- Electron portable: works, zero system deps (bundles Chromium), but ~180MB zip + 300MB+ RAM. Tauri is ~10–15MB binary + system WebView, ~120–180MB RAM. Since WebView2 ships with Win10/11, Tauri wins for a "small installer".
- Browser-tab daemon (`muis serve` + localhost URL): most portable, but explicitly rejected — user wants a real window.

## 3. Windows no-admin story (Tauri)

- Tauri 2 on Windows uses Edge WebView2, preinstalled on Win10 1803+ / Win11. So a portable zip (`muis.exe` + WebView2 check) runs without admin.
- Distribute two things: `muis-portable.zip` (unzip to Desktop/USB, run) and `muis-setup-user.exe` (NSIS per-user, installs to `%LOCALAPPDATA%\muis`, Start Menu shortcut, no UAC prompt). Both per-user, no admin.
- Single caveat: if a work machine has WebView2 stripped out (rare LTSC), ship the small Evergreen bootstrapper that installs WebView2 per-user. Detect at first run, prompt once.
- Shell default on Windows: `pwsh` if present, else `powershell.exe`, else `cmd`. Fish path stays Linux-only. Keep the default-shell probe in `src-core`, not in UI.

## 4. Process isolation: one crash must not kill all tabs

Yes, feasible, and worth doing given the long-running multi-agent use. Design for it now, ship it in phases.

Phase 1 (free): each tab already gets its own OS child via pty (shell/agents die without killing muis). This alone covers 90% of "crashes".

Phase 2 (the actual ask): one `muis-pty-worker` process per session/workspace:

```
muis (Tauri UI, one process)
 ├─ worker: session "home"     ── pty: fish/agent 1, pty: agent 2
 ├─ worker: session "veldmuis" ── pty: fish, pty: task 3
 └─ snapshots on disk per session
```

- UI spawns workers, talks over local IPC (Tauri sidecar + JSON lines, or localhost websocket with token). Worker owns pty I/O + scrollback ring.
- Worker dies (segfault/OOM/panic): UI marks that session "disconnected — scrollback preserved", offers Restart/Reconnect. Other sessions are untouched because they are other OS processes.
- Backups fall out of this naturally: worker appends scrollback snapshots + records cwd/env/title to `~/.local/share/muis/sessions/<id>/` (Linux) / `%APPDATA%` (Windows) every N seconds + on clean exit. Restart = respawn shell in same cwd, replay scrollback file, re-apply env. Same mechanism as tmux-resurrect / wezterm mux.
- Cost: ~2–5MB RAM per worker + IPC latency (~sub-ms local). Worth it. Keep an escape hatch: `--in-process` single-process mode for debugging.

Suggested order: single-process Tauri prototype first (prove the look + xterm), then extract the worker once tabs render. Do not start multiprocess on day one — get pixels right, then harden.

## 5. Feedback on the discussion

- Dropping portable-Linux simplifies a lot: no AppImage/matrix testing, Arch-only WebKitGTK dep is fine.
- Tauri-without-browser is the right call for work use: Alt-Tab identity, taskbar pin, no browser-chrome confusion, offline-safe.
- Long-lived over fast-start changes tuning: budget RAM for scrollback (e.g. 50k lines/tab with snapshot truncation), prioritize restore correctness over launch time.
- Per-process tabs is the single biggest reliability upgrade over the current Qt one-process design. Do it, but phase it after the UI lands.

## 6. FUSE / Discord / Steam / `~/.local` notes

- FUSE is already on Veldmuis: `veldmuis-common` depends on `fuse2` explicitly for AppImages (`packages/veldmuis-common/PKGBUILD:10`, `docs/packages.md:79`). `docs/troubleshooting.md:167` covers the `libfuse.so.2` case. So counting on FUSE being present is safe — but moot now since Linux ships as pacman, not AppImage.
- Discord and Steam do not need FUSE themselves. They ship as regular Arch packages (`veldmuis-gaming` depends on `steam`, `discord`). Only AppImage-distributed apps need `libfuse.so.2`. Don't conflate them.
- `no-sudo ~/.local` meant: a user-local install with no root — binaries in `~/.local/bin`, desktop entries in `~/.local/share/applications`, state in `~/.local/share`. The Windows equivalent is `%LOCALAPPDATA%` + per-user installer. Relevant for the Windows portable story above, not for Veldmuis system install.

## 8. Wayland/NVIDIA note (2026-09-26, verified on veldmuis GTX 1080 Ti)
Native Wayland launch died with `wl_display error ... "explicit sync is
used, but no acquire point is set"`: WebKitGTK's dmabuf fast path vs
KWin explicit sync on the proprietary NVIDIA driver. Not our bug —
plain GTK3 works, XWayland works — but we ship the workaround:
`muis-shell` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup unless
the user already set it (falls back to shared-memory compositing,
invisible for a terminal). Launching with `GDK_BACKEND=x11` is no
longer needed.

## 7. User answers (appended verbatim-ish, 2026-09-26)

1. Portable needed for Windows, not Linux. Linux installs as a normal package and is the Veldmuis default.
2. Rust + xterm on top is good. No browser workflow — Tauri 2 native window preferred.
3. Packaging/Veldmuis integration is context only, ignore for now.
4. No 100ms startup requirement. Open once, keep open like WezTerm; long sessions with backups, multiple agents/tasks.
5. Ask: split each tab/session into its own process so one crash doesn't kill the rest — feasible? → Yes (§4).
6. Arch-only. FUSE: Discord/Steam question; assumption AppImages work on machines of people trying a terminal like this — accepted with correction (§6). `~/.local` meaning asked — answered (§6).

## 9. Design target change (2026-09-26)

`design/mock.html` (Muis Dark) is SUPERSEDED by
`../wezterm-web/index.html` (Breeze chrome, blue accent): custom
titlebar with search + window controls, 248px sessions sidebar with
per-name color tiles, browser tabbar with done states, statusbar
(session/tab pill, cwd, git, user, clock, shell). Frontend mirrors its
exact classes. Side-tabs mode is gone (the new target has none);
`tabsOnTop` still parses in config files but is ignored.
