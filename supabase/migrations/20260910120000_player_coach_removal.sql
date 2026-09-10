-- Coach management: removal is the player's, and only the player's.
--
-- A player's coach list had two holes and one live fault.
--
-- The holes: there was no way to invite a coach already on the list, and no
-- way to take one off it. "Remove coach" is `leave_coach`, which ends a
-- coach's ACCESS, so it was hidden for a coach the player had only written
-- down, and that row was permanent.
--
-- The fault is the one this migration is mostly about. Two statements in
-- `player_coaches_revoke_sync` DELETED the player's row as a side effect of a
-- revoke. Both go. The reasoning that put them there (165, 166) was that a row
-- which exists only because an invite existed should leave with it, and that a
-- revoked coach should stop sitting in the "Who taught it?" picker. The first
-- is true of rows the invite CREATED and false of rows it ADOPTED, and nothing
-- ever separated the two. The second was solved properly by 168, which gave
-- `player_coaches_list` its `past` branch: a coach with no accepted link now
-- reads "No longer connected" and `canReceiveEntries` is already false for it.
--
-- What the deletes actually cost:
--   * "I wrote Dave down, invited Dave, changed my mind, revoked" lost Dave,
--     along with any recap filed under him.
--   * Ending a connected coach's access DESTROYED the row whenever no lesson
--     pointed at it, so the coach page could not keep its promise that they
--     stay on the list.
--   * `remove_student` on the COACH side revokes their links, so a coach
--     tidying their own roster silently edited the player's list.
--
-- After this, one action removes a coach: `remove_player_coach`, and it
-- archives. Nothing else may. The DELETE grant is withdrawn at the end so a
-- future client cannot reach for one, because both foreign keys onto this
-- table are `on delete set null` and that null arrives at `lessons` as an
-- UPDATE which fires `lessons_coach_normalise` and BLANKS `coach_name` — one
-- delete would turn every "Lesson with Jonathan" into "Note", permanently, on
-- every surface including already-published share links.
--
-- Adil confirmed the behaviour change on 2026-09-10.
-- Spec: docs/superpowers/specs/2026-09-10-player-coach-management-design.md

-- ---------------------------------------------------------------------------
-- 1. Revoking a link stops removing anybody from the list.
-- ---------------------------------------------------------------------------

create or replace function public.player_coaches_revoke_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status <> 'revoked' or old.status = 'revoked' then
    return new;
  end if;

  delete from public.coach_invite_matches where invite_id = new.id;

  -- The row stays; it simply stops pointing at a dead invite. Its standing
  -- falls through to `past` when an account is known and `offline` when one
  -- is not, which is exactly what the player should see.
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
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The fold moves recordings too.
--
-- THE RULE, once, for whoever writes the next one of these: every statement in
-- this schema that deletes a player_coaches row must move BOTH `lessons` and
-- `lesson_videos` off it first, or be guarded so it cannot fire.
--
-- `merge_player_coaches` was fixed for exactly this on 2026-09-07 and this
-- fold was missed. `lesson_videos.coach_ref_id` is `on delete set null`, so
-- the delete below silently dropped the only record of who a recap was with.
-- Binding an invite onto a coach the player had already written down is the
-- shortest path to it, and that is now a button.
-- ---------------------------------------------------------------------------

create or replace function public.player_coaches_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    if v_named is not null and v_named <> v_bound then
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

      update public.lesson_videos
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. The archived list. A separate function rather than a flag on the existing
--    one, so `player_coaches_list()` keeps its return shape and neither
--    platform's decoder changes.
-- ---------------------------------------------------------------------------

