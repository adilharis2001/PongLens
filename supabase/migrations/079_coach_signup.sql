-- 079: self-serve coach signup.
--
-- The /coaches landing page promises "Set up your page", but a coach who
-- arrives cold — no player invite, no code — hits the early-access wall.
-- Fix: creating a coach page becomes its own way through the gate, the
-- same way accepting a player's invite is (043). One RPC does both the
-- profile insert and the access grant so the client can't get one
-- without the other.

alter table public.app_access
  drop constraint if exists app_access_source_check;
alter table public.app_access
  add constraint app_access_source_check
    check (source in (
      'founder', 'invite', 'coach', 'admin', 'order', 'coach_signup'
    ));

create or replace function public.create_coach_page(
  p_handle text,
  p_display_name text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- coach_profiles' own constraints validate: handle format and name
  -- length raise 23514, a taken handle raises 23505. The client maps
  -- those; nothing to re-check here.
  insert into public.coach_profiles (user_id, handle, display_name)
  values (v_me, lower(trim(p_handle)), left(trim(p_display_name), 80));

  -- No-op for anyone already in (existing users creating a page from
  -- the Coaching tab hit the conflict and move on).
  insert into public.app_access (user_id, source)
  values (v_me, 'coach_signup')
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.create_coach_page(text, text) from public, anon;
grant execute on function public.create_coach_page(text, text) to authenticated;
