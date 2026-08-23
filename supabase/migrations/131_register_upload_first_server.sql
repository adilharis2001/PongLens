-- 131 — carry "who served first" from the upload form onto the match row.
--
-- The serve rotation for a whole match hangs off one answer, and until now
-- nothing asked for it until the player opened the match and started
-- scoring: a banner on the match page, a setup sheet in the scoring pad,
-- and the same sheet again in the iOS takeover. Three places asking a
-- question the uploader could have answered in one tap while the file was
-- still going up.
--
-- The upload forms now ask it, optionally, by player name. This is the
-- commerce path's half of that: register_upload creates the match row at
-- completion, so the answer has to land here or the row is born null and
-- the match page asks anyway.
--
-- first_server_source is set to 'user' alongside it, and that is the part
-- that matters. The worker's own detector writes first_server too, and
-- persist_match_structure only defers to a value already marked 'user'.
-- Writing the value without the source would let RTMPose quietly overrule
-- the person who was standing at the table.
--
-- Unanswered stays NULL. A guessed first server is worse than none: it
-- suppresses the detector's fallback AND the prompt that would have fixed
-- it, so the rotation is wrong for the whole match with nothing on screen
-- to say so.
--
-- NOTE the drop at the end. Adding a DEFAULTED argument does not replace
-- a function, it overloads it — and with the eleventh argument optional,
-- both candidates match a ten-argument call, so PostgREST answers
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
  p_played_at     timestamptz default null,
  p_first_server  text default null
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
  v_server text;
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

  -- Anything that is not one of the two answers is no answer.
  v_server := case when p_first_server in ('user', 'opponent')
                   then p_first_server end;

  insert into public.matches
    (user_id, status, raw_path, duration_s, original_name,
     opponent_name, venue, match_type, user_side, played_at,
     first_server, first_server_source)
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
     v_played,
     v_server,
     case when v_server is not null then 'user' end)
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

-- The ten-argument original, now ambiguous against the one above.
drop function if exists public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid,
  timestamptz);

-- Match what the dropped function had: never PUBLIC, never anon.
revoke all on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid,
  timestamptz, text) from public, anon;
grant execute on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid,
  timestamptz, text) to authenticated, service_role;
