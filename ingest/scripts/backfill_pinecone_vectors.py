#!/usr/bin/env python3
"""Copy existing Supabase embeddings into Pinecone without re-embedding."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

load_dotenv(REPO_ROOT / ".env")

from tbpn_ingest.load_supabase import get_supabase_client  # noqa: E402
from tbpn_ingest.pinecone_store import (  # noqa: E402
    PineconeChunkVector,
    describe_vector_count,
    ensure_pinecone_index,
    get_pinecone_namespace,
    upsert_chunk_vectors,
)


def parse_embedding(value: Any) -> list[float]:
    if isinstance(value, list):
        return [float(item) for item in value]

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            return [float(item) for item in json.loads(stripped)]
        return [float(item) for item in stripped.strip("()[]").split(",") if item.strip()]

    raise TypeError(f"Unsupported embedding value: {type(value).__name__}")


def get_episode(row: dict[str, Any]) -> dict[str, Any]:
    episode = row.get("episodes")
    if isinstance(episode, list):
        return episode[0] if episode else {}
    return episode or {}


def fetch_page(client: Any, start: int, page_size: int) -> list[dict[str, Any]]:
    response = (
        client.table("transcript_chunks")
        .select(
            "id, episode_id, start_seconds, end_seconds, embedding, "
            "episodes!inner(published_at)"
        )
        .order("id")
        .range(start, start + page_size - 1)
        .execute()
    )
    return response.data or []


def count_embedded_chunks(client: Any) -> int:
    response = (
        client.table("transcript_chunks")
        .select("id", count="exact")
        .not_.is_("embedding", "null")
        .limit(1)
        .execute()
    )
    return int(response.count or 0)


def backfill(limit: int | None, page_size: int, batch_size: int) -> int:
    client = get_supabase_client()
    ensure_pinecone_index()
    print(f"Backfilling into Pinecone namespace {get_pinecone_namespace()!r}", flush=True)

    processed = 0
    offset = 0

    while True:
        if limit is not None and processed >= limit:
            break

        rows = fetch_page(client, offset, page_size)
        if not rows:
            break

        vectors: list[PineconeChunkVector] = []
        for row in rows:
            embedding = row.get("embedding")
            if embedding is None:
                continue

            episode = get_episode(row)
            published_at = episode.get("published_at")
            if not published_at:
                raise RuntimeError(f"Missing episode date for chunk {row['id']}")

            vectors.append(
                PineconeChunkVector(
                    id=row["id"],
                    values=parse_embedding(embedding),
                    episode_id=row["episode_id"],
                    published_at=published_at,
                    start_seconds=int(row["start_seconds"]),
                    end_seconds=int(row["end_seconds"]),
                )
            )

        if limit is not None:
            vectors = vectors[: max(limit - processed, 0)]

        if vectors:
            upserted = upsert_chunk_vectors(vectors, batch_size=batch_size)
            processed += upserted
            print(f"Copied {processed} vectors...", flush=True)

        offset += page_size

    return processed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy existing Supabase transcript embeddings into Pinecone"
    )
    parser.add_argument("--limit", type=int, help="Copy only the first N vectors")
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--skip-verify", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if args.verify_only:
        args.skip_verify = False
    else:
        copied = backfill(args.limit, args.page_size, args.batch_size)
        print(f"Backfill finished: copied {copied} vectors", flush=True)

    if not args.skip_verify and args.limit is None:
        expected = count_embedded_chunks(get_supabase_client())
        actual = describe_vector_count()
        print(f"Verification: Supabase embedded chunks={expected}, Pinecone vectors={actual}")
        if actual < expected:
            print("Pinecone vector count is lower than Supabase embedded chunk count", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
