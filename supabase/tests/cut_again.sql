-- Behaviour of 20260925124616_cut_again.sql on an isolated database built
-- by device_hand_cut_stubs.sql, the two device hand-cut migrations and
-- cut_again_stubs.sql (the header there has the commands). Every fixture
-- rolls back. A failure raises 'FAIL: ...'.
\set ON_ERROR_STOP on

-- ------------------------------------------------------------- backfill
do $$ begin
  if (select v.cut_source from public.match_processing_versions v
        join public.matches m on m.active_processing_version_id = v.id
       where m.id = 'eeeeeeee-0000-4000-8000-000000000001') <> 'manual'
     or (select v.cut_source from public.match_processing_versions v
           join public.matches m on m.active_processing_version_id = v.id
          where m.id = 'eeeeeeee-0000-4000-8000-000000000002') <> 'auto'
     or (select cut_source from public.match_processing_versions
          where match_id = 'eeeeeeee-0000-4000-8000-000000000002'
            and status = 'superseded') <> 'manual' then
    raise exception 'FAIL: cut_source backfill';
  end if;
  if (select value from public.app_config where key = 'recut_auto_replace') <> 'off' then
    raise exception 'FAIL: recut_auto_replace not seeded off';
  end if;
  if not exists (select 1 from pg_policies
                  where tablename = 'app_config'
                    and policyname = 'Public app config is readable'
                    and qual like '%recut_auto_replace%'
                    and qual like '%device_hand_cut%'
                    and qual like '%support_email%') then
    raise exception 'FAIL: recut_auto_replace is not on the public read list';
  end if;
end $$;

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

-- A processed automatic match: a done upload job, a cut, n points on the
-- live version (every second one won by the user), and its storage rows.
create function pg_temp.processed(p_owner uuid, p_points int,
                                  p_settings jsonb default '{}')
returns uuid language plpgsql as $$
declare
  m uuid := gen_random_uuid();
  j uuid := gen_random_uuid();
  v uuid;
  i int;
  raw text := 'r2://ponglens-raw/' || p_owner || '/' || m || '.mov';
begin
  insert into public.jobs (id, user_id, kind, status, input_path, options)
  values (j, p_owner, 'deadspace_cut', 'done', raw,
          jsonb_build_object('match_id', m) || p_settings);
  insert into public.matches (id, user_id, status, raw_path, duration_s,
                              content_checked_at, original_name,
                              opponent_name, venue, match_type, user_side,
                              first_server, first_server_source, spoken_scores)
  values (m, p_owner, 'uploaded', raw, 300, now(), 'v.mov', 'Rival', 'Club',
          'match', 'near', 'user', 'user', '[{"game": 1, "you": 11, "them": 5}]');
  update public.matches
     set job_id = j,
         cut_path = 'r2://ponglens-media/results/' || p_owner || '/' || j || '.mp4',
         match_json_path = 'r2://ponglens-media/points/' || p_owner || '/' || m || '/match.json',
         thumb_path = 'r2://ponglens-media/points/' || p_owner || '/' || m || '/thumb.webp',
         clip_pads = '{"pre": 1.5, "post": 1.5}',
         status = 'ready'
   where id = m;
  select active_processing_version_id into v from public.matches where id = m;
  for i in 1..p_points loop
    insert into public.points (match_id, processing_version_id, idx, t0, t1,
                               cut_t0, clip_path, confirmed_winner, placement)
    values (m, v, i, 10 * i, 10 * i + 6, 8 * i,
            'r2://ponglens-media/points/' || p_owner || '/' || m || '/'
              || lpad(i::text, 2, '0') || '.mp4',
            case when i % 2 = 0 then 'user' end,
            jsonb_build_object('candidates', '[]'::jsonb, 'v', 'old'));
  end loop;
  insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key) values
    (p_owner, m, 'other', 1000, raw),
    (p_owner, m, 'cut', 500, 'r2://ponglens-media/results/' || p_owner || '/' || j || '.mp4'),
    (p_owner, m, 'clip', 200, 'r2://ponglens-media/points/' || p_owner || '/' || m || '/'),
    (p_owner, m, 'clip', 30, 'r2://ponglens-media/points/' || p_owner || '/' || m
                             || '/versions/' || v || '/03-abcdef12.mp4');
  return m;
end $$;

-- The marks the marker would send for n points, in the claim's short form.
create function pg_temp.marks(n integer default 4) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('t0', 12 + 20 * i, 't1', 18 + 20 * i,
                                      'w', case when i % 2 = 0 then 'opponent' end,
                                      'let', false, 'star', i = 0,
                                      'tap', 12.8 + 20 * i, 'rate', 1)
                   order by i)
    from generate_series(0, n - 1) as i
$$;

-- What the hand lane writes before publishing a candidate: one point per
-- frozen mark, on the candidate version, clip under versions/<version>/.
create function pg_temp.candidate_points(p_match uuid, p_job uuid,
                                         p_missing_clip integer default 0)
returns uuid language plpgsql as $$
declare
  v uuid;
  u uuid;
  mk jsonb;
  i int := 0;
begin
  select id into v from public.match_processing_versions where job_id = p_job;
  select user_id into u from public.matches where id = p_match;
  for mk in select e from jsonb_array_elements(
              (select marks from public.hand_cut_drafts where match_id = p_match)) e
            order by (e->>'t0')::numeric loop
    i := i + 1;
    insert into public.points (match_id, processing_version_id, idx, t0, t1,
                               cut_t0, clip_path, edited, confirmed_winner,
                               is_let, starred)
    values (p_match, v, i, (mk->>'t0')::numeric, (mk->>'t1')::numeric, i * 3,
            case when i = p_missing_clip then null
                 else 'r2://ponglens-media/points/' || u || '/' || p_match
                      || '/versions/' || v || '/' || lpad(i::text, 2, '0') || '.mp4' end,
            i = p_missing_clip,
            mk->>'w', coalesce((mk->>'let')::boolean, false),
            coalesce((mk->>'star')::boolean, false));
  end loop;
  return v;
end $$;

begin;
insert into public.app_config (key, value) values ('hand_cut', 'off'),
  ('reclip_lane', 'fast')
  on conflict (key) do update set value = excluded.value;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'player@example.com');

-- ------------------------------------------------------------ recut_options
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  player uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  m uuid;
  pm uuid;
  up uuid;
  o jsonb;
