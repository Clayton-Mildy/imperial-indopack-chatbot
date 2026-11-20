#!/bin/bash
# Starts the API and the dashboard together, in one terminal. Ctrl-C stops both.
#
# - API: built first (so code changes take effect), then `npm start` - no file-watch, so saving a
#   file cannot restart the bot in the middle of a customer's turn.
# - Dashboard: `npm run dev` (next dev on port 40070), as before.
#
# Usage, from the project folder:  ./start.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

for port in 50070 40070; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the API/dashboard that is running first:"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN
    exit 1
  fi
done

echo "Building the API..."
(cd "$ROOT/api" && npm run build)

# Ctrl-C, or either one exiting, stops everything this script started.
trap 'trap - INT TERM EXIT; echo; echo "Stopping API and dashboard..."; kill 0 2>/dev/null' INT TERM EXIT

(cd "$ROOT/api" && npm start 2>&1 | awk '{ print "[api] " $0; fflush() }') &
API=$!
(cd "$ROOT/dashboard" && npm run dev 2>&1 | awk '{ print "[web] " $0; fflush() }') &
WEB=$!

echo "API on http://localhost:50070, dashboard on http://localhost:40070 - Ctrl-C stops both."
while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null; do sleep 1; done
echo "One of them stopped - stopping the other."
