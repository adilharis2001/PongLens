-- A source job may have more than one personal spend. Return the same live
-- total the admin queue/detail display, preserving each ledger row's facts.
create or replace function public.admin_refund_match_issue(p_issue_id uuid,p_player_note text,p_internal_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  i public.match_processing_feedback;
  returned_minutes integer;
  reversed_ids bigint[];
  event_id uuid;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_player_note,''))) not between 1 and 1000 or length(coalesce(p_internal_note,''))>4000 then
    raise exception 'invalid input' using errcode='23514';
  end if;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  if i.status='resolved_refunded' then return public.admin_match_issue_detail(i.id); end if;
  if i.kind not in ('refund','reprocess') or i.status not in ('pending','candidate_ready','execution_failed') then
    raise exception 'already decided' using errcode='P0001';
  end if;
  perform 1 from public.matches where id=i.match_id for update;
  if i.source_job_id is null then raise exception 'nothing to refund' using errcode='P0001'; end if;
  if i.replacement_version_id is not null then
    perform 1 from public.match_processing_versions where id=i.replacement_version_id and match_id=i.match_id and issue_id=i.id and status in ('ready','failed') for update;
    if not found then raise exception 'already decided' using errcode='P0001'; end if;
    perform 1 from public.jobs where id=i.replacement_job_id and status in ('done','failed') for update;
    if not found then raise exception 'already decided' using errcode='P0001'; end if;
  end if;

  with eligible as materialized (
    select spend.* from public.processing_ledger spend
    where spend.user_id=i.owner_id and spend.match_id=i.match_id and spend.job_id=i.source_job_id
      and spend.kind='spend' and spend.funding='personal' and spend.minutes<0
      and not exists(select 1 from public.processing_ledger refund where refund.kind='refund' and refund.reverses_id=spend.id)
    order by spend.id for update of spend
  ), returned as (
    insert into public.processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id,order_id,purchase_id,note,reverses_id)
    select user_id,-minutes,'refund',funding,billing_mode,match_id,job_id,order_id,purchase_id,'bad cut refund',id from eligible
    on conflict (reverses_id) where kind='refund' do nothing
    returning minutes,reverses_id
  )
  select coalesce(sum(minutes),0)::integer,array_agg(reverses_id order by reverses_id)
    into returned_minutes,reversed_ids from returned;
  -- A worker/manual reversal may win its unique-ledger race. Never report
  -- money from an attempted insert: only rows actually returned above count.
  if returned_minutes=0 then raise exception 'nothing to refund' using errcode='P0001'; end if;

  update public.match_processing_versions set status='superseded',superseded_at=now() where id=i.replacement_version_id and status='ready';
  update public.match_processing_feedback set status='resolved_refunded',resolution='refund',refundable_minutes=returned_minutes,
    player_note=trim(p_player_note),internal_note=trim(coalesce(p_internal_note,'')),decided_by=auth.uid(),decided_at=now(),updated_at=now()
    where id=i.id returning * into i;
  insert into public.match_processing_feedback_events(issue_id,actor_id,kind,player_note,internal_note,metadata)
    values(i.id,auth.uid(),'refunded',i.player_note,i.internal_note,jsonb_build_object('minutes',returned_minutes,'reversesIds',reversed_ids)) returning id into event_id;
  insert into public.notifications(user_id,kind,match_id,actor_id,title,body,href)
    values(i.owner_id,'match_issue_updated',i.match_id,auth.uid(),'Your processing minutes were returned',
      returned_minutes||' processing minutes were added back. '||i.player_note,'/match/'||i.match_id||'/feedback');
  insert into public.match_issue_email_deliveries(issue_id,event_id,template,recipient_email)
    select i.id,event_id,'resolution',email from auth.users where id=i.owner_id and email is not null;
  return public.admin_match_issue_detail(i.id);
end $$;
revoke all on function public.admin_refund_match_issue(uuid,text,text) from public,anon;
grant execute on function public.admin_refund_match_issue(uuid,text,text) to authenticated;
