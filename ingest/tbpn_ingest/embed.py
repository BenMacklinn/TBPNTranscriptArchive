from __future__ import annotations

import os
from typing import Iterable

from dotenv import load_dotenv
from openai import OpenAI
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
BATCH_SIZE = 100


def get_openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required")
    return OpenAI(api_key=api_key)


def embed_texts(texts: list[str]) -> list[list[float] | None]:
    if not texts:
        return []

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return [None for _ in texts]

    client = OpenAI(api_key=api_key)
    embeddings: list[list[float] | None] = []

    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        embeddings.extend(item.embedding for item in response.data)

    return embeddings


def embed_text(text: str) -> list[float] | None:
    result = embed_texts([text])
    return result[0] if result else None
