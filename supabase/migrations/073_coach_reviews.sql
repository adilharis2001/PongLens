-- 073: paid coach reviews.
--
-- Coaches publish offerings; students buy a structured review of one match.
-- Design doc: docs/superpowers/specs/2026-08-04-paid-coach-reviews-design.md.
--
-- Shape of the thing:
--   coach_profiles / offerings   — the storefront (unlisted page per handle)
--   review_orders                — the order and its whole money+state life
--   review_documents/_findings   — what the coach builds and delivers
--   review_messages              — clarification + follow-up threads
--   stripe_events                — webhook idempotency, service-role only
--
-- Money state (checkout/refund/payout ids) is written only by the server
-- (service role); every state transition is a SECURITY DEFINER RPC with
-- FOR UPDATE, following 049's placement lifecycle. Clients get SELECT and
-- a few column-granted UPDATEs, nothing more.
--
-- Free coach links are untouched. A paid order grants the coach access to
-- the one submitted match while the order is active; after completion the
-- coach keeps the review and the point clips its findings reference, not
-- the match (point_in_completed_review below).

-- ---------------------------------------------------------------------------
-- coach_profiles
-- ---------------------------------------------------------------------------
create table public.coach_profiles (
  user_id            uuid primary key references auth.users(id)
                       on delete cascade,
  handle             text not null unique,
  display_name       text not null default '',
  headline           text not null default '',
  bio                text not null default '',
  credentials        text[] not null default '{}',
  -- Server-managed via service role; never client-writable.
  stripe_account_id  text,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  accepting_orders   boolean not null default true,
  max_active_orders  integer,
  published          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint coach_profiles_handle_check
    check (handle ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  constraint coach_profiles_display_name_check
    check (char_length(display_name) <= 80),
  constraint coach_profiles_headline_check
    check (char_length(headline) <= 120),
  constraint coach_profiles_bio_check
    check (char_length(bio) <= 2000),
  constraint coach_profiles_max_active_check
    check (max_active_orders is null or max_active_orders between 1 and 100)
);

alter table public.coach_profiles enable row level security;

create policy "Coach can view own profile"
  on public.coach_profiles for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "Coach can create own profile"
  on public.coach_profiles for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Coach can update own profile"
  on public.coach_profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Stripe columns stay server-side.
revoke update on public.coach_profiles from authenticated;
grant update (handle, display_name, headline, bio, credentials,
              accepting_orders, max_active_orders, published, updated_at)
  on public.coach_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- offerings
-- ---------------------------------------------------------------------------
create table public.offerings (
  id                uuid primary key default gen_random_uuid(),
  coach_id          uuid not null references auth.users(id) on delete cascade,
  template_key      text not null default 'custom',
  title             text not null,
  description       text not null default '',
  includes          text[] not null default '{}',
  price_cents       integer not null,
  turnaround_days   integer not null,
  intake_questions  jsonb not null default '[]'::jsonb,
  review_sections   jsonb not null default '[]'::jsonb,
  followup_rounds   smallint not null default 1,
  active            boolean not null default true,
  sort              integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint offerings_title_check
    check (char_length(title) between 1 and 80),
  constraint offerings_description_check
    check (char_length(description) <= 1000),
  constraint offerings_price_check
    check (price_cents between 500 and 50000),
  constraint offerings_turnaround_check
    check (turnaround_days between 1 and 30),
  constraint offerings_followups_check
    check (followup_rounds between 0 and 3),
  constraint offerings_questions_shape_check
    check (jsonb_typeof(intake_questions) = 'array'),
  constraint offerings_sections_shape_check
    check (jsonb_typeof(review_sections) = 'array')
);

create index offerings_coach_id_idx on public.offerings (coach_id, sort);

alter table public.offerings enable row level security;

create policy "Coach can create offerings"
  on public.offerings for insert
  to authenticated
  with check (
    coach_id = (select auth.uid())
    and exists (select 1 from public.coach_profiles cp
                where cp.user_id = (select auth.uid()))
  );

create policy "Coach can update offerings"
  on public.offerings for update
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

create policy "Coach can delete offerings"
  on public.offerings for delete
  to authenticated
  using (coach_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- review_orders
-- ---------------------------------------------------------------------------
create table public.review_orders (
  id                uuid primary key default gen_random_uuid(),
  offering_id       uuid not null references public.offerings(id)
                      on delete restrict,
  coach_id          uuid not null references auth.users(id) on delete cascade,
  student_id        uuid not null references auth.users(id) on delete cascade,
  match_id          uuid references public.matches(id) on delete set null,
  status            text not null default 'awaiting_payment',
  -- Snapshots at purchase. The offering can change; the deal can't.
  price_cents       integer not null,
  fee_mode          text not null,
  fee_cents         integer not null,
  coach_share_cents integer not null,
  turnaround_days   integer not null,
  followup_rounds   smallint not null,
  intake_questions  jsonb not null default '[]'::jsonb,
  review_sections   jsonb not null default '[]'::jsonb,
  intake_answers    jsonb not null default '[]'::jsonb,
  promised_by       timestamptz,
  decline_message   text,
  cancel_reason     text,
  -- Server-managed payment refs. Only the payments module reads these.
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_charge_id           text,
  stripe_refund_id           text,
  stripe_payout_id           text,
  paid_at       timestamptz,
  submitted_at  timestamptz,
  accepted_at   timestamptz,
  delivered_at  timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint review_orders_status_check check (status in (
    'awaiting_payment', 'awaiting_submission', 'submitted', 'in_review',
    'clarification', 'delivered', 'completed', 'declined', 'cancelled')),
  constraint review_orders_fee_mode_check
    check (fee_mode in ('percent', 'fixed')),
  constraint review_orders_amounts_check check (
    price_cents >= 0 and fee_cents >= 0 and coach_share_cents >= 0
    and fee_cents + coach_share_cents = price_cents),
  constraint review_orders_parties_check check (coach_id <> student_id),
  constraint review_orders_decline_check
    check (decline_message is null or char_length(decline_message) <= 500),
  constraint review_orders_cancel_check
    check (cancel_reason is null or char_length(cancel_reason) <= 500)
);

create index review_orders_coach_idx
  on public.review_orders (coach_id, status, created_at desc);
create index review_orders_student_idx
  on public.review_orders (student_id, created_at desc);
create index review_orders_match_idx on public.review_orders (match_id);
create unique index review_orders_checkout_session_idx
  on public.review_orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.review_orders enable row level security;

create policy "Order parties can view orders"
  on public.review_orders for select
  to authenticated
  using (student_id = (select auth.uid())
         or coach_id = (select auth.uid())
         or public.is_admin());

-- Every write is an RPC or the server.
revoke insert, update, delete on public.review_orders from authenticated;

-- The coach sees their own offerings; a student sees any offering they hold
-- an order on (the order page names what was bought even after the coach
-- edits or retires it — money fields are snapshotted on the order anyway).
-- Lives down here because it references review_orders.
create policy "Coach and buyers can view offerings"
  on public.offerings for select
  to authenticated
  using (
    coach_id = (select auth.uid())
    or public.is_admin()
    or exists (select 1 from public.review_orders o
               where o.offering_id = offerings.id
                 and o.student_id = (select auth.uid()))
  );

-- Buying a review is an invitation into the app (see create_review_order),
-- so app_access learns the provenance value.
alter table public.app_access
  drop constraint if exists app_access_source_check;
alter table public.app_access
  add constraint app_access_source_check
    check (source in ('founder', 'invite', 'coach', 'admin', 'order'));

-- ---------------------------------------------------------------------------
-- Order-scoped access helpers (SECURITY DEFINER so child-table policies
-- don't re-enter review_orders RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_review_coach(p_order_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.review_orders o
                 where o.id = p_order_id and o.coach_id = auth.uid());
$$;

create or replace function public.is_review_party(p_order_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.review_orders o
                 where o.id = p_order_id
                   and (o.coach_id = auth.uid()
                        or o.student_id = auth.uid()));
$$;

-- The coach may build the review only while the order is theirs to work.
create or replace function public.review_writable(p_order_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.review_orders o
                 where o.id = p_order_id
                   and o.coach_id = auth.uid()
                   and o.status in ('in_review', 'clarification'));
$$;

-- The student sees the work only once it ships.
create or replace function public.review_visible_to_student(p_order_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.review_orders o
                 where o.id = p_order_id
                   and o.student_id = auth.uid()
                   and o.status in ('delivered', 'completed'));
$$;

revoke all on function public.is_review_coach(uuid),
              public.is_review_party(uuid),
              public.review_writable(uuid),
              public.review_visible_to_student(uuid)
  from public, anon;
grant execute on function public.is_review_coach(uuid),
                 public.is_review_party(uuid),
                 public.review_writable(uuid),
                 public.review_visible_to_student(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- review_documents — the sectioned write-up. One per order.
-- ---------------------------------------------------------------------------
create table public.review_documents (
  order_id    uuid primary key references public.review_orders(id)
                on delete cascade,
  sections    jsonb not null default '[]'::jsonb,
  status      text not null default 'draft',
  updated_at  timestamptz not null default now(),
  constraint review_documents_status_check
    check (status in ('draft', 'delivered')),
  constraint review_documents_sections_shape_check
    check (jsonb_typeof(sections) = 'array')
);

alter table public.review_documents enable row level security;

create policy "Coach and post-delivery student can view review"
  on public.review_documents for select
  to authenticated
  using (public.is_review_coach(order_id)
         or public.review_visible_to_student(order_id)
         or public.is_admin());

-- Writes go through save_review_document / deliver_review.
revoke insert, update, delete on public.review_documents from authenticated;

-- ---------------------------------------------------------------------------
-- review_findings — point-anchored observations, the review's spine
-- ---------------------------------------------------------------------------
create table public.review_findings (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.review_orders(id)
                on delete cascade,
  title       text not null default '',
  body        text not null default '',
  audio_path  text,
  image_path  text,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint review_findings_title_check check (char_length(title) <= 120),
  constraint review_findings_body_check check (char_length(body) <= 4000)
);

create index review_findings_order_idx
  on public.review_findings (order_id, sort);

alter table public.review_findings enable row level security;

create policy "Coach and post-delivery student can view findings"
  on public.review_findings for select
  to authenticated
  using (public.is_review_coach(order_id)
         or public.review_visible_to_student(order_id)
         or public.is_admin());

create policy "Coach can create findings while working"
  on public.review_findings for insert
  to authenticated
  with check (public.review_writable(order_id));

create policy "Coach can update findings while working"
  on public.review_findings for update
  to authenticated
  using (public.review_writable(order_id))
  with check (public.review_writable(order_id));

create policy "Coach can delete findings while working"
  on public.review_findings for delete
  to authenticated
  using (public.review_writable(order_id));

-- One observation can point at several rallies.
create table public.review_finding_points (
  finding_id  uuid not null references public.review_findings(id)
                on delete cascade,
  point_id    uuid not null references public.points(id) on delete cascade,
  primary key (finding_id, point_id)
);

create index review_finding_points_point_idx
  on public.review_finding_points (point_id);

alter table public.review_finding_points enable row level security;

create policy "Finding viewers can view finding points"
  on public.review_finding_points for select
  to authenticated
  using (exists (select 1 from public.review_findings f
                 where f.id = finding_id
                   and (public.is_review_coach(f.order_id)
                        or public.review_visible_to_student(f.order_id)
                        or public.is_admin())));

create policy "Coach can link points while working"
  on public.review_finding_points for insert
  to authenticated
  with check (exists (select 1 from public.review_findings f
                      where f.id = finding_id
                        and public.review_writable(f.order_id)));

create policy "Coach can unlink points while working"
  on public.review_finding_points for delete
  to authenticated
  using (exists (select 1 from public.review_findings f
                 where f.id = finding_id
                   and public.review_writable(f.order_id)));

-- ---------------------------------------------------------------------------
-- review_attachments — files the coach prepared (plan PDFs, docs, images)
-- ---------------------------------------------------------------------------
create table public.review_attachments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.review_orders(id)
                  on delete cascade,
  r2_key        text not null,
  filename      text not null,
  size_bytes    bigint not null,
  content_type  text not null default '',
  created_at    timestamptz not null default now(),
  constraint review_attachments_size_check
    check (size_bytes between 1 and 52428800),
  constraint review_attachments_filename_check
    check (char_length(filename) between 1 and 200)
);

create index review_attachments_order_idx
  on public.review_attachments (order_id);

alter table public.review_attachments enable row level security;

create policy "Coach and post-delivery student can view attachments"
  on public.review_attachments for select
  to authenticated
  using (public.is_review_coach(order_id)
         or public.review_visible_to_student(order_id)
         or public.is_admin());

create policy "Coach can add attachments while working"
  on public.review_attachments for insert
  to authenticated
  with check (public.review_writable(order_id));

create policy "Coach can remove attachments while working"
  on public.review_attachments for delete
  to authenticated
  using (public.review_writable(order_id));

-- ---------------------------------------------------------------------------
-- review_messages — clarification questions and follow-up rounds
-- ---------------------------------------------------------------------------
create table public.review_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.review_orders(id)
                on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint review_messages_kind_check
    check (kind in ('clarification', 'followup')),
  constraint review_messages_body_check
    check (char_length(body) between 1 and 2000)
);

create index review_messages_order_idx
  on public.review_messages (order_id, created_at);

alter table public.review_messages enable row level security;

create policy "Order parties can view messages"
  on public.review_messages for select
  to authenticated
  using (public.is_review_party(order_id) or public.is_admin());

-- Inserted only by RPCs, which enforce state and the follow-up cap.
revoke insert, update, delete on public.review_messages from authenticated;

-- ---------------------------------------------------------------------------
-- stripe_events — webhook idempotency. Service role only.
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  event_id      text primary key,
  type          text not null,
  processed_at  timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Match access: an active paid order admits the coach to that one match.
-- Same body as 003 plus the order arm. Ends at completion by design.
-- ---------------------------------------------------------------------------
create or replace function public.has_match_access(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = m_id
      and (
        m.user_id = auth.uid()
        or exists (
          select 1
          from public.coach_links cl
          where cl.coach_id = auth.uid()
            and cl.player_id = m.user_id
            and cl.status = 'accepted'
            and (cl.scope_match_id is null or cl.scope_match_id = m.id)
        )
        or exists (
          select 1
          from public.review_orders o
          where o.match_id = m.id
            and o.coach_id = auth.uid()
            and o.status in ('submitted', 'in_review',
                             'clarification', 'delivered')
        )
      )
  );
$$;

drop policy if exists "Owner and coaches can view matches" on public.matches;
create policy "Owner and coaches can view matches"
  on public.matches for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.coach_links cl
      where cl.coach_id = (select auth.uid())
        and cl.player_id = matches.user_id
        and cl.status = 'accepted'
        and (cl.scope_match_id is null or cl.scope_match_id = matches.id)
    )
    or exists (
      select 1 from public.review_orders o
      where o.match_id = matches.id
        and o.coach_id = (select auth.uid())
        and o.status in ('submitted', 'in_review',
                         'clarification', 'delivered')
    )
  );

