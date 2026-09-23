-- Machine suggestions are immutable research inputs, separate from owner labels.
-- Label revisions/history record subsequent confirmations and corrections.
create table public.point_ending_suggestions (
  point_id uuid not null references public.point_ending_research(id),
  run_id text not null check (run_id ~ '^[a-z0-9-]{1,80}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'runId'=run_id and payload->>'version'='1'),
  source_revision integer not null check (source_revision>=0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key(point_id,run_id)
);
alter table public.point_ending_suggestions enable row level security;
create policy admin_read on public.point_ending_suggestions for select to authenticated using(public.is_admin());
revoke all on public.point_ending_suggestions from anon,authenticated,service_role;
grant select on public.point_ending_suggestions to authenticated;
grant select,insert on public.point_ending_suggestions to service_role;
comment on table public.point_ending_suggestions is 'Frozen machine suggestions; never human ground truth. Confirmations/corrections live in point_ending_research.label.suggestionReview and its revision history.';
