-- The sample match is read-only, including the two writes a VIEWER is
-- normally allowed to make.
--
-- Opening the sample through has_match_access() (20260918030000) also opened
-- the two write policies written for coaches: a coach who can see a match may
-- add notes to it and tag its points with the owner's tags. On a match every
-- signed-in account can read, that is a shared wall: anyone could write a
-- note on the sample and everyone else would read it.
--
-- Points, scores, clips, stars and deletes were never at risk — those are
-- owner-scoped policies and owner-checked functions.

create or replace function public.is_sample_match(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.matches m
    where m.id = m_id and m.is_sample
  );
$function$;

comment on function public.is_sample_match(uuid) is
  'True for the one demo match every account can read. Used to keep viewer writes off it.';

drop policy if exists "Match viewers can add own notes" on public.notes;
create policy "Match viewers can add own notes"
  on public.notes
  for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and has_match_access(match_id)
    and not public.is_sample_match(match_id)
    and (
      point_id is null
      or exists (
        select 1 from public.points p
        where p.id = notes.point_id and p.match_id = notes.match_id
      )
    )
  );

drop policy if exists "Match viewers can tag points with the owner's tags" on public.point_tags;
create policy "Match viewers can tag points with the owner's tags"
  on public.point_tags
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.points p
      join public.matches m on m.id = p.match_id
      join public.tags t on t.id = point_tags.tag_id
      where p.id = point_tags.point_id
        and has_match_access(m.id)
        and not m.is_sample
        and t.owner_id = m.user_id
    )
  );
