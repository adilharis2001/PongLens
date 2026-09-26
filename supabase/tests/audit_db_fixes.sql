-- Behaviour of the post-rollout audit migration
-- (20260926141940_post_rollout_audit_fixes.sql) on the isolated database
-- audit_db_fixes_stubs.sql describes (the header there has the commands).
-- One section per audit item. Every fixture rolls back. A failure raises
-- 'FAIL: ...'.
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

-- A processed automatic match, as cut_again_auto.sql books one.
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
  return m;
end $$;

-- An uploaded, checked, uncut match: what claim_hand_cut accepts.
create function pg_temp.raw_match(p_owner uuid) returns uuid
language plpgsql as $$
declare m uuid := gen_random_uuid();
begin
  insert into public.matches (id, user_id, status, raw_path, duration_s,
                              content_checked_at, original_name)
  values (m, p_owner, 'uploaded',
          'r2://ponglens-raw/' || p_owner || '/' || m || '.mov', 600, now(), 'v.mov');
  return m;
end $$;

-- What the main lane writes for a candidate before publishing (as
-- cut_again_auto.sql): n points at 12i .. 12i+7 on the candidate's clock.
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
    (select to_jsonb(x) from public.matches x where x.id = m),
    '{"actual_pipeline": "bodies"}'::jsonb,
    'release-under-test');
end $$;

-- Refunds booked against one job.
create function pg_temp.refunds(p_job uuid) returns int language sql as $$
  select count(*)::int from public.processing_ledger
   where job_id = p_job and kind = 'refund'
$$;

-- A queued automatic Replace, claimed the way the app claims one.
create function pg_temp.claim_replace(p_owner uuid, p_match uuid) returns uuid
language plpgsql as $$
declare j uuid;
begin
  perform pg_temp.act(p_owner, false);
  j := (public.claim_auto_recut(p_match, true, null, null, 'normal')->>'job_id')::uuid;
  perform pg_temp.as_worker();
  return j;
end $$;

-- Close a section's waiting work, so the next one's claims are not held
-- back by the four-job fairness cap.
create function pg_temp.settle(p_owner uuid) returns void language sql as $$
  update public.jobs set status = 'cancelled'
   where user_id = p_owner and status in ('queued', 'processing')
$$;

begin;
insert into public.app_config (key, value) values
  ('hand_cut', 'on'), ('recut_auto_replace', 'on'),
  ('match_reprocessing_enabled', 'true')
  on conflict (key) do update set value = excluded.value;
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-audit@example.com'),
  ('b0000000-0000-4000-8000-00000000000b', 'stranger-audit@example.com'),
  ('c0000000-0000-4000-8000-00000000000c', 'admin-audit@example.com');

-- ------------------------------------------------------------------- M1
do $$
declare
  admin uuid := 'c0000000-0000-4000-8000-00000000000c';
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  r jsonb;
begin
  if has_function_privilege('anon', 'public.cloud_worker_decision(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.cloud_worker_decision(boolean)', 'execute') then
    raise exception 'FAIL: M1 the cloud decision is still callable by clients';
  end if;
  if not has_function_privilege('service_role', 'public.cloud_worker_decision(boolean)', 'execute') then
    raise exception 'FAIL: M1 service_role lost the cloud decision';
  end if;

  -- A signed-in account cannot write the control row directly.
  perform pg_temp.act(owner, false);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.cloud_worker_decision(true);
    raise exception 'FAIL: M1 a player started a cloud session';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  -- The admin's switch still answers through it (as its definer).
  perform pg_temp.act(admin, true);
  perform set_config('role', 'authenticated', true);
  r := public.set_cloud_worker_mode('automatic');
  perform set_config('role', 'postgres', true);
  if r->>'claimed' <> 'false'
     or (select cloud_mode from public.processing_control) <> 'automatic'
     or (select latest_dispatch_reason from public.processing_control) <> 'decided' then
    raise exception 'FAIL: M1 the admin switch %', r;
  end if;
end $$;

-- ------------------------------------------------------------------- M2
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  stranger uuid := 'b0000000-0000-4000-8000-00000000000b';
  m uuid;
  m2 uuid;
  m3 uuid;
  m4 uuid;
  n int;
  d public.hand_cut_drafts%rowtype;