begin
  m := pg_temp.processed(admin, 5);
  pm := pg_temp.processed(player, 3);
  perform pg_temp.act(admin, true);
  o := public.recut_options(m);
  if o <> jsonb_build_object('available', true, 'reason', null,
                             'replace_by_hand', true, 'replace_automatic', false,
                             'has_coach_review', false, 'has_match_notes', false,
                             'cut_source', 'auto') then
    raise exception 'FAIL: recut_options on a processed match %', o;
  end if;

  -- The owner only: a coach (or anyone else) gets not_found.
  begin
    perform public.recut_options(pm);
    raise exception 'FAIL: options for another account''s match';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;

  -- A player hand cutting is not open to: no hand-cut rows.
  perform pg_temp.act(player, false);
  o := public.recut_options(pm);
  if (o->>'available')::boolean is not true or (o->>'replace_by_hand')::boolean then
    raise exception 'FAIL: hand rows offered without hand_cut %', o;
  end if;
  update public.app_config set value = 'user:' || player where key = 'hand_cut';
  if not (public.recut_options(pm)->>'replace_by_hand')::boolean then
    raise exception 'FAIL: hand rows refused with hand_cut';
  end if;
  update public.app_config set value = 'off' where key = 'hand_cut';

  -- Match notes (not point notes) and coach reviews (assumption A).
  perform pg_temp.act(admin, true);
  insert into public.notes (match_id, point_id, body)
  values (m, (select id from public.points where match_id = m limit 1), 'point note');
  if (public.recut_options(m)->>'has_match_notes')::boolean then
    raise exception 'FAIL: a point note counted as a match note';
  end if;
  insert into public.notes (match_id, body) values (m, 'match note');
  if not (public.recut_options(m)->>'has_match_notes')::boolean then
    raise exception 'FAIL: match note not seen';
  end if;
  insert into public.review_orders (match_id, status) values (m, 'cancelled');
  if (public.recut_options(m)->>'has_coach_review')::boolean then
    raise exception 'FAIL: a cancelled order counted as a review';
  end if;
  insert into public.review_orders (match_id, status) values (m, 'in_review');
  o := public.recut_options(m);
  if not (o->>'has_coach_review')::boolean or (o->>'replace_by_hand')::boolean
     or not (o->>'available')::boolean then
    raise exception 'FAIL: coach review options %', o;
  end if;

  -- The automatic Replace switch.
  update public.app_config set value = 'on' where key = 'recut_auto_replace';
  if (public.recut_options(m)->>'replace_automatic')::boolean then
    raise exception 'FAIL: automatic replace offered over a coach review';
  end if;
  delete from public.review_orders where match_id = m;
  if not (public.recut_options(m)->>'replace_automatic')::boolean then
    raise exception 'FAIL: recut_auto_replace on is not read';
  end if;
  update public.app_config set value = 'admins' where key = 'recut_auto_replace';
  if not (public.recut_options(m)->>'replace_automatic')::boolean then
    raise exception 'FAIL: admins value refuses an admin';
  end if;
  update public.app_config set value = 'off' where key = 'recut_auto_replace';

  -- Reasons.
  up := gen_random_uuid();
  insert into public.matches (id, user_id, status, raw_path, duration_s)
  values (up, admin, 'uploaded', 'r2://ponglens-raw/' || admin || '/u.mov', 300);
  o := public.recut_options(up);
  if (o->>'available')::boolean or o->>'reason' <> 'not_ready'
     or (o->>'replace_by_hand')::boolean then
    raise exception 'FAIL: unprocessed match %', o;
  end if;
  insert into public.match_processing_feedback (match_id, owner_id, kind, status)
  values (m, admin, 'reprocess', 'pending');
  if public.recut_options(m)->>'reason' <> 'support_request' then
    raise exception 'FAIL: support request not a reason';
  end if;
  update public.match_processing_feedback set status = 'declined' where match_id = m;
  if public.recut_options(m)->>'reason' is not null then
    raise exception 'FAIL: a decided request still blocks';
  end if;
  insert into public.jobs (user_id, kind, status, options)
  values (admin, 'reclip', 'queued', jsonb_build_object('match_id', m));
  if public.recut_options(m)->>'reason' is not null then
    raise exception 'FAIL: a reclip is not a cut';
  end if;
  insert into public.jobs (user_id, kind, status, options)
  values (admin, 'content_check', 'queued', jsonb_build_object('match_id', m));
  if public.recut_options(m)->>'reason' <> 'processing' then
    raise exception 'FAIL: a queued content check does not block';
  end if;
  delete from public.jobs where kind in ('reclip', 'content_check');
  update public.matches set raw_path = null where id = m;
  if public.recut_options(m)->>'reason' <> 'no_source' then
    raise exception 'FAIL: no original not a reason';
  end if;
end $$;

