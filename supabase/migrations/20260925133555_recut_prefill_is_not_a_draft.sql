-- Opening "Mark the points yourself" on a processed match and closing it
-- again must not leave "3 marked" / "Keep marking" behind.
--
-- start_recut writes the current cut's points into hand_cut_drafts as the
-- marks the marker opens on. Both apps read an unsent draft as work in
-- progress, so a player who only looked came back to a count of marks they
-- never made (web QA, 2026-09-25, match 5e432cde).
--
-- The draft now says whether it is still that untouched prefill. start_recut
-- sets `prefilled`; any later save whose marks differ from what was there
-- clears it, whichever app or build made the save (the trigger, not the
-- client, decides, so build 238 behaves too). A prefill the player never
-- touched is also refreshed from the points on the next open, so a score
-- changed on the match page in between is not lost.
--
-- Additive: one column with a default, one trigger, one replaced function.
-- Rollback: drop the trigger and function, then re-apply start_recut from
-- 20260925124616_cut_again.sql. The column can stay.

alter table public.hand_cut_drafts
  add column if not exists prefilled boolean not null default false;

-- The marks compared by what they mean, not how they are spelled: start and
-- end to the centisecond, the answer and the skip, in start order. Reads
-- both stored shapes (full marks, and the short submittable form with
-- w/let). Anything unreadable compares as itself, so an odd entry counts as
-- a change rather than hiding one.
create or replace function public._marks_signature(p_marks jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' then
    return coalesce(p_marks, 'null'::jsonb);
  end if;
  begin
    select coalesce(jsonb_agg(sig order by t0, ord), '[]'::jsonb)
      into v_out
      from (
        select x.ord,
               round((x.e->>'t0')::numeric, 2) as t0,
               jsonb_build_array(
                 round((x.e->>'t0')::numeric, 2),
                 round((x.e->>'t1')::numeric, 2),
                 coalesce(x.e->>'winner', x.e->>'w'),
                 coalesce((x.e->>'isLet')::boolean, (x.e->>'let')::boolean, false)
               ) as sig
          from jsonb_array_elements(p_marks) with ordinality as x(e, ord)
      ) s;
    return v_out;
  exception when others then
    return p_marks;
  end;
end;
$$;

revoke all on function public._marks_signature(jsonb) from public, anon, authenticated;

create or replace function public._hand_cut_draft_prefill_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- start_recut announces its own write for the length of its transaction.
  if coalesce(current_setting('ponglens.recut_prefill', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.prefilled := false;
  elsif old.prefilled
        and public._marks_signature(new.marks)
            is distinct from public._marks_signature(old.marks) then
    new.prefilled := false;
  elsif new.submitted_at is not null then
    new.prefilled := false;
  else
    new.prefilled := old.prefilled;
  end if;
  return new;
end;
$$;

revoke all on function public._hand_cut_draft_prefill_guard() from public, anon, authenticated;

drop trigger if exists hand_cut_draft_prefill_guard on public.hand_cut_drafts;
create trigger hand_cut_draft_prefill_guard
  before insert or update on public.hand_cut_drafts
  for each row execute function public._hand_cut_draft_prefill_guard();

-- Pulled from production with pg_get_functiondef on 2026-09-25 (identical
-- to 20260925124616_cut_again.sql); changed only where marked.
create or replace function public.start_recut(p_match_id uuid,
                                              p_fresh boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_match  public.matches%rowtype;
  v_reason text;
  v_draft  public.hand_cut_drafts%rowtype;
  v_marks  jsonb;
  v_mode   text;
  v_now    timestamptz := now();
  v_cut_since timestamptz;
  v_have   boolean;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.hand_cut_enabled(v_me) then
    raise exception 'not_enabled' using errcode = '42501';
  end if;
  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_reason := public._recut_reason(v_match);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  select greatest(v.created_at, v.completed_at, v.activated_at)
    into v_cut_since
    from public.match_processing_versions v
   where v.id = v_match.active_processing_version_id;

  select * into v_draft from public.hand_cut_drafts
   where match_id = p_match_id
     for update;
  v_have := found;
  -- Changed: an untouched prefill is not resumed; it is written again
  -- from the points below, keeping the pass the player chose.
  if v_have and v_draft.submitted_at is null and not coalesce(p_fresh, false)
     and not v_draft.prefilled
     and v_draft.updated_at >= coalesce(v_cut_since, '-infinity'::timestamptz) then
    return jsonb_build_object(
      'marks', v_draft.marks,
      'mode', coalesce(v_draft.mode, public._marks_mode(v_draft.marks)),
      'updated_at', v_draft.updated_at);
  end if;

  v_marks := public._recut_marks_from_points(v_match);
  v_mode := public._marks_mode(v_marks);
  -- Changed: a refreshed prefill keeps a pass the player switched to.
  if v_have and v_draft.submitted_at is null and v_draft.prefilled
     and not coalesce(p_fresh, false)
     and v_draft.mode in ('cut', 'score') then
    v_mode := v_draft.mode;
  end if;
  -- Changed: the write is marked as the prefill.
  perform set_config('ponglens.recut_prefill', 'on', true);
  insert into public.hand_cut_drafts
    (match_id, user_id, marks, mode, updated_at, submitted_at, prefilled)
  values (p_match_id, v_me, v_marks, v_mode, v_now, null, true)
  on conflict (match_id) do update
    set marks = excluded.marks,
        mode = excluded.mode,
        updated_at = excluded.updated_at,
        submitted_at = null,
        prefilled = true;
  perform set_config('ponglens.recut_prefill', '', true);
  return jsonb_build_object('marks', v_marks, 'mode', v_mode,
                            'updated_at', v_now);
end;
$$;

revoke all on function public.start_recut(uuid, boolean) from public, anon;
grant execute on function public.start_recut(uuid, boolean) to authenticated;
