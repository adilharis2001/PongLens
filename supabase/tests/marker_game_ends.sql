-- Behaviour of 20260925184230_marker_game_ends.sql on the isolated database
-- marker_game_ends_stubs.sql describes (the header there has the commands),
-- with production's canonical projection, so each publish is checked down
-- to the games it projects. Every fixture rolls back. A failure raises
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

-- A processed, scored automatic match whose owner corrected the games in
-- Keep score, on its live version:
--   1  10-16  user
--   2  20-26  opponent, DELETED, end            (not visible: no mark)
--   3  30-36  user,     end, winner user        (a game the score cannot prove)
--   4  40-46  unscored
--   5  50-56  opponent, continue
--   6  60-66  opponent, winner opponent (no end: a stale answer, kept as is)
create function pg_temp.scored(p_owner uuid) returns uuid
language plpgsql as $$
declare
  m uuid := gen_random_uuid();
  j uuid := gen_random_uuid();
  v uuid;
  raw text := 'r2://ponglens-raw/' || p_owner || '/' || m || '.mov';
begin
  insert into public.jobs (id, user_id, kind, status, input_path, options)
  values (j, p_owner, 'deadspace_cut', 'done', raw, jsonb_build_object('match_id', m));
  insert into public.matches (id, user_id, status, raw_path, duration_s,
                              content_checked_at, original_name, opponent_name,
                              match_type, user_side, first_server, first_server_source)
  values (m, p_owner, 'uploaded', raw, 300, now(), 'v.mov', 'Rival', 'match',
          'near', 'user', 'user');
  update public.matches
     set job_id = j,
         cut_path = 'r2://ponglens-media/results/' || p_owner || '/' || j || '.mp4',
         match_json_path = 'r2://ponglens-media/points/' || p_owner || '/' || m || '/match.json',
         clip_pads = '{"pre": 1.5, "post": 1.5}', status = 'ready'
   where id = m;
  select active_processing_version_id into v from public.matches where id = m;
  insert into public.points (match_id, processing_version_id, idx, t0, t1, cut_t0,
                             clip_path, confirmed_winner, deleted,
                             game_end_override, game_winner_override) values
    (m, v, 1, 10, 16, 8,  'r2://c/01.mp4', 'user',     false, null,       null),
    (m, v, 2, 20, 26, 16, 'r2://c/02.mp4', 'opponent', true,  'end',      null),
    (m, v, 3, 30, 36, 24, 'r2://c/03.mp4', 'user',     false, 'end',      'user'),
    (m, v, 4, 40, 46, 32, 'r2://c/04.mp4', null,       false, null,       null),
    (m, v, 5, 50, 56, 40, 'r2://c/05.mp4', 'opponent', false, 'continue', null),
    (m, v, 6, 60, 66, 48, 'r2://c/06.mp4', 'opponent', false, null,       'opponent');
  return m;
end $$;

-- An uploaded match nobody has cut, ready to be marked.
create function pg_temp.uploaded(p_owner uuid) returns uuid
language plpgsql as $$
declare
  m uuid := gen_random_uuid();
begin
  insert into public.matches (id, user_id, status, raw_path, duration_s,
                              content_checked_at, original_name, match_type,
                              user_side, first_server, first_server_source)
  values (m, p_owner, 'uploaded',
          'r2://ponglens-raw/' || p_owner || '/' || m || '.mov', 300, now(),
          'v.mov', 'match', 'near', 'user', 'user');
  return m;
end $$;

-- The claim's short form of a list of full-form marks, exactly as
-- submittable() sends it: w/let/star, and the two game keys only when set.
create function pg_temp.short(p_marks jsonb) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('t0', e->'t0', 't1', e->'t1', 'w', e->'winner',
                              'let', e->'isLet', 'star', e->'starred',
                              'tap', e->'t0', 'rate', 1)
           || case when e ? 'gameEnd' then jsonb_build_object('gameEnd', e->'gameEnd')
                   else '{}'::jsonb end
           || case when e ? 'gameWinner' then jsonb_build_object('gameWinner', e->'gameWinner')
                   else '{}'::jsonb end
           order by (e->>'t0')::numeric), '[]'::jsonb)
    from jsonb_array_elements(p_marks) e
$$;

-- What the hand lane writes before publishing: one point per frozen mark,
-- in start order, with the winners, lets and stars it applies
-- (_apply_hand_cut_marks). It never writes a game correction.
create function pg_temp.worker_points(p_match uuid, p_version uuid)
returns void language plpgsql as $$
declare
  mk jsonb;
  i int := 0;
