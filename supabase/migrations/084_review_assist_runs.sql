-- Every run of a write-up tool, so the tools can be rate limited and so a
-- coach pressing the button on unchanged text costs nothing.
--
-- Server-only. No RLS policies are granted, so the anon and authenticated
-- roles cannot read or write it at all; the route reaches it with the
-- service role. A limit a client can edit is not a limit.

create table if not exists review_assist_runs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references review_orders (id) on delete cascade,
  coach_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('tidy', 'check')),
  -- sha256 of exactly what was sent to the model. Same hash means the
  -- coach has not touched the text since, so there is nothing to redo.
  input_hash text not null,
  created_at timestamptz not null default now()
);

-- The two questions the route asks: how much has this coach run in the
-- last hour, and what happened on this order recently.
create index if not exists review_assist_runs_coach_idx
  on review_assist_runs (coach_id, created_at desc);
create index if not exists review_assist_runs_order_idx
  on review_assist_runs (order_id, action, created_at desc);

alter table review_assist_runs enable row level security;
