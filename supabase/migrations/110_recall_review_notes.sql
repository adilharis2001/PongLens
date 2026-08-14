-- 110: human verdicts on point recall — did any real rally lose its card.
--
-- The question this table collects answers for is the one the existing
-- harness cannot ask. worker/eval/score_split.py scores against labels
-- exported from the points table, and those labels ARE the cards the
-- pipeline emitted, so a rally that never became a card has no label and
-- cannot be counted. Reproducing that harness on three matches returns
-- 100.00% recall by construction. The real number needs eyes on the
-- stretches where the two systems disagree, and on the stretches neither
-- of them claims.
--
-- The reviewed unit is a REGION of a match, not a point, because most of
-- what matters here has no point row: a window production vetoed, a card
-- only the lab proposes, a gap both are silent about. So the key is a
-- generated region id (match key + kind + index), and match_id is carried
-- beside it for grouping.
--
-- verdict answers "what is actually in this stretch of video":
--   rally_whole    a real rally, and the clip holds all of it — the good case
--   rally_clipped  a real rally, but it opens after the serve or ends before
--                  the point is decided. Still a failure: a point you cannot
--                  score is as lost as one with no card
--   rally_multi    more than one real rally in here; it should be split
--   junk           no rally: retrieval, warm-up, a knock-up, another table
--   unsure         genuinely cannot tell from the footage
--
-- causes name the fix, the way 109 does. Grouped by what actually went
-- wrong: could the ball be seen, did the pipeline look in the right place,
-- is the point an awkward shape, or are the boundaries simply off.
--
--   ball_hidden          a player, hand or bat is in front of the ball
--   ball_too_small       too far, too dark, too low contrast to see
--   motion_blur          the ball smears across frames
--   ball_lost            nothing reported while the ball is plainly visible
--   tracker_other_table  it followed a neighbouring court's ball
--   table_wrong          the table region sits on the wrong table
--   no_calibration       this match has no table quad at all
--   very_short_point     a serve error or a third-ball winner, over in a
--                        second — the shape the filters eat
--   serve_off_camera     the serve happens outside the frame
--   opens_late           the clip starts after the serve
--   ends_early           the clip stops before the point is decided
--   two_points_fused     two rallies share one card
--   other                see the note
--
-- Admin only, exactly like 089, 097 and 109: a research corpus mixing the
-- owner's judgement with anyone else's is worse than no corpus.
create table if not exists public.recall_review_notes (
  region_id text primary key,
  match_id uuid references public.matches(id) on delete cascade,
  verdict text
    check (verdict is null or verdict in
      ('rally_whole', 'rally_clipped', 'rally_multi', 'junk', 'unsure')),
  causes text[] not null default '{}',
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists recall_review_notes_match_idx
  on public.recall_review_notes (match_id);

alter table public.recall_review_notes enable row level security;

create policy recall_review_notes_admin_all
  on public.recall_review_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.recall_review_notes to authenticated;
