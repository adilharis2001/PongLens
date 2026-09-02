-- 156: the coach workspace — roster, per-student journal, reverse invites.
--
-- One account, two workspaces. The coaching side is roster-first: a coach
-- keeps a list of students (some on PongLens, some not), writes journal
-- entries about each one, and shares an entry when it is ready. Sharing is
-- a live grant, not a copy: the student reads the coach's current row.
--
-- Entries are lessons rows (kind 'coach') so the existing audio pipeline
-- (transcribe -> distill) and the entry share links from 154 work on them
-- unchanged. A coach entry row wraps the lesson with the student it is
-- about and whether it is shared. The wrapper, not the lesson, carries
-- access: the student reads through coach_shared_entries(), never the
-- lessons table, so lessons RLS stays author-only.
--
-- The reverse invite (coach invites student) copies the 031 grammar:
-- a standing capability, idempotent accept, viewer-relative info. On
-- accept it can bind an offline roster row to the new account, which is
-- the join funnel behind a shared entry link.
--
-- Constraint and function bodies below were written from prod's live
-- definitions (pg_constraint / pg_get_functiondef, 2026-09-02), not from
-- old migration files — the live-drift rule.

-- ---------------------------------------------------------------------------
-- coach_students — the roster. player_id null = not on PongLens (yet).
-- display_name is the coach's own label; binding an account later keeps it.
-- ---------------------------------------------------------------------------
create table public.coach_students (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null references auth.users (id) on delete cascade,
  player_id    uuid references auth.users (id) on delete set null,
  display_name text not null
               check (char_length(btrim(display_name)) between 1 and 80),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint coach_students_not_self check (player_id is distinct from coach_id)
);

create index coach_students_coach_idx
  on public.coach_students (coach_id, created_at desc);
-- One live roster row per linked student; offline rows are free-form.
create unique index coach_students_linked_uniq
  on public.coach_students (coach_id, player_id)
  where (player_id is not null and archived_at is null);

alter table public.coach_students enable row level security;

create policy "Coaches manage own roster"
  on public.coach_students for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

revoke all on public.coach_students from anon;
grant select, insert, update, delete on public.coach_students to authenticated;

-- ---------------------------------------------------------------------------
-- coach_entries — one journal entry about one student. The lesson row IS
-- the content; unique(lesson_id) keeps the wrapper one-to-one so a share
-- link on the lesson can never reach a second student's wrapper.
-- ---------------------------------------------------------------------------
create table public.coach_entries (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references auth.users (id) on delete cascade,
  student_id uuid not null references public.coach_students (id) on delete cascade,
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  shared_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id)
);

create index coach_entries_student_idx
  on public.coach_entries (student_id, created_at desc);
create index coach_entries_coach_idx
  on public.coach_entries (coach_id, created_at desc);

alter table public.coach_entries enable row level security;

-- The with_check pins every leg to the coach: their roster row, their
-- lesson. Without the lesson check a coach could wrap someone else's
-- journal entry and read it back through the student RPC.
create policy "Coaches manage own entries"
  on public.coach_entries for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and exists (
      select 1 from public.coach_students cs
      where cs.id = coach_entries.student_id
        and cs.coach_id = (select auth.uid())
    )
    and exists (
      select 1 from public.lessons l
      where l.id = coach_entries.lesson_id
        and l.user_id = (select auth.uid())
    )
  );

revoke all on public.coach_entries from anon;
grant select, insert, update, delete on public.coach_entries to authenticated;

create or replace function public.coach_entries_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger coach_entries_touch_update
  before update on public.coach_entries
  for each row execute function public.coach_entries_touch();

-- ---------------------------------------------------------------------------
-- lessons.kind gains 'coach' so a dual-role user's own journal (which
-- selects their lessons) can exclude entries written about students.
-- Readers updated alongside this migration: web journal page, iOS
-- JournalStore, journal ask / recollect claims.
-- ---------------------------------------------------------------------------
alter table public.lessons drop constraint lessons_kind_check;
alter table public.lessons add constraint lessons_kind_check
  check (kind in ('lesson', 'practice', 'coach'));

-- ---------------------------------------------------------------------------
-- coach_student_invites — the reverse direction. A standing link a coach
-- hands out; any signed-in account that opens it becomes that coach's
-- student. student_id optionally binds an offline roster row on accept.
-- ---------------------------------------------------------------------------
create table public.coach_student_invites (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references auth.users (id) on delete cascade,
  student_id uuid references public.coach_students (id) on delete cascade,
  token      uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index coach_student_invites_coach_idx
  on public.coach_student_invites (coach_id, created_at desc);

alter table public.coach_student_invites enable row level security;

create policy "Coaches manage own student invites"
  on public.coach_student_invites for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (
    coach_id = (select auth.uid())
    and (student_id is null or exists (
      select 1 from public.coach_students cs
      where cs.id = coach_student_invites.student_id
        and cs.coach_id = (select auth.uid())
    ))
  );

revoke all on public.coach_student_invites from anon;
grant select, insert, update, delete on public.coach_student_invites
  to authenticated;

-- ---------------------------------------------------------------------------
-- Notification kinds. Live prod list + the three coach-workspace kinds.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'note', 'match_ready', 'match_failed',
    'reel_ready', 'reel_failed', 'coach_joined', 'upload_failed',
    'order_paid', 'order_submitted', 'order_accepted', 'order_declined',
    'clarification_requested', 'review_delivered', 'followup_received',
    'order_completed', 'order_refunded', 'sample_requested',
    'sample_responded', 'testimonial_left', 'clarification_answered',
    'sponsored_claimed', 'qa_bug_comment', 'qa_bug_status',
    'coach_entry', 'student_joined', 'student_match_ready'));

