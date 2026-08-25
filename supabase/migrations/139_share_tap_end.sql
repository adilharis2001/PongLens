-- 139: the share page learns where points effectively end.
--
-- Tap-end playback (138) needs three things the share surface could not
-- answer: each visible point's tight flags, edit flag and winner tap
-- (for playhead.effectiveEnd), the DELETED cards' boundaries (their
-- footage sits in the cut video a stranger streams, and the client can
-- only jump what it can locate), and the match's clip_pads (every end
-- computation runs through effectivePad).
--
-- resolve_share_points keeps returning VISIBLE rows only — old deployed
-- clients hardcode deleted:false when mapping, so returning junk cards
-- here would put them in the score walk during any rollout window. The
-- deleted boundaries travel through their own function instead, and a
-- client that never calls it simply keeps today's behavior. Same
-- missing-vs-empty rule as 133: a client must treat an absent answer as
-- "no spans", never as "skip everything".
--
-- The return type gains columns, which Postgres only allows through a
-- DROP; the body is otherwise the LIVE definition (pg_get_functiondef,
-- 2026-08-25), per the live-drift rule.

drop function if exists public.resolve_share_points(text);

create function public.resolve_share_points(p_token text)
returns table(
  id uuid, idx integer, t0 numeric, t1 numeric, cut_t0 numeric,
  clip_path text, starred boolean, is_let boolean, confirmed_winner text,
  game_end_override text, game_winner_override text, server text,
  server_override text, placement_flagged boolean,
  tight_start boolean, tight_end boolean, edited boolean,
  scored_at_cut_s numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.idx, p.t0, p.t1, p.cut_t0, p.clip_path, p.starred, p.is_let,
         p.confirmed_winner, p.game_end_override, p.game_winner_override,
         p.server, p.server_override,
         coalesce(p.placement_flagged, false) as placement_flagged,
         p.tight_start, p.tight_end, p.edited, p.scored_at_cut_s
  from public.share_links sl
  join public.points p on p.match_id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind = 'match'
    and p.deleted = false
  order by coalesce(p.t0, p.idx), p.idx;
$function$;

grant execute on function public.resolve_share_points(text)
  to anon, authenticated;

-- The deleted cards' boundaries, nothing else: enough to place their
-- footage on the cut clock. No ids, no outcomes — these are not points,
-- they are spans of video the owner threw away.
create or replace function public.resolve_share_removed(p_token text)
returns table(
  cut_t0 numeric, t0 numeric, t1 numeric,
  tight_start boolean, tight_end boolean
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.cut_t0, p.t0, p.t1, p.tight_start, p.tight_end
  from public.share_links sl
  join public.points p on p.match_id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind = 'match'
    and p.deleted = true
    and p.cut_t0 is not null
  order by p.cut_t0;
$function$;

grant execute on function public.resolve_share_removed(text)
  to anon, authenticated;

-- The pads the cut was made with (matches.clip_pads, 048). One value,
-- its own function: resolve_share_link serves four link kinds and
-- changing its row type for one of them is how columns get dropped by
-- accident (the 133 lesson, from the other direction).
create or replace function public.resolve_share_clip_pads(p_token text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select m.clip_pads
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind = 'match';
$function$;

grant execute on function public.resolve_share_clip_pads(text)
  to anon, authenticated;
