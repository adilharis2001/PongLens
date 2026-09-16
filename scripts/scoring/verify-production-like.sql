\set ON_ERROR_STOP on

do $$
declare
  v_matches integer;
  v_projected integer;
  v_errors integer;
begin
  select count(*) into v_matches from public.matches;
  select count(*) into v_projected from public.match_score_state;
  select count(*) into v_errors
    from public.matches where score_projection_status <> 'current';
  if v_matches <> 220 or v_projected <> 220 or v_errors <> 0 then
    raise exception 'legacy backfill mismatch: matches %, projected %, errors %',
      v_matches, v_projected, v_errors;
  end if;
  if (select count(*) from public.point_timing_observations
       where origin='manual_cutter') <> 900 then
    raise exception 'manual-cutter observation backfill mismatch';
  end if;

  if has_function_privilege('anon',
       'public.set_point_outcome_v2(uuid,uuid,text,uuid,bigint,text,numeric)',
       'execute') then
    raise exception 'anon unexpectedly has score-command execution';
  end if;
  if not has_function_privilege('authenticated',
       'public.set_point_outcome_v2(uuid,uuid,text,uuid,bigint,text,numeric)',
       'execute') then
    raise exception 'authenticated score-command grant missing';
  end if;
  if not has_function_privilege('ponglens_worker',
       'public.finalize_worker_points_v2(uuid,uuid)', 'execute') then
    raise exception 'worker finalizer grant missing';
  end if;
  if has_function_privilege('authenticated',
       'public.finalize_worker_points_v2(uuid,uuid)', 'execute') then
    raise exception 'authenticated unexpectedly has worker finalizer execution';
  end if;
  if has_function_privilege('anon',
       'public.canonical_score_snapshot_v1(uuid)', 'execute') then
    raise exception 'anon unexpectedly has canonical reader execution';
  end if;
  if not has_function_privilege('authenticated',
       'public.canonical_score_snapshot_v1(uuid)', 'execute') then
    raise exception 'authenticated canonical reader grant missing';
  end if;
  if has_function_privilege('anon',
       'public.canonical_score_summaries_v1(uuid[])', 'execute') then
    raise exception 'anon unexpectedly has canonical summary execution';
  end if;
  if not has_function_privilege('authenticated',
       'public.canonical_score_summaries_v1(uuid[])', 'execute') then
    raise exception 'authenticated canonical summary grant missing';
  end if;
  if coalesce((select value from public.app_config
                where key='canonical_score_readers'), '') <> 'off' then
    raise exception 'canonical reader did not start disabled';
  end if;
end;
$$;

-- Prove the dormant reader has a boundary independent from command rollout:
-- owner and accepted coach can read only when individually allowlisted; an
-- allowlisted stranger receives not_found; and admin status is not a bypass.
update public.app_config
   set value='users:11111111-1111-4111-8111-111111111111,33333333-3333-4333-8333-333333333333'
 where key='canonical_score_readers';

select set_config(
  'request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false
);
select set_config('request.jwt.claim.role','authenticated',false);

do $$
declare
  v_match uuid := md5('match-220')::uuid;
  v_ids uuid[];
  v_response jsonb;
begin
  v_response := public.canonical_score_snapshot_v1(v_match);
  if not coalesce((v_response->>'ok')::boolean,false)
     or v_response#>>'{snapshot,matchId}' <> v_match::text then
    raise exception 'owner canonical reader failed: %',v_response;
  end if;
  select array_agg(id order by id) into v_ids from public.matches;
  v_response := public.canonical_score_summaries_v1(v_ids);
  if not coalesce((v_response->>'ok')::boolean,false)
     or jsonb_array_length(v_response->'summaries') <> 220 then
    raise exception 'owner canonical summary batch failed: %',v_response;
  end if;
  select array_agg(md5('oversized-'||n)::uuid)
    into v_ids from generate_series(1,251) n;
  v_response := public.canonical_score_summaries_v1(v_ids);
  if v_response->>'code' <> 'invalid_input' then
    raise exception 'oversized canonical summary batch was accepted: %',v_response;
  end if;
end;
$$;

-- A manually named winner is a real stats input. Changing it must invalidate
-- the owner's cached point fold even when every other point field is stable.
create temporary table stats_fingerprint_before(value text);
insert into stats_fingerprint_before
select fingerprint from public.my_match_point_fingerprints()
 where match_id=md5('match-218')::uuid;
update public.points
   set game_winner_override='user'
 where match_id=md5('match-218')::uuid and idx=1;
do $$
begin
  if (select fingerprint from public.my_match_point_fingerprints()
       where match_id=md5('match-218')::uuid)
     = (select value from stats_fingerprint_before) then
    raise exception 'game winner override did not invalidate stats fingerprint';
  end if;
end;
$$;
update public.points
   set game_winner_override=null
 where match_id=md5('match-218')::uuid and idx=1;

select set_config(
  'request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false
);

do $$
declare
  v_response jsonb;
