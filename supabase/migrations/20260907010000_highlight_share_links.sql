-- Public links to the current automatic highlight reel.
--
-- The two replaced constraints below match production's live definitions
-- inspected on 2026-09-07; this migration only adds the highlights leg.

alter table public.share_links
  drop constraint share_links_kind_check;
alter table public.share_links
  add constraint share_links_kind_check
  check (kind in ('point', 'match', 'starred', 'tag', 'entry', 'highlights'));

alter table public.share_links
  drop constraint share_links_check;
alter table public.share_links
  add constraint share_links_check
  check (
    (kind = 'point'
      and match_id is not null and point_id is not null
      and tag_id is null and lesson_id is null)
    or (kind in ('match', 'starred', 'highlights')
      and match_id is not null and point_id is null
      and tag_id is null and lesson_id is null)
    or (kind = 'tag'
      and match_id is not null and point_id is null
      and tag_id is not null and lesson_id is null)
    or (kind = 'entry'
      and lesson_id is not null and match_id is null
      and point_id is null and tag_id is null)
  );

create unique index if not exists share_links_active_highlights_uniq
  on public.share_links (match_id)
  where (kind = 'highlights' and revoked_at is null);

create or replace function public.resolve_share_highlights(p_token text)
returns table (match_id uuid, r2_key text)
language sql
stable security definer
set search_path = public
as $$
  select sl.match_id, mr.r2_key
  from public.share_links sl
  join public.match_reels mr
    on mr.match_id = sl.match_id and mr.scope = 'highlights'
  where sl.token = p_token
    and sl.kind = 'highlights'
    and sl.revoked_at is null
    and mr.r2_key is not null;
$$;

revoke execute on function public.resolve_share_highlights(text) from public;
grant execute on function public.resolve_share_highlights(text)
  to anon, authenticated;
