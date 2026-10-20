#!/usr/bin/env bash
# Launch the real Tauri + WebKit app under Xvfb with isolated XDG state.
# The debug-only MUIS_TEST_COMMAND hook sends a unique command through the
# frontend -> Tauri bridge -> per-session worker -> real PTY path after the
# shell's first output. This avoids mouse/keyboard/window-manager focus
# flakiness while exercising the production terminal pipeline.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="${MUIS_ARTIFACT_DIR:-$ROOT/tests/e2e/artifacts/live-x11}"
mkdir -p "$ARTIFACT_DIR"
RUN_DIR="$(mktemp -d "$ARTIFACT_DIR/run.XXXXXX")"
STATE_HOME="$RUN_DIR/state"
CONFIG_HOME="$RUN_DIR/config"
mkdir -p "$STATE_HOME" "$CONFIG_HOME"
MARKER="MUIS_XVFB_${RANDOM}_${RANDOM}_$(date +%s)"
MARKER_FILE="$RUN_DIR/marker"
SCREENSHOT="$RUN_DIR/screenshot.png"
LOG="$RUN_DIR/muis.log"

# Stage the binaries the way a package ships them: `muis` + a sibling
# `muis-worker`. Running from this directory exercises worker_path()
# resolving the sidecar relative to the shell's own location, instead of
# the target/debug directory where cargo happens to leave both.
INSTALL_DIR="$RUN_DIR/install"
mkdir -p "$INSTALL_DIR"
cp "$ROOT/target/debug/muis" "$INSTALL_DIR/muis"
cp "$ROOT/target/debug/muis-worker" "$INSTALL_DIR/muis-worker"
cp "$ROOT/target/debug/muis-notify" "$INSTALL_DIR/muis-notify"

export ROOT STATE_HOME CONFIG_HOME MARKER MARKER_FILE SCREENSHOT LOG RUN_DIR INSTALL_DIR
# Use a distinct per-run socket so the smoke never fights a real muis for the
# per-user socket (CI has none, but a developer's session does).
export MUIS_SOCKET_NAME="muis-notify-live-${RANDOM}${RANDOM}"
# Write the marker to a file (proves the command reached the real shell),
# then emit each notification protocol so the frontend's OSC observer
# exercises the real notify path (OSC 9, OSC 777, OSC 99), then drive the
# real `muis-notify` CLI against the visible tab. The CLI takes the tab
# from `MUIS_TAB_ID`, which the worker injects into the pty, so the smoke
# does not depend on the store's id counter.
export MUIS_TEST_COMMAND="printf %s $MARKER > $MARKER_FILE; printf '\033]9;muis-osc9\007\033]777;notify;muis-osc777;body777\007\033]99;i=1:d=1;muis-osc99\007'; $INSTALL_DIR/muis-notify --title muis-live --body cli-notify"
export GDK_BACKEND=x11
export LIBGL_ALWAYS_SOFTWARE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export XDG_STATE_HOME="$STATE_HOME"
export XDG_CONFIG_HOME="$CONFIG_HOME"

xvfb-run -a -s "-screen 0 1280x800x24" bash -Eeuo pipefail -c '
  "$INSTALL_DIR/muis" >"$LOG" 2>&1 &
  app_pid=$!
  cleanup() {
    if kill -0 "$app_pid" 2>/dev/null; then
      kill -TERM "$app_pid" 2>/dev/null || true
      for _ in $(seq 1 30); do
        kill -0 "$app_pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -KILL "$app_pid" 2>/dev/null || true
      wait "$app_pid" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT

  # Keep a startup capture and frontend phase log even if initialization
  # or persistence fails, so runner failures can be diagnosed.
  sleep 5
  import -window root "$RUN_DIR/startup.png"

  deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if grep -Fq "initial-render-complete" "$LOG"; then
      break
    fi
    if ! kill -0 "$app_pid" 2>/dev/null; then
      echo "muis exited before initializing; log: $LOG" >&2
      exit 1
    fi
    sleep 0.2
  done
  if ! grep -Fq "initial-render-complete" "$LOG"; then
    echo "timed out waiting for frontend initial render; log: $LOG" >&2
    exit 1
  fi

  deadline=$((SECONDS + 50))
  found=0
  while (( SECONDS < deadline )); do
    if grep -Fq "$MARKER" "$MARKER_FILE" 2>/dev/null; then
      found=1
      break
    fi
    sleep 0.5
  done

  import -window root "$SCREENSHOT"
  if (( ! found )); then
    echo "test command marker never reached the real PTY: $MARKER" >&2
    echo "test artifacts: $RUN_DIR" >&2
    exit 1
  fi

  # Every notification protocol emitted by the test command must reach the
  # frontend and be routed (applyNotification logs a debug stage).
  notify_deadline=$((SECONDS + 20))
  while (( SECONDS < notify_deadline )); do
    if grep -Fq '"source":"osc9"' "$LOG" \
      && grep -Fq '"source":"osc777"' "$LOG" \
      && grep -Fq '"source":"osc99"' "$LOG"; then
      break
    fi
    sleep 0.3
  done
  for source in osc9 osc777 osc99; do
    if ! grep -Fq "\"source\":\"$source\"" "$LOG"; then
      echo "notification protocol $source never reached the frontend" >&2
      echo "test artifacts: $RUN_DIR" >&2
      exit 1
    fi
  done

  # The real `muis-notify` CLI must reach the frontend.
  cli_deadline=$((SECONDS + 20))
  while (( SECONDS < cli_deadline )); do
    if grep -Fq "\"source\":\"cli\"" "$LOG"; then
      break
    fi
    sleep 0.3
  done
  if ! grep -Fq "\"source\":\"cli\"" "$LOG"; then
    echo "muis-notify CLI notification never reached the frontend" >&2
    echo "test artifacts: $RUN_DIR" >&2
    exit 1
  fi


  echo "PASS: native Tauri UI -> worker -> PTY smoke ($MARKER)"
  echo "Screenshot: $SCREENSHOT"
  echo "Artifacts: $RUN_DIR"
'
