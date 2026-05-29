-- Guest catalog from tbpn-guests-research for scoped transcript search

create table public.guest_names (
  id uuid primary key default gen_random_uuid(),
  person text not null unique,
  normalized_name text not null,
  company text,
  job_position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guest_names_normalized_name_idx on public.guest_names (normalized_name);
create index guest_names_normalized_name_prefix_idx on public.guest_names (normalized_name text_pattern_ops);

create table public.guest_appearances (
  id uuid primary key default gen_random_uuid(),
  guest_name_id uuid not null references public.guest_names (id) on delete cascade,
  video_id text not null,
  episode_date date not null,
  start_seconds integer not null,
  end_seconds integer,
  chapter_title text,
  timestamp_url text not null,
  source_type text not null default 'youtube_chapter',
  created_at timestamptz not null default now(),
  unique (guest_name_id, video_id, start_seconds)
);

create index guest_appearances_video_id_start_idx on public.guest_appearances (video_id, start_seconds);
create index guest_appearances_guest_name_id_idx on public.guest_appearances (guest_name_id);
create index guest_appearances_episode_date_idx on public.guest_appearances (episode_date desc);

alter table public.guest_names enable row level security;
alter table public.guest_appearances enable row level security;

create policy "Public read guest names"
  on public.guest_names for select
  to anon, authenticated
  using (true);

create policy "Public read guest appearances"
  on public.guest_appearances for select
  to anon, authenticated
  using (true);

grant select on public.guest_names to anon, authenticated;
grant select on public.guest_appearances to anon, authenticated;
