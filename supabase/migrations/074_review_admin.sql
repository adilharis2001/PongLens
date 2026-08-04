-- 074: admin visibility for paid reviews.
--
-- disputed_at marks orders whose charge got a chargeback (webhook writes
-- it via service role); admin_review_orders() is the /admin/reviews feed,
-- names included, is_admin() re-checked inside like every admin_* fn.

alter table public.review_orders
  add column disputed_at timestamptz;

create or replace function public.admin_review_orders()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'status', o.status,
      'offering_title', off.title,
      'coach_name', coalesce(nullif(btrim(public._display_name(cu.*)), ''),
                             'Coach'),
      'student_name', coalesce(nullif(btrim(public._display_name(su.*)), ''),
                               'Player'),
      'price_cents', o.price_cents,
      'fee_cents', o.fee_cents,
      'fee_mode', o.fee_mode,
      'refunded', o.stripe_refund_id is not null,
      'paid_out', o.stripe_payout_id is not null,
      'disputed_at', o.disputed_at,
      'created_at', o.created_at,
      'completed_at', o.completed_at
    ) order by o.created_at desc)
    from public.review_orders o
    join public.offerings off on off.id = o.offering_id
    join auth.users cu on cu.id = o.coach_id
    join auth.users su on su.id = o.student_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_review_orders() from public, anon;
grant execute on function public.admin_review_orders() to authenticated;

-- Admin cancel+refund path: same shape as coach_cancel but admin-gated,
-- so a stuck order can always be unwound from /admin/reviews.
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
  if v_o.status in ('completed', 'declined', 'cancelled') then
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

revoke all on function public.admin_cancel_review_order(uuid, text)
  from public, anon;
grant execute on function public.admin_cancel_review_order(uuid, text)
  to authenticated;
