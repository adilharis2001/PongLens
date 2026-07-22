-- 008: warmup detection (pre-match casual play).
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * points.warmup — set by the worker when a play looks like warmup:
--    it happens before the first play whose serve shows the double-bounce
--    signature (bounce on the server's half then the receiver's half in the
--    first exchange), or it never crosses the net and bounces on one side
--    only (casual table bouncing). Warmup points are kept, never deleted;
--    the UI collapses them under a "Warmup (n)" header and the owner can
--    flip any of them back with "This is a point" (warmup = false).

alter table public.points
  add column if not exists warmup boolean not null default false;

-- Column-restricted client grant (003/005/007 pattern; grants are additive).
-- The owner-only update policy from 003 still applies.
grant update (warmup) on public.points to authenticated;
