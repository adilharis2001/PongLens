-- 070: per-point cut-quality labels, from the admin players portal.
--
-- The dead-space rounds keep needing the same thing: a human saying what
-- the cut did to each point. Round 5b's serve/tail regression was caught
-- by eyeballs, not by the referee — these labels turn that eyeballing
-- into training and tuning data. One label per point, six values:
--
--   start_cut   the beginning of the point was cut off (serve missing)
--   end_cut     the ending was cut off (ball's dying flight missing)
--   both_cut    both edges clipped
--   warmup      not match play — warm-up rally
--   dead_space  the whole "point" is dead space (false positive)
--   perfect     the cut is right
--
-- RPC-only access, same shape as 068/069: RLS is enabled with no
-- policies, so the ONLY paths in are the SECURITY DEFINER functions that
-- re-check is_admin() inside.

create table public.cut_labels (
  point_id   uuid primary key references public.points (id) on delete cascade,
  match_id   uuid not null references public.matches (id) on delete cascade,
  label      text not null check (label in
               ('start_cut', 'end_cut', 'both_cut',
                'warmup', 'dead_space', 'perfect')),
  labeled_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index cut_labels_match_idx on public.cut_labels (match_id);
alter table public.cut_labels enable row level security;

create or replace function public.admin_set_cut_label(
  p_point_id uuid, p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_label is null then
    delete from public.cut_labels where point_id = p_point_id;
    return;
  end if;
  select match_id into v_match from public.points where id = p_point_id;
  if v_match is null then
    raise exception 'no such point';
  end if;
  insert into public.cut_labels (point_id, match_id, label, labeled_by)
  values (p_point_id, v_match, p_label, auth.uid())
  on conflict (point_id) do update
    set label = excluded.label,
        labeled_by = excluded.labeled_by,
        updated_at = now();
end;
$$;

create or replace function public.admin_cut_labels(p_match_id uuid)
returns table (point_id uuid, label text)
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
  select c.point_id, c.label from public.cut_labels c
  where c.match_id = p_match_id;
end;
$$;

revoke execute on function public.admin_set_cut_label(uuid, text)
  from public, anon;
revoke execute on function public.admin_cut_labels(uuid) from public, anon;
grant execute on function public.admin_set_cut_label(uuid, text)
  to authenticated;
grant execute on function public.admin_cut_labels(uuid) to authenticated;
