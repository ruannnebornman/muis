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
  MainWindow.*    tab strip, terminal pages, sidebar slot
  snor/           assistant engine (later; CLI-first, panel last)
```
