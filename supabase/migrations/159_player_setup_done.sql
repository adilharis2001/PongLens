-- 159: tell "never asked the playing questions" from "skipped them".
--
-- The coach path of onboarding writes an empty player_profiles row so the
-- gate stops asking, and a player who taps Skip writes the same empty row.
-- Until now the two were indistinguishable, so a coach who later switched
-- to playing was never offered handedness, grip and level. setup_done_at
-- is stamped when the questions were answered or explicitly skipped; the
-- coach path leaves it empty, and Home offers the setup once.
--
-- Backfill: every existing row counts as done, except the coach-only
-- shape — all-null fields, an accepted link as a coach, no matches of
-- their own — which stays empty so those coaches get the offer.

alter table public.player_profiles
  add column if not exists setup_done_at timestamptz;

grant update (setup_done_at) on public.player_profiles to authenticated;

update public.player_profiles p
   set setup_done_at = coalesce(p.updated_at, now())
 where p.setup_done_at is null
   and not (
     p.handedness is null and p.grip is null and p.level is null
     and exists (
       select 1 from public.coach_links cl
       where cl.coach_id = p.user_id and cl.status = 'accepted'
     )
     and not exists (
       select 1 from public.matches m where m.user_id = p.user_id
     )
   );
