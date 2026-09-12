-- Add per-key provider costs to the dashboard payload.
--
-- Patched from the live definition rather than restated, because this
-- function has been rewritten several times and a copy taken from an older
-- reading silently drops whatever was added since. The DO block refuses to
-- run if neither anchor matches, so a future rename fails loudly instead of
-- quietly producing a function with the addition missing.
do $patch$
declare
  src text;
  before_len int;
begin
  select pg_get_functiondef(oid) into src
  from pg_proc where proname = 'get_platform_cost_dashboard';
  before_len := length(src);

  if position('key_costs as (' in src) > 0 then
    raise notice 'already patched';
    return;
  end if;

  src := replace(src, '  one_time as (',
'  -- What the PROVIDER says each API key spent. A second, independent
  -- reading: the ledger knows which code spent money, this knows which
  -- credential did, and only the second can see spend the meter never saw.
  key_costs as (
    select k.key_id,
           coalesce(m.label, k.key_id) as label,
           coalesce(m.product, ''Unmapped'') as product,
           coalesce(m.category, ''unmapped'') as category,
           (m.key_id is not null) as mapped,
           sum(k.cost_usd) as cost_usd
    from public.cost_provider_key_daily k
    left join public.cost_api_keys m
      on m.provider = k.provider and m.key_id = k.key_id
    where k.provider = ''OpenAI''
      and k.day >= p_start::date
      and k.day <= (p_end - interval ''1 microsecond'')::date
    group by k.key_id, m.label, m.product, m.category, m.key_id
  ),
  one_time as (');

  src := replace(src, '    ''one_time_items'', coalesce((',
'    ''provider_keys'', coalesce((
      select jsonb_agg(jsonb_build_object(
        ''key_id'', q.key_id,
        ''label'', q.label,
        ''product'', q.product,
        ''category'', q.category,
        ''mapped'', q.mapped,
        ''cost_usd'', q.cost_usd
      ) order by q.cost_usd desc)
      from key_costs q
    ), ''[]''::jsonb),
    ''one_time_items'', coalesce((');

  if length(src) <= before_len then
    raise exception 'neither anchor matched; refusing to rewrite';
  end if;
  execute src;
end
$patch$;