-- ---------------------------------------------------------------------------
-- Roster sync: an accepted coach link (either direction created it) makes
-- sure the coach has a roster row for that player. Also backfills today's
-- accepted links so existing coaches wake up with their students in place.
-- ---------------------------------------------------------------------------
create or replace function public.coach_links_roster_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = new.player_id;
  v_name := coalesce(nullif(btrim(v_name), ''), 'Player');

  insert into public.coach_students (coach_id, player_id, display_name)
  values (new.coach_id, new.player_id, v_name)
  on conflict (coach_id, player_id)
    where player_id is not null and archived_at is null
    do nothing;

  return new;
end;
$$;

drop trigger if exists coach_links_roster_sync on public.coach_links;
create trigger coach_links_roster_sync
  after insert or update of status on public.coach_links
  for each row execute function public.coach_links_roster_sync();

insert into public.coach_students (coach_id, player_id, display_name)
select distinct on (cl.coach_id, cl.player_id)
  cl.coach_id,
  cl.player_id,
  coalesce(nullif(btrim(public._display_name(u.*)), ''), 'Player')
from public.coach_links cl
join auth.users u on u.id = cl.player_id
where cl.status = 'accepted'
  and cl.coach_id is not null
  and cl.player_id <> cl.coach_id
on conflict (coach_id, player_id)
  where player_id is not null and archived_at is null
  do nothing;

-- ---------------------------------------------------------------------------
-- Sharing an entry tells the student, once per flip. Mirrors notes_notify's
-- dress: denormalised actor name, one-line snippet, journal href.
-- ---------------------------------------------------------------------------
create or replace function public.coach_entries_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student  public.coach_students%rowtype;
  v_actor    text;
  v_snippet  text;
begin
  if new.shared_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.shared_at is not null then
    return new;
  end if;

  select * into v_student
    from public.coach_students where id = new.student_id;
  if not found or v_student.player_id is null then
    return new;
  end if;

  select public._display_name(u.*) into v_actor
    from auth.users u where u.id = new.coach_id;
  v_actor := coalesce(nullif(btrim(v_actor), ''), 'Your coach');

  select nullif(btrim(regexp_replace(
           coalesce(l.transcript, ''), '\s+', ' ', 'g')), '')
    into v_snippet
    from public.lessons l where l.id = new.lesson_id;
  v_snippet := coalesce(left(v_snippet, 140), 'Lesson note');

  insert into public.notifications
    (user_id, kind, actor_id, title, body, href)
  values (v_student.player_id, 'coach_entry', new.coach_id,
          v_actor || ' shared a lesson note', v_snippet, '/journal');

  return new;
end;
$$;

drop trigger if exists coach_entries_notify_share on public.coach_entries;
create trigger coach_entries_notify_share
  after insert or update of shared_at on public.coach_entries
  for each row execute function public.coach_entries_notify();

-- ---------------------------------------------------------------------------
-- matches_notify grows a coach arm: when a linked student's match turns
-- ready, every coach whose accepted link covers it hears. Owner rows are
-- unchanged. Same recipient shape as notes_notify.
-- ---------------------------------------------------------------------------
create or replace function public.matches_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vs   text := public._vs_suffix(new.opponent_name);
  v_name text;
  v_rid  uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'ready' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (new.user_id, 'match_ready', new.id,
            'Match ready',
            'Your match' || v_vs || ' is cut into points and ready to review.',
            '/match/' || new.id::text);

    select public._display_name(u.*) into v_name
      from auth.users u where u.id = new.user_id;
    v_name := coalesce(nullif(btrim(v_name), ''), 'A student');

    for v_rid in
      select distinct cl.coach_id
        from public.coach_links cl
       where cl.player_id = new.user_id
         and cl.coach_id is not null
         and cl.coach_id <> new.user_id
         and cl.status = 'accepted'
         and (cl.scope_match_id is null or cl.scope_match_id = new.id)
    loop
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values (v_rid, 'student_match_ready', new.id, new.user_id,
              v_name || ' has a new match',
              'Their match' || v_vs || ' is ready to review.',
              '/match/' || new.id::text);
    end loop;
  elsif new.status = 'failed' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (new.user_id, 'match_failed', new.id,
            'Match couldn''t be processed',
            'Something went wrong with your match' || v_vs || '.',
            '/dashboard');
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- student_invite_info — what the join page shows. Viewer-relative, like
-- coach_invite_info: a revoked link reads revoked, everything else reads
-- open, and already_linked answers for THIS viewer.
-- ---------------------------------------------------------------------------
create or replace function public.student_invite_info(p_token uuid)
returns table (
  coach_name text,
  is_own_invite boolean,
  already_linked boolean,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(public._display_name(u.*)), ''), 'Your coach'),
    i.coach_id = auth.uid(),
    exists (
      select 1 from public.coach_links cl
      where cl.player_id = auth.uid()
        and cl.coach_id = i.coach_id
        and cl.scope_match_id is null
        and cl.status = 'accepted'
    ),
    case when i.revoked_at is not null then 'revoked' else 'open' end
  from public.coach_student_invites i
  join auth.users u on u.id = i.coach_id
  where i.token = p_token
    and auth.uid() is not null;