begin
  m := pg_temp.raw_match(owner);

  -- A stranger cannot open a draft on someone else's match.
  perform pg_temp.act(stranger, false);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.hand_cut_drafts (match_id, user_id, marks, mode, updated_at)
    values (m, stranger, '[{"t0": 1, "t1": 5}]', null, now());
    raise exception 'FAIL: M2 a stranger opened a draft on another''s match';
  exception when insufficient_privilege then null;
  end;

  -- The owner cannot write submitted_at or prefilled.
  perform set_config('role', 'postgres', true);
  perform pg_temp.act(owner, false);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
    values (m, owner, '[{"t0": 1, "t1": 5}]', now());
    raise exception 'FAIL: M2 a client froze its own draft';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.hand_cut_drafts (match_id, user_id, marks, prefilled)
    values (m, owner, '[{"t0": 1, "t1": 5}]', true);
    raise exception 'FAIL: M2 a client marked its draft as the prefill';
  exception when insufficient_privilege then null;
  end;

  -- The five columns the apps send still work, and the save after it.
  insert into public.hand_cut_drafts (match_id, user_id, marks, mode, updated_at)
  values (m, owner, '[{"t0": 1, "t1": 5}]', 'cut', now())
  returning * into d;
  if d.prefilled or d.submitted_at is not null then
    raise exception 'FAIL: M2 the owner''s insert %', to_jsonb(d);
  end if;
  update public.hand_cut_drafts set marks = '[{"t0": 1, "t1": 6}]', updated_at = now()
   where match_id = m;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: M2 the owner''s save updated % rows', n;
  end if;
  perform set_config('role', 'postgres', true);

  -- A draft somebody else wrote before this fix: the stranger can no
  -- longer save to it, and every owner write takes it back.
  m2 := pg_temp.raw_match(owner);
  insert into public.hand_cut_drafts (match_id, user_id, marks)
  values (m2, stranger, '[{"t0": 1, "t1": 5}]');
  perform pg_temp.act(stranger, false);
  perform set_config('role', 'authenticated', true);
  update public.hand_cut_drafts set marks = '[]' where match_id = m2;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then
    raise exception 'FAIL: M2 a stranger saved to a draft on another''s match';
  end if;
  perform pg_temp.act(owner, false);
  perform public.claim_hand_cut(m2, '[{"t0": 10, "t1": 20}]');
  if (select user_id from public.hand_cut_drafts where match_id = m2) <> owner then
    raise exception 'FAIL: M2 claim_hand_cut left the stranger on the draft';
  end if;
  -- The phone's claim (admins only in production, hence the flag).
  m4 := pg_temp.raw_match(owner);
  insert into public.hand_cut_drafts (match_id, user_id, marks)
  values (m4, stranger, '[{"t0": 1, "t1": 5}]');
  perform pg_temp.act(owner, true);
  perform public.claim_device_hand_cut(m4, '[{"t0": 10, "t1": 20}]');
  if (select user_id from public.hand_cut_drafts where match_id = m4) <> owner then
    raise exception 'FAIL: M2 claim_device_hand_cut left the stranger on the draft';
  end if;
  perform pg_temp.act(owner, false);

  -- start_recut and claim_hand_recut on a processed match.
  m3 := pg_temp.auto_match(owner, 3);
  insert into public.hand_cut_drafts (match_id, user_id, marks)
  values (m3, stranger, '[{"t0": 1, "t1": 5}]');
  perform pg_temp.act(owner, false);
  perform public.start_recut(m3, false);
  if (select user_id from public.hand_cut_drafts where match_id = m3) <> owner then
    raise exception 'FAIL: M2 start_recut left the stranger on the draft';
  end if;
  update public.hand_cut_drafts set user_id = stranger where match_id = m3;
  perform public.claim_hand_recut(m3, '[{"t0": 10, "t1": 20}]', true);
  if (select user_id from public.hand_cut_drafts where match_id = m3) <> owner then
    raise exception 'FAIL: M2 claim_hand_recut left the stranger on the draft';
  end if;
  perform pg_temp.as_worker();
  perform pg_temp.settle(owner);
end $$;

-- -------------------------------------------------------------------- Q
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  r jsonb;
begin
  m := pg_temp.auto_match(owner, 3);
  -- "Start again", then closed: an unsent draft with no marks, newer than
  -- the cut.
  insert into public.hand_cut_drafts (match_id, user_id, marks, mode, updated_at)
  values (m, owner, '[]', 'score', now() + interval '1 second');
  perform pg_temp.act(owner, false);
  r := public.start_recut(m, false);
  if jsonb_array_length(r->'marks') <> 3
     or not (select prefilled from public.hand_cut_drafts where match_id = m) then
    raise exception 'FAIL: Q an empty draft reopened empty %', r;
  end if;

  -- A draft with marks is still the one that comes back.
  perform pg_temp.as_worker();
  update public.hand_cut_drafts
     set marks = '[{"t0": 10, "t1": 16, "winner": "user"}]',
         updated_at = now() + interval '2 seconds'
   where match_id = m;
  perform pg_temp.act(owner, false);
  r := public.start_recut(m, false);
  if jsonb_array_length(r->'marks') <> 1
     or (select prefilled from public.hand_cut_drafts where match_id = m) then
    raise exception 'FAIL: Q a marked draft was not resumed %', r;
  end if;
  perform pg_temp.as_worker();
