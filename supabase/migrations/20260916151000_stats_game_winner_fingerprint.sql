-- Cross-match statistics use game_winner_override when an owner closes a
-- game whose partial score cannot prove its winner. Include that input both in
-- the downloaded point shape and in this freshness digest; otherwise an old
-- IndexedDB row can keep a confidently wrong games result after the owner
-- answers the game-winner question.
create or replace function public.my_match_point_fingerprints()
 returns table(match_id uuid, fingerprint text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p.match_id,
         md5(string_agg(
           p.idx::text || '|' || coalesce(p.t0::text, '') || '|'
           || coalesce(p.is_let::text, '') || '|' || coalesce(p.confirmed_winner, '') || '|'
           || coalesce(p.confirmed_how, '') || '|' || coalesce(p.direction::text, '') || '|'
           || coalesce(p.serve_spin, '') || '|' || coalesce(p.serve_sidespin::text, '') || '|'
           || coalesce(p.serve_length, '') || '|' || coalesce(p.loss_reasons::text, '') || '|'
           || coalesce(p.game_end_override::text, '') || '|'
           || coalesce(p.game_winner_override::text, '') || '|'
           || coalesce(p.server_override, '') || '|' || coalesce(p.server, ''),
           ',' order by p.t0 nulls first, p.idx))
    from public.points p
    join public.matches m on m.id = p.match_id
   where m.user_id = auth.uid()
     and p.processing_version_id = m.active_processing_version_id
     and p.deleted = false
   group by p.match_id;
$function$;

revoke all on function public.my_match_point_fingerprints() from public, anon;
grant execute on function public.my_match_point_fingerprints()
  to authenticated, service_role;

comment on function public.my_match_point_fingerprints() is
  'Owner-scoped digest of every active point field consumed by aggregate statistics.';
