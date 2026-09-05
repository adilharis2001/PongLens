-- Private durable beta outbox. Apply before switching the public route/sweep.
-- Never roll back to the old immediate-send sweep while scheduled mail exists.
alter table public.ios_beta_requests
  add column form_version smallint,
  add column role text check (role in ('player', 'coach', 'both')),
  add column interests text[] not null default '{}',
  add column feedback_choice text not null default 'unanswered' check (feedback_choice in ('unanswered', 'declined', 'opted_in')),
  add column feedback_channels text[] not null default '{}' check (feedback_channels <@ array['email', 'audio_call', 'video_call']::text[]),
  add column answers_at timestamptz,
  add column consent_copy_version text,
  add column scheduled_at timestamptz,
  add column provider_email_id text,
  add column delivery_state text not null default 'pending',
  add column delivery_error_code text,
  add column delivery_updated_at timestamptz not null default now(),
  add column invite_delivered_at timestamptz,
  add column early_send_requested_at timestamptz,
  add column early_send_actor uuid;

update
  public.ios_beta_requests
set
  scheduled_at = created_at + interval '23 hours';

alter table public.ios_beta_requests
  alter column scheduled_at set not null;

create table public.ios_beta_deliveries (
  id uuid primary key default gen_random_uuid (),
  request_id uuid not null references public.ios_beta_requests (id) on delete cascade,
  kind text not null check (kind in ('invite', 'admin_adil', 'admin_anton')),
  recipient text not null,
  state text not null default 'pending' check (state in ('pending', 'scheduled', 'sending', 'sent', 'delivered', 'suppressed', 'failed', 'unknown', 'needs_attention', 'bounced', 'complained', 'canceled')),
  provider_email_id text unique,
  idempotency_key text not null unique,
  -- Text preserves the exact bytes, including timestamps and template version.
  create_payload text,
  first_attempt_at timestamptz,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  early_target_at timestamptz,
  early_applied_at timestamptz,
  cancel_requested boolean not null default false,
  evidence_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (request_id, kind),
  check (create_payload is null or octet_length(create_payload) <= 262144)
);

alter table public.ios_beta_deliveries enable row level security;

revoke all on public.ios_beta_deliveries from public, anon, authenticated;

grant all on public.ios_beta_requests, public.ios_beta_deliveries to service_role;

create index ios_beta_deliveries_pending on public.ios_beta_deliveries (updated_at)
where
  state not in ('sent', 'delivered', 'suppressed', 'bounced', 'complained', 'canceled');

-- Preserve historic outcomes. A legacy unstamped send may have been accepted;
-- without its immutable payload/ID it needs a provider audit, not a fresh POST.
insert into public.ios_beta_deliveries (request_id, kind, recipient, state, idempotency_key, error_code)
select
  id,
  'invite',
  email,
  case when invite_sent_at is not null then
    'sent'
  when invite_suppressed_at is not null then
    'suppressed'
  else
    'needs_attention'
  end,
  'ios-beta-' || id || '-invite',
  case when invite_sent_at is null
    and invite_suppressed_at is null then
    'legacy_unconfirmed'
  end
from
  public.ios_beta_requests;

insert into public.ios_beta_deliveries (request_id, kind, recipient, state, idempotency_key, error_code)
select
  id,
  'admin_adil',
  'adilharis2001@gmail.com',
  case when admin_notified_at is not null then
    'sent'
  when admin_suppressed_at is not null then
    'suppressed'
  else
    'needs_attention'
  end,
  'ios-beta-' || id || '-admin',
  case when admin_notified_at is null
    and admin_suppressed_at is null then
    'legacy_unconfirmed'
  end
from
  public.ios_beta_requests;

-- Intentionally no Anton rows for historic requests.
update
  public.ios_beta_requests r
set
  delivery_state = d.state,
  delivery_error_code = d.error_code
from
  public.ios_beta_deliveries d
where
  d.request_id = r.id
  and d.kind = 'invite';

create function public.initialize_ios_beta_delivery ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
begin
  if tg_when = 'BEFORE' then
    new.scheduled_at := new.created_at + interval '23 hours';
    return new;
  end if;
  insert into public.ios_beta_deliveries (request_id, kind, recipient, idempotency_key)
    values (new.id, 'invite', new.email, 'ios-beta-' || new.id || '-invite'),
    (new.id, 'admin_adil', 'adilharis2001@gmail.com', 'ios-beta-' || new.id || '-admin'),
    (new.id, 'admin_anton', 'aber97@gmail.com', 'ios-beta-' || new.id || '-admin-anton');
  return new;