-- After completion the coach keeps the clips their findings cite — the
-- review must stay watchable — but not the rest of the match.
create or replace function public.point_in_completed_review(p_point_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1
    from public.review_finding_points fp
    join public.review_findings f on f.id = fp.finding_id
    join public.review_orders o on o.id = f.order_id
    where fp.point_id = p_point_id
      and o.coach_id = auth.uid()
      and o.status = 'completed'
  );
$$;

revoke all on function public.point_in_completed_review(uuid)
  from public, anon;
grant execute on function public.point_in_completed_review(uuid)
  to authenticated;

drop policy if exists "Match viewers can view points" on public.points;
create policy "Match viewers can view points"
  on public.points for select
  to authenticated
  using (public.has_match_access(match_id)
         or public.point_in_completed_review(id));

-- ---------------------------------------------------------------------------
-- Fee config. Admin sets mode and value in app_config; every order
-- snapshots the result at purchase.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values
  ('coach_reviews_enabled', 'false'),
  ('review_fee_mode', 'percent'),
  ('review_fee_percent', '15'),
  ('review_fee_fixed_cents', '500')
on conflict (key) do nothing;

create or replace function public.review_fee_for(p_price_cents integer,
                                                 out fee_mode text,
                                                 out fee_cents integer)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_pct   numeric;
  v_fixed integer;