-- -------------------------------------------------------------- start_recut
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  player uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  m uuid;
  t uuid;
  v uuid;
  r jsonb;
  r2 jsonb;
  before jsonb;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 5);
  update public.points set is_let = true, confirmed_winner = null
   where match_id = m and idx = 3;
  update public.points set starred = true where match_id = m and idx = 1;
  update public.points set deleted = true where match_id = m and idx = 5;
  select to_jsonb(x) into before from public.matches x where id = m;

  r := public.start_recut(m);
  if r->>'mode' <> 'score' or jsonb_array_length(r->'marks') <> 4
     or r->>'updated_at' is null then
    raise exception 'FAIL: start_recut %', r;
  end if;
  if r->'marks'->0 <> jsonb_build_object(
       'id', (select id from public.points where match_id = m and idx = 1)::text,
       't0', 10.000, 't1', 16.000, 'winner', null, 'isLet', false,
       'starred', true, 'tap', null, 'rate', null)
     or r->'marks'->1->>'winner' <> 'user'
     or (r->'marks'->2->>'isLet')::boolean is not true
     or r->'marks'->2->'winner' <> 'null'::jsonb then
    raise exception 'FAIL: mark shape %', r->'marks';
  end if;
  if (select submitted_at from public.hand_cut_drafts where match_id = m) is not null
     or (select mode from public.hand_cut_drafts where match_id = m) <> 'score'
     or (select marks from public.hand_cut_drafts where match_id = m) <> r->'marks' then
    raise exception 'FAIL: draft not written';
  end if;
  if (select to_jsonb(x) from public.matches x where id = m) <> before then
    raise exception 'FAIL: start_recut changed the match';
  end if;

  -- Resume: an unsubmitted draft comes back as it is.
  update public.hand_cut_drafts set marks = '[{"t0": 1, "t1": 3}]', mode = null
   where match_id = m;
  r2 := public.start_recut(m);
  if r2->'marks' <> '[{"t0": 1, "t1": 3}]'::jsonb or r2->>'mode' <> 'cut' then
    raise exception 'FAIL: resume %', r2;
  end if;
  -- Fresh: written again from the points.
  r2 := public.start_recut(m, true);
  if r2->'marks' <> r->'marks' then
    raise exception 'FAIL: fresh did not rebuild %', r2;
  end if;
  -- A frozen draft (the marks of a past cut) is rebuilt and unfrozen.
  update public.hand_cut_drafts set submitted_at = now(), marks = '[]'
   where match_id = m;
  r2 := public.start_recut(m);
  if jsonb_array_length(r2->'marks') <> 4
     or (select submitted_at from public.hand_cut_drafts where match_id = m) is not null then
    raise exception 'FAIL: frozen draft not rebuilt %', r2;
  end if;
  -- An unsent draft from before this cut existed (the raw page, before the
  -- match was processed automatically) is stale: rebuilt, not resumed.
  update public.hand_cut_drafts
     set marks = '[{"t0": 1, "t1": 3}]', updated_at = now() - interval '1 hour'
   where match_id = m;
  r2 := public.start_recut(m);
  if jsonb_array_length(r2->'marks') <> 4 then
    raise exception 'FAIL: a draft older than the cut was resumed %', r2;
  end if;

  -- Nothing scored: 'cut'. A trimmed upload adds its trim start back.
  -- Overlap, too short, past the end: clamped the claim's way.
  t := pg_temp.processed(admin, 0, '{"trim_start_s": 30, "trim_end_s": 280}');
  select active_processing_version_id into v from public.matches where id = t;
  insert into public.points (match_id, processing_version_id, idx, t0, t1) values
    (t, v, 1, 5, 12),        -- 35 to 42
    (t, v, 2, 11, 20),       -- starts inside the first: 42 to 50
    (t, v, 3, 20.2, 20.6),   -- 0.4 s: dropped
    (t, v, 4, 260, 290);     -- 290 to 320, clamped to the video's 300
  r := public.start_recut(t);
  if r->>'mode' <> 'cut'
     or (select jsonb_agg(jsonb_build_array((x->>'t0')::numeric, (x->>'t1')::numeric))
           from jsonb_array_elements(r->'marks') x)
        <> '[[35, 42], [42, 50], [290, 300]]'::jsonb then
    raise exception 'FAIL: trim offset and clamping %', r->'marks';
  end if;
  -- ... and what it wrote is exactly what the claim accepts.
  perform public._hand_cut_validate_marks(
    (select jsonb_agg(jsonb_build_object('t0', x->'t0', 't1', x->'t1'))
       from jsonb_array_elements(r->'marks') x), 300);

  -- Refusals.
  perform pg_temp.act(player, false);
  begin
    perform public.start_recut(m);
    raise exception 'FAIL: start_recut without hand_cut';
  exception when insufficient_privilege then
    if sqlerrm <> 'not_enabled' then raise; end if;
  end;
  perform pg_temp.act(admin, true);
  insert into public.match_processing_feedback (match_id, owner_id, kind, status)
  values (m, admin, 'refund', 'pending');
  begin
    perform public.start_recut(m);
    raise exception 'FAIL: start_recut during a support request';
  exception when raise_exception then
    if sqlerrm <> 'support_request' then raise; end if;
  end;
end $$;