begin
  for mk in select e from jsonb_array_elements(
              (select marks from public.hand_cut_drafts where match_id = p_match)) e
            order by (e->>'t0')::numeric loop
    i := i + 1;
    insert into public.points (match_id, processing_version_id, idx, t0, t1, cut_t0,
                               clip_path, confirmed_winner, is_let, starred)
    values (p_match, p_version, i, (mk->>'t0')::numeric, (mk->>'t1')::numeric, i * 3,
            'r2://ponglens-media/points/' || p_match || '/' || p_version || '/'
              || lpad(i::text, 2, '0') || '.mp4',
            case when coalesce((mk->>'let')::boolean, false) then null else mk->>'w' end,
            coalesce((mk->>'let')::boolean, false),
            coalesce((mk->>'star')::boolean, false));
  end loop;
end $$;

-- A first hand cut, the hand lane's half: the match goes to processing,
-- the points go in, publish_hand_cut_v2 commits the lot.
create function pg_temp.cut_by_hand(p_match uuid, p_job uuid) returns jsonb
language plpgsql as $$
declare
  v uuid;
  r jsonb;
begin
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = p_job;
  update public.matches set status = 'processing' where id = p_match;
  select active_processing_version_id into v from public.matches where id = p_match;
  perform pg_temp.worker_points(p_match, v);
  r := public.publish_hand_cut_v2(p_match, p_job);
  -- finish_match and the queue's own ending, as the hand lane does them.
  update public.matches set status = 'ready' where id = p_match;
  update public.jobs set status = 'done', progress = 100 where id = p_job;
  return r;
end $$;

-- A match's points and games as the projection has them, in timeline order:
-- [game_end_override, game_winner_override, ends_game, resolved_game_winner].
create function pg_temp.walk(p_match uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(p.game_end_override,
                                              p.game_winner_override,
                                              s.ends_game, s.resolved_game_winner)
                            order by s.timeline_ordinal), '[]'::jsonb)
    from public.point_score_state s
    join public.points p on p.id = s.point_id
   where s.match_id = p_match
$$;

create function pg_temp.games(p_match uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
           'games', jsonb_build_array(s.games_user, s.games_opponent),
           'game', s.current_game_number,
           'score', jsonb_build_array(s.current_score_user, s.current_score_opponent),
           'closed', (select jsonb_agg(jsonb_build_array(g->'scoreUser', g->'scoreOpponent',
                                                          g->'winner', g->'boundarySource'))
                        from jsonb_array_elements(s.completed_games) g),
           'current', m.score_projection_status = 'current'
                      and m.score_projection_revision = m.score_revision
                      and s.score_revision = m.score_revision)
    from public.match_score_state s
    join public.matches m on m.id = s.match_id
   where s.match_id = p_match
$$;

begin;
insert into public.app_config (key, value) values ('hand_cut', 'off'),
  ('reclip_lane', 'fast')
  on conflict (key) do update set value = excluded.value;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'admin@example.com')
  on conflict (id) do nothing;

-- ------------------------------------------------ the prefill carries them
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  r jsonb;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.scored(admin);
  -- The live match itself: games as Keep score shows them.
  perform public.refresh_match_score_state(m);
  if pg_temp.games(m) <> '{"games": [1, 0], "game": 2, "score": [0, 2], "current": true,
                           "closed": [[2, 0, "user", "owner_end_override"]]}'::jsonb then
    raise exception 'FAIL: the live match''s games %', pg_temp.games(m);
  end if;

  r := public.start_recut(m);
  if (select jsonb_agg(jsonb_build_array(x->'t0', x->'gameEnd', x->'gameWinner',
                                         x ? 'gameEnd', x ? 'gameWinner'))
        from jsonb_array_elements(r->'marks') x)
     <> '[[10, null, null, false, false],
          [30, "end", "user", true, true],
          [40, null, null, false, false],
          [50, "continue", null, true, false],
          [60, null, "opponent", false, true]]'::jsonb then
    raise exception 'FAIL: the prefill''s game ends %', r->'marks';
  end if;
  if (select marks from public.hand_cut_drafts where match_id = m) <> r->'marks'
     or not (select prefilled from public.hand_cut_drafts where match_id = m) then
    raise exception 'FAIL: the draft is not the prefill';
  end if;
  -- What it wrote is what both claims accept, in either shape.
  perform public._hand_cut_validate_marks(r->'marks', 300);
  perform public._hand_cut_validate_marks(pg_temp.short(r->'marks'), 300);
  -- The signature a prefill is judged by ignores them: an older app that
  -- saves the prefill back without them leaves it a prefill.
  update public.hand_cut_drafts
     set marks = (select jsonb_agg(x - 'gameEnd' - 'gameWinner')
                    from jsonb_array_elements(r->'marks') x)
   where match_id = m;
  if not (select prefilled from public.hand_cut_drafts where match_id = m) then
    raise exception 'FAIL: dropping the game keys un-prefilled the draft';
  end if;
  -- ... and the next open writes them back from the points.
  r := public.start_recut(m);
  if (select count(*) from jsonb_array_elements(r->'marks') x
       where x ? 'gameEnd' or x ? 'gameWinner') <> 3 then
    raise exception 'FAIL: the refreshed prefill lost the game ends %', r->'marks';
  end if;
