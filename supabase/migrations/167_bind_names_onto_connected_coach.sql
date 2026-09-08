-- 167 — accepting a second invite must not abandon the coach it named.
--
-- Adil, 2026-09-04: he shared a journal entry with "Colby Gordon", the
-- card said "Shared with Colby Gordon", and Colby's own account showed
-- the match but no entry.
--
-- What happened. He was ALREADY connected to Colby (a bound row named
-- "Colby", from when Colby accepted an earlier invite). He then made a
-- fresh invite and named it "Colby Gordon", which correctly created a new
-- unbound row — an invite you have not sent yet may well be for someone
-- new, and the app cannot know it is the same man. Colby accepted it, and
-- player_coaches_sync hit its very first check:
--
--     if a bound row for this pair already exists -> return
--
-- which is right for the roster and wrong for the name. The "Colby
-- Gordon" row was left unbound forever, and the entry attributed to it
-- could never reach anybody. The UI had said "Shared with Colby Gordon",
-- and that was a promise the accept quietly broke.
--
-- The fix: when the pair is already connected, FOLD the row this invite
-- named into the bound one — the entries move, and the name the player
-- typed wins, because they typed it more recently and deliberately than
-- the account's own name. It is merge_player_coaches (164) applied
-- automatically at the one moment the duplicate is created.
--
-- Same rule reaches iOS, which shares this trigger and has nothing of its
-- own to change.

create or replace function public.player_coaches_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_named uuid;
  v_bound uuid;
  v_id    uuid;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  -- The row THIS invite named, if the player named it.
  select id into v_named
    from public.player_coaches
   where player_id = new.player_id
     and coach_id is null
     and archived_at is null
     and invite_id = new.id
   limit 1;

  select id into v_bound
    from public.player_coaches
   where player_id = new.player_id
     and coach_id = new.coach_id
     and archived_at is null
   limit 1;

  if v_bound is not null then
    -- Already connected. Without this the named row is orphaned, and so
    -- is everything attributed or shared to it.
    if v_named is not null and v_named <> v_bound then
      -- The name first, so moving the lessons copies the RIGHT one onto
      -- them: lessons_coach_normalise reads the row it is pointed at.
      update public.player_coaches pb
         set display_name = pn.display_name,
             name_from_account = false
        from public.player_coaches pn
       where pb.id = v_bound
         and pn.id = v_named
         and not pn.name_from_account
         and pb.display_name is distinct from pn.display_name;

      update public.lessons
         set coach_ref_id = v_bound
       where coach_ref_id = v_named;

      delete from public.player_coaches where id = v_named;
    end if;
    return new;
  end if;

  select public._name_or(u.*, 'Coach') into v_name
    from auth.users u where u.id = new.coach_id;
  v_name := coalesce(nullif(btrim(v_name), ''), 'Coach');

  v_id := v_named;
  if v_id is null then
    select id into v_id
      from public.player_coaches
     where player_id = new.player_id
       and coach_id is null
       and archived_at is null
       and lower(btrim(display_name)) = lower(btrim(v_name))
     limit 1;
  end if;

  if v_id is not null then
    update public.player_coaches
       set coach_id = new.coach_id,
           invite_id = coalesce(invite_id, new.id)
     where id = v_id;
    return new;
  end if;

  insert into public.player_coaches
    (player_id, coach_id, display_name, invite_id, name_from_account)
  values (new.player_id, new.coach_id, v_name, new.id, true)
  on conflict do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rows already stranded by this, folded by the same rule. Adil's
-- "Colby Gordon" is one of them, and it is carrying a journal entry that
-- has been marked shared since 16:18 and has reached nobody.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select pc.id      as named_id,
           pc.player_id,
           pc.display_name,
           pc.name_from_account,
           bound.id    as bound_id
      from public.player_coaches pc
      join public.coach_links cl
        on cl.id = pc.invite_id
       and cl.status = 'accepted'
       and cl.coach_id is not null
      join public.player_coaches bound
        on bound.player_id = pc.player_id
       and bound.coach_id = cl.coach_id
       and bound.archived_at is null
     where pc.coach_id is null
       and pc.archived_at is null
       and bound.id <> pc.id
  loop
    if not r.name_from_account then
      update public.player_coaches
         set display_name = r.display_name, name_from_account = false
       where id = r.bound_id
         and display_name is distinct from r.display_name;
    end if;
    update public.lessons set coach_ref_id = r.bound_id
     where coach_ref_id = r.named_id;
    delete from public.player_coaches where id = r.named_id;
  end loop;
end $$;
