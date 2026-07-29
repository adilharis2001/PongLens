-- 043: early access — the app goes invite-only, managed from /admin.
--
--  * invite_codes          — admin-generated codes (label, max uses, revoke).
--  * app_access            — who may use the app. One row = access. Sources:
--                            'founder' (everyone before the gate went up),
--                            'invite' (redeemed a code), 'coach' (accepted a
--                            coach invite — a player inviting their coach IS
--                            the invitation), 'admin' (granted by hand).
--                            Middleware checks this table for every protected
--                            route; no row -> /early-access.
--  * redeem_invite()       — validates a code and grants the caller access.
--  * admin_create_invite() — mints a code from a no-lookalike alphabet.
--  * admin_invite_codes()  — codes + who redeemed them, for the portal.
--  * admin_set_quota()     — direct per-user storage edit from the portal.
--  * default_storage_bytes() — the storage default, read from app_config
--                            ('default_storage_bytes', seeded 5 GB) so the
--                            portal can change it without a migration. Used
--                            by _ensure_quota at row creation and as the
--                            no-row fallback in the admin read functions.
--                            Existing rows still on the old 2 GB default are
--                            bumped to 5 GB below; custom grants keep their
--                            value.

-- ---------------------------------------------------------------------------
-- invite_codes
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  label      text not null default '',
  max_uses   int  not null default 1 check (max_uses between 1 and 1000),
  use_count  int  not null default 0,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

-- Redemption happens inside redeem_invite() (SECURITY DEFINER), so the only
-- client-facing surface is the admin portal.
create policy "Admin can manage invite codes"
  on public.invite_codes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- app_access
-- ---------------------------------------------------------------------------
create table public.app_access (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  source     text not null check (source in ('founder', 'invite', 'coach', 'admin')),
  code_id    uuid references public.invite_codes (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.app_access enable row level security;

-- The middleware's gate check reads the caller's own row; the portal reads
-- everyone's. All writes go through SECURITY DEFINER functions.
create policy "Users can view own access"
  on public.app_access for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Everyone who already has an account was here before the gate went up.
insert into public.app_access (user_id, source)
select id, 'founder' from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Configurable storage default (5 GB), replacing the hardcoded 2 GB
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value)
values ('default_storage_bytes', '5368709120')
on conflict (key) do nothing;

create or replace function public.default_storage_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value::bigint from public.app_config
      where key = 'default_storage_bytes'
        and value ~ '^[0-9]+$'),
    5368709120
  );
$$;

revoke execute on function public.default_storage_bytes() from public, anon;
grant execute on function public.default_storage_bytes() to authenticated;

alter table public.user_quotas
  alter column storage_limit_bytes set default 5368709120;

-- Rows materialized at the old 2 GB default move to the new default;
-- anything else is a deliberate grant and keeps its value.
update public.user_quotas
   set storage_limit_bytes = 5368709120
 where storage_limit_bytes = 2147483648;

