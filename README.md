# TBPN Transcript Archive

Searchable archive of TBPN livestream transcripts with hybrid vector + keyword retrieval and timestamped clip links.

## Stack

- **Supabase Postgres** — `pgvector`, full-text search, RRF hybrid search
- **Python** — YouTube discovery, caption fetch, chunking, embedding
- **Next.js** — search UI with timestamped receipts

## Setup

1. Copy `.env.example` to `.env` and fill in keys.
2. Apply the Supabase migration (already applied if using the linked project).
3. Install ingest dependencies:

```bash
cd ingest && python -m venv .venv && source .venv/bin/activate
pip install -e .
```

4. Install web dependencies:

```bash
cd web && npm install
```

## Ingestion

Place browser-exported YouTube cookies at `ingest/youtube_cookies.json` if transcript
fetch hits IP blocks. Export from a logged-in YouTube session in Chrome.

```bash
cd ingest
source .venv/bin/activate

# Discover livestream episodes (>= 2h)
python -m tbpn_ingest list

# Full backfill: fetch captions, chunk, embed, load
python -m tbpn_ingest ingest --full

# Audio transcription backfill: download audio, transcribe with word timestamps,
# chunk/embed/load the same way as caption ingest
python -m tbpn_ingest ingest --full --transcribe

# Resume after partial run
python -m tbpn_ingest ingest --full --skip-done

# Embed existing chunks that are missing vectors
python -m tbpn_ingest embed

# Incremental since date
python -m tbpn_ingest ingest --since 2025-05-01
```

### Automatic daily sync (macOS launchd)

YouTube blocks transcript requests from GitHub Actions cloud IPs, so the daily job runs on your Mac at **9:00 AM Pacific** via `launchd`. It ingests the previous day's episode(s) using YouTube captions.

**Install the scheduler:**

```bash
cp scripts/launchd/com.tbpn.transcript-daily-sync.plist ~/Library/LaunchAgents/
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.tbpn.transcript-daily-sync.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.tbpn.transcript-daily-sync.plist
```

Logs: `ingest/daily_sync.log`

**Manual run (same as the scheduler):**

```bash
bash ingest/scripts/run_scheduled_sync.sh
```

**Optional GitHub Actions** — `.github/workflows/daily-sync.yml` is manual-only (`workflow_dispatch`). It only works if you add a residential `YOUTUBE_PROXY_URL` secret; otherwise use the Mac scheduler.

Required local setup: `.env` at repo root, `ingest/.venv`, and optionally `ingest/youtube_cookies.json` for YouTube auth.

### Word-level transcription

The `--transcribe` ingest path uses `yt-dlp` to download episode audio,
`ffmpeg`/`ffprobe` to split and re-encode it, and OpenAI `whisper-1` with
word timestamp granularity. Chunks are still stored and embedded through the
same `transcript_chunks` flow; word timings are stored in `transcript_words`
and returned by the transcript API as `chunk.words`.

Required local tools:

```bash
brew install ffmpeg
```

Useful environment overrides:

```bash
TRANSCRIPTION_MODEL=whisper-1
TRANSCRIPTION_AUDIO_CHUNK_SECONDS=600
TRANSCRIPTION_AUDIO_BITRATE=48k
```

### Guest appearances

Guest timestamp data comes from the [`tbpn-guests-research`](https://github.com/BenMacklinn/tbpn-guests-research) repo — the same CSV/JSON files used by [tbpnguests.vercel.app](https://tbpnguests.vercel.app). The web app reads them directly; no Supabase import is required for guest search.

Local dev with a sibling checkout:

```bash
# web/.env.local
GUEST_DATA_DIR=../tbpn-guests-research
```

Production on Vercel (private GitHub repo):

```bash
GITHUB_SYNC_TOKEN=...   # same PAT used by the guests site
GUEST_GITHUB_REPOSITORY=BenMacklinn/tbpn-guests-research
GUEST_GITHUB_BRANCH=main
```

Optional: import guest rows into Supabase for analytics or offline scripts:

```bash
cd ingest
source .venv/bin/activate
python scripts/import_guests.py
python scripts/verify_guest_import.py
```

To smoke-test guest + topic search (with `npm run dev` running):

```bash
python scripts/verify_guest_search.py --base-url http://localhost:3000
```

## Web

```bash
cd web
npm run dev
```

Open http://localhost:3000