-- --------------------------------------------- claim_hand_recut: Replace
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  m2 uuid;
  up uuid;
  r jsonb;
  j uuid;
  v public.match_processing_versions%rowtype;
  job public.jobs%rowtype;
  before jsonb;
  live_points integer;
  sent integer;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 5);
  select to_jsonb(x) into before from public.matches x where id = m;
  select count(*) into live_points from public.points where match_id = m;
  select count(*) into sent from pgmq.sent;

  r := public.claim_hand_recut(m, pg_temp.marks(), true);
  j := (r->>'job_id')::uuid;
  if r <> jsonb_build_object('job_id', j, 'match_id', m) then
    raise exception 'FAIL: replace claim returned %', r;
  end if;
  select * into v from public.match_processing_versions where job_id = j;
  select * into job from public.jobs where id = j;
  if v.status <> 'candidate' or v.issue_id is not null
     or v.source_version_id <> (before->>'active_processing_version_id')::uuid
     or v.cut_source <> 'manual' or v.raw_path <> before->>'raw_path' then
    raise exception 'FAIL: candidate version %', row_to_json(v);
  end if;
  if job.kind <> 'hand_cut' or job.status <> 'queued'
     or job.options->>'recut' <> 'replace'
     or job.options->>'match_id' <> m::text
     or job.options->>'processing_version_id' <> v.id::text
     or job.options->>'originating_match_job_id' <> j::text then
    raise exception 'FAIL: candidate job %', row_to_json(job);
  end if;
  if (select count(*) from pgmq.sent) <> sent + 1
     or (select queue from pgmq.sent order by id desc limit 1) <> 'jobs_hand' then
    raise exception 'FAIL: the candidate job was not queued on the hand lane';
  end if;
  if (select to_jsonb(x) from public.matches x where id = m) <> before
     or (select count(*) from public.points where match_id = m) <> live_points then
    raise exception 'FAIL: the claim touched the live match';
  end if;
  if (select submitted_at from public.hand_cut_drafts where match_id = m) is null
     or (select marks from public.hand_cut_drafts where match_id = m) <> pg_temp.marks() then
    raise exception 'FAIL: the marks were not frozen';
  end if;

  -- The player's pages see the running re-cut: the feed names its job
  -- and the hand lane's stage, not the live cut's finished job.
  insert into public.worker_pulse (worker_id, lane, host, beat_at, job_id, stage)
  values ('mac:hand', 'hand', 'mac', now(), j, 'cut');
  r := public.my_match_processing_feedback(array[m])->0;
  if r->>'job_id' <> j::text or r->>'job_kind' <> 'hand_cut'
     or r->>'job_status' <> 'queued' or r->>'lane' <> 'hand' or r->>'stage' <> 'cut' then
    raise exception 'FAIL: the feed does not show the running re-cut %', r;
  end if;
  delete from public.worker_pulse where worker_id = 'mac:hand';

  -- One open cut per match.
  if public.recut_options(m)->>'reason' <> 'processing' then
    raise exception 'FAIL: options while a re-cut runs';
  end if;
  begin
    perform public.claim_hand_recut(m, pg_temp.marks(), false);
    raise exception 'FAIL: a second claim';
  exception when raise_exception then
    if sqlerrm <> 'already_processing' then raise; end if;
  end;
  begin
    perform public.start_recut(m);
    raise exception 'FAIL: start_recut while a re-cut runs';
  exception when raise_exception then
    if sqlerrm <> 'processing' then raise; end if;
  end;
  begin
    insert into public.match_processing_versions (match_id, source_version_id, status)
    values (m, (before->>'active_processing_version_id')::uuid, 'candidate');
    raise exception 'FAIL: a second open candidate on one match';
  exception when unique_violation then null;
  end;

  -- The refusals.
  m2 := pg_temp.processed(admin, 3);
  insert into public.review_orders (match_id, status) values (m2, 'completed');
  begin
    perform public.claim_hand_recut(m2, pg_temp.marks(), true);
    raise exception 'FAIL: replaced a reviewed match';
  exception when raise_exception then
    if sqlerrm <> 'coach_review' then raise; end if;
  end;
  begin
    perform public.claim_hand_recut(m2, '[{"t0": 5, "t1": 5.3}]', true);
    raise exception 'FAIL: coach review checked after the marks';
  exception when raise_exception then
    if sqlerrm <> 'coach_review' then raise; end if;
  end;
  delete from public.review_orders where match_id = m2;
  begin
    perform public.claim_hand_recut(m2, '[{"t0": 5, "t1": 5.3}]', true);
    raise exception 'FAIL: short mark accepted';
  exception when check_violation then
    if sqlerrm <> 'invalid_marks' then raise; end if;
  end;
  begin
    perform public.claim_hand_recut(m2, null, true);
    raise exception 'FAIL: null marks accepted';
  exception when check_violation then
    if sqlerrm <> 'invalid_marks' then raise; end if;
  end;
  begin
    perform public.claim_hand_recut(m2, pg_temp.marks(), null);
    raise exception 'FAIL: no choice accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_request' then raise; end if;
  end;
  insert into public.match_processing_feedback (match_id, owner_id, kind, status)
  values (m2, admin, 'reprocess', 'candidate_ready');
  begin
    perform public.claim_hand_recut(m2, pg_temp.marks(), true);
    raise exception 'FAIL: claimed during a support request';
  exception when raise_exception then
    if sqlerrm <> 'support_request' then raise; end if;
  end;
  up := gen_random_uuid();
  insert into public.matches (id, user_id, status, raw_path, duration_s)
  values (up, admin, 'uploaded', 'r2://ponglens-raw/' || admin || '/u.mov', 300);
  begin
    perform public.claim_hand_recut(up, pg_temp.marks(), true);
    raise exception 'FAIL: claimed a re-cut of an unprocessed match';
  exception when raise_exception then
    if sqlerrm <> 'bad_state' then raise; end if;
  end;
  update public.app_config set value = 'off' where key = 'hand_cut';
  perform pg_temp.act('bbbbbbbb-0000-4000-8000-000000000002', false);
  begin
    perform public.claim_hand_recut(m, pg_temp.marks(), true);
    raise exception 'FAIL: claimed without hand_cut';
  exception when insufficient_privilege then
    if sqlerrm <> 'not_enabled' then raise; end if;
  end;
  -- Out of the way of the fairness cap below.
  update public.jobs set status = 'done' where id = j;
end $$;

-- ------------------------------------------------ claim_hand_recut: Keep
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  n uuid;
  r jsonb;
  j uuid;
  before jsonb;
  src public.matches%rowtype;
  dst public.matches%rowtype;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 5);
  perform public.start_recut(m);
  insert into public.notes (match_id, body) values (m, 'match note');
  select to_jsonb(x) into before from public.matches x where id = m;

  r := public.claim_hand_recut(m, pg_temp.marks(), false);
  j := (r->>'job_id')::uuid;
  n := (r->>'match_id')::uuid;
  if n = m or r <> jsonb_build_object('job_id', j, 'match_id', n) then
    raise exception 'FAIL: keep claim returned %', r;
  end if;
  select * into src from public.matches where id = m;
  select * into dst from public.matches where id = n;
  if dst.status <> 'uploaded' or dst.raw_path <> src.raw_path
     or dst.duration_s <> src.duration_s or dst.content_checked_at is null
     or dst.opponent_name <> src.opponent_name or dst.venue <> src.venue
     or dst.match_type <> src.match_type or dst.user_side <> src.user_side
     or dst.first_server <> src.first_server
     or dst.first_server_source <> src.first_server_source
     or dst.played_at <> src.played_at or dst.cut_path is not null
     or dst.job_id <> j or dst.cut_source <> 'manual' then
    raise exception 'FAIL: the new match %', row_to_json(dst);
  end if;
  if (select kind || ':' || status || ':' || (options->>'match_id') || ':'
             || coalesce(options->>'recut', '') || ':'
             || coalesce(options->>'recut_from_match_id', '')
       from public.jobs where id = j)
     <> 'hand_cut:queued:' || n || ':keep:' || m then
    raise exception 'FAIL: keep job %', (select options from public.jobs where id = j);
  end if;
  if (select submitted_at from public.hand_cut_drafts where match_id = n) is null
     or exists (select 1 from public.hand_cut_drafts where match_id = m) then
    raise exception 'FAIL: the marks did not move to the new match';
  end if;
  if (select to_jsonb(x) from public.matches x where id = m) <> before
     or exists (select 1 from public.points where match_id = n)
     or exists (select 1 from public.notes where match_id = n)
     or exists (select 1 from public.storage_ledger where match_id = n) then
    raise exception 'FAIL: keep changed the original or copied its data';
  end if;
  set constraints all immediate;
  set constraints all deferred;
  update public.jobs set status = 'done' where id = j;
  -- A refused claim on the copy takes the copy with it.
  m := pg_temp.processed(admin, 2);
  begin
    perform public.claim_hand_recut(m, '[{"t0": 5, "t1": 5.3}]', false);
    raise exception 'FAIL: keep with bad marks';
  exception when check_violation then
    if sqlerrm <> 'invalid_marks' then raise; end if;
  end;
  if (select count(*) from public.matches
       where raw_path = (select raw_path from public.matches where id = m)) <> 1 then
    raise exception 'FAIL: a refused keep left a copy behind';
  end if;
