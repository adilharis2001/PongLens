-- 092: QA role + test billing mode.
--
-- Mumtaz (and any future tester) gets end-to-end access to production
-- without ever touching real money. The design in one breath: a QA role
-- in app_roles pins the user's billing to 'test'; every money-bearing row
-- is stamped with its mode at creation (never derived later, so revoking
-- the role cannot reclassify history); and a test row's counterparties
-- must both be test-side, which is what actually keeps the two economies
-- from leaking into each other:
--
--   * a QA student can only buy from a QA coach (never lands a fake-paid
--     order in a real coach's inbox),
--   * a live user asking for a QA coach's storefront or offering hears
--     "not found" (never pays real money to a test account),
--   * revenue queries filter billing_mode = 'live' and are simply right.
--
-- The admin is not pinned: current_billing_mode() reads an app_config
-- toggle for the admin account, default live, flipped in /admin/testing.
--
-- Also here: feedback_items grows severity + environment so QA bug
-- reports carry repro context, and feedback_board returns them (gated
-- like attachments: author + admin only for environment).

-- ---------------------------------------------------------------------------
-- app_roles — table-driven roles, deliberately separate from is_admin()
-- (which guards the whole platform and stays hardcoded to the owner).
-- ---------------------------------------------------------------------------
create table public.app_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('qa')),
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.app_roles enable row level security;

create policy "Admin manages roles"
  on public.app_roles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Users can see own roles"
  on public.app_roles for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- is_qa() / current_billing_mode()
-- ---------------------------------------------------------------------------
create or replace function public.is_qa(p_user uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_roles
    where user_id = p_user and role = 'qa'
  );
$$;

revoke all on function public.is_qa(uuid) from public, anon;
grant execute on function public.is_qa(uuid) to authenticated;

-- The one question every payment surface asks. QA is pinned to test; the
-- admin follows the app_config toggle (default live); everyone else is
-- live. Anon and service-role contexts (auth.uid() null) resolve to live.
create or replace function public.current_billing_mode()
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when public.is_qa((select auth.uid())) then 'test'
    when public.is_admin()
     and coalesce((select value from public.app_config
                   where key = 'admin_payments_test'), 'false') = 'true'
      then 'test'
    else 'live'
  end;
$$;

revoke all on function public.current_billing_mode() from public, anon;
grant execute on function public.current_billing_mode() to authenticated;

insert into public.app_config (key, value)
values ('admin_payments_test', 'false')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- review_orders.billing_mode — stamped at creation by create_review_order.
-- All existing orders are real money.
-- ---------------------------------------------------------------------------
alter table public.review_orders
  add column billing_mode text not null default 'live'
  check (billing_mode in ('live', 'test'));

