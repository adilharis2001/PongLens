-- 034: authenticated fused audio + BlurBall research labeling.
-- Applied via the direct production Postgres connection; keep in sync with
-- the Supabase project.

create table public.research_batches (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  schema_version int not null default 1 check (schema_version > 0),
  status         text not null default 'draft'
                 check (status in ('draft', 'active', 'closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger research_batches_set_updated_at
  before update on public.research_batches
  for each row execute function public.set_updated_at();

create table public.research_reviewers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'reviewer'
             check (role in ('reviewer', 'admin')),
  active     boolean not null default true,
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger research_reviewers_set_updated_at
  before update on public.research_reviewers
  for each row execute function public.set_updated_at();

create table public.research_sources (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.research_batches (id)
                    on delete cascade,
  source_match_id   uuid not null,
  source_point_id   uuid not null,
  source_point_idx  int not null,
  match_label       text not null,
  player_near_name  text,
  player_far_name   text,
  venue_label       text,
  media_key         text not null unique
                    check (media_key like 'research/fused-labeling/%'),
  media_sha256      text not null check (length(media_sha256) = 64),
  manifest_sha256   text not null check (length(manifest_sha256) = 64),
  duration_s        double precision not null check (duration_s > 0),
  proposal          jsonb not null default '{}'::jsonb,
  prefill           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (batch_id, source_point_id)
);

create index research_sources_batch_idx
  on public.research_sources (batch_id, source_point_idx);

create table public.research_assignments (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.research_batches (id)
                  on delete cascade,
  source_id       uuid not null references public.research_sources (id)
                  on delete cascade,
  reviewer_id     uuid not null references auth.users (id) on delete cascade,
  sequence        int not null check (sequence > 0),
  duplicate_group text,
  is_repeat       boolean not null default false,
  status          text not null default 'not_started'
                  check (status in ('not_started', 'in_progress', 'submitted')),
  human_label     jsonb not null default '{}'::jsonb,
  review_metrics  jsonb not null default '{}'::jsonb,
  started_at      timestamptz,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (batch_id, reviewer_id, sequence)
);

create index research_assignments_reviewer_queue_idx
  on public.research_assignments (reviewer_id, batch_id, sequence);
create index research_assignments_source_idx
  on public.research_assignments (source_id);

create trigger research_assignments_set_updated_at
  before update on public.research_assignments
  for each row execute function public.set_updated_at();

-- Hidden targets and adjudication live separately so no source-table SELECT
-- can reveal them to a reviewer.
create table public.research_gold_labels (
  source_id     uuid primary key references public.research_sources (id)
                on delete cascade,
  gold_label    jsonb not null,
  provenance    text not null,
  adjudicated_by uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger research_gold_labels_set_updated_at
  before update on public.research_gold_labels
  for each row execute function public.set_updated_at();

alter table public.research_batches enable row level security;
alter table public.research_reviewers enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_assignments enable row level security;
alter table public.research_gold_labels enable row level security;

create policy research_reviewers_self_select
  on public.research_reviewers for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy research_reviewers_admin_manage
  on public.research_reviewers for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy research_assignments_own_select
  on public.research_assignments for select
  to authenticated
  using (
    public.is_admin()
    or (
      reviewer_id = (select auth.uid())
      and exists (
        select 1
        from public.research_reviewers r
        where r.user_id = (select auth.uid()) and r.active
      )
    )
  );

create policy research_assignments_own_update
  on public.research_assignments for update
  to authenticated
  using (
    public.is_admin()
    or (
      reviewer_id = (select auth.uid())
      and exists (
        select 1
        from public.research_reviewers r
        where r.user_id = (select auth.uid()) and r.active
      )
    )
  )
  with check (
    public.is_admin()
    or (
      reviewer_id = (select auth.uid())
      and exists (
        select 1
        from public.research_reviewers r
        where r.user_id = (select auth.uid()) and r.active
      )
    )
  );

create policy research_sources_assigned_select
  on public.research_sources for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.research_assignments a
      join public.research_reviewers r on r.user_id = a.reviewer_id
      where a.source_id = research_sources.id
        and a.reviewer_id = (select auth.uid())
        and r.active
    )
  );

create policy research_batches_assigned_select
  on public.research_batches for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.research_assignments a
      join public.research_reviewers r on r.user_id = a.reviewer_id
      where a.batch_id = research_batches.id
        and a.reviewer_id = (select auth.uid())
        and r.active
    )
  );

