-- Behaviour of 20260925200000_cut_again_auto_replace.sql on the isolated
-- database cut_again_auto_stubs.sql describes (the header there has the
-- commands). Every fixture rolls back. A failure raises 'FAIL: ...'.
\set ON_ERROR_STOP on

create function pg_temp.act(p_user uuid, p_admin boolean default false)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated',
                       'admin', case when p_admin then 'true' else 'false' end)::text,
    true)
$$;

-- The worker's connection: no JWT at all.
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)
$$;

-- A processed automatic match, booked the way production books one: the
-- cut WITHOUT its match (the worker writes it before the row exists), the
-- clips and match.json by the match's folder, the original on the match.
create function pg_temp.auto_match(p_owner uuid, p_points int)
returns uuid language plpgsql as $$
declare
  m uuid := gen_random_uuid();
  j uuid := gen_random_uuid();
  v uuid;
  i int;
  raw text := 'r2://ponglens-raw/' || p_owner || '/' || m || '.mov';
  cut text := 'r2://ponglens-media/results/' || p_owner || '/' || j || '.mp4';
begin
  insert into public.jobs (id, user_id, kind, status, input_path, options)
  values (j, p_owner, 'deadspace_cut', 'done', raw,
          jsonb_build_object('match_id', m, 'trim_start_s', 0, 'trim_end_s', 600));
  insert into public.matches (id, user_id, status, raw_path, duration_s,
                              content_checked_at, original_name,
                              opponent_name, venue, match_type, user_side,
                              first_server, first_server_source, spoken_scores)
  values (m, p_owner, 'uploaded', raw, 600, now(), 'v.mov', 'Rival', 'Club',
          'match', 'near', 'user', 'user', '[{"game": 1, "you": 11, "them": 5}]');
  update public.matches
     set job_id = j, cut_path = cut,
         match_json_path = 'r2://ponglens-media/points/' || p_owner || '/' || m || '/match.json',
         thumb_path = 'r2://ponglens-media/points/' || p_owner || '/' || m || '/thumb-' || j || '.webp',
         clip_pads = '{"pre": 1.5, "post": 1.5}', status = 'ready'
   where id = m;
  select active_processing_version_id into v from public.matches where id = m;
  for i in 1..p_points loop
    insert into public.points (match_id, processing_version_id, idx, t0, t1,
                               cut_t0, clip_path, confirmed_winner)
    values (m, v, i, 10 * i, 10 * i + 6, 8 * i,
            'r2://ponglens-media/points/' || p_owner || '/' || m || '/'
              || lpad(i::text, 2, '0') || '.mp4',
            case when i % 2 = 0 then 'user' end);
  end loop;
  insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key) values
    (p_owner, m, 'other', 1000, raw),
    (p_owner, null, 'cut', 500, cut),
    (p_owner, m, 'clip', 200, 'r2://ponglens-media/points/' || p_owner || '/' || m || '/'),
    (p_owner, m, 'other', 20, 'r2://ponglens-media/points/' || p_owner || '/' || m || '/');
  return m;
end $$;

-- What the main lane writes for a candidate before publishing: n points
-- with clips under versions/<version>/, and its storage rows.
create function pg_temp.candidate_points(p_job uuid, p_n int default 3)
returns uuid language plpgsql as $$
declare
  v uuid;
  m uuid;
  u uuid;
  i int;
  pre text;
begin
  select id, match_id into v, m from public.match_processing_versions where job_id = p_job;
  select user_id into u from public.matches where id = m;
  pre := 'r2://ponglens-media/points/' || u || '/' || m || '/versions/' || v || '/';
  for i in 1..p_n loop
    insert into public.points (match_id, processing_version_id, idx, t0, t1,
                               cut_t0, clip_path)
    values (m, v, i, 12 * i, 12 * i + 7, 9 * i, pre || lpad(i::text, 2, '0') || '.mp4');
  end loop;
  insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key) values
    (u, m, 'cut', 400, 'r2://ponglens-media/results/' || u || '/' || m || '/versions/' || v || '.mp4'),
    (u, m, 'clip', 150, pre),
    (u, m, 'other', 15, pre);
  return v;
end $$;

create function pg_temp.publish(p_job uuid) returns jsonb language plpgsql as $$
declare
  v uuid;
  m uuid;
  u uuid;
begin
  select id, match_id into v, m from public.match_processing_versions where job_id = p_job;
  select user_id into u from public.matches where id = m;
  update public.jobs set status = 'processing' where id = p_job and status = 'queued';
  return public.publish_auto_recut(
    p_job,
    'r2://ponglens-media/results/' || u || '/' || m || '/versions/' || v || '.mp4',
    'r2://ponglens-media/points/' || u || '/' || m || '/versions/' || v || '/thumb-' || p_job || '.webp',
    'r2://ponglens-media/points/' || u || '/' || m || '/versions/' || v || '/match.json',
    (select to_jsonb(x) from public.matches x where x.id = m)
      || jsonb_build_object('clip_pads', '{"pre": 1.2, "post": 2}'::jsonb,
                            'first_server', 'opponent',
                            'placement_status', 'ready', 'placement_mapped_points', 2,
                            'match_structure', '{"side_changes": []}'::jsonb),
    '{"actual_pipeline": "bodies", "trim_start_s": 0, "trim_end_s": 600}'::jsonb,
    'release-under-test');
