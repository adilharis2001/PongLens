-- 179 — outreach uses the same definition of a real person as Players.
--
-- Numbered 179 because a concurrent session took 177 and 178 while this
-- was being written. It was APPLIED under the label 177_outreach_uses_
-- player_kind; Supabase tracks migrations by timestamp rather than by
-- that label, so the two are the same thing and this file is the record.
--
-- Both of these excluded @example.com and @ponglens.com by hand, which is
-- a guess at "not a real user" that misses every team and QA account on
-- gmail. The hub's "to contact" therefore counted Adil, Anton, Mumtaz and
-- Laiba as people to reach out to: 15 where the answer was 12.
--
-- _player_kind (176) already answers this properly and either page can
-- correct it, so both now ask it instead. Marking somebody in Players
-- moves them here, and the other way round — which is the point, because
-- Anton works this page and Adil works the other.
--
-- The roster stops excluding anything: it returns the kind and the page
-- filters on it, so a demo account is one tab away rather than invisible.
-- The COUNT still fixes on 'real', because the hub card means "who needs
-- attention" and that is not a filter anyone chose.

drop function if exists public.admin_outreach_roster();
create function public.admin_outreach_roster()
returns table (
  user_id uuid, email text, name text, signed_up timestamptz,
  last_seen timestamptz, matches integer, matches_scored integer,
  matches_failed integer, last_upload_at timestamptz, points integer,
  notes integer, journal_entries integer, share_links integer,
  is_coach boolean, kind text, status text, follow_up_on date,
  hidden boolean, last_outreach_at timestamptz,
  last_feedback_at timestamptz, touches integer
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
  select
    o.user_id, o.email, o.name, o.created_at, o.last_sign_in_at,
    o.matches, o.matches_scored,
    (select count(*) from public.matches m
      where m.user_id = o.user_id and m.status = 'failed')::int,
    o.last_upload_at,
    o.points, o.notes, o.journal_entries, o.share_links,
    exists (select 1 from public.coach_profiles cp
             where cp.user_id = o.user_id),
    o.kind,
    coalesce(c.status, 'new'),
    c.follow_up_on,
    coalesce(c.hidden, false),
    (select max(t.at) from public.user_outreach_touches t
      where t.user_id = o.user_id and t.kind = 'outreach'),
    (select max(t.at) from public.user_outreach_touches t
      where t.user_id = o.user_id and t.kind = 'feedback'),
    (select count(*) from public.user_outreach_touches t
      where t.user_id = o.user_id)::int
  from public.admin_player_overview() o
  left join public.user_outreach_contacts c on c.user_id = o.user_id
  order by o.created_at desc;
end;
$$;

create or replace function public.admin_outreach_counts()
returns table (to_contact integer, follow_ups_due integer)
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
  select
    ((select count(*) from auth.users u
       left join public.user_outreach_contacts c on c.user_id = u.id
      where public._player_kind(u.*) = 'real'
        and coalesce(c.hidden, false) = false
        and coalesce(c.status, 'new') = 'new')
     + (select count(*) from public.user_outreach_people p
         where p.status = 'new'))::int,
    ((select count(*) from auth.users u
       join public.user_outreach_contacts c on c.user_id = u.id
      where public._player_kind(u.*) = 'real'
        and c.hidden = false
        and c.status <> 'closed'
        and c.follow_up_on is not null
        and c.follow_up_on <= current_date)
     + (select count(*) from public.user_outreach_people p
         where p.status <> 'closed'
           and p.follow_up_on is not null
           and p.follow_up_on <= current_date))::int;
end;
$$;
