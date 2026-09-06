-- Private beta subjects extend the existing outreach log, not account identity.
create table public.ios_beta_outreach (
  request_id uuid primary key references public.ios_beta_requests(id) on delete cascade,
  status text not null default 'new' check (status in ('new','contacted','in_touch','closed')),
  follow_up_on date,
  updated_at timestamptz not null default now()
);
create table public.ios_beta_outreach_corrections (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ios_beta_requests(id) on delete cascade,
  before_answers jsonb not null,
  after_answers jsonb not null,
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  author text not null,
  at timestamptz not null default now()
);
alter table public.ios_beta_outreach enable row level security;
alter table public.ios_beta_outreach_corrections enable row level security;
revoke all on public.ios_beta_outreach, public.ios_beta_outreach_corrections from public, anon, authenticated;
alter table public.user_outreach_touches add column beta_request_id uuid references public.ios_beta_requests(id) on delete cascade;
alter table public.user_outreach_touches drop constraint user_outreach_touches_one_subject;
alter table public.user_outreach_touches add constraint user_outreach_touches_one_subject check (num_nonnulls(user_id,person_id,beta_request_id)=1);
alter table public.user_outreach_touches drop constraint user_outreach_touches_channel_check;
alter table public.user_outreach_touches add constraint user_outreach_touches_channel_check check (channel in ('email','dm','in_person','audio_call','video_call'));
create index user_outreach_touches_beta_at on public.user_outreach_touches(beta_request_id,at desc) where beta_request_id is not null;

-- Ambiguous manual addresses get independent keys. Nothing is deleted to link.
create function public._outreach_members()
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
    s.priority, s.status, s.follow_up_on, s.hidden, s.kind, s.feedback_choice
  from sources s;
$$;
create function public._outreach_groups()
returns table (
  identity_key text, user_id uuid, person_id uuid, beta_id uuid,
  status text, follow_up_on date, hidden boolean, kind text,
  feedback_eligible boolean
)
language sql stable security definer set search_path = public as $$
  select m.identity_key,
    (array_agg(m.id order by m.id) filter (where m.subject = 'user'))[1],
    (array_agg(m.id order by m.id) filter (where m.subject = 'person'))[1],
    (array_agg(m.id order by m.id) filter (where m.subject = 'beta'))[1],
    (array_agg(m.status order by (m.status = 'new'), m.priority, m.id))[1],
    min(m.follow_up_on), bool_or(m.hidden),
    (array_agg(m.kind order by m.priority, m.id))[1],
    coalesce(bool_and(m.feedback_choice = 'opted_in')
      filter (where m.subject = 'beta'), true)
  from _outreach_members() m
  group by m.identity_key;
$$;
revoke execute on function public._outreach_members(),public._outreach_groups() from public,anon,authenticated;

create function public.admin_beta_outreach_roster()
returns table(id uuid,email text,created_at timestamptz,role text,interests text[],feedback_choice text,feedback_channels text[],scheduled_at timestamptz,delivery_state text,delivery_error_code text,early_send_requested_at timestamptz,status text,follow_up_on date)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'not authorized'; end if;
 return query select b.id,b.email,b.created_at,b.role,b.interests,b.feedback_choice,b.feedback_channels,b.scheduled_at,b.delivery_state,b.delivery_error_code,b.early_send_requested_at,coalesce(s.status,'new'),s.follow_up_on
 from ios_beta_requests b left join ios_beta_outreach s on s.request_id=b.id order by b.created_at desc;
end; $$;

-- New return shape requires dropping the old signature; existing consumers
-- still receive their existing columns plus the optional beta subject.
drop function public.admin_outreach_touches(uuid);
create function public.admin_outreach_touches(p_user_id uuid default null)
returns setof public.user_outreach_touches
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'not authorized'; end if;
 return query select t.* from user_outreach_touches t where p_user_id is null or t.user_id=p_user_id order by t.at desc;
end; $$;

create or replace function public.admin_outreach_counts()
returns table(to_contact integer,follow_ups_due integer)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'not authorized'; end if;
 return query select
   count(*) filter(where g.status='new')::int,
   count(*) filter(where g.status<>'closed' and g.follow_up_on<=current_date)::int
 from _outreach_groups() g where g.kind='real' and not g.hidden and g.feedback_eligible;
end; $$;

