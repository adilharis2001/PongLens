-- Repair the daily cost rollup alias in the already-deployed dashboard RPC.
-- Migration 050 now contains the corrected definition for fresh projects;
-- this guarded replacement updates existing production databases.

do $migration$
declare
  v_signature regprocedure :=
    'public.get_platform_cost_dashboard(timestamptz,timestamptz)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position('sum(c.cost_usd)' in v_definition) = 0 then
    if position('sum(c.provider_cost)' in v_definition) > 0 then
      return;
    end if;
    raise exception 'unexpected platform cost dashboard function definition';
  end if;

  v_definition := replace(
    v_definition,
    'sum(c.cost_usd)',
    'sum(c.provider_cost)'
  );
  execute v_definition;
end;
$migration$;
