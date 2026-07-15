#!/usr/bin/env bash
set -euo pipefail

INGEST_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$INGEST_DIR/.." && pwd)"
LOG_FILE="$INGEST_DIR/daily_sync.log"

{
  echo "===== $(date -Iseconds) daily sync start ====="
  cd "$INGEST_DIR"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  source .venv/bin/activate
  bash scripts/daily_sync.sh
  echo "===== $(date -Iseconds) daily sync done ====="
} >>"$LOG_FILE" 2>&1
