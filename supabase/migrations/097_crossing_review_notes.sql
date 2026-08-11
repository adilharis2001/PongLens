-- 097: human verdicts on the crossing rule's mistakes.
--
-- The crossing-review page (/research/crossing-review) shows the two ways
-- the zero-crossing junk rule got the 2026-08-11 validation corpus wrong:
-- deleted points whose track still crossed the net, and kept points whose
-- track never did. The numbers alone cannot say WHY — that takes eyes on
-- the footage. This table stores one verdict per reviewed point:
--
--   flagged_kept (kept point, no crossing in the track):
--     measurement_miss  — real point, the ball visibly crosses; the
--                         tracker or the table quad missed it
--     label_wrong_junk  — scoring mistake, the point is actually junk
--     no_cross_real     — real point where the ball genuinely never
--                         crossed (netted serve, fault). The rule can
--                         never be safe on these; their share bounds it.
--   missed_junk (deleted point, track shows a crossing):
--     handover          — ball tossed or rolled to the other player
--     label_wrong_real  — scoring mistake, it was a real point
--     ghost             — the crossing is a tracker artifact (other
--                         table, spurious detection)
--
-- Admin only, like the serve-start labels (089) and for the same reason:
-- this is a research corpus, and a verdict from anyone but the owner who
-- scored the matches is noise dressed as signal.
create table if not exists public.crossing_review_notes (
  point_id uuid primary key references public.points(id) on delete cascade,
  cls text not null
    check (cls in ('missed_junk', 'flagged_kept')),
  verdict text
    check (verdict is null or verdict in
      ('measurement_miss', 'label_wrong_junk', 'no_cross_real',
       'handover', 'label_wrong_real', 'ghost')),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.crossing_review_notes enable row level security;

create policy crossing_review_notes_admin_all
  on public.crossing_review_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.crossing_review_notes to authenticated;
