-- What the provider says each API key spent, and which bucket that key is.
--
-- Our own ledger records the CODE that made a call, never the credential it
-- used, so it cannot tell a corpus run from an upload: both reach the same
-- function. Since 2026-09-12 each purpose has its own OpenAI key, which
-- means the provider can answer the question our meter cannot — and it
-- answers for spend the meter never saw at all, which is how two research
-- days became 77% of a three-week Sol bill without appearing anywhere.
--
-- This is deliberately a SECOND, independent reading. It does not replace
-- the metered ledger and must never be added to it: the ledger says who and
-- what, the provider says how much and on whose key. Where they disagree,
-- the difference is the thing worth looking at.

create table if not exists public.cost_api_keys (
  provider text not null check (length(provider) between 1 and 80),
  key_id text not null check (length(key_id) between 1 and 120),
  label text not null check (length(label) between 1 and 160),
  -- Which product's bill this belongs on. Anything that is not ours is
  -- excluded from PongLens totals rather than quietly inflating them.
  product text not null default 'PongLens'
    check (length(product) between 1 and 80),
  -- 'run' serves the people using PongLens, 'build' is what it costs to
  -- make it, and 'mixed' is the honest answer for a key that served both
  -- and can never be untangled. A mixed key is reported on its own and
  -- counted in neither.
  category text not null default 'run'
    check (category in ('run', 'build', 'mixed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, key_id)
);

-- One row per key per day, as the provider reports it.
create table if not exists public.cost_provider_key_daily (
  provider text not null check (length(provider) between 1 and 80),
  key_id text not null check (length(key_id) between 1 and 120),
  day date not null,
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  fetched_at timestamptz not null default now(),
  primary key (provider, key_id, day)
);

create index if not exists cost_provider_key_daily_day_idx
  on public.cost_provider_key_daily (day);

alter table public.cost_api_keys enable row level security;
alter table public.cost_provider_key_daily enable row level security;
revoke all on public.cost_api_keys from anon, authenticated;
revoke all on public.cost_provider_key_daily from anon, authenticated;

-- The two keys whose ids are known. The rest appear the first time they
-- spend anything, and the dashboard reports an unmapped key as itself with
-- a marker rather than dropping it — the same rule the processing page
-- follows, because a cost that silently belongs to nobody is how this
-- problem started.
insert into public.cost_api_keys (provider, key_id, label, product, category, note)
values
  ('OpenAI', 'key_C5Bp0yKvGOteQsPn', 'Retired shared key', 'PongLens', 'mixed',
   'Served production, research, WDIMT and personal work until 2026-09-12. Counted in neither bucket because it genuinely cannot be split.'),
  ('OpenAI', 'key_pQqB9EZiBhDsAUef', 'Web production', 'PongLens', 'run',
   'Vercel production')
on conflict (provider, key_id) do nothing;

create or replace function public.admin_set_cost_api_key(
  p_provider text,
  p_key_id text,
  p_label text,
  p_product text default 'PongLens',
  p_category text default 'run',
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_category not in ('run', 'build', 'mixed') then
    raise exception 'unknown category %', p_category using errcode = '22023';
  end if;
  insert into public.cost_api_keys (
    provider, key_id, label, product, category, note
  ) values (
    trim(p_provider), trim(p_key_id), trim(p_label),
    trim(p_product), p_category, nullif(trim(p_note), '')
  )
  on conflict (provider, key_id) do update set
    label = excluded.label,
    product = excluded.product,
    category = excluded.category,
    note = excluded.note,
    updated_at = now();
end;
$function$;

revoke all on function public.admin_set_cost_api_key(
  text, text, text, text, text, text) from public;
grant execute on function public.admin_set_cost_api_key(
  text, text, text, text, text, text) to anon, authenticated, service_role;

create or replace function public.record_provider_key_costs(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  perform public.cost_rpc_requires_service_role();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be an array of at most 500' using errcode = '22023';
  end if;
  insert into public.cost_provider_key_daily (provider, key_id, day, cost_usd)
  select left(x->>'provider', 80), left(x->>'key_id', 120),
         (x->>'day')::date, greatest(0, (x->>'cost_usd')::numeric)
  from jsonb_array_elements(p_rows) x
  where coalesce(x->>'provider','') <> '' and coalesce(x->>'key_id','') <> ''
  on conflict (provider, key_id, day) do update
    set cost_usd = excluded.cost_usd, fetched_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.record_provider_key_costs(jsonb) from public;
grant execute on function public.record_provider_key_costs(jsonb)
  to service_role, ponglens_worker;
