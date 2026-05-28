from __future__ import annotations

import json
import os
from pathlib import Path

from requests import Session

DEFAULT_COOKIES_PATH = Path(__file__).resolve().parents[1] / "youtube_cookies.json"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def load_youtube_session() -> Session:
    cookie_path = Path(os.environ.get("YOUTUBE_COOKIES_PATH", DEFAULT_COOKIES_PATH))
    session = Session()
    session.headers.update(
        {
            "Accept-Language": "en-US",
            "User-Agent": USER_AGENT,
        }
    )

    if not cookie_path.exists():
        return session

    cookies = json.loads(cookie_path.read_text())
    session.headers["Cookie"] = "; ".join(
        f"{cookie['name']}={cookie['value']}" for cookie in cookies
    )
    for cookie in cookies:
        session.cookies.set(
            name=cookie["name"],
            value=cookie["value"],
            domain=cookie.get("domain", ".youtube.com"),
            path=cookie.get("path", "/"),
            secure=cookie.get("secure", True),
        )

    return session
