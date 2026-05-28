from __future__ import annotations

import time
from dataclasses import dataclass

from youtube_transcript_api import (
    IpBlocked,
    NoTranscriptFound,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
)

from tbpn_ingest.cookies import load_youtube_session

_api: YouTubeTranscriptApi | None = None


def get_transcript_api() -> YouTubeTranscriptApi:
    global _api
    if _api is None:
        _api = YouTubeTranscriptApi(http_client=load_youtube_session())
    return _api


@dataclass
class CaptionSegment:
    start: float
    duration: float
    text: str


def fetch_transcript(video_id: str, pause_seconds: float = 1.5) -> list[CaptionSegment]:
    api = get_transcript_api()
    try:
        transcript_list = api.list(video_id)
    except (NoTranscriptFound, TranscriptsDisabled) as exc:
        raise RuntimeError(f"No captions for {video_id}") from exc
    except IpBlocked as exc:
        raise RuntimeError(f"YouTube blocked transcript requests for {video_id}") from exc

    transcript = None
    for language in ("en", "en-US", "en-GB"):
        try:
            transcript = transcript_list.find_transcript([language])
            break
        except NoTranscriptFound:
            continue

    if transcript is None:
        try:
            transcript = transcript_list.find_generated_transcript(["en"])
        except NoTranscriptFound as exc:
            raise RuntimeError(f"No English captions for {video_id}") from exc

    try:
        fetched = transcript.fetch()
    except IpBlocked as exc:
        raise RuntimeError(f"YouTube blocked transcript requests for {video_id}") from exc

    time.sleep(pause_seconds)
    return [
        CaptionSegment(
            start=float(item.start),
            duration=float(item.duration),
            text=item.text.strip(),
        )
        for item in fetched
        if item.text.strip()
    ]
