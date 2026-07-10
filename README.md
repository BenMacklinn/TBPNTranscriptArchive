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

### Automatic daily sync (GitHub Actions)

Unlike the Node.js TBPN projects that trigger a Vercel `/api/cron/sync` endpoint, transcript ingest runs directly in GitHub Actions because it is a long-running Python job (YouTube captions, chunking, embeddings, Pinecone upserts).

1. **Add GitHub secrets** — Repo → Settings → Secrets and variables → Actions:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `YOUTUBE_API_KEY`
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX_NAME` (e.g. `tbpn-transcript-chunks`)
   - `PINECONE_NAMESPACE` (e.g. `production`)
   - `PINECONE_INDEX_HOST` (optional, avoids index host lookup at runtime)
   - `YOUTUBE_COOKIES_JSON` (optional, raw JSON from `ingest/youtube_cookies.json` if YouTube blocks datacenter IPs)
2. **Enable Actions** — `.github/workflows/daily-sync.yml` runs daily at 4:00 PM Pacific and ingests any new episodes with `--full --skip-done`.
3. **Manual run** — Actions → Daily Sync → Run workflow.

Local equivalent:

```bash
bash ingest/scripts/daily_sync.sh
```

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
