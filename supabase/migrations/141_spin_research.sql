-- 141: serve spin research — the estimator's predictions and the owner's
-- labels, side by side.
--
-- The 2026-08-26 feasibility study (docs/research/2026-08-26-spin-estimation)
-- showed serve spin categories are readable at 30 fps from the bounce:
-- a topspin ball keeps or gains ground speed through its first bounce, a
-- backspin ball loses most of it. What the study could not settle is
-- accuracy on real serves at scale, because only 69 hand labels exist.
-- These two tables are how that ground truth gets built: the worker writes
-- what the estimator measured per serve, /research/spin plays each serve
-- and the owner answers, and the pair is the evaluation set.
--
-- spin_predictions is written ONLY by the worker and build scripts over
-- the direct Postgres connection, so it has no insert/update policy at
-- all. Every labelable point in a covered match gets a row, including the
-- ones the estimator refused: the refusals carry the reason, and the
-- yield (measured / total) is one of the two numbers that decide whether
-- the estimator graduates.
--
-- spin_review_notes is the human side. Same admin-only shape as 097/109/
-- 110/118: a research corpus mixing the owner's judgement with anyone
-- else's is worse than no corpus. It deliberately captures MORE than the
-- product columns on points: sidespin direction (left/right, where
-- points.serve_sidespin is a bare boolean by the 032 decision), an
-- explicit cant_tell everywhere, and a frozen snapshot of what the page
-- showed at label time — predicted_spin and algo are copied onto the row
-- when the label is saved, so accuracy stays computable after the
-- estimator re-versions. blind records whether the prediction was hidden
-- until the label was committed; only blind rows make unbiased accuracy
-- claims.

create table if not exists public.spin_predictions (
  point_id uuid primary key references public.points(id) on delete cascade,
  algo text not null,
  predicted_spin text not null
    check (predicted_spin in ('top', 'back', 'none', 'unmeasurable')),
  confidence numeric,
  ratio1 numeric,
  kick1_deg numeric,
  hop_t numeric,
  hop_speed numeric,
  pre_speed numeric,
  post_speed numeric,
  serve_cut_s numeric,
  quality jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.spin_predictions enable row level security;

create policy spin_predictions_admin_read
  on public.spin_predictions
  for select
  using (public.is_admin());

grant select on public.spin_predictions to authenticated;

create table if not exists public.spin_review_notes (
  point_id uuid primary key references public.points(id) on delete cascade,
  spin text
    check (spin is null or spin in ('top', 'back', 'none', 'cant_tell')),
  side text
    check (side is null or side in ('left', 'right', 'none', 'cant_tell')),
  strength text
    check (strength is null or strength in ('light', 'heavy', 'cant_tell')),
  note text,
  predicted_spin text,
  predicted_confidence numeric,
  algo text,
  blind boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.spin_review_notes enable row level security;

create policy spin_review_notes_admin_all
  on public.spin_review_notes
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.spin_review_notes to authenticated;
