-- 065: a finished export tells you WHICH export it is.
--
-- "Reel ready" linked to /match/<id> and nothing more. Tapping it took you
-- to the match page you were probably already on, so it read as a
-- notification that does nothing — and the file you were told about was
-- still three taps away.
--
-- match_reels has been keyed on (match_id, scope) since 028, but this
-- trigger never carried the scope, so nothing downstream could know which
-- video was ready. Putting it on the href lets the notification offer the
-- download itself.
--
-- Copy follows: 'starred' renders your starred points, 'full' the whole
-- match. "Highlight reel" was only ever true of one of them, and the word
-- "reel" is not what the Export sheet calls these.
create or replace function public.match_reels_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_vs    text;
  v_what  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('ready', 'failed') then
    return new;
  end if;

  select * into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;
  v_vs := public._vs_suffix(v_match.opponent_name);
  v_what := case when new.scope = 'full' then 'Full match' else 'Starred points' end;

  if new.status = 'ready' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_ready', v_match.id,
            v_what || ' ready',
            'Your export' || v_vs || ' is rendered. Tap to download it.',
            '/match/' || v_match.id::text || '?export=' || new.scope);
  else
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_failed', v_match.id,
            v_what || ' couldn''t be rendered',
            'Something went wrong rendering your export' || v_vs || '.',
            '/match/' || v_match.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists match_reels_notify_status on public.match_reels;
create trigger match_reels_notify_status
  after update of status on public.match_reels
  for each row execute function public.match_reels_notify();

-- Existing unread "Reel ready" rows point at a bare match URL, so the bell
-- has no scope to download. 'starred' is the only export that existed for
-- most of their lifetime, and a wrong guess costs one tap, not data.
update public.notifications
set href = href || '?export=starred'
where kind = 'reel_ready' and href not like '%?export=%';