end $$;

-- The net storage of one key.
create function pg_temp.net(p_key text) returns bigint language sql as $$
  select coalesce(sum(bytes), 0)::bigint from public.storage_ledger where r2_key = p_key
$$;

begin;
-- As production: hand cutting and support reprocessing off for players.
insert into public.app_config (key, value) values ('hand_cut', 'off'),
  ('match_reprocessing_enabled', 'false')
  on conflict (key) do update set value = excluded.value;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'admin-auto@example.com'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'player-auto@example.com');

-- ------------------------------------------------ the switch, read once
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  pm uuid;
begin
  if (select value from public.app_config where key = 'recut_auto_replace') <> 'off' then
    raise exception 'FAIL: the migration changed recut_auto_replace';
  end if;
  m := pg_temp.auto_match(admin, 3);
  pm := pg_temp.auto_match(player, 3);

  perform pg_temp.act(admin, true);
  if (public.recut_options(m)->>'replace_automatic')::boolean then
    raise exception 'FAIL: automatic replace offered while off';
  end if;
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: a Replace claimed while off';
  exception when insufficient_privilege then
    if sqlerrm <> 'not_enabled' then raise; end if;
  end;

  update public.app_config set value = 'admins' where key = 'recut_auto_replace';
  if not (public.recut_options(m)->>'replace_automatic')::boolean then
    raise exception 'FAIL: admins refuses an admin';
  end if;
  perform pg_temp.act(player, false);
  if (public.recut_options(pm)->>'replace_automatic')::boolean then
    raise exception 'FAIL: admins offers a player';
  end if;
  begin
    perform public.claim_auto_recut(pm, true, null, null, 'normal');
    raise exception 'FAIL: a player claimed under admins';
  exception when insufficient_privilege then
    if sqlerrm <> 'not_enabled' then raise; end if;
  end;

  update public.app_config set value = 'on' where key = 'recut_auto_replace';
  if not (public.recut_options(pm)->>'replace_automatic')::boolean then
    raise exception 'FAIL: on refuses a player';
  end if;
  update public.app_config set value = 'garbage' where key = 'recut_auto_replace';
  if (public.recut_options(pm)->>'replace_automatic')::boolean then
    raise exception 'FAIL: an unknown value reads as on';
  end if;
  update public.app_config set value = 'off' where key = 'recut_auto_replace';
end $$;

update public.app_config set value = 'on' where key = 'recut_auto_replace';

-- ------------------------------------------------------ Replace, claimed
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  before public.matches%rowtype;
  after public.matches%rowtype;
  c jsonb;
  j public.jobs%rowtype;
  v public.match_processing_versions%rowtype;
  bal0 int;
  bal1 int;
  fb jsonb;
