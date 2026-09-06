-- The phone cuts the clip file itself (spec 2026-09-06, step 5).
--
-- After a timing edit on iOS the app can cut the point's clip from the cut
-- video with the same machinery it uses to build Instagram share clips
-- (StoryRenderer: a range read of the signed cut, a composition, an
-- export), upload it, and claim it here. The worker's re-cut job is still
-- requested by the points trigger and is the safety net: whichever lands
-- first wins, the other finds `edited` already cleared and stands down.
--
--  * app_config.device_reclip  'off' | 'on'   default off, like
--    instagram_render, until it has been through a real handset; joins
--    the public allow-list so the app can read it as `authenticated`.
--
--  * claim_point_clip: the one statement that makes a phone-made file the
--    point's clip. Ownership through the match, the key pinned to the
--    caller's own folder for that match, the claim guarded exactly as the
--    worker's (t0/t1 unchanged AND still edited, so a re-cut that already
--    landed is never overwritten), the storage row appended, and the
--    previous re-cut object's bytes netted out (an original NN.mp4 stays:
--    its bytes are booked under the match prefix as one row). Returns
--    {applied, previous} so the route can delete the loser's object.

insert into public.app_config (key, value)
values ('device_reclip', 'off')
on conflict (key) do nothing;

drop policy if exists "Public app config is readable" on public.app_config;

create policy "Public app config is readable"
  on public.app_config for select
  using (
    key = any (array[
      'support_email',
      'commerce_enabled',
      'coach_reviews_enabled',
      'review_included_minutes',
      'review_fee_mode',
      'review_fee_percent',
      'review_fee_fixed_cents',
      'minute_packs',
      'storage_packs',
      'sponsored_packs',
      'sponsored_free_credits',
      'sponsored_reviews_enabled',
      'free_processing_minutes',
      'default_storage_bytes',
      'placement_serves_only',
      'instagram_sharing',
      'instagram_render',
      'iap_enabled',
      'device_reclip'
    ])
  );

create or replace function public.claim_point_clip(
  p_point_id uuid,
  p_key text,
  p_bytes bigint,
  p_t0 numeric,
  p_t1 numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_point public.points;
  v_prefix text;
  v_prev text;
  v_applied boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 62914560 then
    raise exception 'invalid byte count' using errcode = '23514';
  end if;
  select p.* into v_point
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_point_id
     and m.user_id = auth.uid()
     for update of p;
  if v_point.id is null then
    raise exception 'point not found' using errcode = 'P0002';
  end if;
  v_prefix := 'r2://ponglens-media/points/' || auth.uid()::text || '/'
              || v_point.match_id::text || '/';
  if p_key is null or position(v_prefix in p_key) <> 1
     or p_key !~ '^[A-Za-z0-9:/._-]+\.mp4$' then
    raise exception 'invalid key' using errcode = '23514';
  end if;

  v_prev := v_point.clip_path;
  update public.points
     set clip_path = p_key, edited = false
   where id = v_point.id
     and edited
     and t0 = p_t0
     and t1 = p_t1;
  v_applied := found;

  if v_applied then
    insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key)
    values (auth.uid(), v_point.match_id, 'clip', p_bytes, p_key);
    if v_prev is not null
       and v_prev ~ ('^' || regexp_replace(v_prefix, '([.+?^$(){}|\[\]\\])', '\\\1', 'g')
                     || '[0-9]{2}-[0-9a-f]{8}\.mp4$') then
      perform public._ledger_negate_keys(array[v_prev]);
    end if;
  end if;

  return jsonb_build_object(
    'applied', v_applied,
    'previous', case when v_applied then v_prev else null end
  );
end;
$$;

revoke execute on function public.claim_point_clip(uuid, text, bigint, numeric, numeric)
  from public, anon;
grant execute on function public.claim_point_clip(uuid, text, bigint, numeric, numeric)
  to authenticated;
