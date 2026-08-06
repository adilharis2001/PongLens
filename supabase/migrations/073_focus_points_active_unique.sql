-- 073: one active "Working on" cue per label, enforced by the database.
--
-- The cap and the duplicate rule lived only in client checks, spread over
-- three writers (the journal card, lesson takeaways, Recollect's add).
-- Client checks race: two surfaces can each see "not a duplicate" and
-- both insert. The partial unique index makes the rule real; writers turn
-- a 23505 into their existing "dup" answer. Retired rows stay exempt —
-- a cue that crept back in gets a fresh row and the History keeps both.

create unique index focus_points_active_label_key
  on public.focus_points (user_id, lower(btrim(label)))
  where retired_at is null;

-- add_recollect_to_working_on inserts too; under the new index a race
-- now surfaces as a conflict instead of a second row. Handle it the way
-- the function already answers duplicates.
create or replace function public.add_recollect_to_working_on(
  p_owner_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.recollect_items%rowtype;
  v_focus public.focus_points%rowtype;
  v_active integer;
begin
  select * into v_item
  from public.recollect_items
  where id = p_item_id and user_id = p_owner_id and state = 'active'
  for update;
  if not found then
    raise exception 'reminder not found' using errcode = 'P0002';
  end if;

  if v_item.focus_point_id is not null and exists (
    select 1 from public.focus_points
    where id = v_item.focus_point_id and user_id = p_owner_id
      and retired_at is null
  ) then
    return jsonb_build_object('result', 'duplicate');
  end if;

  select * into v_focus
  from public.focus_points
  where user_id = p_owner_id
    and retired_at is null
    and lower(btrim(label)) = lower(btrim(v_item.cue))
  limit 1;
  if found then
    update public.recollect_items
    set focus_point_id = v_focus.id, updated_at = now()
    where id = v_item.id;
    return jsonb_build_object('result', 'duplicate', 'focus_point', to_jsonb(v_focus));
  end if;

  select count(*) into v_active
  from public.focus_points
  where user_id = p_owner_id and retired_at is null;
  if v_active >= 5 then
    return jsonb_build_object('result', 'full');
  end if;

  begin
    insert into public.focus_points (user_id, label)
    values (p_owner_id, left(v_item.cue, 120))
    returning * into v_focus;
  exception when unique_violation then
    select * into v_focus
    from public.focus_points
    where user_id = p_owner_id
      and retired_at is null
      and lower(btrim(label)) = lower(btrim(left(v_item.cue, 120)))
    limit 1;
    if found then
      update public.recollect_items
      set focus_point_id = v_focus.id, updated_at = now()
      where id = v_item.id;
      return jsonb_build_object(
        'result', 'duplicate', 'focus_point', to_jsonb(v_focus));
    end if;
    raise;
  end;
  update public.recollect_items
  set focus_point_id = v_focus.id, updated_at = now()
  where id = v_item.id;
  return jsonb_build_object('result', 'added', 'focus_point', to_jsonb(v_focus));
end;
$$;
