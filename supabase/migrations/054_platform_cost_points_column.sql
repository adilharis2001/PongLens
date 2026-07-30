-- PongLens soft-deletes points with the boolean `deleted` column. Repair the
-- already-deployed dashboard function, which referenced a nonexistent
-- `deleted_at` column while building its simulation baseline.
do $$
declare
  v_function regprocedure :=
    'public.get_platform_cost_dashboard(timestamptz,timestamptz)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position('p.deleted_at is null' in v_definition) = 0 then
    if position('not p.deleted' in v_definition) > 0 then
      return;
    end if;

    raise exception
      'unexpected get_platform_cost_dashboard point-count definition';
  end if;

  execute replace(
    v_definition,
    'p.deleted_at is null',
    'not p.deleted'
  );
end;
$$;