-- _ensure_quota now materializes rows at the configured default, so a
-- portal change applies to accounts created after it.
create or replace function public._ensure_quota(uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_quotas (user_id, storage_limit_bytes)
  values (uid, public.default_storage_bytes())
  on conflict (user_id) do nothing;
$$;

revoke execute on function public._ensure_quota(uuid) from public, anon, authenticated;

-- Same read shapes as 010, with the configurable fallback.
create or replace function public.admin_quota_requests()
returns table (
  id                  uuid,
  user_id             uuid,
  email               text,
  name                text,
  message             text,
  created_at          timestamptz,
  used_bytes          bigint,
  storage_limit_bytes bigint
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
    r.id, r.user_id, u.email::text, public._display_name(u.*),
    r.message, r.created_at,
    coalesce((select sum(l.bytes) from public.storage_ledger l
              where l.user_id = r.user_id), 0)::bigint,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes())
  from public.quota_requests r
  join auth.users u on u.id = r.user_id
  left join public.user_quotas q on q.user_id = r.user_id
  where r.status = 'pending'
  order by r.created_at;
end;
$$;

create or replace function public.admin_top_storage()
returns table (
  user_id             uuid,
  email               text,
  name                text,
  used_bytes          bigint,
  storage_limit_bytes bigint
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
    l.user_id, u.email::text, public._display_name(u.*),
    sum(l.bytes)::bigint,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes())
  from public.storage_ledger l
  join auth.users u on u.id = l.user_id
  left join public.user_quotas q on q.user_id = l.user_id
  group by l.user_id, u.email, u.id, q.storage_limit_bytes
  order by sum(l.bytes) desc
  limit 10;
end;
$$;

-- Direct per-user edit from the portal's storage list (grants outside the
-- request flow: bumping a friend, trimming an abuser).
create or replace function public.admin_set_quota(
  p_user_id uuid, p_new_limit_bytes bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_new_limit_bytes is null or p_new_limit_bytes < 0
     or p_new_limit_bytes > 1099511627776 then   -- 1 TB sanity cap
    raise exception 'invalid limit';
  end if;
  perform public._ensure_quota(p_user_id);
  update public.user_quotas
     set storage_limit_bytes = p_new_limit_bytes
   where user_id = p_user_id;
end;
$$;

revoke execute on function public.admin_set_quota(uuid, bigint) from public, anon;
grant execute on function public.admin_set_quota(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- redeem_invite — the gate page's one call
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_code public.invite_codes%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  -- Already in: succeed quietly (a double submit is not an error).
  if exists (select 1 from public.app_access a where a.user_id = v_me) then
    return;
  end if;

  select * into v_code
    from public.invite_codes
   where upper(btrim(p_code)) = code
   for update;

  if not found or v_code.revoked_at is not null
     or v_code.use_count >= v_code.max_uses then
    -- One error for every failure mode: the gate page shouldn't teach
    -- guessers which codes exist.
    raise exception 'invalid code';
  end if;

  insert into public.app_access (user_id, source, code_id)
  values (v_me, 'invite', v_code.id);

  update public.invite_codes
     set use_count = use_count + 1
   where id = v_code.id;
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_create_invite / admin_invite_codes
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_invite(
  p_label text default '', p_max_uses int default 1)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- No 0/O/1/I/L: codes get read aloud and retyped from paper.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000 then
    raise exception 'invalid max uses';
  end if;
  loop
    select string_agg(
             substr(v_alphabet, 1 + floor(random() * 31)::int, 1), '')
      into v_code
      from generate_series(1, 8);
    begin
      insert into public.invite_codes (code, label, max_uses, created_by)
      values (v_code, coalesce(btrim(p_label), ''), p_max_uses, auth.uid());
      return v_code;
    exception when unique_violation then
      -- 31^8 codes; a collision is a lottery win. Roll again.
    end;
  end loop;
end;
$$;

revoke execute on function public.admin_create_invite(text, int) from public, anon;
grant execute on function public.admin_create_invite(text, int) to authenticated;

create or replace function public.admin_invite_codes()
returns table (
  id         uuid,
  code       text,
  label      text,
  max_uses   int,
  use_count  int,
  revoked_at timestamptz,
  created_at timestamptz,
  redeemers  text[]
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
    c.id, c.code, c.label, c.max_uses, c.use_count, c.revoked_at,
    c.created_at,
    coalesce(
      (select array_agg(u.email::text order by a.created_at)
         from public.app_access a
         join auth.users u on u.id = a.user_id
        where a.code_id = c.id),
      '{}'::text[]
    )
  from public.invite_codes c
  order by c.created_at desc;
end;
$$;

revoke execute on function public.admin_invite_codes() from public, anon;
grant execute on function public.admin_invite_codes() to authenticated;

-- ---------------------------------------------------------------------------
-- accept_coach_invite — same behavior as 031, plus: accepting a coach
-- invite IS an invitation into the app, so it grants access.
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

  -- The player inviting this coach is the coach's invitation into the app.
  insert into public.app_access (user_id, source)
  values (v_me, 'coach')
  on conflict (user_id) do nothing;

  -- Idempotent: re-scanning after acceptance hands back the existing link
  -- rather than piling up duplicate rows in the player's Sharing list.
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
      (player_id, coach_id, scope_match_id, status)
    values (v_row.player_id, v_me, v_row.scope_match_id, 'accepted')
    returning id into v_id;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(nullif(btrim(v_name), ''), 'A coach');

  v_scope := case
    when v_row.scope_match_id is null then 'They can see all your matches and leave notes.'
    else 'They can see one match and leave notes.'
  end;

  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_row.player_id, 'coach_joined', v_row.scope_match_id, v_me,
          v_name || ' accepted your coach invite', v_scope,
          coalesce('/match/' || v_row.scope_match_id::text, '/account'));

  return v_id;
end;
$$;

revoke execute on function public.accept_coach_invite(uuid) from public, anon;
grant execute on function public.accept_coach_invite(uuid) to authenticated;
