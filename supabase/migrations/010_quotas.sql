-- 010: storage quotas + anti-spam limits + admin grant flow + match deletion
--      accounting + dormant billing plumbing.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * user_quotas      — per-user storage limit (default 2 GB) and daily
--                       upload limit (default 3). Rows are created on demand
--                       by my_storage_state() / admin_grant_quota().
--  * storage_ledger   — append-only accounting of every R2 write. Deletes
--                       append negative rows; usage = sum(bytes). Rows are
--                       written only by the worker (service role), by
--                       SECURITY DEFINER append functions, and by the
--                       matches-delete trigger. r2_key stores the full
--                       'r2://bucket/key' URI so deletes can be matched
--                       back to the rows that created them.
--  * quota_requests   — "Request more space" flow; the admin grants or
--                       denies from the Account page.
--  * is_admin()       — admin = the owner's email in the JWT.
--  * matches DELETE   — owners may delete their matches; a BEFORE DELETE
--                       trigger appends the negative ledger rows (clips,
--                       cut video, voice audio of its notes).
--  * plans / subscriptions / credits_ledger — DORMANT billing plumbing
--                       (tables only, RLS-locked, plans seeded inactive).
--                       Nothing reads them until launch; app code paths are
--                       additionally gated on the PAYMENTS_ENABLED flag
--                       (src/lib/flags.ts), which defaults to off.

-- ---------------------------------------------------------------------------
-- is_admin()
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'adilharis2001@gmail.com';
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- user_quotas
-- ---------------------------------------------------------------------------
create table public.user_quotas (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  storage_limit_bytes bigint not null default 2147483648,   -- 2 GB
  daily_upload_limit  int    not null default 3,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger user_quotas_set_updated_at
  before update on public.user_quotas
  for each row execute function public.set_updated_at();

alter table public.user_quotas enable row level security;

create policy "Users can view own quota"
  on public.user_quotas for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "Admin can manage quotas"
  on public.user_quotas for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- storage_ledger
-- ---------------------------------------------------------------------------
create table public.storage_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  match_id   uuid references public.matches (id) on delete set null,
  kind       text not null check (kind in ('clip', 'cut', 'voice', 'other')),
  bytes      bigint not null,
  r2_key     text,               -- full 'r2://bucket/key' URI (or a prefix)
  created_at timestamptz not null default now()
);

create index storage_ledger_user_id_idx on public.storage_ledger (user_id);
create index storage_ledger_match_id_idx on public.storage_ledger (match_id);
create index storage_ledger_r2_key_idx on public.storage_ledger (r2_key);

alter table public.storage_ledger enable row level security;

create policy "Users can view own ledger"
  on public.storage_ledger for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Appends go through the SECURITY DEFINER functions below (or the worker's
-- service-role connection); clients get no direct write access.
revoke insert, update, delete on public.storage_ledger from authenticated;

-- ---------------------------------------------------------------------------
-- quota_requests
-- ---------------------------------------------------------------------------
create table public.quota_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  message    text not null default '',
  status     text not null default 'pending'
             check (status in ('pending', 'granted', 'denied')),
  decided_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index quota_requests_user_id_idx on public.quota_requests (user_id);
create index quota_requests_status_idx on public.quota_requests (status);

alter table public.quota_requests enable row level security;

create policy "Users can view own quota requests"
  on public.quota_requests for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "Users can create own quota requests"
  on public.quota_requests for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

create policy "Admin can update quota requests"
  on public.quota_requests for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Quota helpers
