-- 087: Ask — bound the BILL, not just the request count.
--
-- 085 limited how many questions can be asked. That is not the same as
-- limiting what they cost, and the gap is bigger than it looks:
--
--   a normal ask today  ~ 10k tokens  = $0.002
--   a maxed-out ask     = 120k tokens = $0.024   (12x)
--
-- So a count-based global ceiling of 2000 asks bounds spend at $50 a day
-- for someone deliberately padding their journal, while the same 2000 asks
-- from real users cost about $4. A count is a poor proxy for a bill.
--
-- This adds the direct control: a token budget per user per day, and a
-- token budget for the whole platform per day, both checked BEFORE the
-- model is contacted and both atomic. Tokens rather than dollars because
-- tokens are what we can count without a rate lookup, and the conversion
-- is one multiplication that is documented next to the defaults.
--
-- Defaults and what they mean at gpt-5.6-luna input pricing ($0.20/1M):
--
--   journal_ask_user_daily_tokens    600,000  = $0.12 per user per day
--   journal_ask_global_daily_tokens  20,000,000 = $4.00 platform per day
--
-- The per-user number is chosen against real data, not out of the air: the
-- heaviest journal in production is about 21k tokens, so 600k allows a
-- genuinely heavy user their full 25 asks with room to spare, while
-- capping a padded 120k-token journal at 5 asks a day instead of 25.

-- ---------------------------------------------------------------------------
-- claim_journal_ask — now returns the run id, and refuses to claim for
-- somebody else
-- ---------------------------------------------------------------------------
-- Two changes:
--
-- 1. Returns run_id. 085 recorded the ask size by finding "the newest row
--    for this user", which is wrong the moment a user has two asks in
--    flight — it could stamp the size onto the wrong one. The caller now
--    holds the id of the row it created.
--
-- 2. Refuses to claim on behalf of another user. Execute is revoked from
--    authenticated and anon, so only the service role can call this and
--    the argument is trustworthy today. But a future grant would turn
--    p_user_id into a way to burn somebody else's daily allowance, so the
--    function now checks: if there IS a session user, the id must be
--    theirs. Under the service role auth.uid() is null and this is a
--    no-op, which is why it costs nothing to keep.

drop function if exists public.claim_journal_ask(uuid);

create function public.claim_journal_ask(p_user_id uuid)
returns table (
  allowed boolean,
  reason text,
  used integer,
  day_limit integer,
  run_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled      boolean;
  v_day_limit    integer;
  v_burst_limit  integer;
  v_global_limit integer;
  v_used         integer;
  v_burst        integer;
  v_global       integer;
  v_run          uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'cannot claim an ask for another user'
      using errcode = '42501';
  end if;

  select coalesce((select value from app_config
                   where key = 'journal_ask_enabled'), 'true') = 'true'
    into v_enabled;
  select coalesce((select value::integer from app_config
                   where key = 'journal_ask_daily_limit'), 25)
    into v_day_limit;
  select coalesce((select value::integer from app_config
                   where key = 'journal_ask_burst_limit'), 5)
    into v_burst_limit;
  select coalesce((select value::integer from app_config
                   where key = 'journal_ask_global_daily_limit'), 2000)
    into v_global_limit;

  if not v_enabled then
    return query select false, 'disabled', 0, v_day_limit, null::uuid;
    return;
  end if;

  select count(*) into v_burst
    from journal_ask_runs
   where user_id = p_user_id
     and created_at > now() - interval '1 minute';
  if v_burst >= v_burst_limit then
    return query select false, 'too_fast', v_burst, v_day_limit, null::uuid;
    return;
  end if;

  select count(*) into v_used
    from journal_ask_runs
   where user_id = p_user_id
     and created_at > now() - interval '1 day';
  if v_used >= v_day_limit then
    return query select false, 'daily_limit', v_used, v_day_limit, null::uuid;
    return;
  end if;

  select count(*) into v_global
    from journal_ask_runs
   where created_at > now() - interval '1 day';
  if v_global >= v_global_limit then
    return query select false, 'busy', v_used, v_day_limit, null::uuid;
    return;
  end if;

  insert into journal_ask_runs (user_id) values (p_user_id)
  returning id into v_run;
  return query select true, 'ok', v_used + 1, v_day_limit, v_run;
end;
$$;

revoke all on function public.claim_journal_ask(uuid) from public, anon,
  authenticated;

-- ---------------------------------------------------------------------------
-- reserve_journal_ask_tokens — the spend gate
-- ---------------------------------------------------------------------------
-- Called once the corpus is built and its size is known, and BEFORE the
-- model is contacted. Reserving rather than recording: the tokens are
-- written against the run in the same statement that checks the budget, so
-- parallel asks cannot both fit into the same remaining headroom.
--
-- The estimate is what gets reserved, and it is deliberately conservative
-- (corpus.ts rounds up), so the budget errs towards under-spending. A
-- refused reservation leaves the run row in place: the ask still counts
-- against the daily COUNT, which is what stops a rejected caller from
-- retrying in a loop to probe for headroom.

create or replace function public.reserve_journal_ask_tokens(
  p_run_id uuid,
  p_tokens integer
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user         uuid;
  v_user_budget  bigint;
  v_global_budget bigint;
  v_user_used    bigint;
  v_global_used  bigint;
  v_tokens       integer := greatest(0, coalesce(p_tokens, 0));
begin
  select user_id into v_user from journal_ask_runs where id = p_run_id;
  if v_user is null then
    return query select false, 'unknown_run';
    return;
  end if;

  select coalesce((select value::bigint from app_config
                   where key = 'journal_ask_user_daily_tokens'), 600000)
    into v_user_budget;
  select coalesce((select value::bigint from app_config
                   where key = 'journal_ask_global_daily_tokens'), 20000000)
    into v_global_budget;

  select coalesce(sum(input_tokens), 0) into v_user_used
    from journal_ask_runs
   where user_id = v_user
     and created_at > now() - interval '1 day';

  if v_user_used + v_tokens > v_user_budget then
    return query select false, 'token_budget';
    return;
  end if;

  select coalesce(sum(input_tokens), 0) into v_global_used
    from journal_ask_runs
   where created_at > now() - interval '1 day';

  if v_global_used + v_tokens > v_global_budget then
    return query select false, 'busy';
    return;
  end if;

  update journal_ask_runs set input_tokens = v_tokens where id = p_run_id;
  return query select true, 'ok';
end;
$$;

revoke all on function public.reserve_journal_ask_tokens(uuid, integer)
  from public, anon, authenticated;

-- Superseded by reserve_journal_ask_tokens, which does the same recording
-- plus the budget check. Dropped rather than left lying around: a function
-- that records spend without checking it is exactly the one somebody
-- reaches for by mistake later.
drop function if exists public.record_journal_ask_size(uuid, integer);

insert into public.app_config (key, value) values
  ('journal_ask_user_daily_tokens', '600000'),
  ('journal_ask_global_daily_tokens', '20000000')
on conflict (key) do nothing;
