-- TBPN Transcript Archive schema

create extension if not exists vector with schema extensions;

create table public.episodes (
  id text primary key,
  youtube_video_id text not null unique,
  title text not null,
  published_at date not null,
  source_url text not null,
  duration_seconds integer not null,
  ingest_status text not null default 'pending'
    check (ingest_status in ('pending', 'done', 'no_captions', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index episodes_published_at_idx on public.episodes (published_at desc);

create table public.transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  episode_id text not null references public.episodes (id) on delete cascade,
  start_seconds integer not null,
  end_seconds integer not null,
  start_time text not null,
  end_time text not null,
  text text not null,
  speaker text,
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  unique (episode_id, start_seconds, end_seconds)
);

create index transcript_chunks_episode_id_idx on public.transcript_chunks (episode_id);
create index transcript_chunks_fts_idx on public.transcript_chunks using gin (fts);
create index transcript_chunks_embedding_idx on public.transcript_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.episodes enable row level security;
alter table public.transcript_chunks enable row level security;

create policy "Public read episodes"
  on public.episodes for select
  to anon, authenticated
  using (true);

create policy "Public read transcript chunks"
  on public.transcript_chunks for select
  to anon, authenticated
  using (true);

create or replace function public.hybrid_search(
  query_text text,
  query_embedding extensions.vector(1536),
  match_count int default 20,
  full_text_weight float default 1,
  semantic_weight float default 1,
  rrf_k int default 50,
  date_from date default null,
  date_to date default null,
  filter_episode_id text default null
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
as $$
with filtered_chunks as (
  select
    tc.id,
    tc.episode_id,
    tc.start_seconds,
    tc.end_seconds,
    tc.start_time,
    tc.end_time,
    tc.text as chunk_text,
    tc.speaker,
    tc.fts,
    tc.embedding,
    e.title as episode_title,
    e.published_at,
    e.youtube_video_id,
    e.source_url
  from public.transcript_chunks tc
  join public.episodes e on e.id = tc.episode_id
  where (date_from is null or e.published_at >= date_from)
    and (date_to is null or e.published_at <= date_to)
    and (filter_episode_id is null or tc.episode_id = filter_episode_id)
),
full_text as (
  select
    fc.id,
    row_number() over (
      order by ts_rank_cd(fc.fts, websearch_to_tsquery('english', query_text)) desc
    ) as rank_ix
  from filtered_chunks fc
  where fc.fts @@ websearch_to_tsquery('english', query_text)
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select
    fc.id,
    row_number() over (order by fc.embedding <=> query_embedding) as rank_ix
  from filtered_chunks fc
  where fc.embedding is not null
  order by rank_ix
  limit least(match_count, 30) * 2
),
fused as (
  select
    coalesce(ft.id, s.id) as id,
    coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight as score
  from full_text ft
  full outer join semantic s on ft.id = s.id
)
select
  fc.id as chunk_id,
  fc.episode_id,
  fc.start_seconds,
  fc.end_seconds,
  fc.start_time,
  fc.end_time,
  fc.chunk_text,
  fc.speaker,
  fc.episode_title,
  fc.published_at,
  fc.youtube_video_id,
  fc.source_url,
  f.score
from fused f
join filtered_chunks fc on fc.id = f.id
order by f.score desc
limit least(match_count, 30);
$$;

grant usage on schema public to anon, authenticated;
grant select on public.episodes to anon, authenticated;
grant select on public.transcript_chunks to anon, authenticated;
grant execute on function public.hybrid_search to anon, authenticated;
