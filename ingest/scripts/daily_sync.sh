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

read -r SINCE_DATE UNTIL_DATE <<EOF
$(
  python3 - <<'PY'
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

tz = ZoneInfo("America/Los_Angeles")
today = datetime.now(tz).date()
yesterday = today - timedelta(days=1)

if target := os.environ.get("INGEST_DATE", "").strip():
    print(target, target)
else:
    lookback_days = int(os.environ.get("INGEST_LOOKBACK_DAYS", "7"))
    since = today - timedelta(days=lookback_days)
    print(since.isoformat(), yesterday.isoformat())
PY
)
EOF

echo "Starting TBPN daily caption ingest for ${SINCE_DATE} through ${UNTIL_DATE} (America/Los_Angeles)..."
python -m tbpn_ingest ingest --full --skip-done --since "$SINCE_DATE" --until "$UNTIL_DATE"
