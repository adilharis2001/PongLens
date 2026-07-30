-- 058: Keep user-initiated Recollect re-enables on the current quality gate.
-- 057 was already deployed with recollect-v1 before the transcript-garbling
-- gate was tightened, so this forward-only patch updates the backfill version.

create or replace function public.set_recollect_enabled(
  p_owner_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_disabled boolean := false;
  v_queued integer := 0;
begin
  select not enabled into v_was_disabled
  from public.recollect_preferences
  where user_id = p_owner_id;
  v_was_disabled := coalesce(v_was_disabled, false);

  insert into public.recollect_preferences (user_id, enabled, updated_at)
  values (p_owner_id, p_enabled, now())
  on conflict (user_id) do update
  set enabled = excluded.enabled, updated_at = now();

  if not p_enabled then
    delete from public.recollect_jobs where user_id = p_owner_id;
    delete from public.recollect_items where user_id = p_owner_id;
    return jsonb_build_object('enabled', false, 'queued', 0);
  end if;

  if v_was_disabled then
    insert into public.recollect_jobs (
      user_id, lesson_id, content_hash, processor_version, first_due_at
    )
    select
      l.user_id,
      l.id,
      encode(
        extensions.digest(convert_to(l.transcript, 'UTF8'), 'sha256'),
        'hex'
      ),
      'recollect-v2',
      now() + interval '1 day'
    from public.lessons l
    where l.user_id = p_owner_id and l.kind in ('lesson', 'practice')
    on conflict (lesson_id, content_hash, processor_version) do nothing;
    get diagnostics v_queued = row_count;
  end if;

  return jsonb_build_object('enabled', true, 'queued', v_queued);
end;
$$;

revoke execute on function public.set_recollect_enabled(uuid, boolean)
  from public;
grant execute on function public.set_recollect_enabled(uuid, boolean)
  to service_role;
