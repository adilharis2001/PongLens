-- PongLens SPEC.md phase 2 — Match-centric experience schema
-- matches / points / notes / coach_links / feedback + jobs.options.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.

-- ---------------------------------------------------------------------------
-- jobs.options — upload-sheet flags ride on the job row
-- { "points": bool, "placement": bool, "strictness": "tight"|"normal"|"loose" }
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists options jsonb not null default '{}'::jsonb;

-- include options in the queue payload so the worker sees them without a
-- second lookup (worker also falls back to reading the row)
create or replace function public.enqueue_job()
returns trigger
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.send(
    'jobs',
    jsonb_build_object(
      'job_id', new.id,
      'user_id', new.user_id,
      'kind', new.kind,
      'input_path', new.input_path,
      'options', new.options
    )
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- matches — one row per processed match (created by the worker)
-- ---------------------------------------------------------------------------
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  job_id          uuid references public.jobs (id) on delete set null,
  opponent_name   text,
  played_at       timestamptz not null default now(),
  cut_path        text,           -- r2://ponglens-media/results/<uid>/<jobId>.mp4
  match_json_path text,           -- r2://ponglens-media/points/<uid>/<matchId>/match.json
  status          text not null default 'processing'
                  check (status in ('processing', 'ready', 'failed')),
  created_at      timestamptz not null default now()
);

create index matches_user_id_created_at_idx
  on public.matches (user_id, created_at desc);
create index matches_job_id_idx on public.matches (job_id);

-- ---------------------------------------------------------------------------
-- points — one row per detected point in a match (created by the worker)
-- ---------------------------------------------------------------------------
create table public.points (
  id               uuid primary key default gen_random_uuid(),
  match_id         uuid not null references public.matches (id) on delete cascade,
  idx              int  not null,
  t0               numeric,        -- seconds in the ORIGINAL video
  t1               numeric,
  clip_path        text,           -- r2://ponglens-media/points/<uid>/<matchId>/NN.mp4
  server           text check (server in ('user', 'opponent')),
  placement        jsonb,          -- {"bounces":[{t,u,v,side},...]} when placement on
  suggestion       jsonb,          -- {"winner","how","n_hits","reason"} AI suggestion ONLY
  confirmed_winner text check (confirmed_winner in ('user', 'opponent')),
  confirmed_how    text,
  starred          boolean not null default false,
  unique (match_id, idx)
);

create index points_match_id_idx on public.points (match_id, idx);

-- ---------------------------------------------------------------------------
-- coach_links — sharing links (player invites a coach; scope = one match or all)
-- ---------------------------------------------------------------------------
create table public.coach_links (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references auth.users (id) on delete cascade,
  coach_id       uuid references auth.users (id) on delete cascade,
  invite_token   uuid not null default gen_random_uuid(),
  scope_match_id uuid references public.matches (id) on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending', 'accepted', 'revoked')),
  created_at     timestamptz not null default now(),
  unique (invite_token)
);

create index coach_links_player_id_idx on public.coach_links (player_id);
create index coach_links_coach_id_idx on public.coach_links (coach_id);

-- ---------------------------------------------------------------------------
-- notes — per-match / per-point notes by the player or an accepted coach
-- ---------------------------------------------------------------------------
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  point_id   uuid references public.points (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null default '',
  audio_path text,                -- voice note audio in R2 (90-day tier)
  created_at timestamptz not null default now()
);

create index notes_match_id_idx on public.notes (match_id);
create index notes_point_id_idx on public.notes (point_id);

