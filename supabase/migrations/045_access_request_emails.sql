-- 045: notification stamps for access requests. The Mac worker emails the
-- admin when a request comes in and the requester when it's approved;
-- these columns make each email exactly-once across worker restarts.

alter table public.access_requests
  add column admin_notified_at timestamptz,
  add column user_notified_at  timestamptz;
