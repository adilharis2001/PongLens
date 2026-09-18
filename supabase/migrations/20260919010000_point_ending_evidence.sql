-- Detector snapshots are separate from human labels and cannot modify them.
create table public.point_ending_evidence (
 point_id uuid primary key references public.point_ending_research(id),
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 input_hashes jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.point_ending_evidence enable row level security;
revoke all on public.point_ending_evidence from anon, authenticated;
grant select on public.point_ending_evidence to authenticated;
grant all on public.point_ending_evidence to service_role;
create policy admin_read_point_ending_evidence on public.point_ending_evidence
 for select to authenticated using (public.is_admin());
