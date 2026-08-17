-- 120: what actually happens on a nearly-side-on camera, in Adil's words.
--
-- The first two matches cut by the v2 assembly in production (Koko and
-- Terry, Westchester, 2026-08-17) came from a camera almost behind the
-- near player — foreshortening 0.32 and 0.25 against a healthy 0.72+.
-- Zero serves were detected in either match, so nothing could cut a run
-- of play into separate points: no rally was lost, but consecutive
-- rallies fused into single cards and eight were split by hand in the
-- editor. (First read of the incident said "seven rallies lost"; wrong —
-- the editor records a split by trimming the original row and minting a
-- new one, so the trimmed rows no longer overlapped the split windows.)
-- Tripp, the match already known to be hard for every pipeline, is the
-- same camera problem at 0.28.
--
-- /research/sidecam shows those moments with every signal drawn on — the
-- table quad production used, the net line, the ball's track, bounce
-- markers — plus where the pipeline lost each one. His notes on what the
-- picture actually shows are the corpus this table holds.
--
-- A table and not a text file for the reason 118 records: the standalone
-- HTML version of this lost his notes twice.
--
-- Admin only, same as 118: a research corpus that mixes the owner's
-- judgement with anyone else's is worse than no corpus.

create table if not exists public.sidecam_review_notes (
  case_id text primary key,          -- "<lab key>@<window start seconds>"
  match_key text not null,           -- the lab's key: koko, terry, tripp_rc
  t0_s numeric not null,             -- the reviewed window, source seconds
  t1_s numeric not null,
  -- What the pipeline did with this window, decided before he looked, so
  -- his note is read against the claim rather than instead of it.
  category text,
  verdict text
    check (verdict is null
           or verdict in ('real_point', 'not_a_point', 'unsure')),
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists sidecam_review_notes_match_idx
  on public.sidecam_review_notes (match_key);

alter table public.sidecam_review_notes enable row level security;

create policy sidecam_review_notes_admin_all
  on public.sidecam_review_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.sidecam_review_notes to authenticated;