end $$;

-- ------------------------------------------------------------- C and G
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  mc uuid;
  md uuid;
  me uuid;
  mf uuid;
  j_auto uuid;
  j_hand uuid := gen_random_uuid();
  j_phone uuid := gen_random_uuid();
  j_mac uuid := gen_random_uuid();
  j_support uuid := gen_random_uuid();
  j_place uuid := gen_random_uuid();
  j_run uuid;
  j_waiting uuid;
  j_failed uuid;
  v uuid;
  r jsonb;
  bells int;
begin
  -- The match being deleted: a queued automatic Replace (charged), and
  -- below a queued hand cut, a cut the phone holds, a hand cut on the Mac,
  -- a support re-run and a placement follow-up.
  mc := pg_temp.auto_match(owner, 3);
  j_auto := pg_temp.claim_replace(owner, mc);
  if (select count(*) from public.processing_ledger
       where job_id = j_auto and kind = 'spend') <> 1 then
    raise exception 'FAIL: C the Replace was not charged';
  end if;
  -- Second match: an automatic Replace already on the Mac.
  md := pg_temp.auto_match(owner, 3);
  j_run := pg_temp.claim_replace(owner, md);
  update public.jobs set status = 'processing' where id = j_run;

  -- Third: a Replace whose cut finished but waits to go live behind a
  -- follow-up job, so its version is 'ready' and the job 'done'.
  me := pg_temp.auto_match(owner, 3);
  j_waiting := pg_temp.claim_replace(owner, me);
  v := pg_temp.candidate_points(j_waiting, 2);
  insert into public.jobs (user_id, kind, status, options)
  values (owner, 'reel', 'queued', jsonb_build_object('match_id', me, 'scope', 'full'));
  r := pg_temp.publish(j_waiting);
  if (r->>'activated')::boolean
     or (select status from public.match_processing_versions where id = v) <> 'ready'
     or (select status from public.jobs where id = j_waiting) <> 'done' then
    raise exception 'FAIL: C fixture: the Replace should be waiting to go live %', r;
  end if;

  -- Fourth: a Replace that already failed and was refunded then.
  mf := pg_temp.auto_match(owner, 3);
  j_failed := pg_temp.claim_replace(owner, mf);
  if not public.fail_auto_recut(j_failed, 'boom') or pg_temp.refunds(j_failed) <> 1 then
    raise exception 'FAIL: C fixture: the failed Replace was not refunded';
  end if;

  -- The rest of the first match's waiting work, added after the claims
  -- (which the four-job cap would otherwise refuse).
  insert into public.jobs (id, user_id, kind, status, options) values
    (j_hand, owner, 'hand_cut', 'queued',
     jsonb_build_object('match_id', mc, 'recut', 'replace')),
    (j_phone, owner, 'hand_cut', 'processing',
     jsonb_build_object('match_id', mc, 'cutter', 'device', 'phase', 'device')),
    (j_mac, owner, 'hand_cut', 'processing',
     jsonb_build_object('match_id', mc, 'phase', 'mac')),
    (j_support, owner, 'match_reprocess', 'queued',
     jsonb_build_object('match_id', mc, 'issue_id', gen_random_uuid())),
    (j_place, owner, 'placement_generate', 'queued',
     jsonb_build_object('match_id', mc));

  -- The owner deletes all four, from the app.
  perform pg_temp.act(owner, false);
  delete from public.matches where id in (mc, md, me, mf);
  perform pg_temp.as_worker();
  if exists (select 1 from public.matches where id in (mc, md, me, mf)) then
    raise exception 'FAIL: C a delete was stopped';
  end if;

  if (select status from public.jobs where id = j_auto) <> 'cancelled'
     or (select status from public.jobs where id = j_hand) <> 'cancelled'
     or (select status from public.jobs where id = j_phone) <> 'cancelled'
     or (select status from public.jobs where id = j_support) <> 'cancelled'
     or (select status from public.jobs where id = j_place) <> 'cancelled' then
    raise exception 'FAIL: C waiting work of a deleted match was not cancelled';
  end if;
  if (select status from public.jobs where id = j_mac) <> 'processing'
     or (select status from public.jobs where id = j_run) <> 'processing' then
    raise exception 'FAIL: C a cut on the Mac was taken from the worker';
  end if;
  -- Refunds: the queued one, the one on the Mac, the one waiting to go
  -- live; the one already refunded is not refunded twice.
  if pg_temp.refunds(j_auto) <> 1 or pg_temp.refunds(j_run) <> 1
     or pg_temp.refunds(j_waiting) <> 1 or pg_temp.refunds(j_failed) <> 1 then
    raise exception 'FAIL: C refunds % % % %', pg_temp.refunds(j_auto),
      pg_temp.refunds(j_run), pg_temp.refunds(j_waiting), pg_temp.refunds(j_failed);
  end if;
  if (select sum(minutes) from public.processing_ledger where job_id = j_auto) <> 0 then
    raise exception 'FAIL: C the refund does not net the charge';
  end if;
  -- Idempotent: asked again, nothing more.
  perform public._refund_auto_recut(j_auto);
  if pg_temp.refunds(j_auto) <> 1 then
    raise exception 'FAIL: C a second refund';
  end if;
  -- The phone's next report is refused, and the stale handover skips it.
  perform pg_temp.act(owner, false);
  if (public.report_device_hand_cut(j_phone, 'device_upload', 50)->>'accepted')::boolean then
    raise exception 'FAIL: C the phone kept cutting a deleted match';
  end if;
  perform pg_temp.as_worker();
  bells := (select count(*) from public.notifications where user_id = owner);

  -- The Mac then fails the cuts it held: nobody is told about a match
  -- that is gone, and the auto one is not refunded again.
  update public.jobs set status = 'failed', error = 'match not found'
   where id in (j_mac, j_run);
  perform public.fail_auto_recut(j_run, 'match not found');
  if (select count(*) from public.notifications where user_id = owner) <> bells then
    raise exception 'FAIL: C a bell rang for a deleted match';
  end if;
  if pg_temp.refunds(j_run) <> 1 then
    raise exception 'FAIL: C the Mac''s failure refunded twice';
  end if;
  perform pg_temp.settle(owner);
