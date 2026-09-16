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
end;
$$;

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
