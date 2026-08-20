-- 127: a bug becomes a conversation, and remembers how it got here.
--
-- The tracker could carry a verdict but not a discussion. `resolution` is
-- one text box, owner to tester, overwritten on every edit, and nothing
-- announces it — so the tester learned a bug had moved only by opening
-- the page and noticing. Worse, the traffic that matters most in a verify
-- loop runs the other way: "which video did you test?", "what was the
-- exact wording?", "still happens on my machine". There was nowhere to
-- put any of it.
--
-- One table holds both halves of the record, in one chronological list:
-- what people said, and what the status did. Keeping them together is the
-- point. "Marked fixed" followed by "can't reproduce, here's a video"
-- followed by "reopened" reads as a story in a single column, and reading
-- it anywhere else means stitching two lists together by timestamp.
--
-- Modelled on review_messages + send_review_message (073, 083), which is
-- the same problem between a coach and a student and is already proven.
-- The turn-taking trick is carried over too: the RPC reports whether the
-- thread changed hands, so a caller can email once per exchange rather
-- than once per sentence.

create table if not exists public.qa_bug_messages (
  id          uuid primary key default gen_random_uuid(),
  bug_id      uuid not null references public.qa_bugs (id) on delete cascade,
  -- Null for an entry nobody typed: a status change made by a job, or by
  -- an admin acting through the service role rather than a session.
  author_id   uuid references auth.users (id) on delete set null,
  kind        text not null check (kind in ('comment', 'status')),
  -- A comment's text. Empty for a status entry, which says what it means
  -- through the two columns below instead of a sentence someone has to
  -- keep in step with the vocabulary.
  body        text not null default '',
  from_status text,
  to_status   text,
  created_at  timestamptz not null default now(),

  constraint qa_bug_messages_shape check (
    (kind = 'comment'
       and char_length(btrim(body)) between 1 and 4000
       and from_status is null and to_status is null)
    or
    (kind = 'status' and to_status is not null)
  )
);

create index if not exists qa_bug_messages_bug_idx
  on public.qa_bug_messages (bug_id, created_at);

alter table public.qa_bug_messages enable row level security;

-- Same audience as the bug itself. There is no per-bug privacy here: the
-- two people in this table are the tester and the owner, and both can
-- already read every bug.
create policy "QA and admin read the thread"
  on public.qa_bug_messages for select
  to authenticated
  using (public.is_qa() or public.is_admin());

-- No insert policy on purpose. Writing goes through post_bug_message,
-- which is what guarantees the other side is actually told; a direct
-- insert would be a message that silently notifies nobody.
grant select on public.qa_bug_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Who is the other side
-- ---------------------------------------------------------------------------
-- is_admin() reads a constant email off the JWT, which answers "is the
-- caller the admin" but not "which row in auth.users is the admin" — and
-- a notification needs the second. Mirrors the same address, and is the
-- fourth site to do so: src/lib/config.ts, worker.py and is_admin() are
-- the others. Change one, change all four.
create or replace function public._qa_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where email = 'adilharis2001@gmail.com' limit 1;
$$;

-- The list is rebuilt whole because a CHECK is a single expression, which
-- makes it easy to drop a kind by copying a stale list out of an older
-- migration. This one was read from production first: `sponsored_claimed`
-- is live and appears in no migration file, so anyone regenerating this
-- from 083 alone would have silently broken it.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'note', 'match_ready', 'match_failed',
    'reel_ready', 'reel_failed', 'coach_joined',
    'upload_failed',
    'order_paid', 'order_submitted', 'order_accepted', 'order_declined',
    'clarification_requested', 'review_delivered', 'followup_received',
    'order_completed', 'order_refunded',
    'sample_requested', 'sample_responded',
    'testimonial_left', 'clarification_answered',
    'sponsored_claimed',
    'qa_bug_comment', 'qa_bug_status'));

