-- Everything an account stores counts toward its allowance, and the number
-- is re-measured from the buckets every night.
--
-- Until now my_storage_state counted original match videos, cut videos and
-- lesson originals, and nothing else: point clips, reels, recap renders,
-- voice notes, sketches and journal photos were booked in storage_ledger
-- and then filtered out of the sum, and four upload routes (coach photo,
-- offering image, review attachments, review voice notes) never booked at
-- all. Audited on 2026-09-14: the buckets held 307 GB of user files, the
-- ledger knew about 269 GB, and the allowance counted 197 GB.
--
-- The ledger is a running tally, and a running tally is only right if
-- every write and every delete remembers to update it, forever. Several
-- do not (lesson cleanup deletes files without a negative row; worker
-- bookings are best-effort; match.json is rewritten without booking the
-- change), so it drifts. Instead of chasing every leak, the web app's
-- scheduled job lists both buckets once a night and writes each account's
-- true usage into storage_snapshots. Used space is then
--
--     snapshot.bytes + sum(ledger rows since snapshot.measured_at)
--
-- so the tally only has to be right for the last day, historic errors
-- retire after the first snapshot, and the difference between the two is
-- visible on the admin storage page the moment a new feature forgets to
-- book. The worker is untouched.
--
-- Allowances (Adil, 2026-09-14): 25 GB for everyone; 100 GB for accounts
-- tagged team or test in player_kinds (the admin's own, Anton's and QA's);
-- Adil's own account keeps its current grant. The tag drives the number,
-- so retagging an account in the admin players list moves its allowance.
--
-- Matches attached to a paid review still count (the held_bytes exclusion
-- is retired; the gate still lets an order-funded upload through). A
-- coach's lesson video is charged to the coach, as before.

-- ---------------------------------------------------------------------------
-- Allowances
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values ('team_storage_bytes', '107374182400')
on conflict (key) do nothing;

update public.app_config set value = '26843545600' where key = 'default_storage_bytes';

create or replace function public.team_storage_bytes()
returns bigint
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select value::bigint from public.app_config
      where key = 'team_storage_bytes' and value ~ '^[0-9]+$'),
    107374182400
  );
$$;
revoke execute on function public.team_storage_bytes() from public, anon;
grant execute on function public.team_storage_bytes() to authenticated;

-- The default an account starts on, by what kind of account it is.
create or replace function public.default_storage_bytes_for(p_user uuid)
returns bigint
language sql stable security definer
set search_path = public
as $$
  select case
    when (select public._player_kind(u.*) from auth.users u where u.id = p_user) in ('team', 'test')
      then public.team_storage_bytes()
    else public.default_storage_bytes()
  end;
$$;
revoke execute on function public.default_storage_bytes_for(uuid) from public, anon, authenticated;

create or replace function public._ensure_quota(uid uuid)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.user_quotas (user_id, storage_limit_bytes)
  values (uid, public.default_storage_bytes_for(uid))
  on conflict (user_id) do nothing;
$$;

alter table public.user_quotas alter column storage_limit_bytes set default 26843545600;

-- Team and test accounts: 100 GB, whatever they had (the QA account's 1 TB
-- grant comes down to it). Adil's own account keeps its grant.
update public.user_quotas q
   set storage_limit_bytes = public.team_storage_bytes()
  from auth.users u
 where u.id = q.user_id
   and public._player_kind(u.*) in ('team', 'test')
   and lower(coalesce(u.email, '')) <> 'adilharis2001@gmail.com';

-- Ordinary accounts still on the old 10 GB default follow it to 25 GB;
-- a custom grant keeps its custom value (same move as 043 and 096).
update public.user_quotas q
   set storage_limit_bytes = 26843545600
  from auth.users u
 where u.id = q.user_id
   and public._player_kind(u.*) = 'real'
   and q.storage_limit_bytes = 10737418240;