-- ---------------------------------------------------------------------------
-- create_review_order — same flow as 077, plus the mode stamp and the
-- cross-mode guard. Both refusals say 'offering not found' on purpose:
-- to a live user a QA storefront does not exist, and vice versa.
-- ---------------------------------------------------------------------------
create or replace function public.create_review_order(p_offering_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_mode   text;
  v_off    public.offerings%rowtype;
  v_cp     public.coach_profiles%rowtype;
  v_active integer;
  v_fee_mode text;
  v_fee    integer;
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce((select value from public.app_config
               where key = 'coach_reviews_enabled'), 'false') <> 'true' then
    raise exception 'purchases_disabled' using errcode = 'P0001';
  end if;

  select * into v_off from public.offerings
   where id = p_offering_id and active;
  if not found then
    raise exception 'offering not found' using errcode = 'P0002';
  end if;
  if v_off.coach_id = v_me then
    raise exception 'own_offering' using errcode = 'P0001';
  end if;

  -- The mode stamp, and the wall between the two economies.
  v_mode := public.current_billing_mode();
  if (v_mode = 'test') <> public.is_qa(v_off.coach_id) then
    raise exception 'offering not found' using errcode = 'P0002';
  end if;

  -- The profile row-lock serializes concurrent purchases past this point.
  select * into v_cp from public.coach_profiles
   where user_id = v_off.coach_id and published
   for update;
  if not found then
    raise exception 'offering not found' using errcode = 'P0002';
  end if;
  if not v_cp.charges_enabled then
    raise exception 'coach_not_ready' using errcode = 'P0001';
  end if;
  if not v_cp.accepting_orders then
    raise exception 'coach_paused' using errcode = 'P0001';
  end if;
  if v_cp.max_active_orders is not null then
    -- Fresh unpaid orders count too: each may become paid work within
    -- its checkout session's life. Stale ones age out of the window.
    select count(*) into v_active from public.review_orders
     where coach_id = v_cp.user_id
       and (status in ('awaiting_submission', 'submitted', 'in_review',
                       'clarification', 'delivered')
            or (status = 'awaiting_payment'
                and created_at > now() - interval '1 hour'));
    if v_active >= v_cp.max_active_orders then
      raise exception 'coach_at_capacity' using errcode = 'P0001';
    end if;
  end if;

  select f.fee_mode, f.fee_cents into v_fee_mode, v_fee
    from public.review_fee_for(v_off.price_cents) f;

  insert into public.review_orders
    (offering_id, coach_id, student_id, status, billing_mode,
     price_cents, fee_mode, fee_cents, coach_share_cents,
     turnaround_days, followup_rounds, intake_questions, review_sections)
  values
    (v_off.id, v_off.coach_id, v_me, 'awaiting_payment', v_mode,
     v_off.price_cents, v_fee_mode, v_fee, v_off.price_cents - v_fee,
     v_off.turnaround_days, v_off.followup_rounds,
     v_off.intake_questions, v_off.review_sections)
  returning id into v_id;

  -- app_access is granted when payment lands (markOrderPaid), not here.
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- coach_page — a QA coach's storefront exists only for QA viewers and
-- the admin. Everyone else (including anon) gets null, same as a handle
-- that was never registered.
-- ---------------------------------------------------------------------------
create or replace function public.coach_page(p_handle text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_cp     public.coach_profiles%rowtype;
  v_active integer;
  v_done   integer;
  v_sample boolean;
  v_avail  boolean;
begin
  select * into v_cp from public.coach_profiles
   where handle = lower(p_handle) and published;
  if not found then
    return null;
  end if;

  if public.is_qa(v_cp.user_id)
     and not (public.is_qa((select auth.uid())) or public.is_admin()) then
    return null;
  end if;

  select count(*) into v_active from public.review_orders
   where coach_id = v_cp.user_id
     and status in ('awaiting_submission', 'submitted', 'in_review',
                    'clarification', 'delivered');
  select count(*) into v_done from public.review_orders
   where coach_id = v_cp.user_id and status = 'completed';
  v_sample := v_cp.sample_order_id is not null and exists (
    select 1 from public.review_orders o
    where o.id = v_cp.sample_order_id and o.coach_id = v_cp.user_id
      and o.status = 'completed' and o.sample_consent = 'approved');

  v_avail := v_cp.accepting_orders
    and v_cp.charges_enabled
    and (v_cp.max_active_orders is null
         or v_active < v_cp.max_active_orders);

  return jsonb_build_object(
    'handle', v_cp.handle,
    'display_name', v_cp.display_name,
    'headline', v_cp.headline,
    'bio', v_cp.bio,
    'credentials', to_jsonb(v_cp.credentials),
    'photo_path', case
      when v_cp.photo_path like
        'r2://ponglens-media/avatar/' || v_cp.user_id || '/%'
      then v_cp.photo_path else null end,
    'samples', v_cp.samples,
    'completed_count', v_done,
    'has_sample_review', v_sample,
    'available', v_avail,
    'offerings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'title', o.title,
        'description', o.description,
        'includes', to_jsonb(o.includes),
        'price_cents', o.price_cents,
        'turnaround_days', o.turnaround_days,
        'followup_rounds', o.followup_rounds,
        'image', case
          when o.image like 'stock:%' then o.image
          when o.image like
            'r2://ponglens-media/offer/' || v_cp.user_id || '/%'
          then o.image else null end
      ) order by o.sort, o.created_at)
      from public.offerings o
      where o.coach_id = v_cp.user_id and o.active
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- feedback: severity + captured environment for QA bug reports.
-- ---------------------------------------------------------------------------
alter table public.feedback_items
  add column severity text check (severity in ('blocker', 'major', 'minor')),
  add column environment jsonb;

-- Return type changes, so drop-and-recreate (grants below).
drop function if exists public.feedback_board(text);

create function public.feedback_board(p_sort text default 'top')
returns table (
  id uuid, user_id uuid, title text, body text, type text, status text,
  qa jsonb, vote_count integer, created_at timestamptz,
  author_name text, author_avatar text, voted boolean, attachments jsonb,
  severity text, environment jsonb
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
  select
    i.id, i.user_id, i.title, i.body, i.type, i.status, i.qa,
    i.vote_count, i.created_at,
    split_part(coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      split_part(u.email::text, '@', 1),
      'Player'), ' ', 1) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    exists (select 1 from public.feedback_votes v
            where v.item_id = i.id and v.user_id = auth.uid()) as voted,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.attachments else '[]'::jsonb end as attachments,
    i.severity,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.environment else null end as environment
  from public.feedback_items i
  join auth.users u on u.id = i.user_id
  where i.visibility = 'board'
  order by
    case when p_sort = 'top' then i.vote_count end desc,
    i.created_at desc
  limit 200;
end;
$$;

revoke all on function public.feedback_board(text) from public, anon;
grant execute on function public.feedback_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin role management, for /admin/testing.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_qa()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', r.user_id,
      'email', u.email,
      'name', coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''), ''),
      'note', r.note,
      'created_at', r.created_at
    ) order by r.created_at)
    from public.app_roles r
    join auth.users u on u.id = r.user_id
    where r.role = 'qa'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_qa() from public, anon;
grant execute on function public.admin_list_qa() to authenticated;

-- Add or remove the QA role by email. The account must already exist —
-- this assigns a role, it never invites.
create or replace function public.admin_set_qa(
  p_email text,
  p_enabled boolean,
  p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if p_enabled then
    insert into public.app_roles (user_id, role, note)
    values (v_user, 'qa', nullif(trim(coalesce(p_note, '')), ''))
    on conflict (user_id, role) do nothing;
  else
    delete from public.app_roles where user_id = v_user and role = 'qa';
  end if;

  return jsonb_build_object('user_id', v_user, 'enabled', p_enabled);
end;
$$;

revoke all on function public.admin_set_qa(text, boolean, text)
  from public, anon;
grant execute on function public.admin_set_qa(text, boolean, text)
  to authenticated;
