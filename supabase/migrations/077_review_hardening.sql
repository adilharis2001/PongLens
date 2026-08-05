-- 077: hardening from the adversarial review, before real money.
--
-- 1. Cancelling an awaiting_payment order is forbidden: a live Checkout
--    session (valid ~24h) could still settle after the cancel, leaving a
--    charge with no order and no refund path. Unpaid orders just rot
--    harmlessly; the session expiring is their real end.
-- 2. app_access is granted at PAYMENT (markOrderPaid), not at order
--    creation — creating an unpaid order no longer bypasses the
--    invite-only gate. The RPC grant is removed here.
-- 3. Capacity counts fresh awaiting_payment orders too, so a burst of
--    concurrent checkouts can't queue unbounded paid work past the cap.
-- 4. A finding may only cite points of the order's own match — citation
--    is what outlives the order, so it must not be able to smuggle
--    access to unrelated matches.
-- 5. coach_profiles INSERT gets the same column discipline as UPDATE:
--    the server-managed Stripe columns can no longer be set at creation.
-- 6. Size ceilings on the client-writable jsonb columns.

create or replace function public.cancel_review_order(p_order_id uuid,
                                                      p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status in ('awaiting_submission', 'submitted') then
    null;  -- always cancellable before the coach commits
  elsif v_o.status in ('in_review', 'clarification')
        and v_o.promised_by is not null
        and now() > v_o.promised_by + interval '7 days' then
    null;  -- materially overdue
  else
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'cancelled',
         cancel_reason = 'student: '
           || coalesce(nullif(btrim(p_reason), ''), 'cancelled'),
         cancelled_at = now(),
         updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.admin_cancel_review_order(p_order_id uuid,
                                                            p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status in ('awaiting_payment', 'completed', 'declined',
                    'cancelled') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'cancelled',
         cancel_reason = 'admin: '
           || coalesce(nullif(btrim(p_reason), ''), 'cancelled'),
         cancelled_at = now(),
         updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.create_review_order(p_offering_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_off    public.offerings%rowtype;
  v_cp     public.coach_profiles%rowtype;
  v_active integer;
  v_fee_mode text;
  v_fee    integer;
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce((select value from public.app_config
               where key = 'coach_reviews_enabled'), 'false') <> 'true' then
    raise exception 'purchases_disabled' using errcode = 'P0001';
  end if;

  select * into v_off from public.offerings
   where id = p_offering_id and active;
  if not found then
    raise exception 'offering not found' using errcode = 'P0002';
  end if;
  if v_off.coach_id = v_me then
    raise exception 'own_offering' using errcode = 'P0001';
  end if;

  -- The profile row-lock serializes concurrent purchases past this point.
  select * into v_cp from public.coach_profiles
   where user_id = v_off.coach_id and published
   for update;
  if not found then
    raise exception 'offering not found' using errcode = 'P0002';
  end if;
  if not v_cp.charges_enabled then
    raise exception 'coach_not_ready' using errcode = 'P0001';
  end if;
  if not v_cp.accepting_orders then
    raise exception 'coach_paused' using errcode = 'P0001';
  end if;
  if v_cp.max_active_orders is not null then
    -- Fresh unpaid orders count too: each may become paid work within
    -- its checkout session's life. Stale ones age out of the window.
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

  select f.fee_mode, f.fee_cents into v_fee_mode, v_fee
    from public.review_fee_for(v_off.price_cents) f;

  insert into public.review_orders
    (offering_id, coach_id, student_id, status,
     price_cents, fee_mode, fee_cents, coach_share_cents,
     turnaround_days, followup_rounds, intake_questions, review_sections)
  values
    (v_off.id, v_off.coach_id, v_me, 'awaiting_payment',
     v_off.price_cents, v_fee_mode, v_fee, v_off.price_cents - v_fee,
     v_off.turnaround_days, v_off.followup_rounds,
     v_off.intake_questions, v_off.review_sections)
  returning id into v_id;

  -- app_access is granted when payment lands (markOrderPaid), not here.
  return v_id;
end;
$$;

-- Findings may only cite the order's own match.
drop policy if exists "Coach can link points while working"
  on public.review_finding_points;
create policy "Coach can link points while working"
  on public.review_finding_points for insert
  to authenticated
  with check (exists (
    select 1
    from public.review_findings f
    join public.review_orders o on o.id = f.order_id
    join public.points p on p.id = point_id
    where f.id = finding_id
      and public.review_writable(f.order_id)
      and p.match_id = o.match_id
  ));

-- Column discipline for coach_profiles INSERT, mirroring UPDATE.
revoke insert on public.coach_profiles from authenticated;
grant insert (user_id, handle, display_name, headline, bio, credentials,
              accepting_orders, max_active_orders, published,
              photo_path, samples)
  on public.coach_profiles to authenticated;

-- Ceilings on client-writable jsonb.
alter table public.offerings
  add constraint offerings_questions_size_check
    check (pg_column_size(intake_questions) <= 16384),
  add constraint offerings_sections_size_check
    check (pg_column_size(review_sections) <= 16384);
alter table public.coach_profiles
  add constraint coach_profiles_samples_size_check
    check (pg_column_size(samples) <= 8192);
alter table public.review_orders
  add constraint review_orders_answers_size_check
    check (pg_column_size(intake_answers) <= 32768);
alter table public.review_documents
  add constraint review_documents_sections_size_check
    check (pg_column_size(sections) <= 200000);