-- Retagging an account moves its allowance with the tag. Going onto the
-- team never lowers a bigger grant; coming off it only removes the team
-- default, never a custom grant.
create or replace function public.admin_player_kind_set(p_user_id uuid, p_kind text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_kind text;
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
  select public._player_kind(u.*) into v_kind from auth.users u where u.id = p_user_id;
  perform public._ensure_quota(p_user_id);
  if v_kind in ('team', 'test') then
    update public.user_quotas
       set storage_limit_bytes = greatest(storage_limit_bytes, public.team_storage_bytes())
     where user_id = p_user_id;
  else
    update public.user_quotas
       set storage_limit_bytes = public.default_storage_bytes()
     where user_id = p_user_id
       and storage_limit_bytes = public.team_storage_bytes();
  end if;
  return v_kind;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly measurement
-- ---------------------------------------------------------------------------
-- One row per account: what the buckets held at measured_at, by category,
-- and what the tally said at the same moment (for the drift column).
-- Written only by the web app's scheduled job (service role).
create table public.storage_snapshots (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  measured_at  timestamptz not null,
  bytes        bigint not null default 0 check (bytes >= 0),
  objects      integer not null default 0,
  breakdown    jsonb not null default '{}'::jsonb,
  ledger_bytes bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger storage_snapshots_set_updated_at
  before update on public.storage_snapshots
  for each row execute function public.set_updated_at();

alter table public.storage_snapshots enable row level security;

create policy "Users can view own storage snapshot"
  on public.storage_snapshots for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.storage_snapshots from authenticated;
grant all on public.storage_snapshots to service_role;

-- One row per run, so the admin page can say when the buckets were last
-- measured and whether anything in them belonged to nobody.
create table public.storage_snapshot_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null,
  finished_at    timestamptz,
  objects        integer,
  bytes          bigint,
  accounts       integer,
  platform_bytes bigint,
  unattributed   jsonb not null default '[]'::jsonb,
  error          text,
  created_at     timestamptz not null default now()
);

create index storage_snapshot_runs_started_idx
  on public.storage_snapshot_runs (started_at desc);

alter table public.storage_snapshot_runs enable row level security;

create policy "Admin can view storage snapshot runs"
  on public.storage_snapshot_runs for select
  to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.storage_snapshot_runs from authenticated;
grant all on public.storage_snapshot_runs to service_role;

-- The "since the snapshot" query walks one user's rows by time.
create index if not exists storage_ledger_user_created_idx
  on public.storage_ledger (user_id, created_at);

-- The tally's answer for every account, for the job to record beside the
-- measurement. Service role only.
create or replace function public._storage_ledger_totals()
returns table (user_id uuid, bytes bigint)
language sql stable security definer
set search_path = public
as $$
  select l.user_id, sum(l.bytes)::bigint
  from public.storage_ledger l
  group by l.user_id;
$$;
revoke execute on function public._storage_ledger_totals() from public, anon, authenticated;
grant execute on function public._storage_ledger_totals() to service_role;

-- ---------------------------------------------------------------------------
-- Used space: snapshot plus everything booked since. Every kind counts.
-- ---------------------------------------------------------------------------
create or replace function public._storage_used_bytes(p_user uuid)
returns bigint
language sql stable security definer
set search_path = public
as $$
  with snap as (
    select s.bytes, s.measured_at
    from public.storage_snapshots s
    where s.user_id = p_user
  )
  select greatest(
    coalesce((select bytes from snap), 0)
    + coalesce((select sum(l.bytes) from public.storage_ledger l
                where l.user_id = p_user
                  and l.created_at > coalesce((select measured_at from snap),
                                              '-infinity'::timestamptz)), 0),
    0)::bigint;
$$;
revoke execute on function public._storage_used_bytes(uuid) from public, anon, authenticated;

drop function if exists public.my_storage_state();

create function public.my_storage_state()
returns table (
  storage_limit_bytes    bigint,
  daily_upload_limit     int,
  used_bytes             bigint,
  uploads_today          int,
  active_jobs            int,
  pending_request        boolean,
  base_limit_bytes       bigint,
  entitlement_bytes      bigint,
  entitlement_expires_at timestamptz,
  held_bytes             bigint,
  snapshot_at            timestamptz,
  breakdown              jsonb
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  perform public._ensure_quota(v_me);
  return query
  with ent as (
    select coalesce(sum(e.bytes), 0)::bigint as bytes,
           min(e.expires_at) as next_expiry
    from public.storage_entitlements e
    where e.user_id = v_me and e.expires_at > now()
  ),
  snap as (
    select s.measured_at, s.breakdown
    from public.storage_snapshots s
    where s.user_id = v_me
  )
  select
    q.storage_limit_bytes + ent.bytes,
    q.daily_upload_limit,
    public._storage_used_bytes(v_me),
    ((select count(*) from public.matches m
      where m.user_id = v_me and m.raw_path is not null
        and m.created_at >= date_trunc('day', now()))
     + (select count(*) from public.jobs j
        where j.user_id = v_me
          and ((j.kind = 'deadspace_cut' and j.options ->> 'match_id' is null)
               or j.kind = 'youtube_import')
          and j.created_at >= date_trunc('day', now())))::int,
    (select count(*) from public.jobs j
     where j.user_id = v_me
       and j.status in ('queued', 'processing')
       and j.kind not in ('reclip', 'content_check'))::int,
    exists (select 1 from public.quota_requests r
            where r.user_id = v_me and r.status = 'pending'),
    q.storage_limit_bytes,
    ent.bytes,
    ent.next_expiry,
    0::bigint,
    (select measured_at from snap),
    coalesce((select breakdown from snap), '{}'::jsonb)
  from public.user_quotas q, ent
  where q.user_id = v_me;
end;
$$;

revoke execute on function public.my_storage_state() from public, anon;
grant execute on function public.my_storage_state() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin readers, all on the same arithmetic
-- ---------------------------------------------------------------------------
create or replace function public.admin_allowance_players(p_search text default ''::text)
 returns table(
   user_id uuid, email text, name text, minutes_balance integer,
   storage_limit_bytes bigint, used_bytes bigint
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select u.id, u.email::text, public._display_name(u.*),
    public._processing_balance(u.id, case when public.is_qa(u.id) then 'test' else 'live' end) +
      case when exists (select 1 from public.processing_ledger l where l.user_id = u.id
        and l.kind = 'grant' and l.billing_mode = case when public.is_qa(u.id) then 'test' else 'live' end)
      then 0 else public._commerce_int('free_processing_minutes', 250) end,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes_for(u.id)) +
      coalesce((select sum(e.bytes) from public.storage_entitlements e where e.user_id = u.id
        and e.expires_at > now()), 0)::bigint,
    public._storage_used_bytes(u.id)
  from auth.users u left join public.user_quotas q on q.user_id = u.id
  where coalesce(u.email, '') ilike '%' || trim(coalesce(p_search, '')) || '%'
     or coalesce(public._display_name(u.*), '') ilike '%' || trim(coalesce(p_search, '')) || '%'
  order by u.last_sign_in_at desc nulls last, u.id limit 30;
end;
$function$;

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
    public._storage_used_bytes(r.user_id),
    coalesce(q.storage_limit_bytes, public.default_storage_bytes_for(r.user_id))
      + coalesce((select sum(e.bytes) from public.storage_entitlements e
                  where e.user_id = r.user_id and e.expires_at > now()), 0)::bigint
  from public.quota_requests r
  join auth.users u on u.id = r.user_id
  left join public.user_quotas q on q.user_id = r.user_id
  where r.status = 'pending' and r.resource = 'storage'
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
    x.user_id, u.email::text, public._display_name(u.*),
    x.used,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes_for(x.user_id))
  from (
    select ids.user_id, public._storage_used_bytes(ids.user_id) as used
    from (select s.user_id from public.storage_snapshots s
          union
          select l.user_id from public.storage_ledger l) ids
  ) x
  join auth.users u on u.id = x.user_id
  left join public.user_quotas q on q.user_id = x.user_id
  order by x.used desc
  limit 10;
end;
$$;

-- The admin storage page: every account that has ever stored anything,
-- with the live number, the tally, and last night's measurement side by
-- side. The difference between tally and measurement is the drift column.
create or replace function public.admin_storage_overview()
returns table (
  user_id               uuid,
  email                 text,
  name                  text,
  kind                  text,
  storage_limit_bytes   bigint,
  used_bytes            bigint,
  ledger_bytes          bigint,
  snapshot_bytes        bigint,
  snapshot_ledger_bytes bigint,
  snapshot_at           timestamptz,
  breakdown             jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    u.id, u.email::text, public._display_name(u.*), public._player_kind(u.*),
    coalesce(q.storage_limit_bytes, public.default_storage_bytes_for(u.id))
      + coalesce((select sum(e.bytes) from public.storage_entitlements e
                  where e.user_id = u.id and e.expires_at > now()), 0)::bigint,
    public._storage_used_bytes(u.id),
    coalesce((select sum(l.bytes) from public.storage_ledger l where l.user_id = u.id), 0)::bigint,
    s.bytes, s.ledger_bytes, s.measured_at, s.breakdown
  from auth.users u
  left join public.user_quotas q on q.user_id = u.id
  left join public.storage_snapshots s on s.user_id = u.id
  where s.user_id is not null
     or exists (select 1 from public.storage_ledger l where l.user_id = u.id)
     or (q.user_id is not null and q.storage_limit_bytes <> public.default_storage_bytes_for(u.id))
  order by public._storage_used_bytes(u.id) desc, u.email;
end;
$$;
revoke execute on function public.admin_storage_overview() from public, anon;
grant execute on function public.admin_storage_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- The routes that never booked: coach photo, offering image, review
-- attachments and review voice notes. One pair of functions for the three
-- prefixes, pinned to the caller's own folder like every other appender.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_append_own_media(p_bytes bigint, p_key text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 104857600 then
    raise exception 'invalid byte count';
  end if;
  if p_key !~ ('^r2://ponglens-media/(avatar|offer|review)/' || auth.uid()::text || '/') then
    raise exception 'invalid key';
  end if;
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  values (auth.uid(), 'other', p_bytes, p_key);
end;
$$;
revoke execute on function public.ledger_append_own_media(bigint, text) from public, anon;
grant execute on function public.ledger_append_own_media(bigint, text) to authenticated;

create or replace function public.ledger_negate_own_media(p_key text)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  negated int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_key !~ ('^r2://ponglens-media/(avatar|offer|review)/' || auth.uid()::text || '/') then
    raise exception 'invalid key';
  end if;
  select public._ledger_negate_keys(array[p_key]) into negated;
  return coalesce(negated, 0);
end;
$$;
revoke execute on function public.ledger_negate_own_media(text) from public, anon;
grant execute on function public.ledger_negate_own_media(text) to authenticated;

-- A review attachment row can be deleted straight through the API (the
-- iPhone app did until today); the bytes come off the tally either way.
create or replace function public.ledger_on_review_attachment_delete()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.r2_key like 'r2://ponglens-media/review/%' then
    perform public._ledger_negate_keys(array[old.r2_key]);
  end if;
  return old;
end;
$$;
revoke all on function public.ledger_on_review_attachment_delete() from public, anon, authenticated;

drop trigger if exists review_attachments_ledger_on_delete on public.review_attachments;
create trigger review_attachments_ledger_on_delete
  before delete on public.review_attachments
  for each row execute function public.ledger_on_review_attachment_delete();

-- ---------------------------------------------------------------------------
-- The job's write. One call per run: every account's measurement in one
-- statement, and the ids of any account that no longer exists handed back
-- so the run can report files that belong to nobody. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public._record_storage_snapshots(p_measured_at timestamptz, p_rows jsonb)
returns table (skipped uuid)
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.storage_snapshots (user_id, measured_at, bytes, objects, breakdown, ledger_bytes)
  select r.user_id, p_measured_at, greatest(coalesce(r.bytes, 0), 0), coalesce(r.objects, 0),
         coalesce(r.breakdown, '{}'::jsonb), coalesce(r.ledger_bytes, 0)
  from jsonb_to_recordset(p_rows)
         as r(user_id uuid, bytes bigint, objects int, breakdown jsonb, ledger_bytes bigint)
  where exists (select 1 from auth.users u where u.id = r.user_id)
  on conflict (user_id) do update
    set measured_at  = excluded.measured_at,
        bytes        = excluded.bytes,
        objects      = excluded.objects,
        breakdown    = excluded.breakdown,
        ledger_bytes = excluded.ledger_bytes;
  return query
  select r.user_id
  from jsonb_to_recordset(p_rows) as r(user_id uuid)
  where not exists (select 1 from auth.users u where u.id = r.user_id);
end;
$$;
revoke execute on function public._record_storage_snapshots(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public._record_storage_snapshots(timestamptz, jsonb) to service_role;
