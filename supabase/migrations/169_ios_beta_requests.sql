-- Self-serve TestFlight requests from the public player landing page.
-- The browser never receives table access; the server service role claims a
-- normalized address and gets back which idempotent notifications remain.

create table public.ios_beta_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  invite_sent_at timestamptz,
  invite_suppressed_at timestamptz,
  admin_notified_at timestamptz,
  admin_suppressed_at timestamptz,
  constraint ios_beta_requests_normalized_email
    check (email = lower(btrim(email)) and length(email) between 3 and 254)
);

alter table public.ios_beta_requests enable row level security;
revoke all on table public.ios_beta_requests from public, anon, authenticated;

-- HMAC'd source addresses live only long enough to enforce a short abuse
-- window. They cannot be used to recover a visitor's network address without
-- the server-only key used to create them.
create table public.ios_beta_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now()
);

alter table public.ios_beta_rate_limits enable row level security;
revoke all on table public.ios_beta_rate_limits from public, anon, authenticated;

create or replace function public.claim_ios_beta_request(
  p_email text,
  p_ip_hash text
)
returns table (
  request_id uuid,
  request_email text,
  requested_at timestamptz,
  invite_needed boolean,
  admin_notice_needed boolean,
  rate_limited boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_attempts integer;
  v_request public.ios_beta_requests%rowtype;
begin
  if p_email is null
     or p_email <> lower(btrim(p_email))
     or length(p_email) not between 3 and 254
     or p_ip_hash is null
     or length(p_ip_hash) <> 64 then
    raise exception 'invalid beta request';
  end if;

  -- Opportunistic cleanup keeps the private limiter table bounded without a
  -- second scheduled job.
  delete from public.ios_beta_rate_limits
   where updated_at < v_now - interval '48 hours';

  insert into public.ios_beta_rate_limits as limits (
    ip_hash,
    window_started_at,
    attempts,
    updated_at
  ) values (
    p_ip_hash,
    v_now,
    1,
    v_now
  )
  on conflict (ip_hash) do update
    set attempts = case
          when limits.window_started_at <= v_now - interval '1 hour' then 1
          else limits.attempts + 1
        end,
        window_started_at = case
          when limits.window_started_at <= v_now - interval '1 hour' then v_now
          else limits.window_started_at
        end,
        updated_at = v_now
  returning attempts into v_attempts;

  if v_attempts > 10 then
    return query select
      null::uuid,
      null::text,
      null::timestamptz,
      false,
      false,
      true;
    return;
  end if;

  insert into public.ios_beta_requests as requests (
    email,
    last_requested_at
  ) values (
    p_email,
    v_now
  )
  on conflict (email) do update
    set last_requested_at = v_now,
        request_count = requests.request_count + 1
  returning * into v_request;

  return query select
    v_request.id,
    v_request.email,
    v_request.created_at,
    v_request.invite_sent_at is null
      and v_request.invite_suppressed_at is null,
    v_request.admin_notified_at is null
      and v_request.admin_suppressed_at is null,
    false;
end;
$$;

revoke execute on function public.claim_ios_beta_request(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_ios_beta_request(text, text)
  to service_role;