$$;

revoke execute on function public.student_invite_info(uuid) from public, anon;
grant execute on function public.student_invite_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_student_invite — idempotent join. Creates the accepted link
-- (scope: all matches — the join page says so in plain words), binds the
-- invite's offline roster row if it is still unbound, otherwise makes
-- sure a roster row exists, and tells the coach.
-- ---------------------------------------------------------------------------
create or replace function public.accept_student_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.coach_student_invites%rowtype;
  v_me     uuid := auth.uid();
  v_link   uuid;
  v_name   text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
    from public.coach_student_invites where token = p_token;
  if not found then
    raise exception 'invite not found';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked';
  end if;
  if v_invite.coach_id = v_me then
    raise exception 'cannot accept your own invite';
  end if;

  -- Roster BEFORE link: creating the link fires coach_links_roster_sync
  -- inside this very statement, and if that trigger runs first it makes a
  -- fresh generic row while the coach's named offline row stays orphaned.
  -- Binding first means the trigger's insert lands on the unique index
  -- and does nothing.
  if v_invite.student_id is not null and not exists (
    select 1 from public.coach_students
    where coach_id = v_invite.coach_id
      and player_id = v_me
      and archived_at is null
  ) then
    -- Never steal a row already bound to another account.
    update public.coach_students
       set player_id = v_me
     where id = v_invite.student_id
       and coach_id = v_invite.coach_id
       and player_id is null
       and archived_at is null;
  end if;

  -- The link. Reuse an accepted all-matches link if one exists.
  select id into v_link
    from public.coach_links
   where player_id = v_me
     and coach_id = v_invite.coach_id
     and scope_match_id is null
     and status = 'accepted'
   limit 1;
  if v_link is null then
    insert into public.coach_links (player_id, coach_id, status)
    values (v_me, v_invite.coach_id, 'accepted')
    returning id into v_link;
  end if;

  if not exists (
    select 1 from public.coach_students
    where coach_id = v_invite.coach_id
      and player_id = v_me
      and archived_at is null
  ) then
    select public._display_name(u.*) into v_name
      from auth.users u where u.id = v_me;
    insert into public.coach_students (coach_id, player_id, display_name)
    values (v_invite.coach_id, v_me,
            coalesce(nullif(btrim(v_name), ''), 'Player'))
    on conflict (coach_id, player_id)
      where player_id is not null and archived_at is null
      do nothing;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(nullif(btrim(v_name), ''), 'A player');

  insert into public.notifications
    (user_id, kind, actor_id, title, body, href)
  values (v_invite.coach_id, 'student_joined', v_me,
          v_name || ' joined as your student',
          'Their matches and your lesson notes now connect.',
          '/coaching/students');

  return v_link;
end;
$$;

revoke execute on function public.accept_student_invite(uuid) from public, anon;
grant execute on function public.accept_student_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- coach_shared_entries — the student's read. Everything shared with them,
-- newest first. Content comes from the coach's live lessons row: an edit
-- after sharing shows, which is the decided behaviour. Images are not
-- returned yet — the media routes only sign an author's own entry photos,
-- so the receive surface ships text-first.
-- ---------------------------------------------------------------------------
create or replace function public.coach_shared_entries()
returns table (
  entry_id uuid,
  coach_id uuid,
  coach_name text,
  transcript text,
  takeaways jsonb,
  entry_kind text,
  match_id uuid,
  shared_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ce.id,
    ce.coach_id,
    coalesce(nullif(btrim((
      select public._display_name(u.*)
      from auth.users u where u.id = ce.coach_id)), ''), 'Your coach'),
    l.transcript,
    l.takeaways,
    l.kind,
    l.match_id,
    ce.shared_at,
    ce.updated_at
  from public.coach_entries ce
  join public.coach_students cs on cs.id = ce.student_id
  join public.lessons l on l.id = ce.lesson_id
  where cs.player_id = auth.uid()
    and ce.shared_at is not null
  order by ce.shared_at desc;
$$;

revoke execute on function public.coach_shared_entries() from public, anon;
grant execute on function public.coach_shared_entries() to authenticated;
