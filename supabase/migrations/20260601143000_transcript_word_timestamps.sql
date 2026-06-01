-- Store canonical word-level timestamps for model-transcribed episodes.
-- Search still uses transcript_chunks; this table adds precise timing on top.

create table if not exists public.transcript_words (
  id uuid primary key default gen_random_uuid(),
  episode_id text not null references public.episodes (id) on delete cascade,
  chunk_id uuid references public.transcript_chunks (id) on delete set null,
  word_index integer not null,
  word text not null,
  start_seconds numeric(10, 3) not null,
  end_seconds numeric(10, 3) not null,
  created_at timestamptz not null default now(),
  unique (episode_id, word_index)
);

create index if not exists transcript_words_episode_id_idx
  on public.transcript_words (episode_id, word_index);

create index if not exists transcript_words_chunk_id_idx
  on public.transcript_words (chunk_id);

alter table public.transcript_words enable row level security;

drop policy if exists "Public read transcript words" on public.transcript_words;
create policy "Public read transcript words"
  on public.transcript_words for select
  to anon, authenticated
  using (true);

grant select on public.transcript_words to anon, authenticated;