end $$;

-- ---------------------------------------------------- copy_match_for_recut
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  n uuid;
  m2 uuid;
  n2 uuid;
  raw text;
  counted bigint;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 4);
  update public.matches set content_checked_at = null where id = m;
  raw := (select raw_path from public.matches where id = m);
  n := public.copy_match_for_recut(m);
  if (select status from public.matches where id = n) <> 'uploaded'
     or (select raw_path from public.matches where id = n) <> raw
     or (select content_checked_at from public.matches where id = n) is null
     or (select cut_source from public.matches where id = n) <> 'auto'
     or (select job_id from public.matches where id = n) is not null
     or exists (select 1 from public.jobs where options->>'match_id' = n::text) then
    raise exception 'FAIL: copy_match_for_recut row';
  end if;
  if (select count(*) from public.match_processing_versions where match_id = n) <> 1 then
    raise exception 'FAIL: the copy has no version of its own';
  end if;

  -- Stored and counted once, whichever match is deleted first.
  select sum(bytes) into counted from public.storage_ledger where r2_key = raw;
  if counted <> 1000 then raise exception 'FAIL: the copy booked the original'; end if;
  delete from public.matches where id = m;
  if (select sum(bytes) from public.storage_ledger where r2_key = raw) <> 1000
     or (select sum(bytes) from public.storage_ledger
          where r2_key = raw and match_id = n) <> 1000 then
    raise exception 'FAIL: deleting the original uncounted the shared original';
  end if;
  delete from public.matches where id = n;
  if (select sum(bytes) from public.storage_ledger where r2_key = raw) <> 0 then
    raise exception 'FAIL: deleting the last match left the original counted';
  end if;
  set constraints all immediate;
  set constraints all deferred;

  m2 := pg_temp.processed(admin, 2);
  raw := (select raw_path from public.matches where id = m2);
  n2 := public.copy_match_for_recut(m2);
  delete from public.matches where id = n2;
  if (select sum(bytes) from public.storage_ledger where r2_key = raw) <> 1000 then
    raise exception 'FAIL: deleting the copy uncounted the original';
  end if;

  -- Two matches that each already count the same original (older copies
  -- between matches did that): deleting one uncounts its own row only.
  n2 := public.copy_match_for_recut(m2);
  insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key)
  values (admin, n2, 'other', 1000, raw);
  delete from public.matches where id = m2;
  if (select sum(bytes) from public.storage_ledger where r2_key = raw) <> 1000
     or (select sum(bytes) from public.storage_ledger where r2_key = raw and match_id = n2) <> 1000 then
    raise exception 'FAIL: a doubly counted original stayed doubly counted';
  end if;
  m2 := n2;
  update public.matches set status = 'ready', cut_path = 'r2://c' where id = m2;

  -- The same refusals as the options.
  update public.matches set status = 'processing' where id = m2;
  begin
    perform public.copy_match_for_recut(m2);
    raise exception 'FAIL: copied an unready match';
  exception when raise_exception then
    if sqlerrm <> 'not_ready' then raise; end if;
  end;
end $$;

