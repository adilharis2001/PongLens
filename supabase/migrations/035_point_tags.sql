-- 035: point tags — short labels on individual points ("backhand error",
-- "pendulum serve"), the user's own vocabulary, so recurring problems
-- become countable instead of remembered.
--
-- Two tables, not a points.tags text[] column: one problem gets one
-- spelling (unique on lowercased label), renames stay possible, and
-- cross-match counts don't split across "bh error" / "Backhand Error".
--
-- tags are keyed to the MATCH OWNER (owner_id), not the author: a coach
-- tagging "forehand error" on your match reuses YOUR tag, otherwise
-- future counts double up. Attribution lives on point_tags.created_by.

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 1 and 40),
  created_at timestamptz not null default now()
);

create unique index tags_owner_label_idx
  on public.tags (owner_id, lower(btrim(label)));

create table public.point_tags (
  point_id   uuid not null references public.points (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (point_id, tag_id)
);

create index point_tags_tag_id_idx on public.point_tags (tag_id);

alter table public.tags enable row level security;
alter table public.point_tags enable row level security;

-- tags: the owner and their accepted coaches share one vocabulary. Only
-- the owner can rename or delete (a coach deleting a label would silently
-- strip it from every point).
create policy "Owner and accepted coaches can view tags"
  on public.tags for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.coach_links cl
      where cl.player_id = tags.owner_id
        and cl.coach_id = auth.uid()
        and cl.status = 'accepted'
    )
  );

create policy "Owner and accepted coaches can create tags"
  on public.tags for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    or exists (
      select 1 from public.coach_links cl
      where cl.player_id = tags.owner_id
        and cl.coach_id = auth.uid()
        and cl.status = 'accepted'
    )
  );

create policy "Owner can update tags"
  on public.tags for update
  to authenticated
  using (owner_id = auth.uid());

create policy "Owner can delete tags"
  on public.tags for delete
  to authenticated
  using (owner_id = auth.uid());

-- point_tags: anyone with match access can see and apply; the tag must
-- belong to the match owner (that is what keeps one vocabulary per
-- player). Removal: your own application, or any on your own match.
create policy "Match viewers can view point tags"
  on public.point_tags for select
  to authenticated
  using (
    exists (
      select 1 from public.points p
      where p.id = point_tags.point_id
        and public.has_match_access(p.match_id)
    )
  );

create policy "Match viewers can tag points with the owner's tags"
  on public.point_tags for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.points p
      join public.matches m on m.id = p.match_id
      join public.tags t on t.id = point_tags.tag_id
      where p.id = point_tags.point_id
        and public.has_match_access(m.id)
        and t.owner_id = m.user_id
    )
  );

create policy "Authors and match owners can remove point tags"
  on public.point_tags for delete
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.points p
      join public.matches m on m.id = p.match_id
      where p.id = point_tags.point_id
        and m.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, delete on public.point_tags to authenticated;

-- ---------------------------------------------------------------------------
-- tag_stats() — the Improve tag rail: every visible tag with its cross-match
-- reach ("backhand error · 34 points · 12 matches"). SECURITY INVOKER on
-- purpose: RLS on tags/point_tags/points scopes every row to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.tag_stats()
returns table (
  tag_id uuid,
  owner_id uuid,
  label text,
  point_count bigint,
  match_count bigint,
  last_used timestamptz
)
language sql
stable
as $$
  select
    t.id, t.owner_id, t.label,
    count(p.id) as point_count,
    count(distinct p.match_id) as match_count,
    max(pt.created_at) as last_used
  from public.tags t
  left join public.point_tags pt on pt.tag_id = t.id
  left join public.points p on p.id = pt.point_id and not p.deleted
  group by t.id
  order by count(p.id) desc, t.label asc;
$$;

-- ---------------------------------------------------------------------------
-- tagged_points(tag) — the Improve drill-down: every visible point carrying
-- the tag, with match title atoms and the point's DISPLAY number (position
-- in the match's surviving points under the t0-then-idx order the app uses
-- everywhere). SECURITY INVOKER: RLS scopes rows.
-- ---------------------------------------------------------------------------
create or replace function public.tagged_points(p_tag uuid)
returns table (
  point_id uuid,
  match_id uuid,
  point_no bigint,
  tagged_at timestamptz,
  tagged_by uuid,
  match_owner_id uuid,
  opponent_name text,
  venue text,
  played_at timestamptz,
  user_side text,
  player_near_name text,
  player_far_name text
)
language sql
stable
as $$
  select
    p.id as point_id,
    p.match_id,
    (
      select count(*) from public.points q
      where q.match_id = p.match_id and not q.deleted
        and (q.t0 < p.t0 or (q.t0 = p.t0 and q.idx <= p.idx))
    ) as point_no,
    pt.created_at as tagged_at,
    pt.created_by as tagged_by,
    m.user_id as match_owner_id,
    m.opponent_name, m.venue, m.played_at,
    m.user_side, m.player_near_name, m.player_far_name
  from public.point_tags pt
  join public.points p on p.id = pt.point_id and not p.deleted
  join public.matches m on m.id = p.match_id
  where pt.tag_id = p_tag
  order by m.played_at desc, p.t0 asc, p.idx asc;
$$;

grant execute on function public.tag_stats() to authenticated;
grant execute on function public.tagged_points(uuid) to authenticated;
revoke execute on function public.tag_stats() from public, anon;
revoke execute on function public.tagged_points(uuid) from public, anon;
