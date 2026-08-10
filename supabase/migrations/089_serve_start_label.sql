-- 089: the playhead at the moment the owner saw the serve begin.
--
-- The sibling of 067. That column captures where the human said a rally
-- ENDED, for free, on every scored point. This one captures where it
-- STARTED, and the start is the half we have never measured.
--
-- Why it matters (worker/eval/DEADSPACE-RESEARCH-2026-08-09.md): every
-- boundary in production comes from ball motion alone, and a slow serve
-- toss reads as stillness to the tracker. Measured against the 77 human
-- serve-contact labels, t0 lands a median 0.647s BEFORE the actual
-- contact and up to 12s before it, so the emitted point opens somewhere
-- in the dead ball-handling ahead of the serve. Nothing in the corpus
-- says where the serve really began at the venues failing today: the 77
-- labels come from five older matches, three of whose raws are already
-- deleted. A tap during Keep score mints that label at the venue being
-- played, on the cut the owner is actually watching.
--
-- Cut-video seconds, deliberately raw, exactly like scored_at_cut_s:
-- store what the player element reports and map to source time offline
-- via that match's cut_segments.
--
-- serve_start_meta records HOW the tap was made, because a tap made
-- during playback lands 200-400ms late (reaction time) while a tap made
-- while paused or scrubbing is deliberate and frame-accurate. Without
-- it the two are indistinguishable and the whole set has to be treated
-- as the looser of the two. Shape:
--   {"paused": bool, "rate": number, "src": "key" | "button"}
--
-- Admin only, enforced here rather than only in the UI: this is a
-- research label, and a mixed corpus of "the owner meant the serve" and
-- "some other user tapped something" is worse than no corpus. The
-- trigger lets service-role writes through (auth.uid() is null there)
-- so backfills and the worker are unaffected.
alter table public.points
  add column if not exists serve_start_at_cut_s numeric
    check (serve_start_at_cut_s is null or serve_start_at_cut_s >= 0);

alter table public.points
  add column if not exists serve_start_meta jsonb;

-- Column-level UPDATE grant, same migration that adds the column (the
-- points.direction lesson from 030).
grant update (serve_start_at_cut_s, serve_start_meta) on public.points
  to authenticated;

create or replace function public.points_serve_start_admin_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.serve_start_at_cut_s is distinct from old.serve_start_at_cut_s
      or new.serve_start_meta is distinct from old.serve_start_meta)
     and auth.uid() is not null
     and not public.is_admin()
  then
    raise exception 'serve start labels are admin only';
  end if;
  return new;
end;
$$;

drop trigger if exists points_serve_start_admin_only on public.points;
create trigger points_serve_start_admin_only
  before update of serve_start_at_cut_s, serve_start_meta on public.points
  for each row execute function public.points_serve_start_admin_only();
