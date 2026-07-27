-- 035: research privilege hardening + one-click reviewer assignment.

revoke all on public.research_batches from public;
revoke all on public.research_reviewers from public;
revoke all on public.research_sources from public;
revoke all on public.research_assignments from public;
revoke all on public.research_gold_labels from public;

create or replace function public.research_assign_batch(
  p_email text,
  p_batch_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_inserted int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if not exists (
    select 1 from public.research_batches where id = p_batch_id
  ) then
    raise exception 'batch not found';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;
  if v_user_id is null then
    raise exception 'reviewer must sign in to Pong Lens once before assignment';
  end if;

  insert into public.research_reviewers (user_id, role, active, added_by)
  values (v_user_id, 'reviewer', true, auth.uid())
  on conflict (user_id) do update
    set active = true, added_by = auth.uid(), updated_at = now();

  with template as (
    select distinct on (a.sequence)
      a.source_id,
      a.sequence,
      a.duplicate_group,
      a.is_repeat
    from public.research_assignments a
    where a.batch_id = p_batch_id
    order by a.sequence, a.created_at, a.id
  ),
  inserted as (
    insert into public.research_assignments (
      batch_id,
      source_id,
      reviewer_id,
      sequence,
      duplicate_group,
      is_repeat
    )
    select
      p_batch_id,
      t.source_id,
      v_user_id,
      t.sequence,
      t.duplicate_group,
      t.is_repeat
    from template t
    on conflict (batch_id, reviewer_id, sequence) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke execute on function public.research_assign_batch(text, uuid)
  from public, anon;
grant execute on function public.research_assign_batch(text, uuid)
  to authenticated;
