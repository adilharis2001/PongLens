-- 154: a journal entry can be shared as a public link (kind 'entry').
--
-- The Share button beside Delete on a journal entry card mints the same
-- kind of link a match gets: a token URL anyone can open, read-only,
-- resolved live (edits show, deletion kills it), revocable from Account.
--
-- share_links grows a lesson_id leg instead of getting a sibling table so
-- that every existing management surface — the Account list, "Revoke all",
-- the iOS list, the dashboard count — covers journal links with no second
-- code path. match_id loses its NOT NULL; the shape check below is what
-- now guarantees every row names exactly one target.
--
-- The check-constraint and policy bodies were written from prod's live
-- definitions (pg_get_constraintdef / pg_policies, 2026-09-02), not from
-- the last migration file — the live-drift rule.

alter table public.share_links
  add column if not exists lesson_id uuid
    references public.lessons (id) on delete cascade;

alter table public.share_links
  alter column match_id drop not null;

alter table public.share_links
  drop constraint share_links_kind_check;
alter table public.share_links
  add constraint share_links_kind_check
  check (kind in ('point', 'match', 'starred', 'tag', 'entry'));

-- Every row names exactly one target. The match kinds must still carry a
-- match (the column-level NOT NULL used to say this); an entry carries a
-- lesson and nothing else.
alter table public.share_links
  drop constraint share_links_check;
alter table public.share_links
  add constraint share_links_check
  check (
    (kind = 'point'
      and match_id is not null and point_id is not null
      and tag_id is null and lesson_id is null)
    or (kind in ('match', 'starred')
      and match_id is not null and point_id is null
      and tag_id is null and lesson_id is null)
    or (kind = 'tag'
      and match_id is not null and point_id is null
      and tag_id is not null and lesson_id is null)
    or (kind = 'entry'
      and lesson_id is not null and match_id is null
      and point_id is null and tag_id is null)
  );

-- One ACTIVE link per entry, same rule as every other target. The create
-- route is idempotent on top of this; the index settles races.
create unique index if not exists share_links_active_entry_uniq
  on public.share_links (lesson_id)
  where (kind = 'entry' and revoked_at is null);
create index if not exists share_links_lesson_id_idx
  on public.share_links (lesson_id);

-- The owner policy: the with_check used to pin every row to a match the
-- caller owns, which would refuse entry rows outright. Now it pins the
-- row to whichever target it names — a match of yours or a lesson of
-- yours — and the shape check above guarantees it names one.
drop policy "Owners manage own share links" on public.share_links;
create policy "Owners manage own share links"
  on public.share_links for all
  to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and (
      (match_id is not null and exists (
        select 1 from public.matches m
        where m.id = share_links.match_id
          and m.user_id = (select auth.uid())))
      or (lesson_id is not null and exists (
        select 1 from public.lessons l
        where l.id = share_links.lesson_id
          and l.user_id = (select auth.uid())))
    )
    and (point_id is null or exists (
      select 1 from public.points p
      where p.id = share_links.point_id
        and p.match_id = share_links.match_id))
    and (tag_id is null or exists (
      select 1 from public.tags t
      where t.id = share_links.tag_id
        and t.owner_id = (select auth.uid())))
  );

-- What a stranger's token gets back. Its own function rather than new
-- columns on resolve_share_link — one value per function when kinds
-- diverge (the 133 lesson). owner_name reads the auth metadata name
-- directly, never a display-name helper that falls back to the email
-- local part (the 130 leak, closed there, not reopened here).
--
-- image_path is for the share media route to sign server-side; the page
-- never renders it. transcript ships because it IS the entry for short
-- entries (no takeaways), and stays one tap away otherwise — the same
-- shape the owner's own card has.
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
    l.image_path,
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
