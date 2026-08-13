-- 100: the marketing role.
--
-- /marketing is private the way /research is private: the owner, plus
-- whoever has been granted access by name. QA (092) already decided where
-- a role like this lives, so this rides on app_roles rather than inventing
-- a second table. The check constraint grows one value.
--
-- These three functions mirror is_qa()/admin_list_qa()/admin_set_qa() line
-- for line instead of generalising them into one role API. Two roles is
-- not enough to know what that API should look like, and rewriting the QA
-- call sites to find out would put test billing at risk for nothing. When
-- a third role arrives, generalise then.

alter table public.app_roles
  drop constraint app_roles_role_check;

alter table public.app_roles
  add constraint app_roles_role_check
  check (role in ('qa', 'marketing'));

-- ---------------------------------------------------------------------------
-- is_marketing() — the boundary the marketing pages ask about, and the one
-- any future marketing table's RLS policy should name.
-- ---------------------------------------------------------------------------
create or replace function public.is_marketing(p_user uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_roles
    where user_id = p_user and role = 'marketing'
  );
$$;

revoke all on function public.is_marketing(uuid) from public, anon;
grant execute on function public.is_marketing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Granting and listing, admin only. The email lookup needs auth.users, so
-- both are security definer with an is_admin() gate of their own.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_marketing()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', r.user_id,
      'email', u.email,
      'name', coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''), ''),
      'note', r.note,
      'created_at', r.created_at
    ) order by r.created_at)
    from public.app_roles r
    join auth.users u on u.id = r.user_id
    where r.role = 'marketing'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_marketing() from public, anon;
grant execute on function public.admin_list_marketing() to authenticated;

-- Add or remove the marketing role by email. The account must already
-- exist: this assigns a role, it never invites.
create or replace function public.admin_set_marketing(
  p_email text,
  p_enabled boolean,
  p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if p_enabled then
    insert into public.app_roles (user_id, role, note)
    values (v_user, 'marketing', nullif(trim(coalesce(p_note, '')), ''))
    on conflict (user_id, role) do nothing;
  else
    delete from public.app_roles where user_id = v_user and role = 'marketing';
  end if;

  return jsonb_build_object('user_id', v_user, 'enabled', p_enabled);
end;
$$;

revoke all on function public.admin_set_marketing(text, boolean, text)
  from public, anon;
grant execute on function public.admin_set_marketing(text, boolean, text)
  to authenticated;