-- -------------------------------------------- publishing a candidate
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  j uuid;
  cv uuid;
  old_v uuid;
  old_cut text;
  r jsonb;
  r2 jsonb;
  mm public.matches%rowtype;
  cut text;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 5);
  select active_processing_version_id, cut_path into old_v, old_cut
    from public.matches where id = m;
  insert into public.match_reels (match_id, scope, status, r2_key)
  values (m, 'highlights', 'ready', 'reels/old.mp4');
  insert into public.share_links (token, match_id, kind)
  values ('tok-0123456789abcdef0123456789abcdef', m, 'match');
  insert into public.share_links (token, match_id, point_id, kind)
  select 'pt-0123456789abcdef0123456789abcdef', m, id, 'point'
    from public.points where match_id = m and idx = 1;
  if (select cut_source from public.resolve_share_link('tok-0123456789abcdef0123456789abcdef')) <> 'auto' then
    raise exception 'FAIL: share link cut_source before the swap';
  end if;
  j := (public.claim_hand_recut(m, pg_temp.marks(), true)->>'job_id')::uuid;

  -- The hand lane picks it up and writes the candidate's points.
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  cv := pg_temp.candidate_points(m, j);
  update public.points set placement = '{"candidates": [], "v": "new"}'
   where processing_version_id = cv;
  -- The live match still shows the old cut to everyone.
  if (select count(*) from public.resolve_share_placement('tok-0123456789abcdef0123456789abcdef')) <> 5 then
    raise exception 'FAIL: share placement before the swap';
  end if;
  cut := 'r2://ponglens-media/results/' || admin || '/' || m || '/versions/' || cv || '.mp4';
  delete from public.notifications;
  r := public.publish_hand_recut(m, j, cut,
         'r2://ponglens-media/points/' || admin || '/' || m || '/versions/' || cv || '/thumb-' || j || '.webp',
         'r2://ponglens-media/points/' || admin || '/' || m || '/versions/' || cv || '/match.json',
         '{"pre": 1.2, "post": 1.3}');
  if not (r->>'activated')::boolean or (r->>'ok')::boolean is not true
     or (r->>'contractVersion')::int <> 1 or (r->>'pointCount')::int <> 4
     or (r->>'observationCount')::int <> 8 or (r->>'missingClipCount')::int <> 0
     or r->>'scoreProjectionStatus' <> 'current' or r->>'previousVersionId' <> old_v::text then
    raise exception 'FAIL: publish receipt %', r;
  end if;

  select * into mm from public.matches where id = m;
  if mm.active_processing_version_id <> cv or mm.cut_path <> cut
     or mm.cut_source <> 'manual' or mm.job_id <> j or mm.status <> 'ready'
     or mm.clip_pads <> '{"pre": 1.2, "post": 1.3}'::jsonb
     or mm.first_server <> 'user' or mm.first_server_source <> 'user'
     or mm.spoken_scores is null or mm.placement_status <> 'not_requested'
     or mm.score_projection_revision <> mm.score_revision then
    raise exception 'FAIL: the match after the swap %', row_to_json(mm);
  end if;
  if (select status || ':' || cut_source from public.match_processing_versions where id = old_v)
       <> 'superseded:auto'
     or (select status || ':' || cut_source from public.match_processing_versions where id = cv)
       <> 'active:manual' then
    raise exception 'FAIL: version states';
  end if;
  if (select status from public.jobs where id = j) <> 'done'
     or (select result_path from public.jobs where id = j) <> cut then
    raise exception 'FAIL: the job was not finished';
  end if;
  -- The ordinary ready bell, once.
  if (select count(*) from public.notifications
       where user_id = admin and kind = 'match_ready' and match_id = m
         and title = 'Match ready'
         and body = 'Your match vs Rival is cut into points and ready to review.') <> 1 then
    raise exception 'FAIL: ready bell %', (select jsonb_agg(to_jsonb(n)) from public.notifications n);
  end if;
  -- The replaced cut and its clips stop counting; the original and the new
  -- cut's rows do not move.
  if (select sum(bytes) from public.storage_ledger where r2_key = old_cut) <> 0
     or (select sum(bytes) from public.storage_ledger
          where r2_key = 'r2://ponglens-media/points/' || admin || '/' || m || '/') <> 0
     or (select sum(bytes) from public.storage_ledger
          where r2_key like '%/versions/' || old_v || '/%') <> 0
     or (select sum(bytes) from public.storage_ledger
          where r2_key = (select raw_path from public.matches where id = m)) <> 1000 then
    raise exception 'FAIL: storage after the swap %',
      (select jsonb_agg(jsonb_build_array(r2_key, bytes, match_id)) from public.storage_ledger
        where match_id = m);
  end if;
  if exists (select 1 from public.storage_ledger where bytes < 0 and match_id is null
              and r2_key like '%' || m || '%') then
    raise exception 'FAIL: the negation lost its match';
  end if;
  -- Observations on the candidate's own points, the receipt recorded once.
  if (select count(*) from public.point_timing_observations
       where match_id = m and media_revision = cv and origin = 'manual_cutter') <> 8
     or (select count(*) from public.match_score_mutations where request_id = j) <> 1 then
    raise exception 'FAIL: observations or receipt';
  end if;
  -- Share page: only the new cut's dots.
  if (select count(*) from public.resolve_share_placement('tok-0123456789abcdef0123456789abcdef')) <> 4
     or exists (select 1 from public.resolve_share_placement('tok-0123456789abcdef0123456789abcdef') s
                 where s.placement->>'v' <> 'new') then
    raise exception 'FAIL: share placement mixed the cuts';
  end if;
  -- The public link: a match link now plays a hand cut; a point link
  -- keeps its own (automatic) cut.
  if (select cut_source || ':' || cut_path from public.resolve_share_link('tok-0123456789abcdef0123456789abcdef'))
       <> 'manual:' || cut
     or (select cut_source || ':' || cut_path from public.resolve_share_link('pt-0123456789abcdef0123456789abcdef'))
       <> 'auto:' || old_cut then
    raise exception 'FAIL: share link after the swap';
  end if;
  -- Old reels marked stale and archived with the old version.
  if (select status from public.match_reels where match_id = m and scope = 'highlights') <> 'failed'
     or not exists (select 1 from public.match_processing_version_reels where version_id = old_v) then
    raise exception 'FAIL: reels after the swap';
  end if;
  -- Every deferred check (one live version per match, points on their
  -- match's versions) holds after the swap.
  set constraints all immediate;
  set constraints all deferred;
  -- Publishing again answers the same receipt and changes nothing.
  r2 := public.publish_hand_recut(m, j, null, null, null, null);
  if r2 <> r or (select count(*) from public.notifications where kind = 'match_ready') <> 1 then
    raise exception 'FAIL: publish is not idempotent %', r2;
  end if;
  -- The match is free again.
  perform pg_temp.act(admin, true);
  if public.recut_options(m)->>'reason' is not null
     or public.recut_options(m)->>'cut_source' <> 'manual' then
    raise exception 'FAIL: options after the swap %', public.recut_options(m);
  end if;
end $$;

-- ---------------------------------- a candidate that waits to be made live
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  j uuid;
  cv uuid;
  old_v uuid;
  rc uuid;
  r jsonb;
  done jsonb;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 3);
  delete from public.notifications;
  select active_processing_version_id into old_v from public.matches where id = m;
  j := (public.claim_hand_recut(m, pg_temp.marks(3), true)->>'job_id')::uuid;
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  -- The second clip failed to encode: point kept, edited, no file.
  cv := pg_temp.candidate_points(m, j, 2);
  -- The player edited the live cut meanwhile: a reclip is queued on it.
  insert into public.jobs (id, user_id, kind, status, options)
  values (gen_random_uuid(), admin, 'reclip', 'queued',
          jsonb_build_object('match_id', m))
  returning id into rc;
  if exists (select 1 from public.jobs where kind = 'reclip'
              and options->>'processing_version_id' = cv::text) then
    raise exception 'FAIL: a reclip was queued for an inactive version';
  end if;

  r := public.publish_hand_recut(m, j, 'r2://ponglens-media/results/c.mp4',
                                 null, 'r2://ponglens-media/points/c/match.json',
                                 '{"pre": 1.2, "post": 1.3}');
  if (r->>'activated')::boolean or (r->>'missingClipCount')::int <> 1 then
    raise exception 'FAIL: made live over running derived work %', r;
  end if;
  if (select active_processing_version_id from public.matches where id = m) <> old_v
     or (select status from public.match_processing_versions where id = cv) <> 'ready'
     or (select status from public.jobs where id = j) <> 'done'
     or exists (select 1 from public.notifications where kind = 'match_ready') then
    raise exception 'FAIL: a refused swap changed the live match';
  end if;
  -- Still busy for the player, and support cannot start either.
  perform pg_temp.act(admin, true);
  if public.recut_options(m)->>'reason' <> 'processing' then
    raise exception 'FAIL: a waiting candidate does not read as processing';
  end if;
  perform pg_temp.as_worker();
  -- The worker's retry, as a redelivered message would make it (the
  -- pickup claims the job again): still refused while the reclip runs,
  -- and the job is finished again.
  update public.jobs set status = 'processing' where id = j;
  if (public.activate_hand_recut(j)->>'activated')::boolean then
    raise exception 'FAIL: activate_hand_recut over running work';
  end if;
  if (select status from public.jobs where id = j) <> 'done' then
    raise exception 'FAIL: a redelivered ready candidate left its job running';
  end if;
  if public.activate_pending_hand_recuts() <> '[]'::jsonb then
    raise exception 'FAIL: the sweep made it live over running work';
  end if;
  -- The reclip finishes; the sweep makes the candidate live and says so.
  update public.jobs set status = 'done' where id = rc;
  done := public.activate_pending_hand_recuts();
  if done <> jsonb_build_array(jsonb_build_object('job_id', j, 'user_id', admin,
                                                  'match_id', m)) then
    raise exception 'FAIL: the sweep %', done;
  end if;
  if (select active_processing_version_id from public.matches where id = m) <> cv
     or (select thumb_path from public.matches where id = m) is null then
    raise exception 'FAIL: the sweep did not make it live';
  end if;
  -- The clip that failed is now asked for, on the live version.
  if not exists (select 1 from public.jobs where kind = 'reclip' and status = 'queued'
                  and options->>'match_id' = m::text
                  and options->>'processing_version_id' = cv::text) then
    raise exception 'FAIL: no reclip for the missing clip';
  end if;
  if public.activate_pending_hand_recuts() <> '[]'::jsonb then
    raise exception 'FAIL: the sweep ran twice';
  end if;
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- --------------------------- a candidate whose match moved on while it waited
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  j uuid;
  cv uuid;
  other uuid;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 3);
  delete from public.notifications;
  j := (public.claim_hand_recut(m, pg_temp.marks(3), true)->>'job_id')::uuid;
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  cv := pg_temp.candidate_points(m, j);
  insert into public.jobs (user_id, kind, status, options)
  values (admin, 'placement_generate', 'processing', jsonb_build_object('match_id', m));
  perform public.publish_hand_recut(m, j, 'r2://ponglens-media/results/c.mp4', null,
                                    'r2://ponglens-media/points/c/match.json',
                                    '{"pre": 1.2, "post": 1.3}');
  update public.jobs set status = 'done' where kind = 'placement_generate';
  -- Someone restored another version meanwhile (a stand-in: a new active).
  update public.match_processing_versions set status = 'superseded'
   where match_id = m and status = 'active';
  insert into public.match_processing_versions (match_id, status, cut_path)
  values (m, 'active', 'r2://x') returning id into other;
  update public.matches set active_processing_version_id = other where id = m;
  if public.activate_pending_hand_recuts() <> '[]'::jsonb then
    raise exception 'FAIL: a stale candidate was made live';
  end if;
  if (select status from public.match_processing_versions where id = cv) <> 'failed'
     or (select submitted_at from public.hand_cut_drafts where match_id = m) is not null
     or (select count(*) from public.notifications
          where title = 'The new cut didn''t finish.' and body = 'Your marks are saved.') <> 1 then
    raise exception 'FAIL: a stale candidate was not handed back';
  end if;
