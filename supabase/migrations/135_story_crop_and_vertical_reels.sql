-- 135 — sharing a rally to Instagram.
--
-- Two additions, both additive; nothing existing changes shape.
--
--  * matches.story_crop — where a 9:16 share should cut this camera.
--    Computed by the worker straight after table calibration, from corners
--    it already has in hand, so it costs no extra inference. null means
--    "use the whole frame", which is what a share would have done anyway.
--    Read directly by the web app and the iOS app through the existing
--    matches select policy: no new route, no new grant.
--
--      { "x": 535, "y": 0, "w": 1244, "h": 1080,
--        "camera": "side-on", "src_w": 1920, "src_h": 1080,
--        "frames": 15, "spread": 1.6 }
--
--  * match_reels gains the vertical scopes. The table has been keyed
--    (match_id, scope) since 028 and has carried a non-uuid scope form
--    ('tag:<uuid>') since 036, so vertical renders need no new table:
--
--      v:point:<point uuid>   one rally, 9:16, for an Instagram Story
--      v:starred              the starred points, 9:16, for a Reel
--
--  * enqueue_reel also gains a per-user cap on in-flight render jobs.
--    claim_processing has capped a user at four active jobs since 096, but
--    the reel path never did — and a Share button is tapped far more often
--    than Process. Without this, someone sharing a dozen rallies fills
--    their own queue and their next upload waits behind it.

alter table public.matches
  add column if not exists story_crop jsonb;

comment on column public.matches.story_crop is
  'Horizontal window a 9:16 share cuts from this camera; null = whole frame.';

-- The scope CHECK is the gate the function's own validation sits behind,
-- and widening only the function is not enough: enqueue_reel accepted the
-- new scope and the INSERT was then refused by the table. Caught by an
-- end-to-end enqueue, not by reading the function.
alter table public.match_reels
  drop constraint match_reels_scope_check;

alter table public.match_reels
  add constraint match_reels_scope_check check (
    scope in ('starred', 'full', 'v:starred')
    or scope ~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or scope ~ '^v:point:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- ---------------------------------------------------------------------------
-- enqueue_reel: vertical scopes + the in-flight cap.
-- Everything else is byte-identical to the 036 version.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_reel(
  p_match_id uuid,
  p_scope text,
  p_show_score boolean,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inflight int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or (
    p_scope not in ('starred', 'full', 'v:starred')
    and p_scope !~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_scope !~ '^v:point:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid scope';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and m.user_id = auth.uid()
  ) then
    raise exception 'match not found';
  end if;
  -- Tag scope: the tag must exist and belong to the caller (the match
  -- owner — only owners reach this point).
  if p_scope like 'tag:%' and not exists (
    select 1 from public.tags t
    where t.id = split_part(p_scope, ':', 2)::uuid
      and t.owner_id = auth.uid()
  ) then
    raise exception 'tag not found';
  end if;
  -- Single-rally scope: the point must be a live, clip-bearing point of
  -- THIS match. Without the match check a caller could name any point id
  -- they knew and have it rendered under a match they own.
  if p_scope like 'v:point:%' and not exists (
    select 1 from public.points p
    where p.id = split_part(p_scope, ':', 3)::uuid
      and p.match_id = p_match_id
      and not p.deleted
      and p.clip_path is not null
  ) then
    raise exception 'point not found';
  end if;
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array'
     or jsonb_array_length(p_manifest -> 'points') < 1
     or jsonb_array_length(p_manifest -> 'points') > 600 then
    raise exception 'invalid manifest';
  end if;

  -- Re-queueing a scope that is already in flight is not a new job, so it
  -- does not count against the cap; the upsert below just refreshes it.
  select count(*) into v_inflight
    from public.jobs j
   where j.user_id = auth.uid()
     and j.kind = 'reel'
     and j.status in ('queued', 'processing')
     and coalesce(j.options ->> 'scope', '') is distinct from p_scope;
  if v_inflight >= 3 then
    raise exception 'render_queue_full' using errcode = 'P0001';
  end if;

  insert into public.match_reels (match_id, scope, status, show_score, manifest)
  values (p_match_id, p_scope, 'queued', p_show_score, p_manifest)
  on conflict (match_id, scope) do update
    set status = 'queued',
        show_score = excluded.show_score,
        manifest = excluded.manifest,
        error = null;

  -- the jobs_enqueue trigger (001) sends the pgmq message
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'reel', 'queued', null, 'Match export',
          jsonb_build_object('match_id', p_match_id, 'scope', p_scope));
end;
$$;

revoke execute on function public.enqueue_reel(uuid, text, boolean, jsonb)
  from public, anon;
grant execute on function public.enqueue_reel(uuid, text, boolean, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The reel-ready notification (065) must stay quiet for shares.
-- A Story is handed to Instagram seconds after it renders; a bell saying
-- "your export is ready" would arrive after the player had already posted
-- it. Named exports keep their notification.
-- ---------------------------------------------------------------------------
-- Body copied from the LIVE definition (pg_get_functiondef, 2026-08-24) so
-- nothing already shipped is reverted by this migration. The only change is
-- the v:% early return below.
create or replace function public.match_reels_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_vs    text;
  v_what  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('ready', 'failed') then
    return new;
  end if;

  -- Vertical share renders are consumed by the caller within seconds. A
  -- bell saying "your export is ready" would land after the player had
  -- already posted it, and a failure is shown in the share sheet they are
  -- still looking at. Named exports keep both notifications.
  if new.scope like 'v:%' then
    return new;
  end if;

  select * into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;
  v_vs := public._vs_suffix(v_match.opponent_name);
  v_what := case when new.scope = 'full' then 'Full match' else 'Starred points' end;

  if new.status = 'ready' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_ready', v_match.id,
            v_what || ' ready',
            'Your export' || v_vs || ' is rendered. Tap to download it.',
            '/match/' || v_match.id::text || '?export=' || new.scope);
  else
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_failed', v_match.id,
            v_what || ' couldn''t be rendered',
            'Something went wrong rendering your export' || v_vs || '.',
            '/match/' || v_match.id::text);
  end if;

  return new;
end;
$$;