-- ---------------------------------------------------------------------------
-- The shared write path
-- ---------------------------------------------------------------------------
-- Both the session RPC and the service-role one land here, so a message
-- can never exist without the bell that goes with it.
create or replace function public._qa_write_message(
  p_bug_id uuid,
  p_author uuid,
  p_kind   text,
  p_body   text,
  p_from   text default null,
  p_to     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bug      public.qa_bugs%rowtype;
  v_admin    uuid := public._qa_admin_id();
  v_target   uuid;
  v_prev     uuid;
  v_flipped  boolean := true;
  v_title    text;
  v_id       uuid;
begin
  select * into v_bug from public.qa_bugs where id = p_bug_id;
  if not found then
    raise exception 'bug not found' using errcode = 'P0002';
  end if;

  -- The other side of this particular bug. The reporter is whoever filed
  -- it; everyone else in this table is the admin.
  if p_author is not distinct from v_bug.reporter_id then
    v_target := v_admin;
  else
    v_target := v_bug.reporter_id;
  end if;

  -- Did the thread change hands? Read before the insert, or the row just
  -- written is its own predecessor and nothing ever looks like a flip.
  -- A caller that emails uses this so a burst of five messages is one
  -- email rather than five.
  select author_id into v_prev
    from public.qa_bug_messages
   where bug_id = p_bug_id and kind = 'comment'
   order by created_at desc
   limit 1;
  if found and v_prev is not distinct from p_author then
    v_flipped := false;
  end if;

  insert into public.qa_bug_messages
    (bug_id, author_id, kind, body, from_status, to_status)
  values
    (p_bug_id, p_author, p_kind, coalesce(p_body, ''), p_from, p_to)
  returning id into v_id;

  -- Never ring your own bell, and never ring one for a bug whose other
  -- side is missing (an admin row that does not exist yet, say).
  if v_target is not null and v_target is distinct from p_author then
    v_title := case
      when p_kind = 'status' then 'Bug marked ' || p_to
      else 'New comment on a bug'
    end;
    insert into public.notifications
      (user_id, kind, actor_id, title, body, href)
    values (
      v_target,
      case when p_kind = 'status' then 'qa_bug_status' else 'qa_bug_comment' end,
      p_author,
      v_title,
      left(coalesce(nullif(btrim(p_body), ''), v_bug.title), 120),
      '/testing/bugs?bug=' || p_bug_id::text
    );
  end if;

  return jsonb_build_object('id', v_id, 'flipped', v_flipped,
                            'notified', v_target);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing as yourself, from a session
-- ---------------------------------------------------------------------------
create or replace function public.post_bug_message(
  p_bug_id uuid, p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_qa() or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'empty_message' using errcode = '23514';
  end if;
  if char_length(v_body) > 4000 then
    v_body := left(v_body, 4000);
  end if;
  return public._qa_write_message(p_bug_id, v_me, 'comment', v_body);
end;
$$;

revoke all on function public.post_bug_message(uuid, text) from public, anon;
grant execute on function public.post_bug_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Writing on someone's behalf, without a session
-- ---------------------------------------------------------------------------
-- The owner triages this queue through an agent as often as through the
-- browser, and an agent holds the service role rather than a login. This
-- lets it post attributed to a real person, so the thread reads as a
-- conversation between two people instead of sprouting a third identity
-- the tester has never met. Service role only: an authenticated caller
-- must go through post_bug_message and can only ever be themselves.
create or replace function public.post_bug_message_as(
  p_bug_id uuid, p_author uuid, p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_body = '' then
    raise exception 'empty_message' using errcode = '23514';
  end if;
  if char_length(v_body) > 4000 then
    v_body := left(v_body, 4000);
  end if;
  return public._qa_write_message(p_bug_id, p_author, 'comment', v_body);
end;
$$;

revoke all on function public.post_bug_message_as(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.post_bug_message_as(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Status changes write themselves into the thread
-- ---------------------------------------------------------------------------
-- A trigger rather than asking every caller to remember, because status
-- moves from at least four places: the table's own control, the tester's
-- verify button, a CSV import, and the owner's agent running SQL. History
-- that depends on the writer being polite is history with holes in it.
create or replace function public._qa_bugs_log_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public._qa_write_message(
      new.id, auth.uid(), 'status', '', old.status, new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists qa_bugs_log_status on public.qa_bugs;
create trigger qa_bugs_log_status
  after update of status on public.qa_bugs
  for each row execute function public._qa_bugs_log_status();

-- ---------------------------------------------------------------------------
-- Seed the history that already happened
-- ---------------------------------------------------------------------------
-- Every existing bug gets one entry for the state it is in, stamped when
-- that state was reached. Without it the four bugs marked fixed this
-- morning would open onto an empty thread, which reads as "nothing has
-- ever happened here" for the ones where the most has.
insert into public.qa_bug_messages
  (bug_id, author_id, kind, body, from_status, to_status, created_at)
select b.id, null, 'status', '', null, b.status, b.status_changed_at
from public.qa_bugs b
where not exists (
  select 1 from public.qa_bug_messages m
   where m.bug_id = b.id and m.kind = 'status'
);
