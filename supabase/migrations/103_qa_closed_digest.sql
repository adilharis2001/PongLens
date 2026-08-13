-- 103: tell the tester when their reports get closed.
--
-- 102 took QA reports off the public board, which also took away the only
-- way the tester found out anything had happened to one. The status chip
-- on /feedback is still there, but it only speaks to someone who thinks to
-- go and look.
--
-- The channel is the worker's existing daily feedback digest, pointed the
-- other way: once per Toronto day, each QA author gets one mail listing
-- their reports that reached a terminal status since the last one. No
-- closures that day means no mail, the same rule the admin digest already
-- follows.
--
-- Progress is tracked per row rather than by a time window. A window of
-- "the last 24 hours" silently drops everything if the worker is down for
-- a day, and this is the mail that tells a contractor their work landed.
-- A row is stamped only after its mail is accepted, so a failed send
-- retries tomorrow instead of vanishing.

alter table public.feedback_items
  add column if not exists closed_notified_at timestamptz;

comment on column public.feedback_items.closed_notified_at is
  'When the author was mailed that this report reached done/declined (103). '
  'Null means not yet told. Only QA authors are mailed today.';

-- Partial: the digest only ever asks for the unstamped terminal rows.
create index if not exists feedback_items_close_pending_idx
  on public.feedback_items (user_id)
  where closed_notified_at is null and status in ('done', 'declined');

-- Everything already closed is history the tester was never promised.
-- Stamp it so the first run mails what happens next, not the backlog.
update public.feedback_items
   set closed_notified_at = now()
 where closed_notified_at is null
   and status in ('done', 'declined');

-- The once-a-day gate, same shape as digest_last_sent (014). Empty means
-- "no run yet", which is a day that will never match today's date.
insert into public.app_config (key, value)
values ('qa_closed_digest_last_sent', '')
on conflict (key) do nothing;
