\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.record_worker_processing_run('{"schema":1,"attempt_key":"test:1","job_id":"00000000-0000-0000-0000-000000000001","release_id":"test-release","requested_pipeline":"bodies","status":"running","started_at":"2026-09-11T12:00:00Z"}');
select public.record_worker_processing_run('{"schema":1,"attempt_key":"test:1","job_id":"00000000-0000-0000-0000-000000000001","release_id":"test-release","requested_pipeline":"bodies","delivered_pipeline":"v2","status":"degraded","reason_code":"body_exception","started_at":"2026-09-11T12:00:00Z","finished_at":"2026-09-11T12:05:00Z"}');
select public.record_worker_processing_run('{"schema":1,"attempt_key":"test:1","job_id":"00000000-0000-0000-0000-000000000001","release_id":"test-release","requested_pipeline":"bodies","status":"running","started_at":"2026-09-11T12:00:00Z"}');
do $$ begin
  assert (select count(*)=1 from public.worker_processing_runs);
  assert (select status='degraded' and delivered_pipeline='v2' from public.worker_processing_runs);
  assert not has_function_privilege('anon','public.record_worker_processing_run(jsonb)','execute');
  assert not has_function_privilege('authenticated','public.record_worker_processing_run(jsonb)','execute');
  assert not has_function_privilege('anon','public.admin_processing_health()','execute');
  assert has_function_privilege('ponglens_worker','public.record_worker_processing_run(jsonb)','execute');
end $$;
set local role authenticated;
set local test.is_admin = 'false';
do $$ begin
  assert (select count(*)=0 from public.worker_processing_runs);
  begin
    perform public.admin_processing_health();
    raise exception 'TEST FAILURE: non-admin RPC was allowed';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $$;
set local test.is_admin = 'true';
do $$ begin
  assert jsonb_array_length(public.admin_processing_health()->'runs')=1;
  assert (select count(*)=1 from public.worker_processing_runs);
end $$;
reset role;
do $$ begin
  begin
    perform public.record_worker_processing_run('{"schema":1,"attempt_key":"test:1","job_id":"00000000-0000-0000-0000-000000000002","release_id":"test-release","requested_pipeline":"bodies","status":"running","started_at":"2026-09-11T12:00:00Z"}');
    raise exception 'TEST FAILURE: identity collision was accepted';
  exception when raise_exception then
    if sqlerrm <> 'processing attempt identity mismatch' then raise; end if;
  end;
  assert (select expected_after is null and monitor_at is null and not email_enabled
          from public.worker_processing_health_control);
end $$;
rollback;