end $$;

-- ------------------------------ a re-cut that fails: the live cut survives
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  u uuid;
  j uuid;
  cv uuid;
  before jsonb;
  live bigint;
  r jsonb;
  handed boolean;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 5);
  delete from public.notifications;
  j := (public.claim_hand_recut(m, pg_temp.marks(), true)->>'job_id')::uuid;
  select to_jsonb(x) into before from public.matches x where id = m;
  select count(*) into live from public.points
   where match_id = m and processing_version_id = (before->>'active_processing_version_id')::uuid;
  perform pg_temp.as_worker();
  cv := pg_temp.candidate_points(m, j);

  -- A publication that does not match the marks is refused whole.
  delete from public.points where processing_version_id = cv and idx = 4;
  update public.jobs set status = 'processing' where id = j;
  begin
    perform public.publish_hand_recut(m, j, 'r2://c', null, 'r2://mj', '{"pre": 1.2}');
    raise exception 'FAIL: published a mismatched candidate';
  exception when check_violation then
    if sqlerrm <> 'manual cut mark/point count mismatch' then raise; end if;
  end;

  -- Terminal failure: the worker fails the job and hands the marks back.
  update public.jobs set status = 'failed',
         user_message = 'The original video could not be read.'
   where id = j;
  if not public._hand_cut_hand_back(j) then
    raise exception 'FAIL: hand back found nothing';
  end if;
  if (select to_jsonb(x) from public.matches x where id = m) <> before
     or (select count(*) from public.points
          where match_id = m and processing_version_id = (before->>'active_processing_version_id')::uuid) <> live
     or exists (select 1 from public.points where processing_version_id = cv)
     or (select status from public.match_processing_versions where id = cv) <> 'failed'
     or (select submitted_at from public.hand_cut_drafts where match_id = m) is not null then
    raise exception 'FAIL: a failed re-cut changed the live match';
  end if;
  -- The bell: the re-cut's words, not the reason and not the old title.
  if (select count(*) from public.notifications
       where user_id = admin and title = 'The new cut didn''t finish.'
         and body = 'Your marks are saved.' and href = '/match/' || m) <> 1
     or exists (select 1 from public.notifications where title = 'Cut failed') then
    raise exception 'FAIL: re-cut bell %', (select jsonb_agg(to_jsonb(n)) from public.notifications n);
  end if;
  -- The marks can be sent again at once, and resume where they were.
  perform pg_temp.act(admin, true);
  if public.recut_options(m)->>'reason' is not null
     or public.start_recut(m)->'marks' <> pg_temp.marks() then
    raise exception 'FAIL: marks after a failed re-cut';
  end if;

  -- An ordinary hand cut handed back still resets its unprocessed match,
  -- deleting only its own version's points; a published one is left alone.
  u := gen_random_uuid();
  insert into public.matches (id, user_id, status, raw_path, duration_s, content_checked_at)
  values (u, admin, 'uploaded', 'r2://ponglens-raw/' || admin || '/h.mov', 300, now());
  r := public.claim_hand_cut(u, pg_temp.marks());
  insert into public.points (match_id, processing_version_id, idx, t0, t1)
  select u, active_processing_version_id, 1, 1, 3 from public.matches where id = u;
  update public.matches set status = 'processing' where id = u;
  -- Called into a variable first: an IF's subqueries share one snapshot
  -- with a function call beside them and would not see its writes.
  handed := public._hand_cut_hand_back((r->>'job_id')::uuid);
  if not handed
     or exists (select 1 from public.points where match_id = u)
     or (select status || ':' || cut_source from public.matches where id = u) <> 'uploaded:auto' then
    raise exception 'FAIL: ordinary hand back';
  end if;
  -- (the worker ends that job; cancelled rings nothing)
  update public.jobs set status = 'cancelled' where id = (r->>'job_id')::uuid;
  r := public.claim_hand_cut(u, pg_temp.marks());
  update public.matches set status = 'ready', cut_path = 'r2://done' where id = u;
  handed := public._hand_cut_hand_back((r->>'job_id')::uuid);
  if handed or (select status from public.matches where id = u) <> 'ready' then
    raise exception 'FAIL: handed back a published hand cut';
  end if;
  -- An ordinary hand cut's failure keeps its own bell.
  update public.jobs set status = 'failed' where id = (r->>'job_id')::uuid;
  if not exists (select 1 from public.notifications where title = 'Cut failed') then
    raise exception 'FAIL: the ordinary hand-cut bell';
  end if;
