-- The theme picker's order, and the last time each theme was used.
--
-- The vocabulary came back ordered by how many cards carry a theme, which
-- reads sensibly on the analysis page and badly in the picker. Reviewing a
-- match means reaching for the same three or four themes over and over for
-- an hour, and a pure count buries today's work under whatever was heavily
-- used a month ago and then abandoned.
--
-- What the picker wants is "what am I reaching for lately", which is both
-- counts AND recency and cannot be either one alone: a theme used once
-- this morning is not more useful than one used eight times this week, and
-- a theme used eight times in August is not more useful than one used
-- twice yesterday.
--
-- So each use is worth 1 the day it is made and half that a fortnight
-- later. Summing those weights over a theme's uses gives one number that
-- both facts feed, and the fortnight is picked to match how long a review
-- pass runs: within a session everything is fresh and the count decides;
-- across months the count stops mattering and recency does.
--
-- `last_used` rides along because the picker offers to delete a theme and
-- the answer to "is this one still live" is a date, not a score.
--
-- The return type gains a column, which `create or replace` cannot do, so
-- the function is dropped and rebuilt. The grant goes with it.

drop function if exists public.admin_themes_list();

create function public.admin_themes_list()
returns table (
  id uuid,
  label text,
  points bigint,
  created_at timestamptz,
  last_used timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select t.id,
         t.label,
         count(pt.point_id),
         t.created_at,
         max(pt.created_at)
    from public.admin_themes t
    left join public.admin_point_themes pt on pt.theme_id = t.id
   group by t.id, t.label, t.created_at
   -- half-life of fourteen days; a theme never used scores zero and sinks
   order by coalesce(
              sum(power(0.5,
                    extract(epoch from (now() - pt.created_at)) / 86400.0 / 14.0
                  )), 0) desc,
            count(pt.point_id) desc,
            t.label;
end;
$$;

grant execute on function public.admin_themes_list() to authenticated;
