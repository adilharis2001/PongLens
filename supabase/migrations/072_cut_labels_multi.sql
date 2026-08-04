-- 072: cut labels go multi-select, plus the split-count verdicts.
--
-- Four new values: multi_2 / multi_3 / multi_4 (this clip holds that many
-- rallies — needs splitting) and half_point (the rally is itself split
-- across two clips — needs joining). Those co-occur with the edge
-- verdicts — a merged clip can ALSO open mid-serve — so one-label-per-
-- point becomes one-row-per-(point, label). Existing rows survive as-is.
--
-- admin_set_cut_label picks up an explicit p_selected instead of the old
-- null-to-clear: with multi-select, "clear" must say which label.

alter table public.cut_labels
  drop constraint if exists cut_labels_pkey;
alter table public.cut_labels
  add primary key (point_id, label);

alter table public.cut_labels
  drop constraint if exists cut_labels_label_check;
alter table public.cut_labels
  add constraint cut_labels_label_check check (label in
    ('start_cut', 'end_cut', 'both_cut',
     'warmup', 'dead_space', 'perfect',
     'multi_2', 'multi_3', 'multi_4', 'half_point'));

drop function if exists public.admin_set_cut_label(uuid, text);

create or replace function public.admin_set_cut_label(
  p_point_id uuid, p_label text, p_selected boolean)
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
  if not p_selected then
    delete from public.cut_labels
      where point_id = p_point_id and label = p_label;
    return;
  end if;
  select match_id into v_match from public.points where id = p_point_id;
  if v_match is null then
    raise exception 'no such point';
  end if;
  insert into public.cut_labels (point_id, match_id, label, labeled_by)
  values (p_point_id, v_match, p_label, auth.uid())
  on conflict (point_id, label) do update
    set labeled_by = excluded.labeled_by,
        updated_at = now();
end;
$$;

revoke execute on function public.admin_set_cut_label(uuid, text, boolean)
  from public, anon;
grant execute on function public.admin_set_cut_label(uuid, text, boolean)
  to authenticated;
