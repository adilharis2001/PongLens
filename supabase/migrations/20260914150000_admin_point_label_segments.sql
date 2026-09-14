-- Admin point labels: one answer per POINT, not per card.
--
-- The first cut of this table asked one question of each card: which end
-- served, which end won. A card that holds two rallies is two points, and
-- a card marked "joins the next" is half of one — so a single answer per
-- card could not describe the very cards the labels exist to teach about.
--
-- The splits already say where the points inside a card begin and end, so
-- the answers become arrays indexed by SEGMENT: splits + 1 of them, with
-- null where nothing has been filed. `server_ends[i]` and `winner_ends[i]`
-- belong to the i-th segment of the card.
--
-- Joins are read across cards rather than stored twice. A point that runs
-- from one card into the next starts in the first card's last segment and
-- ends in the next card's first, so its SERVE is filed where it starts and
-- its WINNER where it ends. Nothing has to be copied between rows, and the
-- reader can rebuild the real sequence of points from the cards in order.
--
-- Element values are checked by admin_point_label_set, which is the only
-- writer this table has: RLS is on with no policies, so every path in is a
-- SECURITY DEFINER function. A CHECK constraint over an array whose
-- elements may be null cannot say what is meant here without lying about
-- the null case, so the gate stays in the function.

alter table public.admin_point_labels
  add column if not exists server_ends text[] not null default '{}',
  add column if not exists winner_ends text[] not null default '{}';

-- What was filed against the card becomes the first segment's answer. An
-- unsplit card has exactly one segment, so nothing moves for most rows.
update public.admin_point_labels
   set server_ends = case when server_end is null then '{}'::text[]
                          else array[server_end] end,
       winner_ends = case when winner_end is null then '{}'::text[]
                          else array[winner_end] end
 where server_end is not null or winner_end is not null;

alter table public.admin_point_labels
  drop column if exists server_end,
  drop column if exists winner_end;

create or replace function public.admin_point_label_set(
  p_point_id uuid,
  p_patch jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id   uuid;
  v_server     text[];
  v_winner     text[];
  v_splits     numeric(9,2)[];
  v_join       boolean;
  v_element    text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select match_id into v_match_id from public.points where id = p_point_id;
  if v_match_id is null then
    raise exception 'point not found';
  end if;

  -- Seed from the row as it stands: a patch names only what it changes, so
  -- a second tap on one question cannot clear the answer to another.
  select server_ends, winner_ends, splits, join_next
    into v_server, v_winner, v_splits, v_join
    from public.admin_point_labels where point_id = p_point_id;
  v_server := coalesce(v_server, '{}');
  v_winner := coalesce(v_winner, '{}');
  v_splits := coalesce(v_splits, '{}');
  v_join   := coalesce(v_join, false);

  if p_patch ? 'server_ends' then
    if jsonb_typeof(p_patch -> 'server_ends') = 'null' then
      v_server := '{}';
    else
      select coalesce(array_agg(
               case when value = 'null' then null else value #>> '{}' end
               order by ord), '{}')
        into v_server
        from jsonb_array_elements(p_patch -> 'server_ends')
             with ordinality as t(value, ord);
    end if;
  end if;

  if p_patch ? 'winner_ends' then
    if jsonb_typeof(p_patch -> 'winner_ends') = 'null' then
      v_winner := '{}';
    else
      select coalesce(array_agg(
               case when value = 'null' then null else value #>> '{}' end
               order by ord), '{}')
        into v_winner
        from jsonb_array_elements(p_patch -> 'winner_ends')
             with ordinality as t(value, ord);
    end if;
  end if;

  foreach v_element in array (v_server || v_winner) loop
    if v_element is not null and v_element not in ('near', 'far') then
      raise exception 'an end is near or far, not %', v_element;
    end if;
  end loop;

  -- Thirteen answers is twelve splits and the segment after the last one,
  -- which is the same ceiling the splits themselves carry.
  if coalesce(array_length(v_server, 1), 0) > 13
     or coalesce(array_length(v_winner, 1), 0) > 13 then
    raise exception 'too many segments for one card';
  end if;

  if p_patch ? 'splits' then
    if jsonb_typeof(p_patch -> 'splits') = 'null' then
      v_splits := '{}';
    else
      select coalesce(
               array_agg(distinct round(s::numeric, 2) order by round(s::numeric, 2)),
               '{}')
        into v_splits
        from jsonb_array_elements_text(p_patch -> 'splits') as s;
    end if;
    if coalesce(array_length(v_splits, 1), 0) > 12 then
      raise exception 'too many splits for one card';
    end if;
  end if;

  if p_patch ? 'join_next' then
    v_join := coalesce((p_patch ->> 'join_next')::boolean, false);
  end if;

  -- An empty label is no label: the row exists exactly while something has
  -- been said about the card, so "has this been looked at" stays a question
  -- about the row existing rather than about its contents.
  if coalesce(array_length(array_remove(v_server, null), 1), 0) = 0
     and coalesce(array_length(array_remove(v_winner, null), 1), 0) = 0
     and coalesce(array_length(v_splits, 1), 0) = 0
     and not v_join then
    delete from public.admin_point_labels where point_id = p_point_id;
    return;
  end if;

  insert into public.admin_point_labels as l
    (point_id, match_id, server_ends, winner_ends, splits, join_next)
  values
    (p_point_id, v_match_id, v_server, v_winner, v_splits, v_join)
  on conflict (point_id) do update
    set server_ends = excluded.server_ends,
        winner_ends = excluded.winner_ends,
        splits      = excluded.splits,
        join_next   = excluded.join_next,
        updated_at  = now();
end;
$$;

revoke execute on function public.admin_point_label_set(uuid, jsonb) from public, anon;
grant execute on function public.admin_point_label_set(uuid, jsonb) to authenticated;

create or replace function public.admin_point_labels(
  p_match_id uuid default null
) returns table (
  point_id    uuid,
  match_id    uuid,
  idx         integer,
  t0          numeric,
  t1          numeric,
  server_ends text[],
  winner_ends text[],
  splits      numeric(9,2)[],
  join_next   boolean,
  updated_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select l.point_id, l.match_id, p.idx, p.t0, p.t1,
           l.server_ends, l.winner_ends, l.splits, l.join_next, l.updated_at
      from public.admin_point_labels l
      join public.points p on p.id = l.point_id
     where p_match_id is null or l.match_id = p_match_id
     order by p.t0 nulls last, p.idx;
end;
$$;

revoke execute on function public.admin_point_labels(uuid) from public, anon;
grant execute on function public.admin_point_labels(uuid) to authenticated;
