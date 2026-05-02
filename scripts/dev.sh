#!/usr/bin/env bash
# Start the FastAPI server and Vite dev server concurrently.
#
# Usage (file adapter — standalone, no quickq dependency):
#   bash scripts/dev.sh [questionnaire.json] [port]
#
# Usage (local adapter — writes responses directly to study.db):
#   bash scripts/dev.sh --db /path/to/study.db [--questionnaire-id 1] [--port 8000]
#
# Defaults to PHQ-9 fixture with file adapter if no arguments given.
# Ctrl-C stops both servers.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_FIXTURE="$REPO_ROOT/frontend/src/__tests__/fixtures/phq9_fhir_questionnaire.json"

# Parse arguments
DB_PATH=""
QUESTIONNAIRE_ID=1
API_PORT=8000
QUESTIONNAIRE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      DB_PATH="$2"; shift 2 ;;
    --questionnaire-id)
      QUESTIONNAIRE_ID="$2"; shift 2 ;;
    --port)
      API_PORT="$2"; shift 2 ;;
    *)
      QUESTIONNAIRE="$1"; shift ;;
  esac
done

cleanup() {
  echo ""
  echo "Stopping servers…"
  kill "$API_PID" "$VITE_PID" 2>/dev/null || true
  wait "$API_PID" "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$REPO_ROOT"

# Locate the quickq source tree. dev.sh needs source access (not just the
# installed CLI) because `quickq serve` cross-imports quickq-forms's `server`
# module, and quickq-forms's uv venv does not have quickq installed.
# Honors $QUICKQ_ROOT, then walks a list of common layouts.
find_quickq_root() {
  # Strict: an explicit QUICKQ_ROOT must point at a real quickq source tree.
  # Falling back silently would make "wrong path" bugs hard to debug.
  if [[ -n "${QUICKQ_ROOT:-}" ]]; then
    if [[ -f "$QUICKQ_ROOT/quickq/cli.py" ]]; then
      (cd "$QUICKQ_ROOT" && pwd)
      return 0
    fi
    echo "error: QUICKQ_ROOT='$QUICKQ_ROOT' does not contain quickq/cli.py" >&2
    return 1
  fi

  local candidates=(
    "$REPO_ROOT/../quickq"
    "$REPO_ROOT/../../quickq"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -f "$c/quickq/cli.py" ]]; then
      (cd "$c" && pwd)
      return 0
    fi
  done
  return 1
}

if [[ -n "$DB_PATH" ]]; then
  # Local adapter mode: write responses directly to study.db via quickq SDK
  if [[ ! -f "$DB_PATH" ]]; then
    echo "error: database not found: $DB_PATH" >&2
    exit 1
  fi
  DB_PATH="$(cd "$(dirname "$DB_PATH")" && pwd)/$(basename "$DB_PATH")"

  if ! QUICKQ_ROOT="$(find_quickq_root)"; then
    cat >&2 <<EOF
error: could not locate the quickq source tree.

dev.sh's local-adapter mode needs the quickq SOURCE checkout (not just the
installed \`quickq\` CLI), because \`quickq serve\` imports server modules from
this repo and the installed CLI's venv does not have them.

Set the QUICKQ_ROOT environment variable to your quickq clone, e.g.:

    QUICKQ_ROOT=/path/to/quickq bash scripts/dev.sh --db /path/to/study.db

Or clone quickq as a sibling of this repo:

    cd $(cd "$REPO_ROOT/.." && pwd) && git clone https://github.com/quickq-io/quickq.git
EOF
    exit 1
  fi

  echo "Starting API server (local adapter) on :$API_PORT  ($DB_PATH, questionnaire-id=$QUESTIONNAIRE_ID)"
  echo "  quickq source: $QUICKQ_ROOT"
  PYTHONPATH="$QUICKQ_ROOT:$REPO_ROOT" uv run python -c "
import sys
sys.argv = ['quickq', 'serve', '$DB_PATH', '--questionnaire-id', '$QUESTIONNAIRE_ID', '--port', '$API_PORT', '--no-browser']
from quickq.cli import main
main()
" &
  API_PID=$!
else
  # File adapter mode: serve questionnaire JSON and write responses to disk
  QUESTIONNAIRE="${QUESTIONNAIRE:-$DEFAULT_FIXTURE}"
  if [[ ! -f "$QUESTIONNAIRE" ]]; then
    echo "error: questionnaire file not found: $QUESTIONNAIRE" >&2
    exit 1
  fi
  QUESTIONNAIRE="$(cd "$(dirname "$QUESTIONNAIRE")" && pwd)/$(basename "$QUESTIONNAIRE")"

  echo "Starting API server (file adapter) on :$API_PORT  ($QUESTIONNAIRE)"
  PYTHONPATH="$REPO_ROOT" uv run quickq-forms serve "$QUESTIONNAIRE" --port "$API_PORT" &
  API_PID=$!
fi

echo "Starting Vite dev server on :5173"
cd "$REPO_ROOT/frontend"
npm run dev &
VITE_PID=$!

echo ""
echo "  API   → http://localhost:$API_PORT/health"
echo "  Form  → http://localhost:5173"
echo ""
echo "Press Ctrl-C to stop both servers."

wait
