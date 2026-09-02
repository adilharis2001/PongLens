-- 154 — the admin's own correction of a detected ball event.
--
-- The card view draws every bounce the detector saw, and sometimes what it
-- calls a bounce is really the ball coming off a racket. The verdict lives
-- only in the footage, so the person watching it is the instrument: one tap
-- files what the event actually was, and the rows become training data —
-- (video, time, position, detector's call, human's call) is exactly the
-- shape a classifier trains on.
--
-- Vocabulary is deliberately the pipeline's own. `table_bounce` and
-- `paddle_contact` are the exact strings placement candidates carry in
-- `kinds`, and the two research labeling pages use the same split as
-- table/paddle. Bare "contact" is avoided on purpose: points_v2 uses it
-- for any touch, placement for a racket touch, and the serve rule for the
-- bat moment — three meanings, one word. `net` exists because a net touch
-- is a ball event that is neither of the others, and filing it under
-- either poisons the training rows. `not_ball` is the neighbouring-table
-- and room-noise class.
--
-- Keyed by (match_id, t): the published artifact's events carry no id, and
-- their source-clock time (rounded to 2dp on the way out) is the join key
-- every surface already uses. Placement's own dedupe guarantees distinct
-- events are further apart than the rounding.
--
-- The detector's call is stored BESIDE the human's, never merged into it,
-- and nothing pre-fills the human column from the detector — the fused
-- labeling page's rule, kept for the same reason: detector semantics must
-- never silently become truth.
--
-- Same access shape as 150: RLS enabled with no policies, so the
-- SECURITY DEFINER functions below are the only way in, and every one
-- re-checks is_admin().

create table if not exists public.admin_event_labels (
  match_id    uuid not null references public.matches (id) on delete cascade,
  -- SOURCE seconds, as the artifact publishes them (2dp).
  t           numeric(9,2) not null,
  -- The human's call.
  label       text not null check
                (label in ('table_bounce', 'paddle_contact', 'net', 'not_ball')),
  -- What the pipeline said, for the training join. Context, never truth.
  detected    text not null default 'bounce',
  on_surface  boolean,
  -- Fractions of the source frame, and metres on the table when projected.
  x           real,
  y           real,
  u           real,
  v           real,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (match_id, t)
);

alter table public.admin_event_labels enable row level security;
revoke all on public.admin_event_labels from anon, authenticated;

-- Upsert one call; a null label withdraws it. Idempotent by key, so a
-- double-tap or a retry cannot error or double-store.
create or replace function public.admin_event_label_set(
  p_match_id uuid,
  p_t numeric,
  p_label text,
  p_detected text default 'bounce',
  p_on_surface boolean default null,
  p_x real default null,
  p_y real default null,
  p_u real default null,
  p_v real default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_label is null then
    delete from public.admin_event_labels
     where match_id = p_match_id and t = p_t;
  else
    insert into public.admin_event_labels
      (match_id, t, label, detected, on_surface, x, y, u, v)
    values
      (p_match_id, p_t, p_label, coalesce(p_detected, 'bounce'),
       p_on_surface, p_x, p_y, p_u, p_v)
    on conflict (match_id, t) do update
      set label = excluded.label,
          detected = excluded.detected,
          on_surface = excluded.on_surface,
          x = excluded.x, y = excluded.y,
          u = excluded.u, v = excluded.v,
          updated_at = now();
  end if;
end;
$$;

-- One match's labels for the page, or every match's for a training export.
create or replace function public.admin_event_labels(
  p_match_id uuid default null)
returns table (
  match_id      uuid,
  t             numeric,
  label         text,
  detected      text,
  on_surface    boolean,
  x             real,
  y             real,
  u             real,
  v             real,
  updated_at    timestamptz,
  opponent_name text,
  played_at     timestamptz
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
  select l.match_id, l.t, l.label, l.detected, l.on_surface,
         l.x, l.y, l.u, l.v, l.updated_at,
         m.opponent_name, m.played_at
    from public.admin_event_labels l
    join public.matches m on m.id = l.match_id
   where p_match_id is null or l.match_id = p_match_id
   order by l.match_id, l.t;
end;
$$;

revoke execute on function public.admin_event_label_set(
  uuid, numeric, text, text, boolean, real, real, real, real)
  from public, anon;
revoke execute on function public.admin_event_labels(uuid) from public, anon;
grant execute on function public.admin_event_label_set(
  uuid, numeric, text, text, boolean, real, real, real, real)
  to authenticated;
grant execute on function public.admin_event_labels(uuid) to authenticated;

comment on table public.admin_event_labels is
  'Admin corrections of detected ball events (bounce vs paddle contact vs '
  'net vs not the ball), keyed by match and source time. Training data; '
  'nothing in the pipeline reads it back yet.';
