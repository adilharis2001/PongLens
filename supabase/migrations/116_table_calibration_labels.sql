-- Identify the match without reading the matches table.
--
-- 115 left the page to embed matches for the opponent, venue and filename.
-- That was wrong twice over, and the page 500'd on the first load in
-- production.
--
-- First, table_calibration_review has TWO foreign keys to matches --
-- match_id and duplicate_of -- so `matches!inner(...)` is ambiguous and
-- PostgREST refuses to resolve it rather than guessing.
--
-- Second, and worse, it would have been quietly wrong even once
-- disambiguated. `matches` grants select to the owner, to accepted coaches
-- and to coaches holding a live review order, and to nobody else. There is
-- no admin policy on it. An inner join therefore drops every match the
-- reviewer does not own -- around a quarter of the corpus, belonging to
-- other players -- and an inner join drops them silently. The page would
-- have looked fine and measured three quarters of the evidence.
--
-- So the labels are copied here at build time. They are captions on a
-- research row, not a live view of the match, and a snapshot is the more
-- honest thing anyway: the corpus should keep saying what it said when the
-- proposals were made, even if someone renames an opponent later.

alter table public.table_calibration_review
  add column if not exists opponent_name text,
  add column if not exists venue text,
  add column if not exists placement_status text,
  add column if not exists original_name text;

update public.table_calibration_review r
set opponent_name = m.opponent_name,
    venue = m.venue,
    placement_status = m.placement_status,
    original_name = m.original_name
from public.matches m
where m.id = r.match_id;
