#!/bin/zsh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$APP_DIR/.dropboard-server.pid"
LOG_FILE="$APP_DIR/.dropboard-server.log"
PORT_FILE="$APP_DIR/.dropboard-server.port"
PORT_MIN=8787
PORT_MAX=8799

cleanup_stale_pid() {
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
      if ps -p "$old_pid" -o command= | grep -q "dropboard_server.py"; then
        kill "$old_pid" 2>/dev/null || true
        sleep 0.5
        kill -9 "$old_pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
  fi
}

pick_port() {
  for port in $(seq "$PORT_MIN" "$PORT_MAX"); do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi
  done
  return 1
}

main() {
  cd "$APP_DIR"

  if ! command -v python3 >/dev/null 2>&1; then
    osascript -e 'display dialog "DropBoard needs python3, but it is not available on this Mac." buttons {"OK"} default button "OK" with icon stop'
    exit 1
  fi

  cleanup_stale_pid

  local port
  if ! port="$(pick_port)"; then
    osascript -e 'display dialog "No available ports in range 8787-8799 for DropBoard." buttons {"OK"} default button "OK" with icon stop'
    exit 1
  fi

  : > "$LOG_FILE"
  echo "$port" > "$PORT_FILE"
  nohup python3 "$APP_DIR/dropboard_server.py" --port "$port" --dir "$APP_DIR" >> "$LOG_FILE" 2>&1 &
  local server_pid=$!
  echo "$server_pid" > "$PID_FILE"

  sleep 0.8
  if ! kill -0 "$server_pid" 2>/dev/null; then
    osascript -e 'display dialog "DropBoard server failed to start. See .dropboard-server.log" buttons {"OK"} default button "OK" with icon stop'
    exit 1
  fi

  open "http://127.0.0.1:${port}/DropBoard.html"
}

main "$@"
