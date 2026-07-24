-- 029: Feedback screenshot attachments (private to admin + author only).
-- Applied via direct Postgres connection (Keychain ponglens-db-url); keep in
-- sync with the Supabase project.
--
--  * feedback_items.attachments — jsonb array of {key, w?, h?} R2 object keys
--    (bucket ponglens-media, prefix feedback/<user_id>/...). Screenshots can
--    contain personal info, so keys are NEVER exposed on the public board:
--    feedback_board() returns them only to the item's author or the admin,
--    and the /api/feedback/image signing endpoint (gated by
--    feedback_can_view_attachment) is the only way to fetch the bytes.

alter table public.feedback_items
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.feedback_items.attachments is
  'Private screenshot attachments: jsonb array of {key, w?, h?} R2 object '
  'keys under ponglens-media feedback/<user_id>/. Visible only to the item '
  'author and the admin (via feedback_board() gating and the '
  '/api/feedback/image signing endpoint). Never surfaced on the public board.';

-- ---------------------------------------------------------------------------
-- Authorization gate for the image-signing endpoint. Returns true only when
-- the caller is the admin, or the key lives under the caller's own upload
-- prefix AND is referenced by one of the caller's feedback items. The prefix
-- check prevents a user from referencing someone else's upload key in their
-- own item to have it signed.
-- ---------------------------------------------------------------------------
create or replace function public.feedback_can_view_attachment(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or (
      p_key like 'feedback/' || (select auth.uid())::text || '/%'
      and exists (
        select 1 from public.feedback_items i
        where i.user_id = (select auth.uid())
          and i.attachments @> jsonb_build_array(
                jsonb_build_object('key', p_key))
      )
    );
$$;

revoke execute on function public.feedback_can_view_attachment(text)
  from public, anon;
grant execute on function public.feedback_can_view_attachment(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- feedback_board(sort) — re-created to also return attachments, but ONLY for
-- the item's author or the admin. Everyone else gets '[]'::jsonb, so a
-- private screenshot never leaks (not even its existence) to other users.
-- ---------------------------------------------------------------------------
-- Return type changes (adds attachments), so the old signature must be
-- dropped before the new one is created.
drop function if exists public.feedback_board(text);

create or replace function public.feedback_board(p_sort text default 'top')
returns table (
  id            uuid,
  user_id       uuid,
  title         text,
  body          text,
  type          text,
  status        text,
  qa            jsonb,
  vote_count    int,
  created_at    timestamptz,
  author_name   text,
  author_avatar text,
  voted         boolean,
  attachments   jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
  select
    i.id, i.user_id, i.title, i.body, i.type, i.status, i.qa,
    i.vote_count, i.created_at,
    split_part(coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      split_part(u.email::text, '@', 1),
      'Player'), ' ', 1) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    exists (select 1 from public.feedback_votes v
            where v.item_id = i.id and v.user_id = auth.uid()) as voted,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.attachments else '[]'::jsonb end as attachments
  from public.feedback_items i
  join auth.users u on u.id = i.user_id
  where i.visibility = 'board'
  order by
    case when p_sort = 'top' then i.vote_count end desc,
    i.created_at desc
  limit 200;
end;
$$;

revoke execute on function public.feedback_board(text) from public, anon;
grant execute on function public.feedback_board(text) to authenticated;
