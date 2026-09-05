-- Purchases may pause while the existing usage limits remain enforced.
insert into public.app_config (key, value) values ('purchases_enabled', 'false')
on conflict (key) do nothing;
insert into public.app_config (key, value) values ('commerce_enabled', 'true')
on conflict (key) do update set value = excluded.value;

-- This policy adds exactly one public feature flag without replacing the
-- existing allow-list (or making admin identities public).
create policy "Purchase switch is readable" on public.app_config
for select using (key = 'purchases_enabled');

create or replace function public.set_purchases_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'invalid_input' using errcode = '23514'; end if;
  update public.app_config set value = p_enabled::text where key = 'purchases_enabled';
  -- Changing purchase availability must never turn off minute accounting.
  update public.app_config set value = 'true' where key = 'commerce_enabled';
end;
$$;
revoke all on function public.set_purchases_enabled(boolean) from public, anon;
grant execute on function public.set_purchases_enabled(boolean) to authenticated;

-- Both Stripe and Apple create a row here before asking for payment.
-- Fulfillment is deliberately unaffected: already-paid purchases are owed.
create or replace function public.guard_platform_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('minute_pack', 'storage') and
     coalesce((select value from public.app_config where key = 'purchases_enabled'), 'false') <> 'true' then
    raise exception 'purchases_disabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_platform_purchase() from public, anon, authenticated;
create trigger platform_purchase_beta_gate before insert on public.platform_purchases
for each row execute function public.guard_platform_purchase();

alter table public.quota_requests
  add column resource text not null default 'storage' check (resource in ('storage', 'minutes')),
  add column granted_amount integer,
  add column decision_note text not null default '';

-- Preserve legacy rows; new requests are serialized by user instead of
-- adding a uniqueness constraint that could invalidate historical duplicates.
revoke insert, update, delete on public.quota_requests from authenticated;

