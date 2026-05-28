from __future__ import annotations

import os
import time
from pathlib import Path

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

from tbpn_ingest.chunk import TranscriptChunk
from tbpn_ingest.embed import embed_texts
from tbpn_ingest.list_episodes import Episode

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

CHUNK_INSERT_BATCH_SIZE = 10
CHUNK_INSERT_MAX_RETRIES = 8


def insert_chunk_batch(client: Client, rows: list[dict]) -> None:
    for attempt in range(1, CHUNK_INSERT_MAX_RETRIES + 1):
        try:
            client.table("transcript_chunks").insert(rows).execute()
            return
        except APIError as exc:
            if exc.code != "57014" or attempt == CHUNK_INSERT_MAX_RETRIES:
                raise
            wait_seconds = attempt * 2
            print(
                f"  !! insert timeout, retrying in {wait_seconds}s "
                f"({attempt}/{CHUNK_INSERT_MAX_RETRIES})",
                flush=True,
            )
            time.sleep(wait_seconds)


def get_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return create_client(url, key)


def upsert_episode(client: Client, episode: Episode, ingest_status: str) -> None:
    client.table("episodes").upsert(
        {
            "id": episode.id,
            "youtube_video_id": episode.youtube_video_id,
            "title": episode.title,
            "published_at": episode.published_at,
            "source_url": episode.source_url,
            "duration_seconds": episode.duration_seconds,
            "ingest_status": ingest_status,
        },
        on_conflict="id",
    ).execute()


def replace_episode_chunks(
    client: Client,
    episode: Episode,
    chunks: list[TranscriptChunk],
) -> int:
    upsert_episode(client, episode, "pending")
    client.table("transcript_chunks").delete().eq("episode_id", episode.id).execute()

    if not chunks:
        upsert_episode(client, episode, "no_captions")
        return 0

    texts = [chunk.text for chunk in chunks]
    embeddings = embed_texts(texts)
    if any(embedding is None for embedding in embeddings):
        raise RuntimeError("OPENAI_API_KEY is required to store searchable embeddings")

    rows = [
        {
            "episode_id": episode.id,
            "start_seconds": chunk.start_seconds,
            "end_seconds": chunk.end_seconds,
            "start_time": chunk.start_time,
            "end_time": chunk.end_time,
            "text": chunk.text,
            "speaker": None,
            "embedding": embedding,
        }
        for chunk, embedding in zip(chunks, embeddings, strict=True)
    ]

    batch_size = CHUNK_INSERT_BATCH_SIZE
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        insert_chunk_batch(client, batch)
        print(f"  inserted {min(start + batch_size, len(rows))}/{len(rows)} chunks", flush=True)

    upsert_episode(client, episode, "done")
    return len(rows)


def embed_missing_chunks(client: Client | None = None) -> int:
    client = client or get_supabase_client()
    updated = 0
    page_size = 100

    while True:
        response = (
            client.table("transcript_chunks")
            .select("id, text")
            .is_("embedding", "null")
            .limit(page_size)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break

        texts = [row["text"] for row in rows]
        embeddings = embed_texts(texts)
        if any(embedding is None for embedding in embeddings):
            raise RuntimeError("OPENAI_API_KEY is required to embed existing chunks")

        for row, embedding in zip(rows, embeddings, strict=True):
            client.table("transcript_chunks").update({"embedding": embedding}).eq(
                "id", row["id"]
            ).execute()
            updated += 1

        print(f"Embedded {updated} chunks...", flush=True)

    return updated