begin
  m := pg_temp.auto_match(player, 4);
  select * into before from public.matches where id = m;
  perform pg_temp.act(player, false);
  c := public.claim_auto_recut(m, true, 30, 150, 'tight');
  if c->>'match_id' <> m::text or (c->>'job_id') is null
     or (select count(*) from jsonb_object_keys(c)) <> 2 then
    raise exception 'FAIL: the claim''s answer %', c;
  end if;
  select * into j from public.jobs where id = (c->>'job_id')::uuid;
  if j.kind <> 'match_reprocess' or j.status <> 'queued' or j.user_id <> player
     or j.input_path <> before.raw_path
     or j.options->>'match_id' <> m::text or j.options->>'recut' <> 'replace'
     or (j.options->>'trim_start_s')::numeric <> 30 or (j.options->>'trim_end_s')::numeric <> 150
     or j.options->>'strictness' <> 'tight' or (j.options->>'points')::boolean is not true
     or (j.options->>'placement')::boolean is not true
     or (j.options->>'charged_minutes')::int <> 2 or j.options->>'funding' <> 'personal'
     or j.options ? 'issue_id' or j.source_duration_s <> 120 then
    raise exception 'FAIL: the job %', to_jsonb(j);
  end if;
  select * into v from public.match_processing_versions where job_id = j.id;
  if v.status <> 'candidate' or v.cut_source <> 'auto' or v.issue_id is not null
     or v.source_version_id <> before.active_processing_version_id
     or v.id::text <> j.options->>'processing_version_id'
     or v.raw_path <> before.raw_path
     or (v.settings->>'trim_start_s')::numeric <> 30 or v.settings->>'recut' <> 'replace' then
    raise exception 'FAIL: the candidate %', to_jsonb(v);
  end if;
  -- The live match is untouched and still ready.
  select * into after from public.matches where id = m;
  if to_jsonb(after) <> to_jsonb(before) then
    raise exception 'FAIL: the claim changed the match';
  end if;
  -- Charged like claim_processing: the kept window in whole minutes.
  if (select minutes from public.processing_ledger where job_id = j.id and kind = 'spend') <> -2 then
    raise exception 'FAIL: the charge';
  end if;
  bal0 := public._processing_balance(player, 'live');
  if bal0 <> 248 then
    raise exception 'FAIL: balance after the charge %', bal0;
  end if;

  -- One open cut per match, every way in.
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: a second Replace';
  exception when raise_exception then
    if sqlerrm <> 'already_processing' then raise; end if;
  end;
  begin
    perform public.claim_auto_recut(m, false, null, null, 'normal');
    raise exception 'FAIL: a Keep while a Replace runs';
  exception when raise_exception then
    if sqlerrm <> 'already_processing' then raise; end if;
  end;
  if public.recut_options(m)->>'reason' <> 'processing' then
    raise exception 'FAIL: options while the Replace runs';
  end if;
  begin
    perform public.copy_match_for_recut(m);
    raise exception 'FAIL: a copy while the Replace runs';
  exception when raise_exception then
    if sqlerrm <> 'processing' then raise; end if;
  end;
  -- Support reprocessing waits for it.
  insert into public.match_processing_feedback
    (match_id, owner_id, kind, status, source_version_id, source_job_id)
  values (m, player, 'reprocess', 'pending', before.active_processing_version_id, before.job_id);
  perform pg_temp.act(player, true);
  begin
    perform public.admin_start_match_reprocess(
      (select id from public.match_processing_feedback where match_id = m), '{}', 'n');
    raise exception 'FAIL: support reprocessing started over a Replace';
  exception when raise_exception then
    if sqlerrm <> 'player re-cut running' then raise; end if;
  end;
  delete from public.match_processing_feedback where match_id = m;
  perform pg_temp.act(player, false);

  -- The owner's feed names the running Replace, on the main lane.
  fb := public._my_match_processing_feedback_before_estimates(array[m])->0;
  if fb->>'job_id' <> j.id::text or fb->>'job_kind' <> 'match_reprocess'
     or fb->>'job_status' <> 'queued' or fb->>'lane' <> 'main' then
    raise exception 'FAIL: the feed %', fb;
  end if;
end $$;

-- ------------------------------------------------ the claim's refusals
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  om uuid;
  up uuid;
  c jsonb;
  i int;
  code text;
begin
  m := pg_temp.auto_match(player, 2);
  om := pg_temp.auto_match(admin, 2);
  perform pg_temp.act(player, false);

  begin
    perform public.claim_auto_recut(om, true, null, null, 'normal');
    raise exception 'FAIL: another account''s match';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  begin
    perform public.claim_auto_recut(m, null, null, null, 'normal');
    raise exception 'FAIL: no choice';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_request' then raise; end if;
  end;
  begin
    perform public.claim_auto_recut(m, true, null, null, 'fast');
    raise exception 'FAIL: an unknown strictness';
  exception when check_violation then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;
  begin
    perform public.claim_auto_recut(m, true, 100, 103, 'normal');
    raise exception 'FAIL: a window under five seconds';
  exception when raise_exception then
    if sqlerrm <> 'trim_too_short' then raise; end if;
  end;

  -- Assumption A: a coach review refuses Replace, not Keep.
  insert into public.review_orders (match_id, status) values (m, 'in_review');
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: Replace over a coach review';
  exception when raise_exception then
    if sqlerrm <> 'coach_review' then raise; end if;
  end;
  delete from public.review_orders where match_id = m;

  -- Assumption C: a support request refuses both.
  insert into public.match_processing_feedback (match_id, owner_id, kind, status)
  values (m, player, 'refund', 'pending');
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: Replace over a support request';
  exception when raise_exception then
    if sqlerrm <> 'support_request' then raise; end if;
  end;
  delete from public.match_processing_feedback where match_id = m;

  up := gen_random_uuid();
  insert into public.matches (id, user_id, status, raw_path, duration_s)
  values (up, player, 'uploaded', 'r2://ponglens-raw/' || player || '/u.mov', 300);
  begin
    perform public.claim_auto_recut(up, true, null, null, 'normal');
    raise exception 'FAIL: Replace on an unprocessed match';
  exception when raise_exception then
    if sqlerrm <> 'bad_state' then raise; end if;
  end;

  update public.matches set raw_path = null where id = m;
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: Replace without the original';
  exception when raise_exception then
    if sqlerrm <> 'no_source' then raise; end if;
  end;
  update public.matches set raw_path = 'r2://ponglens-raw/' || player || '/' || m || '.mov'
   where id = m;

  update public.app_config set value = 'false' where key = 'commerce_enabled';
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: Replace with commerce off';
  exception when raise_exception then
    if sqlerrm <> 'commerce_disabled' then raise; end if;
  end;
  update public.app_config set value = 'true' where key = 'commerce_enabled';

  -- Not enough minutes: nothing is written.
  perform public._ensure_processing_grant(player, 'live');
  insert into public.processing_ledger (user_id, minutes, kind, billing_mode)
  values (player, -(public._processing_balance(player, 'live') - 3), 'adjust', 'live');
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: Replace past the balance';
  exception when raise_exception then
    if sqlerrm <> 'insufficient_minutes' then raise; end if;
  end;
  if exists (select 1 from public.match_processing_versions
              where match_id = m and status = 'candidate') then
    raise exception 'FAIL: a refused claim left a candidate';
  end if;
  insert into public.processing_ledger (user_id, minutes, kind, billing_mode)
  values (player, 500, 'adjust', 'live');

  -- The fairness cap.
  for i in 1..4 loop
    insert into public.jobs (user_id, kind, status, options)
    values (player, 'deadspace_cut', 'queued', '{}');
  end loop;
  begin
    perform public.claim_auto_recut(m, true, null, null, 'normal');
    raise exception 'FAIL: Replace past the queue cap';
  exception when raise_exception then
    if sqlerrm <> 'queue_full' then raise; end if;
  end;
  delete from public.jobs where user_id = player and kind = 'deadspace_cut' and options = '{}';

  -- Keep: the copy, processed as any upload, charged on the copy.
  c := public.claim_auto_recut(m, false, null, null, 'loose');
  if c->>'match_id' = m::text
     or (select kind from public.jobs where id = (c->>'job_id')::uuid) <> 'deadspace_cut'
     or (select options->>'match_id' from public.jobs where id = (c->>'job_id')::uuid)
          <> c->>'match_id'
     or (select options->>'recut' from public.jobs where id = (c->>'job_id')::uuid) <> 'keep'
     or (select (options->>'placement')::boolean from public.jobs where id = (c->>'job_id')::uuid)
          is not true
     or (select minutes from public.processing_ledger
          where job_id = (c->>'job_id')::uuid and kind = 'spend') <> -10
     or (select status from public.matches where id = (c->>'match_id')::uuid) <> 'uploaded'
     or (select raw_path from public.matches where id = (c->>'match_id')::uuid)
          <> (select raw_path from public.matches where id = m)
     or exists (select 1 from public.match_processing_versions
                 where match_id = m and status = 'candidate') then
    raise exception 'FAIL: Keep %', c;
  end if;
