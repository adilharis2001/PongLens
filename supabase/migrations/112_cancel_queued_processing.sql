-- 112 — let a player take back a processing claim while it is still queued.
--
-- The upload card processes on completion by default, which is the right
-- default: a first upload should become a match without a second decision,
-- and someone who put their phone down during a ten-minute upload wants to
-- come back to work in progress, not to a video that did nothing.
--
-- What the default was missing is a way out. Minutes are bought, so a claim
-- made by a completion event rather than a keypress needs an undo — the
-- send-and-unsend shape, not a countdown the user has to beat. A countdown
-- makes the calm case anxious and still spends the minutes if the tab
-- closes; an undo costs the common case nothing and only has to work for
-- the person who realises they picked the wrong video.
--
-- The window is defined by the worker, not by a clock: undo is available
-- for exactly as long as the job is still 'queued'. The moment the worker
-- moves it to 'processing' the compute has been spent for real and there is
-- nothing honest left to give back, so the RPC refuses and the button goes
-- away. That is also why this cannot be a timed hold in the worker: the
-- claim is what debits, so holding the job would leave the minutes gone
-- during the hold anyway.
--
-- The refund mirrors refund_processing_spend (the failure path the worker
-- calls): a compensating +minutes row rather than an edit or a delete of
-- the spend, so the ledger stays append-only and the pair reads as what
-- happened. Same not-exists guard, so a double tap cannot double credit.
-- Order-funded claims are out of scope — those minutes belong to the
-- review, and cancelling one is the order's own flow.

-- 'cancelled' is a fourth terminal state. Every reader already treats
-- "active" as queued-or-processing (the library's pending list, Home's
-- active count, RawMatchView's jobRunning, the worker's own claim query),
-- so a cancelled row falls out of all of them without further change.
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('queued', 'processing', 'done', 'failed', 'cancelled'));

create or replace function public.cancel_queued_processing(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      uuid := auth.uid();
  v_job     public.jobs%rowtype;
  v_minutes integer := 0;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- for update: the worker's claim and this cancel race by design, and
  -- whichever gets the row first decides.
  select * into v_job from public.jobs
   where id = p_job_id and user_id = v_me
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_job.kind <> 'deadspace_cut' then
    raise exception 'invalid_input' using errcode = '23514';
  end if;
  if v_job.status <> 'queued' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if coalesce(v_job.options ->> 'funding', 'personal') <> 'personal' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  update public.jobs
     set status = 'cancelled', updated_at = now()
   where id = p_job_id;

  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode,
     match_id, job_id, order_id, note)
  select l.user_id, -l.minutes, 'refund', l.funding, l.billing_mode,
         l.match_id, l.job_id, l.order_id, 'cancelled before processing'
    from public.processing_ledger l
   where l.job_id = p_job_id and l.kind = 'spend'
     and l.funding = 'personal'
     and not exists (
       select 1 from public.processing_ledger r
        where r.job_id = p_job_id and r.kind = 'refund');

  select coalesce(sum(minutes), 0)::integer into v_minutes
    from public.processing_ledger
   where job_id = p_job_id and kind = 'refund';

  return jsonb_build_object('job_id', p_job_id, 'refunded_minutes', v_minutes);
end;
$function$;

revoke all on function public.cancel_queued_processing(uuid) from public, anon;
grant execute on function public.cancel_queued_processing(uuid) to authenticated;
