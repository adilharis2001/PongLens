-- Adil's calls on the ROWS of the research card pages (Body detector, V3
-- serve detector, End-on): is a flagged row the assembler's mistake, or the
-- reference's?
--
-- The pages judge an assembler's cards against two references: Adil's own
-- scoring (the production cards he kept or deleted, his winner taps) and,
-- on matches he never scored, production's cards. Both are wrong some of the
-- time -- the taps 10-20%, more on split points -- so a row flagged "no
-- card" or "misses your press" can be the reference's fault. A row call says
-- which. Every number on the page, and in the lab that reads this table,
-- is then shown again with the excused rows set aside.
--
--   fine    my card on this row is fine as it is; the flag is the
--           reference's fault or does not matter
--   wrong   my card is genuinely wrong here
--   unsure
--
-- KEYED BY THE ROW'S REFERENCE TIME, NOT A CARD NUMBER: production's card
-- start where the row has one, otherwise my card's start, to a tenth of a
-- second. The reference does not move when the assembler's rules change,
-- which is the whole point of holding calls while the rules still move
-- (same reasoning as 20260905194500_v3_card_verdicts).
--
-- Admin only, like 109, 097 and the V3 card verdicts.
create table if not exists public.research_row_verdicts (
  page text not null
    check (page in ('body-detector', 'v3-serve-detector', 'endon-detector')),
  match_id uuid not null references public.matches(id) on delete cascade,
  row_s numeric(8, 1) not null,
  verdict text not null
    check (verdict in ('fine', 'wrong', 'unsure')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (page, match_id, row_s)
);

alter table public.research_row_verdicts enable row level security;

drop policy if exists research_row_verdicts_admin_all on public.research_row_verdicts;

create policy research_row_verdicts_admin_all
  on public.research_row_verdicts
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.research_row_verdicts to authenticated;
