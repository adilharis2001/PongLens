-- 096: the usage-based commercial model.
--
-- The design in one breath: uploading and processing come apart. An upload
-- creates a library row (matches.status 'uploaded', raw_path set) and books
-- storage; processing is a separate, deliberate action that spends whole
-- minutes of source-video duration from a per-user balance. New accounts
-- get a one-time free minute grant and a bigger default storage allowance;
-- more of either is bought in admin-configured packs through the platform's
-- own Stripe checkout (never the coach Connect rails). Coaching orders fund
-- their own processing: a paid or sponsored review never draws the player's
-- personal balance. Sponsored reviews are a per-offering invite the coach
-- covers from a prepaid credit balance, seeded with a free allowance.
--
-- Ground rules carried over from 092: every money-bearing row is stamped
-- with billing_mode at creation, test and live counterparties never mix,
-- and revenue queries filter billing_mode = 'live'. House style throughout:
-- RLS + column grants, transitions inside SECURITY DEFINER RPCs with FOR
-- UPDATE, stable error slugs, clients get no direct writes to money tables.
--
-- Storage counting changes here too, per the agreed policy: raw uploads and
-- the cut video count toward the allowance; point clips, voice, sketches
-- and thumbnails do not. Rows held by an active review order are excluded
-- until the order leaves its active states.
--
-- Everything purchase-facing is dark until app_config.commerce_enabled
-- flips to 'true'; until then the app keeps today's upload-and-process
-- behavior and none of this is reachable.

-- ---------------------------------------------------------------------------
-- Config seeds. Values are the launch guesses agreed on 2026-08-11; every
-- one is editable from /admin/commerce, which is the point.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values
  ('commerce_enabled', 'false'),
  ('free_processing_minutes', '250'),
  ('review_included_minutes', '45'),
  ('sponsored_free_credits', '3'),
  ('minute_packs',
   '[{"key":"m60","minutes":60,"price_cents":500},'
   '{"key":"m180","minutes":180,"price_cents":1200},'
   '{"key":"m600","minutes":600,"price_cents":3500}]'),
  ('storage_packs',
   '[{"key":"s100","gb":100,"months":12,"price_cents":2500},'
   '{"key":"s500","gb":500,"months":12,"price_cents":10000}]'),
  ('sponsored_packs',
   '[{"key":"sp5","credits":5,"price_cents":2000},'
   '{"key":"sp15","credits":15,"price_cents":5000}]')
on conflict (key) do nothing;

-- New-account storage default rises to 10 GB. Same move as 043: rows still
-- at the old default follow it; custom grants keep their custom value.
update public.app_config set value = '10737418240'
 where key = 'default_storage_bytes';
update public.user_quotas
   set storage_limit_bytes = 10737418240
 where storage_limit_bytes = 5368709120;

-- Small readers used by the functions below.
create or replace function public._commerce_int(p_key text, p_fallback integer)
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    nullif(regexp_replace(coalesce(
      (select value from public.app_config where key = p_key), ''),
      '[^0-9-]', '', 'g'), '')::integer,
    p_fallback);
$$;

revoke all on function public._commerce_int(text, integer)
  from public, anon, authenticated;

create or replace function public._commerce_on()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from public.app_config
                   where key = 'commerce_enabled'), 'false') = 'true';
$$;

revoke all on function public._commerce_on()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- matches learns to exist before processing.
-- ---------------------------------------------------------------------------
alter table public.matches
  add column raw_path      text,
  add column duration_s    double precision,
  add column original_name text;

alter table public.matches
  drop constraint if exists matches_status_check;
alter table public.matches
  add constraint matches_status_check
  check (status in ('uploaded', 'processing', 'ready', 'failed'));

-- ---------------------------------------------------------------------------
-- processing_ledger — whole minutes, signed, append-only. Balance is the
-- sum of a user's 'personal' rows in their billing mode; order-funded
-- spends live here for the audit trail but never touch that balance.
-- ---------------------------------------------------------------------------
create table public.processing_ledger (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  minutes      integer not null,
  kind         text not null
               check (kind in ('grant', 'purchase', 'spend', 'refund', 'adjust')),
  funding      text not null default 'personal'
               check (funding in ('personal', 'order', 'sponsored')),
  billing_mode text not null default 'live'
               check (billing_mode in ('live', 'test')),
  match_id     uuid references public.matches (id) on delete set null,
  job_id       uuid references public.jobs (id) on delete set null,
  order_id     uuid references public.review_orders (id) on delete set null,
  purchase_id  uuid,
  note         text,
  created_at   timestamptz not null default now()
);

