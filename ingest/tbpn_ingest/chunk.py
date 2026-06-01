from __future__ import annotations

import re
from dataclasses import dataclass

from tbpn_ingest.fetch_transcripts import CaptionSegment

TARGET_MIN_SECONDS = 45
TARGET_MAX_SECONDS = 75
TARGET_MAX_WORDS = 600
OVERLAP_SECONDS = 10


@dataclass
class TranscriptChunk:
    start_seconds: int
    end_seconds: int
    start_time: str
    end_time: str
    text: str


@dataclass
class WordTimestamp:
    word: str
    start_seconds: float
    end_seconds: float


def format_timestamp(total_seconds: int) -> str:
    hours, remainder = divmod(max(total_seconds, 0), 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def join_transcript_text(parts: list[str]) -> str:
    text = " ".join(part.strip() for part in parts if part.strip()).strip()
    text = re.sub(r"\s+([,.;:!?%)\]])", r"\1", text)
    text = re.sub(r"([([{])\s+", r"\1", text)
    return text


def chunk_transcript(segments: list[CaptionSegment]) -> list[TranscriptChunk]:
    if not segments:
        return []

    chunks: list[TranscriptChunk] = []
    buffer_text: list[str] = []
    chunk_start = int(segments[0].start)
    chunk_end = chunk_start
    word_count = 0
    index = 0

    while index < len(segments):
        segment = segments[index]
        segment_start = int(segment.start)
        segment_end = int(segment.start + segment.duration)
        buffer_text.append(segment.text)
        chunk_end = max(chunk_end, segment_end)
        word_count += len(segment.text.split())
        duration = chunk_end - chunk_start

        should_flush = duration >= TARGET_MAX_SECONDS or word_count >= TARGET_MAX_WORDS
        if not should_flush and index == len(segments) - 1:
            should_flush = duration >= TARGET_MIN_SECONDS or duration > 0

        if should_flush and buffer_text:
            text = join_transcript_text(buffer_text)
            if text:
                chunks.append(
                    TranscriptChunk(
                        start_seconds=chunk_start,
                        end_seconds=chunk_end,
                        start_time=format_timestamp(chunk_start),
                        end_time=format_timestamp(chunk_end),
                        text=text,
                    )
                )

            if index == len(segments) - 1:
                break

            rewind_to = max(chunk_end - OVERLAP_SECONDS, chunk_start)
            while index + 1 < len(segments) and int(segments[index + 1].start) < rewind_to:
                index += 1

            buffer_text = []
            if index + 1 < len(segments):
                chunk_start = int(segments[index + 1].start)
                chunk_end = chunk_start
            word_count = 0

        index += 1

    return chunks


def chunk_word_timestamps(words: list[WordTimestamp]) -> list[TranscriptChunk]:
    segments = [
        CaptionSegment(
            start=word.start_seconds,
            duration=max(word.end_seconds - word.start_seconds, 0.01),
            text=word.word,
        )
        for word in words
        if word.word.strip()
    ]
    return chunk_transcript(segments)
