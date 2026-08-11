-- 094: restore coach_page to its 087 shape (sections, testimonials) with
-- 092's QA gating kept. 092 rebuilt the function from an older copy and
-- dropped those two keys, which 500'd the storefront.

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

  -- 092: a QA coach's storefront exists only for QA viewers and the
  -- admin; everyone else (including anon) sees the same null as an
  -- unregistered handle.
  if public.is_qa(v_cp.user_id)
     and not (public.is_qa((select auth.uid())) or public.is_admin()) then
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
    'sections', v_cp.sections,
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
