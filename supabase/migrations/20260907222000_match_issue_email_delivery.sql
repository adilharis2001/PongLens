-- Saved event semantics and recoverable, receipt-backed email attempts.
alter table public.match_issue_email_deliveries
  add column send_payload text,
  add column first_attempt_at timestamptz,
  add column lease_until timestamptz,
  add column idempotency_key text generated always as ('match-issue-' || id::text) stored;
alter table public.match_issue_email_deliveries drop constraint match_issue_email_deliveries_state_check;
alter table public.match_issue_email_deliveries add constraint match_issue_email_deliveries_state_check
  check (state in ('prepared','sending','accepted','delivered','suppressed','failed','needs_attention'));
create unique index match_issue_email_provider_id_idx
  on public.match_issue_email_deliveries(provider_email_id) where provider_email_id is not null;

-- Do not replay any old ambiguous attempt with newly rendered bytes. Provider
-- acceptance may have preceded a failed bookkeeping write in the old sender.
update public.match_issue_email_deliveries set state='needs_attention',
  provider_error='An earlier send has no provider receipt. Review before retrying.'
where state in ('sending','failed') and attempt_count>0 and provider_email_id is null;
update public.match_issue_email_deliveries d set state='suppressed'
from public.match_processing_feedback_events e
where e.id=d.event_id and e.kind in ('reprocess_queued','reprocessing','candidate_ready')
  and d.state='prepared' and d.attempt_count=0;

create function public.claim_match_issue_email_delivery(p_delivery_id uuid,p_payload text)
returns text language plpgsql security definer set search_path=public as $$
declare d public.match_issue_email_deliveries;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_payload is null or length(p_payload)>200000 or jsonb_typeof(p_payload::jsonb)<>'object' then
    raise exception 'invalid email payload' using errcode='23514';
  end if;
  select * into d from public.match_issue_email_deliveries where id=p_delivery_id for update;
  if not found or d.provider_email_id is not null or d.state not in ('prepared','failed','sending')
    or d.lease_until>now() then return null; end if;
  -- Like the existing beta sender, stop inside the provider's 24-hour key
  -- lifetime. Leave one hour of margin; old uncertain sends need review.
  if d.attempt_count>=10 or d.first_attempt_at<=now()-interval '23 hours' then
    update public.match_issue_email_deliveries set state='needs_attention',lease_until=null,
      provider_error='Provider acceptance is unconfirmed. Review before retrying.',updated_at=now() where id=d.id;
    return null;
  end if;
  update public.match_issue_email_deliveries set state='sending',
    send_payload=coalesce(send_payload,p_payload),first_attempt_at=coalesce(first_attempt_at,now()),
    last_attempt_at=now(),lease_until=now()+interval '2 minutes',attempt_count=attempt_count+1,updated_at=now()
    where id=d.id returning send_payload into p_payload;
  return p_payload;
end $$;

create function public.finish_match_issue_email_attempt(p_delivery_id uuid,p_state text,p_error text,p_provider_id text)
returns void language plpgsql security definer set search_path=public as $$
declare d public.match_issue_email_deliveries;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_state is null or p_state not in ('accepted','suppressed','failed') or length(coalesce(p_error,''))>1000
    or (p_state='accepted' and nullif(p_provider_id,'') is null) then
    raise exception 'invalid email receipt' using errcode='23514';
  end if;
  select * into d from public.match_issue_email_deliveries where id=p_delivery_id for update;
  if not found then raise exception 'delivery not found' using errcode='P0002'; end if;
  if d.provider_email_id is not null and p_provider_id is not null and d.provider_email_id<>p_provider_id then
    raise exception 'provider receipt changed' using errcode='23514';
  end if;
  -- Webhook evidence outranks a delayed sender result, including late failures.
  if d.provider_email_id is not null or d.state in ('accepted','delivered','suppressed') then return; end if;
  if d.state='needs_attention' and p_provider_id is null then return; end if;
  -- Pre-send context errors have no claim, but must still have a bounded retry
  -- budget. Claimed attempts already incremented the counter before the POST.
  if d.state<>'sending' and p_state='failed' then d.attempt_count:=d.attempt_count+1; end if;
  update public.match_issue_email_deliveries set state=case when p_state='failed' and d.attempt_count>=10 then 'needs_attention' else p_state end,
    attempt_count=d.attempt_count,provider_email_id=p_provider_id,
    provider_error=nullif(p_error,''),lease_until=null,updated_at=now() where id=d.id;