-- All new status, reminder and log writes use this one transaction. Lock the
-- email before resolving again, so two admins cannot choose stale subjects.
create function public.admin_outreach_act(p_subject text,p_id uuid,p_action text,p_value text default null,p_on date default null,p_channel text default null,p_body text default '')
returns void language plpgsql security definer set search_path=public as $$
declare
 v_email text; g record; m record; v_status text; v_member_status text; v_author text:=auth.jwt()->>'email'; v_dates text;
begin
 if not public.is_admin() then raise exception 'not authorized'; end if;
 select email into v_email from _outreach_members() where subject=p_subject and id=p_id;
 if not found then raise exception 'outreach subject not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(v_email,p_subject||':'||p_id),21000));
 select gr.* into g from _outreach_groups() gr join _outreach_members() src on src.identity_key=gr.identity_key where src.subject=p_subject and src.id=p_id;
 if not found then raise exception 'outreach subject not found'; end if;
 if p_action not in ('status','follow_up','touch') then raise exception 'invalid action'; end if;
 if p_action='status' and (p_value is null or p_value not in ('new','contacted','in_touch','closed')) then raise exception 'invalid status'; end if;
 if p_action='touch' and (p_value is null or p_value not in ('outreach','feedback','note') or (p_value='feedback' and length(btrim(coalesce(p_body,'')))=0)) then raise exception 'invalid touch'; end if;
 v_status:=case when p_action='status' then p_value
   when p_action='touch' and p_value='outreach' and g.status='new' then 'contacted'
   when p_action='touch' and p_value='feedback' and g.status in ('new','contacted') then 'in_touch'
   else g.status end;
 if p_action='follow_up' then
   select string_agg(subject||' '||follow_up_on,', ' order by priority) into v_dates from _outreach_members() where identity_key=g.identity_key and follow_up_on is not null;
   if v_dates is not null then
     insert into user_outreach_touches(user_id,person_id,beta_request_id,kind,body,author)
     values(g.user_id,case when g.user_id is null then g.person_id end,case when g.user_id is null and g.person_id is null then g.beta_id end,'note','Previous follow-up: '||v_dates||'. '||case when p_on is null then 'Cleared.' else 'Changed to '||p_on||'.' end,v_author);
   end if;
 end if;
 for m in select * from _outreach_members() where identity_key=g.identity_key loop
   -- An explicit status selection replaces the unified state. A log entry
   -- advances only its canonical subject, preserving conflicting history.
   v_member_status:=case when p_action='status' or m.subject||':'||m.id=g.identity_key then v_status else m.status end;
   if m.subject='user' then
     insert into user_outreach_contacts(user_id,status,follow_up_on,hidden) values(m.id,v_member_status,case when p_action='follow_up' then p_on else m.follow_up_on end,m.hidden)
     on conflict(user_id) do update set status=excluded.status,follow_up_on=excluded.follow_up_on,updated_at=now();
   elsif m.subject='person' then
     update user_outreach_people set status=v_member_status,follow_up_on=case when p_action='follow_up' then p_on else m.follow_up_on end,updated_at=now() where id=m.id;
   else
     insert into ios_beta_outreach(request_id,status,follow_up_on) values(m.id,v_member_status,case when p_action='follow_up' then p_on else m.follow_up_on end)
     on conflict(request_id) do update set status=excluded.status,follow_up_on=excluded.follow_up_on,updated_at=now();
   end if;
 end loop;
 if p_action='touch' then
   insert into user_outreach_touches(user_id,person_id,beta_request_id,kind,channel,body,author)
   values(g.user_id,case when g.user_id is null then g.person_id end,case when g.user_id is null and g.person_id is null then g.beta_id end,p_value,case when p_value='note' then null else p_channel end,coalesce(p_body,''),v_author);
 end if;
end; $$;

