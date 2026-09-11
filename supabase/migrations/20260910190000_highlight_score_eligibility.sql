-- Highlights are generated only after an owner asks for them and enough of
-- the active match has been scored. This first migration is behavior-neutral:
-- it adds the shared calculation and separates feature availability from the
-- retired automatic-generation switch.

create or replace function public.highlight_generation_eligibility(p_match_id uuid)
returns table (
  scored_points integer,
  scorable_points integer,
  required_points integer,
  required_percent integer,
  eligible boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match_type text;
  v_scored integer := 0;
  v_scorable integer := 0;
begin
  select m.match_type
    into v_match_type
    from public.matches m
   where m.id = p_match_id;

  if not found or v_match_type in ('drills', 'practice') then
    return query select 0, 0, 0, 75, false;
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where p.confirmed_winner in ('user', 'opponent')
    )::integer
    into v_scorable, v_scored
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.match_id = p_match_id
     and p.processing_version_id = m.active_processing_version_id
     and not p.deleted
     and not p.is_let;

  return query
  select
    v_scored,
    v_scorable,
    (v_scorable * 3 + 3) / 4,
    75,
    v_scorable > 0 and v_scored * 4 >= v_scorable * 3;
end;
$$;

revoke all on function public.highlight_generation_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.highlight_generation_eligibility(uuid)
  to service_role;

-- Preserve the current global/canary audience without turning highlights on
-- for anybody new. The old key remains temporarily for rollback compatibility.
insert into public.app_config (key, value)
values (
  'highlights_enabled',
  coalesce(
    (select value from public.app_config where key = 'automatic_highlights'),
    'off'
  )
)
on conflict (key) do nothing;

