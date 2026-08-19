-- 125: the journal manages every note in one place, which includes notes
-- other people left on your matches. The match owner can now delete any
-- note on a match they own; authors keep their own delete (003), and a
-- coach still cannot remove a player's note from a student's match.
-- Permissive policies OR together, so this only widens delete.

create policy "Match owners can delete notes on their matches"
  on public.notes for delete
  to authenticated
  using (exists (
    select 1 from public.matches m
    where m.id = notes.match_id
      and m.user_id = (select auth.uid())
  ));
