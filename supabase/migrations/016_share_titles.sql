-- 016: owner-editable share link titles.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * share_links.title — optional owner-written headline for the public
--    /s/[token] page and its OG card ("Adil vs Vaibhav · Club night").
--    Nullable: null keeps the machine-generated context line as the
--    headline (existing behavior). The API trims and caps at 80 chars;
--    the check constraint backstops that so a raw insert can't stuff a
--    novel into an OG card.
--  * resolve_share_link() gains a title column. The return type changes,
--    so the function is dropped and recreated (CREATE OR REPLACE cannot
--    change an OUT row type); grants are re-issued.
--  * No RLS changes: title rides the existing owner-only CRUD policy, and
--    the account page already selects from share_links as the owner.

alter table public.share_links
  add column title text
  check (title is null or char_length(title) <= 80);

-- ---------------------------------------------------------------------------
-- resolve_share_link(token) — as in 013, plus the owner's title.
-- ---------------------------------------------------------------------------
drop function public.resolve_share_link(text);

create function public.resolve_share_link(p_token text)
returns table (
  kind                   text,
  match_id               uuid,
  point_id               uuid,
  title                  text,
  opponent_name          text,
  player_near_name       text,
  player_far_name        text,
  played_at              timestamptz,
  cut_path               text,
  original_name          text,
  point_number           int,
  point_t0               numeric,
  point_t1               numeric,
  point_clip_path        text,
  point_starred          boolean,
  point_confirmed_winner text,
  point_confirmed_how    text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sl.kind,
    sl.match_id,
    sl.point_id,
    sl.title,
    m.opponent_name,
    m.player_near_name,
    m.player_far_name,
    m.played_at,
    coalesce(
      m.cut_path,
      (select j.result_path from public.jobs j
        where j.id = m.job_id and j.status = 'done')
    ) as cut_path,
    (select j.original_name from public.jobs j where j.id = m.job_id)
      as original_name,
    case when p.id is null then null else (
      select count(*)::int from public.points q
      where q.match_id = p.match_id
        and q.deleted = false
        and (coalesce(q.t0, q.idx), q.idx) <= (coalesce(p.t0, p.idx), p.idx)
    ) end as point_number,
    p.t0,
    p.t1,
    p.clip_path,
    p.starred,
    p.confirmed_winner,
    p.confirmed_how
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  left join public.points p on p.id = sl.point_id
  where sl.token = p_token
    and sl.revoked_at is null
    and (sl.point_id is null or (p.id is not null and p.deleted = false));
$$;

revoke execute on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text) to anon, authenticated;
