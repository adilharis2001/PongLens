-- Keep replacement processing in a deliberate QA rollout until the complete
-- object-storage, encoding and device lifecycle has passed staging. Ordinary
-- cut reports and exact-minute requests remain available to every eligible
-- match owner.
insert into public.app_config (key, value)
values ('match_reprocessing_enabled', 'false')
on conflict (key) do nothing;

create or replace function public.match_reprocessing_enabled(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select value = 'true'
      from public.app_config
      where key = 'match_reprocessing_enabled'
    ), false)
    or public.is_admin()
    or coalesce(auth.role(), '') = 'service_role';
$$;
revoke all on function public.match_reprocessing_enabled(uuid)
  from public, anon, authenticated;

-- Eligibility is part of the same server response as the rest of the match
-- issue state. Refuse to silently patch a differently-shaped function on a
-- database whose migration history has drifted.
do $$
declare
  definition text;
  needle text := $needle$'canReprocess', v_is_owner and v_match.status = 'ready' and public.match_reprocess_source(p_match_id) is not null$needle$;
  replacement text := $replacement$'canReprocess', v_is_owner and v_match.status = 'ready' and public.match_reprocess_source(p_match_id) is not null and public.match_reprocessing_enabled(v_match.user_id)$replacement$;
  v_matches integer;
begin
  definition := pg_get_functiondef('public.match_issue_state(uuid)'::regprocedure);
  v_matches := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  if v_matches <> 1 then
    raise exception 'unexpected match issue state definition';
  end if;
  definition := replace(definition, needle, replacement);
  if position(replacement in definition) = 0 then
    raise exception 'match issue rollout gate was not installed';
  end if;
  execute definition;
end $$;

create or replace function public.guard_match_reprocess_issue_rollout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'reprocess'
    and not public.match_reprocessing_enabled(new.owner_id) then
    raise exception 'match reprocessing is not enabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger issue_guard_reprocess_rollout
before insert on public.match_processing_feedback
for each row execute function public.guard_match_reprocess_issue_rollout();

create or replace function public.guard_match_reprocess_job_rollout()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (new.kind = 'match_reprocess'
    or (tg_op='UPDATE' and old.kind='match_reprocess'))
    and not public.match_reprocessing_enabled(new.user_id) then
    -- The Mac worker uses a direct database connection, without a JWT. An
    -- already-approved QA job still has to report progress and finish while
    -- owner submission is disabled. Do not make this function SECURITY
    -- DEFINER: that would make every caller appear to be the table owner.
    if tg_op='UPDATE'
      and coalesce(auth.role(),'')=''
      and (current_user='service_role' or current_user=(
        select pg_get_userbyid(relowner) from pg_class where oid='public.jobs'::regclass
      ))
      and old.kind='match_reprocess' and old.status in ('queued','processing')
      and (to_jsonb(new)-array['status','progress','result_path','error','user_message','updated_at'])
        = (to_jsonb(old)-array['status','progress','result_path','error','user_message','updated_at'])
      and exists (
        select 1 from public.match_processing_feedback i
        join public.match_processing_versions v on v.id=i.replacement_version_id
        join public.matches m on m.id=i.match_id
        where i.replacement_job_id=old.id and v.job_id=old.id
          and v.issue_id=i.id and v.match_id=m.id and m.user_id=old.user_id and i.owner_id=old.user_id
          and v.source_version_id=i.source_version_id and m.active_processing_version_id=v.source_version_id
          and v.id::text=old.options->>'processing_version_id'
          and i.id::text=old.options->>'issue_id' and m.id::text=old.options->>'match_id'
          and v.status in ('candidate','ready','failed')
          and i.status in ('reprocess_queued','reprocessing','candidate_ready','execution_failed')
      ) then
      return new;
    end if;
    raise exception 'match reprocessing is not enabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger jobs_guard_reprocess_rollout
before insert or update on public.jobs
for each row execute function public.guard_match_reprocess_job_rollout();

revoke all on function public.guard_match_reprocess_issue_rollout(),
  public.guard_match_reprocess_job_rollout()
  from public, anon, authenticated;
