-- 044: access requests — the gate's "request an invite" flow.
--
-- A signed-in account without access can raise a hand instead of emailing.
-- One row per user; approving inserts their app_access row (source
-- 'admin'), so the next page load walks them in. Denied requests keep the
-- row (status 'denied') so the gate can say so instead of offering an
-- endless retry.

create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);

alter table public.access_requests enable row level security;

-- The requester sees their own row (the gate shows "request sent");
-- writes go through the functions below.
create policy "Users can view own access request"
  on public.access_requests for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Raise a hand. Idempotent: a second call is a no-op, and a denied
-- request stays denied rather than silently re-queueing.
create or replace function public.request_access()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.app_access a where a.user_id = auth.uid()) then
    return;   -- already in; nothing to request
  end if;
  insert into public.access_requests (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

revoke execute on function public.request_access() from public, anon;
grant execute on function public.request_access() to authenticated;

-- The portal's pending list.
create or replace function public.admin_access_requests()
returns table (
  id         uuid,
  user_id    uuid,
  email      text,
  name       text,
  created_at timestamptz
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
  select r.id, r.user_id, u.email::text, public._display_name(u.*), r.created_at
  from public.access_requests r
  join auth.users u on u.id = r.user_id
  where r.status = 'pending'
  order by r.created_at;
end;
$$;

revoke execute on function public.admin_access_requests() from public, anon;
grant execute on function public.admin_access_requests() to authenticated;

-- Approve (grants access on the spot) or deny.
create or replace function public.admin_decide_access(
  p_request_id uuid, p_approve boolean)
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
  select r.user_id into uid
  from public.access_requests r
  where r.id = p_request_id and r.status = 'pending'
  for update;
  if uid is null then
    raise exception 'request not found or already decided';
  end if;
  if p_approve then
    insert into public.app_access (user_id, source)
    values (uid, 'admin')
    on conflict (user_id) do nothing;
  end if;
  update public.access_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_request_id;
end;
$$;

revoke execute on function public.admin_decide_access(uuid, boolean) from public, anon;
grant execute on function public.admin_decide_access(uuid, boolean) to authenticated;
