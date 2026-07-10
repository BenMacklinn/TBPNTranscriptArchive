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

echo "Starting TBPN daily caption ingest..."
python -m tbpn_ingest ingest --full --skip-done