-- ---------------------------------------------------------------------------
-- Internal: make sure a user_quotas row exists (defaults apply).
create or replace function public._ensure_quota(uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_quotas (user_id) values (uid)
  on conflict (user_id) do nothing;
$$;

revoke execute on function public._ensure_quota(uuid) from public, anon, authenticated;

-- Everything the upload gate and the Account storage bar need, one call.
--   used_bytes    sum of the caller's ledger
--   uploads_today jobs created since UTC midnight (uploads + imports)
--   active_jobs   queued/processing jobs (reclips excluded)
create or replace function public.my_storage_state()
returns table (
  storage_limit_bytes bigint,
  daily_upload_limit  int,
  used_bytes          bigint,
  uploads_today       int,
  active_jobs         int,
  pending_request     boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  perform public._ensure_quota(auth.uid());
  return query
  select
    q.storage_limit_bytes,
    q.daily_upload_limit,
    coalesce((select sum(l.bytes) from public.storage_ledger l
              where l.user_id = auth.uid()), 0)::bigint,
    (select count(*) from public.jobs j
     where j.user_id = auth.uid()
       and j.kind in ('deadspace_cut', 'youtube_import')
       and j.created_at >= date_trunc('day', now()))::int,
    (select count(*) from public.jobs j
     where j.user_id = auth.uid()
       and j.status in ('queued', 'processing')
       and j.kind <> 'reclip')::int,
    exists (select 1 from public.quota_requests r
            where r.user_id = auth.uid() and r.status = 'pending')
  from public.user_quotas q
  where q.user_id = auth.uid();
end;
$$;

revoke execute on function public.my_storage_state() from public, anon;
grant execute on function public.my_storage_state() to authenticated;

-- ---------------------------------------------------------------------------
-- Ledger appends from the Next.js routes (positive rows only — a caller can
-- only inflate their OWN usage, never shrink it).
-- ---------------------------------------------------------------------------
-- Raw upload landed in ponglens-raw (upload-url 'complete' action).
create or replace function public.ledger_append_upload(p_bytes bigint, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 8589934592 then
    raise exception 'invalid byte count';
  end if;
  if p_key not like 'r2://ponglens-raw/' || auth.uid() || '/%' then
    raise exception 'invalid key';
  end if;
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  values (auth.uid(), 'other', p_bytes, p_key);
end;
$$;

revoke execute on function public.ledger_append_upload(bigint, text) from public, anon;
grant execute on function public.ledger_append_upload(bigint, text) to authenticated;

-- Voice note audio landed in ponglens-media/voice (transcribe route).
create or replace function public.ledger_append_voice(p_bytes bigint, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 104857600 then
    raise exception 'invalid byte count';
  end if;
  if p_key not like 'r2://ponglens-media/voice/' || auth.uid() || '/%' then
    raise exception 'invalid key';
  end if;
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  values (auth.uid(), 'voice', p_bytes, p_key);
end;
$$;

revoke execute on function public.ledger_append_voice(bigint, text) from public, anon;
grant execute on function public.ledger_append_voice(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Negation: for each key, if the net balance is positive, append a row that
-- zeroes it out. Idempotent (a second call is a no-op). Used by the match
-- delete trigger and by the worker's retention sweep. Not client-callable.
-- ---------------------------------------------------------------------------
create or replace function public._ledger_negate_keys(p_keys text[])
returns int
language sql
security definer
set search_path = public
as $$
  with bal as (
    select user_id, kind, r2_key, sum(bytes) as net
    from public.storage_ledger
    where r2_key = any (p_keys)
    group by user_id, kind, r2_key
    having sum(bytes) > 0
  ),
  ins as (
    insert into public.storage_ledger (user_id, kind, bytes, r2_key)
    select user_id, kind, -net, r2_key from bal
    returning 1
  )
  select count(*)::int from ins;
$$;

revoke execute on function public._ledger_negate_keys(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Match deletion: owners may delete a match; the trigger books the freed
-- bytes (clips/match.json rows carry match_id; the cut video and voice audio
-- are negated by key). The /api/delete-match route removes the R2 objects
-- first, then deletes the row.
-- ---------------------------------------------------------------------------
grant delete on public.matches to authenticated;

create policy "Owner can delete own matches"
  on public.matches for delete
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.ledger_on_match_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  keys text[];
begin
  -- 1. rows recorded against the match (point clips, match.json, reclips)
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  select user_id, kind, -sum(bytes), r2_key
  from public.storage_ledger
  where match_id = old.id
  group by user_id, kind, r2_key
  having sum(bytes) > 0;

  -- 2. cut video + voice audio of its notes: negate by key. Runs after (1),
  -- so anything already negated there nets to zero and is skipped.
  keys := array[]::text[];
  if old.cut_path like 'r2://%' then
    keys := keys || old.cut_path;
  end if;
  keys := keys || coalesce(
    array(select n.audio_path from public.notes n
          where n.match_id = old.id and n.audio_path is not null),
    array[]::text[]);
  if coalesce(array_length(keys, 1), 0) > 0 then
    perform public._ledger_negate_keys(keys);
  end if;
  return old;
end;
$$;

create trigger matches_ledger_on_delete
  before delete on public.matches
  for each row execute function public.ledger_on_match_delete();

-- ---------------------------------------------------------------------------
-- Admin flow (all guarded on is_admin(); SECURITY DEFINER because they read
-- auth.users for display fields and cross-user usage)
-- ---------------------------------------------------------------------------
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
    coalesce(q.storage_limit_bytes, 2147483648)
  from public.quota_requests r
  join auth.users u on u.id = r.user_id
  left join public.user_quotas q on q.user_id = r.user_id
  where r.status = 'pending'
  order by r.created_at;
end;
$$;

revoke execute on function public.admin_quota_requests() from public, anon;
grant execute on function public.admin_quota_requests() to authenticated;

create or replace function public.admin_grant_quota(
  p_request_id uuid, p_new_limit_bytes bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_new_limit_bytes is null or p_new_limit_bytes < 0
     or p_new_limit_bytes > 1099511627776 then   -- 1 TB sanity cap
    raise exception 'invalid limit';
  end if;
  select r.user_id into uid
  from public.quota_requests r
  where r.id = p_request_id and r.status = 'pending'
  for update;
  if uid is null then
    raise exception 'request not found or already decided';
  end if;
  perform public._ensure_quota(uid);
  update public.user_quotas
     set storage_limit_bytes = p_new_limit_bytes
   where user_id = uid;
  update public.quota_requests
     set status = 'granted', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;
end;
$$;

revoke execute on function public.admin_grant_quota(uuid, bigint) from public, anon;
grant execute on function public.admin_grant_quota(uuid, bigint) to authenticated;

create or replace function public.admin_deny_quota(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.quota_requests
     set status = 'denied', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'request not found or already decided';
  end if;
end;
$$;

revoke execute on function public.admin_deny_quota(uuid) from public, anon;
grant execute on function public.admin_deny_quota(uuid) to authenticated;

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
    coalesce(q.storage_limit_bytes, 2147483648)
  from public.storage_ledger l
  join auth.users u on u.id = l.user_id
  left join public.user_quotas q on q.user_id = l.user_id
  group by l.user_id, u.email, u.id, q.storage_limit_bytes
  order by sum(l.bytes) desc
  limit 10;
end;
$$;

revoke execute on function public.admin_top_storage() from public, anon;
grant execute on function public.admin_top_storage() to authenticated;

-- ---------------------------------------------------------------------------
-- DORMANT billing plumbing (001's design stub, materialized). Tables only:
-- no UI, no reads, no writes anywhere in the app yet. All three tables are
-- RLS-enabled with zero policies, so clients see nothing. Plans are seeded
-- inactive. App code paths that will eventually use these are gated on the
-- PAYMENTS_ENABLED flag (src/lib/flags.ts), which is off by default and set
-- nowhere. Do not activate before launch clearance.
-- ---------------------------------------------------------------------------
create table public.plans (
  id            text primary key,                -- 'free', 'player', 'credits'
  name          text not null,
  monthly_quota int,                             -- null = unlimited
  allowed_kinds text[] not null default array['deadspace_cut'],
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  plan_id            text not null references public.plans (id) default 'free',
  stripe_customer_id text,
  status             text not null default 'active',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.credits_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  delta      int not null,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

create index credits_ledger_user_id_idx on public.credits_ledger (user_id);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credits_ledger enable row level security;

-- Belt and braces: no client access at all while dormant.
revoke all on public.plans from anon, authenticated;
revoke all on public.subscriptions from anon, authenticated;
revoke all on public.credits_ledger from anon, authenticated;

insert into public.plans (id, name, active) values
  ('free', 'Free', false),
  ('player', 'Player', false),
  ('credits', 'Credits', false);
