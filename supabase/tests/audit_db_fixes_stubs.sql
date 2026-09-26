-- What the post-rollout audit migration (20260926141940_post_rollout_audit_fixes
-- .sql) needs on top of the marker-game-ends test chain, for a bare
-- Postgres. Production's shapes as they were on 2026-09-26: the hand-cut
-- draft policies and grants (the RLS the migration tightens), the cloud
-- switch and the grants the migration revokes, the reel bell's trigger,
-- the columns the review order, note feed and share links read, and the
-- notifications foreign key. Stand-ins elsewhere, marked as such.
--
--   docker run -d --name audit-db-pg -e POSTGRES_PASSWORD=x postgres:17-alpine
--   for f in supabase/tests/device_hand_cut_stubs.sql \
--            supabase/migrations/20260925061009_device_hand_cut.sql \
--            supabase/migrations/20260925105830_device_hand_cut_silent_handoff.sql \
--            supabase/tests/cut_again_stubs.sql \
--            supabase/migrations/20260925124616_cut_again.sql \
--            supabase/migrations/20260925133555_recut_prefill_is_not_a_draft.sql \
--            supabase/migrations/20260925133639_recut_prefill_guard_definer.sql \
--            supabase/tests/cut_again_auto_stubs.sql \
--            supabase/migrations/20260925170532_cut_again_auto_replace.sql \
--            supabase/migrations/20260925184052_cancel_followups_of_deleted_match.sql \
--            supabase/migrations/20260925184230_marker_game_ends.sql \
--            supabase/tests/cut_again.sql \
--            supabase/tests/cut_again_auto.sql \
--            supabase/tests/marker_game_ends_stubs.sql \
--            supabase/tests/marker_game_ends.sql \
--            supabase/tests/audit_db_fixes_stubs.sql \
--            supabase/migrations/20260926141940_post_rollout_audit_fixes.sql \
--            supabase/tests/audit_db_fixes.sql; do
--     docker exec -i audit-db-pg psql -q -v ON_ERROR_STOP=1 -U postgres < "$f"
--   done
--   docker rm -f audit-db-pg
\set ON_ERROR_STOP on

grant usage on schema public, auth to anon, authenticated, service_role;

-- ------------------------------------------------------------------- M1
alter table public.processing_control
  add column cloud_mode text not null default 'disabled',
  add column latest_dispatch_reason text,
  add column updated_at timestamptz;
insert into public.processing_control (singleton) values (true)
  on conflict do nothing;

-- Stand-in: records that it was asked. The grants are production's.
create function public.cloud_worker_decision(p_claim boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  update public.processing_control
     set latest_dispatch_reason = 'decided', updated_at = now()
   where singleton;
  return jsonb_build_object('run', false, 'claimed', p_claim);
end $$;
revoke all on function public.cloud_worker_decision(boolean) from public;
grant execute on function public.cloud_worker_decision(boolean)
  to anon, authenticated, service_role;

-- Production's.
CREATE FUNCTION public.set_cloud_worker_mode(p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_mode not in ('disabled', 'manual', 'automatic') then
    raise exception 'unknown cloud mode %', p_mode using errcode = '22023';
  end if;
  update public.processing_control
     set cloud_mode = p_mode,
         latest_dispatch_reason = 'mode_changed',
         updated_at = now()
   where singleton;
  -- Ask, do not claim: the dispatcher on Modal is the only thing that
  -- starts a worker, and it must see run = true on its own next tick.
  return public.cloud_worker_decision(false);
end;
$function$;
revoke all on function public.set_cloud_worker_mode(text) from public, anon;
grant execute on function public.set_cloud_worker_mode(text) to authenticated, service_role;

-- ------------------------------------------------------------------- M2
-- Production's policies and grants before the migration.
alter table public.hand_cut_drafts enable row level security;
create policy "own hand cut drafts insertable" on public.hand_cut_drafts
  for insert with check (user_id = (select auth.uid()));
create policy "own hand cut drafts readable" on public.hand_cut_drafts
  for select using (user_id = (select auth.uid()));
create policy "own unsubmitted hand cut drafts deletable" on public.hand_cut_drafts
  for delete using (user_id = (select auth.uid()) and submitted_at is null);
create policy "own unsubmitted hand cut drafts updatable" on public.hand_cut_drafts
  for update using (user_id = (select auth.uid()) and submitted_at is null)
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.hand_cut_drafts to anon;
grant select, insert, delete on public.hand_cut_drafts to authenticated;
grant update (marks, mode, updated_at) on public.hand_cut_drafts to authenticated;
-- The owner reads their own matches (production's RLS lets them); the
-- policy's subquery needs to see the row.
grant select on public.matches to authenticated;

-- ------------------------------------------------------------- C and G
-- Production's key: a bell goes when its match goes. NOT VALID only
-- because the earlier suites leave bells behind on purpose.
alter table public.notifications
  add constraint notifications_match_id_fkey foreign key (match_id)
  references public.matches(id) on delete cascade not valid;

-- ------------------------------------------------------------------- E
-- The trigger is production's; the function is the migration's.
create function public.match_reels_notify() returns trigger
language plpgsql as $$ begin return new; end $$;
create trigger match_reels_notify_status after update of status on public.match_reels
  for each row execute function public.match_reels_notify();

-- ------------------------------------------------------------------- F
alter table public.notes
  add column author_id uuid references auth.users(id),
  add column image_path text,
  add column created_at timestamptz not null default now();
-- Stand-in: the owner only (production adds coaches and the sample).
create function public.has_match_access(m_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.matches m
                  where m.id = m_id and m.user_id = auth.uid());
$$;

-- ------------------------------------------------------------------- J
alter table public.share_links
  add column id uuid not null default gen_random_uuid() unique,
  add column owner uuid;
create unique index share_links_active_point_uniq on public.share_links (point_id)
  where kind = 'point' and revoked_at is null;

-- ------------------------------------------------------------------- L
alter table public.review_orders
  add column student_id uuid,
  add column coach_id uuid,
  add column intake_answers jsonb,
  add column submitted_at timestamptz,
  add column updated_at timestamptz;

-- ------------------------------------------------------------------ S2
-- Stand-in for the layers under the overview, with the lists the page
-- reads: workers, waiting, running and recent.
create or replace function public.admin_processing_overview_pre_cloud_twin_20260916()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workers', coalesce((select jsonb_agg(jsonb_build_object('worker_id', worker_id,
                                                             'job_id', job_id)
                                          order by worker_id)
                           from public.worker_pulse), '[]'),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind)
                                          order by created_at)
                           from public.jobs where status = 'queued'), '[]'),
    'running', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind)
                                          order by created_at)
                           from public.jobs where status = 'processing'), '[]'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status)
                                         order by updated_at desc)
                          from public.jobs where status in ('done', 'failed', 'cancelled')), '[]'),
    'cloud', '{}'::jsonb)
$$;
