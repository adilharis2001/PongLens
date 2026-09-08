-- Let a public automatic-highlight link carry the same scored-match context
-- as the owner's whole-match link, without rendering a second video.
--
-- The score walk needs every visible point in match order. The playback
-- clock is different: the automatic reel is assembled from selected cut
-- segments with 0.3s overlaps, so the browser receives only a sanitized
-- point-id/output-time timeline from the worker-authored manifest. Detector
-- evidence and storage paths stay server-side.

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
    and sl.kind in ('match', 'highlights')
    and p.deleted = false
  order by coalesce(p.t0, p.idx), p.idx;
$function$;

revoke execute on function public.resolve_share_points(text) from public;
grant execute on function public.resolve_share_points(text)
  to anon, authenticated;

create or replace function public.resolve_share_placement(p_token text)
returns table(id uuid, placement jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    p.id,
    jsonb_set(
      p.placement - 'candidates',
      '{candidates}',
      coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'id', c -> 'id', 'kind', c -> 'kind', 't', c -> 't'))
         from jsonb_array_elements(p.placement -> 'candidates') c),
        '[]'::jsonb)
    ) as placement
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  join public.points p on p.match_id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind in ('match', 'highlights')
    and sl.show_score
    and p.deleted = false
    and coalesce(p.placement_flagged, false) = false
    and coalesce(m.placement_flagged, false) = false
    and p.placement is not null
  order by coalesce(p.t0, p.idx), p.idx;
$function$;

revoke execute on function public.resolve_share_placement(text) from public;
grant execute on function public.resolve_share_placement(text)
  to anon, authenticated;

create or replace function public.resolve_share_highlight_timeline(p_token text)
returns table(
  point_id uuid,
  output_start_s numeric,
  output_end_s numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, parsed.output_start_s, parsed.output_end_s
  from public.share_links sl
  join public.match_reels mr
    on mr.match_id = sl.match_id and mr.scope = 'highlights'
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(mr.manifest -> 'points') = 'array'
        then mr.manifest -> 'points'
      else '[]'::jsonb
    end
  ) segment
  cross join lateral (
    select
      case
        when coalesce(segment ->> 'point_id', '') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then (segment ->> 'point_id')::uuid
        else null
      end as point_id,
      case
        when jsonb_typeof(segment -> 'output_start_s') = 'number'
          then (segment ->> 'output_start_s')::numeric
        else null
      end as output_start_s,
      case
        when jsonb_typeof(segment -> 'output_end_s') = 'number'
          then (segment ->> 'output_end_s')::numeric
        else null
      end as output_end_s
  ) parsed
  join public.points p
    on p.id = parsed.point_id
   and p.match_id = sl.match_id
   and p.deleted = false
  where sl.token = p_token
    and sl.kind = 'highlights'
    and sl.revoked_at is null
    and mr.status = 'ready'
    and mr.r2_key is not null
    and parsed.output_start_s >= 0
    and parsed.output_end_s > parsed.output_start_s
  order by parsed.output_start_s;
$function$;

revoke execute on function public.resolve_share_highlight_timeline(text)
  from public;
grant execute on function public.resolve_share_highlight_timeline(text)
  to anon, authenticated;

comment on function public.resolve_share_highlight_timeline(text) is
  'Selected point IDs and automatic-reel output bounds for a live, active '
  'highlight share token. Internal highlight evidence is not returned.';