end $$;

-- -------------------------------------- the player's job and the guards
grant usage on schema public to authenticated;
grant insert, update, select on public.jobs to authenticated;
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  j uuid;
begin
  perform pg_temp.act(player, false);
  j := (public.claim_auto_recut(pg_temp.auto_match(player, 2), true, null, null, 'normal')
          ->>'job_id')::uuid;
  -- The worker, with no JWT, reports on it although support reprocessing
  -- is off for everyone.
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing', progress = 20 where id = j;
  -- A client can neither make one nor change one.
  perform pg_temp.act(player, false);
  set local role authenticated;
  begin
    insert into public.jobs (user_id, kind, options)
    values (player, 'match_reprocess', jsonb_build_object('recut', 'replace'));
    raise exception 'FAIL: a client created a re-cut job';
  exception when insufficient_privilege then
    if sqlerrm <> 'reprocessing jobs are admin-managed' then raise; end if;
  end;
  begin
    update public.jobs set options = options || '{"trim_start_s": 0}' where id = j;
    raise exception 'FAIL: a client changed a re-cut job';
  exception when insufficient_privilege then
    if sqlerrm <> 'reprocessing jobs are admin-managed' then raise; end if;
  end;
  reset role;
  -- A support job is still gated by the support switch.
  perform pg_temp.as_worker();
  begin
    insert into public.jobs (user_id, kind, options)
    values (player, 'match_reprocess', jsonb_build_object('issue_id', gen_random_uuid()));
    raise exception 'FAIL: the support gate opened';
  exception when raise_exception then
    if sqlerrm <> 'match reprocessing is not enabled' then raise; end if;
  end;
  begin
    insert into public.jobs (user_id, kind, options)
    values (player, 'match_reprocess',
            jsonb_build_object('recut', 'replace', 'issue_id', gen_random_uuid()));
    raise exception 'FAIL: a support job passed as a re-cut';
  exception when raise_exception then
    if sqlerrm <> 'match reprocessing is not enabled' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------- made live at once
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  before public.matches%rowtype;
  after public.matches%rowtype;
  j uuid;
  v uuid;
  r jsonb;
  old_cut text;
  bells int;
