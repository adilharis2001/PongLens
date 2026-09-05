-- 172: Adil's own calls on the V3 card assembler's cards.
--
-- The V3 serve detector is a rebuilt card assembler, reviewed at
-- /research/v3-serve-detector. Its accuracy is measured two ways and they
-- answer different questions:
--
--   * against the scorekeeper -- does every point Adil kept get exactly one
--     card, and is there a card anywhere he did not want one. That needs no
--     labelling at all, because his scoring already says it;
--   * against his eye -- is a given card actually a serve. Nothing in the
--     database can answer that, so it is recorded here.
--
-- KEYED BY THE SERVE'S TIME, NOT BY A CARD NUMBER. Card numbers shift the
-- moment a rule removes a card: the lab kept these verdicts in a file keyed
-- by index once, and a single deleted card silently re-pointed ten of them
-- at the wrong cards. The serve time is stable across rule changes, which is
-- the whole point of holding verdicts while the rules are still moving.
--
-- Rounded to a tenth of a second on the way in, so a card that moves by a
-- frame or two keeps its verdict.
--
-- Admin only, like 109 and 097: a research corpus that mixes the owner's
-- judgement with anyone else's is worse than no corpus.
create table if not exists public.v3_card_verdicts (
  match_id uuid not null references public.matches(id) on delete cascade,
  serve_s numeric(8, 1) not null,
  verdict text not null
    check (verdict in ('genuine', 'false', 'unsure')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (match_id, serve_s)
);

alter table public.v3_card_verdicts enable row level security;

drop policy if exists v3_card_verdicts_admin_all on public.v3_card_verdicts;

create policy v3_card_verdicts_admin_all
  on public.v3_card_verdicts
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.v3_card_verdicts to authenticated;
