#!/usr/bin/env bash
set -u

cd "$(dirname "$0")"
source .venv/bin/activate

echo "Starting TBPN backfill (Ctrl+C to stop)..."
python -m tbpn_ingest ingest --skip-done "$@"
exit_code=$?

if [ "$exit_code" -eq 0 ]; then
  echo "Backfill process exited cleanly."
else
  echo "Backfill process exited with code $exit_code"
fi

exit "$exit_code"
