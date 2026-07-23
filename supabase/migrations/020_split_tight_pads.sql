-- 020: split-aware clip padding.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- Splitting a point at `at_t` used to give BOTH children the full
-- clipPad(strictness) context at the shared boundary: child A's clip ran to
-- t1 + post and child B's started at t0 - pre, so the split moment appeared
-- twice with up to pre+post (~2.6s at normal) of doubled footage. The fix:
--
--  * points.tight_start / tight_end — this edge of the point is a split
--    boundary shared with a sibling. The reclip worker (and the reel
--    route's cut-timeline segment math) pads a tight edge with
--    min(pad, 0.3)s instead of the full strictness pad. OUTER edges keep
--    normal pads.
--  * split_point() — parent comes out tight_end=true; the child inherits
--    tight_start=true plus the parent's old tight_end (its t1 IS the
--    parent's old t1, which may itself have been a split boundary).
--  * Cleared client-side when the owner manually re-times that edge
--    (Save timing without a split keeps full pads), hence the update grant.

alter table public.points
  add column if not exists tight_start boolean not null default false,
  add column if not exists tight_end   boolean not null default false;

grant update (tight_start, tight_end) on public.points to authenticated;

create or replace function public.split_point(p_id uuid, at_t numeric)
returns public.points
language plpgsql
security definer
set search_path = public
as $$
declare
  orig public.points;
  new_row public.points;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select p.* into orig
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_id
     and m.user_id = auth.uid()
     for update of p;
  if orig.id is null then
    raise exception 'point not found';
  end if;
  if orig.deleted then
    raise exception 'point is deleted';
  end if;
  if orig.t0 is null or orig.t1 is null
     or at_t < orig.t0 + 0.2 or at_t > orig.t1 - 0.2 then
    raise exception 'split time outside the point window';
  end if;
  update public.points
     set t1 = at_t, edited = true, tight_end = true
   where id = orig.id;
  insert into public.points
    (match_id, idx, t0, t1, server, edited, tight_start, tight_end)
  values (
    orig.match_id,
    (select max(idx) + 1 from public.points where match_id = orig.match_id),
    at_t,
    orig.t1,
    orig.server,
    true,
    true,
    orig.tight_end
  )
  returning * into new_row;
  return new_row;
end;
$$;

revoke execute on function public.split_point(uuid, numeric) from public, anon;
grant execute on function public.split_point(uuid, numeric) to authenticated;
