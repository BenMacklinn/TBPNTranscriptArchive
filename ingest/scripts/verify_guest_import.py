#!/usr/bin/env python3
"""Spot-check guest import and scoped search prerequisites."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import create_client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

SHOLTO_VIDEO_ID = "quCu1lJOL40"
SHOLTO_START_SECONDS = 1891


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    client = create_client(url, key)

    try:
        names = (
            client.table("guest_names")
            .select("id, person")
            .ilike("person", "%Sholto Douglas%")
            .limit(1)
            .execute()
        )
    except APIError as error:
        message = error.message or str(error)
        if "guest_names" in message:
            print(
                "FAIL: guest_names table missing. Apply migrations first:\n"
                "  python scripts/apply_guest_migrations.py\n"
                "  or run supabase/migrations/20260528120000_guest_appearances.sql "
                "and 20260528120100_hybrid_search_time_window.sql in the SQL editor.",
            )
            return 1
        print(f"guest_names lookup failed: {message}")
        return 1
    if not names.data:
        print("FAIL: Sholto Douglas not found in guest_names")
        return 1

    guest_id = names.data[0]["id"]
    print(f"OK: found guest {names.data[0]['person']} ({guest_id})")

    appearances = (
        client.table("guest_appearances")
        .select("video_id, start_seconds, end_seconds")
        .eq("guest_name_id", guest_id)
        .eq("video_id", SHOLTO_VIDEO_ID)
        .eq("start_seconds", SHOLTO_START_SECONDS)
        .limit(1)
        .execute()
    )
    if appearances.error:
        print(f"guest_appearances lookup failed: {appearances.error.message}")
        return 1
    if not appearances.data:
        print(
            f"FAIL: missing appearance on {SHOLTO_VIDEO_ID} at {SHOLTO_START_SECONDS}s",
        )
        return 1

    row = appearances.data[0]
    print(
        f"OK: Sholto appearance window {row['start_seconds']}–{row['end_seconds']}s "
        f"on {row['video_id']}",
    )

    tyler = (
        client.table("guest_names")
        .select("id, person")
        .ilike("person", "%Tyler Cowen%")
        .limit(1)
        .execute()
    )
    if tyler.data:
        tyler_count = (
            client.table("guest_appearances")
            .select("id", count="exact")
            .eq("guest_name_id", tyler.data[0]["id"])
            .execute()
        )
        print(f"OK: Tyler Cowen has {tyler_count.count} appearance rows")
    else:
        print("WARN: Tyler Cowen not found in guest_names")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