end $$;

-- ------------------------------------- support waits for the player's re-cut
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  m uuid;
  i uuid;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.processed(admin, 3);
  perform public.claim_hand_recut(m, pg_temp.marks(3), true);
  insert into public.match_processing_feedback
    (match_id, owner_id, kind, status, source_version_id, source_job_id)
  select m, admin, 'reprocess', 'pending', active_processing_version_id, job_id
    from public.matches where id = m
  returning id into i;
  begin
    perform public.admin_start_match_reprocess(i, '{}', null);
    raise exception 'FAIL: support started during a player''s re-cut';
  exception when raise_exception then
    if sqlerrm <> 'player re-cut running' then raise; end if;
  end;
  update public.jobs set status = 'done'
   where kind = 'hand_cut' and options->>'match_id' = m::text;
end $$;

-- -------------------------------------------- activation projects cut_source
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  u uuid;
  m uuid;
  j uuid;
  v uuid;
begin
  perform pg_temp.act(admin, true);
  -- The live version follows the column while it is live.
  u := gen_random_uuid();
  insert into public.matches (id, user_id, status, raw_path, duration_s, content_checked_at)
  values (u, admin, 'uploaded', 'r2://ponglens-raw/' || admin || '/s.mov', 300, now());
  j := (public.claim_hand_cut(u, pg_temp.marks())->>'job_id')::uuid;
  update public.jobs set status = 'done' where id = j;
  if (select v.cut_source from public.match_processing_versions v
        join public.matches x on x.active_processing_version_id = v.id
       where x.id = u) <> 'manual' then
    raise exception 'FAIL: the live version did not follow cut_source';
  end if;
  -- An automatic version made live over a hand cut projects 'auto'.
  perform pg_temp.as_worker();
  m := pg_temp.processed(admin, 2);
  update public.matches set cut_source = 'manual' where id = m;
  insert into public.jobs (id, user_id, kind, status) values
    (gen_random_uuid(), admin, 'match_reprocess', 'done') returning id into j;
  insert into public.match_processing_versions
    (match_id, source_version_id, job_id, status, cut_path, match_json_path,
     completed_at, match_state, cut_source)
  select m, active_processing_version_id, j, 'ready', 'r2://auto.mp4', 'r2://auto.json',
         now(), '{}'::jsonb, 'auto'
    from public.matches where id = m
  returning id into v;
  perform public.activate_match_processing_version(m, v);
  if (select cut_source from public.matches where id = m) <> 'auto'
     or (select cut_source from public.match_processing_versions
          where match_id = m and status = 'superseded') <> 'manual' then
    raise exception 'FAIL: activation did not project cut_source';
  end if;
end $$;

-- ----------------------------------------- clients cannot make hand-cut jobs
grant usage on schema public to authenticated;
grant insert, update, select on public.jobs to authenticated;
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  j uuid;
begin
  perform pg_temp.act(admin, true);
  j := (public.claim_hand_recut(pg_temp.processed(admin, 2), pg_temp.marks(2), true)
          ->>'job_id')::uuid;
  set local role authenticated;
  begin
    insert into public.jobs (user_id, kind, options)
    values (admin, 'hand_cut', jsonb_build_object('recut', 'replace'));
    raise exception 'FAIL: a client created a hand-cut job';
  exception when insufficient_privilege then
    if sqlerrm <> 'hand cut jobs are database-managed' then raise; end if;
  end;
  begin
    update public.jobs set options = options || '{"processing_version_id": "x"}'
     where id = j;
    raise exception 'FAIL: a client changed a hand-cut job';
  exception when insufficient_privilege then
    if sqlerrm <> 'hand cut jobs are database-managed' then raise; end if;
  end;
  -- An upload job's options stay the owner's to edit.
  insert into public.jobs (user_id, kind, options) values (admin, 'deadspace_cut', '{}');
  reset role;
end $$;

-- ------------------------------------------------------------ privileges
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.recut_options(uuid)', 'public.start_recut(uuid, boolean)',
    'public.claim_hand_recut(uuid, jsonb, boolean)',
    'public.copy_match_for_recut(uuid)'] loop
    if not has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: contract call grant %', f;
    end if;
  end loop;
  foreach f in array array[
    'public.publish_hand_recut(uuid, uuid, text, text, text, jsonb)',
    'public.activate_hand_recut(uuid)', 'public.activate_pending_hand_recuts()',
    'public._activate_hand_recut(uuid, uuid, uuid, integer)',
    'public._hand_cut_hand_back(uuid)', 'public._recut_busy(uuid)',
    'public._recut_reason(public.matches)', 'public._copy_match_for_recut(public.matches)',
    'public._recut_marks_from_points(public.matches)',
    'public._hand_cut_validate_marks(jsonb, double precision)',
    'public._ledger_uncount_version_media(uuid, uuid)',
    'public._normalize_manual_cut_observations_for_version(uuid, uuid)'] loop
    if has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: private function callable %', f;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.resolve_share_link(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.resolve_share_link(text)', 'execute') then
    raise exception 'FAIL: the public link lost its grants';
  end if;
  if not has_function_privilege('service_role',
       'public.publish_hand_recut(uuid, uuid, text, text, text, jsonb)', 'execute')
     or not has_function_privilege('service_role',
       'public.activate_pending_hand_recuts()', 'execute') then
    raise exception 'FAIL: service grants';
  end if;
end $$;

rollback;
select 'cut again: all behaviour checks passed' as result;
