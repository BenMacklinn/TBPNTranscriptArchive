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

# Resume after partial run
python -m tbpn_ingest ingest --full --skip-done

# Embed existing chunks that are missing vectors
python -m tbpn_ingest embed

# Incremental since date
python -m tbpn_ingest ingest --since 2025-05-01
```

### Guest appearances

Guest timestamp data comes from the sibling [`tbpn-guests-research`](../tbpn-guests-research) repo (or set `GUEST_DATA_DIR`).

Apply the guest migrations first (if not already applied):

```bash
# Option A: direct Postgres (set SUPABASE_DB_PASSWORD or DATABASE_URL)
cd ingest
source .venv/bin/activate
pip install psycopg2-binary  # if needed
python scripts/apply_guest_migrations.py

# Option B: Supabase SQL editor — run both files in supabase/migrations/
# 20260528120000_guest_appearances.sql
# 20260528120100_hybrid_search_time_window.sql
```

Then import guest names and appearance windows:

```bash
cd ingest
source .venv/bin/activate
python scripts/import_guests.py
python scripts/verify_guest_import.py
```

Re-run the import after the guest repo daily sync updates `tbpn-youtube-guest-timestamps.csv`.

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
