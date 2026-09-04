-- 166 — share a match with a coach who has not accepted yet.
--
-- Adil, 2026-09-04: "on the match sharing screen I don't see a way I can
-- share an invite to a match with a coach I have a pending invite with."
--
-- He is right, and it was the honest gap named when 164 shipped. Share
-- with coach lists the coaches who have ACCEPTED, because sharing writes
-- an accepted, match-scoped coach_links row and a pending invite has no
-- account behind it to write one for. So the useful flow — send the
-- invite, then line up the three matches you want them to watch while
-- you wait — could not be expressed at all.
--
-- The fix is a queue, not a grant. Nothing is shared with anybody until
-- somebody accepts; the queue simply says what the accept should hand
-- over. That keeps the security model exactly where it was: access is
-- still only ever an accepted coach_links row, and it still only exists
-- once a real account has claimed the invite.

create table if not exists public.coach_invite_matches (
  invite_id  uuid not null references public.coach_links (id) on delete cascade,
  match_id   uuid not null references public.matches (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invite_id, match_id)
);

create index if not exists coach_invite_matches_match_idx
  on public.coach_invite_matches (match_id);

alter table public.coach_invite_matches enable row level security;

-- Only the player who owns BOTH the invite and the match. Checking the
-- match as well is what stops someone queueing a stranger's footage onto
-- their own invite and handing it to a coach on accept.
drop policy if exists "Players queue own matches onto own invites"
  on public.coach_invite_matches;
create policy "Players queue own matches onto own invites"
  on public.coach_invite_matches for all
  to authenticated
  using (
    exists (
      select 1 from public.coach_links cl
      where cl.id = coach_invite_matches.invite_id
        and cl.player_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.coach_links cl
      where cl.id = coach_invite_matches.invite_id
        and cl.player_id = (select auth.uid())
    )
    and exists (
      select 1 from public.matches m
      where m.id = coach_invite_matches.match_id
        and m.user_id = (select auth.uid())
    )
  );

revoke all on public.coach_invite_matches from anon;
grant select, insert, delete on public.coach_invite_matches to authenticated;

-- ---------------------------------------------------------------------------
-- accept_coach_invite — prod's live body (pg_get_functiondef, 2026-09-04)
-- plus the queue. Everything above the new block is unchanged.
--
-- The queued matches become ordinary accepted, match-scoped links, which
-- is exactly what the direct "Share" button writes for a coach who is
-- already connected (160). So the coach's access, their notification and
-- the player's own management list all behave as if the matches had been
-- shared by hand the moment the coach arrived.
-- ---------------------------------------------------------------------------
create or replace function public.accept_coach_invite(token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.coach_links%rowtype;
  v_me    uuid := auth.uid();
  v_id    uuid;
  v_name  text;
  v_scope text;
  v_match uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.coach_links where invite_token = token;
  if not found then
    raise exception 'invite not found';
  end if;
  if v_row.player_id = v_me then
    raise exception 'cannot accept your own invite';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'invite revoked';
  end if;

  select id into v_id
    from public.coach_links
   where player_id = v_row.player_id
     and coach_id = v_me
     and scope_match_id is not distinct from v_row.scope_match_id
     and status = 'accepted'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if v_row.status = 'pending' and v_row.coach_id is null then
    update public.coach_links
       set coach_id = v_me, status = 'accepted'
     where id = v_row.id
    returning id into v_id;
  else
    insert into public.coach_links
      (player_id, coach_id, scope_match_id, status, all_matches)
    values (v_row.player_id, v_me, v_row.scope_match_id, 'accepted',
            v_row.all_matches)
    returning id into v_id;
  end if;

  -- The matches lined up while this invite was waiting (166). Skipped
  -- when the invite already carries every match, because a match-scoped
  -- row beside an all-matches connection grants nothing and shows up in
  -- the player's list as a share they never made.
  if not v_row.all_matches then
    for v_match in
      select cim.match_id
        from public.coach_invite_matches cim
        join public.matches m on m.id = cim.match_id
       where cim.invite_id = v_row.id
         and m.user_id = v_row.player_id
         and cim.match_id is distinct from v_row.scope_match_id
    loop
      insert into public.coach_links
        (player_id, coach_id, scope_match_id, status)
      values (v_row.player_id, v_me, v_match, 'accepted')
      on conflict do nothing;
    end loop;
  end if;
  delete from public.coach_invite_matches where invite_id = v_row.id;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(nullif(btrim(v_name), ''), 'A coach');

  v_scope := case
    when v_row.scope_match_id is not null then 'They can see one match and leave notes.'
    when v_row.all_matches then 'They can see all your matches and leave notes.'
    else 'They can see the matches you share with them and leave notes.'
  end;

  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_row.player_id, 'coach_joined', v_row.scope_match_id, v_me,
          v_name || ' accepted your coach invite', v_scope,
          coalesce('/match/' || v_row.scope_match_id::text, '/coaching'));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revoking an invite drops what was queued for it. 165's trigger already
-- owns "a revoked invite leaves nothing behind"; this is the same rule
-- applied to the queue. A revoked invite can never be accepted, so the
-- rows are inert either way — but a queue that outlives its invite would
-- come back to life if the row were ever reinstated.
-- ---------------------------------------------------------------------------
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

  delete from public.coach_invite_matches where invite_id = new.id;

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

  update public.player_coaches
     set invite_id = null
   where invite_id = new.id;

  if new.coach_id is not null and not exists (
    select 1 from public.coach_links cl
    where cl.player_id = new.player_id
      and cl.coach_id = new.coach_id
      and cl.status = 'accepted'
  ) then
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

-- ---------------------------------------------------------------------------
-- pending_invite_matches — what the match page needs to draw the row: the
-- player's waiting invites, the name they gave each one, and whether this
-- match is already lined up for it.
--
-- Definer because the name lives in player_coaches and the invite in
-- coach_links, and both are the caller's own rows either way.
-- ---------------------------------------------------------------------------
create or replace function public.pending_invite_matches(p_match_id uuid)
returns table (
  invite_id    uuid,
  invite_token uuid,
  display_name text,
  all_matches  boolean,
  scope_match_id uuid,
  queued       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cl.id,
    cl.invite_token,
    pc.display_name,
    cl.all_matches,
    cl.scope_match_id,
    exists (
      select 1 from public.coach_invite_matches cim
      where cim.invite_id = cl.id and cim.match_id = p_match_id
    )
  from public.coach_links cl
  left join public.player_coaches pc
    on pc.invite_id = cl.id and pc.archived_at is null
  where cl.player_id = auth.uid()
    and cl.status = 'pending'
    and cl.coach_id is null
  order by cl.created_at desc;
$$;

revoke execute on function public.pending_invite_matches(uuid) from public, anon;
grant execute on function public.pending_invite_matches(uuid) to authenticated;
