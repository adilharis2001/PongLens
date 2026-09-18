-- The sample match: one finished match every signed-in account can read.
--
-- Adil's call (2026-09-17): a new account should be able to look at a real
-- processed match before spending an upload. It is ONE match (Adil vs Anton,
-- 7 Sep 2026), owned by Adil's account and read by everybody. Nobody gets a
-- copy, so it costs a new account nothing and there is one thing to fix when
-- it needs fixing.
--
-- Read-only comes free: every write policy on matches and points is already
-- owner-scoped, so a reader can look and nothing else. Nothing here grants a
-- write. `is_sample` is deliberately NOT granted to authenticated either
-- (matches grants update on ten named columns), so a player cannot publish
-- their own match to every account by flipping a flag.
--
--  * matches.is_sample — at most one row true.
--  * a select policy for matches, and one for its rendered reel.
--  * has_match_access() admits the sample, which is what opens its points,
--    notes, score state, the cut video, the clips and the thumbnail: every
--    one of those already asks this single function.

alter table public.matches
  add column if not exists is_sample boolean not null default false;

comment on column public.matches.is_sample is
  'The one demo match every signed-in account can read. Not granted to authenticated for update: only a service role sets it.';

-- At most one sample, enforced rather than remembered.
create unique index if not exists matches_single_sample
  on public.matches ((true))
  where is_sample;

-- Permissive policies are OR'd, so this adds the sample to the existing
-- owner/coach read without touching that policy.
drop policy if exists "Signed-in accounts can view the sample match" on public.matches;
create policy "Signed-in accounts can view the sample match"
  on public.matches
  for select
  to authenticated
  using (is_sample);

-- The highlights reel is a separate row, owner-scoped like the rest.
drop policy if exists "Signed-in accounts can view the sample reel" on public.match_reels;
create policy "Signed-in accounts can view the sample reel"
  on public.match_reels
  for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_reels.match_id
        and m.is_sample
    )
  );

-- Unchanged apart from the final clause.
create or replace function public.has_match_access(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.matches m
    where m.id = m_id
      and (
        m.user_id = auth.uid()
        or exists (
          select 1
          from public.coach_links cl
          where cl.coach_id = auth.uid()
            and cl.player_id = m.user_id
            and cl.status = 'accepted'
            and (cl.scope_match_id = m.id
                 or (cl.scope_match_id is null and cl.all_matches))
        )
        or exists (
          select 1
          from public.review_orders o
          where o.match_id = m.id
            and o.coach_id = auth.uid()
            and o.status in ('submitted', 'in_review',
                             'clarification', 'delivered')
        )
        or (m.is_sample and auth.uid() is not null)
      )
  );
$function$;
