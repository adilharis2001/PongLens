-- The rollout switch is also the emergency rollback switch. Admin status must
-- not bypass it: PongLens currently has one admin, so an admin bypass would
-- leave the canary account on canonical writes after operators set `off`.
create or replace function public.canonical_score_commands_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and exists (
    select 1
      from public.app_config c
     where c.key = 'canonical_score_commands'
       and (
         c.value = 'on'
         or c.value = 'user:' || (select auth.uid())::text
         or (
           c.value like 'users:%'
           and (select auth.uid())::text = any(string_to_array(
             replace(substr(c.value, 7), ' ', ''), ','
           ))
         )
       )
  );
$$;

revoke all on function public.canonical_score_commands_enabled()
  from public, anon, authenticated;
grant execute on function public.canonical_score_commands_enabled()
  to authenticated;

comment on function public.canonical_score_commands_enabled() is
  'Account-scoped command canary. off disables every account, including admins.';
