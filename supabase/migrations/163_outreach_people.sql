-- 163 — people Anton adds by hand to the outreach workspace.
--
-- Not everyone worth reaching out to has a PongLens account. A person here
-- is just a name, an optional email, and the same status, follow-up and
-- log a platform user gets. When they sign up, the workspace shows their
-- account too; the hand-added entry is deleted rather than linked, which
-- keeps this table one thing.
--
-- The touch log becomes shared: a touch belongs to exactly one of a
-- platform user or a hand-added person. Same sealed-table access shape as
-- 162.

create table if not exists public.user_outreach_people (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 200),
  email        text check (char_length(email) <= 320),
  status       text not null default 'new' check
                 (status in ('new', 'contacted', 'in_touch', 'closed')),
  follow_up_on date,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_outreach_people enable row level security;
revoke all on public.user_outreach_people from anon, authenticated;

alter table public.user_outreach_touches
  add column if not exists person_id uuid
    references public.user_outreach_people (id) on delete cascade;
alter table public.user_outreach_touches
  alter column user_id drop not null;
alter table public.user_outreach_touches
  add constraint user_outreach_touches_one_subject
    check ((user_id is null) <> (person_id is null));

create index if not exists user_outreach_touches_person_at
  on public.user_outreach_touches (person_id, at desc)
  where person_id is not null;

-- The hand-added roster, with the same touch summary the user roster has.
create or replace function public.admin_outreach_people()
returns table (
  id               uuid,
  name             text,
  email            text,
  status           text,
  follow_up_on     date,
  created_by       text,
  created_at       timestamptz,
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
  select p.id, p.name, p.email, p.status, p.follow_up_on,
         p.created_by, p.created_at,
         (select max(t.at) from public.user_outreach_touches t
           where t.person_id = p.id and t.kind = 'outreach'),
         (select max(t.at) from public.user_outreach_touches t
           where t.person_id = p.id and t.kind = 'feedback'),
         (select count(*) from public.user_outreach_touches t
           where t.person_id = p.id)::int
    from public.user_outreach_people p
   order by p.created_at desc;
end;
$$;

create or replace function public.admin_outreach_person_add(
  p_name text, p_email text default null)
returns table (
  id           uuid,
  name         text,
  email        text,
  status       text,
  follow_up_on date,
  created_by   text,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_author text := coalesce(auth.jwt() ->> 'email', 'unknown');
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  insert into public.user_outreach_people (name, email, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_email, '')), ''), v_author)
  returning user_outreach_people.id, user_outreach_people.name,
            user_outreach_people.email, user_outreach_people.status,
            user_outreach_people.follow_up_on,
            user_outreach_people.created_by,
            user_outreach_people.created_at;
end;
$$;

