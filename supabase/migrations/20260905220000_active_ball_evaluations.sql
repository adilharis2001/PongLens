-- Independent frozen evaluation. Human labels and local predictions remain intact.
create table public.active_ball_evaluations (
  run_id text not null,
  sample_id uuid not null references public.active_ball_samples(id) on delete cascade,
  model text not null,
  prediction jsonb not null,
  reference_label jsonb not null,
  reference_revision integer not null,
  created_at timestamptz not null default now(),
  primary key(run_id,sample_id)
);
alter table public.active_ball_evaluations enable row level security;
revoke all on public.active_ball_evaluations from anon, authenticated;
grant select on public.active_ball_evaluations to authenticated;
create policy active_ball_evaluations_admin_read on public.active_ball_evaluations
  for select to authenticated using(public.is_admin());
