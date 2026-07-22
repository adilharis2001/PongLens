-- 007: score tracking + clip correction (SPEC.md §3 follow-up).
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * points.deleted — owner soft-delete ("Not a point"); hidden client-side,
--    display indices renumbered in the UI, undoable.
--  * points.edited  — the point's t0/t1 changed (or it was born from a
--    split) and its clip is stale. Set by trigger on client timing edits;
--    cleared by the reclip worker once the clip is regenerated.
--  * split_point()  — SECURITY DEFINER split: shortens the original point at
--    a timestamp and inserts the remainder as a new row (clients have no
--    INSERT grant on points, so splits go through this function).
--  * jobs kind 'reclip' — clients may enqueue { kind: 'reclip',
--    options: { match_id } } jobs. jobs.kind has no check constraint; the
--    worker re-cuts ONLY edited & not-deleted points from the raw source and
--    verifies the job's user owns the match (options is client-writable).

alter table public.points
  add column if not exists deleted boolean not null default false,
  add column if not exists edited  boolean not null default false;

-- Column-restricted client grants (003/005 pattern; grants are additive).
-- The owner-only update policy from 003 still applies.
grant update (t0, t1, deleted) on public.points to authenticated;

-- Any change to a point's timing marks its clip stale. The worker's
-- clip_path/edited updates don't touch t0/t1, so they never re-trip this.
create or replace function public.mark_point_edited()
returns trigger
language plpgsql
as $$
begin
  new.edited = true;
  return new;
end;
$$;

drop trigger if exists points_mark_edited on public.points;
create trigger points_mark_edited
  before update of t0, t1 on public.points
  for each row
  when (old.t0 is distinct from new.t0 or old.t1 is distinct from new.t1)
  execute function public.mark_point_edited();

-- ---------------------------------------------------------------------------
-- split_point(point, at_t) — split a point at a source-video timestamp.
-- The original keeps [t0, at_t); the new row gets [at_t, old t1] and a fresh
-- idx (max+1 in the match — the UI orders and numbers by t0, so idx only
-- needs uniqueness). Both halves come out edited=true so the next reclip
-- regenerates their clips. Owner-only.
-- ---------------------------------------------------------------------------
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
  update public.points set t1 = at_t, edited = true where id = orig.id;
  insert into public.points (match_id, idx, t0, t1, server, edited)
  values (
    orig.match_id,
    (select max(idx) + 1 from public.points where match_id = orig.match_id),
    at_t,
    orig.t1,
    orig.server,
    true
  )
  returning * into new_row;
  return new_row;
end;
$$;

revoke execute on function public.split_point(uuid, numeric) from public, anon;
grant execute on function public.split_point(uuid, numeric) to authenticated;