begin
  select coalesce((select value from public.app_config
                   where key = 'review_fee_mode'), 'percent')
    into fee_mode;
  if fee_mode = 'fixed' then
    select coalesce((select value from public.app_config
                     where key = 'review_fee_fixed_cents')::integer, 500)
      into v_fixed;
    fee_cents := least(greatest(v_fixed, 0), p_price_cents);
  else
    fee_mode := 'percent';
    select coalesce((select value from public.app_config
                     where key = 'review_fee_percent')::numeric, 15)
      into v_pct;
    fee_cents := least(greatest(round(p_price_cents * v_pct / 100.0)::integer,
                                0), p_price_cents);
  end if;
end;
$$;

revoke all on function public.review_fee_for(integer) from public, anon;
grant execute on function public.review_fee_for(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The public storefront. Anon-callable; returns only what the page shows.
-- ---------------------------------------------------------------------------
create or replace function public.coach_page(p_handle text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_cp     public.coach_profiles%rowtype;
  v_active integer;
  v_avail  boolean;
begin
  select * into v_cp from public.coach_profiles
   where handle = lower(p_handle) and published;
  if not found then
    return null;
  end if;

  select count(*) into v_active from public.review_orders
   where coach_id = v_cp.user_id
     and status in ('awaiting_submission', 'submitted', 'in_review',
                    'clarification', 'delivered');

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
    'available', v_avail,
    'offerings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'title', o.title,
        'description', o.description,
        'includes', to_jsonb(o.includes),
        'price_cents', o.price_cents,
        'turnaround_days', o.turnaround_days,
        'followup_rounds', o.followup_rounds
      ) order by o.sort, o.created_at)
      from public.offerings o
      where o.coach_id = v_cp.user_id and o.active
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.coach_page(text) from public;
grant execute on function public.coach_page(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_review_order — purchase intent. Validates the storefront is real
-- and open, snapshots the deal, and (like accepting a coach invite) is an
-- invitation into the app: buying from a coach's link grants access.
-- ---------------------------------------------------------------------------
create or replace function public.create_review_order(p_offering_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
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

  -- Lock the profile row so two simultaneous purchases can't both pass the
  -- capacity check.
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
    select count(*) into v_active from public.review_orders
     where coach_id = v_cp.user_id
       and status in ('awaiting_submission', 'submitted', 'in_review',
                      'clarification', 'delivered');
    if v_active >= v_cp.max_active_orders then
      raise exception 'coach_at_capacity' using errcode = 'P0001';
    end if;
  end if;

  select f.fee_mode, f.fee_cents into v_fee_mode, v_fee
    from public.review_fee_for(v_off.price_cents) f;

  insert into public.review_orders
    (offering_id, coach_id, student_id, status,
     price_cents, fee_mode, fee_cents, coach_share_cents,
     turnaround_days, followup_rounds, intake_questions, review_sections)
  values
    (v_off.id, v_off.coach_id, v_me, 'awaiting_payment',
     v_off.price_cents, v_fee_mode, v_fee, v_off.price_cents - v_fee,
     v_off.turnaround_days, v_off.followup_rounds,
     v_off.intake_questions, v_off.review_sections)
  returning id into v_id;

  -- Reaching checkout from a coach's link is an invitation into the app.
  insert into public.app_access (user_id, source)
  values (v_me, 'order')
  on conflict (user_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.create_review_order(uuid) from public, anon;
grant execute on function public.create_review_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_review_order — the student attaches a match and answers intake.
-- A still-processing match is fine; the matches trigger below flips the
-- order to submitted the moment processing lands.
-- ---------------------------------------------------------------------------
create or replace function public.submit_review_order(p_order_id uuid,
                                                      p_match_id uuid,
                                                      p_answers jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_o     public.review_orders%rowtype;
  v_match public.matches%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_answers, 'null'::jsonb)) <> 'array' then
    raise exception 'bad_answers' using errcode = '23514';
  end if;

  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> v_me then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'awaiting_submission' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found or v_match.user_id <> v_me then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.status = 'failed' then
    raise exception 'match_failed' using errcode = 'P0001';
  end if;

  update public.review_orders
     set match_id = p_match_id,
         intake_answers = p_answers,
         status = case when v_match.status = 'ready'
                       then 'submitted' else status end,
         submitted_at = case when v_match.status = 'ready'
                             then now() else submitted_at end,
         updated_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.submit_review_order(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.submit_review_order(uuid, uuid, jsonb)
  to authenticated;

-- When an attached match finishes processing, the order goes to the coach.
create or replace function public.matches_review_submit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status
     or new.status <> 'ready' then
    return new;
  end if;
  update public.review_orders
     set status = 'submitted', submitted_at = now(), updated_at = now()
   where match_id = new.id and status = 'awaiting_submission';
  return new;
end;
$$;

drop trigger if exists matches_review_submit on public.matches;
create trigger matches_review_submit
  after update of status on public.matches
  for each row execute function public.matches_review_submit();

-- ---------------------------------------------------------------------------
-- Coach transitions
-- ---------------------------------------------------------------------------
create or replace function public.accept_review_order(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'submitted' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'in_review',
         accepted_at = now(),
         promised_by = now() + make_interval(days => v_o.turnaround_days),
         updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.decline_review_order(p_order_id uuid,
                                                       p_message text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('awaiting_submission', 'submitted') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'declined',
         decline_message = nullif(btrim(coalesce(p_message, '')), ''),
         cancelled_at = now(),
         updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.request_review_clarification(
  p_order_id uuid, p_body text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'in_review' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'empty_message' using errcode = '23514';
  end if;
  insert into public.review_messages (order_id, author_id, kind, body)
  values (p_order_id, auth.uid(), 'clarification', btrim(p_body));
  update public.review_orders
     set status = 'clarification', updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.reply_review_clarification(
  p_order_id uuid, p_body text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'clarification' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'empty_message' using errcode = '23514';
  end if;
  insert into public.review_messages (order_id, author_id, kind, body)
  values (p_order_id, auth.uid(), 'clarification', btrim(p_body));
  update public.review_orders
     set status = 'in_review', updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.save_review_document(p_order_id uuid,
                                                       p_sections jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('in_review', 'clarification') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_sections, 'null'::jsonb)) <> 'array' then
    raise exception 'bad_sections' using errcode = '23514';
  end if;
  insert into public.review_documents (order_id, sections, updated_at)
  values (p_order_id, p_sections, now())
  on conflict (order_id) do update
    set sections = excluded.sections, updated_at = now()
    where review_documents.status = 'draft';
end;
$$;

create or replace function public.deliver_review(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
  v_has_doc boolean;
  v_has_findings boolean;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('in_review', 'clarification') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.review_documents
                 where order_id = p_order_id
                   and jsonb_array_length(sections) > 0) into v_has_doc;
  select exists (select 1 from public.review_findings
                 where order_id = p_order_id) into v_has_findings;
  if not v_has_doc and not v_has_findings then
    raise exception 'empty_review' using errcode = 'P0001';
  end if;
  update public.review_documents
     set status = 'delivered', updated_at = now()
   where order_id = p_order_id;
  update public.review_orders
     set status = 'delivered', delivered_at = now(), updated_at = now()
   where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Completion and cancellation
-- ---------------------------------------------------------------------------
create or replace function public.complete_review_order(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'delivered' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'completed', completed_at = now(), updated_at = now()
   where id = p_order_id;
end;
$$;

-- Quiet students shouldn't hold a payout forever: any party's page load
-- sweeps deliveries older than seven days into completed.
create or replace function public.sweep_review_orders()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.review_orders
     set status = 'completed', completed_at = now(), updated_at = now()
   where status = 'delivered'
     and delivered_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Student exits: any time before the coach accepts; after acceptance only
-- once the coach's own promise is more than seven days stale. No penalty,
-- no clock we impose — just no trap.
create or replace function public.cancel_review_order(p_order_id uuid,
                                                      p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status in ('awaiting_payment', 'awaiting_submission', 'submitted')
  then
    null;  -- always cancellable before the coach commits
  elsif v_o.status in ('in_review', 'clarification')
        and v_o.promised_by is not null
        and now() > v_o.promised_by + interval '7 days' then
    null;  -- materially overdue
  else
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'cancelled',
         cancel_reason = 'student: '
           || coalesce(nullif(btrim(p_reason), ''), 'cancelled'),
         cancelled_at = now(),
         updated_at = now()
   where id = p_order_id;
end;
$$;

create or replace function public.coach_cancel_review_order(p_order_id uuid,
                                                            p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_o public.review_orders%rowtype;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.coach_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status not in ('awaiting_submission', 'submitted', 'in_review',
                        'clarification', 'delivered') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  update public.review_orders
     set status = 'cancelled',
         cancel_reason = 'coach: '
           || coalesce(nullif(btrim(p_reason), ''), 'cancelled'),
         cancelled_at = now(),
         updated_at = now()
   where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Follow-up rounds after delivery. Student sends are counted against the
-- snapshot; coach replies are uncounted.
-- ---------------------------------------------------------------------------
create or replace function public.add_review_followup(p_order_id uuid,
                                                      p_body text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_o    public.review_orders%rowtype;
  v_used integer;
begin
  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or (v_o.student_id <> v_me and v_o.coach_id <> v_me) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'delivered' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'empty_message' using errcode = '23514';
  end if;
  if v_me = v_o.student_id then
    select count(*) into v_used from public.review_messages
     where order_id = p_order_id and kind = 'followup'
       and author_id = v_o.student_id;
    if v_used >= v_o.followup_rounds then
      raise exception 'followups_used' using errcode = 'P0001';
    end if;
  end if;
  insert into public.review_messages (order_id, author_id, kind, body)
  values (p_order_id, v_me, 'followup', btrim(p_body));

  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  select case when v_me = v_o.student_id
              then v_o.coach_id else v_o.student_id end,
         'followup_received', v_o.match_id, v_me,
         case when v_me = v_o.student_id
              then 'A question about your review'
              else 'Your coach replied' end,
         left(btrim(p_body), 140),
         case when v_me = v_o.student_id
              then '/coaching/orders/' || p_order_id::text
              else '/orders/' || p_order_id::text end;
end;
$$;

revoke all on function
    public.accept_review_order(uuid),
    public.decline_review_order(uuid, text),
    public.request_review_clarification(uuid, text),
    public.reply_review_clarification(uuid, text),
    public.save_review_document(uuid, jsonb),
    public.deliver_review(uuid),
    public.complete_review_order(uuid),
    public.sweep_review_orders(),
    public.cancel_review_order(uuid, text),
    public.coach_cancel_review_order(uuid, text),
    public.add_review_followup(uuid, text)
  from public, anon;
grant execute on function
    public.accept_review_order(uuid),
    public.decline_review_order(uuid, text),
    public.request_review_clarification(uuid, text),
    public.reply_review_clarification(uuid, text),
    public.save_review_document(uuid, jsonb),
    public.deliver_review(uuid),
    public.complete_review_order(uuid),
    public.sweep_review_orders(),
    public.cancel_review_order(uuid, text),
    public.coach_cancel_review_order(uuid, text),
    public.add_review_followup(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The bell. One trigger sees every status change — whether it came from an
-- RPC, the webhook (service role), or the sweep — and tells the right party
-- in plain language.
-- ---------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'note', 'match_ready', 'match_failed',
    'reel_ready', 'reel_failed', 'coach_joined',
    'upload_failed',
    'order_paid', 'order_submitted', 'order_accepted', 'order_declined',
    'clarification_requested', 'review_delivered', 'followup_received',
    'order_completed', 'order_refunded'));

create or replace function public.review_orders_notify()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_student text;
  v_coach   text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select coalesce(nullif(btrim(public._display_name(u.*)), ''), 'A player')
    into v_student from auth.users u where u.id = new.student_id;
  select coalesce(nullif(btrim(public._display_name(u.*)), ''), 'Your coach')
    into v_coach from auth.users u where u.id = new.coach_id;

  if new.status = 'awaiting_submission' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_paid', new.match_id, new.student_id,
            v_student || ' bought a review',
            'The order is waiting on their match.',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'submitted' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_submitted', new.match_id, new.student_id,
            v_student || ' submitted their match',
            'Ready when you are.',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'in_review' and old.status = 'submitted' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'order_accepted', new.match_id, new.coach_id,
            v_coach || ' started your review', '',
            '/orders/' || new.id::text);

  elsif new.status = 'in_review' and old.status = 'clarification' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'followup_received', new.match_id, new.student_id,
            v_student || ' answered your question', '',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'clarification' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'clarification_requested', new.match_id,
            new.coach_id,
            v_coach || ' has a question',
            'They need an answer before they can finish.',
            '/orders/' || new.id::text);

  elsif new.status = 'delivered' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'review_delivered', new.match_id, new.coach_id,
            'Your review is ready', '',
            '/orders/' || new.id::text);

  elsif new.status = 'declined' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'order_declined', new.match_id, new.coach_id,
            v_coach || ' declined this order',
            'You get a full refund.',
            '/orders/' || new.id::text);

  elsif new.status = 'completed' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_completed', new.match_id, new.student_id,
            'Review complete', 'Your payout is on the way.',
            '/coaching/orders/' || new.id::text);

  elsif new.status = 'cancelled' then
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.student_id, 'order_refunded', new.match_id, null,
            'Order cancelled', 'You get a full refund.',
            '/orders/' || new.id::text);
    insert into public.notifications
      (user_id, kind, match_id, actor_id, title, body, href)
    values (new.coach_id, 'order_refunded', new.match_id, null,
            'Order cancelled', '',
            '/coaching/orders/' || new.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists review_orders_notify on public.review_orders;
create trigger review_orders_notify
  after update of status on public.review_orders
  for each row execute function public.review_orders_notify();

-- ---------------------------------------------------------------------------
-- Read shapes. Cross-user names live behind DEFINER functions, like
-- player_coach_links / coach_players before them.
-- ---------------------------------------------------------------------------
create or replace function public.coach_queue()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'offering_title', off.title,
    'student_name', coalesce(nullif(btrim(public._display_name(u.*)), ''),
                             'A player'),
    'price_cents', o.price_cents,
    'coach_share_cents', o.coach_share_cents,
    'match_id', o.match_id,
    'promised_by', o.promised_by,
    'created_at', o.created_at,
    'submitted_at', o.submitted_at,
    'delivered_at', o.delivered_at
  ) order by o.created_at desc), '[]'::jsonb)
  from public.review_orders o
  join public.offerings off on off.id = o.offering_id
  join auth.users u on u.id = o.student_id
  where o.coach_id = auth.uid();
$$;

create or replace function public.student_review_orders()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'offering_title', off.title,
    'coach_name', coalesce(nullif(btrim(public._display_name(u.*)), ''),
                           'Your coach'),
    'price_cents', o.price_cents,
    'match_id', o.match_id,
    'promised_by', o.promised_by,
    'created_at', o.created_at,
    'delivered_at', o.delivered_at
  ) order by o.created_at desc), '[]'::jsonb)
  from public.review_orders o
  join public.offerings off on off.id = o.offering_id
  join auth.users u on u.id = o.coach_id
  where o.student_id = auth.uid();
