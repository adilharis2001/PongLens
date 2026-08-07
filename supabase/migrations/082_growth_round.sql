-- 082: the growth round — testimonials, invite back, page opens.
-- (Spec: docs/superpowers/specs/2026-08-06-growth-round-spec.md)

-- ---------------------------------------------------------------------------
-- Testimonials: one per order, written by the student on completion,
-- shown on the storefront only when the coach features it. Invite-back:
-- one claim stamp per order.
-- ---------------------------------------------------------------------------
alter table public.review_orders
  add column if not exists testimonial text,
  add column if not exists testimonial_at timestamptz,
  add column if not exists testimonial_featured boolean not null default false,
  add column if not exists invited_back_at timestamptz;

alter table public.review_orders
  drop constraint if exists review_orders_testimonial_check;
alter table public.review_orders
  add constraint review_orders_testimonial_check
    check (testimonial is null or char_length(testimonial) <= 500);

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
    'testimonial_left'));

-- The student's words. Editable any time after completion; a change
-- un-features the quote so the coach approves the new words. The bell
-- rings only the first time.
create or replace function public.leave_review_testimonial(
  p_order_id uuid,
  p_body text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_o    public.review_orders%rowtype;
  v_body text := left(btrim(coalesce(p_body, '')), 500);
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'empty' using errcode = '23514';
  end if;

  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> v_me then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'completed' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  update public.review_orders
     set testimonial = v_body,
         testimonial_at = now(),
         testimonial_featured = false,
         updated_at = now()
   where id = p_order_id;

  if v_o.testimonial_at is null then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values
      (v_o.coach_id, 'testimonial_left', v_o.match_id, v_me,
       'They left you a note',
       left(v_body, 120),
       '/coaching/orders/' || v_o.id);
  end if;
end;
$$;

revoke all on function public.leave_review_testimonial(uuid, text)
  from public, anon;
grant execute on function public.leave_review_testimonial(uuid, text)
  to authenticated;

create or replace function public.feature_review_testimonial(
  p_order_id uuid,
  p_featured boolean
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.testimonial is null then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set testimonial_featured = coalesce(p_featured, false),
         updated_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.feature_review_testimonial(uuid, boolean)
  from public, anon;
grant execute on function public.feature_review_testimonial(uuid, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Page opens: one row per storefront open by someone other than the
-- coach. Written by the server only; a coach can count their own.
-- ---------------------------------------------------------------------------
create table if not exists public.coach_page_views (
  id        bigint generated always as identity primary key,
  coach_id  uuid not null references public.coach_profiles(user_id)
              on delete cascade,
  viewed_at timestamptz not null default now()
);

create index if not exists coach_page_views_coach_time_idx
  on public.coach_page_views (coach_id, viewed_at);

alter table public.coach_page_views enable row level security;

drop policy if exists "Coach counts own page views" on public.coach_page_views;
create policy "Coach counts own page views"
  on public.coach_page_views for select
  to authenticated
  using (coach_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- review_order_detail: + testimonial and invite-back state.
-- ---------------------------------------------------------------------------
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
    'testimonial', o.testimonial,
    'testimonial_at', o.testimonial_at,
    'testimonial_featured', o.testimonial_featured,
    'invited_back_at', o.invited_back_at,
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

-- ---------------------------------------------------------------------------
-- coach_page v4: + featured testimonials (body, first name, when).
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
    'testimonials', coalesce((
      select jsonb_agg(t.item order by t.at desc)
      from (
        select jsonb_build_object(
          'body', o.testimonial,
          'name', coalesce(
            nullif(split_part(btrim(public._display_name(su.*)), ' ', 1), ''),
            'A player'),
          'at', o.testimonial_at
        ) as item, o.testimonial_at as at
        from public.review_orders o
        join auth.users su on su.id = o.student_id
        where o.coach_id = v_cp.user_id
          and o.status = 'completed'
          and o.testimonial_featured
          and o.testimonial is not null
        order by o.testimonial_at desc
        limit 6
      ) t
    ), '[]'::jsonb),
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
