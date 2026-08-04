-- 076: the coach page gets a face and some footage.
--
-- photo_path: an avatar under avatar/<user_id>/ in the media bucket
-- (permanent; no retention sweep covers that prefix). Client-writable
-- text like notes.image_path, so the signing side pins the prefix to the
-- owner — same trust model as voice and sketches.
--
-- samples: [{label, url}] — links to the coach's play. Either any URL
-- they paste, or a PongLens share link the profile editor mints from one
-- of their own matches (share_links already exist for exactly this).

alter table public.coach_profiles
  add column photo_path text,
  add column samples jsonb not null default '[]'::jsonb;

alter table public.coach_profiles
  add constraint coach_profiles_samples_shape_check
    check (jsonb_typeof(samples) = 'array');

grant update (photo_path, samples) on public.coach_profiles
  to authenticated;

-- The storefront needs both.
create or replace function public.coach_page(p_handle text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_cp     public.coach_profiles%rowtype;
  v_active integer;
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
    -- photo_path is client-writable text; only hand the page a path the
    -- owner could have written, so presigning it is safe sight unseen.
    'photo_path', case
      when v_cp.photo_path like
        'r2://ponglens-media/avatar/' || v_cp.user_id || '/%'
      then v_cp.photo_path else null end,
    'samples', v_cp.samples,
    'available', v_avail,
    'offerings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'title', o.title,
        'description', o.description,
        'includes', to_jsonb(o.includes),
        'price_cents', o.price_cents,
        'turnaround_days', o.turnaround_days,
        'followup_rounds', o.followup_rounds
      ) order by o.sort, o.created_at)
      from public.offerings o
      where o.coach_id = v_cp.user_id and o.active
    ), '[]'::jsonb)
  );
end;
$$;
