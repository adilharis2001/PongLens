-- 093: admin_review_orders carries billing_mode (092), so /admin/reviews
-- can label test orders and keep them out of the fee total.

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
      'billing_mode', o.billing_mode,
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