create index processing_ledger_user_idx
  on public.processing_ledger (user_id, billing_mode);
create index processing_ledger_job_idx on public.processing_ledger (job_id);

alter table public.processing_ledger enable row level security;

create policy "Users can view own processing ledger"
  on public.processing_ledger for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.processing_ledger from authenticated;

create or replace function public._processing_balance(p_user uuid, p_mode text)
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(minutes), 0)::integer
  from public.processing_ledger
  where user_id = p_user
    and billing_mode = p_mode
    and funding = 'personal';
$$;

revoke all on function public._processing_balance(uuid, text)
  from public, anon, authenticated;

-- The one-time free grant, created lazily the first time a balance is
-- asked for, so existing accounts pick it up with no backfill.
create or replace function public._ensure_processing_grant(p_user uuid, p_mode text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.processing_ledger
    where user_id = p_user and billing_mode = p_mode and kind = 'grant'
  ) then
    insert into public.processing_ledger
      (user_id, minutes, kind, funding, billing_mode, note)
    values
      (p_user, public._commerce_int('free_processing_minutes', 250),
       'grant', 'personal', p_mode, 'free allowance');
  end if;
end;
$$;

revoke all on function public._ensure_processing_grant(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- storage_entitlements — 12-month blocks on top of the base allowance.
-- Expired rows stay for history; only unexpired ones count.
-- ---------------------------------------------------------------------------
create table public.storage_entitlements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  bytes        bigint not null check (bytes > 0),
  source       text not null default 'purchase'
               check (source in ('purchase', 'grant')),
  billing_mode text not null default 'live'
               check (billing_mode in ('live', 'test')),
  purchase_id  uuid,
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  note         text,
  created_at   timestamptz not null default now()
);

create index storage_entitlements_user_idx
  on public.storage_entitlements (user_id, expires_at);

alter table public.storage_entitlements enable row level security;

create policy "Users can view own entitlements"
  on public.storage_entitlements for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.storage_entitlements from authenticated;

-- ---------------------------------------------------------------------------
-- platform_purchases — one row per checkout attempt against the platform's
-- own Stripe account (minute packs, storage, sponsored packs). The webhook
-- fulfills by flipping pending -> paid and writing the grant in the same
-- function, so a redelivered event finds nothing to do.
-- ---------------------------------------------------------------------------
create table public.platform_purchases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null
                check (kind in ('minute_pack', 'storage', 'sponsored_pack')),
  pack_key      text not null,
  title         text not null,
  minutes       integer,
  bytes         bigint,
  months        integer,
  credits       integer,
  amount_cents  integer not null check (amount_cents > 0),
  billing_mode  text not null default 'live'
                check (billing_mode in ('live', 'test')),
  status        text not null default 'pending'
                check (status in ('pending', 'paid')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);

create unique index platform_purchases_session_idx
  on public.platform_purchases (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index platform_purchases_user_idx
  on public.platform_purchases (user_id, created_at desc);

alter table public.platform_purchases enable row level security;

create policy "Users can view own purchases"
  on public.platform_purchases for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.platform_purchases from authenticated;

-- ---------------------------------------------------------------------------
-- Sponsored reviews: the coach's prepaid credit balance and the per-student
-- invite. One credit covers one claimed review.
-- ---------------------------------------------------------------------------
create table public.sponsored_credit_ledger (
  id           bigint generated always as identity primary key,
  coach_id     uuid not null references auth.users (id) on delete cascade,
  credits      integer not null,
  kind         text not null
               check (kind in ('grant', 'purchase', 'spend', 'refund', 'adjust')),
  billing_mode text not null default 'live'
               check (billing_mode in ('live', 'test')),
  order_id     uuid references public.review_orders (id) on delete set null,
  invite_id    uuid,
  purchase_id  uuid,
  note         text,
  created_at   timestamptz not null default now()
);

create index sponsored_credit_ledger_coach_idx
  on public.sponsored_credit_ledger (coach_id, billing_mode);

alter table public.sponsored_credit_ledger enable row level security;

create policy "Coaches can view own credit ledger"
  on public.sponsored_credit_ledger for select
  to authenticated
  using (coach_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.sponsored_credit_ledger from authenticated;

create table public.sponsored_invites (
  id          uuid primary key default gen_random_uuid(),
  token       uuid not null unique default gen_random_uuid(),
  offering_id uuid not null references public.offerings (id) on delete cascade,
  coach_id    uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'claimed', 'revoked')),
  note        text,
  order_id    uuid references public.review_orders (id) on delete set null,
  claimed_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  revoked_at  timestamptz
);