end $$;

-- One signed webhook transaction still runs existing beta delivery/suppression
-- behavior, then reconciles this outbox. A tag recovers a lost HTTP receipt.
create function public.apply_resend_event(p_event_id text,p_event jsonb)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare ids uuid[]; t text:=p_event->>'type'; mid text:=p_event#>>'{data,email_id}';
  tag text; sid uuid; d public.match_issue_email_deliveries; event_time timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  ids:=public.apply_resend_beta_event(p_event_id,p_event);
  if t is null or t not in ('email.sent','email.delivered','email.failed','email.bounced','email.complained') or nullif(mid,'') is null then return ids; end if;
  if jsonb_typeof(p_event#>'{data,tags}')='object' then tag:=p_event#>>'{data,tags,match_issue_delivery_id}';
  elsif jsonb_typeof(p_event#>'{data,tags}')='array' then
    select x->>'value' into tag from jsonb_array_elements(p_event#>'{data,tags}') x where x->>'name'='match_issue_delivery_id' limit 1;
  end if;
  if tag~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then sid:=tag::uuid; end if;
  select * into d from public.match_issue_email_deliveries
    where provider_email_id=mid or (id=sid and provider_email_id is null and first_attempt_at is not null) for update;
  if not found then return ids; end if;
  event_time:=coalesce((p_event->>'created_at')::timestamptz,now());
  update public.match_issue_email_deliveries set provider_email_id=mid,
    state=case when d.state='delivered' or t='email.delivered' then 'delivered'
      when t in ('email.failed','email.bounced','email.complained') then 'failed'
      when d.state='failed' and d.provider_email_id is not null then 'failed' else 'accepted' end,
    delivered_at=case when t='email.delivered' then coalesce(d.delivered_at,event_time) else d.delivered_at end,
    provider_error=case when d.state='delivered' or t='email.delivered' then null
      when t in ('email.failed','email.bounced','email.complained') then t else d.provider_error end,
    lease_until=null,updated_at=now() where id=d.id;
  return ids;
end $$;

revoke all on function public.claim_match_issue_email_delivery(uuid,text),public.finish_match_issue_email_attempt(uuid,text,text,text),public.apply_resend_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_match_issue_email_delivery(uuid,text),public.finish_match_issue_email_attempt(uuid,text,text,text),public.apply_resend_event(text,jsonb) to service_role;

create or replace function public.record_match_version_event(p_issue_id uuid,p_kind text,p_player_note text,p_internal_note text,p_metadata jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; v_event uuid; v_title text;
begin
  select * into i from public.match_processing_feedback where id=p_issue_id;
  insert into public.match_processing_feedback_events(issue_id,actor_id,kind,player_note,internal_note,metadata)
    values(i.id,auth.uid(),p_kind,coalesce(p_player_note,''),coalesce(p_internal_note,''),coalesce(p_metadata,'{}')) returning id into v_event;
  if p_kind in ('candidate_ready','execution_failed') then
    insert into public.notifications(user_id,kind,match_id,actor_id,title,body,href)
      select id,case when p_kind='candidate_ready' then 'match_reprocess_ready' else 'match_reprocess_failed' end,
        i.match_id,auth.uid(),case when p_kind='candidate_ready' then 'Match version ready for review' else 'Match reprocessing failed' end,
        null,'/admin/issues/'||i.id from auth.users where lower(email)='adilharis2001@gmail.com';
  end if;
  if p_kind<>'candidate_ready' then
    v_title:=case p_kind when 'reprocess_queued' then 'Match reprocessing queued'
      when 'restored' then 'Previous match version restored' when 'kept_current' then 'Current match version kept'
      when 'published' then 'A new match version is ready' when 'execution_failed' then 'Reprocessing needs another review'
      else 'Match reprocessing reviewed' end;
    insert into public.notifications(user_id,kind,match_id,actor_id,title,body,href)
      values(i.owner_id,'match_issue_updated',i.match_id,auth.uid(),v_title,nullif(p_player_note,''),'/match/'||i.match_id||'/feedback');
  end if;
  if p_kind in ('published','restored','kept_current','declined','refunded','execution_failed') then
    insert into public.match_issue_email_deliveries(issue_id,event_id,template,recipient_email)
      select i.id,v_event,'resolution',email from auth.users where id=i.owner_id and email is not null;
  end if;
end $$;
revoke all on function public.record_match_version_event(uuid,text,text,text,jsonb) from public,anon,authenticated;