end
$$;

create trigger beta_deadline
  before insert on public.ios_beta_requests for each row
  execute function public.initialize_ios_beta_delivery ();

create trigger beta_outbox
  after insert on public.ios_beta_requests for each row
  execute function public.initialize_ios_beta_delivery ();

-- Keep the original two-argument RPC and its rate limiting/row locking intact.
-- The v2 function holds that same row lock while saving first answers.
create function public.claim_ios_beta_request_v2 (p_email text, p_ip_hash text, p_answers jsonb)
  returns table (
    request_id uuid,
    request_email text,
    requested_at timestamptz,
    invite_needed boolean,
    admin_notice_needed boolean,
    rate_limited boolean)
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  r record;
  v_role text;
  v_interests text[];
  v_feedback text[];
  allowed text[];
begin
  if p_answers is not null then
    if jsonb_typeof(p_answers) <> 'object'
      or octet_length(p_answers::text) > 16384
      or p_answers ->> 'formVersion' is distinct from '2'
      or p_answers ->> 'role' not in ('player', 'coach', 'both')
      or jsonb_typeof(p_answers -> 'interests') is distinct from 'array'
      or jsonb_typeof(p_answers -> 'feedback') is distinct from 'array' then
      raise exception 'invalid beta answers';
    end if;
    v_role := p_answers ->> 'role';
    if v_role is null then
      raise exception 'invalid beta role';
    end if;
    select
      array_agg(value) into v_interests
    from
      jsonb_array_elements_text(p_answers -> 'interests');
    select
      coalesce(array_agg(value), '{}') into v_feedback
    from
      jsonb_array_elements_text(p_answers -> 'feedback');
    allowed := case when v_role in ('player', 'both') then
      array['iphone_recording', 'video_library', 'point_review', 'match_progress', 'placement_maps', 'professional_review', 'friends_family_sharing', 'coach_sharing', 'highlight_export', 'lesson_audio', 'training_journal', 'journal_questions']
    else
      '{}'::text[]
    end || case when v_role in ('coach', 'both') then
      array['coach_students', 'coach_lesson_recording', 'coach_shared_journal', 'coach_match_feedback', 'coach_profile', 'coach_review_orders']
    else
      '{}'::text[]
    end;
    if coalesce(cardinality(v_interests), 0) not between 1 and 18
      or not v_interests <@ allowed
      or cardinality(v_interests) <> (select count(distinct x) from unnest(v_interests) x)
      or not v_feedback <@ array['email', 'audio_call', 'video_call', 'not_now']
      or cardinality(v_feedback) <> (select count(distinct x) from unnest(v_feedback) x)
      or ('not_now' = any (v_feedback) and cardinality(v_feedback) <> 1) then
      raise exception 'invalid beta choices';
    end if;
  end if;
  select
    * into r
  from
    public.claim_ios_beta_request (p_email, p_ip_hash);
  if not r.rate_limited and p_answers is not null then
    update
      public.ios_beta_requests
    set
      form_version = 2,
      role = v_role,
      interests = v_interests,
      feedback_choice = case when cardinality(v_feedback) = 0 then
        'unanswered'
      when v_feedback = array['not_now'] then
        'declined'
      else
        'opted_in'
      end,
      feedback_channels = array_remove(v_feedback, 'not_now'),
      answers_at = now(),
      consent_copy_version = 'beta-feedback-v2'
    where
      id = r.request_id
      and request_count = 1
      and form_version is null;
  end if;
  return query
  select
    r.request_id,
    r.request_email,
    r.requested_at,
    r.invite_needed,
    r.admin_notice_needed,
    r.rate_limited;
end
$$;

