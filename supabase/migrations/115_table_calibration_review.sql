-- Ground truth for where the table actually is.
--
-- Table calibration has never been measured against anything trustworthy.
-- The deterministic pink-rim calibrator was treated as a reference until
-- 2026-08-16, when two of the three matches sampled for it turned out to
-- carry quads spanning half the room — one stretched across the PINGPOD wall
-- banners, one across to a neighbouring table's base. Both were
-- placement_status = 'ready' with 99 and 135 mapped points on them. So the
-- reference was wrong and the thing being measured looked wrong by
-- comparison, which is the worst possible arrangement.
--
-- This table is the owner's own answer: the four corners, in source pixels,
-- for a real frame of every production match. Everything else -- Luna's
-- proposals, Sol's, whatever the pipeline stored at the time -- lands in
-- `proposals` beside it so a disagreement can be read off directly rather
-- than argued about.

create table if not exists public.table_calibration_review (
  match_id uuid primary key
    references public.matches(id) on delete cascade,

  -- The exact frame the proposals were made against, so a corrected corner
  -- means something. Median background at the pipeline's own working size.
  frame_key text not null,
  frame_width integer not null check (frame_width > 0),
  frame_height integer not null check (frame_height > 0),
  source_width integer not null check (source_width > 0),
  source_height integer not null check (source_height > 0),

  -- Set when another match shares this one's video. Ten uploads on
  -- 2026-08-16 were three files re-uploaded under different names across
  -- seven accounts, which no dedupe on opponent name or storage path can
  -- see. Flagged rather than hidden: they are real rows in production.
  duplicate_of uuid references public.matches(id) on delete set null,
  duplicate_reason text,

  -- {luna: {trials: [...], consensus: {...}}, sol: {...}, production: {...}}
  -- Corners throughout are source pixels, cyclic A_near_left -> B_near_right
  -- -> C_far_right -> D_far_left, matching CANONICAL_CORNER_NAMES.
  proposals jsonb not null default '{}'::jsonb,

  -- [[x,y] x4] in source pixels. Null until the owner draws it.
  corrected_corners jsonb,
  verdict text check (
    verdict in ('correct', 'loose', 'wrong_table', 'no_table', 'unusable')
  ),
  notes text check (notes is null or length(notes) <= 2000),

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.table_calibration_review is
  'Owner-corrected table corners per match, beside every model proposal.';

create index if not exists table_calibration_review_verdict_idx
  on public.table_calibration_review (verdict)
  where verdict is not null;

alter table public.table_calibration_review enable row level security;

-- Admins and active research reviewers, and only them. Nothing here is
-- granted to anon, so is_admin() is safe in the policy: EXECUTE on it is
-- granted to authenticated, and an anon caller never reaches the check.
create policy table_calibration_review_read
  on public.table_calibration_review for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.research_reviewers r
      where r.user_id = auth.uid() and r.active
    )
  );

create policy table_calibration_review_write
  on public.table_calibration_review for update to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.research_reviewers r
      where r.user_id = auth.uid() and r.active
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.research_reviewers r
      where r.user_id = auth.uid() and r.active
    )
  );

-- Rows are seeded by the worker-side build script under the service role,
-- which bypasses RLS. No insert policy: a reviewer corrects a match that
-- exists, they do not invent one.

create or replace function public.touch_table_calibration_review()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger table_calibration_review_touch
  before update on public.table_calibration_review
  for each row execute function public.touch_table_calibration_review();