create index sponsored_invites_coach_idx
  on public.sponsored_invites (coach_id, created_at desc);

alter table public.sponsored_invites enable row level security;

create policy "Coaches manage own invites"
  on public.sponsored_invites for select
  to authenticated
  using (coach_id = (select auth.uid()) or public.is_admin());

-- Revoking is the only direct write a coach gets; minting and claiming are
-- RPCs so balances and walls are checked in one place.
create policy "Coaches can revoke own invites"
  on public.sponsored_invites for update
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

revoke insert, delete on public.sponsored_invites from authenticated;
revoke update on public.sponsored_invites from authenticated;
grant update (status, revoked_at) on public.sponsored_invites to authenticated;

create or replace function public._sponsored_balance(p_coach uuid, p_mode text)
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(credits), 0)::integer
  from public.sponsored_credit_ledger
  where coach_id = p_coach and billing_mode = p_mode;
$$;

revoke all on function public._sponsored_balance(uuid, text)
  from public, anon, authenticated;

create or replace function public._ensure_sponsored_grant(p_coach uuid, p_mode text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sponsored_credit_ledger
    where coach_id = p_coach and billing_mode = p_mode and kind = 'grant'
  ) then
    insert into public.sponsored_credit_ledger
      (coach_id, credits, kind, billing_mode, note)
    values
      (p_coach, public._commerce_int('sponsored_free_credits', 3),
       'grant', p_mode, 'free allowance');
  end if;
end;
$$;

revoke all on function public._ensure_sponsored_grant(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- review_orders learns how it was funded; storage_ledger learns which rows
-- an active order is holding outside the player's allowance.
-- ---------------------------------------------------------------------------
alter table public.review_orders
  add column funding text not null default 'player_paid'
  check (funding in ('player_paid', 'sponsored'));

alter table public.storage_ledger
  add column order_id uuid references public.review_orders (id) on delete set null;

alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'note', 'match_ready', 'match_failed',
    'reel_ready', 'reel_failed', 'coach_joined',
    'upload_failed',
    'order_paid', 'order_submitted', 'order_accepted', 'order_declined',
    'clarification_requested', 'review_delivered', 'followup_received',
    'order_completed', 'order_refunded',
    'sample_requested', 'sample_responded',
    'testimonial_left', 'clarification_answered',
    'sponsored_claimed'));

-- A sponsored order that dies before completion gives the credit back.
-- Trigger rather than four RPC rewrites: decline, student cancel, coach
-- cancel and admin cancel all pass through here, and the not-exists guard
-- makes redelivery a no-op.
create or replace function public.sponsored_refund_on_exit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.funding = 'sponsored'
     and new.status in ('declined', 'cancelled')
     and old.status not in ('declined', 'cancelled')
     and not exists (
       select 1 from public.sponsored_credit_ledger
       where order_id = new.id and kind = 'refund')
  then
    insert into public.sponsored_credit_ledger
      (coach_id, credits, kind, billing_mode, order_id, note)
    values
      (new.coach_id, 1, 'refund', new.billing_mode, new.id,
       'review did not happen');
  end if;
  return new;
end;
$$;

create trigger review_orders_sponsored_refund
  after update of status on public.review_orders
  for each row execute function public.sponsored_refund_on_exit();