create or replace function public.admin_outreach_person_edit(
  p_id uuid, p_name text, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.user_outreach_people
     set name = btrim(p_name),
         email = nullif(btrim(coalesce(p_email, '')), ''),
         updated_at = now()
   where id = p_id;
end;
$$;

-- Removes the person and, by cascade, their log. For a hand-added entry
-- there is no account to hide behind, so delete is the withdrawal.
create or replace function public.admin_outreach_person_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.user_outreach_people where id = p_id;
end;
$$;

create or replace function public.admin_outreach_person_status_set(
  p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.user_outreach_people
     set status = p_status, updated_at = now()
   where id = p_id;
end;
$$;

create or replace function public.admin_outreach_person_follow_up_set(
  p_id uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.user_outreach_people
     set follow_up_on = p_on, updated_at = now()
   where id = p_id;
end;
$$;

-- Same auto-transition as the user version in 162: outreach moves a fresh
-- entry to contacted, feedback to in touch; closed is never touched.
create or replace function public.admin_outreach_person_touch_add(
  p_id uuid,
  p_kind text,
  p_channel text default null,
  p_body text default '')
returns table (
  id        uuid,
  user_id   uuid,
  person_id uuid,
  kind      text,
  channel   text,
  body      text,
  author    text,
  at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_author text := coalesce(auth.jwt() ->> 'email', 'unknown');
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.user_outreach_people
     set status = case
           when p_kind = 'outreach' and status = 'new' then 'contacted'
           when p_kind = 'feedback' and status in ('new', 'contacted')
             then 'in_touch'
           else status
         end,
         updated_at = now()
   where user_outreach_people.id = p_id;
  return query
  insert into public.user_outreach_touches (person_id, kind, channel, body, author)
  values (p_id, p_kind, p_channel, p_body, v_author)
  returning user_outreach_touches.id, user_outreach_touches.user_id,
            user_outreach_touches.person_id, user_outreach_touches.kind,
            user_outreach_touches.channel, user_outreach_touches.body,
            user_outreach_touches.author, user_outreach_touches.at;
end;
$$;

-- The list function now says who a touch is about on both sides, which is
-- a return-type change, so the 162 version is dropped first.
drop function if exists public.admin_outreach_touches(uuid);
create or replace function public.admin_outreach_touches(
  p_user_id uuid default null)
returns table (
  id        uuid,
  user_id   uuid,
  person_id uuid,
  kind      text,
  channel   text,
  body      text,
  author    text,
  at        timestamptz
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
  select t.id, t.user_id, t.person_id, t.kind, t.channel, t.body,
         t.author, t.at
    from public.user_outreach_touches t
   where p_user_id is null or t.user_id = p_user_id
   order by t.at desc;
end;
$$;

-- Hand-added people count toward the hub card's two numbers too.
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
    ((select count(*) from auth.users u
       left join public.user_outreach_contacts c on c.user_id = u.id
      where u.email not ilike '%@example.com'
        and u.email not ilike '%@ponglens.com'
        and coalesce(c.hidden, false) = false
        and coalesce(c.status, 'new') = 'new')
     + (select count(*) from public.user_outreach_people p
         where p.status = 'new'))::int,
    ((select count(*) from auth.users u
       join public.user_outreach_contacts c on c.user_id = u.id
      where u.email not ilike '%@example.com'
        and u.email not ilike '%@ponglens.com'
        and c.hidden = false
        and c.status <> 'closed'
        and c.follow_up_on is not null
        and c.follow_up_on <= current_date)
     + (select count(*) from public.user_outreach_people p
         where p.status <> 'closed'
           and p.follow_up_on is not null
           and p.follow_up_on <= current_date))::int;
end;
$$;

revoke execute on function public.admin_outreach_people() from public, anon;
revoke execute on function public.admin_outreach_person_add(text, text)
  from public, anon;
revoke execute on function public.admin_outreach_person_edit(uuid, text, text)
  from public, anon;
revoke execute on function public.admin_outreach_person_delete(uuid)
  from public, anon;
revoke execute on function public.admin_outreach_person_status_set(uuid, text)
  from public, anon;
revoke execute on function public.admin_outreach_person_follow_up_set(uuid, date)
  from public, anon;
revoke execute on function public.admin_outreach_person_touch_add(uuid, text, text, text)
  from public, anon;
revoke execute on function public.admin_outreach_touches(uuid) from public, anon;
revoke execute on function public.admin_outreach_counts() from public, anon;
grant execute on function public.admin_outreach_people() to authenticated;
grant execute on function public.admin_outreach_person_add(text, text)
  to authenticated;
grant execute on function public.admin_outreach_person_edit(uuid, text, text)
  to authenticated;
grant execute on function public.admin_outreach_person_delete(uuid)
  to authenticated;
grant execute on function public.admin_outreach_person_status_set(uuid, text)
  to authenticated;
grant execute on function public.admin_outreach_person_follow_up_set(uuid, date)
  to authenticated;
grant execute on function public.admin_outreach_person_touch_add(uuid, text, text, text)
  to authenticated;
grant execute on function public.admin_outreach_touches(uuid) to authenticated;
grant execute on function public.admin_outreach_counts() to authenticated;

comment on table public.user_outreach_people is
  'People added by hand to /admin/outreach: prospects without a PongLens '
  'account, tracked with the same status, follow-up and log as users.';
