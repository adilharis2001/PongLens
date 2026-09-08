-- 176 — telling genuine users apart from our own accounts.
--
-- Adil, 2026-09-05: the players page is one tall list sorted by match
-- count, and his own test accounts sit at the top of it. Forty-seven
-- accounts, of which about ten are real people. "It doesn't present me
-- with a clear view of genuine users who are using the platform."
--
-- WHY NOT app_roles. That table already exists and already marks QA, but
-- every role in it CARRIES BEHAVIOUR — qa pins an account's payments to
-- test mode, marketing opens /marketing. A label that only describes an
-- account has no business in a table where a stray `where role is not
-- null` grants something. This one is descriptive and nothing reads it
-- except the admin's own list.
--
-- DEFAULTS, so an unmarked account is still sorted correctly:
--   1. an explicit row here wins;
--   2. else the qa role means 'team' — one source of truth for QA;
--   3. else an @example.com or @ponglens.com address means 'test', which
--      is every demo, sample, pilot and throwaway we mint;
--   4. else 'real'.
--
-- Rule 4 is the important one. Unknown defaults to REAL so a genuine new
-- signup is never hidden from the one list that exists to notice them;
-- the cost of that is noise from a new throwaway, which is one click to
-- fix and visible immediately.

create table if not exists public.player_kinds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('real', 'team', 'test')),
  note text,
  set_at timestamptz not null default now()
);

alter table public.player_kinds enable row level security;

-- No policy for anyone but the admin: this is the operator's own view of
-- who is who, and it names accounts.
drop policy if exists "Admin manages player kinds" on public.player_kinds;
create policy "Admin manages player kinds"
  on public.player_kinds for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- The default rule, in one place so the list and the setter agree.
-- ---------------------------------------------------------------------------
create or replace function public._player_kind(p_user auth.users)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select k.kind from public.player_kinds k where k.user_id = p_user.id),
    (select 'team' from public.app_roles r
      where r.user_id = p_user.id and r.role = 'qa' limit 1),
    case
      when p_user.email like '%@example.com'
        or p_user.email like '%@ponglens.com' then 'test'
    end,
    'real'
  );
$$;

-- ---------------------------------------------------------------------------
-- Setting one. Null clears the override and returns the account to the
-- default rule, which is why this takes a nullable kind.
-- ---------------------------------------------------------------------------
create or replace function public.admin_player_kind_set(
  p_user_id uuid,
  p_kind text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_kind is null then
    delete from public.player_kinds where user_id = p_user_id;
  else
    if p_kind not in ('real', 'team', 'test') then
      raise exception 'unknown kind %', p_kind;
    end if;
    insert into public.player_kinds (user_id, kind)
    values (p_user_id, p_kind)
    on conflict (user_id) do update
      set kind = excluded.kind, set_at = now();
  end if;
  return (select public._player_kind(u.*) from auth.users u where u.id = p_user_id);
end;
$$;

revoke execute on function public.admin_player_kind_set(uuid, text) from public;
grant execute on function public.admin_player_kind_set(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The overview gains the kind and the two dates the page now sorts on.
--
-- The hardcoded ORDER BY goes: it sorted by match count, which answers
-- "who has uploaded most" and never "who turned up this week". Ordering
-- is the caller's business now — the page offers three.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_player_overview();
create function public.admin_player_overview()
returns table (
  user_id uuid, email text, name text, created_at timestamptz,
  last_sign_in_at timestamptz,
  -- The newest upload, which is the honest measure of "still using it".
  -- Null for an account that has never uploaded.
  last_upload_at timestamptz,
  kind text,
  used_bytes bigint, storage_limit_bytes bigint,
  matches integer, matches_scored integer, points integer, starred integer,
  notes integer, voice_notes integer, journal_entries integer,
  exports integer, share_links integer, est_cost_usd numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := coalesce(
    (select min(e.occurred_at) from public.cost_usage_events e), now());
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select
    u.id,
    u.email::text,
    public._display_name(u.*),
    u.created_at,
    u.last_sign_in_at,
    (select max(m.created_at) from public.matches m where m.user_id = u.id),
    public._player_kind(u.*),
    coalesce((select sum(l.bytes) from public.storage_ledger l
               where l.user_id = u.id), 0)::bigint,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes()),
    (select count(*) from public.matches m where m.user_id = u.id)::int,
    (select count(*) from public.matches m
      where m.user_id = u.id
        and exists (select 1 from public.points p
                     where p.match_id = m.id
                       and p.confirmed_winner is not null)
        and not exists (select 1 from public.points p
                         where p.match_id = m.id
                           and not p.deleted and not p.is_let
                           and p.confirmed_winner is null)
    )::int,
    (select count(*) from public.points p
       join public.matches m on m.id = p.match_id
      where m.user_id = u.id and not p.deleted)::int,
    (select count(*) from public.points p
       join public.matches m on m.id = p.match_id
      where m.user_id = u.id and not p.deleted and p.starred)::int,
    (select count(*) from public.notes n where n.author_id = u.id)::int,
    (select count(*) from public.notes n
      where n.author_id = u.id and n.audio_path is not null)::int,
    (select count(*) from public.lessons s where s.user_id = u.id)::int,
    ((select count(*) from public.match_reels r
       join public.matches m on m.id = r.match_id
      where m.user_id = u.id and r.status = 'ready')
     + (select count(*) from public.tag_reels r
         where r.user_id = u.id and r.status = 'ready'))::int,
    (select count(*) from public.share_links s
      where s.owner = u.id and s.revoked_at is null)::int,
    coalesce(c.cost_usd, 0)
  from auth.users u
  left join public.user_quotas q on q.user_id = u.id
  left join public._admin_user_cost_allocation(v_start, now())
    c on c.user_id = u.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed: Adil's own reading of who is who, given 2026-09-05. Everything
-- not named here falls to the default rule above, so the demo and sample
-- accounts need no rows.
-- ---------------------------------------------------------------------------
insert into public.player_kinds (user_id, kind, note)
select u.id, v.kind, 'seeded 176'
from (values
  -- the genuine users, named by Adil
  ('guillaumemuller90@gmail.com', 'real'),
  ('tlertruchtkul@gmail.com',     'real'),
  ('julian_sho_morris@yahoo.com', 'real'),
  ('gameli.ak97@gmail.com',       'real'),
  ('iaegis1114@gmail.com',        'real'),
  ('marwan91@gwmail.gwu.edu',     'real'),
  ('arungupta0919@gmail.com',     'real'),
  ('mchen2049@gmail.com',         'real'),
  ('mertipek@gmx.de',             'real'),
  ('jjmytanlau@gmail.com',        'real'),
  ('8sbp279gjc@privaterelay.appleid.com', 'real'),
  ('loganiscool1030@icloud.com',  'real'),
  -- us
  ('adilharis2001@gmail.com',     'team'),
  ('aharisib@tepper.cmu.edu',     'team'),
  ('aber97@gmail.com',            'team'),
  ('anton@antonbermantt.com',     'team'),
  ('antonberman.ttcoach@gmail.com','team'),
  ('rurash200@gmail.com',         'team'),
  ('laibascaleforte@gmail.com',   'team'),
  ('mumtazjaat00786@gmail.com',   'team'),
  ('mumtazjaat786@gmail.com',     'team'),
  ('itsmumtazshabbir+786@gmail.com', 'team'),
  -- neither a user nor us
  ('colbyassistant@gmail.com',    'test'),
  ('adilharis2001+authhook-1788570323@gmail.com', 'test')
) as v(email, kind)
join auth.users u on lower(u.email) = v.email
on conflict (user_id) do nothing;
