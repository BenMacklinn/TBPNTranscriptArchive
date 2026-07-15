from __future__ import annotations

import os

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig

from tbpn_ingest.cookies import load_youtube_session

_api: YouTubeTranscriptApi | None = None


def get_transcript_api() -> YouTubeTranscriptApi:
    global _api
    if _api is None:
        proxy_url = os.environ.get("YOUTUBE_PROXY_URL", "").strip()
        proxy_config = None
        if proxy_url:
            proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
        _api = YouTubeTranscriptApi(
            proxy_config=proxy_config,
            http_client=load_youtube_session(),
        )
    return _api
