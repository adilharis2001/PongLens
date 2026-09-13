-- The admin's own answer to what a card should have been.
--
-- The cards carry three things the pipeline gets wrong often enough to be
-- worth teaching: who served, who won the point, and where one card really
-- holds two points (or two cards one). The verdict lives only in the
-- footage, so the person watching it is the instrument — the same shape as
-- the event labels in 154, one row per card instead of one per bounce.
--
-- ENDS, not people. `server_end` and `winner_end` say near or far, which
-- is what the camera can see and what the detector actually reads. Turning
-- an end into a person needs the uploader's end for THAT game, and players
-- change ends every game, so a stored "user"/"opponent" would quietly rot
-- at the first changeover. The page names the player beside the button
-- where it knows the ends; the row stores the thing that cannot go stale.
--
-- `splits` are SOURCE seconds, the clock every other artifact uses, at the
-- moment the first point inside the card ended. `join_next` says this card
-- and the one after it are one point. Neither touches the player's own
-- points: nothing here is an edit to somebody's match, and nothing in the
-- product reads these rows back. They are training rows.
--
-- Same access shape as 150 and 154: RLS on with no policies, so the
-- SECURITY DEFINER functions are the only way in and every one of them
-- re-checks is_admin().

create table if not exists public.admin_point_labels (
  point_id   uuid primary key references public.points (id) on delete cascade,
  -- Denormalised so one match's labels are one indexed read, and so a
  -- training export can group by match without joining points.
  match_id   uuid not null references public.matches (id) on delete cascade,
  server_end text check (server_end in ('near', 'far')),
  winner_end text check (winner_end in ('near', 'far')),
  -- Ascending, distinct, source seconds inside the card.
  splits     numeric(9,2)[] not null default '{}',
  join_next  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_point_labels_match_idx
  on public.admin_point_labels (match_id);

alter table public.admin_point_labels enable row level security;
revoke all on public.admin_point_labels from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Filing one
-- ---------------------------------------------------------------------------
-- A PATCH, not a replace. The four fields are filed by four separate taps
-- seconds apart, and a whole-row write would have each tap clobber the
-- last one's field with whatever the page happened to be holding. Keys
-- absent from the patch are left alone; a key present with a json null
-- clears that field.
--
-- The row is deleted once every field is back to empty, so "this card has
-- been labelled" stays a question about the row existing.
create or replace function public.admin_point_label_set(
  p_point_id uuid,
  p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id   uuid;
  v_server     text;
  v_winner     text;
  v_splits     numeric(9,2)[];
  v_join       boolean;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'a patch must be a json object';
  end if;

  select p.match_id into v_match_id
    from public.points p where p.id = p_point_id;
  if v_match_id is null then
    raise exception 'no such point';
  end if;

  -- Start from what is stored, so an absent key means "leave it".
  select l.server_end, l.winner_end, l.splits, l.join_next
    into v_server, v_winner, v_splits, v_join
    from public.admin_point_labels l where l.point_id = p_point_id;
  v_splits := coalesce(v_splits, '{}');
  v_join   := coalesce(v_join, false);

  if p_patch ? 'server_end' then
    v_server := nullif(p_patch ->> 'server_end', '');
    if v_server is not null and v_server not in ('near', 'far') then
      raise exception 'server_end must be near or far';
    end if;
  end if;

  if p_patch ? 'winner_end' then
    v_winner := nullif(p_patch ->> 'winner_end', '');
    if v_winner is not null and v_winner not in ('near', 'far') then
      raise exception 'winner_end must be near or far';
    end if;
  end if;

  if p_patch ? 'splits' then
    if jsonb_typeof(p_patch -> 'splits') = 'null' then
      v_splits := '{}';
    elsif jsonb_typeof(p_patch -> 'splits') <> 'array' then
      raise exception 'splits must be an array of seconds';
    else
      -- Sorted and deduped here rather than in the page: two taps a frame
      -- apart are one split, and the order is what makes the list mean
      -- "first point ends, then the second".
      select coalesce(array_agg(distinct round(s::numeric, 2) order by
                                round(s::numeric, 2)), '{}')
        into v_splits
        from jsonb_array_elements_text(p_patch -> 'splits') as s;
      if array_length(v_splits, 1) > 12 then
        raise exception 'that is too many splits for one card';
      end if;
    end if;
  end if;

  if p_patch ? 'join_next' then
    v_join := coalesce((p_patch ->> 'join_next')::boolean, false);
  end if;

  if v_server is null and v_winner is null
     and coalesce(array_length(v_splits, 1), 0) = 0 and not v_join then
    delete from public.admin_point_labels l where l.point_id = p_point_id;
  else
    insert into public.admin_point_labels as l
      (point_id, match_id, server_end, winner_end, splits, join_next)
    values
      (p_point_id, v_match_id, v_server, v_winner, v_splits, v_join)
    on conflict (point_id) do update
      set server_end = excluded.server_end,
          winner_end = excluded.winner_end,
          splits     = excluded.splits,
          join_next  = excluded.join_next,
          updated_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading them back — one match for the page, every match for an export.
-- ---------------------------------------------------------------------------
create or replace function public.admin_point_labels(
  p_match_id uuid default null)
returns table (
  point_id   uuid,
  match_id   uuid,
  idx        int,
  t0         numeric,
  t1         numeric,
  server_end text,
  winner_end text,
  splits     numeric[],
  join_next  boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select l.point_id, l.match_id, p.idx, p.t0, p.t1,
         l.server_end, l.winner_end, l.splits::numeric[], l.join_next,
         l.updated_at
    from public.admin_point_labels l
    join public.points p on p.id = l.point_id
   where p_match_id is null or l.match_id = p_match_id
   order by l.match_id, p.t0, p.idx;
end;
$$;

revoke execute on function public.admin_point_label_set(uuid, jsonb)
  from public, anon;
revoke execute on function public.admin_point_labels(uuid) from public, anon;
grant execute on function public.admin_point_label_set(uuid, jsonb)
  to authenticated;
grant execute on function public.admin_point_labels(uuid) to authenticated;

comment on table public.admin_point_labels is
  'Admin corrections on one card: which END served, which END won, where '
  'the card should have been split, and whether it runs on into the next. '
  'Training rows. Nothing in the product reads them back, and nothing '
  'here changes the player''s own points.';
