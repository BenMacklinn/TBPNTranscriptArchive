from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

TBPN_CHANNEL_URL = "https://www.youtube.com/@TBPNLive/videos"
TBPN_CHANNEL_HANDLE = "TBPNLive"
MIN_LIVESTREAM_SECONDS = 2 * 60 * 60
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
EPISODES_MANIFEST = DATA_DIR / "episodes.json"


@dataclass
class Episode:
    id: str
    youtube_video_id: str
    title: str
    published_at: str
    source_url: str
    duration_seconds: int

    def to_dict(self) -> dict:
        return asdict(self)


def _parse_duration(iso_duration: str) -> int:
    match = re.fullmatch(
        r"PT(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?",
        iso_duration,
    )
    if not match:
        return 0
    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes") or 0)
    seconds = int(match.group("seconds") or 0)
    return hours * 3600 + minutes * 60 + seconds


def _episode_id(published: datetime) -> str:
    return f"{published.date().isoformat()}-tbpn"


def discover_livestream_episodes() -> list[Episode]:
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if api_key:
        return discover_with_youtube_api(api_key)
    return discover_with_ytdlp()


def discover_with_ytdlp() -> list[Episode]:
    command = [
        "yt-dlp",
        "--skip-download",
        "--print",
        "%(id)s\t%(title)s\t%(duration)s\t%(upload_date)s\t%(live_status)s",
        "--match-filter",
        f"duration > {MIN_LIVESTREAM_SECONDS}",
        TBPN_CHANNEL_URL,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    episodes: list[Episode] = []
    seen_ids: set[str] = set()

    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 4)
        if len(parts) != 5:
            continue
        video_id, title, duration_raw, upload_date, live_status = parts
        if duration_raw in {"", "NA"} or upload_date in {"", "NA"}:
            continue
        duration_seconds = int(float(duration_raw))
        if duration_seconds < MIN_LIVESTREAM_SECONDS:
            continue
        if live_status not in {"was_live", "is_upcoming", "not_live", ""}:
            continue

        published = datetime.strptime(upload_date, "%Y%m%d")
        episode = Episode(
            id=_episode_id(published),
            youtube_video_id=video_id,
            title=title,
            published_at=published.date().isoformat(),
            source_url=f"https://www.youtube.com/watch?v={video_id}",
            duration_seconds=duration_seconds,
        )
        if episode.id in seen_ids:
            suffix = episode.youtube_video_id[:8]
            episode = Episode(
                id=f"{episode.published_at}-tbpn-{suffix}",
                youtube_video_id=episode.youtube_video_id,
                title=episode.title,
                published_at=episode.published_at,
                source_url=episode.source_url,
                duration_seconds=episode.duration_seconds,
            )
        seen_ids.add(episode.id)
        episodes.append(episode)

    episodes.sort(key=lambda e: e.published_at)
    return episodes


def discover_with_youtube_api(api_key: str) -> list[Episode]:
    from googleapiclient.discovery import build

    youtube = build("youtube", "v3", developerKey=api_key)
    uploads_playlist_id = resolve_uploads_playlist_id(youtube)
    video_ids = list_playlist_video_ids(youtube, uploads_playlist_id)
    metadata = fetch_video_metadata(youtube, video_ids)

    episodes: list[Episode] = []
    seen_ids: set[str] = set()
    for video in metadata:
        if not is_livestream_archive(video):
            continue
        episode = video_to_episode(video)
        if episode.id in seen_ids:
            suffix = episode.youtube_video_id[:8]
            episode = Episode(
                id=f"{episode.published_at}-tbpn-{suffix}",
                youtube_video_id=episode.youtube_video_id,
                title=episode.title,
                published_at=episode.published_at,
                source_url=episode.source_url,
                duration_seconds=episode.duration_seconds,
            )
        seen_ids.add(episode.id)
        episodes.append(episode)

    episodes.sort(key=lambda e: e.published_at)
    return episodes


def get_youtube_client():
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise RuntimeError("YOUTUBE_API_KEY is required")
    from googleapiclient.discovery import build

    return build("youtube", "v3", developerKey=api_key)


def resolve_uploads_playlist_id(youtube) -> str:
    response = (
        youtube.channels()
        .list(part="contentDetails", forHandle=TBPN_CHANNEL_HANDLE)
        .execute()
    )
    items = response.get("items", [])
    if not items:
        raise RuntimeError(f"Could not resolve channel handle @{TBPN_CHANNEL_HANDLE}")
    return items[0]["contentDetails"]["relatedPlaylists"]["uploads"]


def list_playlist_video_ids(youtube, playlist_id: str) -> list[str]:
    video_ids: list[str] = []
    page_token = None
    while True:
        response = (
            youtube.playlistItems()
            .list(
                part="contentDetails",
                playlistId=playlist_id,
                maxResults=50,
                pageToken=page_token,
            )
            .execute()
        )
        for item in response.get("items", []):
            video_ids.append(item["contentDetails"]["videoId"])
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return video_ids


def fetch_video_metadata(youtube, video_ids: list[str]) -> list[dict]:
    videos: list[dict] = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        response = (
            youtube.videos()
            .list(part="snippet,contentDetails,liveStreamingDetails", id=",".join(batch))
            .execute()
        )
        videos.extend(response.get("items", []))
    return videos


def is_livestream_archive(video: dict) -> bool:
    duration_seconds = _parse_duration(video["contentDetails"]["duration"])
    if duration_seconds < MIN_LIVESTREAM_SECONDS:
        return False
    live_content = video["snippet"].get("liveBroadcastContent", "none")
    return live_content in {"none", "completed"}


def video_to_episode(video: dict) -> Episode:
    published = datetime.fromisoformat(
        video["snippet"]["publishedAt"].replace("Z", "+00:00")
    )
    video_id = video["id"]
    return Episode(
        id=_episode_id(published),
        youtube_video_id=video_id,
        title=video["snippet"]["title"],
        published_at=published.date().isoformat(),
        source_url=f"https://www.youtube.com/watch?v={video_id}",
        duration_seconds=_parse_duration(video["contentDetails"]["duration"]),
    )


def save_episodes_manifest(episodes: list[Episode]) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = [episode.to_dict() for episode in episodes]
    EPISODES_MANIFEST.write_text(json.dumps(payload, indent=2))
    return EPISODES_MANIFEST


def load_episodes_manifest() -> list[Episode]:
    if not EPISODES_MANIFEST.exists():
        raise FileNotFoundError(
            f"Missing manifest at {EPISODES_MANIFEST}. Run `python -m tbpn_ingest list` first."
        )
    data = json.loads(EPISODES_MANIFEST.read_text())
    return [Episode(**item) for item in data]


def filter_episodes_since(episodes: list[Episode], since: date | None) -> list[Episode]:
    if since is None:
        return episodes
    since_str = since.isoformat()
    return [episode for episode in episodes if episode.published_at >= since_str]


def filter_episodes_until(episodes: list[Episode], until: date | None) -> list[Episode]:
    if until is None:
        return episodes
    until_str = until.isoformat()
    return [episode for episode in episodes if episode.published_at <= until_str]
