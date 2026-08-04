-- 071: the players portal can play a match's ORIGINAL upload.
--
-- Grading the dead-space cut needs the uncut source next to the cut —
-- what got removed is only visible in the raw. Same shape as
-- admin_match_cut_path (068): the source job's input_path, is_admin()
-- re-checked inside. The raw bucket keeps objects 30 days, so the media
-- route HEAD-checks before signing and says "expired" instead of
-- handing out a dead link.

create or replace function public.admin_match_raw_path(p_match_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select j.input_path into v_path
  from public.matches m
  join public.jobs j on j.id = m.job_id
  where m.id = p_match_id;
  return v_path;
end;
$$;

revoke execute on function public.admin_match_raw_path(uuid) from public, anon;
grant execute on function public.admin_match_raw_path(uuid) to authenticated;