$$;

create or replace function public.review_order_detail(p_order_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'offering_title', off.title,
    'offering_description', off.description,
    'includes', to_jsonb(off.includes),
    'coach_id', o.coach_id,
    'student_id', o.student_id,
    'coach_name', coalesce(nullif(btrim(public._display_name(cu.*)), ''),
                           'Your coach'),
    'coach_handle', cp.handle,
    'student_name', coalesce(nullif(btrim(public._display_name(su.*)), ''),
                             'A player'),
    'match_id', o.match_id,
    'price_cents', o.price_cents,
    'fee_cents', o.fee_cents,
    'coach_share_cents', o.coach_share_cents,
    'turnaround_days', o.turnaround_days,
    'followup_rounds', o.followup_rounds,
    'intake_questions', o.intake_questions,
    'intake_answers', o.intake_answers,
    'review_sections', o.review_sections,
    'promised_by', o.promised_by,
    'decline_message', o.decline_message,
    'paid_at', o.paid_at,
    'submitted_at', o.submitted_at,
    'accepted_at', o.accepted_at,
    'delivered_at', o.delivered_at,
    'completed_at', o.completed_at,
    'cancelled_at', o.cancelled_at,
    'created_at', o.created_at
  )
  from public.review_orders o
  join public.offerings off on off.id = o.offering_id
  join auth.users cu on cu.id = o.coach_id
  join auth.users su on su.id = o.student_id
  left join public.coach_profiles cp on cp.user_id = o.coach_id
  where o.id = p_order_id
    and (o.student_id = auth.uid() or o.coach_id = auth.uid()
         or public.is_admin());
$$;

create or replace function public.coach_review_stats()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active_count', count(*) filter (where status in
      ('awaiting_submission', 'submitted', 'in_review',
       'clarification', 'delivered')),
    'completed_count', count(*) filter (where status = 'completed'),
    'earned_cents', coalesce(sum(coach_share_cents)
      filter (where status = 'completed'), 0)
  )
  from public.review_orders
  where coach_id = auth.uid();
$$;

revoke all on function public.coach_queue(),
              public.student_review_orders(),
              public.review_order_detail(uuid),
              public.coach_review_stats()
  from public, anon;
grant execute on function public.coach_queue(),
                 public.student_review_orders(),
                 public.review_order_detail(uuid),
                 public.coach_review_stats()
  to authenticated;
