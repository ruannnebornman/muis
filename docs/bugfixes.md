# muis bugfixes

Reported bugs and small fixes. Documentation only — the implementation
agent fixes these. Feature requests live in `docs/features.md`, parked
work in `docs/deferred.md`, and the settled state in `ROADMAP.md`.

## Date/time in the status bar needs refinement

The bottom-right clock pill renders `Sun 2026-10-04 14:23:05`
(`clockText`, `src-ui/src/clock.ts:12`). Refine the presentation:

- Seconds tick noisily and steal attention; drop them, or make the
  format configurable.
- Reconsider order/locale (`Sun 2026-10-04` vs `04 Oct 2026`).
- Check pill width/alignment so it does not jump when the date rolls
  over at midnight or the day name length changes.
- Confirm spacing with the CPU/RAM/GPU and version pills in the right
  statusbar group (`src-ui/src/main.ts:1032-1037`).

## Clicking a tab or session should focus the terminal

Selecting a tab or session changes the visible surface but leaves
keyboard focus where it was, so typing does not reach the terminal until
the user clicks the terminal itself. Desired: selecting a tab/session
focuses its terminal so the user can type immediately.

- Tab click sets `ws.active` and calls `renderAll()` with no focus call
  (`tabElement`, `src-ui/src/main.ts:989`).
- Session click switches the workspace the same way (`sessionElement`,
  `src-ui/src/main.ts:898`).
- Reuse the existing `focus-terminal` path, which focuses the active
  view's `term` (`src-ui/src/main.ts:1223-1226`); the active tab is the
  view marked `active` in `renderTerms` (`src-ui/src/main.ts:1018-1023`).
- Do not steal focus on a drag (reorder) or double-click (rename), and
  do not fight the search box while it is open.

## Add tests

Cover the fixes above and the surrounding navigation behavior.

- Clock: `clock.test.ts` covers shape/padding; add a case for the refined
  format (and any configurable/locale variant).
- Tab/session selection focus: assert that selecting a tab or session
  focuses the active terminal, and that reorder/rename do not.
  Unit-test a decision helper instead of the DOM where practical.
- Keep the cross-session regression that exactly one terminal surface is
  visible (AGENTS.md) when touching terminal visibility or navigation.
