-- 006: matches.match_type — set from the upload form (jobs.options.meta),
-- copied onto the matches row by the worker alongside opponent_name.

alter table public.matches
  add column if not exists match_type text
  check (match_type in ('practice', 'league', 'tournament'));

-- Column-restricted client grants (003/005 pattern): owners may edit
-- match_type from the match page just like opponent_name.
grant update (match_type) on public.matches to authenticated;
