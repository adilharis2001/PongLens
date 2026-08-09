-- 085: Ask your journal — the coach name on a lesson, and the Ask limits.
--
-- Two unrelated-looking things in one migration because one is the reason
-- for the other. Ask answers questions from the journal, and the first
-- question anyone asks a coaching journal is "what did <name> tell me?".
-- Lessons had nowhere to record who taught them, so that question could
-- only ever be answered by hoping the coach's name survived speech-to-text
-- inside the transcript. It usually does not: the same recordings that
-- produced "Backend" for backhand are not a name index.
--
-- A nullable column answers it exactly, forever, for the cost of one input.

alter table public.lessons
  add column if not exists coach_name text
    check (coach_name is null or char_length(coach_name) between 1 and 80);

comment on column public.lessons.coach_name is
  'Who taught this lesson, as the player typed it. Free text on purpose: a '
  'coach here is often not a PongLens user, and the journal should not '
  'require them to be one. Null on practice entries and on lessons saved '
  'before 085.';

-- lessons already grants insert/update to authenticated for the author's
-- own rows (037), and column grants are not in use on this table, so the
-- new column is writable by its author with no further grant.

-- The name is a filter in Ask ("my last lesson with Jonathan") and a sort
-- key in the journal, so it is worth an index once a player has a few
-- coaches. Partial: practice entries never carry one.
create index if not exists lessons_coach_name_idx
  on public.lessons (user_id, coach_name, created_at desc)
  where coach_name is not null;

-- ---------------------------------------------------------------------------
-- Ask runs — the rate limit, and nothing else
-- ---------------------------------------------------------------------------
-- Server-only, following review_assist_runs (084): no RLS policies are
-- granted, so authenticated and anon cannot read or write this at all and
-- the route reaches it through the claim function below with the service
-- role. A limit a client can edit is not a limit.
--
-- The question text is NOT stored. The limit only needs to know that an ask
-- happened and when. Keeping the question would turn a rate-limit table
-- into a log of what players privately worry about, which is not a trade
-- this feature needs to make.

create table if not exists public.journal_ask_runs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Input tokens the corpus actually cost, so an abnormal account shows up
  -- as a number rather than as a surprise on the OpenAI bill. No content.
  input_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists journal_ask_runs_user_idx
  on public.journal_ask_runs (user_id, created_at desc);

-- The circuit breaker counts every ask in the last day across all users,
-- so it gets its own index rather than scanning per-user ones.
create index if not exists journal_ask_runs_recent_idx
  on public.journal_ask_runs (created_at desc);

alter table public.journal_ask_runs enable row level security;

revoke all on public.journal_ask_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_journal_ask — every limit, in one atomic statement
-- ---------------------------------------------------------------------------
-- Checking a limit and then inserting the row is a race: two requests read
-- "24 used" at the same time and both proceed. Since the whole point is to
-- bound a paid API call, the check and the claim happen together, inside
-- one transaction, before the model is ever contacted. A denied claim
-- writes nothing.
--
-- Four gates, cheapest first:
--   1. kill switch          — a bad model day, turned off without a deploy
--   2. per-minute burst     — a script, or a stuck client retrying
--   3. per-day per-user     — the ordinary ceiling a real person feels
--   4. global per-day       — the backstop against many fresh accounts,
--                             which no per-user limit can see
--
-- Gate 4 is the one that matters for a free feature: per-user limits are
-- worth nothing against someone who can make users. It is deliberately set
-- far above real aggregate use, so it only ever fires on something wrong.

create or replace function public.claim_journal_ask(p_user_id uuid)
returns table (allowed boolean, reason text, used integer, day_limit integer)
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
begin
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
    return query select false, 'disabled', 0, v_day_limit;
    return;
  end if;

  select count(*) into v_burst
    from journal_ask_runs
   where user_id = p_user_id
     and created_at > now() - interval '1 minute';
  if v_burst >= v_burst_limit then
    return query select false, 'too_fast', v_burst, v_day_limit;
    return;
  end if;

  select count(*) into v_used
    from journal_ask_runs
   where user_id = p_user_id
     and created_at > now() - interval '1 day';
  if v_used >= v_day_limit then
    return query select false, 'daily_limit', v_used, v_day_limit;
    return;
  end if;

  select count(*) into v_global
    from journal_ask_runs
   where created_at > now() - interval '1 day';
  if v_global >= v_global_limit then
    return query select false, 'busy', v_used, v_day_limit;
    return;
  end if;

  insert into journal_ask_runs (user_id) values (p_user_id);
  return query select true, 'ok', v_used + 1, v_day_limit;
end;
$$;

-- Service role only. The authenticated role must not be able to claim (or
-- decline to claim) its own asks.
revoke all on function public.claim_journal_ask(uuid) from public, anon,
  authenticated;

-- Records what the claimed ask actually cost. Split from the claim because
-- the size is only known after the corpus is built, and a failure to
-- record must never undo a claim.
create or replace function public.record_journal_ask_size(
  p_user_id uuid, p_input_tokens integer)
returns void
language sql
security definer
set search_path = public
as $$
  update journal_ask_runs
     set input_tokens = greatest(0, p_input_tokens)
   where id = (select id from journal_ask_runs
                where user_id = p_user_id
                order by created_at desc
                limit 1);
$$;

revoke all on function public.record_journal_ask_size(uuid, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------
-- Kill switch and limits, same shape as coach_reviews_enabled (073). Ask
-- ships ON: unlike paid reviews there is no money and no third party, and
-- the switch exists for a bad model day, not for a staged rollout.

insert into public.app_config (key, value) values
  ('journal_ask_enabled', 'true'),
  ('journal_ask_daily_limit', '25'),
  ('journal_ask_burst_limit', '5'),
  ('journal_ask_global_daily_limit', '2000')
on conflict (key) do nothing;