end $$;

-- A delete is never blocked: every step inside the trigger failing at
-- once still lets it through.
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  j uuid;
  h uuid := gen_random_uuid();
begin
  m := pg_temp.auto_match(owner, 2);
  j := pg_temp.claim_replace(owner, m);
  insert into public.jobs (id, user_id, kind, status, options)
  values (h, owner, 'hand_cut', 'queued', jsonb_build_object('match_id', m));
  begin
    execute $f$create or replace function public._refund_auto_recut(p_job_id uuid)
      returns integer language plpgsql as $b$ begin raise exception 'refund broke'; end $b$ $f$;
    execute $f$create function pg_temp.no_cancel() returns trigger language plpgsql as
      $b$ begin if new.status = 'cancelled' then raise exception 'cancel broke'; end if;
          return new; end $b$ $f$;
    execute 'create trigger audit_no_cancel before update on public.jobs
               for each row execute function pg_temp.no_cancel()';
    perform pg_temp.act(owner, false);
    delete from public.matches where id = m;
    perform pg_temp.as_worker();
    if exists (select 1 from public.matches where id = m) then
      raise exception 'FAIL: C a failing trigger stopped the delete';
    end if;
    if (select status from public.jobs where id = h) <> 'queued'
       or pg_temp.refunds(j) <> 0 then
      raise exception 'FAIL: C fixture: the breakage did not happen';
    end if;
    raise exception 'audit: roll back the breakage';
  exception when others then
    if sqlerrm <> 'audit: roll back the breakage' then
      raise;
    end if;
  end;
  if pg_temp.refunds(j) <> 0 or not exists (select 1 from public.matches where id = m) then
    raise exception 'FAIL: C fixture: the breakage did not roll back';
  end if;
  perform pg_temp.as_worker();
  perform pg_temp.settle(owner);
end $$;

-- G: a failure bell carries its match; one without a match does not.
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  mr uuid;
  j1 uuid := gen_random_uuid();
  j2 uuid := gen_random_uuid();
  j3 uuid := gen_random_uuid();
  j4 uuid;
  n public.notifications%rowtype;
