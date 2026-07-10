#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

required_vars=(
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  YOUTUBE_API_KEY
  OPENAI_API_KEY
  PINECONE_API_KEY
)

for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required environment variable: ${var}" >&2
    exit 1
  fi
done

TARGET_DATE="${INGEST_DATE:-$(
  python3 - <<'PY'
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

today = datetime.now(ZoneInfo("America/Los_Angeles")).date()
print((today - timedelta(days=1)).isoformat())
PY
)}"

echo "Starting TBPN daily caption ingest for ${TARGET_DATE} (America/Los_Angeles)..."
python -m tbpn_ingest ingest --full --skip-done --since "$TARGET_DATE" --until "$TARGET_DATE"
