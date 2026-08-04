-- 069: the players portal can open any match point by point, to judge how
-- well the dead-space cut carved the video.
--
--  * admin_match_points()    — every point of a match, both timelines and
--                              the flags that grade the cut: edited means a
--                              boundary had to be fixed by hand, tight
--                              start/end means the pads were squeezed
--                              against a neighbor, deleted rows stay (their
--                              footage is still in the cut file).
--  * admin_point_clip_path() — a point clip's R2 path so the admin media
--                              route can sign playback, same shape as
--                              admin_match_cut_path (068).
--
-- Both re-check is_admin() inside; page-level redirects are UX only.

create or replace function public.admin_match_points(p_match_id uuid)
returns table (
  id           uuid,
  idx          int,
  t0           numeric,
  t1           numeric,
  cut_t0       numeric,
  server       text,
  confirmed_winner text,
  is_let       boolean,
  warmup       boolean,
  deleted      boolean,
  edited       boolean,
  starred      boolean,
  tight_start  boolean,
  tight_end    boolean,
  misread_kind text,
  has_clip     boolean
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
  select
    p.id, p.idx, p.t0, p.t1, p.cut_t0, p.server, p.confirmed_winner,
    p.is_let, p.warmup, p.deleted, p.edited, p.starred,
    p.tight_start, p.tight_end, p.misread_kind,
    (p.clip_path is not null)
  from public.points p
  where p.match_id = p_match_id
  order by p.t0, p.idx;
end;
$$;

revoke execute on function public.admin_match_points(uuid) from public, anon;
grant execute on function public.admin_match_points(uuid) to authenticated;

create or replace function public.admin_point_clip_path(
  p_match_id uuid, p_point_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select p.clip_path into v_path
  from public.points p
  where p.id = p_point_id and p.match_id = p_match_id;
  return v_path;
end;
$$;

revoke execute on function public.admin_point_clip_path(uuid, uuid)
  from public, anon;
grant execute on function public.admin_point_clip_path(uuid, uuid)
  to authenticated;