begin
  m := pg_temp.raw_match(owner);
  mr := pg_temp.auto_match(owner, 2);
  insert into public.jobs (id, user_id, kind, status, options) values
    (j1, owner, 'hand_cut', 'queued', jsonb_build_object('match_id', m)),
    (j2, owner, 'deadspace_cut', 'processing', jsonb_build_object('match_id', m)),
    (j3, owner, 'youtube_import', 'processing', '{}'::jsonb);
  j4 := pg_temp.claim_replace(owner, mr);

  -- The updater need not be able to call the trigger function.
  execute 'create role audit_updater';
  execute 'grant usage on schema public to audit_updater';
  execute 'grant select, update on public.jobs to audit_updater';
  perform set_config('role', 'audit_updater', true);
  update public.jobs set status = 'failed' where id = j1;
  perform set_config('role', 'postgres', true);

  select * into n from public.notifications where href = '/match/' || m
   order by ctid desc limit 1;
  if n.match_id is distinct from m or n.title <> 'Cut failed' then
    raise exception 'FAIL: G the hand-cut bell %', to_jsonb(n);
  end if;
  update public.jobs set status = 'failed' where id = j2;
  select * into n from public.notifications
   where match_id = m and title = 'Upload failed';
  if not found or n.href <> '/upload' then
    raise exception 'FAIL: G the upload bell did not carry its match';
  end if;
  update public.jobs set status = 'failed' where id = j3;
  if not exists (select 1 from public.notifications
                  where title = 'Import failed' and match_id is null) then
    raise exception 'FAIL: G an import with no match';
  end if;
  update public.jobs set status = 'failed' where id = j4;
  if not exists (select 1 from public.notifications
                  where match_id = mr and title = 'The new cut didn''t finish.') then
    raise exception 'FAIL: G the Replace bell did not carry its match';
  end if;
  -- The bells go with their match.
  delete from public.matches where id in (m, mr);
  if exists (select 1 from public.notifications where match_id in (m, mr)) then
    raise exception 'FAIL: G a bell outlived its match';
  end if;
  perform pg_temp.settle(owner);
end $$;

-- -------------------------------------------------------------------- E
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  t text := 'tag:' || gen_random_uuid();
  bells int;
begin
  m := pg_temp.auto_match(owner, 2);
  insert into public.match_reels (match_id, scope, status) values
    (m, 'full', 'rendering'), (m, 'starred', 'rendering'),
    (m, 'highlights', 'rendering'), (m, t, 'rendering');
  bells := (select count(*) from public.notifications where match_id = m);
  update public.match_reels set status = 'ready' where match_id = m;
  if (select count(*) from public.notifications where match_id = m) <> bells + 3 then
    raise exception 'FAIL: E highlights rang, or an export did not';
  end if;
  if not exists (select 1 from public.notifications where match_id = m
                  and title = 'Full match ready'
                  and body = 'Your export vs Rival is rendered. Tap to download it.'
                  and href = '/match/' || m || '?export=full')
     or not exists (select 1 from public.notifications where match_id = m
                     and title = 'Starred points ready')
     or not exists (select 1 from public.notifications where match_id = m
                     and title = 'Tagged points ready' and href = '/match/' || m || '?export=' || t)
     or exists (select 1 from public.notifications where match_id = m
                 and href like '%export=highlights') then
    raise exception 'FAIL: E the export bells';
  end if;
  update public.match_reels set status = 'rendering' where match_id = m;
  update public.match_reels set status = 'failed' where match_id = m;
  if (select count(*) from public.notifications where match_id = m) <> bells + 6
     or not exists (select 1 from public.notifications where match_id = m
                     and title = 'Full match couldn''t be rendered'
                     and body = 'Something went wrong rendering your export vs Rival.')
     or exists (select 1 from public.notifications where match_id = m
                 and title like '%—%') then
    raise exception 'FAIL: E the failure bells';
  end if;
end $$;

-- ---------------------------------------------------------- F and J
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  old_v uuid;
  new_v uuid;
  j uuid;
  p1 uuid; p4 uuid; p5 uuid; p6 uuid; p2 uuid;
  q1 uuid;
  n1 uuid := gen_random_uuid();
  n2 uuid := gen_random_uuid();
  n3 uuid := gen_random_uuid();
  old_cut text;
  keys text[];
  kept text[];
  r jsonb;
