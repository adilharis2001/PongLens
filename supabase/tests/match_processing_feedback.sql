-- Contract test for 20260912 match processing measurements and owner feedback.
-- Run only against an isolated database after all migrations. Fixtures roll back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'feedback-owner@example.com', '{}'),
  ('22222222-2222-4222-8222-222222222222', 'feedback-other@example.com', '{}');

insert into public.matches
  (id, user_id, status, raw_path, duration_s, original_name)
values
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'uploaded', 'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/a.mp4', 600, 'a.mp4'),
  ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'uploaded', 'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/b.mp4', 600, 'b.mp4'),
  ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'uploaded', 'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/c.mp4', 600, 'c.mp4'),
  ('10000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'uploaded', 'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/d.mp4', 600, 'd.mp4'),
  ('10000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'ready',    'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/e.mp4', 600, 'e.mp4'),
  ('10000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'uploaded', 'r2://ponglens-raw/11111111-1111-4111-8111-111111111111/f.mp4', 600, 'f.mp4'),
  ('10000000-0000-4000-8000-000000000007', '22222222-2222-4222-8222-222222222222', 'uploaded', 'r2://ponglens-raw/22222222-2222-4222-8222-222222222222/g.mp4', 600, 'g.mp4');

-- Match 1 deliberately has a newer housekeeping check and an older actual
-- processing request. The request must remain the primary player status.
insert into public.jobs
  (id, user_id, status, kind, input_path, options, created_at)
values
  ('20000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'processing', 'deadspace_cut', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000001"}', now() - interval '5 minutes'),
  ('20000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'processing', 'content_check',  'fixture', '{"match_id":"10000000-0000-4000-8000-000000000001"}', now() - interval '1 minute'),
  ('20000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'processing', 'content_check',  'fixture', '{"match_id":"10000000-0000-4000-8000-000000000002"}', now() - interval '1 minute'),
  ('20000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'queued',     'deadspace_cut', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000003"}', now() - interval '4 minutes'),
  ('20000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'processing', 'deadspace_cut', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000004"}', now() - interval '4 minutes'),
  ('20000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'done',       'deadspace_cut', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000005"}', now() - interval '4 minutes'),
  ('20000000-0000-4000-8000-000000000007', '22222222-2222-4222-8222-222222222222', 'processing', 'deadspace_cut', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000007"}', now() - interval '4 minutes'),
  -- These newer derived jobs must never replace the match-ready request.
  ('20000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'processing', 'placement_generate', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000001"}', now()),
  ('20000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'processing', 'reel', 'fixture', '{"match_id":"10000000-0000-4000-8000-000000000001"}', now());

insert into public.worker_pulse
  (worker_id, lane, host, started_at, beat_at, job_id, job_kind, stage, stage_pct)
values
  ('fixture:main', 'main', 'mac', now() - interval '1 hour', now(),
   '20000000-0000-4000-8000-000000000001', 'deadspace_cut', 'ball', 37),
  ('fixture:check', 'main', 'mac', now() - interval '1 hour', now(),
   '20000000-0000-4000-8000-000000000003', 'content_check', 'content_check', 10),
  ('fixture:silent', 'main', 'mac', now() - interval '1 hour', now() - interval '91 seconds',
   '20000000-0000-4000-8000-000000000005', 'deadspace_cut', 'cut', 80),
  ('fixture:other', 'main', 'mac', now() - interval '1 hour', now(),
   '20000000-0000-4000-8000-000000000007', 'deadspace_cut', 'points', 60);

-- -------------------------------------------------------------------------
-- Worker writes are append-only, bounded, and privacy-safe.
-- -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select public.record_match_processing_event(jsonb_build_object(
  'attempt_key', '20000000-0000-4000-8000-000000000001:1',
  'job_id', '20000000-0000-4000-8000-000000000001',
  'attempt', 1,
  'lane', 'main',
  'release_id', 'release-a',
  'event', 'claimed',
  'recorded_at', '2026-09-12T16:00:00+00:00',
  'details', '{}'));

select public.record_match_processing_event(jsonb_build_object(
  'attempt_key', '20000000-0000-4000-8000-000000000001:1',
  'job_id', '20000000-0000-4000-8000-000000000001',
  'attempt', 1,
  'lane', 'main',
  'release_id', 'release-a',
  'event', 'stage',
  'recorded_at', '2026-09-12T16:01:00+00:00',
  'details', jsonb_build_object(
    'stage', 'ball', 'progress', 37, 'route', 'bodies:points',
    'raw_path', '/private/player.mp4', 'error', 'secret exception',
    'access_token', 'secret')));

-- Delivery retry of the identical envelope is idempotent, while different
-- events and timestamps in the same attempt remain separate observations.
select public.record_match_processing_event(jsonb_build_object(
  'attempt_key', '20000000-0000-4000-8000-000000000001:1',
  'job_id', '20000000-0000-4000-8000-000000000001',
  'attempt', 1, 'lane', 'main', 'release_id', 'release-a',
  'event', 'claimed', 'recorded_at', '2026-09-12T16:00:00+00:00',
  'details', '{}'));
select public.record_match_processing_event(jsonb_build_object(
  'attempt_key', '20000000-0000-4000-8000-000000000001:1',
  'job_id', '20000000-0000-4000-8000-000000000001',
  'attempt', 1, 'lane', 'main', 'release_id', 'release-a',
  'event', 'ready', 'recorded_at', '2026-09-12T16:10:00+00:00',
  'details', jsonb_build_object('stage', 'publish')));
select public.record_match_processing_event(jsonb_build_object(
  'attempt_key', '20000000-0000-4000-8000-000000000001:1',
  'job_id', '20000000-0000-4000-8000-000000000001',
  'attempt', 1, 'lane', 'main', 'release_id', 'release-a',
  'event', 'released', 'recorded_at', '2026-09-12T16:12:00+00:00',
  'details', '{}'));

-- Invalid telemetry is fail-open and records nothing.
select public.record_match_processing_event('{"attempt_key":"bad:1","job_id":"not-a-uuid","attempt":0,"lane":"private/path","event":"unknown","details":{"error":"secret"}}');
select public.record_match_processing_event(jsonb_build_object(
  'attempt_key', '20000000-0000-4000-8000-000000000004:1',
  'job_id', '20000000-0000-4000-8000-000000000004',
  'attempt', 1, 'lane', 'main', 'event', 'profile',
  'recorded_at', 'not-a-time',
  'details', jsonb_build_object(
    'duration_s', 'NaN', 'fps', 'Infinity', 'width', 0, 'height', 1080,
    'route', 'private/path', 'trim_start_s', -1,
    'stage', jsonb_build_object('private', true))));

reset role;
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  if (select count(*) from public.match_processing_events
      where attempt_key = '20000000-0000-4000-8000-000000000001:1') <> 4 then
    raise exception 'FAIL: timing events were upserted or lost rather than appended';
  end if;
  if (select count(*) from public.match_processing_events where attempt_key = 'bad:1') <> 0 then
    raise exception 'FAIL: invalid event was stored';
  end if;
  if (select details from public.match_processing_events where event = 'stage')
       <> '{"stage":"ball","progress":37,"route":"bodies:points"}'::jsonb then
    raise exception 'FAIL: event details were not restricted to safe fields';
  end if;
  if (select recorded_at from public.match_processing_events where event = 'released')
       - (select recorded_at from public.match_processing_events where event = 'ready')
       <> interval '2 minutes' then
    raise exception 'FAIL: ready and queue release were not retained separately';
  end if;
  if exists (
    select 1 from public.match_processing_events
    where recorded_at is null or job_id is null or attempt < 1
  ) then
    raise exception 'FAIL: required event identity is nullable or invalid';
  end if;
end;
$$;

-- The latest check for one check-job replaces the earlier result.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.record_match_video_check(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002', 0, 30,
  '{"status":"stable","changes":[]}');
select public.record_match_video_check(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002', 30, 60,
  '{"status":"changed","changes":[{"before_s":42,"after_s":44}]}');
-- Invalid windows and cross-owner attachment are ignored without raising.
select public.record_match_video_check(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003', 'NaN'::double precision, 60,
  '{"status":"changed","changes":[{"before_s":42,"after_s":44}]}');
select public.record_match_video_check(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003', 0, 'Infinity'::double precision,
  '{"status":"stable","changes":[]}');
select public.record_match_video_check(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000007', 0, 60,
  '{"status":"stable","changes":[]}');
-- A changed claim without one valid before/after bracket is stored as unknown.
select public.record_match_video_check(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003', 0, 60,
  '{"status":"changed","changes":[{"before_s":9,"after_s":8},{"before_s":"private","after_s":10}]}');

-- The service role may write bounded records, but player feedback remains an
-- authenticated-owner endpoint rather than a service API.
do $$
begin
  begin
    perform public.my_match_processing_feedback(array[
      '10000000-0000-4000-8000-000000000001'::uuid]);
    raise exception 'FAIL: service role can call owner processing feedback RPC';
  exception when insufficient_privilege then null; end;
end;
$$;

do $$
begin
  begin
    update public.match_processing_events set event = 'failed' where false;
    raise exception 'FAIL: service role can update append-only events';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.match_processing_events where false;
    raise exception 'FAIL: service role can delete append-only events';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  if (select count(*) from public.match_video_checks
      where job_id = '20000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'FAIL: video check retry did not remain unique by job';
  end if;
  if (select result ->> 'status' from public.match_video_checks
      where job_id = '20000000-0000-4000-8000-000000000002') <> 'changed' then
    raise exception 'FAIL: latest video check did not replace the old result';
  end if;
  if exists (select 1 from public.match_video_checks
      where job_id = '20000000-0000-4000-8000-000000000007') then
    raise exception 'FAIL: cross-owner camera check was attached';
  end if;
  if (select result ->> 'status' from public.match_video_checks
      where job_id = '20000000-0000-4000-8000-000000000003') <> 'unknown' then
    raise exception 'FAIL: malformed camera change supported a player warning';
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- The player RPC returns only owned matches and only player-safe state.
-- -------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"feedback-owner@example.com","role":"authenticated"}',
  true);
set local role authenticated;

do $$
declare
  r jsonb;
  row1 jsonb;
  row2 jsonb;
  row3 jsonb;
  row4 jsonb;
  row5 jsonb;
  row6 jsonb;
begin
  r := public.my_match_processing_feedback(array[
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000003'::uuid,
    '10000000-0000-4000-8000-000000000004'::uuid,
    '10000000-0000-4000-8000-000000000005'::uuid,
    '10000000-0000-4000-8000-000000000006'::uuid,
    '10000000-0000-4000-8000-000000000007'::uuid
  ]);
  if jsonb_array_length(r) <> 6 then
    raise exception 'FAIL: RPC did not return each owned requested match exactly once: %', r;
  end if;

  select value into row1 from jsonb_array_elements(r) value
    where value ->> 'match_id' = '10000000-0000-4000-8000-000000000001';
  select value into row2 from jsonb_array_elements(r) value
    where value ->> 'match_id' = '10000000-0000-4000-8000-000000000002';
  select value into row3 from jsonb_array_elements(r) value
    where value ->> 'match_id' = '10000000-0000-4000-8000-000000000003';
  select value into row4 from jsonb_array_elements(r) value
    where value ->> 'match_id' = '10000000-0000-4000-8000-000000000004';
  select value into row5 from jsonb_array_elements(r) value
    where value ->> 'match_id' = '10000000-0000-4000-8000-000000000005';
  select value into row6 from jsonb_array_elements(r) value
    where value ->> 'match_id' = '10000000-0000-4000-8000-000000000006';

  if row1 ->> 'job_id' <> '20000000-0000-4000-8000-000000000001'
     or row1 ->> 'job_kind' <> 'deadspace_cut'
     or row1 ->> 'job_status' <> 'processing'
     or row1 ->> 'stage' <> 'ball'
     or row1 ->> 'worker_state' <> 'fresh' then
    raise exception 'FAIL: actual processing request was hidden by newer check/derived work: %', row1;
  end if;
  if row1 -> 'camera_check' ->> 'status' <> 'changed'
     or (row1 ->> 'checked_at') is null
     or (row1 ->> 'window_start_s')::double precision <> 30
     or (row1 ->> 'window_end_s')::double precision <> 60 then
    raise exception 'FAIL: camera check was not attached to processing feedback: %', row1;
  end if;
  if row2 ->> 'job_kind' <> 'content_check'
     or row2 ->> 'job_status' <> 'processing'
     or row2 ->> 'stage' <> 'content_check'
     or row2 ->> 'worker_state' <> 'fresh' then
    raise exception 'FAIL: upload-only content check was not reported as checking: %', row2;
  end if;
  if row3 ->> 'worker_state' <> 'missing' then
    raise exception 'FAIL: active job without a matching pulse was not unknown: %', row3;
  end if;
  if row4 ->> 'worker_state' <> 'silent' then
    raise exception 'FAIL: old matching pulse was not marked silent: %', row4;
  end if;
  if row5 ->> 'job_status' <> 'done' or (row5 ->> 'stage') is not null then
    raise exception 'FAIL: terminal job exposed a live stage: %', row5;
  end if;
  if (row6 ->> 'job_id') is not null or (row6 ->> 'worker_state') is not null then
    raise exception 'FAIL: match with no job did not preserve safe nulls: %', row6;
  end if;
  if r::text ~* 'eta|estimate|earliest|latest|stage_pct|original_name|input_path' then
    raise exception 'FAIL: RPC exposed estimates or private/internal fields: %', r;
  end if;

  begin
    perform count(*) from public.match_processing_events;
    raise exception 'FAIL: owner can read raw timing events';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.match_processing_events
      (attempt_key,job_id,attempt,lane,event,recorded_at)
    values ('forged:1','20000000-0000-4000-8000-000000000001',1,'main','claimed',now());
    raise exception 'FAIL: owner can forge raw timing events';
  exception when insufficient_privilege then null; end;
  begin
    perform count(*) from public.match_video_checks;
    raise exception 'FAIL: owner can read raw camera checks';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_match_processing_event('{}');
    raise exception 'FAIL: owner can call worker event recorder';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_match_video_check(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002', 0, 1, '{}');
    raise exception 'FAIL: owner can call worker camera-check recorder';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  begin
    perform public.my_match_processing_feedback(array[
      '10000000-0000-4000-8000-000000000001'::uuid]);
    raise exception 'FAIL: anonymous caller can read processing feedback';
  exception when insufficient_privilege then null; end;
end;
$$;

rollback;