begin
  m := pg_temp.auto_match(player, 4);
  perform pg_temp.act(player, false);
  j := (public.claim_auto_recut(m, true, null, null, 'normal')->>'job_id')::uuid;
  -- The owner answers who served while the new cut is built.
  update public.matches set first_server = 'user', first_server_source = 'user' where id = m;
  select * into before from public.matches where id = m;
  old_cut := before.cut_path;
  bells := (select count(*) from public.notifications where user_id = player);

  perform pg_temp.as_worker();
  v := pg_temp.candidate_points(j, 3);
  r := pg_temp.publish(j);
  if not (r->>'activated')::boolean or not (r->>'live')::boolean
     or (r->>'pointCount')::int <> 3 or r->>'previousVersionId' <> before.active_processing_version_id::text
     or r->>'scoreProjectionStatus' not in ('current', 'empty') then
    raise exception 'FAIL: the receipt %', r;
  end if;
  select * into after from public.matches where id = m;
  if after.active_processing_version_id <> v or after.job_id <> j
     or after.status <> 'ready' or after.cut_source <> 'auto'
     or after.cut_path not like '%/versions/' || v || '.mp4'
     or after.match_json_path not like '%/versions/' || v || '/match.json'
     or after.placement_status <> 'ready' or after.placement_mapped_points <> 2
     or after.clip_pads <> '{"pre": 1.2, "post": 2}'::jsonb
     or after.first_server <> 'user' or after.first_server_source <> 'user'
     or after.spoken_scores <> before.spoken_scores
     or after.opponent_name <> before.opponent_name or after.user_side <> before.user_side
     or after.raw_path <> before.raw_path then
    raise exception 'FAIL: the match after the swap %', to_jsonb(after);
  end if;
  if (select status from public.match_processing_versions
       where id = before.active_processing_version_id) <> 'superseded'
     or (select status from public.jobs where id = j) <> 'done'
     or (select result_path from public.jobs where id = j) <> after.cut_path
     or (select settings->>'actual_pipeline' from public.match_processing_versions where id = v)
          <> 'bodies'
     or (select settings->>'recut' from public.match_processing_versions where id = v) <> 'replace'
     or (select release_id from public.match_processing_versions where id = v)
          <> 'release-under-test' then
    raise exception 'FAIL: versions and job after the swap';
  end if;
  -- One ordinary bell; the ordinary worker receipt.
  if (select count(*) from public.notifications where user_id = player) <> bells + 1
     or (select title from public.notifications where user_id = player
          order by ctid desc limit 1) <> 'Match ready' then
    raise exception 'FAIL: the ready bell';
  end if;
  if (select action from public.match_score_mutations where request_id = v)
       <> 'replace_worker_points' then
    raise exception 'FAIL: no publication receipt';
  end if;
  -- The replaced cut stops counting: the video booked without its match
  -- and the clips booked by the folder. The original stays counted.
  if pg_temp.net(old_cut) <> 0
     or pg_temp.net('r2://ponglens-media/points/' || player || '/' || m || '/') <> 0
     or pg_temp.net(before.raw_path) <> 1000
     or pg_temp.net(after.cut_path) <> 400 then
    raise exception 'FAIL: storage after the swap';
  end if;
  -- The old points are gone from the match (not visible), scores with them.
  if exists (select 1 from public.points p where p.match_id = m
              and p.processing_version_id = after.active_processing_version_id
              and p.confirmed_winner is not null) then
    raise exception 'FAIL: scores carried into the new cut';
  end if;

  -- Called again, nothing twice.
  r := public.activate_auto_recut(j);
  if (r->>'activated')::boolean or not (r->>'live')::boolean
     or (select count(*) from public.notifications where user_id = player) <> bells + 1 then
    raise exception 'FAIL: a second activation %', r;
  end if;
  if public.fail_auto_recut(j, 'late') then
    raise exception 'FAIL: a live cut was failed';
  end if;
  perform pg_temp.act(player, false);
  if (public.recut_options(m)->>'available')::boolean is not true then
    raise exception 'FAIL: options after the swap';
  end if;
end $$;

-- ------------------------------------ made live later, by the sweep
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  j uuid;
  v uuid;
  rc uuid;
  r jsonb;
  out jsonb;
begin
  m := pg_temp.auto_match(player, 2);
  perform pg_temp.act(player, false);
  j := (public.claim_auto_recut(m, true, null, null, 'normal')->>'job_id')::uuid;
  perform pg_temp.as_worker();
  -- A reclip of the live cut is running: the swap refuses to race it.
  insert into public.jobs (id, user_id, kind, status, options)
  values (gen_random_uuid(), player, 'reclip', 'processing', jsonb_build_object('match_id', m))
  returning id into rc;
  v := pg_temp.candidate_points(j, 2);
  r := pg_temp.publish(j);
  if (r->>'activated')::boolean or (r->>'live')::boolean then
    raise exception 'FAIL: made live over running work %', r;
  end if;
  if (select status from public.match_processing_versions where id = v) <> 'ready'
     or (select status from public.jobs where id = j) <> 'done'
     or (select active_processing_version_id from public.matches where id = m) = v then
    raise exception 'FAIL: the waiting candidate';
  end if;
  perform pg_temp.act(player, false);
  if public.recut_options(m)->>'reason' <> 'processing' then
    raise exception 'FAIL: a waiting candidate is not processing';
  end if;
  perform pg_temp.as_worker();
  out := public.activate_pending_auto_recuts();
  if jsonb_array_length(out) <> 0 then
    raise exception 'FAIL: the sweep raced running work';
  end if;
  update public.jobs set status = 'done' where id = rc;
  out := public.activate_pending_auto_recuts();
  if jsonb_array_length(out) <> 1 or out->0->>'job_id' <> j::text
     or out->0->>'match_id' <> m::text or out->0->>'user_id' <> player::text
     or (select active_processing_version_id from public.matches where id = m) <> v then
    raise exception 'FAIL: the sweep %', out;
  end if;
  if jsonb_array_length(public.activate_pending_auto_recuts()) <> 0 then
    raise exception 'FAIL: the sweep made it live twice';
  end if;
  -- The hand lane's sweep never takes it.
  if jsonb_array_length(public.activate_pending_hand_recuts()) <> 0 then
    raise exception 'FAIL: the hand sweep took an automatic re-cut';
  end if;
