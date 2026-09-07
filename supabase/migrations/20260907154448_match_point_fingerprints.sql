-- "Has anything changed?", asked cheaply.
--
-- Every cross-match statistic in this product is folded in the browser and
-- on the phone from every live point of every match, through the exact
-- pure walks the match page uses, so the numbers can never drift from what
-- a match page shows. That is deliberate and stays. What was not
-- deliberate is doing it from scratch every time: on Adil's account that
-- is 7,831 points and 2.5 MB of JSON on every visit, to show a dozen
-- numbers that had not moved.
--
-- This is the alternative to storing the answer. Storing the answer is
-- faster still, but a write that is ever missed leaves a confident wrong
-- number on screen with nothing to show it is wrong, and this codebase has
-- been bitten by exactly that shape before (see the placement mirror in
-- CLAUDE.md). A fingerprint cannot be wrong: it IS the question. If it
-- matches, nothing the walk reads has changed, so last time's answer is
-- still this time's answer.
--
-- The digest covers every column the walk reads, in the order the walk
-- sorts them. ADD A COLUMN TO THE WALK AND IT MUST BE ADDED HERE, or a
-- change to it will not invalidate the cache. Measured at 41 ms and 107
-- rows for the largest account, against 2.5 MB for the walk it replaces.
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
           || coalesce(p.game_end_override::text, '') || '|' || coalesce(p.server_override, '') || '|'
           || coalesce(p.server, ''),
           ',' order by p.t0 nulls first, p.idx))
    from public.points p
    join public.matches m on m.id = p.match_id
   where m.user_id = auth.uid()
     and p.deleted = false
   group by p.match_id;
$function$;

-- Dropping a function takes its privileges with it and a new function is
-- granted EXECUTE to PUBLIC by default. `create or replace` keeps what was
-- there, and there was nothing, so state it plainly either way.
revoke all on function public.my_match_point_fingerprints() from public, anon;
grant execute on function public.my_match_point_fingerprints() to authenticated, service_role;
