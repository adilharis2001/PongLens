-- Frames the owner has never seen, for the only test that counts.
--
-- The keypoint detector reaches 0.27% median error with no gross failures on
-- the 62 frames it was developed against. That number is not yet evidence:
-- the rule it uses to choose between tables was picked while its author
-- could see how it scored. This table holds a fresh sample -- real single
-- frames at varied timestamps, players in shot, across every production
-- match including other users' uploads -- so the claim can be tested on
-- footage nobody tuned against.
--
-- Separate from table_calibration_review because that one is keyed by match
-- and holds one frame each. Here a match contributes several frames.

create table if not exists public.table_calibration_holdout (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  frame_index integer not null,
  frame_time_s double precision,
  frame_key text not null,
  frame_width integer not null check (frame_width > 0),
  frame_height integer not null check (frame_height > 0),
  source_width integer not null check (source_width > 0),
  source_height integer not null check (source_height > 0),
  venue text,
  opponent_name text,
  -- Only the keypoint detector runs here. Luna and Sol are not called: they
  -- cost money per frame and the question is whether the free local model
  -- stands on its own.
  detector text not null default 'segformer-b0-homography',
  quad jsonb,
  detail jsonb not null default '{}'::jsonb,
  verdict text check (verdict in ('correct', 'loose', 'wrong_table',
                                  'no_table', 'unusable')),
  notes text check (notes is null or length(notes) <= 2000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (match_id, frame_index)
);

create index if not exists table_calibration_holdout_verdict_idx
  on public.table_calibration_holdout (verdict);

alter table public.table_calibration_holdout enable row level security;

create policy table_calibration_holdout_read
  on public.table_calibration_holdout for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.research_reviewers r
               where r.user_id = auth.uid() and r.active)
  );

create policy table_calibration_holdout_write
  on public.table_calibration_holdout for update to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.research_reviewers r
               where r.user_id = auth.uid() and r.active)
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.research_reviewers r
               where r.user_id = auth.uid() and r.active)
  );
