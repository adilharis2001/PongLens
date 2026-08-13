-- 104: stop mailing addresses that have told us to stop.
--
-- Every Resend send so far has been fire-and-forget. Nothing listened for
-- what happened next, so a dead address kept receiving review mail forever
-- and a spam complaint was invisible. Both are the fastest ways to spend
-- the domain reputation that magic links and receipts ride on, and the
-- only email observability the app had was the cost meter.
--
-- Two tables. email_suppressions is the list checked before a send;
-- resend_events is the seen-set that makes the webhook idempotent, the
-- same shape and job as stripe_events (073).
--
-- Only two things land an address here:
--
--   complained — someone pressed the spam button. Always suppressed, and
--                never expires. There is no reading of that signal where
--                sending again is the right move.
--   bounced    — permanent bounce only. A soft bounce is a full mailbox
--                or a server having a bad afternoon, and suppressing on
--                one would silently cut off a paying customer over a
--                transient failure. The webhook decides which is which;
--                the table only stores what it concluded.
--
-- The address is the key, lowercased on the way in, because that is what
-- the send path has in hand. No user_id: a review invite goes to an
-- address that may not have an account yet.
--
-- What this deliberately does NOT cover: Supabase auth mail. Magic links
-- go straight from Supabase to Resend over SMTP without passing through
-- app code, so nothing here can gate them. A hard-bounced address will
-- still be mailed a sign-in link. That is the right failure — locking
-- someone out of their own account to protect a reputation metric is a
-- worse outcome than one wasted send.

create table if not exists public.email_suppressions (
  address     text primary key,
  reason      text not null check (reason in ('bounced', 'complained')),
  detail      text,
  message_id  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.email_suppressions is
  'Addresses the app must not send to (104). Written only by the Resend '
  'webhook; read before every send outside Supabase auth.';
comment on column public.email_suppressions.address is
  'Lowercased recipient address. The key, because the send path has an '
  'address and not always a user.';
comment on column public.email_suppressions.reason is
  'complained = spam button, permanent. bounced = permanent bounce only; '
  'soft bounces never reach this table.';
comment on column public.email_suppressions.detail is
  'Provider wording for the bounce or complaint, kept verbatim so a '
  'support question has something to answer from.';
comment on column public.email_suppressions.message_id is
  'The Resend message id that produced the event, so a suppression joins '
  'back to the send that caused it through the cost meter.';

-- The seen-set for webhook deliveries. Svix retries on any non-2xx, and
-- a complaint arriving twice must not overwrite the first reason or move
-- created_at. Same contract as stripe_events.
create table if not exists public.resend_events (
  event_id     text primary key,
  type         text not null,
  processed_at timestamptz not null default now()
);

comment on table public.resend_events is
  'Resend webhook deliveries already handled, keyed by the svix-id header '
  '(104). Present means done; the handler returns 200 and does nothing.';

alter table public.email_suppressions enable row level security;
alter table public.resend_events enable row level security;

-- Reads are for the admin looking into "why did this person not get their
-- receipt". Writes belong to the webhook, which runs as the service role
-- and bypasses RLS entirely, so no write policy exists on purpose.
drop policy if exists email_suppressions_admin_read on public.email_suppressions;
create policy email_suppressions_admin_read
  on public.email_suppressions for select
  to authenticated
  using (public.is_admin());

drop policy if exists resend_events_admin_read on public.resend_events;
create policy resend_events_admin_read
  on public.resend_events for select
  to authenticated
  using (public.is_admin());

grant select on public.email_suppressions to authenticated;
grant select on public.resend_events to authenticated;

-- The send path asks one question: is this address suppressed. Ask it
-- with the primary key and nothing else, so the check costs an index hit
-- on a table that will stay small.
create index if not exists email_suppressions_created_idx
  on public.email_suppressions (created_at desc);
