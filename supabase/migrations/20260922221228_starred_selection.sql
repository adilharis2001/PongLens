-- Starred points across matches: the Home row, a share link for a hand-picked
-- selection, and one video of that selection.
-- Spec: docs/superpowers/specs/2026-09-22-starred-points-selection-design.md

-- ---------------------------------------------------------------------------
-- 1. starred_points(): an optional limit for Home's row, and number only the
--    matches that actually hold a star. The display number is a point's
--    position among its own match's visible points, so leaving other matches
--    out changes no number; it only stops the window running over every
--    point the account has ever uploaded to draw ten cards.
-- ---------------------------------------------------------------------------
drop function if exists public.starred_points();

create function public.starred_points(p_limit int default null)
returns table (
  id uuid,
  match_id uuid,
  display_no integer,
  t0 numeric,
  t1 numeric,
  has_clip boolean,
  confirmed_winner text,
  confirmed_how text,
  direction text,
  loss_reasons text[],
  is_let boolean,
  edited boolean,
  opponent_name text,
  venue text,
  played_at timestamptz,
  match_type text,
  has_thumb boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select m.id, m.opponent_name, m.venue, m.played_at, m.match_type,
           (m.thumb_path is not null) as has_thumb
    from public.matches m
    where m.user_id = (select auth.uid())
  ),
  holding as (
    select distinct p.match_id
    from public.points p
    where p.starred and not p.deleted
      and exists (select 1 from mine where mine.id = p.match_id)
  ),
  numbered as (
    select p.id, p.match_id, p.t0, p.t1, p.clip_path, p.confirmed_winner,
           p.confirmed_how, p.direction, p.loss_reasons, p.is_let,
           p.edited, p.starred,
           row_number() over (
             partition by p.match_id order by p.t0, p.idx
           ) as display_no
    from public.points p
    where public.active_point_version(p.id) and not p.deleted
      and p.match_id in (select holding.match_id from holding)
  )
  select n.id, n.match_id, n.display_no::int, n.t0, n.t1,
         (n.clip_path is not null),
         n.confirmed_winner, n.confirmed_how, n.direction, n.loss_reasons,
         n.is_let, n.edited,
         mi.opponent_name, mi.venue, mi.played_at, mi.match_type,
         mi.has_thumb
  from numbered n
  join mine mi on mi.id = n.match_id
  where n.starred
  order by mi.played_at desc, n.display_no
  limit p_limit
$$;

revoke all on function public.starred_points(int) from public, anon;
grant execute on function public.starred_points(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. share_links kind 'selection': a fixed list of the owner's own points,
--    from any number of matches.
-- ---------------------------------------------------------------------------
alter table public.share_links add column if not exists point_ids uuid[];

alter table public.share_links drop constraint if exists share_links_kind_check;
alter table public.share_links add constraint share_links_kind_check check (
  kind = any (array['point', 'match', 'starred', 'tag', 'entry', 'highlights',
                    'lesson_recap', 'selection'])
);

alter table public.share_links drop constraint if exists share_links_check;
alter table public.share_links add constraint share_links_check check (
  (kind = 'point' and match_id is not null and point_id is not null
     and tag_id is null and lesson_id is null and lesson_video_id is null
     and point_ids is null)
  or (kind = any (array['match', 'starred', 'highlights'])
     and match_id is not null and point_id is null and tag_id is null
     and lesson_id is null and lesson_video_id is null and point_ids is null)
  or (kind = 'tag' and match_id is not null and point_id is null
     and tag_id is not null and lesson_id is null and lesson_video_id is null
     and point_ids is null)
  or (kind = 'entry' and lesson_id is not null and match_id is null
     and point_id is null and tag_id is null and lesson_video_id is null
     and point_ids is null)
  or (kind = 'lesson_recap' and lesson_video_id is not null
     and lesson_id is null and match_id is null and point_id is null
     and tag_id is null and point_ids is null)
  or (kind = 'selection' and point_ids is not null
     and cardinality(point_ids) between 1 and 100
     and match_id is null and point_id is null and tag_id is null
     and lesson_id is null and lesson_video_id is null)
);

-- One active link per identical selection, like every other kind: sharing
-- the same points again hands back the link already out there.
create unique index if not exists share_links_active_selection_uniq
  on public.share_links (owner, point_ids)
  where kind = 'selection' and revoked_at is null;

-- The owner's own points only, checked with definer rights so a point the
-- caller cannot see is refused rather than slipping through an RLS-blind
-- join. After creation the list, the kind and the owner are frozen: the only
-- change a selection link ever takes is its title or being switched off.
create or replace function public.share_links_selection_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.kind = 'selection' or new.kind = 'selection')
       and (new.kind is distinct from old.kind
            or new.owner is distinct from old.owner
            or new.point_ids is distinct from old.point_ids) then
      raise exception 'a selection link cannot be retargeted'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.kind = 'selection' then
    if (select count(distinct x) from unnest(new.point_ids) as x)
         <> cardinality(new.point_ids)
       or exists (
         select 1
         from unnest(new.point_ids) as s(pid)
         left join public.points p on p.id = s.pid
         left join public.matches m on m.id = p.match_id
         where p.id is null or p.deleted or m.user_id is distinct from new.owner
       ) then
      raise exception 'selection points must be the owner''s own'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists share_links_selection_guard on public.share_links;
