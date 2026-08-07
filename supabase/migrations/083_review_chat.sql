-- 083: the clarification thread becomes a real chat.
--
-- The old pair (request_review_clarification / reply_review_clarification)
-- enforced strict turn-taking: the coach could not ask twice, the student
-- could not add a second thought. One RPC now lets either party write
-- whenever the order is being worked; the status still tracks whose court
-- the ball is in (coach wrote last = 'clarification', student wrote last
-- = 'in_review') because the queue labels and clocks read it.

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
    'testimonial_left', 'clarification_answered'));

create or replace function public.send_review_message(
  p_order_id uuid, p_body text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_o       public.review_orders%rowtype;
  v_body    text := btrim(coalesce(p_body, ''));
  v_flipped boolean;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'empty_message' using errcode = '23514';
  end if;
  if char_length(v_body) > 2000 then
    v_body := left(v_body, 2000);
  end if;

  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or (v_o.coach_id <> v_me and v_o.student_id <> v_me) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('in_review', 'clarification') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  insert into public.review_messages (order_id, author_id, kind, body)
  values (p_order_id, v_me, 'clarification', v_body);

  -- Status flips ring the existing review_orders_notify trigger; this
  -- RPC bells only the consecutive messages the trigger cannot see.
  if v_me = v_o.coach_id then
    v_flipped := v_o.status <> 'clarification';
    update public.review_orders
       set status = 'clarification', updated_at = now()
     where id = p_order_id;
    if not v_flipped then
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values
        (v_o.student_id, 'clarification_requested', v_o.match_id, v_me,
         'Your coach wrote to you', left(v_body, 120),
         '/orders/' || v_o.id);
    end if;
  else
    v_flipped := v_o.status <> 'in_review';
    update public.review_orders
       set status = 'in_review', updated_at = now()
     where id = p_order_id;
    if not v_flipped then
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values
        (v_o.coach_id, 'clarification_answered', v_o.match_id, v_me,
         'They wrote back', left(v_body, 120),
         '/coaching/orders/' || v_o.id);
    end if;
  end if;

  -- The caller emails only when the turn changed hands, so a burst of
  -- messages is one email, not five.
  return jsonb_build_object(
    'flipped', v_flipped,
    'sender', case when v_me = v_o.coach_id then 'coach' else 'student' end
  );
end;
$$;

revoke all on function public.send_review_message(uuid, text)
  from public, anon;
grant execute on function public.send_review_message(uuid, text)
  to authenticated;
