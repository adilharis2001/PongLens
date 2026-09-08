-- 165 — revoking a coach takes them out of your journal's coach list.
--
-- Reported by Adil the hour 164 shipped, with a screenshot of "Who taught
-- it?" carrying seven coaches, two of them dead: "Colby" twice and a
-- "Jonotan" he had already revoked.
--
-- What actually happened, in order:
--   1. the Jonathan invite was opened and accepted by an account called
--      Colby, so player_coaches_sync bound a row named "Colby";
--   2. he revoked it — and nothing removed the row;
--   3. he made an invite named "Jonotan", revoked that — same;
--   4. he made a fresh invite named "Colby", which correctly refused to
--      reuse the first Colby (that one is BOUND to an account, and hanging
--      a new invite off a bound row would be wrong), so a second Colby
--      appeared beside the dead one.
--
-- So the list was never stale. Revoking simply had no effect on it, which
-- looks exactly like staleness from the outside.
--
-- The rule: a coach you revoke leaves the list, UNLESS your journal has
-- entries attributed to them. Those entries record who taught you, and
-- that stays true after you stop working together — the same reason
-- leave_coach (164) clears the sharing and keeps the attribution.
--
-- A trigger rather than a change to leave_coach, because a PENDING invite
-- is revoked by a plain status update from the client and never goes near
-- an RPC. One place, both paths.

create or replace function public.player_coaches_revoke_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'revoked' or old.status = 'revoked' then
    return new;
  end if;

  -- The row this very invite created or claimed. No entries: it exists
  -- only because the invite did, so it goes with it.
  --
  -- The last clause is not optional. A coach can hold several links — a
  -- connection plus a match-scoped share — and a row bound during one of
  -- them carries that link's id. Revoking a single shared match would
  -- otherwise delete a coach who still watches everything else.
  delete from public.player_coaches pc
   where pc.invite_id = new.id
     and not exists (
       select 1 from public.lessons l where l.coach_ref_id = pc.id
     )
     and (
       pc.coach_id is null
       or not exists (
         select 1 from public.coach_links cl
         where cl.player_id = pc.player_id
           and cl.coach_id = pc.coach_id
           and cl.status = 'accepted'
       )
     );

  -- Whatever survived stops pointing at a dead invite, so the list stops
  -- calling them "invited".
  update public.player_coaches
     set invite_id = null
   where invite_id = new.id;

  -- A coach who has now lost every accepted link with this player.
  if new.coach_id is not null and not exists (
    select 1 from public.coach_links cl
    where cl.player_id = new.player_id
      and cl.coach_id = new.coach_id
      and cl.status = 'accepted'
  ) then
    -- Their access ends whatever route the revoke took. leave_coach does
    -- this too; a bare status flip from the client does not, and that is
    -- the path a pending invite takes.
    update public.lessons l
       set shared_with_coach_at = null
     where l.user_id = new.player_id
       and l.shared_with_coach_at is not null
       and l.coach_ref_id in (
         select id from public.player_coaches
          where player_id = new.player_id and coach_id = new.coach_id
       );

    delete from public.player_coaches pc
     where pc.player_id = new.player_id
       and pc.coach_id = new.coach_id
       and not exists (
         select 1 from public.lessons l where l.coach_ref_id = pc.id
       );
  end if;

  return new;
end;
$$;

drop trigger if exists player_coaches_revoke_sync on public.coach_links;
create trigger player_coaches_revoke_sync
  after update of status on public.coach_links
  for each row execute function public.player_coaches_revoke_sync();

-- ---------------------------------------------------------------------------
-- The rows already stranded, cleared by the same rule.
--
-- Order matters: the dead-invite rows are removed while they still point
-- at the invite that identifies them. Nulling first would make them
-- indistinguishable from a coach typed straight into the journal, which
-- has no invite either and must be left alone.
--
-- Entries win throughout: a coach with lessons attributed to them is kept
-- whatever their links say.
-- ---------------------------------------------------------------------------
delete from public.player_coaches pc
 using public.coach_links cl
 where cl.id = pc.invite_id
   and cl.status = 'revoked'
   and not exists (
     select 1 from public.lessons l where l.coach_ref_id = pc.id
   )
   and (
     pc.coach_id is null
     or not exists (
       select 1 from public.coach_links c2
       where c2.player_id = pc.player_id
         and c2.coach_id = pc.coach_id
         and c2.status = 'accepted'
     )
   );

update public.player_coaches pc
   set invite_id = null
  from public.coach_links cl
 where cl.id = pc.invite_id
   and cl.status = 'revoked';

delete from public.player_coaches pc
 where pc.coach_id is not null
   and not exists (
     select 1 from public.lessons l where l.coach_ref_id = pc.id
   )
   and not exists (
     select 1 from public.coach_links cl
     where cl.player_id = pc.player_id
       and cl.coach_id = pc.coach_id
       and cl.status = 'accepted'
   );
