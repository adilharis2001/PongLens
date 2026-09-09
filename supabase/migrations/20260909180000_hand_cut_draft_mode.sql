-- Which pass a hand cut is: cutting only, or cutting and scoring.
--
-- The choice was asked once and then held in the browser, so reopening a
-- draft had to guess — and it guessed "scoring", which put a player who
-- had deliberately chosen "Cut only" into a scoring pass over the points
-- they had just cut, and asked them who served first for a rotation they
-- had said they did not want. A decision the player made belongs in the
-- row beside the marks it applies to.
--
-- Null means a draft written before this column existed; the client
-- infers those from whether anything was ever called.

alter table public.hand_cut_drafts
  add column if not exists mode text
  check (mode in ('cut', 'score'));

comment on column public.hand_cut_drafts.mode is
  'The pass the owner chose: cut only, or cut and score. Null on drafts '
  'saved before the column existed. Not read by the worker — the marks '
  'carry the winners, and a cut-only pass simply has none.';

-- Same shape as the marks grant: the owner writes their own draft, and
-- submitted_at stays out of reach so only claim_hand_cut freezes a row.
grant update (marks, updated_at, mode) on public.hand_cut_drafts to authenticated;
