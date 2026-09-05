-- Run against an isolated database after 172. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into public.app_config (key,value) values
 ('commerce_enabled','true'), ('free_processing_minutes','250'),
 ('default_storage_bytes','10737418240'),
 ('minute_packs','[{"key":"m60","minutes":60,"price_cents":500}]'),
 ('storage_packs','[{"key":"s100","gb":100,"months":12,"price_cents":2000}]')
on conflict (key) do update set value=excluded.value;
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','beta-fixture@example.com','{"full_name":"Beta Player"}'),
 ('22222222-2222-4222-8222-222222222222','adilharis2001@gmail.com','{}'),
 ('33333333-3333-4333-8333-333333333333','aber97@gmail.com','{}');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","email":"beta-fixture@example.com","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r uuid; r2 uuid;
begin
  begin
    perform public.create_platform_purchase('minute_pack','m60');
    raise exception 'FAIL: purchase allowed during beta';
  exception when raise_exception then
    if sqlerrm <> 'purchases_disabled' then raise; end if;
  end;
  begin
    perform public.create_platform_purchase('storage','s100');
    raise exception 'FAIL: storage purchase allowed during beta';
  exception when raise_exception then
    if sqlerrm <> 'purchases_disabled' then raise; end if;
  end;
  r := public.request_allowance('minutes','Tournament this weekend');
  r2 := public.request_allowance('minutes','Retry');
  if r <> r2 then raise exception 'FAIL: duplicate request'; end if;
  perform public.request_allowance('storage','Need more space');
  if (select count(*) from public.quota_requests) <> 2 then raise exception 'FAIL: own pending requests'; end if;
  begin
    perform public.set_purchases_enabled(true);
    raise exception 'FAIL: player changed switch';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_resolve_allowance(auth.uid(),'minutes',10);
    raise exception 'FAIL: player granted self minutes';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.quota_requests(user_id,resource,status) values(auth.uid(),'minutes','granted');
    raise exception 'FAIL: direct request forgery';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_allowance_players('');
    raise exception 'FAIL: player read admin roster';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
do $$
begin
 if (select count(*) from public.notifications where kind='allowance_request') <> 4 then raise exception 'FAIL: both admins were not notified'; end if;
 if (select count(*) from public.allowance_email_deliveries) <> 4 then raise exception 'FAIL: email recipients'; end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","email":"aber97@gmail.com","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r uuid; before_balance integer; after_balance integer;
begin
  if (select count(*) from public.admin_allowance_players('Beta Player')) <> 1 then raise exception 'FAIL: player name search'; end if;
  if (select count(*) from public.admin_allowance_requests()) <> 2 then raise exception 'FAIL: admin queue'; end if;
  select id into r from public.quota_requests where resource='minutes';
  perform public.admin_resolve_allowance('11111111-1111-4111-8111-111111111111','minutes',60,r);
  select minutes_balance into after_balance from public.admin_allowance_players('beta-fixture@example.com');
  if after_balance <> 310 then raise exception 'FAIL: grant balance %', after_balance; end if;
  begin
    perform public.admin_resolve_allowance('11111111-1111-4111-8111-111111111111','minutes',60,r);
    raise exception 'FAIL: double grant';
  exception when raise_exception then
    if sqlerrm <> 'already_decided' then raise; end if;
  end;
  select id into r from public.quota_requests where resource='storage';
  begin
    perform public.admin_resolve_allowance('11111111-1111-4111-8111-111111111111','minutes',60,r);
    raise exception 'FAIL: wrong resource granted';
  exception when no_data_found then null; end;
  perform public.admin_resolve_allowance('11111111-1111-4111-8111-111111111111','storage',10,r);
  if (select storage_limit_bytes from public.admin_allowance_players('beta-fixture@example.com')) <> 21474836480 then
    raise exception 'FAIL: storage increase';
  end if;
  perform public.set_purchases_enabled(true);
  if (select value from public.app_config where key='commerce_enabled') <> 'true' then raise exception 'FAIL: metering turned off'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","email":"beta-fixture@example.com","role":"authenticated"}', true);
set local role authenticated;
select public.create_platform_purchase('minute_pack','m60');
select public.create_platform_purchase('storage','s100');
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","email":"adilharis2001@gmail.com","role":"authenticated"}', true);
set local role authenticated;
select public.set_purchases_enabled(false);
reset role;
do $$
begin
 if not public._commerce_on() then raise exception 'FAIL: pausing purchases disabled metering'; end if;
 if (select count(*) from public.notifications where kind='allowance_decided') <> 2 then raise exception 'FAIL: player notifications'; end if;
end;
$$;
insert into public.matches(id,user_id,status,raw_path,duration_s)
values ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','uploaded',
 'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/test.mp4',600);
insert into public.processing_ledger(user_id,minutes,kind,funding,billing_mode,note)
values ('11111111-1111-4111-8111-111111111111',-310,'adjust','personal','live','Test exhausted balance');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","email":"beta-fixture@example.com","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.claim_processing('44444444-4444-4444-8444-444444444444');
    raise exception 'FAIL: exhausted allowance allowed processing';
  exception when raise_exception then
    if sqlerrm <> 'insufficient_minutes' then raise; end if;
  end;
end;
$$;
rollback;
