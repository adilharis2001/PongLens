-- 133 — give the share page the bounce list its serve rule needs.
--
-- 130 returned `p.placement - 'candidates'`, and that was right at the
-- time: the old trust rule read only the hypotheses, and the candidate
-- list is the single heaviest part of the payload. On a 21-minute match
-- the placement JSON is 777 kB, of which the candidates are 333.
--
-- The serve rule reads them. Its fifth question is whether a serve's two
-- bounces are CONSECUTIVE — nothing else touched the table in between —
-- and that can only be answered from the list of what was detected. With
-- the key stripped the share page threw on the first point it reached,
-- which is how this was found; had it been written defensively instead it
-- would have quietly drawn an empty map on the one page a stranger sees.
--
-- So the list comes back, reduced to the three fields the rule reads.
-- 508 kB rather than 777, and none of it reaches a browser: the page runs
-- the collector server-side and sends the finished landings, a few
-- hundred small rows. This is a database-to-server transfer.
--
-- Nothing else about the function changes: same guards, same ordering,
-- same SECURITY DEFINER, same revoked/flagged/deleted exclusions.

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
    and sl.kind = 'match'
    and sl.show_score
    and p.deleted = false
    and coalesce(p.placement_flagged, false) = false
    and coalesce(m.placement_flagged, false) = false
    and p.placement is not null
  order by coalesce(p.t0, p.idx), p.idx;
$function$;
