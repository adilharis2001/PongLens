-- 036: share and export a match's TAGGED points, mirroring the starred
-- flow end to end.
--
--  * match_reels.scope gains 'tag:<tag uuid>' composite scopes — one
--    rendered artifact per (match, tag), r2 key
--    reels/<match_id>-tag-<tag_id>.mp4. The manifest is still computed in
--    /api/reel (the worker renders whatever points the manifest lists), so
--    the render pipeline is unchanged beyond scope validation + key naming.
--  * enqueue_reel() accepts tag scopes and re-checks the tag belongs to
--    the caller (tags are owner-keyed, and only owners publish media).
--  * share_links.kind gains 'tag' with a tag_id column — a public link to
--    the points CURRENTLY carrying that tag, resolved at view time like
--    'starred' (tagging/untagging after the link exists changes what
--    viewers see). One active tag link per (match, tag).
--  * resolve_share_link() gains tag_label so the /s page can title the
--    collection; resolve_share_tagged() mirrors resolve_share_starred().

-- ---------------------------------------------------------------------------
-- match_reels: tag scopes
-- ---------------------------------------------------------------------------
alter table public.match_reels drop constraint match_reels_scope_check;
alter table public.match_reels add constraint match_reels_scope_check
  check (
    scope in ('starred', 'full')
    or scope ~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

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
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or (
    p_scope not in ('starred', 'full')
    and p_scope !~ '^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
  if jsonb_typeof(p_manifest -> 'points') is distinct from 'array'
     or jsonb_array_length(p_manifest -> 'points') < 1
     or jsonb_array_length(p_manifest -> 'points') > 600 then
    raise exception 'invalid manifest';
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

-- ---------------------------------------------------------------------------
-- share_links: kind 'tag'
-- ---------------------------------------------------------------------------
alter table public.share_links
  add column tag_id uuid references public.tags (id) on delete cascade;

alter table public.share_links
  drop constraint share_links_kind_check;
alter table public.share_links
  add constraint share_links_kind_check
  check (kind in ('point', 'match', 'starred', 'tag'));

alter table public.share_links
  drop constraint share_links_check;
alter table public.share_links
  add constraint share_links_check
  check (
    (kind = 'point' and point_id is not null and tag_id is null)
    or (kind in ('match', 'starred') and point_id is null and tag_id is null)
    or (kind = 'tag' and point_id is null and tag_id is not null)
  );

-- One ACTIVE tag link per (match, tag); revoked rows don't block a fresh one.
create unique index share_links_active_tag_uniq
  on public.share_links (match_id, tag_id)
  where kind = 'tag' and revoked_at is null;

-- Owner policy: same shape as 013 plus the tag pin — a tag link must name
-- a tag the caller owns (tags are keyed to the match owner, so for a
-- self-owned match this is the same person).
drop policy "Owners manage own share links" on public.share_links;
create policy "Owners manage own share links"
  on public.share_links for all
  to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = share_links.match_id
        and m.user_id = (select auth.uid())
    )
    and (
      point_id is null
      or exists (
        select 1 from public.points p
        where p.id = share_links.point_id
          and p.match_id = share_links.match_id
      )
    )
    and (
      tag_id is null
      or exists (
        select 1 from public.tags t
        where t.id = share_links.tag_id
          and t.owner_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- resolve_share_link(token) — as in 016, plus tag_label for 'tag' links.
-- Return type changes -> drop + recreate + re-grant.
-- ---------------------------------------------------------------------------
drop function public.resolve_share_link(text);

create function public.resolve_share_link(p_token text)
returns table (
  kind                   text,
  match_id               uuid,
  point_id               uuid,
  title                  text,
  tag_label              text,
  opponent_name          text,
  player_near_name       text,
  player_far_name        text,
  played_at              timestamptz,
  cut_path               text,
  original_name          text,
  point_number           int,
  point_t0               numeric,
  point_t1               numeric,
  point_clip_path        text,
  point_starred          boolean,
  point_confirmed_winner text,
  point_confirmed_how    text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sl.kind,
    sl.match_id,
    sl.point_id,
    sl.title,
    t.label as tag_label,
    m.opponent_name,
    m.player_near_name,
    m.player_far_name,
    m.played_at,
    coalesce(
      m.cut_path,
      (select j.result_path from public.jobs j
        where j.id = m.job_id and j.status = 'done')
    ) as cut_path,
    (select j.original_name from public.jobs j where j.id = m.job_id)
      as original_name,
    case when p.id is null then null else (
      select count(*)::int from public.points q
      where q.match_id = p.match_id
        and q.deleted = false
        and (coalesce(q.t0, q.idx), q.idx) <= (coalesce(p.t0, p.idx), p.idx)
    ) end as point_number,
    p.t0,
    p.t1,
    p.clip_path,
    p.starred,
    p.confirmed_winner,
    p.confirmed_how
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  left join public.points p on p.id = sl.point_id
  left join public.tags t on t.id = sl.tag_id
  where sl.token = p_token
    and sl.revoked_at is null
    and (sl.point_id is null or (p.id is not null and p.deleted = false));
$$;

revoke execute on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_share_tagged(token) — the points CURRENTLY carrying the link's
-- tag, in timeline order with DISPLAY numbers. Live by design, exactly like
-- resolve_share_starred: untagging after the link exists changes the page.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_share_tagged(p_token text)
returns table (
  id        uuid,
  number    int,
  t0        numeric,
  t1        numeric,
  clip_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.t0, q.t1, q.clip_path
  from (
    select
      p.id, p.t0, p.t1, p.clip_path,
      exists (
        select 1 from public.point_tags pt
        where pt.point_id = p.id and pt.tag_id = sl.tag_id
      ) as tagged,
      row_number() over (order by coalesce(p.t0, p.idx), p.idx)::int
        as number
    from public.share_links sl
    join public.points p on p.match_id = sl.match_id
    where sl.token = p_token
      and sl.revoked_at is null
      and sl.kind = 'tag'
      and p.deleted = false
  ) q
  where q.tagged
  order by q.number;
$$;

revoke execute on function public.resolve_share_tagged(text) from public;
grant execute on function public.resolve_share_tagged(text) to anon, authenticated;