end $$;

-- ---------------------------------------------------------- a failure
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  before public.matches%rowtype;
  j uuid;
  v uuid;
  bal0 int;
  bells int;
  live_points int;
begin
  m := pg_temp.auto_match(player, 3);
  perform pg_temp.act(player, false);
  bal0 := public._processing_balance(player, 'live');
  j := (public.claim_auto_recut(m, true, null, null, 'normal')->>'job_id')::uuid;
  select * into before from public.matches where id = m;
  select count(*) into live_points from public.points
   where match_id = m and processing_version_id = before.active_processing_version_id;
  bells := (select count(*) from public.notifications where user_id = player);
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  v := pg_temp.candidate_points(j, 2);
  if not public.fail_auto_recut(j, 'decoder stopped') then
    raise exception 'FAIL: the candidate was not failed';
  end if;
  if (select status from public.match_processing_versions where id = v) <> 'failed'
     or exists (select 1 from public.points where processing_version_id = v)
     or (select status from public.jobs where id = j) <> 'failed'
     or (select error from public.jobs where id = j) <> 'decoder stopped'
     or (select user_message from public.jobs where id = j) is not null then
    raise exception 'FAIL: the failed candidate';
  end if;
  -- The live match is exactly as it was.
  if to_jsonb((select x from public.matches x where x.id = m)) <> to_jsonb(before)
     or (select count(*) from public.points where match_id = m
          and processing_version_id = before.active_processing_version_id) <> live_points then
    raise exception 'FAIL: a failed re-cut changed the match';
  end if;
  -- The minutes come back, once.
  if public._processing_balance(player, 'live') <> bal0
     or (select count(*) from public.processing_ledger where job_id = j and kind = 'refund') <> 1 then
    raise exception 'FAIL: the refund';
  end if;
  if public.fail_auto_recut(j, 'again') then
    raise exception 'FAIL: failed twice';
  end if;
  if (select count(*) from public.processing_ledger where job_id = j and kind = 'refund') <> 1 then
    raise exception 'FAIL: refunded twice';
  end if;
  -- One bell: the new cut did not finish. No marks to mention.
  if (select count(*) from public.notifications where user_id = player) <> bells + 1
     or (select title from public.notifications where user_id = player order by ctid desc limit 1)
          <> 'The new cut didn''t finish.'
     or (select body from public.notifications where user_id = player order by ctid desc limit 1)
          is not null
     or (select href from public.notifications where user_id = player order by ctid desc limit 1)
          <> '/match/' || m then
    raise exception 'FAIL: the failure bell';
  end if;
  -- Its storage is uncounted; the live cut's is not.
  if pg_temp.net('r2://ponglens-media/results/' || player || '/' || m || '/versions/' || v || '.mp4') <> 0
     or pg_temp.net('r2://ponglens-media/points/' || player || '/' || m || '/versions/' || v || '/') <> 0
     or pg_temp.net(before.cut_path) <> 500
     or pg_temp.net('r2://ponglens-media/points/' || player || '/' || m || '/') <> 220 then
    raise exception 'FAIL: storage after a failure';
  end if;
  -- And the match can be cut again.
  perform pg_temp.act(player, false);
  if (public.recut_options(m)->>'available')::boolean is not true then
    raise exception 'FAIL: options after a failure';
  end if;
end $$;

-- A support reprocess failing rings nothing, as before; a hand Replace
-- keeps its own bell.
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  j uuid;
  bells int;
begin
  perform pg_temp.act(player, true);
  insert into public.jobs (user_id, kind, status, options)
  values (player, 'match_reprocess', 'processing',
          jsonb_build_object('issue_id', gen_random_uuid(), 'match_id', gen_random_uuid()))
  returning id into j;
  bells := (select count(*) from public.notifications where user_id = player);
  update public.jobs set status = 'failed' where id = j;
  if (select count(*) from public.notifications where user_id = player) <> bells then
    raise exception 'FAIL: a support failure rang the player';
  end if;
  insert into public.jobs (user_id, kind, status, options)
  values (player, 'hand_cut', 'processing',
          jsonb_build_object('recut', 'replace', 'match_id', gen_random_uuid()))
  returning id into j;
  update public.jobs set status = 'failed' where id = j;
  if (select body from public.notifications where user_id = player order by ctid desc limit 1)
       <> 'Your marks are saved.' then
    raise exception 'FAIL: the hand Replace bell changed';
  end if;