end $$;

-- ------------------------------------------------------ the claims' checks
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  bad jsonb;
  m uuid;
begin
  perform pg_temp.act(admin, true);
  foreach bad in array array[
    '[{"t0": 1, "t1": 5, "gameEnd": "END"}]',
    '[{"t0": 1, "t1": 5, "gameEnd": "user"}]',
    '[{"t0": 1, "t1": 5, "gameEnd": true}]',
    '[{"t0": 1, "t1": 5, "gameWinner": "near"}]',
    '[{"t0": 1, "t1": 5, "gameWinner": 1}]']::jsonb[] loop
    begin
      perform public._hand_cut_validate_marks(bad, 300);
      raise exception 'FAIL: the re-cut claim took %', bad;
    exception when check_violation then
      if sqlerrm <> 'invalid_marks' then raise; end if;
    end;
    m := pg_temp.uploaded(admin);
    begin
      perform public.claim_hand_cut(m, bad);
      raise exception 'FAIL: the hand-cut claim took %', bad;
    exception when check_violation then
      if sqlerrm <> 'invalid_marks' then raise; end if;
    end;
  end loop;
  -- Every real value, a null, and none at all.
  if public._hand_cut_validate_marks(
       '[{"t0": 1, "t1": 5, "gameEnd": "end", "gameWinner": "user"},
         {"t0": 6, "t1": 9, "gameEnd": "continue", "gameWinner": "opponent"},
         {"t0": 10, "t1": 15, "gameEnd": null, "gameWinner": null},
         {"t0": 16, "t1": 20}]', 300) <> 4 then
    raise exception 'FAIL: the re-cut claim refused good marks';
  end if;
end $$;

-- -------------------------------------- a first hand cut publishes them
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  j uuid;
  r jsonb;
  marks jsonb := '[
    {"t0": 10, "t1": 16, "w": "user", "let": false, "star": false, "tap": 10.6, "rate": 1},
    {"t0": 20, "t1": 26, "w": "opponent", "let": false, "star": true, "tap": 20.6, "rate": 1,
     "gameEnd": "end", "gameWinner": "user"},
    {"t0": 30, "t1": 36, "w": null, "let": false, "star": false, "tap": 30.6, "rate": 1,
     "gameEnd": "end"},
    {"t0": 40, "t1": 46, "w": "user", "let": false, "star": false, "tap": 40.6, "rate": 1},
    {"t0": 50, "t1": 56, "w": "user", "let": false, "star": false, "tap": 50.6, "rate": 1,
     "gameWinner": "opponent"}]';
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.uploaded(admin);
  j := (public.claim_hand_cut(m, marks)->>'job_id')::uuid;
  r := pg_temp.cut_by_hand(m, j);
  if (r->>'ok')::boolean is not true or (r->>'pointCount')::int <> 5
     or r->>'scoreProjectionStatus' <> 'current' then
    raise exception 'FAIL: hand cut receipt %', r;
  end if;
  -- Mark k's corrections are point k's, and nothing else carries one.
  if pg_temp.walk(m) <> '[[null, null, false, null],
                          ["end", "user", true, "user"],
                          ["end", null, true, null],
                          [null, null, false, null],
                          [null, "opponent", false, null]]'::jsonb then
    raise exception 'FAIL: the hand cut''s points %', pg_temp.walk(m);
  end if;
  -- In the projection straight away: game one closed at 1-1 for the user,
  -- game two closed unproven, game three running at 2-0.
  if pg_temp.games(m) <> '{"games": [1, 0], "game": 3, "score": [2, 0], "current": true,
                           "closed": [[1, 1, "user", "owner_end_override"],
                                      [0, 0, null, "owner_end_override"]]}'::jsonb then
    raise exception 'FAIL: the hand cut''s games %', pg_temp.games(m);
  end if;
  -- Publishing again answers the same receipt.
  if public.publish_hand_cut_v2(m, j) <> r then
    raise exception 'FAIL: publish_hand_cut_v2 is not idempotent';
  end if;
