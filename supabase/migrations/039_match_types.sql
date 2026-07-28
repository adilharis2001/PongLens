-- 039: widen matches.match_type — 'drills' (training footage) and 'match'
-- (a casual match, not part of anything) join practice/league/tournament.
-- Drills and practice footage never nags for a score; the others do.

alter table public.matches drop constraint matches_match_type_check;
alter table public.matches add constraint matches_match_type_check
  check (match_type in ('drills', 'practice', 'match', 'league', 'tournament'));
