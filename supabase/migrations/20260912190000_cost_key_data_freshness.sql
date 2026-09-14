-- Say when the per-key costs were last written.
--
-- The reconciler that fills cost_provider_key_daily lives in the match
-- worker, and the match worker runs from a sealed release rather than from
-- main. So "the code is on main" and "the code is running" are different
-- claims, and this table can stop being filled without anything failing:
-- the page would keep rendering last week's split as though it were today's.
--
-- Reporting the write time turns that from silent into visible, which is
-- the same reason the processing page renders an unknown job kind as its
-- raw name instead of bucketing it away.
do $patch$
declare
  src text;
begin
  select pg_get_functiondef(oid) into src
  from pg_proc where proname = 'get_platform_cost_dashboard';

  if position('provider_keys_fetched_at' in src) > 0 then
    raise notice 'already patched';
    return;
  end if;
  if position('''unattributed_usd'', coalesce((select sum(cost_usd) from priced' in src) = 0 then
    raise exception 'health anchor not found; refusing to rewrite';
  end if;

  src := replace(src,
    '''unattributed_usd'', coalesce((select sum(cost_usd) from priced',
    '''provider_keys_fetched_at'', (
        select max(fetched_at) from public.cost_provider_key_daily
      ),
      ''unattributed_usd'', coalesce((select sum(cost_usd) from priced');

  execute src;
end
$patch$;