-- ---------------------------------------------------------------------------
-- register_upload — the new front door. Validates the raw key the same way
-- ledger_append_upload does, creates the library row and books the bytes
-- in one statement. An order id tags the ledger row as held by that order.
-- ---------------------------------------------------------------------------
create or replace function public.register_upload(
  p_key           text,
  p_bytes         bigint,
  p_duration_s    double precision default null,
  p_original_name text default null,
  p_opponent      text default null,
  p_venue         text default null,
  p_match_type    text default null,
  p_user_side     text default null,
  p_order_id      uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 8589934592 then
    raise exception 'invalid byte count' using errcode = '23514';
  end if;
  if p_key not like 'r2://ponglens-raw/' || v_me || '/%' then
    raise exception 'invalid key' using errcode = '23514';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.review_orders o
    where o.id = p_order_id and o.student_id = v_me
      and o.status in ('awaiting_submission', 'submitted',
                       'in_review', 'clarification')
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.matches
    (user_id, status, raw_path, duration_s, original_name,
     opponent_name, venue, match_type, user_side)
  values
    (v_me, 'uploaded', p_key,
     case when p_duration_s > 0 then p_duration_s end,
     nullif(trim(coalesce(p_original_name, '')), ''),
     nullif(trim(coalesce(p_opponent, '')), ''),
     nullif(trim(coalesce(p_venue, '')), ''),
     case when p_match_type in ('drills', 'practice', 'match',
                                'league', 'tournament')
          then p_match_type end,
     case when p_user_side in ('near', 'far') then p_user_side end)
  returning id into v_id;

  insert into public.storage_ledger
    (user_id, match_id, kind, bytes, r2_key, order_id)
  values (v_me, v_id, 'other', p_bytes, p_key, p_order_id);

  return v_id;
end;
$$;

revoke all on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid)
  to authenticated;

-- Write-once duration backfill for uploads whose metadata the browser
-- could not read at upload time. Only shrinks or sets, never a charge
-- risk: processing always runs exactly the window that was paid for.
create or replace function public.set_match_duration(
  p_match_id uuid, p_duration_s double precision)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_duration_s is null or p_duration_s <= 0 or p_duration_s > 86400 then
    raise exception 'invalid duration' using errcode = '23514';
  end if;
  update public.matches
     set duration_s = p_duration_s
   where id = p_match_id and user_id = auth.uid()
     and status = 'uploaded' and duration_s is null;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_match_duration(uuid, double precision)
  from public, anon;
