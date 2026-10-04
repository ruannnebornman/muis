# muis roadmap (v2: Rust + xterm.js + Tauri)

Target: `../wezterm-web/index.html` (Breeze chrome, blue accent).
`design/mock.html` (Muis Dark) is superseded.
The v1 Qt roadmap is superseded; its behavior specs (sessions as
folder-workspaces, dirty-tab confirm, persistence) carry over and get
re-locked by the tests below.

Legend: `[x]` settled+locked · `[~]` decided, needs test · `[ ]` open.

## Settled (locked by tests)

- [x] Session model: workspaces with tabs, per-workspace visible tab,
      switching, close/remove clamping (`muis-core` session tests +
      `src-ui` sessions tests, same rules both sides)
- [x] Session JSON roundtrip incl. id-mint continuity after resume
- [x] Config load/save/defaults; corrupt file errors instead of
      silently resetting
- [x] Shell probe per platform (fish-first Linux, pwsh-first Windows)
- [x] UI/worker IPC: all 10 frames roundtrip + shared fixture
      (`tests/fixtures/ipc-frames.jsonl` tested from Rust AND TypeScript)
- [x] Worker stdio roundtrip: real pty echo, snapshot contains output,
      `exit 42` propagates, unknown-pty/duplicate-id/bad-shell error
- [x] Theme locked to the mock palette + shape (vitest)
- [x] Persistence: metadata save/load, scrollback snapshots to disk,
      one-time replay per tab on restore, cleanup on close
- [x] Search controller (open/close/next/prev/clear, missing addon)
- [x] AppConfig per-field fallback + effective font size
- [x] Busy-tab rules (young/recent-output, exited never, forget)
- [x] OSC 7/0/2 observer incl. split chunks, title placeholder rule
- [x] Side-panel registry (toggle/single-visible/unregister)
- [x] File persistence helpers (missing→empty, garbage rejected,
      snapshot paths can't escape)
- [x] Breeze re-theme: titlebar+search+win controls, sessions sidebar
      with per-name tiles, browser tabbar with done states, statusbar
      (session/tab, cwd, git branch, user, clock, shell)
- [x] Window commands (minimize/toggle-maximize/close) + capabilities
- [x] git_branch + sys_info shell commands
- [x] CWD-aware new tabs: new tabs inherit the active tab's live
      shell-reported cwd (OSC 7), falling back to the workspace dir
      (`newTabCwd` + `sessions` tests)
- [x] CI green: workflow runs on PRs and `main` pushes (rust, ui,
      browser-e2e, native-xvfb-e2e, windows-portable)
- [x] One `muis-worker` process per session; UI holds no pty state:
      `WorkerPool` keeps one child per session, spawn is idempotent,
      and stopping one session leaves the others running (bridge tests
      via an injected event sink)

## Decided (code done, coverage to verify)

- [~] Tauri 2 shell, worker binary resolved as a sibling sidecar
- [~] NVIDIA workarounds (dmabuf renderer off; canvas renderer until
      WebGL is proven in the WebKit window)

## To build (in suggested order)

- [ ] Nothing open here; the remaining coverage items sit under
      "Decided" above.

## Moved

- Windows (portable three-exe zip, on-machine verification, and the
  optional per-user installer): `docs/windows.md`.

## Deferred

Parked until the terminal itself is polished. See `docs/deferred.md`:

- Snor engine (slot API is ready)
- Make muis the default terminal on Veldmuis
- neofetch/fastfetch branding
- Windows per-user installer (optional; portable zip stays primary)
