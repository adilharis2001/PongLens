-- Every run of the offering drafter, so it can be rate limited and so a
-- coach pressing the button on the same words twice costs nothing.
--
-- Server-only, the same shape as review_assist_runs: RLS on with no
-- policies granted, so the anon and authenticated roles cannot read or
-- write it. A limit a client can edit is not a limit.

create table if not exists offering_draft_runs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  -- sha256 of exactly what was sent to the model, so the same brief asked
  -- twice comes back from the last answer instead of spending again.
  input_hash text not null,
  -- The answer itself, so a repeat is served rather than regenerated.
  result jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists offering_draft_runs_coach_idx
  on offering_draft_runs (coach_id, created_at desc);

alter table offering_draft_runs enable row level security;
