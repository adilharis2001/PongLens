-- 067: the playhead at the moment the owner scored the point.
--
-- In Keep score the video is sitting at (or just past) the rally's end
-- when the winner is tapped — a human saying "this point was decided by
-- here", hundreds of times per match, for free. That is exactly the label
-- a learned rally-end detector trains on (dead-space rounds 5+), and
-- until now it evaporated on every tap.
--
-- Cut-video seconds, deliberately raw: the client stores what the player
-- element reports and nothing else. Mapping to source time happens
-- offline via the match.json cut_segments / spans for that match — the
-- cut the owner was actually watching.
--
-- Only Keep score's flowing session writes it (the tap that answers the
-- rally on screen). Chip-strip corrections, review mode and the point
-- detail form don't: their playhead says nothing about when the point
-- ended. Cleared when the score is cleared.
alter table public.points
  add column if not exists scored_at_cut_s numeric
    check (scored_at_cut_s is null or scored_at_cut_s >= 0);

-- Column-level UPDATE grant, same migration that adds the column (the
-- points.direction lesson from 030).
grant update (scored_at_cut_s) on public.points to authenticated;