end $$;

-- ------------------------- Replace: the owner's games survive the new cut
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  j uuid;
  cv uuid;
  old_v uuid;
  prefill jsonb;
  sent jsonb;
  r jsonb;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.scored(admin);
  select active_processing_version_id into old_v from public.matches where id = m;
  prefill := public.start_recut(m)->'marks';
  -- The player takes out the point at 50 s (the one holding game two open)
  -- and moves the first a little. Its correction leaves with it.
  sent := pg_temp.short((select jsonb_agg(
             case when (x->>'t0')::numeric = 10
                  then x || '{"t0": 9.5}'::jsonb else x end)
           from jsonb_array_elements(prefill) x
          where (x->>'t0')::numeric <> 50));
  j := (public.claim_hand_recut(m, sent, true)->>'job_id')::uuid;
  if (select marks from public.hand_cut_drafts where match_id = m) <> sent then
    raise exception 'FAIL: the frozen marks lost their game keys';
  end if;

  -- The hand lane cuts the candidate and publishes it.
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  select id into cv from public.match_processing_versions where job_id = j;
  perform pg_temp.worker_points(m, cv);
  r := public.publish_hand_recut(m, j,
         'r2://ponglens-media/results/' || admin || '/' || m || '/versions/' || cv || '.mp4',
         null,
         'r2://ponglens-media/points/' || admin || '/' || m || '/versions/' || cv || '/match.json',
         '{"pre": 1.2, "post": 1.3}');
  if not (r->>'activated')::boolean or (r->>'pointCount')::int <> 4
     or r->>'scoreProjectionStatus' <> 'current'
     or (select active_processing_version_id from public.matches where id = m) <> cv then
    raise exception 'FAIL: the Replace did not go live %', r;
  end if;
  if pg_temp.walk(m) <> '[[null, null, false, null],
                          ["end", "user", true, "user"],
                          [null, null, false, null],
                          [null, "opponent", false, null]]'::jsonb then
    raise exception 'FAIL: the Replace''s points %', pg_temp.walk(m);
  end if;
  -- With the continue gone, game two is 0-1 and still running.
  if pg_temp.games(m) <> '{"games": [1, 0], "game": 2, "score": [0, 1], "current": true,
                           "closed": [[2, 0, "user", "owner_end_override"]]}'::jsonb then
    raise exception 'FAIL: the Replace''s games %', pg_temp.games(m);
  end if;
  -- The replaced version's points keep their own corrections.
  if (select jsonb_agg(jsonb_build_array(idx, game_end_override, game_winner_override) order by idx)
        from public.points where processing_version_id = old_v)
     <> '[[1, null, null], [2, "end", null], [3, "end", "user"], [4, null, null],
          [5, "continue", null], [6, null, "opponent"]]'::jsonb then
    raise exception 'FAIL: the old version was touched';
  end if;
end $$;

-- ----------------- a candidate made live later keeps what publish wrote
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  j uuid;
  cv uuid;
  r jsonb;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.scored(admin);
  j := (public.claim_hand_recut(m, pg_temp.short(public.start_recut(m)->'marks'), true)
          ->>'job_id')::uuid;
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  select id into cv from public.match_processing_versions where job_id = j;
  perform pg_temp.worker_points(m, cv);
  -- A reclip on the live match holds the swap back.
  insert into public.jobs (user_id, kind, status, options)
  values (admin, 'reclip', 'queued', jsonb_build_object('match_id', m));
  r := public.publish_hand_recut(m, j, 'r2://c.mp4', null, 'r2://mj', '{"pre": 1.2, "post": 1.3}');
  if (r->>'activated')::boolean then
    raise exception 'FAIL: went live past a running reclip %', r;
  end if;
  if (select count(*) from public.points
       where processing_version_id = cv
         and (game_end_override is not null or game_winner_override is not null)) <> 3 then
    raise exception 'FAIL: the waiting candidate has no game ends';
  end if;
  update public.jobs set status = 'done' where kind = 'reclip' and options->>'match_id' = m::text;
  r := public.activate_hand_recut(j);
  if not (r->>'activated')::boolean
     or pg_temp.games(m) <> '{"games": [1, 0], "game": 2, "score": [0, 2], "current": true,
                              "closed": [[2, 0, "user", "owner_end_override"]]}'::jsonb then
    raise exception 'FAIL: made live later %, %', r, pg_temp.games(m);
  end if;
end $$;

