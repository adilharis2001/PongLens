-- Behaviour of 20260925061009_device_hand_cut.sql, on an isolated database
-- built by device_hand_cut_stubs.sql (the header there has the commands).
-- Every fixture rolls back. A failure raises 'FAIL: ...'.
\set ON_ERROR_STOP on

create function pg_temp.act(p_user uuid, p_admin boolean default false)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated',
                       'admin', case when p_admin then 'true' else 'false' end)::text,
    true)
$$;

-- Twenty marks over a 300 s video, the short form claim_hand_cut is sent.
create function pg_temp.marks(n integer default 20) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('t0', 5 + 8 * i, 't1', 9 + 8 * i,
                                      'w', 'user', 'let', false, 'star', false,
                                      'tap', 5.9 + 8 * i, 'rate', 1.5)
                   order by i)
    from generate_series(0, n - 1) as i
$$;

begin;
insert into public.app_config (key, value) values ('hand_cut', 'off'),
  ('reclip_lane', 'fast')
  on conflict (key) do update set value = excluded.value;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'player@example.com');
insert into public.matches (id, user_id, raw_path, duration_s, content_checked_at,
                            original_name, active_processing_version_id)
select ('cccccccc-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 9 then 'bbbbbbbb-0000-4000-8000-000000000002'::uuid
            else 'aaaaaaaa-0000-4000-8000-000000000001'::uuid end,
       case when n = 9 then 'r2://ponglens-raw/bbbbbbbb-0000-4000-8000-000000000002/v.mov'
            else 'r2://ponglens-raw/aaaaaaaa-0000-4000-8000-000000000001/v' || n || '.mov' end,
       case when n = 8 then 1000 else 300 end, now(), 'v' || n || '.mov', gen_random_uuid()
  from generate_series(1, 9) as n;

do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  player uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  m1 uuid := 'cccccccc-0000-4000-8000-000000000001';
  m2 uuid := 'cccccccc-0000-4000-8000-000000000002';
  m3 uuid := 'cccccccc-0000-4000-8000-000000000003';
  m4 uuid := 'cccccccc-0000-4000-8000-000000000004';
  m5 uuid := 'cccccccc-0000-4000-8000-000000000005';
  m6 uuid := 'cccccccc-0000-4000-8000-000000000006';
  m7 uuid := 'cccccccc-0000-4000-8000-000000000007';
  m8 uuid := 'cccccccc-0000-4000-8000-000000000008';
  m9 uuid := 'cccccccc-0000-4000-8000-000000000009';
  r jsonb;
  j uuid;
  j2 uuid;
  v public.jobs%rowtype;
  sent integer;
begin
  -- ------------------------------------------------------------ the switch
  if (select value from public.app_config where key = 'device_hand_cut') <> 'admins' then
    raise exception 'FAIL: device_hand_cut not seeded admins';
  end if;
  perform pg_temp.act(admin, true);
  if not public.device_hand_cut_enabled(admin) then
    raise exception 'FAIL: admins value refuses an admin';
  end if;
  perform pg_temp.act(player, false);
  if public.device_hand_cut_enabled(player) then
    raise exception 'FAIL: admins value lets a player in';
  end if;
  begin
    perform public.claim_device_hand_cut(m9, pg_temp.marks());
    raise exception 'FAIL: player claimed a phone cut';
  exception when insufficient_privilege then
    if sqlerrm <> 'not_enabled' then raise; end if;
  end;
  update public.app_config set value = 'on' where key = 'device_hand_cut';
  update public.app_config set value = 'user:' || player where key = 'hand_cut';
  if not public.device_hand_cut_enabled(player) then
    raise exception 'FAIL: on does not follow hand_cut_enabled';
  end if;
  update public.app_config set value = 'off' where key = 'hand_cut';
  update public.app_config set value = 'off' where key = 'device_hand_cut';
  perform pg_temp.act(admin, true);
  begin
    perform public.claim_device_hand_cut(m1, pg_temp.marks());
    raise exception 'FAIL: off still claims';
  exception when insufficient_privilege then
    if sqlerrm <> 'not_enabled' then raise; end if;
  end;
  update public.app_config set value = 'admins' where key = 'device_hand_cut';

  -- ------------------------------------------------------------- the claim
  select count(*) into sent from pgmq.sent;
  r := public.claim_device_hand_cut(m1, pg_temp.marks());
  j := (r->>'job_id')::uuid;
  if (select count(*) from pgmq.sent) <> sent then
    raise exception 'FAIL: a phone cut was queued';
  end if;
  select * into v from public.jobs where id = j;
  if v.status <> 'processing' or v.kind <> 'hand_cut'
     or v.options->>'cutter' <> 'device' or v.options->>'phase' <> 'device'
     or (v.options->>'device_points')::int <> 20
     or v.options->>'originating_match_job_id' <> j::text
     or v.options->>'source' <> 'manual'
     or v.input_path <> 'r2://ponglens-raw/' || admin || '/v1.mov' then
    raise exception 'FAIL: phone job row %', row_to_json(v);
  end if;
  if (select job_id from public.matches where id = m1) <> j
     or (select cut_source from public.matches where id = m1) <> 'manual'
     or (select clip_pads from public.matches where id = m1) <> '{"pre": 1.2, "post": 1.3}'::jsonb
     or (select submitted_at from public.hand_cut_drafts where match_id = m1) is null then
    raise exception 'FAIL: claim did not freeze and link';
  end if;
  if r->'keys'->>'cut' <> 'results/' || admin || '/' || j || '.mp4'
     or r->'keys'->>'manifest' <> 'results/' || admin || '/' || j || '.manifest.json'
     or jsonb_array_length(r->'keys'->'clips') <> 20
     or r->'keys'->'clips'->>0 <> 'points/' || admin || '/' || m1 || '/01.mp4'
     or r->'keys'->'clips'->>19 <> 'points/' || admin || '/' || m1 || '/20.mp4'
     or r->>'bucket' <> 'ponglens-media' or (r->>'points')::int <> 20 then
    raise exception 'FAIL: claim keys %', r;
  end if;
  -- Three-digit clip names, as the Mac writes them.
  r := public.claim_device_hand_cut(m8, pg_temp.marks(105));
  if r->'keys'->'clips'->>99 not like '%/100.mp4'
     or r->'keys'->'clips'->>104 not like '%/105.mp4'
     or r->'keys'->'clips'->>8 not like '%/09.mp4' then
    raise exception 'FAIL: clip names %', r->'keys'->'clips';
  end if;
  -- Out of the way of the fairness cap (four active jobs) below.
  update public.jobs set status = 'done' where id = (r->>'job_id')::uuid;

  -- The Mac claim and a second phone claim both see it running.
  begin
    perform public.claim_hand_cut(m1, pg_temp.marks());
    raise exception 'FAIL: claimed over a phone cut';
  exception when raise_exception then
    if sqlerrm <> 'already_processing' then raise; end if;
  end;
  begin
    perform public.claim_device_hand_cut(m1, pg_temp.marks());
    raise exception 'FAIL: claimed twice';
  exception when raise_exception then
    if sqlerrm <> 'already_processing' then raise; end if;
  end;
  -- The shared checks still refuse what claim_hand_cut refused.
  begin
    perform public.claim_device_hand_cut(m2, '[{"t0": 5, "t1": 5.3}]'::jsonb);
    raise exception 'FAIL: short mark accepted';
  exception when check_violation then
    if sqlerrm <> 'invalid_marks' then raise; end if;
  end;

  -- ------------------------------------------------------------ the report
  r := public.report_device_hand_cut(j, 'device_cut', 30);
  if r <> '{"accepted": true, "phase": "device"}'::jsonb then
    raise exception 'FAIL: report %', r;
  end if;
  select * into v from public.jobs where id = j;
  if v.progress <> 30 or v.options->>'device_stage' <> 'device_cut'
     or public._try_timestamptz(v.options->>'device_reported_at') is null then
    raise exception 'FAIL: report not written %', v.options;
  end if;
  begin
    perform public.report_device_hand_cut(j, 'cutting', 30);
    raise exception 'FAIL: unknown stage accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_stage' then raise; end if;
  end;
  begin
    perform public.report_device_hand_cut(j, 'device_cut', 101);
    raise exception 'FAIL: progress over 100';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_progress' then raise; end if;
  end;
  perform pg_temp.act(player, false);
  begin
    perform public.report_device_hand_cut(j, 'device_cut', 40);
    raise exception 'FAIL: another account reported';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  perform pg_temp.act(admin, true);

  -- ------------------------------------------------------------ the submit
  begin
    perform public.submit_device_hand_cut(j, '{"key": "results/x/y.manifest.json"}');
    raise exception 'FAIL: foreign manifest key accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_manifest' then raise; end if;
  end;
  select count(*) into sent from pgmq.sent;
  r := public.submit_device_hand_cut(j, jsonb_build_object(
         'key', 'results/' || admin || '/' || j || '.manifest.json',
         'bytes', 4000, 'cut_bytes', 90000000));
  if r->>'phase' <> 'verify' then raise exception 'FAIL: submit %', r; end if;
  select * into v from public.jobs where id = j;
  if v.status <> 'queued' or v.options->>'phase' <> 'verify'
     or (v.options->'device_upload'->>'bytes')::int <> 4000 then
    raise exception 'FAIL: submit row %', row_to_json(v);
  end if;
  if (select count(*) from pgmq.sent) <> sent + 1
     or (select queue from pgmq.sent order by id desc limit 1) <> 'jobs_hand'
     or (select message->'options'->>'phase' from pgmq.sent order by id desc limit 1) <> 'verify'
     or (select message->>'job_id' from pgmq.sent order by id desc limit 1) <> j::text
     or (select message->>'kind' from pgmq.sent order by id desc limit 1) <> 'hand_cut'
     or (select delay from pgmq.sent order by id desc limit 1) <> 0 then
    raise exception 'FAIL: submit message';
  end if;
  r := public.submit_device_hand_cut(j, '{}');
  if (r->>'already')::boolean is not true then
    raise exception 'FAIL: repeated submit %', r;
  end if;
  if (select count(*) from pgmq.sent) <> sent + 1 then
    raise exception 'FAIL: repeated submit sent twice';
  end if;
  r := public.report_device_hand_cut(j, 'device_upload', 100);
  if (r->>'accepted')::boolean or r->>'phase' <> 'verify' then
    raise exception 'FAIL: report after submit %', r;
  end if;
  begin
    perform public.release_device_hand_cut(j, true);
    raise exception 'FAIL: released a submitted job';
  exception when raise_exception then
    if sqlerrm <> 'bad_state' then raise; end if;
  end;

  -- ------------------------------------------------ release: to the Mac
  r := public.claim_device_hand_cut(m2, pg_temp.marks());
  j2 := (r->>'job_id')::uuid;
  select count(*) into sent from pgmq.sent;
  r := public.release_device_hand_cut(j2, true);
  if r->>'phase' <> 'mac' then raise exception 'FAIL: to mac %', r; end if;
  select * into v from public.jobs where id = j2;
  if v.status <> 'queued' or v.options->>'cutter' <> 'mac'
     or v.options->>'phase' <> 'mac' or v.progress <> 0 then
    raise exception 'FAIL: to mac row %', row_to_json(v);
  end if;
  if (select count(*) from pgmq.sent) <> sent + 1
     or (select queue from pgmq.sent order by id desc limit 1) <> 'jobs_hand' then
    raise exception 'FAIL: to mac was not queued';
  end if;
  if (select job_id from public.matches where id = m2) <> j2
     or (select submitted_at from public.hand_cut_drafts where match_id = m2) is null then
    raise exception 'FAIL: to mac unfroze the marks';
  end if;
  r := public.release_device_hand_cut(j2, true);
  if r->>'phase' <> 'mac' or (select count(*) from pgmq.sent) <> sent + 1 then
    raise exception 'FAIL: repeated to mac %', r;
  end if;
  begin
    perform public.release_device_hand_cut(j2, false);
    raise exception 'FAIL: handed back a Mac job';
  exception when raise_exception then
    if sqlerrm <> 'bad_state' then raise; end if;
  end;
  update public.jobs set status = 'done' where id = j2;

  -- ------------------------------------------------- release: hand back
  r := public.claim_device_hand_cut(m3, pg_temp.marks());
  j2 := (r->>'job_id')::uuid;
  r := public.release_device_hand_cut(j2, false);
  if r->>'phase' <> 'released' then raise exception 'FAIL: hand back %', r; end if;
  if (select status from public.jobs where id = j2) <> 'cancelled'
     or (select job_id from public.matches where id = m3) is not null
     or (select cut_source from public.matches where id = m3) <> 'auto'
     or (select status from public.matches where id = m3) <> 'uploaded'
     or (select submitted_at from public.hand_cut_drafts where match_id = m3) is not null then
    raise exception 'FAIL: hand back did not hand back';
  end if;
  if exists (select 1 from public.notifications) then
    raise exception 'FAIL: the owner''s own release rang the bell';
  end if;
  r := public.release_device_hand_cut(j2, false);
  if r->>'phase' <> 'released' then raise exception 'FAIL: repeated hand back %', r; end if;
  -- The marks can go straight to the Mac afterwards.
  r := public.claim_hand_cut(m3, pg_temp.marks());
  if (select status from public.jobs where id = (r->>'job_id')::uuid) <> 'queued'
     or (select queue from pgmq.sent order by id desc limit 1) <> 'jobs_hand' then
    raise exception 'FAIL: claim_hand_cut after a hand back';
  end if;
  update public.jobs set status = 'done' where id = (r->>'job_id')::uuid;

  -- --------------------------------------------------- a quiet phone
  r := public.claim_device_hand_cut(m4, pg_temp.marks());
  j := (r->>'job_id')::uuid;
  r := public.claim_device_hand_cut(m5, pg_temp.marks());
  j2 := (r->>'job_id')::uuid;
  -- m4: never reported, claimed 73 hours ago. m5: claimed 100 hours ago
  -- but reported an hour ago; alive.
  update public.jobs set created_at = now() - interval '73 hours' where id = j;
  update public.jobs set created_at = now() - interval '100 hours',
         options = options || jsonb_build_object('device_reported_at', now() - interval '1 hour')
   where id = j2;
  if public.release_stale_device_hand_cuts() <> 1 then
    raise exception 'FAIL: stale sweep count';
  end if;
  select * into v from public.jobs where id = j;
  if v.status <> 'failed' or v.options->>'phase' <> 'released'
     or v.user_message <> 'The cut on your iPhone didn''t finish. Your marks are saved.' then
    raise exception 'FAIL: stale job row %', row_to_json(v);
  end if;
  if (select count(*) from public.notifications
       where title = 'Cut failed'
         and body = 'The cut on your iPhone didn''t finish. Your marks are saved.'
         and href = '/match/' || m4) <> 1 then
    raise exception 'FAIL: stale release did not ring the Cut failed bell';
  end if;
  if (select job_id from public.matches where id = m4) is not null
     or (select submitted_at from public.hand_cut_drafts where match_id = m4) is not null then
    raise exception 'FAIL: stale release kept the marks';
  end if;
  if (select status from public.jobs where id = j2) <> 'processing' then
    raise exception 'FAIL: a reporting phone was released';
  end if;
  -- A report time written as garbage falls back to the claim time, and
  -- cannot break the sweep for everyone else.
  r := public.claim_device_hand_cut(m7, pg_temp.marks());
  update public.jobs set created_at = now() - interval '100 hours',
         options = options || '{"device_reported_at": "soon"}'
   where id = (r->>'job_id')::uuid;
  sent := public.release_stale_device_hand_cuts();
  if sent <> 1
     or (select status from public.jobs where id = (r->>'job_id')::uuid) <> 'failed'
     or (select status from public.jobs where id = j2) <> 'processing' then
    raise exception 'FAIL: garbage report time was not read as the claim time (% released; %)',
      sent, (select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'phase', options->>'phase', 'rep', options->>'device_reported_at', 'created', created_at)) from public.jobs where kind = 'hand_cut');
  end if;

  -- A claim over a quiet phone releases it first.
  r := public.claim_device_hand_cut(m6, pg_temp.marks());
  j := (r->>'job_id')::uuid;
  update public.jobs set created_at = now() - interval '80 hours' where id = j;
  r := public.claim_hand_cut(m6, pg_temp.marks());
  if (select status from public.jobs where id = j) <> 'failed'
     or (select job_id from public.matches where id = m6) <> (r->>'job_id')::uuid then
    raise exception 'FAIL: the claim did not release the quiet phone';
  end if;

  -- ------------------------------------------------ everything else queues
  select count(*) into sent from pgmq.sent;
  insert into public.jobs (user_id, kind, options) values
    (admin, 'deadspace_cut', '{}'), (admin, 'reclip', '{}'),
    (admin, 'placement_generate', jsonb_build_object('match_id', m6));
  if (select array_agg(queue || ':' || delay order by id)
        from pgmq.sent where id > (select max(id) - 3 from pgmq.sent))
     <> array['jobs:60', 'jobs_fast:5', 'jobs_hand:0'] then
    raise exception 'FAIL: ordinary routing %',
      (select array_agg(queue || ':' || delay order by id) from pgmq.sent);
  end if;
