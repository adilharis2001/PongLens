-- Provider test mailboxes must not count as real outreach subjects.
-- Descriptive only: preserves identities, privacy, histories and email delivery.
create or replace function public._outreach_members()
returns table (
  subject text, id uuid, email text, identity_key text, priority integer,
  status text, follow_up_on date, hidden boolean, kind text, feedback_choice text
)
language sql stable security definer set search_path = public as $$
  with sources as (
    select 'user'::text subject, u.id, lower(btrim(u.email)) email,
           0 priority, coalesce(c.status, 'new') status, c.follow_up_on,
           coalesce(c.hidden, false) hidden, public._player_kind(u.*) kind,
           null::text feedback_choice
      from auth.users u
      left join user_outreach_contacts c on c.user_id = u.id
    union all
    select 'person', p.id, nullif(lower(btrim(p.email)), ''),
           1, p.status, p.follow_up_on, false, 'real', null
      from user_outreach_people p
    union all
    select 'beta', b.id, lower(btrim(b.email)),
           2, coalesce(s.status, 'new'), s.follow_up_on, false, 'real',
           b.feedback_choice
      from ios_beta_requests b
      left join ios_beta_outreach s on s.request_id = b.id
  )
  select s.subject, s.id, s.email,
    case
      when s.subject = 'person' and (
        s.email is null or (
          select count(*) from sources p
           where p.subject = 'person' and p.email = s.email
        ) > 1
      ) then 'person:' || s.id
      else coalesce(
        (select 'user:' || u.id from sources u
          where u.subject = 'user' and u.email = s.email
          order by u.id limit 1),
        (select 'person:' || p.id from sources p
          where p.subject = 'person' and p.email = s.email
            and (select count(*) from sources p2
                  where p2.subject = 'person' and p2.email = s.email) = 1),
        s.subject || ':' || s.id
      )
    end,
    s.priority, s.status, s.follow_up_on, s.hidden,
    case when s.email like '%@resend.dev' then 'test' else s.kind end,
    s.feedback_choice
  from sources s;
$$;
revoke execute on function public._outreach_members() from public, anon, authenticated;

