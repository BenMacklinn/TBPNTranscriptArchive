#!/usr/bin/env python3
"""Smoke-test guest + topic search via the local or deployed web API."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def encode_path_segment(value: str) -> str:
    slug = value.strip().lower().replace(" ", "-")
    return urllib.parse.quote(slug, safe="")


def get_guest_search(base_url: str, guest_name: str, topic: str) -> dict:
    guest = encode_path_segment(guest_name)
    query = encode_path_segment(topic)
    url = f"{base_url.rstrip('/')}/api/guests/{guest}/search/{query}"
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify guest-aware search API")
    parser.add_argument(
        "--base-url",
        default="http://localhost:3000",
        help="Web app base URL",
    )
    args = parser.parse_args()

    checks = [
        ("Sholto Douglas", "deterministic interpretability"),
        ("Tyler Cowen", "AI diffusion"),
    ]

    for guest, topic in checks:
        print(f"\n=== {guest} + {topic!r} ===")
        try:
            result = get_guest_search(args.base_url, guest, topic)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            print(f"HTTP {error.code}: {body}")
            return 1
        except urllib.error.URLError as error:
            print(f"Request failed: {error.reason}")
            return 1

        if "error" in result:
            print(f"FAIL: {result['error']}")
            return 1

        matches = result.get("matches") or []
        print(f"Guest resolved: {result.get('guestName', guest)}")
        print(f"Windows searched: {result.get('windowsSearched', '?')}")
        print(f"Matches: {len(matches)}")
        for match in matches[:3]:
            print(
                f"  #{match.get('rank')} {match.get('title')} "
                f"@ {match.get('start_time')} — {match.get('match_reason', '')[:80]}",
            )

        if not matches:
            print("WARN: no matches returned")

    print("\nGuest search smoke tests completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
