#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DEFAULT_GUEST_DATA_DIR = Path(__file__).resolve().parents[2].parent / "tbpn-guests-research"
YOUTUBE_CSV = "tbpn-youtube-guest-timestamps.csv"
CATALOG_JSON = "tbpn-guests-all.json"
BATCH_SIZE = 200


@dataclass
class AppearanceRow:
    person: str
    video_id: str
    episode_date: str
    start_seconds: int
    end_seconds: int | None
    chapter_title: str
    timestamp_url: str
    source_type: str


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def get_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return create_client(url, key)


def load_catalog(data_dir: Path) -> dict[str, dict[str, str | None]]:
    catalog_path = data_dir / CATALOG_JSON
    if not catalog_path.exists():
        return {}

    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    lookup: dict[str, dict[str, str | None]] = {}
    for row in payload:
        person = str(row.get("person") or "").strip()
        if not person:
            continue
        lookup[normalize_name(person)] = {
            "person": person,
            "company": (row.get("company") or None),
            "job_position": (row.get("job_position") or None),
        }
    return lookup


def split_guest_names(raw: str) -> list[str]:
    parts = re.split(r"\s*;\s*|\s+and\s+", raw.strip(), flags=re.IGNORECASE)
    return [part.strip() for part in parts if part.strip()]


def read_youtube_rows(data_dir: Path) -> list[dict[str, str]]:
    csv_path = data_dir / YOUTUBE_CSV
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing guest CSV: {csv_path}")

    with csv_path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def resolve_person_name(raw_name: str, catalog: dict[str, dict[str, str | None]]) -> str:
    normalized = normalize_name(raw_name)
    if normalized in catalog:
        return str(catalog[normalized]["person"])

    for key, value in catalog.items():
        if normalized in key or key in normalized:
            return str(value["person"])

    return raw_name.strip()


def build_appearances(data_dir: Path) -> list[AppearanceRow]:
    catalog = load_catalog(data_dir)
    raw_rows = read_youtube_rows(data_dir)
    expanded: list[dict[str, str | int]] = []

    for row in raw_rows:
        guest_raw = (row.get("guest_name_guess") or "").strip()
        video_id = (row.get("video_id") or "").strip()
        episode_date = (row.get("episode_date") or "").strip()
        timestamp_url = (row.get("timestamp_url") or "").strip()
        chapter_title = (row.get("chapter_title") or "").strip()
        start_seconds_raw = (row.get("start_seconds") or "").strip()

        if not guest_raw or not video_id or not episode_date or not timestamp_url:
            continue

        try:
            start_seconds = int(start_seconds_raw)
        except ValueError:
            continue

        for guest_name in split_guest_names(guest_raw):
            person = resolve_person_name(guest_name, catalog)
            expanded.append(
                {
                    "person": person,
                    "video_id": video_id,
                    "episode_date": episode_date,
                    "start_seconds": start_seconds,
                    "chapter_title": chapter_title,
                    "timestamp_url": timestamp_url,
                    "source_type": "youtube_chapter",
                }
            )

    by_video: dict[str, list[dict[str, str | int]]] = defaultdict(list)
    for row in expanded:
        by_video[str(row["video_id"])].append(row)

    appearances: list[AppearanceRow] = []
    for video_id, rows in by_video.items():
        rows.sort(key=lambda item: int(item["start_seconds"]))
        for index, row in enumerate(rows):
            next_start = (
                int(rows[index + 1]["start_seconds"]) if index + 1 < len(rows) else None
            )
            end_seconds = next_start - 1 if next_start is not None else None
            appearances.append(
                AppearanceRow(
                    person=str(row["person"]),
                    video_id=video_id,
                    episode_date=str(row["episode_date"]),
                    start_seconds=int(row["start_seconds"]),
                    end_seconds=end_seconds,
                    chapter_title=str(row["chapter_title"]),
                    timestamp_url=str(row["timestamp_url"]),
                    source_type=str(row["source_type"]),
                )
            )

    return appearances


def upsert_guest_names(
    client: Client,
    appearances: list[AppearanceRow],
    catalog: dict[str, dict[str, str | None]],
) -> dict[str, str]:
    unique_people = sorted({row.person for row in appearances})
    name_rows = []
    for person in unique_people:
        meta = catalog.get(normalize_name(person), {})
        name_rows.append(
            {
                "person": person,
                "normalized_name": normalize_name(person),
                "company": meta.get("company"),
                "job_position": meta.get("job_position"),
            }
        )

    id_by_person: dict[str, str] = {}
    for start in range(0, len(name_rows), BATCH_SIZE):
        batch = name_rows[start : start + BATCH_SIZE]
        response = (
            client.table("guest_names")
            .upsert(batch, on_conflict="person")
            .execute()
        )
        for row in response.data or []:
            id_by_person[str(row["person"])] = str(row["id"])

    return id_by_person


def replace_appearances(
    client: Client,
    appearances: list[AppearanceRow],
    id_by_person: dict[str, str],
) -> int:
    client.table("guest_appearances").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    rows = []
    for appearance in appearances:
        guest_name_id = id_by_person.get(appearance.person)
        if not guest_name_id:
            continue
        rows.append(
            {
                "guest_name_id": guest_name_id,
                "video_id": appearance.video_id,
                "episode_date": appearance.episode_date,
                "start_seconds": appearance.start_seconds,
                "end_seconds": appearance.end_seconds,
                "chapter_title": appearance.chapter_title,
                "timestamp_url": appearance.timestamp_url,
                "source_type": appearance.source_type,
            }
        )

    inserted = 0
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        client.table("guest_appearances").upsert(
            batch,
            on_conflict="guest_name_id,video_id,start_seconds",
        ).execute()
        inserted += len(batch)

    return inserted


def import_guests(data_dir: Path) -> dict[str, int]:
    client = get_supabase_client()
    catalog = load_catalog(data_dir)
    appearances = build_appearances(data_dir)
    id_by_person = upsert_guest_names(client, appearances, catalog)
    appearance_count = replace_appearances(client, appearances, id_by_person)

    return {
        "guest_names": len(id_by_person),
        "appearances": appearance_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import TBPN guest appearances into Supabase")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(os.environ.get("GUEST_DATA_DIR", DEFAULT_GUEST_DATA_DIR)),
        help="Directory containing tbpn-youtube-guest-timestamps.csv",
    )
    args = parser.parse_args()

    stats = import_guests(args.data_dir)
    print(f"Imported {stats['guest_names']} guest names")
    print(f"Imported {stats['appearances']} guest appearances")


if __name__ == "__main__":
    main()
