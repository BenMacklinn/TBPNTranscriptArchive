from __future__ import annotations

import argparse
import os
from datetime import date

from tbpn_ingest.chunk import chunk_transcript
from tbpn_ingest.fetch_transcripts import fetch_transcript
from tbpn_ingest.list_episodes import (
    discover_livestream_episodes,
    filter_episodes_since,
    load_episodes_manifest,
    save_episodes_manifest,
)
from tbpn_ingest.load_supabase import (
    embed_missing_chunks,
    get_supabase_client,
    replace_episode_chunks,
)
from tbpn_ingest.notify import notify_ingest_stopped


def cmd_list(_: argparse.Namespace) -> None:
    episodes = discover_livestream_episodes()
    manifest_path = save_episodes_manifest(episodes)
    print(f"Found {len(episodes)} livestream episodes")
    print(f"Saved manifest to {manifest_path}")


def cmd_ingest(args: argparse.Namespace) -> str:
    if args.full or args.since:
        episodes = discover_livestream_episodes()
        save_episodes_manifest(episodes)
    else:
        episodes = load_episodes_manifest()

    since = date.fromisoformat(args.since) if args.since else None
    episodes = filter_episodes_since(episodes, since)
    if args.limit:
        episodes = episodes[: args.limit]

    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise RuntimeError("OPENAI_API_KEY is required for ingestion with embeddings")

    client = get_supabase_client()
    total_chunks = 0
    processed = 0
    stop_reason = "completed"

    skip_ids: set[str] = set()
    if args.skip_done:
        response = (
            client.table("episodes")
            .select("id")
            .in_("ingest_status", ["done", "no_captions"])
            .execute()
        )
        skip_ids = {row["id"] for row in (response.data or [])}
        if skip_ids:
            print(f"Skipping {len(skip_ids)} already-processed episodes", flush=True)

    for index, episode in enumerate(episodes, start=1):
        if episode.id in skip_ids:
            continue
        print(f"[{index}/{len(episodes)}] {episode.published_at} — {episode.title}", flush=True)
        try:
            segments = fetch_transcript(episode.youtube_video_id)
            chunks = chunk_transcript(segments)
            count = replace_episode_chunks(client, episode, chunks)
            total_chunks += count
            processed += 1
            print(f"  -> {count} chunks", flush=True)
        except RuntimeError as exc:
            print(f"  !! {exc}", flush=True)
            if "YouTube blocked" in str(exc):
                print(
                    "Stopping ingest: IP still blocked by YouTube. "
                    "Wait a few hours and rerun with --skip-done.",
                    flush=True,
                )
                stop_reason = "youtube_blocked"
                break
            client.table("episodes").upsert(
                {
                    "id": episode.id,
                    "youtube_video_id": episode.youtube_video_id,
                    "title": episode.title,
                    "published_at": episode.published_at,
                    "source_url": episode.source_url,
                    "duration_seconds": episode.duration_seconds,
                    "ingest_status": "no_captions",
                },
                on_conflict="id",
            ).execute()

    print(
        f"Ingest finished: {processed} episodes this run, {total_chunks} chunks, "
        f"reason={stop_reason}",
        flush=True,
    )
    return stop_reason


def cmd_embed(_: argparse.Namespace) -> None:
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise RuntimeError("OPENAI_API_KEY is required")
    count = embed_missing_chunks()
    print(f"Embedded {count} chunks")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TBPN transcript ingestion")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="Discover livestream episodes")
    list_parser.set_defaults(func=cmd_list)

    ingest_parser = subparsers.add_parser("ingest", help="Fetch, chunk, embed, and load")
    ingest_parser.add_argument("--full", action="store_true", help="Refresh manifest and ingest all")
    ingest_parser.add_argument("--since", help="Only ingest episodes on/after YYYY-MM-DD")
    ingest_parser.add_argument("--limit", type=int, help="Only ingest the first N episodes")
    ingest_parser.add_argument(
        "--skip-done",
        action="store_true",
        help="Skip episodes already marked done in Supabase",
    )
    ingest_parser.set_defaults(func=cmd_ingest)

    embed_parser = subparsers.add_parser(
        "embed", help="Generate embeddings for chunks missing them"
    )
    embed_parser.set_defaults(func=cmd_embed)

    return parser


def _notify_ingest_result(stop_reason: str) -> None:
    if stop_reason == "youtube_blocked":
        notify_ingest_stopped(
            "YOUTUBE BLOCKED",
            "Ingest stopped early. Wait and rerun with --skip-done.",
        )
    else:
        notify_ingest_stopped(
            "COMPLETED",
            "Ingest finished. Check log for episode/chunk counts.",
        )


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.func(args)
        if args.command == "ingest" and isinstance(result, str):
            _notify_ingest_result(result)
    except KeyboardInterrupt:
        if args.command == "ingest":
            notify_ingest_stopped("INTERRUPTED", "Ingest stopped manually (Ctrl+C).")
        raise
    except Exception as exc:
        if args.command == "ingest":
            notify_ingest_stopped("ERROR", str(exc))
        raise


if __name__ == "__main__":
    main()
