-- 160: a player shares a match with a coach they already have, directly.
--
-- Until now every grant was a link the coach had to open. A player with a
-- connected coach can now write the accepted, match-scoped link straight
-- from the Share with coach sheet — the "Players manage own coach links"
-- policy already allows it, since the row is theirs. What was missing is
-- the coach hearing about it: the roster-sync trigger already runs on
-- every accepted link, so it tells the coach here too, in the same voice
-- as a student's match turning ready.

create or replace function public.coach_links_roster_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_match public.matches%rowtype;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  select public._name_or(u.*, 'Player') into v_name
    from auth.users u where u.id = new.player_id;
  v_name := coalesce(v_name, 'Player');

  insert into public.coach_students (coach_id, player_id, display_name)
  values (new.coach_id, new.player_id, v_name)
  on conflict (coach_id, player_id)
    where player_id is not null and archived_at is null
    do nothing;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || '{"is_coach": true}'::jsonb
   where id = new.coach_id
     and coalesce(raw_user_meta_data->>'is_coach', '') <> 'true';

  -- A direct, match-scoped share written by the player (no invite token
  -- was ever opened): tell the coach which match, so it is one tap away.
  if tg_op = 'INSERT' and new.scope_match_id is not null then
    select * into v_match from public.matches where id = new.scope_match_id;
    if found then
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values (new.coach_id, 'student_match_ready', v_match.id, new.player_id,
              v_name || ' shared a match with you',
              'Their match' || public._vs_suffix(v_match.opponent_name)
                || ' is ready to review.',
              '/match/' || v_match.id::text);
    end if;
  end if;

  return new;
end;
$$;
