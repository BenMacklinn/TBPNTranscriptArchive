-- Pinecone now owns semantic vectors. Keep hybrid_search as a keyword-only
-- compatibility wrapper for older scripts while removing local vector storage.

create or replace function public.hybrid_search(
  query_text text,
  query_embedding extensions.vector(1536),
  match_count int default 20,
  full_text_weight float default 1,
  semantic_weight float default 1,
  rrf_k int default 50,
  date_from date default null,
  date_to date default null,
  filter_episode_id text default null,
  min_start_seconds int default null,
  max_start_seconds int default null
)
returns table (
  chunk_id uuid,
  episode_id text,
  start_seconds integer,
  end_seconds integer,
  start_time text,
  end_time text,
  chunk_text text,
  speaker text,
  episode_title text,
  published_at date,
  youtube_video_id text,
  source_url text,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select *
  from public.keyword_search(
    query_text,
    match_count,
    date_from,
    date_to,
    filter_episode_id,
    min_start_seconds,
    max_start_seconds
  );
$$;

drop index if exists public.transcript_chunks_embedding_idx;

alter table public.transcript_chunks
  drop column if exists embedding;
