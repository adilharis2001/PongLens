-- 025: matches.venue — the club / location a match was played at, optional.
-- Collected at upload (remembered-venue chips + free text) and folded into
-- the DERIVED match title ("Vaibhav · Westchester TTC · Jul 23, 2026"). A
-- PERSON's name stays in opponent_name; venue is the place; played_at the
-- capture date. The title itself is never stored — it is composed for
-- display from these atomic facts (src/lib/matchTitle.ts).

alter table public.matches add column if not exists venue text;

comment on column public.matches.venue is
  'Club or location the match was played at (optional). Set from the upload '
  'form (jobs.options.meta.venue), editable by the owner, and folded into the '
  'derived match title alongside opponent_name and played_at.';

-- Column-restricted client grant (003/005/006 pattern): owners may edit
-- venue from the upload/match surfaces just like opponent_name / match_type.
grant update (venue) on public.matches to authenticated;
