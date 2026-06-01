-- Keyword-only search for Pinecone-backed hybrid retrieval.
-- This mirrors the row shape of hybrid_search without reading transcript_chunks.embedding.

create or replace function public.keyword_search(
  query_text text,
  match_count int default 20,
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
language plpgsql
stable
set search_path = public
as $$
begin
  perform set_config('statement_timeout', '30s', true);

  return query
  with ranked as (
    select
      tc.id,
      ts_rank_cd(tc.fts, websearch_to_tsquery('english', query_text)) as rank_score
    from public.transcript_chunks tc
    where tc.fts @@ websearch_to_tsquery('english', query_text)
      and (filter_episode_id is null or tc.episode_id = filter_episode_id)
      and (min_start_seconds is null or tc.start_seconds >= min_start_seconds)
      and (max_start_seconds is null or tc.start_seconds < max_start_seconds)
      and case
        when date_from is null and date_to is null then true
        else exists (
          select 1
          from public.episodes e
          where e.id = tc.episode_id
            and (date_from is null or e.published_at >= date_from)
            and (date_to is null or e.published_at <= date_to)
        )
      end
    order by rank_score desc
    limit least(match_count, 30) * 2
  )
  select
    tc.id as chunk_id,
    tc.episode_id,
    tc.start_seconds,
    tc.end_seconds,
    tc.start_time,
    tc.end_time,
    tc.text as chunk_text,
    tc.speaker,
    e.title as episode_title,
    e.published_at,
    e.youtube_video_id,
    e.source_url,
    ranked.rank_score::double precision as score
  from ranked
  join public.transcript_chunks tc on tc.id = ranked.id
  join public.episodes e on e.id = tc.episode_id
  order by ranked.rank_score desc
  limit least(match_count, 30);
end;
$$;

grant execute on function public.keyword_search(
  text,
  int,
  date,
  date,
  text,
  int,
  int
) to anon, authenticated;
