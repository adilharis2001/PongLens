-- 2026-09-15 — the share page's candidate list carries table coordinates.
--
-- 133 reduced each candidate to id, kind and t, because the only rule
-- reading the list asked whether a serve's two bounces were consecutive.
-- The match analysis deck now runs on the public page too, and two of its
-- cards read where a bounce landed: point length starts at the first
-- bounce inside the table, and "where points ended" is the last clean
-- bounce's half. Both need u and v (metres along the table). Two more
-- numbers per candidate; pixels, confidences and the kinds list stay out.
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
                  'id', c -> 'id', 'kind', c -> 'kind', 't', c -> 't',
                  'u', c -> 'u', 'v', c -> 'v'))
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
