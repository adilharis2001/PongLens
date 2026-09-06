-- 162 — the outreach workspace's own state.
--
-- /admin/outreach is where whoever does user outreach (Anton, today) sees
-- the real people on the platform and records what happened with each:
-- reached out, they replied, follow up on a date. Two tables carry that
-- state; everything else the page shows is derived live from the product
-- tables through admin_outreach_roster().
--
-- Who counts as a real user is a filter, not a column. Accounts at
-- @example.com and @ponglens.com are product fixtures (demo staging,
-- review backdoors, test pairs) and never appear — new fixtures on those
-- domains stay invisible with no bookkeeping. Manufactured accounts on
-- real domains (the admins' own, the QA engineer's family) cannot be told
-- apart by pattern, so they are seeded below as hidden rows, and the page
-- has a hide action for whatever gets created next. Hiding is per-account
-- state, so it is editable where a hardcoded list would need a migration.
--
-- Same access shape as 150/154: RLS enabled with no policies, so the
-- SECURITY DEFINER functions are the only way in, and every one re-checks
-- is_admin().

create table if not exists public.user_outreach_contacts (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  status       text not null default 'new' check
                 (status in ('new', 'contacted', 'in_touch', 'closed')),
  -- A reminder Anton set for himself, and the only thing that puts a user
  -- in the follow-up queue. Logging an outreach suggests one in the UI;
  -- nothing invents dates on its own.
  follow_up_on date,
  hidden       boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.user_outreach_contacts enable row level security;
revoke all on public.user_outreach_contacts from anon, authenticated;

-- One row per thing that happened: we reached out (kind 'outreach'), the
-- user said something (kind 'feedback' — replies and in-person remarks
-- alike, verbatim), or an internal remark (kind 'note'). Feedback rows
-- double as the product's feedback log, read across all users.
create table if not exists public.user_outreach_touches (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null check (kind in ('outreach', 'feedback', 'note')),
  channel  text check (channel in ('email', 'dm', 'in_person')),
  body     text not null default '' check (char_length(body) <= 4000),
  -- Which admin wrote it — there are two now.
  author   text not null,
  at       timestamptz not null default now()
);

create index if not exists user_outreach_touches_user_at
  on public.user_outreach_touches (user_id, at desc);

alter table public.user_outreach_touches enable row level security;
revoke all on public.user_outreach_touches from anon, authenticated;

-- The accounts that exist today and are not outreach targets: the two
-- admins, Anton's own, and the QA engineer's family. One-time seed; the
-- hide action covers whatever comes next.
insert into public.user_outreach_contacts (user_id, hidden)
select u.id, true
  from auth.users u
 where u.email in (
   'adilharis2001@gmail.com',
   'aharisib@tepper.cmu.edu',
   'aber97@gmail.com',
   'anton@antonbermantt.com',
   'itsmumtazshabbir@gmail.com',
   'itsmumtazshabbir+qacoach@gmail.com',
   'itsmumtazshabbir+786@gmail.com',
   'mumtazjaat0786@gmail.com',
   'mumtazjaat00786@gmail.com',
   'mumtazjaat786@gmail.com')
on conflict (user_id) do update set hidden = true;

-- The roster: every real-domain account, hidden ones included (the page
-- keeps those in a collapsed section so hiding is reversible), with the
-- product stats outreach cares about and the contact state beside them.
-- Built on admin_player_overview() rather than re-deriving its counts —
-- two implementations of "how many matches does this user have" is how
-- numbers drift apart.
create or replace function public.admin_outreach_roster()
returns table (
  user_id          uuid,
  email            text,
  name             text,
  signed_up        timestamptz,
  last_seen        timestamptz,
  matches          integer,
  matches_scored   integer,
  matches_failed   integer,
  last_upload_at   timestamptz,
  points           integer,
  notes            integer,
  journal_entries  integer,
  share_links      integer,
  is_coach         boolean,
  status           text,
  follow_up_on     date,
  hidden           boolean,
  last_outreach_at timestamptz,
  last_feedback_at timestamptz,
  touches          integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select
    o.user_id, o.email, o.name, o.created_at, o.last_sign_in_at,
    o.matches, o.matches_scored,
    (select count(*) from public.matches m
      where m.user_id = o.user_id and m.status = 'failed')::int,
    (select max(m.created_at) from public.matches m
      where m.user_id = o.user_id),
    o.points, o.notes, o.journal_entries, o.share_links,
    exists (select 1 from public.coach_profiles cp
             where cp.user_id = o.user_id),
    coalesce(c.status, 'new'),
    c.follow_up_on,
    coalesce(c.hidden, false),
    (select max(t.at) from public.user_outreach_touches t
      where t.user_id = o.user_id and t.kind = 'outreach'),
    (select max(t.at) from public.user_outreach_touches t
      where t.user_id = o.user_id and t.kind = 'feedback'),
    (select count(*) from public.user_outreach_touches t
      where t.user_id = o.user_id)::int
  from public.admin_player_overview() o
  left join public.user_outreach_contacts c on c.user_id = o.user_id
  where o.email not ilike '%@example.com'
    and o.email not ilike '%@ponglens.com'
  order by o.created_at desc;
end;
$$;

-- The touch log: one user's for the detail panel, or every user's for the
-- feedback tab (the client keeps the kinds apart).
create or replace function public.admin_outreach_touches(
  p_user_id uuid default null)
returns table (
  id      uuid,
  user_id uuid,
  kind    text,
  channel text,
  body    text,
  author  text,
  at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.user_id, t.kind, t.channel, t.body, t.author, t.at
    from public.user_outreach_touches t
   where p_user_id is null or t.user_id = p_user_id
   order by t.at desc;
end;
$$;

-- Log one touch. Recording an outreach moves a fresh contact to
-- 'contacted', and recording feedback moves it to 'in_touch' — the status
-- follows what actually happened so nobody maintains it by hand. It only
-- ever moves forward here; 'closed' is untouched, and any status can
-- still be set explicitly.
create or replace function public.admin_outreach_touch_add(
  p_user_id uuid,
  p_kind text,
  p_channel text default null,
  p_body text default '')
returns table (
  id      uuid,
  user_id uuid,
  kind    text,
  channel text,
  body    text,
  author  text,
  at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
-- The returns-table columns are plpgsql variables, and one is named
-- user_id — without this pragma the INSERT's conflict target is ambiguous.
#variable_conflict use_column
declare
  v_author text := coalesce(auth.jwt() ->> 'email', 'unknown');
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.user_outreach_contacts as c (user_id, status)
  values (p_user_id, case p_kind when 'feedback' then 'in_touch'
                                 else 'contacted' end)
  on conflict (user_id) do update
    set status = case
          when p_kind = 'outreach' and c.status = 'new' then 'contacted'
          when p_kind = 'feedback' and c.status in ('new', 'contacted')
            then 'in_touch'
          else c.status
        end,
        updated_at = now();
  return query
  insert into public.user_outreach_touches (user_id, kind, channel, body, author)
  values (p_user_id, p_kind, p_channel, p_body, v_author)
  returning user_outreach_touches.id, user_outreach_touches.user_id,
            user_outreach_touches.kind, user_outreach_touches.channel,
            user_outreach_touches.body, user_outreach_touches.author,
            user_outreach_touches.at;
end;
$$;

-- Mistakes get withdrawn. This deletes the workspace's own log entry,
-- never anything of the user's.
create or replace function public.admin_outreach_touch_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.user_outreach_touches where id = p_id;
end;
$$;

create or replace function public.admin_outreach_status_set(
  p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.user_outreach_contacts (user_id, status)
  values (p_user_id, p_status)
  on conflict (user_id) do update
    set status = excluded.status, updated_at = now();
end;
$$;

-- Null clears the reminder, which is how a follow-up is marked done.
create or replace function public.admin_outreach_follow_up_set(
  p_user_id uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.user_outreach_contacts (user_id, follow_up_on)
  values (p_user_id, p_on)
  on conflict (user_id) do update
    set follow_up_on = excluded.follow_up_on, updated_at = now();
end;
$$;

create or replace function public.admin_outreach_hidden_set(
  p_user_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.user_outreach_contacts (user_id, hidden)
  values (p_user_id, p_hidden)
  on conflict (user_id) do update
    set hidden = excluded.hidden, updated_at = now();
end;
$$;

-- The hub card's two numbers. Deliberately NOT derived from the roster:
-- admin_player_overview runs the cost allocation, which is too heavy to
-- ride along on every hub load.
create or replace function public.admin_outreach_counts()
returns table (to_contact integer, follow_ups_due integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select
    (select count(*) from auth.users u
      left join public.user_outreach_contacts c on c.user_id = u.id
     where u.email not ilike '%@example.com'
       and u.email not ilike '%@ponglens.com'
       and coalesce(c.hidden, false) = false
       and coalesce(c.status, 'new') = 'new')::int,
    (select count(*) from auth.users u
      join public.user_outreach_contacts c on c.user_id = u.id
     where u.email not ilike '%@example.com'
       and u.email not ilike '%@ponglens.com'
       and c.hidden = false
       and c.status <> 'closed'
       and c.follow_up_on is not null
       and c.follow_up_on <= current_date)::int;
end;
$$;

revoke execute on function public.admin_outreach_roster() from public, anon;
revoke execute on function public.admin_outreach_touches(uuid)
  from public, anon;
revoke execute on function public.admin_outreach_touch_add(uuid, text, text, text)
  from public, anon;
revoke execute on function public.admin_outreach_touch_delete(uuid)
  from public, anon;
revoke execute on function public.admin_outreach_status_set(uuid, text)
  from public, anon;
revoke execute on function public.admin_outreach_follow_up_set(uuid, date)
  from public, anon;
revoke execute on function public.admin_outreach_hidden_set(uuid, boolean)
  from public, anon;
revoke execute on function public.admin_outreach_counts() from public, anon;
grant execute on function public.admin_outreach_roster() to authenticated;
grant execute on function public.admin_outreach_touches(uuid) to authenticated;
grant execute on function public.admin_outreach_touch_add(uuid, text, text, text)
  to authenticated;
grant execute on function public.admin_outreach_touch_delete(uuid)
  to authenticated;
grant execute on function public.admin_outreach_status_set(uuid, text)
  to authenticated;
grant execute on function public.admin_outreach_follow_up_set(uuid, date)
  to authenticated;
grant execute on function public.admin_outreach_hidden_set(uuid, boolean)
  to authenticated;
grant execute on function public.admin_outreach_counts() to authenticated;

comment on table public.user_outreach_contacts is
  'Per-user outreach state for /admin/outreach: status, follow-up '
  'reminder, and whether the account is hidden as not a real user.';
comment on table public.user_outreach_touches is
  'The outreach log: outreach sent, feedback received (verbatim), and '
  'internal notes, with which admin wrote each.';
