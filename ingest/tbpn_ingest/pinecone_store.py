from __future__ import annotations

import os
import time
from dataclasses import dataclass

from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DEFAULT_INDEX_NAME = "tbpn-transcript-chunks"
DEFAULT_NAMESPACE = "production"
DEFAULT_CLOUD = "aws"
DEFAULT_REGION = "us-east-1"
VECTOR_DIMENSIONS = 1536


@dataclass
class PineconeChunkVector:
    id: str
    values: list[float]
    episode_id: str
    published_at: str
    start_seconds: int
    end_seconds: int


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def is_pinecone_configured() -> bool:
    return bool(os.environ.get("PINECONE_API_KEY", "").strip())


def get_pinecone_index_name() -> str:
    return os.environ.get("PINECONE_INDEX_NAME", "").strip() or DEFAULT_INDEX_NAME


def get_pinecone_namespace() -> str:
    return os.environ.get("PINECONE_NAMESPACE", "").strip() or DEFAULT_NAMESPACE


def _date_to_number(value: str) -> int:
    return int(value.replace("-", ""))


def get_pinecone_client() -> Pinecone:
    return Pinecone(api_key=_required_env("PINECONE_API_KEY"))


def ensure_pinecone_index() -> str:
    client = get_pinecone_client()
    index_name = get_pinecone_index_name()

    existing = {index.name for index in client.list_indexes().indexes or []}
    if index_name not in existing:
        client.create_index(
            name=index_name,
            dimension=VECTOR_DIMENSIONS,
            metric="cosine",
            spec=ServerlessSpec(
                cloud=os.environ.get("PINECONE_CLOUD", "").strip() or DEFAULT_CLOUD,
                region=os.environ.get("PINECONE_REGION", "").strip() or DEFAULT_REGION,
            ),
            deletion_protection="disabled",
        )

    while True:
        description = client.describe_index(index_name)
        if description.status and description.status.get("ready"):
            if description.dimension != VECTOR_DIMENSIONS:
                raise RuntimeError(
                    f"Pinecone index {index_name!r} has dimension "
                    f"{description.dimension}, expected {VECTOR_DIMENSIONS}"
                )
            return description.host
        time.sleep(2)


def get_pinecone_index():
    client = get_pinecone_client()
    host = os.environ.get("PINECONE_INDEX_HOST", "").strip() or ensure_pinecone_index()
    return client.Index(host=host)


def upsert_chunk_vectors(vectors: list[PineconeChunkVector], batch_size: int = 100) -> int:
    if not vectors:
        return 0

    index = get_pinecone_index()
    namespace = get_pinecone_namespace()
    upserted = 0

    for start in range(0, len(vectors), batch_size):
        batch = vectors[start : start + batch_size]
        response = index.upsert(
            vectors=[
                {
                    "id": vector.id,
                    "values": vector.values,
                    "metadata": {
                        "episode_id": vector.episode_id,
                        "published_at": vector.published_at,
                        "published_date_num": _date_to_number(vector.published_at),
                        "start_seconds": vector.start_seconds,
                        "end_seconds": vector.end_seconds,
                    },
                }
                for vector in batch
            ],
            namespace=namespace,
        )
        upserted += getattr(response, "upserted_count", len(batch)) or len(batch)

    return upserted


def delete_episode_vectors(episode_id: str) -> None:
    index = get_pinecone_index()
    index.delete(
        filter={"episode_id": {"$eq": episode_id}},
        namespace=get_pinecone_namespace(),
    )


def describe_vector_count() -> int:
    index = get_pinecone_index()
    stats = index.describe_index_stats()
    total = getattr(stats, "total_vector_count", None)
    if total is not None:
        return int(total)

    namespace = get_pinecone_namespace()
    namespaces = getattr(stats, "namespaces", None) or {}
    summary = namespaces.get(namespace)
    if summary is None:
        return 0
    record_count = getattr(summary, "record_count", None)
    if record_count is not None:
        return int(record_count)
    return int(summary.get("recordCount", 0) or 0)
