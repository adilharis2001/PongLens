-- 118: what a wrongly detected serve actually was, in Adil's own words.
--
-- 41% of what the serve detector calls a serve is not one, measured against
-- the 278 points he bounded by hand. That number is behind most of what is
-- left in the point pipeline: it split a point of his on the Gavin match, and
-- two separate fixes failed this week BECAUSE of it — cutting a fused card on
-- the serve inside it, and filtering serves by whether the ball was quiet
-- beforehand. Both are good ideas fed a bad signal.
--
-- What is missing is not another measurement. Splitting the 181 wrong calls by
-- what is happening at that moment gives:
--
--     in dead time, no point nearby      126   70%
--     inside a real point, mid-rally      46   25%
--     just outside a real point            9    5%
--
-- and nobody knows what produces a valid-looking bounce pair when no point is
-- being played. That needs eyes on the video, and the eyes belong to someone
-- who can tell a pre-serve bounce from a serve at a glance.
--
-- This is why it is a table and not a text file. The first attempt was a
-- standalone HTML page with note boxes saving to browser storage, and it lost
-- his notes twice: local files have no durable origin for localStorage, and
-- the viewer he reads them in does not run page scripts at all, so the save
-- silently did nothing while the box turned green. A note that looks saved and
-- is not is worse than no note box.
--
-- The reviewed unit is one CALL the detector made, keyed by match and the
-- moment of the call, because that is the thing being judged. Nothing about
-- the card it opened, or the point it did or did not belong to, is the
-- subject here.
--
-- Admin only, like 089, 097, 109 and 110: a research corpus that mixes the
-- owner's judgement with anyone else's is worse than no corpus.

create table if not exists public.serve_review_notes (
  case_id text primary key,          -- "<lab key>@<contact seconds>"
  match_key text not null,           -- the lab's key, e.g. prabhas_rc
  contact_s numeric not null,        -- where the detector said the serve was
  -- What the detector's call was, decided before he looked, so his note is
  -- read against the claim rather than instead of it.
  category text,
  -- The one question worth a fixed answer: was it a serve at all? Everything
  -- else is prose, because the failure modes are not yet known — finding out
  -- what they are is the entire point of the exercise.
  verdict text
    check (verdict is null or verdict in ('serve', 'not_serve', 'unsure')),
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists serve_review_notes_match_idx
  on public.serve_review_notes (match_key);

alter table public.serve_review_notes enable row level security;

create policy serve_review_notes_admin_all
  on public.serve_review_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.serve_review_notes to authenticated;
