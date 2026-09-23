# muis

muis is the terminal emulator for Veldmuis: a thin Qt6 Widgets wrapper
around `qtermwidget`. muis owns the window, left tab bar, and sidebar
chrome; VT emulation stays upstream.

Snor (optional assistant) lives in this repo under `src/snor/` and plugs
into the reserved sidebar slot. It is never required for Muis to work.

## Build

Dependencies (Arch): `cmake`, `qt6-base`, `qtermwidget`, `fish`.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/muis
```

## Layout

```text
src/
  main.cpp        application entry
  MainWindow.*    sessions, tab strip, menus, persistence
  SideTabBar.*    left/top tab strip, new-tab button, splitter
  SessionsPanel.* saved-session launcher
  snor/           assistant engine (later; CLI-first, panel last)
tests/
  test_sessions   dormant restore, session switching, restart roundtrip
  test_strip      tab geometry, button tracking, top mode, splitter drag
```

## Tests

Browser-style UI tests: real widgets, real mouse clicks, real fish
shells. Headless by default (offscreen platform, CI-safe); unset
`QT_QPA_PLATFORM` to watch them run.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```
