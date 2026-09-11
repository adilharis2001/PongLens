-- Costs answer three questions now instead of one: what did it cost, WHO
-- caused it, and was it the cost of RUNNING PongLens or of BUILDING it.
--
-- Why each of those is a change rather than a report:
--
--   Who. The ledger never recorded a person, so cost-per-player was a
--   pro-rata guess: take the pot, divide it by activity counts. That is
--   only ever as good as the counts, and the counts had gone stale —
--   lesson videos, now the most expensive thing in the product, were not
--   one of them. Deepgram is 94% lesson-video audio and was being divided
--   by voice-note count, so a coach running twenty recaps looked free and
--   a player who left one voice note absorbed their bill. A cost now
--   carries the person who caused it, and the allocation survives only
--   for the costs that genuinely have no single owner.
--
--   Run or build. A Claude subscription and a Deepgram minute are both
--   money, and adding them together destroys the only number that scales
--   with users. They are separated here at the source rather than in the
--   page, so nothing downstream can accidentally sum them. Build costs
--   are also never allocated to a player: nobody's upload caused a
--   subscription.
--
-- The fixed-cost table has been empty since the day it was created,
-- because the RPC that writes it was never given a caller. That is the
-- single biggest gap in the dashboard's history: everything predictable
-- about the bill was reading as zero.

--------------------------------------------------------------------
-- 1. A metered cost can name the person who caused it.
--------------------------------------------------------------------

alter table public.cost_usage_events
  add column if not exists subject_user_id uuid;

comment on column public.cost_usage_events.subject_user_id is
  'The account whose action caused this cost, when one account did. '
  'Deliberately not a foreign key: a cost that was really incurred has '
  'to stay on the books after the account is closed, and the meter '
  'writes up to 100 rows in one statement, so one row naming a '
  'just-deleted user would throw away the other 99. The dashboard joins '
  'to auth.users for a name and says so when there is nothing to join.';

create index if not exists cost_usage_events_subject_idx
  on public.cost_usage_events (subject_user_id, occurred_at)
  where subject_user_id is not null;

--------------------------------------------------------------------
-- 2. Fixed costs: run or build, monthly or annual.
--------------------------------------------------------------------

alter table public.cost_fixed_items
  add column if not exists category text not null default 'run'
    check (category in ('run', 'build')),
  add column if not exists recurrence text not null default 'monthly'
    check (recurrence in ('monthly', 'annual')),
  add column if not exists note text,
  add column if not exists amount_usd numeric;

-- monthly_cost_usd stops being typed in and starts being derived, so an
-- annual bill can be entered as the number on the invoice and nobody has
-- to remember to divide by twelve. The table has never held a row, so
-- this rewrites nothing; the update below is for safety, not for data.
update public.cost_fixed_items
  set amount_usd = monthly_cost_usd
  where amount_usd is null;

alter table public.cost_fixed_items
  alter column amount_usd set not null;

alter table public.cost_fixed_items
  drop constraint if exists cost_fixed_items_amount_usd_check;
alter table public.cost_fixed_items
  add constraint cost_fixed_items_amount_usd_check check (amount_usd >= 0);

alter table public.cost_fixed_items drop column monthly_cost_usd;
alter table public.cost_fixed_items
  add column monthly_cost_usd numeric
  generated always as (
    case when recurrence = 'annual' then amount_usd / 12 else amount_usd end
  ) stored;

--------------------------------------------------------------------
-- 3. One-time costs.
--------------------------------------------------------------------

-- A domain, a piece of hardware, a paid dataset: real money that belongs
-- in the burn rate but must never be smeared across the months as though
-- it recurs. Held separately so a month that contains one is honestly
-- more expensive than a month that does not.
create table if not exists public.cost_one_time_items (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(provider) between 1 and 80),
  label text not null check (length(label) between 1 and 160),
  amount_usd numeric not null check (amount_usd >= 0),
  incurred_on date not null,
  category text not null default 'build'
    check (category in ('run', 'build')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_one_time_items_incurred_idx
  on public.cost_one_time_items (incurred_on);

alter table public.cost_one_time_items enable row level security;
revoke all on public.cost_one_time_items from anon, authenticated;

--------------------------------------------------------------------
-- 4. Prices that were metered but never priced.
--------------------------------------------------------------------

-- gpt-audio was filed under a service called 'Audio' while the worker
-- records it under 'AI'. The rate lookup joins on service, so the two
-- have never met and every audio check on a lesson recap has priced at
-- zero. One of those rows even carries a unit ('audio_input_token') the
-- events table forbids, so it could not have matched under any service.
--
-- Deleted rather than closed with an effective_to. A rate row is a record
-- of what we believed a price was; these could never have priced anything,
-- so they are a mistake to remove rather than a belief to keep.
delete from public.cost_rates
  where provider = 'OpenAI' and service = 'Audio' and sku = 'gpt-audio';

insert into public.cost_rates (
  provider, service, sku, unit, price_per_unit_usd, included_units,
  effective_from, source_url, source_label
) values
  ('OpenAI', 'AI', 'gpt-audio', 'input_token', 0.0000025, 0,
   timestamptz '2026-09-05', 'https://openai.com/api/pricing/',
   '$2.50 per 1M text input tokens'),
  ('OpenAI', 'AI', 'gpt-audio', 'output_token', 0.00001, 0,
   timestamptz '2026-09-05', 'https://openai.com/api/pricing/',
   '$10.00 per 1M output tokens'),
  -- The diarised sibling was priced when lesson recaps shipped; the plain
  -- transcribe model is the recovery path and was missed.
  ('OpenAI', 'Transcription', 'gpt-4o-transcribe', 'audio_second',
   0.0001, 0, timestamptz '2026-09-05',
   'https://openai.com/api/pricing/',
   'Estimated $0.006/min; actual model billing is token-based')
on conflict (provider, service, sku, unit, effective_from) do nothing;
