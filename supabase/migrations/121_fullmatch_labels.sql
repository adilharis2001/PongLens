-- 121: hand-marked point boundaries on the full-match research page.
--
-- The side-on matches are too badly cut to score in the app — "the
-- production render is so bad that it'll take too much time for me to
-- manually join and split" — so /research/fullmatch grows marking
-- controls: serve start, point end, winner, tapped on the continuous
-- video with every signal visible. These labels are the training data
-- for the boundary detector that side-on footage needs; every row is a
-- boundary on exactly the geometry being solved.
--
-- One row per marked event, in the processed video's own clock (the same
-- clock every lab signal uses). Kept separate from the app's
-- serve_start_at_cut_s taps deliberately: those live on points rows in
-- the CUT clock and mean "this card's boundary"; these are free-standing
-- marks on the uncut timeline of a research copy.
--
-- Admin only, same reasoning as 118/120.

create table if not exists public.fullmatch_labels (
  id uuid primary key default gen_random_uuid(),
  match_key text not null,           -- the lab's key: koko, terry
  kind text not null
    check (kind in ('serve', 'end')),
  t_s numeric not null,              -- processed-video seconds
  winner text
    check (winner is null or winner in ('me', 'opponent')),
  created_at timestamptz not null default now()
);

create index if not exists fullmatch_labels_match_idx
  on public.fullmatch_labels (match_key, t_s);

alter table public.fullmatch_labels enable row level security;

create policy fullmatch_labels_admin_all
  on public.fullmatch_labels
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.fullmatch_labels to authenticated;
