-- 150 — the admin's own notes and themes on individual cards.
--
-- Reviewing two thousand cards across thirty-six matches only pays if what
-- you notice on card 40 is still there when you reach card 900, and if the
-- same observation on eleven different matches can be pulled together into
-- one list. That is what these three tables are for.
--
-- Deliberately SEPARATE from tags/point_tags and from notes. Those are the
-- PLAYER's vocabulary on their own match, written by them and shown to
-- them and to their coach. These are the operator's, they span every
-- account, and they must never appear in anyone's match page. Reusing the
-- player's tables would have put an internal note like "bounce detector
-- missed the second bounce" on a customer's point.
--
--  * admin_themes           — the vocabulary, shared, one row per theme
--  * admin_point_themes     — which cards carry which theme (many-to-many)
--  * admin_point_notes      — one free-text note per card
--
-- Every function re-checks is_admin(); RLS is enabled with no policy on
-- all three, so the SECURITY DEFINER functions are the only way in.

create table if not exists public.admin_themes (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: "First bounce missed" and "first bounce
-- missed" are the same theme, and a vocabulary that quietly holds both is
-- worse than no vocabulary — the grouping silently splits in two.
create unique index if not exists admin_themes_label_key
  on public.admin_themes (lower(label));

create table if not exists public.admin_point_themes (
  point_id   uuid not null references public.points (id) on delete cascade,
  theme_id   uuid not null references public.admin_themes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (point_id, theme_id)
);

create index if not exists admin_point_themes_theme_idx
  on public.admin_point_themes (theme_id);

create table if not exists public.admin_point_notes (
  point_id   uuid primary key references public.points (id) on delete cascade,
  body       text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_themes        enable row level security;
alter table public.admin_point_themes  enable row level security;
alter table public.admin_point_notes   enable row level security;

revoke all on public.admin_themes       from anon, authenticated;
revoke all on public.admin_point_themes from anon, authenticated;
revoke all on public.admin_point_notes  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The vocabulary
-- ---------------------------------------------------------------------------
create or replace function public.admin_themes_list()
returns table (id uuid, label text, points bigint, created_at timestamptz)
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
  select t.id, t.label,
         (select count(*) from public.admin_point_themes pt
           where pt.theme_id = t.id),
         t.created_at
  from public.admin_themes t
  order by 3 desc, t.label;
end;
$$;

-- Create-or-return, never fail. Two cards tagged at once with the same new
-- label is an ordinary race for one person on two tabs, and answering the
-- second one with a unique-violation would lose the tap.
create or replace function public.admin_theme_create(p_label text)
returns table (id uuid, label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := nullif(btrim(p_label), '');
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if v_label is null then
    raise exception 'a theme needs a label';
  end if;
  if length(v_label) > 60 then
    v_label := left(v_label, 60);
  end if;

  select t.id into v_id from public.admin_themes t
   where lower(t.label) = lower(v_label);
  if v_id is null then
    insert into public.admin_themes (label) values (v_label)
    on conflict (lower(label)) do nothing
    returning admin_themes.id into v_id;
  end if;
  if v_id is null then
    select t.id into v_id from public.admin_themes t
     where lower(t.label) = lower(v_label);
  end if;

  return query
  select t.id, t.label from public.admin_themes t where t.id = v_id;
end;
$$;

create or replace function public.admin_theme_rename(
  p_theme_id uuid, p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := nullif(btrim(p_label), '');
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if v_label is null then
    raise exception 'a theme needs a label';
  end if;
  update public.admin_themes set label = left(v_label, 60)
   where id = p_theme_id;
end;
$$;

-- Deleting a theme takes its assignments with it (cascade), which is the
-- intended meaning of "this theme was a bad idea".
create or replace function public.admin_theme_delete(p_theme_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.admin_themes where id = p_theme_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Applying it
-- ---------------------------------------------------------------------------
create or replace function public.admin_point_theme_set(
  p_point_id uuid, p_theme_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_on then
    insert into public.admin_point_themes (point_id, theme_id)
    values (p_point_id, p_theme_id)
    on conflict do nothing;
  else
    delete from public.admin_point_themes
     where point_id = p_point_id and theme_id = p_theme_id;
  end if;
end;
$$;

-- An empty body deletes the note rather than storing a blank one, so
-- "has a note" stays a question about the row existing.
create or replace function public.admin_point_note_set(
  p_point_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := nullif(btrim(p_body), '');
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if v_body is null then
    delete from public.admin_point_notes where point_id = p_point_id;
  else
    insert into public.admin_point_notes (point_id, body, updated_at)
    values (p_point_id, v_body, now())
    on conflict (point_id)
      do update set body = excluded.body, updated_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading it back across every match — the whole point of a shared
-- vocabulary. Returns enough to open each card without a second query.
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_notes(
  p_theme_id uuid default null)
returns table (
  point_id      uuid,
  match_id      uuid,
  opponent_name text,
  venue         text,
  played_at     timestamptz,
  idx           int,
  t0            numeric,
  t1            numeric,
  note          text,
  note_at       timestamptz,
  themes        text[]
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
  select p.id, m.id, m.opponent_name, m.venue, m.played_at, p.idx, p.t0, p.t1,
         n.body, n.updated_at,
         coalesce(array_agg(t.label order by t.label)
                    filter (where t.label is not null), '{}')
  from public.points p
  join public.matches m on m.id = p.match_id
  left join public.admin_point_notes n on n.point_id = p.id
  left join public.admin_point_themes pt on pt.point_id = p.id
  left join public.admin_themes t on t.id = pt.theme_id
  where (p_theme_id is null or exists (
          select 1 from public.admin_point_themes x
           where x.point_id = p.id and x.theme_id = p_theme_id))
    and (n.body is not null or pt.point_id is not null)
  group by p.id, m.id, m.opponent_name, m.venue, m.played_at, p.idx,
           p.t0, p.t1, n.body, n.updated_at
  order by m.played_at desc nulls last, p.t0;
end;
$$;

revoke execute on function public.admin_themes_list() from public, anon;
revoke execute on function public.admin_theme_create(text) from public, anon;
revoke execute on function public.admin_theme_rename(uuid, text) from public, anon;
revoke execute on function public.admin_theme_delete(uuid) from public, anon;
revoke execute on function public.admin_point_theme_set(uuid, uuid, boolean)
  from public, anon;
revoke execute on function public.admin_point_note_set(uuid, text)
  from public, anon;
revoke execute on function public.admin_review_notes(uuid) from public, anon;

grant execute on function public.admin_themes_list() to authenticated;
grant execute on function public.admin_theme_create(text) to authenticated;
grant execute on function public.admin_theme_rename(uuid, text) to authenticated;
grant execute on function public.admin_theme_delete(uuid) to authenticated;
grant execute on function public.admin_point_theme_set(uuid, uuid, boolean)
  to authenticated;
grant execute on function public.admin_point_note_set(uuid, text)
  to authenticated;
grant execute on function public.admin_review_notes(uuid) to authenticated;

comment on table public.admin_themes is
  'Operator vocabulary for reviewing cards across every account. Not the '
  'player''s tags: nothing here is ever shown on a match page.';