end $$;

-- ------------------------------ a waiting candidate whose match moved on
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  j uuid;
  v uuid;
  rc uuid;
  legacy uuid;
  bal0 int;
begin
  m := pg_temp.auto_match(player, 2);
  perform pg_temp.act(player, false);
  bal0 := public._processing_balance(player, 'live');
  j := (public.claim_auto_recut(m, true, null, null, 'normal')->>'job_id')::uuid;
  perform pg_temp.as_worker();
  insert into public.jobs (user_id, kind, status, options)
  values (player, 'reclip', 'processing', jsonb_build_object('match_id', m))
  returning id into rc;
  v := pg_temp.candidate_points(j, 2);
  perform pg_temp.publish(j);
  update public.jobs set status = 'done' where id = rc;
  -- Support restores an older cut while the candidate waits.
  insert into public.match_processing_versions
    (match_id, status, cut_path, match_json_path, match_state, superseded_at)
  values (m, 'superseded', 'r2://ponglens-media/results/legacy.mp4',
          'r2://ponglens-media/legacy.json', '{"status": "ready"}', now())
  returning id into legacy;
  perform public.activate_match_processing_version(m, legacy);
  if jsonb_array_length(public.activate_pending_auto_recuts()) <> 0 then
    raise exception 'FAIL: a stale candidate made live';
  end if;
  if (select status from public.match_processing_versions where id = v) <> 'failed'
     or public._processing_balance(player, 'live') <> bal0
     or (select title from public.notifications where user_id = player order by ctid desc limit 1)
          <> 'The new cut didn''t finish.' then
    raise exception 'FAIL: the stale candidate was not handed back';
  end if;
end $$;

-- --------------------------------------------------- retired versions
do $$
declare
  player uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m uuid;
  m2 uuid;
  first uuid;
  j uuid;
  v uuid;
  j2 uuid;
  v2 uuid;
  support uuid;
  c jsonb;
  used text[];
  root text;
  live_root_clip text;
