-- 146: hiding a detected side-change marker.
--
-- The game-end indicator (140) draws a marker between two rallies where
-- the video shows the players swapping ends. It is INFORMATIONAL: it is
-- never folded into the boundary walk and never changes a score on its
-- own. Two answers are offered and only one of them needs storing here —
-- "Game ended here" writes the existing points.game_end_override = 'end',
-- which every surface already reads, and "They just changed ends" writes
-- this column.
--
-- Deliberately NOT 'continue'. A 'continue' pin suppresses the automatic
-- 11-clear-by-2 rule from that point onward, which is a real change to
-- the score; hiding a marker the detector was wrong about must cost the
-- owner nothing.
alter table points
  add column side_change_dismissed boolean not null default false;

comment on column points.side_change_dismissed is
  'Owner hid the detected side-change marker that sits after this point (146). Display only - never read by the boundary walk and never affects the score.';

-- The authenticated role's UPDATE grant on points is column-scoped, so a
-- new column needs its own grant or every owner write to it is a 403 —
-- silently rolled back by the optimistic writer, with no error anywhere.
-- That is how 099 found this the hard way.
grant update (side_change_dismissed) on points to authenticated;
