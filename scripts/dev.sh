#!/usr/bin/env bash
# Start the FastAPI server and Vite dev server concurrently.
#
# Usage (file adapter — standalone, no quickq dependency):
#   bash scripts/dev.sh [questionnaire.json] [port]
#
# Usage (local adapter — writes responses directly to study.db):
#   bash scripts/dev.sh --db /path/to/study.db [--questionnaire-id 1] [--port 8000]
#
# Both modes invoke `quickq-forms serve …` from this repo's uv venv. Local-adapter
# mode also requires `quickq` to be importable; pass --extra local to `uv sync`
# (or `uv pip install ../quickq` for development) before running.
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

if [[ -n "$DB_PATH" ]]; then
  # Local adapter mode: write responses directly to study.db via quickq SDK
  if [[ ! -f "$DB_PATH" ]]; then
    echo "error: database not found: $DB_PATH" >&2
    exit 1
  fi
  DB_PATH="$(cd "$(dirname "$DB_PATH")" && pwd)/$(basename "$DB_PATH")"

  echo "Starting API server (local adapter) on :$API_PORT  ($DB_PATH, questionnaire-id=$QUESTIONNAIRE_ID)"
  uv run quickq-forms serve --db "$DB_PATH" --questionnaire-id "$QUESTIONNAIRE_ID" \
    --port "$API_PORT" --no-browser &
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
  uv run quickq-forms serve "$QUESTIONNAIRE" --port "$API_PORT" --no-browser &
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
