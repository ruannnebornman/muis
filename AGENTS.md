# muis agent instructions

## Project

- muis is a Rust/Tauri 2 terminal with a TypeScript/xterm.js frontend.
- Keep one `muis-worker` process per session; do not move PTY ownership
  into the UI process.
- Match the Breeze design target documented in `docs/build-progress.md`
  and `docs/target-mockup.png`. `design/mock.html` is superseded.
- Keep terminal/session behavior testable independently of Tauri where
  practical.

## Build and tests

- Rust: `cargo test --workspace --locked`
- UI: `npm ci --prefix src-ui`, then `npm test --prefix src-ui` and
  `npm run build --prefix src-ui`
- Selenium preview: serve `src-ui/dist`, then run
  `MUIS_URL=http://127.0.0.1:4173 npm test --prefix tests/e2e`
- Native PTY smoke without a physical desktop: after building the UI and
  Rust binaries and installing Xvfb, xdotool, and ImageMagick, run
  `npm run test:live:x11 --prefix tests/e2e`
- Native focus shortcut: Ctrl+Shift+F12 focuses the active terminal.
- When changing terminal visibility or navigation, keep the regression
  check that exactly one terminal surface is visible across sessions/tabs.

## Git and review

- Work in an isolated worktree on a neutral feature/fix/chore branch.
- `main` is a locked, read-only integration target: never commit or push
  to it, and never merge, approve, or enable auto-merge on a PR.
- The maintainer authorizes committing, pushing feature branches, and
  opening PRs for completed implementation tasks without a separate
  confirmation, unless a task says otherwise.
- Before a commit, inspect status and diffs; stage only intended files.
- PR base is `main`; include verification results and review all commits
  in the branch, not just the latest one.
