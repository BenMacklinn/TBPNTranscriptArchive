#!/usr/bin/env python3
"""Apply pending SQL migrations when a direct Postgres connection is available."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MIGRATIONS = [
    ROOT / "supabase/migrations/20260528120000_guest_appearances.sql",
    ROOT / "supabase/migrations/20260528120100_hybrid_search_time_window.sql",
]


def build_database_url() -> str | None:
    if url := os.environ.get("DATABASE_URL"):
        return url

    password = os.environ.get("SUPABASE_DB_PASSWORD")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF", "flqitkskfxqsuipukyzc")
    if not password:
        return None

    return (
        f"postgresql://postgres.{project_ref}:{password}"
        f"@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply guest search SQL migrations")
    parser.add_argument(
        "files",
        nargs="*",
        type=Path,
        default=DEFAULT_MIGRATIONS,
        help="Migration SQL files to execute in order",
    )
    args = parser.parse_args()

    database_url = build_database_url()
    if not database_url:
        print(
            "Set DATABASE_URL or SUPABASE_DB_PASSWORD to apply migrations.\n"
            "Alternatively, run the SQL files in the Supabase SQL editor.",
            file=sys.stderr,
        )
        return 1

    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
        return 1

    for path in args.files:
        if not path.exists():
            print(f"Missing migration file: {path}", file=sys.stderr)
            return 1

    with psycopg2.connect(database_url) as connection:
        connection.autocommit = True
        with connection.cursor() as cursor:
            for path in args.files:
                sql = path.read_text(encoding="utf-8")
                print(f"Applying {path.name}...")
                cursor.execute(sql)
                print(f"Applied {path.name}")

    print("Migrations applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