create table public.allowance_email_deliveries (
  request_id uuid not null references public.quota_requests(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  primary key (request_id, recipient_id)
);
alter table public.allowance_email_deliveries enable row level security;
revoke all on public.allowance_email_deliveries from anon, authenticated;
grant all on public.allowance_email_deliveries to service_role;

-- Append two kinds without dropping any notification types added elsewhere.
do $$
declare v_check text;
begin
  select pg_get_expr(conbin, conrelid) into v_check from pg_constraint
  where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check check ((' ||
    v_check || ') or kind in (''allowance_request'', ''allowance_decided''))';
end;
$$;

create or replace function public.request_allowance(p_resource text, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_name text; v_admin record;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_resource is null or p_resource not in ('storage', 'minutes') or length(coalesce(p_message, '')) > 1000 then
    raise exception 'invalid_input' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_me::text || ':allowance', 0));
  select id into v_id from public.quota_requests
  where user_id = v_me and resource = p_resource and status = 'pending'
  order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.quota_requests
      where user_id = v_me and created_at > now() - interval '24 hours') >= 4 then
    raise exception 'request_limit' using errcode = 'P0001';
  end if;
  insert into public.quota_requests (user_id, resource, message)
  values (v_me, p_resource, trim(coalesce(p_message, ''))) returning id into v_id;
  select coalesce(public._display_name(u.*), u.email) into v_name from auth.users u where id = v_me;
  for v_admin in select id from auth.users
    where lower(email) in ('adilharis2001@gmail.com', 'aber97@gmail.com')
  loop
    insert into public.notifications (user_id, kind, actor_id, title, body, href)
    values (v_admin.id, 'allowance_request', v_me,
      'More ' || p_resource || ' requested', v_name || ' requested a larger allowance.',
      '/admin/commerce#requests');
    insert into public.allowance_email_deliveries (request_id, recipient_id)
    values (v_id, v_admin.id);
  end loop;
  return v_id;
end;
$$;
revoke all on function public.request_allowance(text, text) from public, anon;
grant execute on function public.request_allowance(text, text) to authenticated;

create or replace function public.admin_allowance_players(p_search text default '')
returns table (user_id uuid, email text, name text, minutes_balance integer, storage_limit_bytes bigint, used_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select u.id, u.email::text, public._display_name(u.*),
    public._processing_balance(u.id, case when public.is_qa(u.id) then 'test' else 'live' end) +
      case when exists (select 1 from public.processing_ledger l where l.user_id = u.id
        and l.kind = 'grant' and l.billing_mode = case when public.is_qa(u.id) then 'test' else 'live' end)
      then 0 else public._commerce_int('free_processing_minutes', 250) end,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes()) +
      coalesce((select sum(e.bytes) from public.storage_entitlements e where e.user_id = u.id
        and e.expires_at > now()), 0)::bigint,
    greatest(coalesce((select sum(l.bytes) from public.storage_ledger l
      left join public.review_orders o on o.id = l.order_id
      where l.user_id = u.id and (l.r2_key like 'r2://ponglens-raw/%' or l.kind = 'cut')
      and (o.id is null or o.status not in ('awaiting_submission', 'submitted', 'in_review', 'clarification', 'delivered'))), 0), 0)::bigint
  from auth.users u left join public.user_quotas q on q.user_id = u.id
  where coalesce(u.email, '') ilike '%' || trim(coalesce(p_search, '')) || '%'
     or coalesce(public._display_name(u.*), '') ilike '%' || trim(coalesce(p_search, '')) || '%'
  order by u.last_sign_in_at desc nulls last, u.id limit 30;
end;
$$;
revoke all on function public.admin_allowance_players(text) from public, anon;
grant execute on function public.admin_allowance_players(text) to authenticated;

create or replace function public.admin_allowance_requests()
returns table (id uuid, user_id uuid, email text, name text, resource text, message text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select r.id, r.user_id, u.email::text, public._display_name(u.*), r.resource, r.message, r.created_at
  from public.quota_requests r join auth.users u on u.id = r.user_id
  where r.status = 'pending' order by r.created_at;
end;
$$;
revoke all on function public.admin_allowance_requests() from public, anon;
grant execute on function public.admin_allowance_requests() to authenticated;

-- One transaction: recheck authority, lock the request, grant and decide.
-- Two admins approving the same request can never grant it twice.
create or replace function public.admin_resolve_allowance(
  p_user_id uuid, p_resource text, p_amount integer,
  p_request_id uuid default null, p_decline boolean default false, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; v_mode text; v_request public.quota_requests; v_result jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_resource is null or p_resource not in ('minutes', 'storage') or p_decline is null
    or length(coalesce(p_note, '')) > 1000 then raise exception 'invalid_input' using errcode = '23514'; end if;
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_request_id is not null then
    select * into v_request from public.quota_requests where id = p_request_id for update;
    if not found or v_request.user_id <> p_user_id or v_request.resource <> p_resource then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if v_request.status <> 'pending' then raise exception 'already_decided' using errcode = 'P0001'; end if;
  elsif p_decline then raise exception 'invalid_input' using errcode = '23514';
  end if;
  if not p_decline then
    if p_amount is null or p_amount < 1 or p_amount > (case when p_resource = 'storage' then 1024 else 100000 end) then
      raise exception 'invalid_input' using errcode = '23514';
    end if;
    if p_resource = 'minutes' then
      v_mode := case when public.is_qa(p_user_id) then 'test' else 'live' end;
      perform public._ensure_processing_grant(p_user_id, v_mode);
      v_result := public.admin_grant_minutes(v_email, p_amount, p_note);
    else
      -- Beta storage grants increase the base allowance without an expiry.
      perform public._ensure_quota(p_user_id);
      update public.user_quotas set storage_limit_bytes = storage_limit_bytes + p_amount::bigint * 1073741824
      where user_id = p_user_id;
      v_result := jsonb_build_object('user_id', p_user_id, 'added_gb', p_amount);
    end if;
  end if;
  if p_request_id is not null then
    update public.quota_requests set status = case when p_decline then 'denied' else 'granted' end,
      decided_by = auth.uid(), decided_at = now(), granted_amount = case when not p_decline then p_amount end,
      decision_note = trim(coalesce(p_note, '')) where id = p_request_id;
  end if;
  insert into public.notifications (user_id, kind, actor_id, title, body, href)
  values (p_user_id, 'allowance_decided', auth.uid(),
    case when p_decline then 'Your allowance request was reviewed' else 'Your allowance has increased' end,
    case when p_decline then 'We could not increase your allowance this time.'
      else p_amount || case when p_resource = 'storage' then ' GB of storage' else ' processing minutes' end || ' added to your account.' end ||
      case when length(trim(coalesce(p_note, ''))) > 0 then ' ' || trim(p_note) else '' end,
    '/account#' || p_resource);
  return coalesce(v_result, '{}'::jsonb);
end;
$$;
revoke all on function public.admin_resolve_allowance(uuid, text, integer, uuid, boolean, text) from public, anon;
grant execute on function public.admin_resolve_allowance(uuid, text, integer, uuid, boolean, text) to authenticated;

-- Keep the old storage-only admin view from acting on minute requests.
do $$
declare v_sql text;
begin
  select pg_get_functiondef('public.admin_quota_requests()'::regprocedure) into v_sql;
  if position('where r.status = ''pending''' in v_sql) = 0 then raise exception 'unexpected quota function'; end if;
  execute replace(v_sql, 'where r.status = ''pending''', 'where r.status = ''pending'' and r.resource = ''storage''');
end;
$$;
