-- 075: students see the coach's storefront name, not their account name.
--
-- The walkthrough caught it: coach-demo's auth profile says one name, the
-- coach page another, and the order screen picked the wrong one. The name
-- a student bought from is coach_profiles.display_name; auth identity is
-- only the fallback. Redefines the two student-facing readers and the
-- notification trigger's coach label.

create or replace function public.student_review_orders()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'offering_title', off.title,
    'coach_name', coalesce(
      nullif(btrim(cp.display_name), ''),
      nullif(btrim(public._display_name(u.*)), ''),
      'Your coach'),
    'price_cents', o.price_cents,
    'match_id', o.match_id,
    'promised_by', o.promised_by,
    'created_at', o.created_at,
    'delivered_at', o.delivered_at
  ) order by o.created_at desc), '[]'::jsonb)
  from public.review_orders o
  join public.offerings off on off.id = o.offering_id
  join auth.users u on u.id = o.coach_id
  left join public.coach_profiles cp on cp.user_id = o.coach_id
  where o.student_id = auth.uid();
$$;

create or replace function public.review_order_detail(p_order_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'offering_title', off.title,
    'offering_description', off.description,
    'includes', to_jsonb(off.includes),
    'coach_id', o.coach_id,
    'student_id', o.student_id,
    'coach_name', coalesce(
      nullif(btrim(cp.display_name), ''),
      nullif(btrim(public._display_name(cu.*)), ''),
      'Your coach'),
    'coach_handle', cp.handle,
    'student_name', coalesce(nullif(btrim(public._display_name(su.*)), ''),
                             'A player'),
    'match_id', o.match_id,
    'price_cents', o.price_cents,
    'fee_cents', o.fee_cents,
    'coach_share_cents', o.coach_share_cents,
    'turnaround_days', o.turnaround_days,
    'followup_rounds', o.followup_rounds,
    'intake_questions', o.intake_questions,
    'intake_answers', o.intake_answers,
    'review_sections', o.review_sections,
    'promised_by', o.promised_by,
    'decline_message', o.decline_message,
    'paid_at', o.paid_at,
    'submitted_at', o.submitted_at,
    'accepted_at', o.accepted_at,
    'delivered_at', o.delivered_at,
    'completed_at', o.completed_at,
    'cancelled_at', o.cancelled_at,
    'created_at', o.created_at
  )
  from public.review_orders o
  join public.offerings off on off.id = o.offering_id
  join auth.users cu on cu.id = o.coach_id
  join auth.users su on su.id = o.student_id
  left join public.coach_profiles cp on cp.user_id = o.coach_id
  where o.id = p_order_id
    and (o.student_id = auth.uid() or o.coach_id = auth.uid()
         or public.is_admin());
$$;

create or replace function public.review_orders_notify()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_student text;
  v_coach   text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select coalesce(nullif(btrim(public._display_name(u.*)), ''), 'A player')
    into v_student from auth.users u where u.id = new.student_id;
  select coalesce(
      (select nullif(btrim(cp.display_name), '')
         from public.coach_profiles cp where cp.user_id = new.coach_id),
      (select nullif(btrim(public._display_name(u.*)), '')
         from auth.users u where u.id = new.coach_id),
      'Your coach')
    into v_coach;

  if new.status = 'awaiting_submission' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_paid', new.match_id, new.student_id,
            v_student || ' bought a review',
            'The order is waiting on their match.',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'submitted' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_submitted', new.match_id, new.student_id,
            v_student || ' submitted their match',
            'Ready when you are.',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'in_review' and old.status = 'submitted' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'order_accepted', new.match_id, new.coach_id,
            v_coach || ' started your review', '',
            '/orders/' || new.id::text);

  elsif new.status = 'in_review' and old.status = 'clarification' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'followup_received', new.match_id, new.student_id,
            v_student || ' answered your question', '',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'clarification' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'clarification_requested', new.match_id,
            new.coach_id,
            v_coach || ' has a question',
            'They need an answer before they can finish.',
            '/orders/' || new.id::text);

  elsif new.status = 'delivered' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'review_delivered', new.match_id, new.coach_id,
            'Your review is ready', '',
            '/orders/' || new.id::text);

  elsif new.status = 'declined' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'order_declined', new.match_id, new.coach_id,
            v_coach || ' declined this order',
            'You get a full refund.',
            '/orders/' || new.id::text);

  elsif new.status = 'completed' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_completed', new.match_id, new.student_id,
            'Review complete', 'Your payout is on the way.',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'cancelled' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'order_refunded', new.match_id, null,
            'Order cancelled', 'You get a full refund.',
            '/orders/' || new.id::text);
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_refunded', new.match_id, null,
            'Order cancelled', '',
            '/coaching/orders/' || new.id::text);
  end if;

  return new;
end;
$$;