-- ---------------------------------------------------------------------------
-- feedback — "Something wrong with this match?" accuracy telemetry
-- ---------------------------------------------------------------------------
create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  match_id   uuid references public.matches (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index feedback_user_id_idx on public.feedback (user_id);

-- ---------------------------------------------------------------------------
-- Access helper: does auth.uid() have (player or accepted-coach) access to a
-- match? SECURITY DEFINER so policies on points/notes don't re-enter the
-- matches/coach_links RLS.
-- ---------------------------------------------------------------------------
create or replace function public.has_match_access(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = m_id
      and (
        m.user_id = auth.uid()
        or exists (
          select 1
          from public.coach_links cl
          where cl.coach_id = auth.uid()
            and cl.player_id = m.user_id
            and cl.status = 'accepted'
            and (cl.scope_match_id is null or cl.scope_match_id = m.id)
        )
      )
  );
$$;

revoke execute on function public.has_match_access(uuid) from public, anon;
grant execute on function public.has_match_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Coach invite acceptance (SECURITY DEFINER: the coach cannot see the pending
-- row under RLS, so acceptance goes through this function)
-- ---------------------------------------------------------------------------
create or replace function public.accept_coach_invite(token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.coach_links
     set coach_id = auth.uid(),
         status = 'accepted'
   where invite_token = token
     and status = 'pending'
     and player_id <> auth.uid()
     and (coach_id is null or coach_id = auth.uid())
  returning id into link_id;
  if link_id is null then
    raise exception 'invite not found, already used, or revoked';
  end if;
  return link_id;
end;
$$;

revoke execute on function public.accept_coach_invite(uuid) from public, anon;
grant execute on function public.accept_coach_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.matches enable row level security;
alter table public.points enable row level security;
alter table public.notes enable row level security;
alter table public.coach_links enable row level security;
alter table public.feedback enable row level security;

-- matches: owner select/insert/update; accepted coaches read-only.
create policy "Owner and coaches can view matches"
  on public.matches for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.coach_links cl
      where cl.coach_id = (select auth.uid())
        and cl.player_id = matches.user_id
        and cl.status = 'accepted'
        and (cl.scope_match_id is null or cl.scope_match_id = matches.id)
    )
  );

create policy "Owner can create matches"
  on public.matches for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Owner can update own matches"
  on public.matches for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- column-level: authenticated users may only touch opponent_name (the worker
-- uses the service role, which keeps full privileges)
revoke update on public.matches from authenticated;
grant update (opponent_name) on public.matches to authenticated;

-- points: read for owner + coaches; update (scorecard/star) for owner only,
-- restricted to the confirmation columns; inserts come from the worker.
create policy "Match viewers can view points"
  on public.points for select
  to authenticated
  using (public.has_match_access(match_id));

create policy "Match owner can update points"
  on public.points for update
  to authenticated
  using (exists (select 1 from public.matches m
                 where m.id = points.match_id
                   and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.matches m
                      where m.id = points.match_id
                        and m.user_id = (select auth.uid())));

revoke insert, update, delete on public.points from authenticated;
grant update (confirmed_winner, confirmed_how, starred)
  on public.points to authenticated;

-- notes: anyone with match access can write their own notes and read all;
-- authors manage their own rows.
create policy "Match viewers can view notes"
  on public.notes for select
  to authenticated
  using (public.has_match_access(match_id));

create policy "Match viewers can add own notes"
  on public.notes for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.has_match_access(match_id)
    and (point_id is null or exists (
      select 1 from public.points p
      where p.id = notes.point_id and p.match_id = notes.match_id
    ))
  );

create policy "Authors can update own notes"
  on public.notes for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "Authors can delete own notes"
  on public.notes for delete
  to authenticated
  using (author_id = (select auth.uid()));

-- coach_links: player has full control of own links; coach can see links
-- naming them (acceptance goes through accept_coach_invite()).
create policy "Players manage own coach links"
  on public.coach_links for all
  to authenticated
  using (player_id = (select auth.uid()))
  with check (player_id = (select auth.uid()));

create policy "Coaches can view own coach links"
  on public.coach_links for select
  to authenticated
  using (coach_id = (select auth.uid()));

-- feedback: owner insert/select.
create policy "Users can create own feedback"
  on public.feedback for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can view own feedback"
  on public.feedback for select
  to authenticated
  using (user_id = (select auth.uid()));