create trigger share_links_selection_guard
  before insert or update on public.share_links
  for each row execute function public.share_links_selection_guard();

-- The owner may create and switch off a selection link. The ownership of its
-- points is the trigger's job; this only lets the row shape through, the
-- same way the other disjuncts let a match, entry or recap row through.
drop policy if exists "Owners manage own share links" on public.share_links;
create policy "Owners manage own share links"
  on public.share_links
  for all
  to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and (
      (match_id is not null and exists (
         select 1 from public.matches m
         where m.id = share_links.match_id
           and m.user_id = (select auth.uid())))
      or (lesson_id is not null and exists (
         select 1 from public.lessons l
         where l.id = share_links.lesson_id
           and l.user_id = (select auth.uid())))
      or (lesson_video_id is not null and exists (
         select 1 from public.lesson_videos v
         where v.id = share_links.lesson_video_id
           and v.owner_id = (select auth.uid())))
      or (kind = 'selection' and point_ids is not null)
    )
    and (point_id is null or exists (
      select 1 from public.points p
      where p.id = share_links.point_id
        and p.match_id = share_links.match_id))
    and (tag_id is null or exists (
      select 1 from public.tags t
      where t.id = share_links.tag_id
        and t.owner_id = (select auth.uid())))
  );

-- The link itself, for the public page's heading. Nothing about the owner.
create or replace function public.resolve_share_selection_link(p_token text)
returns table (id uuid, title text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select sl.id, sl.title, sl.created_at
  from public.share_links sl
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind = 'selection'
$$;

-- Its clips, in the order they were picked. A point only comes back while
-- its match still belongs to the link's owner, it is not deleted, and it is
-- on the match's active version; everything else drops out quietly. The
-- number is the same one the owner's shelf prints (starred_points above).
create or replace function public.resolve_share_selection(p_token text)
returns table (
  id uuid,
  match_id uuid,
  number integer,
  t0 numeric,
  t1 numeric,
  clip_path text,
  opponent_name text,
  venue text,
  played_at timestamptz,
  match_type text,
  ord integer
)
language sql
stable
security definer
set search_path = public
as $$
  with link as (
    select sl.owner, sl.point_ids
    from public.share_links sl
    where sl.token = p_token
      and sl.revoked_at is null
      and sl.kind = 'selection'
  ),
  picked as (
    select s.pid, s.ord
    from link, unnest(link.point_ids) with ordinality as s(pid, ord)
  ),
  owned as (
    select m.id, m.opponent_name, m.venue, m.played_at, m.match_type
    from public.matches m
    join link on m.user_id = link.owner
    where m.id in (
      select p.match_id from public.points p join picked on picked.pid = p.id
    )
  ),
  numbered as (
    select p.id, p.match_id, p.t0, p.t1, p.clip_path,
           row_number() over (
             partition by p.match_id order by p.t0, p.idx
           ) as number
    from public.points p
    where p.match_id in (select owned.id from owned)
      and public.active_point_version(p.id) and not p.deleted
  )
  select n.id, n.match_id, n.number::int, n.t0, n.t1, n.clip_path,
         o.opponent_name, o.venue, o.played_at, o.match_type,
         picked.ord::int
  from picked
  join numbered n on n.id = picked.pid
  join owned o on o.id = n.match_id
  order by picked.ord
$$;

revoke all on function public.resolve_share_selection_link(text) from public;
revoke all on function public.resolve_share_selection(text) from public;
grant execute on function public.resolve_share_selection_link(text)
  to anon, authenticated, service_role;
grant execute on function public.resolve_share_selection(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. One video of a selection per account, rendered by the worker on the
--    same 9:16 canvas as a starred-highlights share.
-- ---------------------------------------------------------------------------
create table if not exists public.selection_reels (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'queued'
    check (status = any (array['queued', 'rendering', 'ready', 'failed'])),
  manifest jsonb not null,
  r2_key text,
  duration_s numeric,
  size_bytes bigint,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.selection_reels enable row level security;

drop policy if exists "Owners read own selection reels" on public.selection_reels;
create policy "Owners read own selection reels"
  on public.selection_reels
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.selection_reels from anon, authenticated;
grant select on public.selection_reels to authenticated;
grant select, insert, update, delete on public.selection_reels to ponglens_worker;
grant all on public.selection_reels to service_role;

-- Queue a render. Every manifest point must be an active, undeleted point
-- with a clip, in a match the caller owns, and the match the manifest names
-- for it must be that point's own match: the worker reads the cut video and
-- the crop by that id, so it is never taken on trust.
create or replace function public.enqueue_selection_reel(p_manifest jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_inflight int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array' then
    raise exception 'invalid manifest' using errcode = '23514';
  end if;
  v_count := jsonb_array_length(p_manifest -> 'points');
  if v_count < 1 or v_count > 60 then
    raise exception 'invalid manifest' using errcode = '23514';
  end if;
  perform public.require_active_reel_manifest(p_manifest, null);
  if exists (
    select 1
    from jsonb_array_elements(p_manifest -> 'points') e
    left join public.points p on p.id = nullif(e ->> 'point_id', '')::uuid
    left join public.matches m on m.id = p.match_id
    where p.id is null
       or p.deleted
       or p.clip_path is null
       or m.user_id is distinct from v_uid
       or nullif(e ->> 'match_id', '')::uuid is distinct from p.match_id
  ) then
    raise exception 'point not found' using errcode = 'P0001';
  end if;

  select count(*) into v_inflight
    from public.jobs j
   where j.user_id = v_uid
     and j.kind = 'reel'
     and j.status in ('queued', 'processing')
     and coalesce(j.options ->> 'scope', '') is distinct from 'v:selection';
  if v_inflight >= 3 then
    raise exception 'render_queue_full' using errcode = 'P0001';
  end if;

  insert into public.selection_reels (user_id, status, manifest)
  values (v_uid, 'queued', p_manifest)
  on conflict (user_id) do update
    set status = 'queued',
        manifest = excluded.manifest,
        error = null,
        updated_at = now();

  -- A job still waiting will read the row as it now stands. One already
  -- running is rendering the previous request and will cancel itself at the
  -- finish, so the new request needs a job of its own.
  if not exists (
    select 1 from public.jobs j
    where j.user_id = v_uid
      and j.kind = 'reel'
      and j.status = 'queued'
      and j.options ->> 'scope' = 'v:selection'
  ) then
    -- The v: scope routes this to the fast lane (enqueue_job).
    insert into public.jobs (user_id, kind, status, input_path,
                             original_name, options)
    values (v_uid, 'reel', 'queued', null, 'Starred points video',
            jsonb_build_object('scope', 'v:selection'));
  end if;
end
$$;

revoke all on function public.enqueue_selection_reel(jsonb) from public, anon;
grant execute on function public.enqueue_selection_reel(jsonb)
  to authenticated, service_role;
