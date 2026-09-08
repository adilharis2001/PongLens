-- Private match-quality feedback, admin review, and exact processing refunds.
-- General product feedback remains in feedback_items; this subsystem is tied
-- to a match and keeps all player and coach work intact after a refund.

alter table public.processing_ledger
  add column reverses_id bigint;

alter table public.processing_ledger
  add constraint processing_ledger_reverses_fk
  foreign key (reverses_id)
  references public.processing_ledger (id)
  on delete restrict;

-- The old worker could return several spends in one job-level refund call.
-- Match their complete financial identity, not merely the job. Equal charges
-- are financially interchangeable; pair them in stable chronological order so
-- a partially refunded group leaves only its remaining spends refundable.
-- An unmatched amount, lost job identity or inconsistent financial fact needs
-- reconciliation. Do not guess or leave a spent row eligible for a second refund.
do $$
declare v_unmatched public.processing_ledger%rowtype;
begin
  with spends as (
    select *, row_number() over (
      partition by user_id, job_id, match_id, funding, billing_mode, order_id, purchase_id, minutes
      order by created_at, id
    ) as ordinal
    from public.processing_ledger where kind = 'spend' and minutes < 0 and job_id is not null
  ), refunds as (
    select *, row_number() over (
      partition by user_id, job_id, match_id, funding, billing_mode, order_id, purchase_id, minutes
      order by created_at, id
    ) as ordinal
    from public.processing_ledger where kind = 'refund' and minutes > 0 and job_id is not null
  )
  update public.processing_ledger refund
  set reverses_id = spend.id
  from spends spend join refunds historical
    on historical.job_id = spend.job_id and historical.user_id = spend.user_id
    and historical.match_id is not distinct from spend.match_id
    and historical.funding = spend.funding and historical.billing_mode = spend.billing_mode
    and historical.order_id is not distinct from spend.order_id
    and historical.purchase_id is not distinct from spend.purchase_id
    and historical.minutes = -spend.minutes and historical.ordinal = spend.ordinal
    and (spend.created_at, spend.id) < (historical.created_at, historical.id)
  where refund.id = historical.id;

  select * into v_unmatched from public.processing_ledger
    where kind = 'refund' and reverses_id is null order by created_at, id limit 1;
  if found then
    raise exception 'cannot backfill processing refund %: no exact unreversed spend (job %)',
      v_unmatched.id, coalesce(v_unmatched.job_id::text, 'missing')
      using errcode = '23514', hint = 'Reconcile this historical ledger entry before retrying the migration.';
  end if;
end;
$$;

create unique index processing_ledger_one_reversal_idx
  on public.processing_ledger (reverses_id)
  where kind = 'refund';

create table public.match_processing_feedback (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  source_job_id uuid references public.jobs (id) on delete set null,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  reporter_role text not null check (reporter_role in ('owner', 'coach')),
  kind text not null
    check (kind in ('positive', 'problem', 'reprocess', 'refund')),
  status text not null check (status in (
    'recorded', 'pending', 'reprocess_queued', 'reprocessing',
    'candidate_ready', 'resolved_reprocessed', 'resolved_refunded',
    'declined', 'execution_failed', 'cancelled'
  )),
  message text not null default '' check (length(message) <= 1000),
  refundable_minutes integer not null default 0
    check (refundable_minutes >= 0),
  idempotency_key uuid not null,
  resolution text check (
    resolution is null or resolution in ('reprocess', 'refund', 'none')
  ),
  player_note text not null default '' check (length(player_note) <= 1000),
  internal_note text not null default '' check (length(internal_note) <= 4000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, idempotency_key)
);

create index match_processing_feedback_queue_idx
  on public.match_processing_feedback (status, created_at);
create index match_processing_feedback_match_idx
  on public.match_processing_feedback (match_id, created_at desc);

