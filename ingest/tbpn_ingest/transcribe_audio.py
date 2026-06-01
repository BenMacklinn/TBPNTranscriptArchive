from __future__ import annotations

import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from tbpn_ingest.chunk import WordTimestamp

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DEFAULT_TRANSCRIPTION_MODEL = "whisper-1"
DEFAULT_AUDIO_CHUNK_SECONDS = 10 * 60
DEFAULT_AUDIO_BITRATE = "48k"


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def _download_youtube_audio(video_id: str, work_dir: Path) -> Path:
    output_template = work_dir / "source.%(ext)s"
    _run(
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            DEFAULT_AUDIO_BITRATE,
            "--output",
            str(output_template),
            f"https://www.youtube.com/watch?v={video_id}",
        ]
    )

    candidates = sorted(work_dir.glob("source.*"))
    if not candidates:
        raise RuntimeError(f"yt-dlp did not create an audio file for {video_id}")
    return candidates[0]


def _probe_duration_seconds(audio_path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return max(1, math.ceil(float(result.stdout.strip())))


def _split_audio(audio_path: Path, duration_seconds: int, work_dir: Path) -> list[tuple[int, Path]]:
    chunk_seconds = int(
        os.environ.get("TRANSCRIPTION_AUDIO_CHUNK_SECONDS", "").strip()
        or DEFAULT_AUDIO_CHUNK_SECONDS
    )
    bitrate = os.environ.get("TRANSCRIPTION_AUDIO_BITRATE", "").strip() or DEFAULT_AUDIO_BITRATE
    chunks: list[tuple[int, Path]] = []

    for offset in range(0, duration_seconds, chunk_seconds):
        output_path = work_dir / f"audio-{offset:06d}.mp3"
        _run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                str(offset),
                "-t",
                str(chunk_seconds),
                "-i",
                str(audio_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                bitrate,
                str(output_path),
            ]
        )
        if output_path.exists() and output_path.stat().st_size > 0:
            chunks.append((offset, output_path))

    return chunks


def _get_openai_client() -> OpenAI:
    return OpenAI(api_key=_required_env("OPENAI_API_KEY"))


def _extract_words(response: Any, offset_seconds: int) -> list[WordTimestamp]:
    raw_words = getattr(response, "words", None)
    if raw_words is None and isinstance(response, dict):
        raw_words = response.get("words")
    if not raw_words:
        return []

    words: list[WordTimestamp] = []
    for raw_word in raw_words:
        if isinstance(raw_word, dict):
            text = str(raw_word.get("word", "")).strip()
            start = raw_word.get("start")
            end = raw_word.get("end")
        else:
            text = str(getattr(raw_word, "word", "")).strip()
            start = getattr(raw_word, "start", None)
            end = getattr(raw_word, "end", None)

        if not text or start is None or end is None:
            continue

        words.append(
            WordTimestamp(
                word=text,
                start_seconds=round(float(start) + offset_seconds, 3),
                end_seconds=round(float(end) + offset_seconds, 3),
            )
        )

    return words


def _transcribe_audio_chunk(
    client: OpenAI,
    audio_path: Path,
    offset_seconds: int,
    model: str,
) -> list[WordTimestamp]:
    with audio_path.open("rb") as audio_file:
        response = client.audio.transcriptions.create(
            model=model,
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
    return _extract_words(response, offset_seconds)


def transcribe_youtube_video(
    video_id: str,
    duration_seconds: int | None = None,
    model: str | None = None,
) -> list[WordTimestamp]:
    transcription_model = (
        model
        or os.environ.get("TRANSCRIPTION_MODEL", "").strip()
        or DEFAULT_TRANSCRIPTION_MODEL
    )
    if transcription_model != "whisper-1":
        raise RuntimeError(
            "Word-level timestamps require TRANSCRIPTION_MODEL=whisper-1."
        )

    client = _get_openai_client()
    with tempfile.TemporaryDirectory(prefix="tbpn-transcribe-") as temp_dir:
        work_dir = Path(temp_dir)
        source_audio = _download_youtube_audio(video_id, work_dir)
        total_duration = duration_seconds or _probe_duration_seconds(source_audio)
        audio_chunks = _split_audio(source_audio, total_duration, work_dir)

        words: list[WordTimestamp] = []
        for index, (offset, chunk_path) in enumerate(audio_chunks, start=1):
            print(
                f"  transcribing audio chunk {index}/{len(audio_chunks)} "
                f"at +{offset}s",
                flush=True,
            )
            words.extend(_transcribe_audio_chunk(client, chunk_path, offset, transcription_model))

    words.sort(key=lambda word: (word.start_seconds, word.end_seconds))
    return words