create function public.beta_delivery_merge (p_old text, p_new text)
  returns text
  language sql
  immutable
  set search_path = public
  as $$
  select
    case when p_old = 'complained' then
      p_old
    when p_new = 'complained' then
      p_new
    when p_old = 'bounced' then
      p_old
    when p_new = 'bounced' then
      p_new
    when p_old in ('suppressed', 'canceled') then
      p_old
    when p_new in ('suppressed', 'canceled') then
      p_new
    when p_old = 'delivered' then
      p_old
    when p_old = 'failed'
      and p_new in ('pending', 'scheduled', 'sending', 'unknown', 'needs_attention') then
      p_old
    when p_old = 'sent'
      and p_new in ('pending', 'scheduled', 'sending', 'unknown', 'needs_attention') then
      p_old
    when p_old = 'sending'
      and p_new = 'scheduled' then
      p_old
    else
      p_new
    end;
$$;

create function public.mirror_ios_beta_delivery ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
begin
  if new.kind = 'invite' then
    update
      public.ios_beta_requests
    set
      delivery_state = new.state,
      provider_email_id = new.provider_email_id,
      delivery_error_code = new.error_code,
      delivery_updated_at = new.updated_at,
      invite_sent_at = case when new.state in ('sent', 'delivered') then
        coalesce(invite_sent_at, now())
      else
        invite_sent_at
      end,
      invite_delivered_at = case when new.state = 'delivered' then
        coalesce(invite_delivered_at, now())
      else
        invite_delivered_at
      end,
      invite_suppressed_at = case when new.state = 'suppressed' then
        coalesce(invite_suppressed_at, now())
      else
        invite_suppressed_at
      end
    where
      id = new.request_id;
  elsif new.kind = 'admin_adil' then
    update
      public.ios_beta_requests
    set
      admin_notified_at = case when new.state in ('sent', 'delivered') then
        coalesce(admin_notified_at, now())
      else
        admin_notified_at
      end,
      admin_suppressed_at = case when new.state = 'suppressed' then
        coalesce(admin_suppressed_at, now())
      else
        admin_suppressed_at
      end
    where
      id = new.request_id;
  end if;
  return new;
end
$$;

create trigger beta_delivery_mirror
  after update on public.ios_beta_deliveries for each row
  execute function public.mirror_ios_beta_delivery ();

-- During deployment overlap the previous server still writes only legacy
-- stamps. Reflect those completed sends into the outbox before it can schedule.
-- Only changed stamps and unfinished jobs are touched, so the forward mirror
-- above does not recurse and existing delivered/bounce evidence is retained.
create function public.bridge_ios_beta_legacy_stamps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.invite_sent_at is distinct from old.invite_sent_at and new.invite_sent_at is not null)
    or (new.invite_suppressed_at is distinct from old.invite_suppressed_at and new.invite_suppressed_at is not null) then
    update public.ios_beta_deliveries
    set state = case when new.invite_sent_at is not null then 'sent' else 'suppressed' end,
      error_code = null,
      updated_at = now()
    where request_id = new.id and kind = 'invite'
      and state not in ('sent', 'delivered', 'suppressed', 'bounced', 'complained', 'canceled');
  end if;
  if (new.admin_notified_at is distinct from old.admin_notified_at and new.admin_notified_at is not null)
    or (new.admin_suppressed_at is distinct from old.admin_suppressed_at and new.admin_suppressed_at is not null) then
    update public.ios_beta_deliveries
    set state = case when new.admin_notified_at is not null then 'sent' else 'suppressed' end,
      error_code = null,
      updated_at = now()
    where request_id = new.id and kind = 'admin_adil'
      and state not in ('sent', 'delivered', 'suppressed', 'bounced', 'complained', 'canceled');
  end if;
  return new;
end;
$$;

create trigger beta_legacy_stamp_bridge
after update of invite_sent_at, invite_suppressed_at, admin_notified_at, admin_suppressed_at
on public.ios_beta_requests
for each row execute function public.bridge_ios_beta_legacy_stamps();

revoke all on function public.bridge_ios_beta_legacy_stamps() from public, anon, authenticated;