begin
  -- Six points at 10i .. 10i+6 on the whole video.
  m := pg_temp.auto_match(owner, 6);
  select active_processing_version_id, cut_path into old_v, old_cut
    from public.matches where id = m;
  select id into p1 from public.points where match_id = m and idx = 1;
  select id into p2 from public.points where match_id = m and idx = 2;
  select id into p4 from public.points where match_id = m and idx = 4;
  select id into p5 from public.points where match_id = m and idx = 5;
  select id into p6 from public.points where match_id = m and idx = 6;
  insert into public.share_links (token, kind, match_id, point_id, revoked_at) values
    (repeat('1', 32), 'point', m, p1, null),
    (repeat('4', 32), 'point', m, p4, null),
    (repeat('5', 32), 'point', m, p5, now()),
    (repeat('6', 32), 'point', m, p6, null),
    (repeat('m', 32), 'match', m, null, null);
  insert into public.notes (id, match_id, point_id, author_id, body) values
    (n1, m, p1, owner, 'on a point of the old cut'),
    (n2, m, null, owner, 'on the match');

  perform pg_temp.act(owner, false);
  if (select count(*) from public.note_feed() where id in (n1, n2)) <> 2 then
    raise exception 'FAIL: F notes missing before the Replace';
  end if;

  -- Replace, trimmed to 30 .. 150: the new points sit at 12i .. 12i+7 on
  -- the trimmed clock, 42 .. 49, 54 .. 61 and 66 .. 73 on the video's.
  j := (public.claim_auto_recut(m, true, 30, 150, 'tight')->>'job_id')::uuid;
  perform pg_temp.as_worker();
  new_v := pg_temp.candidate_points(j, 3);
  r := pg_temp.publish(j);
  if not (r->>'activated')::boolean then
    raise exception 'FAIL: J fixture: the Replace did not go live %', r;
  end if;
  select id into q1 from public.points
   where processing_version_id = new_v and idx = 1;

  -- (cut_again.sql, which runs before this migration, still expects a
  -- point link to keep its old cut after a Replace. J changed that.)
  -- J: point 4 (40 .. 46) shares 42 .. 46 with the new first point, two
  -- thirds of its rally: it moves. Point 1 (10 .. 16) overlaps nothing on
  -- the video's clock (it would overlap 12 .. 19 if the trim were
  -- ignored): it stays. Point 6 (60 .. 66) shares one second: it stays.
  -- The revoked link and the match link are left alone.
  if (select point_id from public.share_links where token = repeat('4', 32)) <> q1 then
    raise exception 'FAIL: J the link on point 4 did not follow its rally';
  end if;
  if (select point_id from public.share_links where token = repeat('1', 32)) <> p1
     or (select point_id from public.share_links where token = repeat('6', 32)) <> p6
     or (select point_id from public.share_links where token = repeat('5', 32)) <> p5 then
    raise exception 'FAIL: J a link moved that should not have';
  end if;

  -- What cannot move keeps its files through the sweep of the old cut.
  keys := array[
    (select clip_path from public.points where id = p1),
    (select clip_path from public.points where id = p2),
    (select clip_path from public.points where id = p4),
    (select clip_path from public.points where id = p6),
    old_cut];
  select array_agg(k order by k) into kept
    from public.media_keys_in_use(keys, array[old_v]) k;
  if kept is distinct from (select array_agg(x order by x) from unnest(array[
       (select clip_path from public.points where id = p1),
       (select clip_path from public.points where id = p6),
       old_cut]) x) then
    raise exception 'FAIL: J the sweep would take %', kept;
  end if;
  update public.share_links set revoked_at = now() where token in (repeat('1', 32), repeat('6', 32));
  if exists (select 1 from public.media_keys_in_use(keys, array[old_v])) then
    raise exception 'FAIL: J revoked links still hold files';
  end if;

  -- F: the old cut's point note leaves the feed; the match note and a
  -- note on the new cut stay.
  insert into public.notes (id, match_id, point_id, author_id, body)
  values (n3, m, q1, owner, 'on a point of the new cut');
  perform pg_temp.act(owner, false);
  if exists (select 1 from public.note_feed() where id = n1)
     or not exists (select 1 from public.note_feed() where id = n2)
     or not exists (select 1 from public.note_feed() where id = n3) then
    raise exception 'FAIL: F the feed after the Replace';
  end if;
  perform pg_temp.as_worker();
  perform pg_temp.settle(owner);
end $$;

-- J: two links that want one new point. One live link per point, so one
-- moves and the other stays (and keeps its files); the publication goes
-- through.
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  old_v uuid;
  v uuid;
  j uuid := gen_random_uuid();
  p1 uuid;
  p2 uuid;
  q uuid;
begin
  m := pg_temp.auto_match(owner, 2);
  select active_processing_version_id into old_v from public.matches where id = m;
  select id into p1 from public.points where match_id = m and idx = 1;
  select id into p2 from public.points where match_id = m and idx = 2;
  insert into public.share_links (token, kind, match_id, point_id) values
    (repeat('a', 32), 'point', m, p1), (repeat('b', 32), 'point', m, p2);
  insert into public.jobs (id, user_id, kind, status, options)
  values (j, owner, 'deadspace_cut', 'done', jsonb_build_object('match_id', m));
  insert into public.match_processing_versions
    (match_id, source_version_id, job_id, status, raw_path, cut_path,
     match_json_path, completed_at)
  select m, old_v, j, 'ready', raw_path, 'r2://ponglens-media/new-cut.mp4',
         'r2://ponglens-media/new-match.json', now()
    from public.matches where id = m
  returning id into v;
  insert into public.points (match_id, processing_version_id, idx, t0, t1, clip_path)
  values (m, v, 1, 0, 100, 'r2://ponglens-media/new-01.mp4')
  returning id into q;
  perform public.activate_match_processing_version(m, v);
  if (select active_processing_version_id from public.matches where id = m) <> v then
    raise exception 'FAIL: J the publication did not go through';
  end if;
  if (select count(*) from public.share_links where point_id = q) <> 1
     or (select count(*) from public.share_links
          where point_id in (p1, p2) and match_id = m) <> 1 then
    raise exception 'FAIL: J two links on one point, or none moved';
  end if;
