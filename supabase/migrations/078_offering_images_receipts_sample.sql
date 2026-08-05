-- 078: offering images, read receipts, and the featured sample review.
--
-- offerings.image: either 'stock:<key>' (shipped template art under
-- /img/offerings/) or an r2:// path the coach uploaded under
-- offer/<coach_id>/ — the same client-writable-text trust model as
-- avatars, prefix-pinned wherever it is signed.
--
-- review_viewed_at: the read receipt. Set once, by the student, on first
-- view of the delivered review. Coaches elsewhere pay real money for
-- exactly this signal.
--
-- Sample review: a coach may FEATURE one completed review on their
-- storefront, but only with the student's explicit consent — the footage
-- is the student's. Flow: coach requests -> student approves or declines
-- from their order page -> approved sample becomes publicly resolvable,
-- stripped of the student's identity.

alter table public.offerings
  add column image text;

alter table public.review_orders
  add column review_viewed_at timestamptz,
  add column sample_consent text not null default 'none';

alter table public.review_orders
  add constraint review_orders_sample_consent_check
    check (sample_consent in ('none', 'requested', 'approved', 'declined'));

alter table public.coach_profiles
  add column sample_order_id uuid references public.review_orders(id)
    on delete set null;

grant update (sample_order_id) on public.coach_profiles to authenticated;

-- Two new bell kinds for the consent handshake.
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
    'sample_requested', 'sample_responded'));

-- ---------------------------------------------------------------------------
-- Read receipt: first student view of the delivered review.
-- ---------------------------------------------------------------------------
create or replace function public.mark_review_viewed(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.review_orders
     set review_viewed_at = now()
   where id = p_order_id
     and student_id = auth.uid()
     and status in ('delivered', 'completed')
     and review_viewed_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sample review consent handshake.
-- ---------------------------------------------------------------------------
create or replace function public.request_review_sample(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
  v_coach text;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'completed' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if v_o.sample_consent = 'approved' then
    -- Already approved: just point the storefront at it.
    update public.coach_profiles set sample_order_id = p_order_id
     where user_id = auth.uid();
    return;
  end if;

  update public.review_orders
     set sample_consent = 'requested', updated_at = now()
   where id = p_order_id;
  update public.coach_profiles set sample_order_id = p_order_id
   where user_id = auth.uid();

  select coalesce(
      (select nullif(btrim(cp.display_name), '')
         from public.coach_profiles cp where cp.user_id = v_o.coach_id),
      'Your coach') into v_coach;
  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_o.student_id, 'sample_requested', v_o.match_id, v_o.coach_id,
          v_coach || ' wants to feature your review',
          'They would show it on their page as an example. Your call.',
          '/orders/' || p_order_id::text);
end;
$$;

create or replace function public.respond_review_sample(p_order_id uuid,
                                                        p_approve boolean)
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
  if v_o.sample_consent <> 'requested' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set sample_consent = case when p_approve then 'approved'
                               else 'declined' end,
         updated_at = now()
   where id = p_order_id;
  if not p_approve then
    update public.coach_profiles set sample_order_id = null
     where user_id = v_o.coach_id and sample_order_id = p_order_id;
  end if;
  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_o.coach_id, 'sample_responded', v_o.match_id, v_o.student_id,
          case when p_approve then 'Sample approved'
               else 'Sample declined' end,
          case when p_approve then 'Their review is now on your page.'
               else '' end,
          '/coaching/orders/' || p_order_id::text);
end;
$$;

revoke all on function public.mark_review_viewed(uuid),
              public.request_review_sample(uuid),
              public.respond_review_sample(uuid, boolean)
  from public, anon;