-- A nullable source job is normal for old matches. Coalescing it keeps those
-- rows under the same one-active-remedy rule as newer matches.
create unique index match_processing_feedback_active_remedy_idx
  on public.match_processing_feedback (
    match_id,
    coalesce(source_job_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where kind in ('reprocess', 'refund')
    and status in ('pending', 'reprocess_queued', 'reprocessing', 'candidate_ready');

create table public.match_processing_feedback_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null
    references public.match_processing_feedback (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in (
    'submitted', 'cancelled', 'reprocess_queued', 'reprocessing',
    'candidate_ready', 'execution_failed', 'refunded', 'published',
    'kept_current', 'restored', 'declined'
  )),
  player_note text not null default '' check (length(player_note) <= 1000),
  internal_note text not null default '' check (length(internal_note) <= 4000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index match_processing_feedback_events_issue_idx
  on public.match_processing_feedback_events (issue_id, created_at);

create table public.match_issue_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null
    references public.match_processing_feedback (id) on delete cascade,
  event_id uuid not null
    references public.match_processing_feedback_events (id) on delete cascade,
  template text not null check (template in ('submission', 'resolution')),
  recipient_email text not null,
  state text not null default 'prepared' check (state in (
    'prepared', 'sending', 'accepted', 'delivered', 'suppressed', 'failed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_email_id text,
  provider_error text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, recipient_email)
);

alter table public.match_processing_feedback enable row level security;
alter table public.match_processing_feedback_events enable row level security;
alter table public.match_issue_email_deliveries enable row level security;

revoke all on public.match_processing_feedback from anon, authenticated;
revoke all on public.match_processing_feedback_events from anon, authenticated;
revoke all on public.match_issue_email_deliveries from anon, authenticated;
grant all on public.match_processing_feedback to service_role;
grant all on public.match_processing_feedback_events to service_role;
grant all on public.match_issue_email_deliveries to service_role;

-- Append notification kinds without replacing kinds installed later than the
-- original notifications migration.
do $$
declare v_check text;
begin
  select pg_get_expr(conbin, conrelid) into v_check
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and conname = 'notifications_kind_check';
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check check ((' ||
    v_check || ') or kind in (''match_issue_reported'', ''match_issue_updated'', ''match_reprocess_ready'', ''match_reprocess_failed''))';
end;
$$;

create or replace function public._match_issue_refundable_minutes(
  p_owner_id uuid,
  p_match_id uuid,
  p_source_job_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(-spend.minutes), 0)::integer
  from public.processing_ledger spend
  where spend.user_id = p_owner_id
    and spend.match_id = p_match_id
    and spend.kind = 'spend'
    and spend.funding = 'personal'
    and spend.minutes < 0
    and (p_source_job_id is null or spend.job_id = p_source_job_id)
    and not exists (
      select 1
      from public.processing_ledger refund
      where refund.kind = 'refund'
        and refund.reverses_id = spend.id
    );
$$;

revoke all on function public._match_issue_refundable_minutes(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public._match_issue_response(
  p_issue public.match_processing_feedback,
  p_include_money boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p_issue.id is null then null else jsonb_strip_nulls(
    jsonb_build_object(
      'id', p_issue.id,
      'matchId', p_issue.match_id,
      'kind', p_issue.kind,
      'status', p_issue.status,
      'message', p_issue.message,
      'resolution', p_issue.resolution,
      'playerNote', nullif(p_issue.player_note, ''),
      'refundableMinutes', case when p_include_money then p_issue.refundable_minutes end,
      'createdAt', p_issue.created_at,
      'updatedAt', p_issue.updated_at
    )
  ) end;
$$;

revoke all on function public._match_issue_response(public.match_processing_feedback, boolean)
  from public, anon, authenticated;

create or replace function public.match_issue_state(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_match public.matches%rowtype;
  v_issue public.match_processing_feedback%rowtype;
  v_is_owner boolean;
  v_minutes integer := 0;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.has_match_access(p_match_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_is_owner := v_match.user_id = v_me;
  if v_is_owner then
    v_minutes := public._match_issue_refundable_minutes(
      v_match.user_id, v_match.id, v_match.job_id
    );
  end if;

  select * into v_issue
  from public.match_processing_feedback
  where match_id = p_match_id and reporter_id = v_me
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'role', case when v_is_owner then 'owner' else 'coach' end,
    'matchStatus', v_match.status,
    'activeIssue', public._match_issue_response(v_issue, v_is_owner),
    'refundableMinutes', case when v_is_owner then v_minutes else null end,
    'canPositive', v_is_owner and v_match.status = 'ready',
    'canProblem', true,
    'canReprocess', v_is_owner and v_match.status = 'ready',
    'canRefund', v_is_owner and v_match.status = 'ready' and v_minutes > 0
  );
end;
$$;

revoke all on function public.match_issue_state(uuid) from public, anon;
grant execute on function public.match_issue_state(uuid) to authenticated;

create or replace function public.submit_match_issue(
  p_match_id uuid,
  p_kind text,
  p_message text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_match public.matches%rowtype;
  v_issue public.match_processing_feedback%rowtype;
  v_event_id uuid;
  v_is_owner boolean;
  v_minutes integer := 0;
  v_status text;
  v_admin record;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('positive', 'problem', 'reprocess', 'refund')
     or p_idempotency_key is null
     or length(trim(coalesce(p_message, ''))) > 1000
     or (p_kind = 'problem' and length(trim(coalesce(p_message, ''))) = 0) then
    raise exception 'invalid input' using errcode = '23514';
  end if;

  select * into v_issue
  from public.match_processing_feedback
  where reporter_id = v_me and idempotency_key = p_idempotency_key;
  if found then
    return public._match_issue_response(v_issue, v_issue.owner_id = v_me);
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.has_match_access(p_match_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Keep this ownership test independent from has_match_access: coaches may
  -- report a problem, but they never choose an economic remedy.
  v_is_owner := exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and m.user_id = v_me
  );
  if p_kind in ('positive', 'reprocess', 'refund') and not v_is_owner then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind in ('positive', 'reprocess', 'refund')
     and v_match.status <> 'ready' then
    raise exception 'match not ready' using errcode = 'P0001';
  end if;

  if p_kind = 'refund' then
    v_minutes := public._match_issue_refundable_minutes(
      v_match.user_id, v_match.id, v_match.job_id
    );
    if v_minutes < 1 then
      raise exception 'nothing to refund' using errcode = 'P0001';
    end if;
  end if;
  v_status := case when p_kind = 'positive' then 'recorded' else 'pending' end;

  -- Serialize remedy creation before the partial unique index handles a
  -- second transaction. The existing row is returned as the canonical state.
  perform pg_advisory_xact_lock(hashtextextended(
    p_match_id::text || ':' || coalesce(v_match.job_id::text, 'legacy'), 0
  ));
  if p_kind in ('reprocess', 'refund') then
    select * into v_issue
    from public.match_processing_feedback
    where match_id = p_match_id
      and coalesce(source_job_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_match.job_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and kind in ('reprocess', 'refund')
      and status in ('pending', 'reprocess_queued', 'reprocessing', 'candidate_ready')
    order by created_at
    limit 1;
    if found then
      return public._match_issue_response(v_issue, v_is_owner);
    end if;
  end if;

  if p_kind = 'positive' then
    select * into v_issue
    from public.match_processing_feedback
    where match_id = p_match_id
      and reporter_id = v_me
      and kind = 'positive'
      and source_job_id is not distinct from v_match.job_id
    order by created_at desc
    limit 1;
    if found then
      update public.match_processing_feedback
      set message = trim(coalesce(p_message, '')),
          idempotency_key = p_idempotency_key,
          updated_at = now()
      where id = v_issue.id
      returning * into v_issue;
      return public._match_issue_response(v_issue, true);
    end if;
  end if;

  insert into public.match_processing_feedback (
    match_id, source_job_id, reporter_id, owner_id, reporter_role,
    kind, status, message, refundable_minutes, idempotency_key
  ) values (
    p_match_id, v_match.job_id, v_me, v_match.user_id,
    case when v_is_owner then 'owner' else 'coach' end,
    p_kind, v_status, trim(coalesce(p_message, '')), v_minutes,
    p_idempotency_key
  ) returning * into v_issue;

  insert into public.match_processing_feedback_events (issue_id, actor_id, kind)
  values (v_issue.id, v_me, 'submitted') returning id into v_event_id;

  if p_kind <> 'positive' then
    for v_admin in
      select id from auth.users
      where lower(email) in ('adilharis2001@gmail.com', 'aber97@gmail.com')
    loop
      insert into public.notifications (
        user_id, kind, match_id, actor_id, title, body, href
      ) values (
        v_admin.id, 'match_issue_reported', p_match_id, v_me,
        case p_kind
          when 'refund' then 'Processing minutes requested'
          when 'reprocess' then 'Match reprocessing requested'
          else 'Match problem reported'
        end,
        case when length(v_issue.message) > 0 then v_issue.message else null end,
        '/admin/issues/' || v_issue.id
      );
    end loop;

    insert into public.match_issue_email_deliveries (
      issue_id, event_id, template, recipient_email
    ) values (v_issue.id, v_event_id, 'submission', 'support@ponglens.com');
  end if;

  return public._match_issue_response(v_issue, v_is_owner);
end;
$$;

revoke all on function public.submit_match_issue(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.submit_match_issue(uuid, text, text, uuid) to authenticated;

create or replace function public.cancel_match_issue(p_issue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_issue public.match_processing_feedback%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_issue
  from public.match_processing_feedback
  where id = p_issue_id
  for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_issue.reporter_id <> v_me then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_issue.status <> 'pending' then
    raise exception 'already decided' using errcode = 'P0001';
  end if;

  update public.match_processing_feedback
  set status = 'cancelled', updated_at = now()
  where id = p_issue_id
  returning * into v_issue;
  insert into public.match_processing_feedback_events (issue_id, actor_id, kind)
  values (v_issue.id, v_me, 'cancelled');
  return public._match_issue_response(v_issue, v_issue.owner_id = v_me);
end;
$$;

revoke all on function public.cancel_match_issue(uuid) from public, anon;
grant execute on function public.cancel_match_issue(uuid) to authenticated;

create or replace function public.admin_match_issue_list(p_status text default '')
returns table (
  id uuid,
  match_id uuid,
  source_job_id uuid,
  reporter_id uuid,
  owner_id uuid,
  reporter_role text,
  reporter_email text,
  owner_email text,
  kind text,
  status text,
  message text,
  refundable_minutes integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    '', 'pending', 'reprocessing', 'resolved'
  ) then raise exception 'invalid input' using errcode = '23514'; end if;

  return query
  select i.id, i.match_id, i.source_job_id, i.reporter_id, i.owner_id,
    i.reporter_role, reporter.email::text, owner_user.email::text,
    i.kind, i.status, i.message, i.refundable_minutes,
    i.created_at, i.updated_at
  from public.match_processing_feedback i
  join auth.users reporter on reporter.id = i.reporter_id
  join auth.users owner_user on owner_user.id = i.owner_id
  where p_status = ''
     or (p_status = 'pending' and i.status = 'pending')
     or (p_status = 'reprocessing' and i.status in (
       'reprocess_queued', 'reprocessing', 'candidate_ready'
     ))
     or (p_status = 'resolved' and i.status in (
       'recorded', 'resolved_reprocessed', 'resolved_refunded',
       'declined', 'execution_failed', 'cancelled'
     ))
  order by
    case when i.status = 'pending' then 0
         when i.status in ('reprocess_queued', 'reprocessing', 'candidate_ready') then 1
         else 2 end,
    case when i.status = 'pending' then i.created_at end asc,
    i.updated_at desc;
end;
$$;

revoke all on function public.admin_match_issue_list(text) from public, anon;
grant execute on function public.admin_match_issue_list(text) to authenticated;

create or replace function public.admin_match_issue_detail(p_issue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_issue public.match_processing_feedback%rowtype;
  v_match public.matches%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_issue
  from public.match_processing_feedback
  where id = p_issue_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into v_match from public.matches where id = v_issue.match_id;

  return jsonb_build_object(
    'issue', to_jsonb(v_issue),
    'match', jsonb_build_object(
      'id', v_match.id,
      'status', v_match.status,
      'ownerId', v_match.user_id,
      'jobId', v_match.job_id,
      'cutPath', v_match.cut_path,
      'rawPath', v_match.raw_path,
      'matchJsonPath', v_match.match_json_path,
      'opponentName', v_match.opponent_name,
      'playedAt', v_match.played_at
    ),
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at)
      from public.match_processing_feedback_events e
      where e.issue_id = v_issue.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_match_issue_detail(uuid) from public, anon;
grant execute on function public.admin_match_issue_detail(uuid) to authenticated;

create or replace function public.admin_refund_match_issue(
  p_issue_id uuid,
  p_player_note text,
  p_internal_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.match_processing_feedback%rowtype;
  v_spend public.processing_ledger%rowtype;
  v_event_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_player_note, ''))) = 0
     or length(trim(coalesce(p_player_note, ''))) > 1000
     or length(trim(coalesce(p_internal_note, ''))) > 4000 then
    raise exception 'invalid input' using errcode = '23514';
  end if;

  select * into v_issue
  from public.match_processing_feedback
  where id = p_issue_id
  for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_issue.status = 'resolved_refunded' then
    return public.admin_match_issue_detail(v_issue.id);
  end if;
  if v_issue.kind <> 'refund' or v_issue.status <> 'pending' then
    raise exception 'already decided' using errcode = 'P0001';
  end if;

  select spend.* into v_spend
  from public.processing_ledger spend
  where spend.user_id = v_issue.owner_id
    and spend.match_id = v_issue.match_id
    and spend.kind = 'spend'
    and spend.funding = 'personal'
    and spend.minutes < 0
    and (v_issue.source_job_id is null or spend.job_id = v_issue.source_job_id)
  order by spend.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'nothing to refund' using errcode = 'P0001';
  end if;

  insert into public.processing_ledger (
    user_id, minutes, kind, funding, billing_mode, match_id, job_id,
    order_id, purchase_id, note, reverses_id
  ) values (
    v_spend.user_id, -v_spend.minutes, 'refund', v_spend.funding,
    v_spend.billing_mode, v_spend.match_id, v_spend.job_id,
    v_spend.order_id, v_spend.purchase_id, 'bad cut refund', v_spend.id
  )
  on conflict (reverses_id) where kind = 'refund' do nothing;

  update public.match_processing_feedback
  set status = 'resolved_refunded', resolution = 'refund',
      player_note = trim(p_player_note),
      internal_note = trim(coalesce(p_internal_note, '')),
      decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = v_issue.id
  returning * into v_issue;

  insert into public.match_processing_feedback_events (
    issue_id, actor_id, kind, player_note, internal_note,
    metadata
  ) values (
    v_issue.id, auth.uid(), 'refunded', v_issue.player_note,
    v_issue.internal_note,
    jsonb_build_object('minutes', -v_spend.minutes, 'reversesId', v_spend.id)
  ) returning id into v_event_id;

  insert into public.notifications (
    user_id, kind, match_id, actor_id, title, body, href
  ) values (
    v_issue.owner_id, 'match_issue_updated', v_issue.match_id, auth.uid(),
    'Your processing minutes were returned',
    (-v_spend.minutes) || ' processing minutes were added back. ' || v_issue.player_note,
    '/match/' || v_issue.match_id || '/feedback'
  );

  insert into public.match_issue_email_deliveries (
    issue_id, event_id, template, recipient_email
  )
  select v_issue.id, v_event_id, 'resolution', u.email
  from auth.users u
  where u.id = v_issue.owner_id and u.email is not null;

  return public.admin_match_issue_detail(v_issue.id);
end;
$$;

revoke all on function public.admin_refund_match_issue(uuid, text, text)
  from public, anon;
grant execute on function public.admin_refund_match_issue(uuid, text, text) to authenticated;

create or replace function public.finish_match_issue_email_delivery(
  p_delivery_id uuid,
  p_state text,
  p_error text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('accepted', 'suppressed', 'failed')
     or length(coalesce(p_error, '')) > 1000 then
    raise exception 'invalid input' using errcode = '23514';
  end if;

  update public.match_issue_email_deliveries
  set state = p_state,
      attempt_count = attempt_count + 1,
      provider_error = nullif(trim(coalesce(p_error, '')), ''),
      last_attempt_at = now(),
      updated_at = now()
  where id = p_delivery_id
    and state in ('prepared', 'failed');
end;
$$;

revoke all on function public.finish_match_issue_email_delivery(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_match_issue_email_delivery(uuid, text, text) to service_role;

-- Worker failures and manual refunds use the same spend identity. Whichever
-- writes the reversal first wins the unique index; the other becomes a no-op.
create or replace function public.refund_processing_spend(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.processing_ledger (
    user_id, minutes, kind, funding, billing_mode,
    match_id, job_id, order_id, note, reverses_id
  )
  select spend.user_id, -spend.minutes, 'refund', spend.funding,
    spend.billing_mode, spend.match_id, spend.job_id, spend.order_id,
    'processing failed', spend.id
  from public.processing_ledger spend
  where spend.job_id = p_job_id
    and spend.kind = 'spend'
    and spend.funding = 'personal'
  on conflict (reverses_id) where kind = 'refund' do nothing;
end;
$$;

revoke all on function public.refund_processing_spend(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_processing_spend(uuid) to service_role;