end $$;

-- -------------------------------------------------------------------- H
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  up30 uuid := gen_random_uuid();
  up61 uuid := gen_random_uuid();
  cut16 uuid := gen_random_uuid();
  cut10 uuid := gen_random_uuid();
  none16 uuid := gen_random_uuid();
  n int;
begin
  insert into public.jobs (id, user_id, kind, status, created_at, options) values
    (up30, owner, 'hand_cut', 'processing', now() - interval '2 hours',
     jsonb_build_object('cutter', 'device', 'phase', 'device', 'device_stage', 'device_upload',
                        'device_reported_at', now() - interval '30 minutes')),
    (up61, owner, 'hand_cut', 'processing', now() - interval '2 hours',
     jsonb_build_object('cutter', 'device', 'phase', 'device', 'device_stage', 'device_upload',
                        'device_reported_at', now() - interval '61 minutes')),
    (cut16, owner, 'hand_cut', 'processing', now() - interval '2 hours',
     jsonb_build_object('cutter', 'device', 'phase', 'device', 'device_stage', 'device_cut',
                        'device_reported_at', now() - interval '16 minutes')),
    (cut10, owner, 'hand_cut', 'processing', now() - interval '2 hours',
     jsonb_build_object('cutter', 'device', 'phase', 'device', 'device_stage', 'device_clips',
                        'device_reported_at', now() - interval '10 minutes')),
    (none16, owner, 'hand_cut', 'processing', now() - interval '16 minutes',
     jsonb_build_object('cutter', 'device', 'phase', 'device'));
  n := public.release_stale_device_hand_cuts();
  if n <> 3 then
    raise exception 'FAIL: H handed over % phone cuts, expected 3', n;
  end if;
  if (select options->>'phase' from public.jobs where id = up30) <> 'device'
     or (select options->>'phase' from public.jobs where id = cut10) <> 'device' then
    raise exception 'FAIL: H a phone still inside its window was handed over';
  end if;
  if (select options->>'phase' from public.jobs where id = up61) <> 'mac'
     or (select options->>'device_note' from public.jobs where id = up61)
          <> 'switched to the Mac: no report from the iPhone for 60 minutes while uploading'
     or (select options->>'phase' from public.jobs where id = cut16) <> 'mac'
     or (select options->>'device_note' from public.jobs where id = cut16)
          <> 'switched to the Mac: no report from the iPhone for 15 minutes'
     or (select status from public.jobs where id = none16) <> 'queued' then
    raise exception 'FAIL: H a quiet phone was not handed over';
  end if;
  perform pg_temp.settle(owner);
end $$;

-- -------------------------------------------------------------------- L
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  m uuid;
  m2 uuid;
  o uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  j uuid;
begin
  m := pg_temp.auto_match(owner, 2);
  m2 := pg_temp.auto_match(owner, 2);
  insert into public.review_orders (id, student_id, status) values
    (o, owner, 'awaiting_submission'), (o2, owner, 'awaiting_submission');

  -- A queued Replace refuses the order.
  j := pg_temp.claim_replace(owner, m);
  perform pg_temp.act(owner, false);
  begin
    perform public.submit_review_order(o, m, '[]');
    raise exception 'FAIL: L sent during a queued Replace';
  exception when raise_exception then
    if sqlerrm <> 'recut_in_progress' then raise; end if;
  end;
  -- So does its finished cut waiting to go live.
  perform pg_temp.as_worker();
  update public.jobs set status = 'done' where id = j;
  perform pg_temp.act(owner, false);
  begin
    perform public.submit_review_order(o, m, '[]');
    raise exception 'FAIL: L sent while a new cut waits to go live';
  exception when raise_exception then
    if sqlerrm <> 'recut_in_progress' then raise; end if;
  end;
  -- Once it is gone, the order goes.
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  perform public.fail_auto_recut(j, 'boom');
  perform pg_temp.act(owner, false);
  perform public.submit_review_order(o, m, '[]');
  if (select status from public.review_orders where id = o) <> 'submitted' then
    raise exception 'FAIL: L the order after the Replace ended';
  end if;

  -- Support's re-run is not a Replace.
  perform pg_temp.as_worker();
  insert into public.jobs (user_id, kind, status, options)
  values (owner, 'match_reprocess', 'queued',
          jsonb_build_object('match_id', m2, 'issue_id', gen_random_uuid()));
  perform pg_temp.act(owner, false);
  perform public.submit_review_order(o2, m2, '[]');
  if (select status from public.review_orders where id = o2) <> 'submitted' then
    raise exception 'FAIL: L a support re-run held the order';
  end if;
  perform pg_temp.as_worker();
  perform pg_temp.settle(owner);
