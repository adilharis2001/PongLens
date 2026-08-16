-- 113 — stamp an upload with when it was FILMED, not when it arrived.
--
-- register_upload never set played_at, so it defaulted to now(): the
-- moment the bytes finished landing. The worker later overwrites it with
-- the file's own format.tags.creation_time, which is correct — but only
-- once processing has run. Until then every upload claims it was played
-- at upload time.
--
-- That is wrong twice. It is wrong on the facts for anyone uploading
-- Sunday's matches on Monday. And it is wrong on screen, because the
-- untitled match title (matchTitle.untitledHead) uses the time of day to
-- tell one unnamed upload from another: six clips pushed from one camera
-- roll in one sitting are stamped seconds apart, so they all read
-- "Match · 9:25 AM". Two really did during the production walk on
-- 2026-08-16, seven seconds apart and indistinguishable.
--
-- The browser can do better before a single byte moves. File.lastModified
-- on a camera-roll export is the capture time, so the upload card now
-- passes it and the clips separate by the minutes that actually elapsed
-- between them. The worker's creation_time backfill still runs and still
-- wins, because it reads the container rather than the filesystem; this
-- only fixes the window before it.
--
-- Defaulted, so every existing caller keeps working untouched, and
-- clamped: a filesystem date can be anything, including 1970 (a stripped
-- mtime) or next year (a wrong device clock). Outside a sane window we
-- fall back to now() rather than write a lie that sorts the library
-- wrongly forever.
--
-- NOTE the drop at the end. Adding a DEFAULTED argument does not replace
-- a function, it overloads it — and with the tenth argument optional,
-- both candidates match a nine-argument call, so PostgREST answers
-- "function is not unique" and every upload fails at completion. The old
-- signature has to go, and its grants have to be reapplied by hand: a
-- freshly created function is EXECUTE-to-PUBLIC, which would have handed
-- anon a SECURITY DEFINER writer.

create or replace function public.register_upload(
  p_key           text,
  p_bytes         bigint,
  p_duration_s    double precision default null,
  p_original_name text default null,
  p_opponent      text default null,
  p_venue         text default null,
  p_match_type    text default null,
  p_user_side     text default null,
  p_order_id      uuid default null,
  p_played_at     timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_id     uuid;
  v_played timestamptz;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 8589934592 then
    raise exception 'invalid byte count' using errcode = '23514';
  end if;
  if p_key not like 'r2://ponglens-raw/' || v_me || '/%' then
    raise exception 'invalid key' using errcode = '23514';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.review_orders o
    where o.id = p_order_id and o.student_id = v_me
      and o.status in ('awaiting_submission', 'submitted',
                       'in_review', 'clarification')
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- A believable capture date, or none at all.
  v_played := case
    when p_played_at is null then now()
    when p_played_at > now() + interval '1 day' then now()
    when p_played_at < now() - interval '10 years' then now()
    else p_played_at
  end;

  insert into public.matches
    (user_id, status, raw_path, duration_s, original_name,
     opponent_name, venue, match_type, user_side, played_at)
  values
    (v_me, 'uploaded', p_key,
     case when p_duration_s > 0 then p_duration_s end,
     nullif(trim(coalesce(p_original_name, '')), ''),
     nullif(trim(coalesce(p_opponent, '')), ''),
     nullif(trim(coalesce(p_venue, '')), ''),
     case when p_match_type in ('drills', 'practice', 'match',
                                'league', 'tournament')
          then p_match_type end,
     case when p_user_side in ('near', 'far') then p_user_side end,
     v_played)
  returning id into v_id;

  insert into public.storage_ledger
    (user_id, match_id, kind, bytes, r2_key, order_id)
  values (v_me, v_id, 'other', p_bytes, p_key, p_order_id);

  -- The content gate, moved to the moment of storage (097).
  insert into public.jobs
    (user_id, kind, status, input_path, original_name, options)
  values
    (v_me, 'content_check', 'queued', p_key,
     nullif(trim(coalesce(p_original_name, '')), ''),
     jsonb_build_object('match_id', v_id));

  return v_id;
end;
$function$;

-- The nine-argument original, now ambiguous against the one above.
drop function if exists public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid);

-- Match what the dropped function had: never PUBLIC, never anon.
revoke all on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid,
  timestamptz) from public, anon;
grant execute on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid,
  timestamptz) to authenticated, service_role;
