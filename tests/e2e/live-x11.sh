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
SCREENSHOT="$RUN_DIR/screenshot.png"
LOG="$RUN_DIR/muis.log"

export ROOT STATE_HOME CONFIG_HOME MARKER SCREENSHOT LOG RUN_DIR
export MUIS_TEST_COMMAND="echo $MARKER"
export GDK_BACKEND=x11
export LIBGL_ALWAYS_SOFTWARE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export XDG_STATE_HOME="$STATE_HOME"
export XDG_CONFIG_HOME="$CONFIG_HOME"

xvfb-run -a -s "-screen 0 1280x800x24" bash -Eeuo pipefail -c '
  "$ROOT/target/debug/muis" >"$LOG" 2>&1 &
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

  sessions_dir="$STATE_HOME/muis/sessions"
  deadline=$((SECONDS + 50))
  found=0
  while (( SECONDS < deadline )); do
    if python3 - "$sessions_dir" "$MARKER" <<"PY"
import pathlib, sys
root, marker = pathlib.Path(sys.argv[1]), sys.argv[2].encode()
if root.exists():
    for path in root.glob("*.scrollback"):
        try:
            if marker in path.read_bytes():
                raise SystemExit(0)
        except OSError:
            pass
raise SystemExit(1)
PY
    then
      found=1
      break
    fi
    sleep 0.5
  done

  import -window root "$SCREENSHOT"
  if (( ! found )); then
    echo "test command marker never appeared in real PTY scrollback: $MARKER" >&2
    echo "test artifacts: $RUN_DIR" >&2
    exit 1
  fi

  if python3 - "$sessions_dir" <<"PY"
import pathlib, sys
root = pathlib.Path(sys.argv[1])
bad = (b"rgb:1d1d/2020", b"?1;2c")
for path in (root.glob("*.scrollback") if root.exists() else []):
    data = path.read_bytes()
    for token in bad:
        if token in data:
            print(f"echoed terminal reply {token!r} in {path}", file=sys.stderr)
            raise SystemExit(1)
PY
  then
    :
  else
    exit 1
  fi

  echo "PASS: native Tauri UI -> worker -> PTY smoke ($MARKER)"
  echo "Screenshot: $SCREENSHOT"
  echo "Artifacts: $RUN_DIR"
'
