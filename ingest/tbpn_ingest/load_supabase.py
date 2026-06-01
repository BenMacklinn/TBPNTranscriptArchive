from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

from tbpn_ingest.chunk import TranscriptChunk, WordTimestamp
from tbpn_ingest.embed import embed_texts
from tbpn_ingest.list_episodes import Episode
from tbpn_ingest.pinecone_store import (
    PineconeChunkVector,
    delete_episode_vectors,
    is_pinecone_configured,
    upsert_chunk_vectors,
)

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

CHUNK_INSERT_BATCH_SIZE = 10
CHUNK_INSERT_MAX_RETRIES = 8
WORD_INSERT_BATCH_SIZE = 500


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


def insert_word_batch(client: Client, rows: list[dict]) -> None:
    for start in range(0, len(rows), WORD_INSERT_BATCH_SIZE):
        client.table("transcript_words").insert(
            rows[start : start + WORD_INSERT_BATCH_SIZE]
        ).execute()


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
    words: list[WordTimestamp] | None = None,
) -> int:
    upsert_episode(client, episode, "pending")
    client.table("transcript_words").delete().eq("episode_id", episode.id).execute()
    client.table("transcript_chunks").delete().eq("episode_id", episode.id).execute()

    if not chunks:
        upsert_episode(client, episode, "no_captions")
        return 0

    texts = [chunk.text for chunk in chunks]
    embeddings = embed_texts(texts)
    if any(embedding is None for embedding in embeddings):
        raise RuntimeError("OPENAI_API_KEY is required to store searchable embeddings")

    use_pinecone = is_pinecone_configured()
    if use_pinecone:
        delete_episode_vectors(episode.id)

    rows = [
        {
            "id": str(uuid.uuid4()),
            "episode_id": episode.id,
            "start_seconds": chunk.start_seconds,
            "end_seconds": chunk.end_seconds,
            "start_time": chunk.start_time,
            "end_time": chunk.end_time,
            "text": chunk.text,
            "speaker": None,
        }
        for chunk, embedding in zip(chunks, embeddings, strict=True)
    ]

    batch_size = CHUNK_INSERT_BATCH_SIZE
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        insert_chunk_batch(client, batch)
        print(f"  inserted {min(start + batch_size, len(rows))}/{len(rows)} chunks", flush=True)

    if use_pinecone:
        upserted = upsert_chunk_vectors(
            [
                PineconeChunkVector(
                    id=row["id"],
                    values=embedding,
                    episode_id=episode.id,
                    published_at=episode.published_at,
                    start_seconds=row["start_seconds"],
                    end_seconds=row["end_seconds"],
                )
                for row, embedding in zip(rows, embeddings, strict=True)
            ]
        )
        print(f"  upserted {upserted} vectors to Pinecone", flush=True)

    if words:
        word_rows = build_word_rows(episode.id, rows, words)
        insert_word_batch(client, word_rows)
        print(f"  inserted {len(word_rows)} word timestamps", flush=True)

    upsert_episode(client, episode, "done")
    return len(rows)


def build_word_rows(
    episode_id: str,
    chunk_rows: list[dict],
    words: list[WordTimestamp],
) -> list[dict]:
    def find_chunk_id(word: WordTimestamp) -> str | None:
        for row in chunk_rows:
            if row["start_seconds"] <= word.start_seconds < row["end_seconds"]:
                return row["id"]
        return None

    return [
        {
            "episode_id": episode_id,
            "chunk_id": find_chunk_id(word),
            "word_index": index,
            "word": word.word,
            "start_seconds": round(word.start_seconds, 3),
            "end_seconds": round(word.end_seconds, 3),
        }
        for index, word in enumerate(words)
    ]


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
