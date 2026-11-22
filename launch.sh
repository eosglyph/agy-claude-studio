#!/usr/bin/env bash
# Launch Antigravity with CDP remote debugging enabled (--remote-debugging-port=0)
# and start the Claude Studio watcher (managed exit-on-close by default, or --daemon).
# Usage: ./launch.sh [--relaunch] [--daemon]
set -euo pipefail
cd "$(dirname "$0")"
INJECT_JS="$PWD/inject.js"

DAEMON=0
LAUNCH_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--daemon" ]; then
    DAEMON=1
  else
    LAUNCH_ARGS+=("$arg")
  fi
done

if [ ${#LAUNCH_ARGS[@]} -gt 0 ]; then
  node "$INJECT_JS" --launch "${LAUNCH_ARGS[@]}"
else
  node "$INJECT_JS" --launch
fi

if [ "$DAEMON" = "1" ]; then
  nohup node "$INJECT_JS" --watch --replace >/dev/null 2>>watch.log </dev/null &
  echo "[✓] Claude Studio daemon watcher started (PID $!)"
  exit 0
fi

# Managed mode (default): fail-closed PID ownership and graceful dedup are handled by inject.js
nohup node "$INJECT_JS" --watch --exit-on-host-close --skip-if-running >/dev/null 2>>watch.log </dev/null &
echo "[✓] Claude Studio managed watcher started (PID $!)"
