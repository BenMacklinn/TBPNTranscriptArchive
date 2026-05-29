-- Add optional time-window filters for guest-scoped search

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
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  perform set_config('statement_timeout', '30s', true);

  return query
  with candidate_limit as (
    select least(match_count, 30) * 2 as value
  ),
  full_text as (
    select
      ranked.id,
      row_number() over (order by ranked.rank_score desc) as rank_ix
    from (
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
      limit (select value from candidate_limit)
    ) ranked
  ),
  semantic as (
    select
      ranked.id,
      row_number() over (order by ranked.distance) as rank_ix
    from (
      select
        tc.id,
        tc.embedding <=> query_embedding as distance
      from public.transcript_chunks tc
      where tc.embedding is not null
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
      order by tc.embedding <=> query_embedding
      limit (select value from candidate_limit)
    ) ranked
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
    f.score
  from fused f
  join public.transcript_chunks tc on tc.id = f.id
  join public.episodes e on e.id = tc.episode_id
  order by f.score desc
  limit least(match_count, 30);
end;
$$;

grant execute on function public.hybrid_search(
  text,
  extensions.vector,
  int,
  float,
  float,
  int,
  date,
  date,
  text,
  int,
  int
) to anon, authenticated;
