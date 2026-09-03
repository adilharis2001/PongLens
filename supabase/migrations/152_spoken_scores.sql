-- Game scores the player called out at the phone while recording (iOS,
-- "Call out the score"). What the player SAID, kept apart from the scores
-- the pipeline derives from points: a different kind of fact, and one
-- must never overwrite the other.
--
-- Shape: [{"game": 1, "you": 11, "them": 5}, ...] with "you" being the
-- uploader's own score, the same convention as the scorekeeper. Only
-- fully-heard games are stored; a game the phone heard but could not
-- score is shown as ?? on the phone and not written here.
--
-- The matches table uses column-scoped grants, so the new column needs
-- its own SELECT and UPDATE for authenticated or client writes 403 --
-- and with PostgREST they fail silently. The row-level owner policies
-- already scope who can touch which rows.
alter table public.matches add column if not exists spoken_scores jsonb;

grant select (spoken_scores) on public.matches to authenticated;
grant update (spoken_scores) on public.matches to authenticated;