create function public.admin_beta_feedback_correct(p_id uuid,p_role text,p_interests text[],p_choice text,p_channels text[],p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare b ios_beta_requests%rowtype; allowed text[]; v_before jsonb; v_after jsonb;
begin
 if not public.is_admin() then raise exception 'not authorized'; end if;
 if length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception 'audit note required'; end if;
 allowed:=case when p_role in ('player','both') then array['iphone_recording','video_library','point_review','match_progress','placement_maps','professional_review','friends_family_sharing','coach_sharing','highlight_export','lesson_audio','training_journal','journal_questions'] else '{}'::text[] end
 ||case when p_role in ('coach','both') then array['coach_students','coach_lesson_recording','coach_shared_journal','coach_match_feedback','coach_profile','coach_review_orders'] else '{}'::text[] end;
 if p_choice is null or p_choice not in ('unanswered','declined','opted_in') or p_channels is null or not p_channels<@array['email','audio_call','video_call']::text[]
   or cardinality(p_channels)<>(select count(distinct x) from unnest(p_channels)x)
   or (p_choice='opted_in')<>(cardinality(p_channels)>0)
   or p_interests is null or cardinality(p_interests)<>(select count(distinct x) from unnest(p_interests)x)
   or not p_interests<@allowed or (p_role is not null and (p_role not in ('player','coach','both') or cardinality(p_interests)<1))
   or (p_role is null and cardinality(p_interests)>0) then raise exception 'invalid answers'; end if;
 select * into b from ios_beta_requests where id=p_id for update;
 if not found then raise exception 'beta request not found'; end if;
 v_before:=jsonb_build_object('role',b.role,'interests',b.interests,'feedback_choice',b.feedback_choice,'feedback_channels',b.feedback_channels);
 v_after:=jsonb_build_object('role',p_role,'interests',p_interests,'feedback_choice',p_choice,'feedback_channels',p_channels);
 insert into ios_beta_outreach_corrections(request_id,before_answers,after_answers,note,author) values(p_id,v_before,v_after,btrim(p_note),auth.jwt()->>'email');
 update ios_beta_requests set role=p_role,interests=p_interests,feedback_choice=p_choice,feedback_channels=p_channels where id=p_id;
 insert into user_outreach_touches(beta_request_id,kind,body,author) values(p_id,'note','Beta answers corrected: '||btrim(p_note),auth.jwt()->>'email');
end; $$;

-- Account deletion must not cascade away the linked beta conversation.
-- Only its subject changes; the original note, author and timestamp do not.
create function public._outreach_preserve_beta_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  g record;
  account_source record;
  beta_source record;
begin
 select * into g from _outreach_groups() where user_id=old.id and beta_id is not null;
 if found then
   -- The account is about to disappear, and its effective state will become
   -- the beta record's current state. Preserve BOTH source values before that
   -- replacement so a later reminder or conflicting status is not erased.
   select status, follow_up_on into account_source
     from user_outreach_contacts where user_id = old.id;
   select status, follow_up_on into beta_source
     from ios_beta_outreach where request_id = g.beta_id;
   insert into user_outreach_touches(beta_request_id, kind, body, author)
   values (g.beta_id, 'note', format(
     'Account removed. Account contact status: %s; follow-up: %s. Previous beta contact status: %s; follow-up: %s.',
     case coalesce(account_source.status, 'new')
       when 'new' then 'New' when 'contacted' then 'Reached out'
       when 'in_touch' then 'In touch' when 'closed' then 'Closed' end,
     coalesce(account_source.follow_up_on::text, 'None'),
     case coalesce(beta_source.status, 'new')
       when 'new' then 'New' when 'contacted' then 'Reached out'
       when 'in_touch' then 'In touch' when 'closed' then 'Closed' end,
     coalesce(beta_source.follow_up_on::text, 'None')
   ), 'PongLens');
   insert into ios_beta_outreach(request_id,status,follow_up_on) values(g.beta_id,g.status,g.follow_up_on)
   on conflict(request_id) do update set status=excluded.status,follow_up_on=excluded.follow_up_on,updated_at=now();
   update user_outreach_touches set user_id=null,beta_request_id=g.beta_id where user_id=old.id;
 end if;
 return old;
end; $$;
create trigger preserve_beta_outreach_before_account_delete before delete on auth.users for each row execute function public._outreach_preserve_beta_history();
revoke execute on function public._outreach_preserve_beta_history() from public,anon,authenticated;
revoke execute on function public.admin_beta_outreach_roster(),public.admin_outreach_touches(uuid),public.admin_outreach_act(text,uuid,text,text,date,text,text),public.admin_beta_feedback_correct(uuid,text,text[],text,text[],text) from public,anon;
grant execute on function public.admin_beta_outreach_roster(),public.admin_outreach_touches(uuid),public.admin_outreach_act(text,uuid,text,text,date,text,text),public.admin_beta_feedback_correct(uuid,text,text[],text,text[],text) to authenticated;
