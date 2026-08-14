-- 109: human verdicts on the serve detector, and why it went wrong.
--
-- The detector (docs/research/2026-08-13-serve-detection-rerun.md) finds
-- the serve on 36% of points and is accurate on those. The numbers say
-- nothing about the other 64%, and the per-match diagnostics only narrow
-- it to a stage: the ball was not found, or it was found off the table, or
-- both looked fine and no serve motif appeared anyway. Which of those is
-- true on a given point takes eyes on the footage.
--
-- verdict answers "was the mark right":
--   right      — the clip would open just before the serve
--   too_early  — it marked something before the serve; footage kept for
--                nothing, but nothing is lost
--   too_late   — it marked into the rally; this is the only harmful one
--   no_serve   — there is no serve in this point at all (junk fragment,
--                mid-rally piece, warm-up)
--   missed     — there IS a serve and the detector said nothing
--
-- causes is a free multi-select, because a bad point usually has more than
-- one thing wrong with it, and each value names a different fix:
--
--   ball_hidden_body        a player is standing in front of the ball
--   ball_hidden_hand        the serve is hidden behind hand or bat
--   ball_out_of_frame       the ball leaves the picture
--   ball_too_small          too far, too dark, too blurry to see
--   motion_blur             the ball smears across frames
--   tracker_other_table     the tracker followed a neighbouring court
--   tracker_stationary      it locked onto a ball at rest, or a hand
--   tracker_lost            it simply reported nothing while the ball was
--                           plainly visible
--   table_wrong             the table outline sits on the wrong table
--   table_skewed            right table, corners visibly off
--   net_wrong               the drawn net does not sit on the real net
--   camera_low              the camera is too low to separate the halves
--   serve_off_camera        the serve happens outside the frame
--   no_serve_in_point       the point contains no serve
--   toss_too_small          the toss is too low to read
--   other                   see the note
--
-- Admin only, exactly like 089 and 097: a research corpus mixing the
-- owner's judgement with anyone else's is worse than no corpus.
create table if not exists public.serve_detector_notes (
  point_id uuid primary key references public.points(id) on delete cascade,
  verdict text
    check (verdict is null or verdict in
      ('right', 'too_early', 'too_late', 'no_serve', 'missed')),
  causes text[] not null default '{}',
  note text,
  updated_at timestamptz not null default now()
);

alter table public.serve_detector_notes enable row level security;

create policy serve_detector_notes_admin_all
  on public.serve_detector_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.serve_detector_notes to authenticated;