grant execute on function public.set_match_duration(uuid, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- my_storage_state — same call, new arithmetic. storage_limit_bytes is now
-- the EFFECTIVE limit (base + unexpired entitlements) so every existing
-- caller gets the right gate for free; the new columns carry the breakdown.
-- used_bytes counts raw uploads and cut videos only, minus rows held by an
-- active review order.
-- ---------------------------------------------------------------------------
drop function if exists public.my_storage_state();

create function public.my_storage_state()
returns table (
  storage_limit_bytes bigint,
  daily_upload_limit  int,
  used_bytes          bigint,
  uploads_today       int,
  active_jobs         int,
  pending_request     boolean,
  base_limit_bytes    bigint,
  entitlement_bytes   bigint,
  entitlement_expires_at timestamptz,
  held_bytes          bigint
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  perform public._ensure_quota(v_me);
  return query
  with ent as (
    select coalesce(sum(e.bytes), 0)::bigint as bytes,
           min(e.expires_at) as next_expiry
    from public.storage_entitlements e
    where e.user_id = v_me and e.expires_at > now()
  ),
  led as (
    select coalesce(sum(l.bytes), 0)::bigint as counted
    from public.storage_ledger l
    where l.user_id = v_me
      and (l.r2_key like 'r2://ponglens-raw/%' or l.kind = 'cut')
  ),
  held_rows as (
    select coalesce(sum(l.bytes), 0)::bigint as held
    from public.storage_ledger l
    join public.review_orders o on o.id = l.order_id
    where l.user_id = v_me
      and (l.r2_key like 'r2://ponglens-raw/%' or l.kind = 'cut')
      and o.status in ('awaiting_submission', 'submitted',
                       'in_review', 'clarification', 'delivered')
  )
  select
    q.storage_limit_bytes + ent.bytes,
    q.daily_upload_limit,
    greatest(led.counted - held_rows.held, 0),
    ((select count(*) from public.matches m
      where m.user_id = v_me and m.raw_path is not null
        and m.created_at >= date_trunc('day', now()))
     + (select count(*) from public.jobs j
        where j.user_id = v_me
          and ((j.kind = 'deadspace_cut' and j.options ->> 'match_id' is null)
               or j.kind = 'youtube_import')
          and j.created_at >= date_trunc('day', now())))::int,
    (select count(*) from public.jobs j
     where j.user_id = v_me
       and j.status in ('queued', 'processing')
       and j.kind <> 'reclip')::int,
    exists (select 1 from public.quota_requests r
            where r.user_id = v_me and r.status = 'pending'),
    q.storage_limit_bytes,
    ent.bytes,
    ent.next_expiry,
    held_rows.held
  from public.user_quotas q, ent, led, held_rows
  where q.user_id = v_me;
end;
$$;

revoke execute on function public.my_storage_state() from public, anon;
grant execute on function public.my_storage_state() to authenticated;

-- ---------------------------------------------------------------------------
-- my_processing_state — balance in the caller's mode, granting the free
-- allowance on first touch.
-- ---------------------------------------------------------------------------
create or replace function public.my_processing_state()
returns table (
  minutes_balance integer,
  billing_mode    text
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_mode text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  v_mode := public.current_billing_mode();
  perform public._ensure_processing_grant(v_me, v_mode);
  return query select public._processing_balance(v_me, v_mode), v_mode;
end;
$$;

revoke execute on function public.my_processing_state() from public, anon;
grant execute on function public.my_processing_state() to authenticated;

-- ---------------------------------------------------------------------------
-- claim_processing — the money moment. Validates the video, computes the
-- charge from the trimmed window (whole minutes, rounded up, minimum one),
-- picks the funding path, spends, and enqueues the job, all under a row
-- lock so two taps cannot double-spend. The worker processes exactly the
-- window that was charged, so the client-reported duration can only ever
-- shortchange the claimer, never the platform.
-- ---------------------------------------------------------------------------
create or replace function public.claim_processing(
  p_match_id     uuid,
  p_trim_start_s double precision default null,
  p_trim_end_s   double precision default null,
  p_points       boolean default true,
  p_placement    boolean default false,
  p_strictness   text default 'normal',
  p_order_id     uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_mode    text;
  v_match   public.matches%rowtype;
  v_order   public.review_orders%rowtype;
  v_start   double precision;
  v_end     double precision;
  v_charge  integer;
  v_funding text := 'personal';
  v_active  integer;
  v_job     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;
  if p_strictness not in ('tight', 'normal', 'loose') then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_match.status not in ('uploaded', 'failed') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if v_match.raw_path is null
     or v_match.raw_path not like 'r2://ponglens-raw/' || v_me || '/%' then
    raise exception 'no_source' using errcode = 'P0001';
  end if;
  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;

  v_start := greatest(coalesce(p_trim_start_s, 0), 0);
  v_end   := least(coalesce(p_trim_end_s, v_match.duration_s),
                   v_match.duration_s);
  if v_end - v_start < 5 then
    raise exception 'trim_too_short' using errcode = 'P0001';
  end if;
  v_charge := greatest(1, ceil((v_end - v_start) / 60.0))::integer;

  -- A video with a job already in flight must not be claimable again —
  -- the status only flips at the worker's points stage, so without this
  -- a double tap across two devices would double-spend.
  if exists (
    select 1 from public.jobs j
    where (j.options ->> 'match_id')::uuid = p_match_id
      and j.status in ('queued', 'processing')
  ) then
    raise exception 'already_processing' using errcode = 'P0001';
  end if;

  -- One processing at a time per user keeps the queue fair; same rule the
  -- upload gate applied when uploads were the enqueue point.
  select count(*) into v_active from public.jobs j
   where j.user_id = v_me
     and j.status in ('queued', 'processing')
     and j.kind <> 'reclip';
  if v_active >= 4 then
    raise exception 'queue_full' using errcode = 'P0001';
  end if;

  if p_order_id is not null then
    select * into v_order from public.review_orders
     where id = p_order_id and student_id = v_me
     for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if v_order.status not in ('awaiting_submission', 'submitted',
                              'in_review', 'clarification') then
      raise exception 'bad_state' using errcode = 'P0001';
    end if;
    if v_charge > public._commerce_int('review_included_minutes', 45) then
      raise exception 'over_review_limit' using errcode = 'P0001';
    end if;
    v_funding := 'order';
    v_mode := v_order.billing_mode;
  else
    v_mode := public.current_billing_mode();
    perform public._ensure_processing_grant(v_me, v_mode);
    -- The quota row is the per-user serialization point for balance math.
    perform public._ensure_quota(v_me);
    perform 1 from public.user_quotas where user_id = v_me for update;
    if public._processing_balance(v_me, v_mode) < v_charge then
      raise exception 'insufficient_minutes' using errcode = 'P0001';
    end if;
  end if;

  insert into public.jobs
    (user_id, kind, status, input_path, original_name, options)
  values
    (v_me, 'deadspace_cut', 'queued', v_match.raw_path,
     v_match.original_name,
     jsonb_build_object(
       'match_id', p_match_id,
       'trim_start_s', v_start,
       'trim_end_s', v_end,
       'points', p_points,
       'placement', p_placement,
       'strictness', p_strictness,
       'funding', v_funding,
       'order_id', p_order_id,
       'charged_minutes', v_charge))
  returning id into v_job;

  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode,
     match_id, job_id, order_id)
  values
    (v_me, -v_charge, 'spend', v_funding, v_mode,
     p_match_id, v_job, p_order_id);

  return jsonb_build_object(
    'job_id', v_job,
    'charged_minutes', v_charge,
    'funding', v_funding);
end;
$$;

revoke all on function public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid)
  from public, anon;
grant execute on function public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- refund_processing_spend — the worker's compensating entry when a job
-- fails for good. Service role only (the auth.role() guard, per 086).
-- Personal spends come back; order-funded spends have nothing personal to
-- return, and a sponsored order's credit refund rides the order trigger.
-- ---------------------------------------------------------------------------
create or replace function public.refund_processing_spend(p_job_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode,
     match_id, job_id, order_id, note)
  select l.user_id, -l.minutes, 'refund', l.funding, l.billing_mode,
         l.match_id, l.job_id, l.order_id, 'processing failed'
  from public.processing_ledger l
  where l.job_id = p_job_id and l.kind = 'spend'
    and l.funding = 'personal'
    and not exists (
      select 1 from public.processing_ledger r
      where r.job_id = p_job_id and r.kind = 'refund');
end;
$$;

revoke all on function public.refund_processing_spend(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_processing_spend(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Platform purchases: create (signed-in user picks a pack) and fulfill
-- (webhook, service role). The pack is read from config at creation and
-- snapshotted onto the row; config edits never change a pending purchase.
-- ---------------------------------------------------------------------------
create or replace function public.create_platform_purchase(
  p_kind text, p_pack_key text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_cfg    text;
  v_pack   jsonb;
  v_id     uuid;
  v_title  text;
  v_amount integer;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;
  v_cfg := case p_kind
    when 'minute_pack'    then 'minute_packs'
    when 'storage'        then 'storage_packs'
    when 'sponsored_pack' then 'sponsored_packs'
    else null end;
  if v_cfg is null then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select elem into v_pack
  from jsonb_array_elements(coalesce(
    (select value from public.app_config where key = v_cfg), '[]')::jsonb)
    as elem
  where elem ->> 'key' = p_pack_key;
  if v_pack is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_amount := (v_pack ->> 'price_cents')::integer;
  if v_amount is null or v_amount < 50 or v_amount > 100000 then
    raise exception 'invalid_input' using errcode = '23514';
  end if;
  v_title := case p_kind
    when 'minute_pack' then (v_pack ->> 'minutes') || ' processing minutes'
    when 'storage'     then (v_pack ->> 'gb') || ' GB for 12 months'
    else (v_pack ->> 'credits') || ' sponsored reviews' end;

  insert into public.platform_purchases
    (user_id, kind, pack_key, title, minutes, bytes, months, credits,
     amount_cents, billing_mode)
  values
    (v_me, p_kind, p_pack_key, v_title,
     (v_pack ->> 'minutes')::integer,
     ((v_pack ->> 'gb')::bigint) * 1073741824,
     coalesce((v_pack ->> 'months')::integer, 12),
     (v_pack ->> 'credits')::integer,
     v_amount, public.current_billing_mode())
  returning id into v_id;

  return jsonb_build_object(
    'purchase_id', v_id, 'amount_cents', v_amount, 'title', v_title);
end;
$$;

revoke all on function public.create_platform_purchase(text, text)
  from public, anon;
grant execute on function public.create_platform_purchase(text, text)
  to authenticated;

create or replace function public.fulfill_platform_purchase(
  p_purchase_id uuid, p_session_id text, p_intent_id text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.platform_purchases%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.platform_purchases
     set status = 'paid', paid_at = now(),
         stripe_checkout_session_id =
           coalesce(stripe_checkout_session_id, p_session_id),
         stripe_payment_intent_id =
           coalesce(stripe_payment_intent_id, p_intent_id)
   where id = p_purchase_id and status = 'pending'
   returning * into v_p;
  if not found then
    return false;  -- already fulfilled or unknown: nothing to do
  end if;

  if v_p.kind = 'minute_pack' then
    insert into public.processing_ledger
      (user_id, minutes, kind, funding, billing_mode, purchase_id, note)
    values (v_p.user_id, v_p.minutes, 'purchase', 'personal',
            v_p.billing_mode, v_p.id, v_p.title);
  elsif v_p.kind = 'storage' then
    insert into public.storage_entitlements
      (user_id, bytes, source, billing_mode, purchase_id, expires_at, note)
    values (v_p.user_id, v_p.bytes, 'purchase', v_p.billing_mode, v_p.id,
            now() + make_interval(months => coalesce(v_p.months, 12)),
            v_p.title);
  elsif v_p.kind = 'sponsored_pack' then
    insert into public.sponsored_credit_ledger
      (coach_id, credits, kind, billing_mode, purchase_id, note)
    values (v_p.user_id, v_p.credits, 'purchase', v_p.billing_mode,
            v_p.id, v_p.title);
  end if;

  return true;
end;
$$;

revoke all on function public.fulfill_platform_purchase(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fulfill_platform_purchase(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Sponsored invites: mint (coach), read (claim page, logged out included),
-- claim (student). The claim is where money moves, so it takes the coach
-- profile lock, re-checks the balance, applies the QA wall and the
-- capacity rule, and creates the order already in awaiting_submission.
-- ---------------------------------------------------------------------------
create or replace function public.mint_sponsored_invite(
  p_offering_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_off  public.offerings%rowtype;
  v_mode text;
  v_id   uuid;
  v_tok  uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;
  select * into v_off from public.offerings
   where id = p_offering_id and coach_id = v_me and active;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_mode := public.current_billing_mode();
  perform public._ensure_sponsored_grant(v_me, v_mode);
  if public._sponsored_balance(v_me, v_mode) < 1 then
    raise exception 'no_sponsored_credits' using errcode = 'P0001';
  end if;

  insert into public.sponsored_invites (offering_id, coach_id, note)
  values (p_offering_id, v_me, nullif(trim(coalesce(p_note, '')), ''))
  returning id, token into v_id, v_tok;

  return jsonb_build_object('invite_id', v_id, 'token', v_tok);
end;
$$;

revoke all on function public.mint_sponsored_invite(uuid, text)
  from public, anon;
grant execute on function public.mint_sponsored_invite(uuid, text)
  to authenticated;

-- What the claim page shows before (and after) sign-in. Reveals only what
-- the invited student needs: who, what, and whether the link still works.
create or replace function public.sponsored_invite_info(p_token uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_inv public.sponsored_invites%rowtype;
  v_off public.offerings%rowtype;
begin
  select * into v_inv from public.sponsored_invites where token = p_token;
  if not found then
    return null;
  end if;
  select * into v_off from public.offerings where id = v_inv.offering_id;
  return jsonb_build_object(
    'status', case
      when v_inv.status <> 'pending' then v_inv.status
      when v_off.id is null or not v_off.active then 'revoked'
      else 'pending' end,
    'coach_name', coalesce(
      (select cp.display_name from public.coach_profiles cp
        where cp.user_id = v_inv.coach_id), 'Your coach'),
    'offering_title', v_off.title,
    'turnaround_days', v_off.turnaround_days,
    'order_id', case
      when v_inv.claimed_by = auth.uid() then v_inv.order_id end);
end;
$$;

revoke all on function public.sponsored_invite_info(uuid) from public;
grant execute on function public.sponsored_invite_info(uuid) to anon, authenticated;

create or replace function public.claim_sponsored_invite(p_token uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_inv    public.sponsored_invites%rowtype;
  v_off    public.offerings%rowtype;
  v_cp     public.coach_profiles%rowtype;
  v_mode   text;
  v_active integer;
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;

  select * into v_inv from public.sponsored_invites
   where token = p_token for update;
  if not found or v_inv.status <> 'pending' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_inv.coach_id = v_me then
    raise exception 'own_offering' using errcode = 'P0001';
  end if;

  select * into v_off from public.offerings
   where id = v_inv.offering_id and active;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The wall between the economies, same shape as create_review_order.
  v_mode := public.current_billing_mode();
  if (v_mode = 'test') <> public.is_qa(v_inv.coach_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select * into v_cp from public.coach_profiles
   where user_id = v_inv.coach_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cp.max_active_orders is not null then
    select count(*) into v_active from public.review_orders
     where coach_id = v_cp.user_id
       and (status in ('awaiting_submission', 'submitted', 'in_review',
                       'clarification', 'delivered')
            or (status = 'awaiting_payment'
                and created_at > now() - interval '1 hour'));
    if v_active >= v_cp.max_active_orders then
      raise exception 'coach_at_capacity' using errcode = 'P0001';
    end if;
  end if;

  perform public._ensure_sponsored_grant(v_inv.coach_id, v_mode);
  if public._sponsored_balance(v_inv.coach_id, v_mode) < 1 then
    raise exception 'link_inactive' using errcode = 'P0001';
  end if;

  insert into public.review_orders
    (offering_id, coach_id, student_id, status, billing_mode, funding,
     price_cents, fee_mode, fee_cents, coach_share_cents,
     turnaround_days, followup_rounds, intake_questions, review_sections)
  values
    (v_off.id, v_inv.coach_id, v_me, 'awaiting_submission', v_mode,
     'sponsored', 0, 'fixed', 0, 0,
     v_off.turnaround_days, v_off.followup_rounds,
     v_off.intake_questions, v_off.review_sections)
  returning id into v_id;

  insert into public.sponsored_credit_ledger
    (coach_id, credits, kind, billing_mode, order_id, invite_id)
  values (v_inv.coach_id, -1, 'spend', v_mode, v_id, v_inv.id);

  update public.sponsored_invites
     set status = 'claimed', claimed_by = v_me,
         claimed_at = now(), order_id = v_id
   where id = v_inv.id;

  insert into public.notifications (user_id, kind, actor_id, title, body, href)
  values (v_inv.coach_id, 'sponsored_claimed', v_me,
          'Your invitation was accepted',
          'They can now send a match for review.',
          '/coaching/orders/' || v_id);

  return v_id;
end;
$$;

revoke all on function public.claim_sponsored_invite(uuid) from public, anon;
grant execute on function public.claim_sponsored_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin grants — the support path. By email, like admin_set_qa; signed
-- amounts make the same functions the adjustment path. Grants land in the
-- target's own economy (a QA account gets test rows).
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_minutes(
  p_email text, p_minutes integer, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_mode text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_minutes is null or p_minutes = 0 or abs(p_minutes) > 100000 then
    raise exception 'invalid_input' using errcode = '23514';
  end if;
  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  v_mode := case when public.is_qa(v_user) then 'test' else 'live' end;
  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode, note)
  values (v_user, p_minutes, 'adjust', 'personal', v_mode,
          nullif(trim(coalesce(p_note, '')), ''));
  return jsonb_build_object(
    'user_id', v_user,
    'balance', public._processing_balance(v_user, v_mode));
end;
$$;

revoke all on function public.admin_grant_minutes(text, integer, text)
  from public, anon;
grant execute on function public.admin_grant_minutes(text, integer, text)
  to authenticated;

create or replace function public.admin_grant_storage(
  p_email text, p_gb integer, p_months integer default 12,
  p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_gb is null or p_gb < 1 or p_gb > 10240
     or p_months is null or p_months < 1 or p_months > 120 then
    raise exception 'invalid_input' using errcode = '23514';
  end if;
  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  insert into public.storage_entitlements
    (user_id, bytes, source, billing_mode, expires_at, note)
  values (v_user, p_gb::bigint * 1073741824, 'grant',
          case when public.is_qa(v_user) then 'test' else 'live' end,
          now() + make_interval(months => p_months),
          nullif(trim(coalesce(p_note, '')), ''));
  return jsonb_build_object('user_id', v_user);
end;
$$;

revoke all on function public.admin_grant_storage(text, integer, integer, text)
  from public, anon;
grant execute on function public.admin_grant_storage(text, integer, integer, text)
  to authenticated;

create or replace function public.admin_grant_sponsored(
  p_email text, p_credits integer, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_mode text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_credits is null or p_credits = 0 or abs(p_credits) > 1000 then
    raise exception 'invalid_input' using errcode = '23514';
  end if;
  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  v_mode := case when public.is_qa(v_user) then 'test' else 'live' end;
  insert into public.sponsored_credit_ledger
    (coach_id, credits, kind, billing_mode, note)
  values (v_user, p_credits, 'adjust', v_mode,
          nullif(trim(coalesce(p_note, '')), ''));
  return jsonb_build_object(
    'user_id', v_user,
    'balance', public._sponsored_balance(v_user, v_mode));
end;
$$;

revoke all on function public.admin_grant_sponsored(text, integer, text)
  from public, anon;
grant execute on function public.admin_grant_sponsored(text, integer, text)
  to authenticated;