end $$;

-- ------------------------------------------------------------------- S2
do $$
declare
  owner uuid := 'a0000000-0000-4000-8000-00000000000a';
  admin uuid := 'c0000000-0000-4000-8000-00000000000c';
  m uuid;
  m2 uuid;
  j_auto uuid;
  j_hand uuid := gen_random_uuid();
  j_support uuid := gen_random_uuid();
  j_cut uuid := gen_random_uuid();
  j_failed uuid := gen_random_uuid();
  o jsonb;
  f text;
begin
  m := pg_temp.auto_match(owner, 2);
  m2 := pg_temp.auto_match(owner, 2);
  j_auto := pg_temp.claim_replace(owner, m);
  insert into public.jobs (id, user_id, kind, status, options) values
    (j_hand, owner, 'hand_cut', 'processing',
     jsonb_build_object('match_id', m2, 'recut', 'replace')),
    (j_support, owner, 'match_reprocess', 'queued',
     jsonb_build_object('match_id', m2, 'issue_id', gen_random_uuid(), 'recut', 'replace')),
    (j_cut, owner, 'deadspace_cut', 'processing', '{}'::jsonb),
    (j_failed, owner, 'hand_cut', 'queued',
     jsonb_build_object('match_id', m2, 'recut', 'replace'));
  update public.jobs set status = 'failed' where id = j_failed;
  insert into public.worker_pulse (worker_id, lane, host, beat_at, job_id) values
    ('mac:hand', 'hand', 'mac', now(), j_hand),
    ('mac:main', 'main', 'mac', now(), j_cut);

  perform pg_temp.act(admin, true);
  o := public.admin_processing_overview();
  perform pg_temp.as_worker();
  if (select (x->>'player_replace')::boolean from jsonb_array_elements(o->'waiting') x
       where x->>'id' = j_auto::text) is not true
     or (select (x->>'player_replace')::boolean from jsonb_array_elements(o->'waiting') x
          where x->>'id' = j_support::text) is not false
     or (select (x->>'player_replace')::boolean from jsonb_array_elements(o->'running') x
          where x->>'id' = j_hand::text) is not true
     or (select (x->>'player_replace')::boolean from jsonb_array_elements(o->'running') x
          where x->>'id' = j_cut::text) is not false
     or (select (x->>'player_replace')::boolean from jsonb_array_elements(o->'recent') x
          where x->>'id' = j_failed::text) is not true
     or (select (x->>'job_player_replace')::boolean from jsonb_array_elements(o->'workers') x
          where x->>'worker_id' = 'mac:hand') is not true
     or (select (x->>'job_player_replace')::boolean from jsonb_array_elements(o->'workers') x
          where x->>'worker_id' = 'mac:main') is not false
     or jsonb_typeof(o->'devices') <> 'array' then
    raise exception 'FAIL: S2 the overview %', o;
  end if;
  -- Still the admin's alone.
  perform pg_temp.act(owner, false);
  begin
    perform public.admin_processing_overview();
    raise exception 'FAIL: S2 a player read the overview';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
  perform pg_temp.as_worker();

  -- The private helpers are nobody's to call.
  foreach f in array array[
    'public._is_player_replace_job(text)',
    'public._repoint_point_share_links(uuid, uuid, uuid)',
    'public._version_source_offset(uuid)',
    'public._cancel_followups_of_deleted_match()',
    'public._hand_over_stale_device_hand_cuts()',
    'public.activate_match_processing_version(uuid, uuid)',
    'public.media_keys_in_use(text[], uuid[])',
    'public.jobs_notify_failed()',
    'public.match_reels_notify()'] loop
    if has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: private function callable %', f;
    end if;
  end loop;
  foreach f in array array[
    'public.claim_hand_cut(uuid, jsonb)', 'public.claim_device_hand_cut(uuid, jsonb)',
    'public.claim_hand_recut(uuid, jsonb, boolean)', 'public.start_recut(uuid, boolean)',
    'public.note_feed(integer)', 'public.submit_review_order(uuid, uuid, jsonb)',
    'public.admin_processing_overview()'] loop
    if has_function_privilege('anon', f, 'execute')
       or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FAIL: grants of %', f;
    end if;
  end loop;
end $$;

rollback;
select 'post-rollout audit (database): all behaviour checks passed' as result;
