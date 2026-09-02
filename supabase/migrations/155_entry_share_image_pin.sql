-- 155: pin a shared entry's photo to its author's folder before signing.
--
-- resolve_share_entry (154) handed image_path to the share media route,
-- which checked only that the key sat under entry/. But image_path is a
-- client-writable column on a row the author owns — the grants are
-- table-wide and RLS scopes rows, not values — so a signed-in user could
-- point their OWN entry at another player's photo key and read it through
-- their own share link. The pin belongs here, where the author's id is
-- already beside the path: a path outside the author's own folder, or one
-- carrying a '..' segment, now resolves as no photo at all. The media
-- route keeps its own bucket/prefix/traversal checks as a second layer.
--
-- Same signature and return type, so CREATE OR REPLACE keeps the grants;
-- they are re-issued below anyway.

create or replace function public.resolve_share_entry(p_token text)
returns table (
  title text,
  entry_kind text,
  coach_name text,
  transcript text,
  takeaways jsonb,
  image_path text,
  owner_name text,
  entry_created_at timestamptz
)
language sql
stable security definer
set search_path = public
as $$
  select
    sl.title,
    l.kind as entry_kind,
    l.coach_name,
    l.transcript,
    l.takeaways,
    case
      when l.image_path like
             'r2://ponglens-media/entry/' || l.user_id || '/%'
        and position('..' in l.image_path) = 0
      then l.image_path
    end as image_path,
    (select nullif(btrim(coalesce(
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'name',
       '')), '')
     from auth.users u where u.id = l.user_id) as owner_name,
    l.created_at as entry_created_at
  from public.share_links sl
  join public.lessons l on l.id = sl.lesson_id
  where sl.token = p_token
    and sl.kind = 'entry'
    and sl.revoked_at is null;
$$;

revoke execute on function public.resolve_share_entry(text) from public;
grant execute on function public.resolve_share_entry(text)
  to anon, authenticated;