begin
  v_response := public.canonical_score_snapshot_v1(md5('match-220')::uuid);
  if not coalesce((v_response->>'ok')::boolean,false) then
    raise exception 'accepted coach canonical reader failed: %',v_response;
  end if;
  v_response := public.canonical_score_summaries_v1(
    array[md5('match-220')::uuid]
  );
  if jsonb_array_length(v_response->'summaries') <> 1 then
    raise exception 'accepted coach canonical summary failed: %',v_response;
  end if;
end;
$$;

update public.app_config
   set value='user:44444444-4444-4444-8444-444444444444'
 where key='canonical_score_readers';
select set_config(
  'request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false
);

do $$
declare
  v_response jsonb;
begin
  v_response := public.canonical_score_snapshot_v1(md5('match-220')::uuid);
  if v_response->>'code' <> 'not_found' then
    raise exception 'allowlisted stranger escaped match access: %',v_response;
  end if;
  v_response := public.canonical_score_summaries_v1(
    array[md5('match-220')::uuid]
  );
  if jsonb_array_length(v_response->'summaries') <> 0 then
    raise exception 'stranger summary disclosed a match: %',v_response;
  end if;
end;
$$;

update public.app_config
   set value='off'
 where key='canonical_score_readers';
select set_config(
  'request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false
);

do $$
declare
  v_response jsonb;
begin
  v_response := public.canonical_score_snapshot_v1(md5('match-220')::uuid);
  if v_response->>'code' <> 'not_enabled' then
    raise exception 'admin bypassed canonical reader canary: %',v_response;
  end if;
end;
$$;

update public.app_config
   set value='user:11111111-1111-4111-8111-111111111111'
 where key='canonical_score_readers';
update public.matches
   set score_projection_status='stale'
 where id=md5('match-219')::uuid;
select set_config(
  'request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false
);

do $$
declare
  v_match uuid := md5('match-219')::uuid;
  v_response jsonb;
begin
  v_response := public.canonical_score_snapshot_v1(v_match);
  if v_response->>'code' <> 'unavailable' then
    raise exception 'stale reader did not fail closed: %',v_response;
  end if;
  if (select score_projection_status from public.matches where id=v_match)
       <> 'stale' then
    raise exception 'reader repaired or mutated stale projection state';
  end if;
  v_response := public.canonical_score_summaries_v1(array[v_match]);
  if jsonb_array_length(v_response->'summaries') <> 0 then
    raise exception 'summary returned stale projection state: %',v_response;
  end if;
  if (select score_projection_status from public.matches where id=v_match)
       <> 'stale' then
    raise exception 'summary reader repaired or mutated stale projection state';
  end if;
end;
$$;

update public.matches
   set score_projection_status='current'
 where id=md5('match-219')::uuid;
update public.app_config
   set value='off'
 where key='canonical_score_readers';

create temporary table canonical_command_latency(ms double precision);

update public.app_config
   set value='user:11111111-1111-4111-8111-111111111111'
 where key='canonical_score_commands';
select set_config(
  'request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false
);
select set_config('request.jwt.claim.role','authenticated',false);

do $$
declare
  v_match uuid := md5('match-220')::uuid;
  v_point uuid;
  v_revision bigint;
  v_started timestamptz;
  v_response jsonb;
  i integer;
begin
  select id into v_point from public.points
   where match_id=v_match and idx=1;
  for i in 1..100 loop
    select score_revision into v_revision from public.matches where id=v_match;
    v_started := clock_timestamp();
    v_response := public.set_point_outcome_v2(
      v_match,v_point,case when i%2=0 then 'user' else 'opponent' end,
      gen_random_uuid(),v_revision,null,null
    );
    insert into canonical_command_latency
    values (extract(epoch from clock_timestamp()-v_started)*1000.0);
    if not coalesce((v_response->>'ok')::boolean,false) then
      raise exception 'command benchmark failed: %',v_response;
    end if;
  end loop;
end;
$$;

select round(percentile_cont(0.50) within group(order by ms)::numeric,3) as p50_ms,
       round(percentile_cont(0.95) within group(order by ms)::numeric,3) as p95_ms,
       round(max(ms)::numeric,3) as max_ms
  from canonical_command_latency;

-- The operational rollback is deliberately data-preserving: disable new
-- commands, retain projections, and prove the established owner columns still
-- carry their legacy grants.
update public.app_config set value='off' where key='canonical_score_commands';

do $$
begin
  if public.canonical_score_commands_enabled() then
    raise exception 'capability remained enabled after rollback';
  end if;
  if not has_column_privilege('authenticated','public.points',
       'confirmed_winner','update')
     or not has_column_privilege('authenticated','public.matches',
       'first_server','update') then
    raise exception 'legacy owner write grants were not preserved';
  end if;
  if (select count(*) from public.match_score_state) <> 220 then
    raise exception 'rollback damaged additive projection data';
  end if;
end;
$$;

-- The production canary account is also an admin. Prove that admin status
-- cannot bypass the same emergency switch operators rely on during rollback.
select set_config(
  'request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false
);

do $$
begin
  if public.canonical_score_commands_enabled() then
    raise exception 'admin capability bypassed rollback';
  end if;
end;
$$;