grant execute on function public.mark_review_viewed(uuid),
                 public.request_review_sample(uuid),
                 public.respond_review_sample(uuid, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Public sample resolver. Anon-callable; returns the review content with
-- the student's identity stripped, and only owner-prefixed media paths.
-- Point clips are worker-written and safe to hand out; display numbers
-- are ranks among the match's non-deleted points so they match the app.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_sample_review(p_handle text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_cp public.coach_profiles%rowtype;
  v_o  public.review_orders%rowtype;
begin
  select * into v_cp from public.coach_profiles
   where handle = lower(p_handle) and published;
  if not found or v_cp.sample_order_id is null then
    return null;
  end if;
  select * into v_o from public.review_orders
   where id = v_cp.sample_order_id
     and coach_id = v_cp.user_id
     and status = 'completed'
     and sample_consent = 'approved';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'coach_name', coalesce(nullif(btrim(v_cp.display_name), ''),
                           v_cp.handle),
    'handle', v_cp.handle,
    'offering_title', (select title from public.offerings
                        where id = v_o.offering_id),
    'sections', coalesce((select sections from public.review_documents
                           where order_id = v_o.id), '[]'::jsonb),
    'findings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'title', f.title,
        'body', f.body,
        'audio_path', case when f.audio_path like
            'r2://ponglens-media/review/' || v_o.coach_id || '/%'
          then f.audio_path else null end,
        'image_path', case when f.image_path like
            'r2://ponglens-media/sketch/' || v_o.coach_id || '/%'
          then f.image_path else null end,
        'points', coalesce((
          select jsonb_agg(jsonb_build_object(
            'clip_path', p.clip_path,
            'display_no', ranked.rn
          ) order by ranked.rn)
          from public.review_finding_points fp
          join public.points p on p.id = fp.point_id
          join lateral (
            select count(*) as rn from public.points p2
            where p2.match_id = p.match_id and not p2.deleted
              and p2.idx <= p.idx
          ) ranked on true
          where fp.finding_id = f.id and not p.deleted
        ), '[]'::jsonb)
      ) order by f.sort, f.created_at)
      from public.review_findings f
      where f.order_id = v_o.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.resolve_sample_review(text) from public;
grant execute on function public.resolve_sample_review(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The storefront learns about images, volume, and the sample.
-- ---------------------------------------------------------------------------
create or replace function public.coach_page(p_handle text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_cp     public.coach_profiles%rowtype;
  v_active integer;
  v_done   integer;
  v_sample boolean;
  v_avail  boolean;
begin
  select * into v_cp from public.coach_profiles
   where handle = lower(p_handle) and published;
  if not found then
    return null;
  end if;

  select count(*) into v_active from public.review_orders
   where coach_id = v_cp.user_id
     and status in ('awaiting_submission', 'submitted', 'in_review',
                    'clarification', 'delivered');
  select count(*) into v_done from public.review_orders
   where coach_id = v_cp.user_id and status = 'completed';
  v_sample := v_cp.sample_order_id is not null and exists (
    select 1 from public.review_orders o
    where o.id = v_cp.sample_order_id and o.coach_id = v_cp.user_id
      and o.status = 'completed' and o.sample_consent = 'approved');

  v_avail := v_cp.accepting_orders
    and v_cp.charges_enabled
    and (v_cp.max_active_orders is null
         or v_active < v_cp.max_active_orders);

  return jsonb_build_object(
    'handle', v_cp.handle,
    'display_name', v_cp.display_name,
    'headline', v_cp.headline,
    'bio', v_cp.bio,
    'credentials', to_jsonb(v_cp.credentials),
    'photo_path', case
      when v_cp.photo_path like
        'r2://ponglens-media/avatar/' || v_cp.user_id || '/%'
      then v_cp.photo_path else null end,
    'samples', v_cp.samples,
    'completed_count', v_done,
    'has_sample_review', v_sample,
    'available', v_avail,
    'offerings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'title', o.title,
        'description', o.description,
        'includes', to_jsonb(o.includes),
        'price_cents', o.price_cents,
        'turnaround_days', o.turnaround_days,
        'followup_rounds', o.followup_rounds,
        'image', case
          when o.image like 'stock:%' then o.image
          when o.image like
            'r2://ponglens-media/offer/' || v_cp.user_id || '/%'
          then o.image else null end
      ) order by o.sort, o.created_at)
      from public.offerings o
      where o.coach_id = v_cp.user_id and o.active
    ), '[]'::jsonb)
  );
end;
$$;

-- The coach queue carries the read receipt.
create or replace function public.coach_queue()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'offering_title', off.title,
    'student_name', coalesce(nullif(btrim(public._display_name(u.*)), ''),
                             'A player'),
    'price_cents', o.price_cents,
    'coach_share_cents', o.coach_share_cents,
    'match_id', o.match_id,
    'promised_by', o.promised_by,
    'review_viewed_at', o.review_viewed_at,
    'created_at', o.created_at,
    'submitted_at', o.submitted_at,
    'delivered_at', o.delivered_at
  ) order by o.created_at desc), '[]'::jsonb)
  from public.review_orders o
  join public.offerings off on off.id = o.offering_id
  join auth.users u on u.id = o.student_id
  where o.coach_id = auth.uid();
$$;

-- The order detail carries consent state and the read receipt.
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
    'sample_consent', o.sample_consent,
    'review_viewed_at', o.review_viewed_at,
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