create policy research_batches_admin_manage
  on public.research_batches for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy research_sources_admin_manage
  on public.research_sources for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy research_assignments_admin_manage
  on public.research_assignments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy research_gold_admin_manage
  on public.research_gold_labels for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- New Supabase projects no longer guarantee automatic Data API grants.
-- Make every exposure explicit and keep immutable source/proposal rows
-- read-only to reviewers.
revoke all on public.research_batches from anon;
revoke all on public.research_reviewers from anon;
revoke all on public.research_sources from anon;
revoke all on public.research_assignments from anon;
revoke all on public.research_gold_labels from anon;

revoke all on public.research_batches from authenticated;
revoke all on public.research_reviewers from authenticated;
revoke all on public.research_sources from authenticated;
revoke all on public.research_assignments from authenticated;
revoke all on public.research_gold_labels from authenticated;

grant select on public.research_batches to authenticated;
grant select on public.research_reviewers to authenticated;
grant select on public.research_sources to authenticated;
grant select on public.research_assignments to authenticated;
grant update (status, human_label, review_metrics, started_at, submitted_at)
  on public.research_assignments to authenticated;

-- Admin imports use a service-role connection. Reviewers, including an admin
-- logged into the web app, cannot directly insert immutable source rows.
revoke insert, update, delete on public.research_sources from authenticated;

create or replace function public.research_add_reviewer(
  p_email text,
  p_role text default 'reviewer'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_role not in ('reviewer', 'admin') then
    raise exception 'invalid role';
  end if;
  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;
  if v_user_id is null then
    raise exception 'user has not signed in yet';
  end if;
  insert into public.research_reviewers (user_id, role, active, added_by)
  values (v_user_id, p_role, true, auth.uid())
  on conflict (user_id) do update
    set role = excluded.role, active = true, added_by = auth.uid();
  return v_user_id;
end;
$$;

revoke execute on function public.research_add_reviewer(text, text)
  from public, anon;
grant execute on function public.research_add_reviewer(text, text)
  to authenticated;

create or replace function public.research_export_batch(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_admin() then
      jsonb_build_object('error', 'admin only')
    else jsonb_build_object(
      'schema_version', b.schema_version,
      'batch', jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'title', b.title, 'status', b.status
      ),
      'exported_at', now(),
      'assignments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'assignment_id', a.id,
            'source_id', a.source_id,
            'source_match_id', s.source_match_id,
            'source_point_id', s.source_point_id,
            'source_point_idx', s.source_point_idx,
            'match_label', s.match_label,
            'reviewer_id', a.reviewer_id,
            'sequence', a.sequence,
            'duplicate_group', a.duplicate_group,
            'is_repeat', a.is_repeat,
            'status', a.status,
            'human_label', a.human_label,
            'review_metrics', a.review_metrics,
            'started_at', a.started_at,
            'submitted_at', a.submitted_at,
            'updated_at', a.updated_at,
            'gold', g.gold_label,
            'gold_provenance', g.provenance
          )
          order by a.reviewer_id, a.sequence
        )
        from public.research_assignments a
        join public.research_sources s on s.id = a.source_id
        left join public.research_gold_labels g on g.source_id = s.id
        where a.batch_id = b.id
      ), '[]'::jsonb)
    )
  end
  from public.research_batches b
  where b.id = p_batch_id;
$$;

revoke execute on function public.research_export_batch(uuid)
  from public, anon;
grant execute on function public.research_export_batch(uuid)
  to authenticated;