end $$;

-- ------------------------------------------------------ admin and player
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m1 uuid := 'cccccccc-0000-4000-8000-000000000001';
  m5 uuid := 'cccccccc-0000-4000-8000-000000000005';
  o jsonb;
  c jsonb;
  f jsonb;
  phone uuid;
begin
  perform pg_temp.act(admin, true);
  phone := (select job_id from public.matches where id = m5);
  o := public.admin_processing_overview();
  if not exists (select 1 from jsonb_array_elements(o->'devices') d
                  where d->>'id' = phone::text
                    and d->>'player' = 'admin@example.com'
                    and d->>'match_id' = m5::text) then
    raise exception 'FAIL: phone job missing from devices %', o->'devices';
  end if;
  if exists (select 1 from jsonb_array_elements(o->'running') x
              where x->>'id' = phone::text) then
    raise exception 'FAIL: phone job still counted as Mac work';
  end if;
  if not exists (select 1 from jsonb_array_elements(o->'recent') x
                  where (x->>'on_device')::boolean) then
    raise exception 'FAIL: released phone jobs not flagged in recent';
  end if;
  c := public.admin_processing_counts();
  if (c->>'running')::int <> (select count(*) from public.jobs
                                where status = 'processing'
                                  and coalesce(options->>'phase', '') <> 'device') then
    raise exception 'FAIL: counts include phone jobs %', c;
  end if;

  f := public.my_match_processing_feedback(array[m5, m1]);
  if not exists (select 1 from jsonb_array_elements(f) x
                  where x->>'match_id' = m5::text and x->>'phase' = 'device'
                    and x->>'cutter' = 'device' and x->>'device_seen_at' is not null) then
    raise exception 'FAIL: feedback lacks the phone phase %', f;
  end if;
  if not exists (select 1 from jsonb_array_elements(f) x
                  where x->>'match_id' = m1::text and x->>'phase' = 'verify'
                    and x->>'device_seen_at' is null) then
    raise exception 'FAIL: feedback for a submitted job %', f;
  end if;
end $$;

-- ------------------------------------------------------------ privileges
do $$ begin
  if has_function_privilege('authenticated', 'public._hand_cut_claim_checks(uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._release_stale_device_hand_cuts(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.release_stale_device_hand_cuts()', 'execute')
     or has_function_privilege('authenticated', 'public._hand_cut_hand_back(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._send_job_message(public.jobs, integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_device_hand_cut(uuid, jsonb)', 'execute') then
    raise exception 'FAIL: a private function is callable';
  end if;
  if not (has_function_privilege('authenticated', 'public.claim_device_hand_cut(uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.report_device_hand_cut(uuid, text, integer)', 'execute')
          and has_function_privilege('authenticated', 'public.submit_device_hand_cut(uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.release_device_hand_cut(uuid, boolean)', 'execute')
          and has_function_privilege('service_role', 'public.release_stale_device_hand_cuts()', 'execute')) then
    raise exception 'FAIL: a phone call is not callable';
  end if;
end $$;

rollback;
select 'device hand cut: all behaviour checks passed' as result;