create function public.lease_ios_beta_delivery (p_id uuid, p_token uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  d public.ios_beta_deliveries;
begin
  select
    * into d
  from
    public.ios_beta_deliveries
  where
    id = p_id
  for update;
  if not found or (d.lease_until is not null and d.lease_until > now()) then
    return null;
  end if;
  update
    public.ios_beta_deliveries
  set
    lease_token = p_token,
    lease_until = now() + interval '45 seconds',
    updated_at = now()
  where
    id = p_id
  returning
    * into d;
  return to_jsonb (d);
end
$$;

create function public.prepare_ios_beta_delivery (p_id uuid, p_token uuid, p_payload text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  d public.ios_beta_deliveries;
begin
  select
    * into d
  from
    public.ios_beta_deliveries
  where
    id = p_id
  for update;
  if not found or d.lease_token is distinct from p_token or d.lease_until <= now() then
    raise exception 'beta lease lost';
  end if;
  -- Reserve the final minute for network transit before provider key expiry.
  if d.first_attempt_at is not null and d.first_attempt_at <= now() - interval '23 hours 59 minutes' then
    raise exception 'beta idempotency expired';
  end if;
  if d.create_payload is not null and d.create_payload is distinct from p_payload then
    raise exception 'beta payload changed';
  end if;
  if p_payload is null or jsonb_typeof(p_payload::jsonb) <> 'object' then
    raise exception 'invalid beta payload';
  end if;
  update
    public.ios_beta_deliveries
  set
    create_payload = coalesce(create_payload, p_payload),
    first_attempt_at = coalesce(first_attempt_at, now()),
    last_attempt_at = now(),
    attempt_count = attempt_count + 1,
    state = 'unknown',
    error_code = 'provider_unconfirmed',
    updated_at = now()
  where
    id = p_id
  returning
    * into d;
  return to_jsonb (d);
end
$$;

create function public.finish_ios_beta_delivery (p_id uuid, p_token uuid, p_state text, p_provider_id text, p_error text)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  d public.ios_beta_deliveries;
begin
  select
    * into d
  from
    public.ios_beta_deliveries
  where
    id = p_id
  for update;
  if not found or d.lease_token is distinct from p_token then
    return false;
  end if;
  if d.provider_email_id is not null and p_provider_id is not null and d.provider_email_id <> p_provider_id then
    raise exception 'beta provider identity conflict';
  end if;
  update
    public.ios_beta_deliveries
  set
    state = public.beta_delivery_merge (state, p_state),
    provider_email_id = coalesce(provider_email_id, p_provider_id),
    error_code = p_error,
    early_applied_at = case when p_state = 'sending' then
      coalesce(early_applied_at, now())
    else
      early_applied_at
    end,
    lease_token = null,
    lease_until = null,
    updated_at = now()
  where
    id = p_id;
  return true;
end
$$;

create function public.request_ios_beta_early_send (p_request_id uuid, p_actor uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
  as $$
begin
  -- The browser never calls this service-only function. Verify the actual user,
  -- not an actor email supplied in the request body.
  if not exists (
    select
      1
    from
      auth.users
    where
      id = p_actor
      and email in ('adilharis2001@gmail.com', 'aber97@gmail.com')) then
    raise exception 'admin required';
  end if;
  perform
    1
  from
    public.ios_beta_deliveries
  where
    request_id = p_request_id
    and kind = 'invite'
  for update;
  if not found then
    return false;
  end if;
  update
    public.ios_beta_requests
  set
    early_send_requested_at = coalesce(early_send_requested_at, now()),
    early_send_actor = coalesce(early_send_actor, p_actor)
  where
    id = p_request_id;
  update
    public.ios_beta_deliveries d
  set
    early_target_at = coalesce(d.early_target_at, least (r.scheduled_at, now() + interval '1 minute'))
  from
    public.ios_beta_requests r
  where
    r.id = p_request_id
    and d.request_id = r.id
    and d.kind = 'invite';
  return true;
end
$$;

-- Signed event ingestion is one transaction: failed writes cannot poison the
-- dedupe set. A signed delivery tag correlates an event before its POST returns.
create function public.apply_resend_beta_event (p_event_id text, p_event jsonb)
  returns uuid[]
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  t text := p_event ->> 'type';
  mid text := p_event #>> '{data,email_id}';
  tag text;
  sid uuid;
  st text;
  v_recipient text;
  ids uuid[] := '{}';
  d public.ios_beta_deliveries;
  event_time timestamptz;
begin
  insert into public.resend_events (event_id, type)
    values (p_event_id, coalesce(t, 'unknown'))
  on conflict
    do nothing;
  if not found then
    return array ( select distinct
        request_id
      from
        public.ios_beta_deliveries
      where
        cancel_requested
        and state not in ('sent', 'delivered', 'bounced', 'complained', 'suppressed', 'canceled')
        and recipient in (
          select
            lower(btrim(value))
          from
            jsonb_array_elements_text(coalesce(p_event #> '{data,to}', '[]'))));
  end if;
  if t = 'email.complained' or (t = 'email.bounced' and lower(p_event #>> '{data,bounce,type}') = 'permanent') then
    for v_recipient in
    select
      lower(btrim(value))
    from
      jsonb_array_elements_text(coalesce(p_event #> '{data,to}', '[]'))
      loop
        if v_recipient = '' then
          continue;
        end if;
        if t = 'email.complained' then
          insert into public.email_suppressions (address, reason, detail, message_id)
            values (v_recipient, 'complained', p_event #>> '{data,complaint,message}', mid)
          on conflict (address)
            do update set
              reason = 'complained', detail = excluded.detail, message_id = excluded.message_id, updated_at = now();
        else
          insert into public.email_suppressions (address, reason, detail, message_id)
            values (v_recipient, 'bounced', concat_ws(' / ', p_event #>> '{data,bounce,type}', p_event #>> '{data,bounce,subType}', p_event #>> '{data,bounce,message}'), mid)
          on conflict (address)
            do nothing;
        end if;
        update
          public.ios_beta_deliveries
        set
          cancel_requested = true,
          updated_at = now()
        where
          ios_beta_deliveries.recipient = v_recipient
          and state not in ('sent', 'delivered', 'bounced', 'complained', 'suppressed', 'canceled');
        ids := ids || array ( select distinct
            request_id
          from
            public.ios_beta_deliveries
          where
            ios_beta_deliveries.recipient = v_recipient
            and cancel_requested);
      end loop;
  end if;
  st := case t
  when 'email.scheduled' then
    'scheduled'
  when 'email.sent' then
    'sent'
  when 'email.delivered' then
    'delivered'
  when 'email.failed' then
    'failed'
  when 'email.canceled' then
    'canceled'
  when 'email.bounced' then
    'bounced'
  when 'email.complained' then
    'complained'
  else
    null
  end;
  if st is null or mid is null then
    return ids;
  end if;
  -- Resend sends tags as an object in webhook data (also accept array form).
  if jsonb_typeof(p_event #> '{data,tags}') = 'object' then
    tag := p_event #>> '{data,tags,beta_delivery_id}';
  elsif jsonb_typeof(p_event #> '{data,tags}') = 'array' then
    select
      x ->> 'value' into tag
    from
      jsonb_array_elements(p_event #> '{data,tags}') x
    where
      x ->> 'name' = 'beta_delivery_id'
    limit 1;
  end if;
  if tag ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    sid := tag::uuid;
  end if;
  select
    * into d
  from
    public.ios_beta_deliveries
  where
    provider_email_id = mid
    or (id = sid
      and provider_email_id is null
      and first_attempt_at is not null)
  for update;
  if not found then
    return ids;
  end if;
  event_time := coalesce((p_event ->> 'created_at')::timestamptz, now());
  if d.evidence_at is null or event_time >= d.evidence_at or st in ('bounced', 'complained') then
    update
      public.ios_beta_deliveries
    set
      provider_email_id = coalesce(provider_email_id, mid),
      state = public.beta_delivery_merge (state, st),
      evidence_at = greatest (evidence_at, event_time),
      error_code = case when st in ('failed', 'bounced', 'complained', 'canceled') then
        'provider_' || st
      else
        null
      end,
      updated_at = now()
    where
      id = d.id;
  end if;
  return ids;
end
$$;

revoke all on function public.initialize_ios_beta_delivery (), public.claim_ios_beta_request_v2 (text, text, jsonb), public.beta_delivery_merge (text, text), public.mirror_ios_beta_delivery (), public.lease_ios_beta_delivery (uuid, uuid), public.prepare_ios_beta_delivery (uuid, uuid, text), public.finish_ios_beta_delivery (uuid, uuid, text, text, text), public.request_ios_beta_early_send (uuid, uuid), public.apply_resend_beta_event (text, jsonb) from public, anon, authenticated;

grant execute on function public.claim_ios_beta_request_v2 (text, text, jsonb), public.lease_ios_beta_delivery (uuid, uuid), public.prepare_ios_beta_delivery (uuid, uuid, text), public.finish_ios_beta_delivery (uuid, uuid, text, text, text), public.request_ios_beta_early_send (uuid, uuid), public.apply_resend_beta_event (text, jsonb) to service_role;
