-- Patterns an offering suggests to its own coach.
--
-- Until now a template shaped the storefront and then evaporated: the
-- workspace opened on a blank "Add a pattern" whether the coach had sold a
-- twenty dollar first look or a fifty-five dollar full match review. These
-- are the names that offering expects to find, shown faded in the workspace
-- for the coach to take or ignore.
--
-- The student never sees them. They are a prompt for the person doing the
-- work, not a promise to the person paying, which is why they are read live
-- off the offering rather than snapshotted onto the order like
-- review_sections: a coach who improves their prompts should get the better
-- ones on the order they are writing right now.

alter table public.offerings
  add column if not exists suggested_patterns text[] not null default '{}';

alter table public.offerings
  add constraint offerings_suggested_patterns_size_check
    check (pg_column_size(suggested_patterns) <= 4096),
  add constraint offerings_suggested_patterns_count_check
    check (coalesce(array_length(suggested_patterns, 1), 0) <= 8);

-- review_order_detail v5: + the offering's suggested patterns.
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
    'suggested_patterns', to_jsonb(off.suggested_patterns),
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