create or replace function public.player_coaches_archived_list()
returns table (
  id uuid, coach_id uuid, display_name text, coach_email text,
  invite_id uuid, status text, entry_count bigint, shared_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    pc.id,
    pc.coach_id,
    pc.display_name,
    u.email::text,
    pc.invite_id,
    case
      when exists (
        select 1 from public.coach_links cl
        where cl.player_id = pc.player_id
          and cl.coach_id = pc.coach_id
          and cl.status = 'accepted'
      ) then 'connected'
      when exists (
        select 1 from public.coach_links cl
        where cl.id = pc.invite_id
          and cl.status = 'pending'
      ) then 'invited'
      when pc.coach_id is not null then 'past'
      else 'offline'
    end,
    (select count(*) from public.lessons l where l.coach_ref_id = pc.id),
    (select count(*) from public.lessons l
      where l.coach_ref_id = pc.id and l.shared_with_coach_at is not null)
  from public.player_coaches pc
  left join auth.users u on u.id = pc.coach_id
  where pc.player_id = auth.uid()
    and pc.archived_at is not null
  order by pc.archived_at desc;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Removing a coach. One door, and it archives.
-- ---------------------------------------------------------------------------

create or replace function public.remove_player_coach(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me  uuid := auth.uid();
  v_row public.player_coaches;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  -- Lock this player's pending links BEFORE the roster row, which is the
  -- order accept_coach_invite takes (it updates coach_links, and the trigger
  -- then updates player_coaches), so the two cannot deadlock. Without this
  -- the coach can accept between our read and our revoke, and we would branch
  -- off a stale snapshot: they would keep full match access with no row left
  -- on screen to take it back from.
  perform 1
    from public.coach_links
   where player_id = v_me
     and status = 'pending'
   order by id
     for update;

  select * into v_row
    from public.player_coaches
   where id = p_id and player_id = v_me
     for update;
  if not found then
    raise exception 'coach not found';
  end if;

  -- Archive first, so nothing downstream can destroy the row while we work.
  update public.player_coaches
     set archived_at = coalesce(archived_at, now())
   where id = p_id;

  -- An outstanding invite has to die with the removal. Archiving alone leaves
  -- the token live, and player_coaches_sync skips archived rows on both of its
  -- lookups, so an accept would insert a brand new row named from the account
  -- and the removed coach would reappear under a different name.
  if v_row.invite_id is not null then
    update public.coach_links
       set status = 'revoked'
     where id = v_row.invite_id
       and status = 'pending';
  end if;

  -- v_row is the locked row, so its coach_id is current: an accept that
  -- committed before our lock is already reflected here.
  if v_row.coach_id is not null then
    perform public.leave_coach(v_row.coach_id);
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Putting one back.
-- ---------------------------------------------------------------------------

create or replace function public.restore_player_coach(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me   uuid := auth.uid();
  v_row  public.player_coaches;
  v_live uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row
    from public.player_coaches
   where id = p_id and player_id = v_me and archived_at is not null
     for update;
  if not found then
    raise exception 'coach not found';
  end if;

  if v_row.coach_id is not null then
    select id into v_live
      from public.player_coaches
     where player_id = v_me
       and coach_id = v_row.coach_id
       and archived_at is null
       and id <> p_id
     limit 1;
  end if;

  if v_live is not null then
    -- The slot is taken: player_coaches_linked_uniq is partial on
    -- `archived_at is null`, so un-archiving would raise a constraint error at
    -- the player. Fold instead. Both rows belong to this account by
    -- definition, so this is the same move merge_player_coaches makes, and it
    -- has to carry BOTH kinds of attribution or the recap loses its coach.
    update public.lessons
       set coach_ref_id = v_live
     where coach_ref_id = p_id;

    update public.lesson_videos
       set coach_ref_id = v_live
     where coach_ref_id = p_id;

    return 'merged';
  end if;

  update public.player_coaches
     set archived_at = null
   where id = p_id;

  -- Restoring re-grants nothing. A coach who was connected comes back reading
  -- "No longer connected"; one who had an invite comes back reading "Not on
  -- PongLens", because the removal revoked it. Send an invite is the way back
  -- in both cases, and the app says so.
  return 'restored';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Two functions that assumed a coach could never be removed.
--
-- publish_lesson_video refused to publish a recap whose coach row had been
-- archived, which would have trapped an unpublished recap for ever the moment
-- the player removed that coach, with no way out and no message explaining it.
-- Publishing a recap is the player's own record of a lesson that happened; it
-- is not the coach's access, and lesson_video_access still excludes archived
-- rows, so the coach really does lose sight of it. The COACH-side check on
-- coach_students above it keeps its archived_at guard and is untouched.
--
-- accept_coach_invite's notification pointed at a bare /coaching. The iOS
-- coach-workspace root only routes /admin/, /account and /coaching/students,
-- so for an account that is both a player and a coach, sitting in coach mode,
-- "your coach accepted" was a dead tap. /coaching/coach is player territory,
-- so it flips the side on the way in exactly as /coaching/students already
-- does for the coach's own bell.
--
-- Both were pulled from production with pg_get_functiondef and are byte
-- identical apart from the one line named above. Migration files lag the
-- database in this project; do the same before touching either again.
-- ---------------------------------------------------------------------------

-- publish_lesson_video: drop `and archived_at is null` from the coach_ref_id (player_coaches) existence check
CREATE OR REPLACE FUNCTION public.publish_lesson_video(p_id uuid, p_owner uuid, p_share boolean DEFAULT false)
 RETURNS lesson_videos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v lesson_videos;
  lid uuid;
  note text;
begin
  select * into v from lesson_videos where id = p_id and owner_id = p_owner for update;
  if v.id is null then raise exception 'Lesson video not found'; end if;

  if v.status = 'ready' then
    if p_share then
      if v.lesson_id is not null then
        if v.student_id is not null then
          insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
          values (p_owner, v.student_id, v.lesson_id, now())
          on conflict (lesson_id) do update set shared_at = now();
        else
          update lessons set shared_with_coach_at = now() where id = v.lesson_id and user_id = p_owner;
        end if;
      end if;
    end if;
    return v;
  end if;

  if v.status <> 'review' or v.playback_key is null or v.edit is null then
    raise exception 'Review the finished recap first';
  end if;
  if v.student_id is not null and not exists (
    select 1 from coach_students
     where id = v.student_id and coach_id = p_owner and archived_at is null
  ) then raise exception 'This student is no longer on your roster'; end if;
  if v.coach_ref_id is not null and not exists (
    select 1 from player_coaches
     where id = v.coach_ref_id and player_id = p_owner
  ) then raise exception 'This coach is no longer on your list'; end if;

  note := nullif(btrim(coalesce(v.edit->>'title', '')), '');

  if not coalesce(v.edit->'themes', '[]'::jsonb) @> '[{"name":"Lesson video"}]'::jsonb then
    update lesson_videos set edit = jsonb_set(
      v.edit, '{themes}',
      coalesce(v.edit->'themes', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'name', 'Lesson video',
             'points', jsonb_build_array('Video lesson: https://ponglens.com/lesson-video/' || v.id::text)))
    ) where id = v.id returning * into v;
  end if;

  lid := v.lesson_id;
  if lid is null then
    insert into lessons (user_id, transcript, takeaways, status, kind, lesson_video_id)
    values (
      p_owner, note,
      jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
      'ready',
      case when v.student_id is null then 'lesson' else 'coach' end,
      v.id
    )
    returning id into lid;
  else
    update lessons
       set takeaways = jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
           lesson_video_id = v.id
     where id = lid and user_id = p_owner;
  end if;

  if p_share then
    if v.student_id is not null then
      insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
      values (p_owner, v.student_id, lid, now())
      on conflict (lesson_id) do update set shared_at = now();
    else
      update lessons set shared_with_coach_at = now() where id = lid and user_id = p_owner;
    end if;
  end if;

  update lesson_videos set status = 'ready', lesson_id = lid, updated_at = now()
   where id = v.id returning * into v;
  return v;
end;
$function$;

-- accept_coach_invite: notification href fallback '/coaching' -> '/coaching/coach'
CREATE OR REPLACE FUNCTION public.accept_coach_invite(token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          coalesce('/match/' || v_row.scope_match_id::text, '/coaching/coach'));

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Grants.
-- ---------------------------------------------------------------------------

revoke execute on function public.remove_player_coach(uuid) from public, anon;
revoke execute on function public.restore_player_coach(uuid) from public, anon;
revoke execute on function public.player_coaches_archived_list() from public, anon;

grant execute on function public.remove_player_coach(uuid) to authenticated;
grant execute on function public.restore_player_coach(uuid) to authenticated;
grant execute on function public.player_coaches_archived_list() to authenticated;

-- The loud failure that replaces a silent one. See the header: a client-side
-- delete blanks coach_name on every entry the coach ever taught. The three
-- functions that legitimately delete a row are definer or trigger-owned and
-- are unaffected by this.
revoke delete on public.player_coaches from authenticated;
