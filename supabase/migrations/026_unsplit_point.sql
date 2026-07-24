-- 026: unsplit_point() — the atomic inverse of split_point(), so a
-- Keep-score "Split while you watch" can be undone byte-identically.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- split_point() shortens the parent (t1 := at_t, tight_end := true,
-- edited := true) and inserts a child [at_t, orig_t1]. The client can't
-- reverse that on its own: authenticated has no DELETE grant on points
-- (migration 003 revoked it), so a child row can never be hard-removed
-- from the client, and a soft delete would leave a residue — not the
-- byte-identical restore the pad's Undo promises.
--
-- This SECURITY DEFINER function does both halves atomically: restore the
-- parent's pre-split t1/tight_end (passed in — the client held them in its
-- undo entry) and hard-delete the child. Both rows must belong to a match
-- owned by the caller. The child must be childless itself (never unsplit a
-- point that was since split again) to keep the inverse exact.
--
-- NOTE: growing the parent's t1 back re-fires points_mark_edited (migration
-- 007), which forces edited=true no matter what parent_edited says — which
-- is correct: the parent's clip is now stale (it was recut short, or would
-- be) and must be regenerated to the restored full extent. parent_edited is
-- kept in the signature for symmetry with the undo entry but is advisory.

create or replace function public.unsplit_point(
  p_parent uuid,
  p_child uuid,
  parent_t1 numeric,
  parent_tight_end boolean,
  parent_edited boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  par public.points;
  chi public.points;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Lock both rows and confirm the caller owns their match.
  select p.* into par
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_parent
     and m.user_id = auth.uid()
     for update of p;
  if par.id is null then
    raise exception 'parent point not found';
  end if;
  select p.* into chi
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_child
     and m.user_id = auth.uid()
     for update of p;
  if chi.id is null then
    raise exception 'child point not found';
  end if;
  if chi.match_id <> par.match_id then
    raise exception 'points belong to different matches';
  end if;
  -- Refuse if the child was itself split since (it now has descendants):
  -- unsplitting would orphan them. The caller should undo those first.
  if exists (
    select 1 from public.points p
     where p.match_id = chi.match_id
       and p.id <> chi.id
       and p.t0 = chi.t1
  ) then
    raise exception 'child has been split further; undo that first';
  end if;

  update public.points
     set t1 = parent_t1,
         tight_end = parent_tight_end,
         edited = parent_edited
   where id = par.id;

  delete from public.points where id = chi.id;
end;
$$;

revoke execute on function
  public.unsplit_point(uuid, uuid, numeric, boolean, boolean)
  from public, anon;
grant execute on function
  public.unsplit_point(uuid, uuid, numeric, boolean, boolean)
  to authenticated;
