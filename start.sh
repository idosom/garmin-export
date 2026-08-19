#!/usr/bin/env bash
#
# Starts the dashboard and opens it in your browser.
#
#   ./start.sh          serve on this computer only
#   ./start.sh --lan    also allow other devices on your network (phone, tablet)
#
# The first run installs dependencies and builds the app, which takes a minute.
# After that it starts in a couple of seconds.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
HOST_FLAG=()
for arg in "$@"; do
  case "$arg" in
    --lan|--host) HOST_FLAG=(--host) ;;
    --port=*) PORT="${arg#*=}" ;;
    -h|--help)
      awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "$0"
      exit 0
      ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

if ! command -v node >/dev/null 2>&1; then
  warn "Node.js is not installed."
  echo
  echo "This app is built with Node. Install it once from https://nodejs.org"
  echo "(the LTS download), then double-click this file again."
  echo
  read -r -p "Press Return to close. " _ || true
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $(node -v) is too old — Node 20 or newer is needed."
  echo "Update it from https://nodejs.org and run this again."
  read -r -p "Press Return to close. " _ || true
  exit 1
fi

if [ ! -d node_modules ]; then
  say "First run: installing dependencies (once, ~30 seconds)…"
  npm install --no-audit --no-fund
fi

# Rebuild when the sources are newer than the last build.
needs_build=0
if [ ! -f dist/index.html ]; then
  needs_build=1
elif [ -n "$(find src index.html vite.config.ts package.json -newer dist/index.html 2>/dev/null | head -n 1)" ]; then
  needs_build=1
fi
if [ "$needs_build" = "1" ]; then
  say "Building the app…"
  npm run build
fi

URL="http://localhost:${PORT}"
say "Starting Garmin Dashboard on ${URL}"
if [ ${#HOST_FLAG[@]} -gt 0 ]; then
  echo "Other devices on your network can use the Network address printed below."
fi
echo "Leave this window open while you use the app. Press Ctrl-C to stop."
echo

# Open the browser once the server is actually listening. Not finding a browser
# (a headless box, an SSH session) must not take the server down with it.
(
  for _ in $(seq 1 40); do
    if curl -fsS -o /dev/null "$URL" 2>/dev/null; then break; fi
    sleep 0.25
  done
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &

exec npx vite preview --port "$PORT" "${HOST_FLAG[@]+"${HOST_FLAG[@]}"}"