-- --------------------------- Keep: the copy's first cut publishes them too
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  n uuid;
  j uuid;
  claim jsonb;
begin
  perform pg_temp.act(admin, true);
  m := pg_temp.scored(admin);
  claim := public.claim_hand_recut(m, pg_temp.short(public.start_recut(m)->'marks'), false);
  n := (claim->>'match_id')::uuid;
  j := (claim->>'job_id')::uuid;
  perform pg_temp.cut_by_hand(n, j);
  perform public.refresh_match_score_state(m);
  if pg_temp.walk(n) <> pg_temp.walk(m) then
    raise exception 'FAIL: the copy''s points % against the original''s %',
      pg_temp.walk(n), pg_temp.walk(m);
  end if;
  if pg_temp.games(n) <> '{"games": [1, 0], "game": 2, "score": [0, 2], "current": true,
                           "closed": [[2, 0, "user", "owner_end_override"]]}'::jsonb then
    raise exception 'FAIL: the copy''s games %', pg_temp.games(n);
  end if;
end $$;

-- ------------------------------ old marks, without the keys, as before
do $$
declare
  admin uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  m uuid;
  j uuid;
  cv uuid;
  marks jsonb;
begin
  perform pg_temp.act(admin, true);
  -- Thirteen rallies the user won, from an app that has never heard of a
  -- game end: the score closes game one at 11-0, as it always did.
  select jsonb_agg(jsonb_build_object('t0', 10 * i, 't1', 10 * i + 6, 'w', 'user',
                                      'let', false, 'star', false,
                                      'tap', 10 * i + 0.6, 'rate', 1) order by i)
    into marks from generate_series(1, 13) i;
  m := pg_temp.uploaded(admin);
  j := (public.claim_hand_cut(m, marks)->>'job_id')::uuid;
  perform pg_temp.cut_by_hand(m, j);
  if exists (select 1 from public.points where match_id = m
              and (game_end_override is not null or game_winner_override is not null)) then
    raise exception 'FAIL: game ends appeared from nowhere';
  end if;
  if pg_temp.games(m) <> '{"games": [1, 0], "game": 2, "score": [2, 0], "current": true,
                           "closed": [[11, 0, "user", "automatic_score"]]}'::jsonb then
    raise exception 'FAIL: an old cut''s games %', pg_temp.games(m);
  end if;
  -- An old full-form draft on a Replace: nothing to write, nothing written.
  m := pg_temp.scored(admin);
  update public.points set game_end_override = null, game_winner_override = null
   where match_id = m;
  perform pg_temp.act(admin, true);
  j := (public.claim_hand_recut(m,
          '[{"t0": 10, "t1": 16, "winner": "user", "isLet": false, "starred": false},
            {"t0": 30, "t1": 36, "winner": null, "isLet": true, "starred": false}]', true)
          ->>'job_id')::uuid;
  perform pg_temp.as_worker();
  update public.jobs set status = 'processing' where id = j;
  select id into cv from public.match_processing_versions where job_id = j;
  perform pg_temp.worker_points(m, cv);
  if public._apply_hand_cut_game_marks(m, cv) <> 0 then
    raise exception 'FAIL: an old draft wrote game ends';
  end if;
  if not (public.publish_hand_recut(m, j, 'r2://c.mp4', null, 'r2://mj',
            '{"pre": 1.2, "post": 1.3}')->>'activated')::boolean then
    raise exception 'FAIL: an old draft''s Replace';
  end if;
end $$;

-- ------------------------------------------------------------ privileges
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._apply_hand_cut_game_marks(uuid, uuid)',
    'public._recut_marks_from_points(public.matches)',
    'public._hand_cut_validate_marks(jsonb, double precision)',
    'public._hand_cut_claim_checks(uuid, jsonb)',
    'public.publish_hand_cut_v2(uuid, uuid)',
    'public.publish_hand_recut(uuid, uuid, text, text, text, jsonb)'] loop
    if has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL: private function callable %', f;
    end if;
  end loop;
  if not has_function_privilege('service_role',
       'public.publish_hand_recut(uuid, uuid, text, text, text, jsonb)', 'execute') then
    raise exception 'FAIL: the worker lost publish_hand_recut';
  end if;
  foreach f in array array[
    'public.start_recut(uuid, boolean)', 'public.claim_hand_recut(uuid, jsonb, boolean)',
    'public.claim_hand_cut(uuid, jsonb)', 'public.claim_device_hand_cut(uuid, jsonb)'] loop
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FAIL: the owner lost %', f;
    end if;
  end loop;
end $$;

rollback;
select 'marker game ends: all behaviour checks passed' as result;