begin
  -- A match replaced twice: the first cut, then a re-cut, then another.
  m := pg_temp.auto_match(player, 2);
  first := (select active_processing_version_id from public.matches where id = m);
  root := 'r2://ponglens-media/points/' || player || '/' || m || '/';
  perform pg_temp.act(player, false);
  j := (public.claim_auto_recut(m, true, null, null, 'normal')->>'job_id')::uuid;
  perform pg_temp.as_worker();
  v := pg_temp.candidate_points(j, 2);
  perform pg_temp.publish(j);
  -- A phone reclip of a live point lands directly under the match folder.
  live_root_clip := root || '01-deadbeef.mp4';
  update public.points set clip_path = live_root_clip
   where processing_version_id = v and idx = 1;

  -- Retired once replaced, due only after the window.
  if not exists (select 1 from public.retired_processing_versions() x
                  where x.version_id = first and x.first_cut and x.status = 'superseded') then
    raise exception 'FAIL: the replaced first cut is not retired';
  end if;
  if exists (select 1 from public.retired_processing_versions(interval '30 days') x
              where x.version_id = first) then
    raise exception 'FAIL: due before thirty days';
  end if;
  update public.match_processing_versions set superseded_at = now() - interval '31 days'
   where id = first;
  if not exists (select 1 from public.retired_processing_versions(interval '30 days') x
                  where x.version_id = first) then
    raise exception 'FAIL: not due after thirty days';
  end if;
  -- The live cut and a candidate are never retired.
  if exists (select 1 from public.retired_processing_versions() x where x.version_id = v) then
    raise exception 'FAIL: the live cut is retired';
  end if;

  -- What is still in use: the live cut's files, the phone's reclip under
  -- the root folder, a clip in a rendered tag reel. Not the retired cut's
  -- own clips, match.json or video, nor a clip only a failed reel names.
  insert into public.tag_reels (tag_id, user_id, status, manifest, r2_key)
  values (gen_random_uuid(), player, 'ready',
          jsonb_build_object('points', jsonb_build_array(
            jsonb_build_object('clip_path', root || '02.mp4'))), 'reels/tag-x.mp4');
  insert into public.match_reels (match_id, scope, status, manifest)
  values (m, 'highlights', 'failed', jsonb_build_object('points', jsonb_build_array(
            jsonb_build_object('clip_path', root || '01.mp4'))))
  on conflict (match_id, scope) do update set status = 'failed', r2_key = null,
    manifest = excluded.manifest;
  select array_agg(k order by k) into used
    from public.media_keys_in_use(array[
      root || '01.mp4', root || '02.mp4', root || 'match.json', live_root_clip,
      (select cut_path from public.match_processing_versions where id = first),
      (select cut_path from public.matches where id = m),
      (select match_json_path from public.matches where id = m),
      (select raw_path from public.matches where id = m)], array[first]) k;
  if used <> (select array_agg(x order by x) from unnest(array[
        root || '02.mp4', live_root_clip,
        (select cut_path from public.matches where id = m),
        (select match_json_path from public.matches where id = m),
        (select raw_path from public.matches where id = m)]) x) then
    raise exception 'FAIL: keys in use %', used;
  end if;
  -- Without naming the version as retiring, its own clips protect them.
  if not exists (select 1 from public.media_keys_in_use(array[root || '01.mp4'], '{}') k) then
    raise exception 'FAIL: a version''s own clip read as unused';
  end if;

  -- The sweep takes it once, stamps it first, and it can never come back.
  c := public.claim_retired_version_sweep(first, interval '30 days');
  if c->>'version_id' <> first::text or not (c->>'first_cut')::boolean
     or c->>'cut_path' is null or c->>'user_id' <> player::text then
    raise exception 'FAIL: the sweep claim %', c;
  end if;
  if (select media_swept_at from public.match_processing_versions where id = first) is null
     or public.claim_retired_version_sweep(first, interval '30 days') is not null then
    raise exception 'FAIL: swept twice';
  end if;
  begin
    perform public.activate_match_processing_version(m, first);
    raise exception 'FAIL: a swept cut restored';
  exception when raise_exception then
    if sqlerrm <> 'version files were removed' then raise; end if;
  end;

  -- A failed re-cut is retired too; a cut support reprocessing replaced is
  -- not (support may restore it).
  perform pg_temp.act(player, false);
  j2 := (public.claim_auto_recut(m, true, null, null, 'normal')->>'job_id')::uuid;
  perform pg_temp.as_worker();
  v2 := pg_temp.candidate_points(j2, 1);
  update public.jobs set status = 'processing' where id = j2;
  perform public.fail_auto_recut(j2, 'x');
  if not exists (select 1 from public.retired_processing_versions() x
                  where x.version_id = v2 and not x.first_cut
                    and x.cut_path like '%/versions/' || v2 || '.mp4') then
    raise exception 'FAIL: a failed re-cut is not retired';
  end if;
  m2 := pg_temp.auto_match(player, 1);
  support := (select active_processing_version_id from public.matches where id = m2);
  insert into public.match_processing_feedback (match_id, owner_id, kind, status)
  values (m2, player, 'reprocess', 'resolved_reprocessed');
  insert into public.match_processing_versions
    (match_id, source_version_id, issue_id, status, activated_at)
  values (m2, support, (select id from public.match_processing_feedback where match_id = m2),
          'failed', now());
  update public.match_processing_versions set status = 'superseded', superseded_at = now() - interval '90 days'
   where id = support;
  update public.match_processing_versions set status = 'active'
   where match_id = m2 and issue_id is not null;
  update public.matches set active_processing_version_id =
    (select id from public.match_processing_versions where match_id = m2 and status = 'active')
   where id = m2;
  if exists (select 1 from public.retired_processing_versions() x where x.version_id = support) then
    raise exception 'FAIL: a support-replaced cut is retired';
  end if;
end $$;

-- ------------------------------------------------------------ privileges
do $$
declare
  f text;
begin
  if not has_function_privilege('authenticated',
       'public.claim_auto_recut(uuid, boolean, numeric, numeric, text)', 'execute')
     or has_function_privilege('anon',
       'public.claim_auto_recut(uuid, boolean, numeric, numeric, text)', 'execute') then
    raise exception 'FAIL: claim_auto_recut grants';
  end if;
  foreach f in array array[
    'public.publish_auto_recut(uuid, text, text, text, jsonb, jsonb, text)',
    'public.activate_auto_recut(uuid)', 'public.activate_pending_auto_recuts()',
    'public.fail_auto_recut(uuid, text)', 'public._activate_auto_recut(uuid, uuid, uuid)',
    'public._auto_recut_version(uuid)', 'public._refund_auto_recut(uuid)',
    'public._recut_auto_replace_on()',
    'public.retired_processing_versions(interval)',
    'public.media_keys_in_use(text[], uuid[])',
    'public.claim_retired_version_sweep(uuid, interval)'] loop
    if has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: private function callable %', f;
    end if;
  end loop;
  foreach f in array array[
    'public.publish_auto_recut(uuid, text, text, text, jsonb, jsonb, text)',
    'public.activate_auto_recut(uuid)', 'public.activate_pending_auto_recuts()',
    'public.fail_auto_recut(uuid, text)',
    'public.retired_processing_versions(interval)',
    'public.media_keys_in_use(text[], uuid[])',
    'public.claim_retired_version_sweep(uuid, interval)'] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'FAIL: service grant missing %', f;
    end if;
  end loop;
end $$;

rollback;
select 'cut again (automatic): all behaviour checks passed' as result;
