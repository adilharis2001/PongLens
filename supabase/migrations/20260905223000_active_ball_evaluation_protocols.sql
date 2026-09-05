create table public.active_ball_evaluation_runs (
  run_id text primary key,
  model text not null,
  protocol_sha256 text not null,
  benchmark_sha256 text not null,
  created_at timestamptz not null default now()
);
alter table public.active_ball_evaluation_runs enable row level security;
revoke all on public.active_ball_evaluation_runs from anon, authenticated;
grant select on public.active_ball_evaluation_runs to authenticated;
create policy active_ball_evaluation_runs_admin_read on public.active_ball_evaluation_runs
  for select to authenticated using(public.is_admin());
