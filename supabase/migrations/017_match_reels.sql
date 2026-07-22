-- 017: rendered highlight reels (Share v1.5).
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * match_reels — one rendered reel per match (pk = match_id). The API
--    computes the manifest IN TS (score truth lives in gameScore.ts) and
--    stores it here; the Mac worker renders it with ffmpeg and overwrites
--    r2://ponglens-media/reels/<match_id>.mp4. manifest shape:
--      { you_name, them_name, played_at,
--        points: [{ point_id, clip_path, score_you, score_them,
--                   games_you, games_them }] }   -- score ENTERING the rally
--  * RLS: the match owner may SELECT (status line in the share sheet).
--    All writes go through service connections only: the API enqueues via
--    the owner-checked SECURITY DEFINER enqueue_reel(); the worker updates
--    over its direct service connection. authenticated gets no write grants.
--  * enqueue_reel(match_id, show_score, manifest) — upserts the reel row
--    back to 'queued' and inserts a jobs row (kind 'reel'); the existing
--    jobs_enqueue trigger pushes it onto pgmq for the worker.
--  * storage_ledger.kind gains 'reel' — reel bytes are booked per match
--    (match_id rides along, so the 010 match-delete trigger frees them).

create table public.match_reels (
  match_id   uuid primary key references public.matches (id) on delete cascade,
  status     text not null default 'queued'
             check (status in ('queued', 'rendering', 'ready', 'failed')),
  show_score boolean not null,
  manifest   jsonb not null,
  r2_key     text,
  duration_s numeric,
  size_bytes bigint,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger match_reels_set_updated_at
  before update on public.match_reels
  for each row execute function public.set_updated_at();

alter table public.match_reels enable row level security;

-- Owner reads status/duration for the share sheet; nobody else sees rows.
create policy "Owner can read own reels"
  on public.match_reels for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_reels.match_id
        and m.user_id = (select auth.uid())
    )
  );

revoke all on public.match_reels from anon;
revoke insert, update, delete on public.match_reels from authenticated;

-- reel bytes in the storage ledger
alter table public.storage_ledger
  drop constraint storage_ledger_kind_check;
alter table public.storage_ledger
  add constraint storage_ledger_kind_check
  check (kind in ('clip', 'cut', 'voice', 'reel', 'other'));

-- ---------------------------------------------------------------------------
-- enqueue_reel(match_id, show_score, manifest) — owner-checked write path.
-- The API route validates + computes the manifest; this function only
-- re-checks ownership and shape, then queues the render job.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_reel(
  p_match_id uuid,
  p_show_score boolean,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and m.user_id = auth.uid()
  ) then
    raise exception 'match not found';
  end if;
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array'
     or jsonb_array_length(p_manifest -> 'points') < 1
     or jsonb_array_length(p_manifest -> 'points') > 200 then
    raise exception 'invalid manifest';
  end if;

  insert into public.match_reels (match_id, status, show_score, manifest)
  values (p_match_id, 'queued', p_show_score, p_manifest)
  on conflict (match_id) do update
    set status = 'queued',
        show_score = excluded.show_score,
        manifest = excluded.manifest,
        error = null;

  -- the jobs_enqueue trigger (001) sends the pgmq message
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'reel', 'queued', null, 'Highlight reel',
          jsonb_build_object('match_id', p_match_id));
end;
$$;

revoke execute on function public.enqueue_reel(uuid, boolean, jsonb)
  from public, anon;
grant execute on function public.enqueue_reel(uuid, boolean, jsonb)
  to authenticated;
