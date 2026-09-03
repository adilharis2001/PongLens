-- 158: a coach who arrives by invite is flagged as one.
--
-- The coaching side offers itself, and the phone opens on it, from the
-- account's is_coach metadata (156/158 web). Coaches who joined by
-- accepting a player's invite never answered the onboarding question and
-- carried no flag, so their first launch opened as a player and the
-- coaching side hid behind Account. The roster-sync trigger already runs
-- on every accepted link, so it stamps the flag there — one place for
-- both invite directions.
--
-- Backfill only pure coaches: accepted links as a coach and no matches of
-- their own. A player who also coaches keeps landing on the playing side
-- until they switch; the stamp would have flipped their default overnight.

create or replace function public.coach_links_roster_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  select public._name_or(u.*, 'Player') into v_name
    from auth.users u where u.id = new.player_id;

  insert into public.coach_students (coach_id, player_id, display_name)
  values (new.coach_id, new.player_id, coalesce(v_name, 'Player'))
  on conflict (coach_id, player_id)
    where player_id is not null and archived_at is null
    do nothing;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || '{"is_coach": true}'::jsonb
   where id = new.coach_id
     and coalesce(raw_user_meta_data->>'is_coach', '') <> 'true';

  return new;
end;
$$;

update auth.users u
   set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
                            || '{"is_coach": true}'::jsonb
 where coalesce(u.raw_user_meta_data->>'is_coach', '') <> 'true'
   and exists (
     select 1 from public.coach_links cl
     where cl.coach_id = u.id and cl.status = 'accepted'
   )
   and not exists (
     select 1 from public.matches m where m.user_id = u.id
   );
