#!/usr/bin/env python3
"""Smoke-test hybrid/keyword search against ingested TBPN transcripts."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

SAMPLE_QUERIES = [
    "billionaire party",
    "AI energy",
    "OpenAI",
    "startup funding",
    "Trump",
    "crypto",
    "defense technology",
    "Mark Zuckerberg",
    "interest rates",
    "Silicon Valley",
]


def main() -> int:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase credentials")
        return 1

    client = create_client(url, key)
    zero_embedding = [0.0] * 1536
    passed = 0

    for query in SAMPLE_QUERIES:
        result = client.rpc(
            "hybrid_search",
            {
                "query_text": query,
                "query_embedding": zero_embedding,
                "match_count": 5,
            },
        ).execute()

        rows = result.data or []
        status = "ok" if rows else "no results"
        print(f"[{status}] {query!r} -> {len(rows)} matches")
        if rows:
            top = rows[0]
            print(
                f"       {top['published_at']} {top['start_time']} — "
                f"{top['chunk_text'][:100]}..."
            )
            passed += 1

    print(f"\n{passed}/{len(SAMPLE_QUERIES)} queries returned matches")
    return 0 if passed > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
