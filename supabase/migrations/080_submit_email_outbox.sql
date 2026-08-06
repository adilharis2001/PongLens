-- 080: no more silent submissions.
--
-- When a student submits a match that is still processing, the DB trigger
-- flips the order to 'submitted' once processing lands — server code never
-- runs, so the coach got a bell but no email. The trigger now leaves an
-- outbox flag; the sweep (page-load and daily cron) claims flagged rows
-- and sends the order_submitted email.

alter table public.review_orders
  add column if not exists submit_email_pending boolean not null default false;

create or replace function public.matches_review_submit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status
     or new.status <> 'ready' then
    return new;
  end if;
  update public.review_orders
     set status = 'submitted', submitted_at = now(), updated_at = now(),
         submit_email_pending = true
   where match_id = new.id and status = 'awaiting_submission';
  return new;
end;
$$;
