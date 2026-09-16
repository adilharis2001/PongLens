-- Feedback board becomes a place to talk, not only to vote.
--
-- Until now a board post could be upvoted and nothing else. Someone who
-- had the same problem in a slightly different shape had no way to say
-- so, and the maker had no way to answer on the post itself — so the
-- board read as a suggestion box with a counter on it.
--
--  * feedback_comments — one row per comment under a board post. Flat,
--    in time order; a post IS the thread. Modelled on qa_bug_messages
--    (127): writing goes through an RPC so a comment can never exist
--    without the bell that goes with it, and the read joins auth.users
--    inside a SECURITY DEFINER function so a client never sees that
--    schema.
--  * feedback_items.comment_count / last_activity_at — denormalised by
--    trigger, the way vote_count already is. `last_activity_at` is what
--    the new Active sort orders by: a post moves up when someone comments
--    on it, not when someone votes, because Active means "being talked
--    about" and Top already means "wanted".
--  * An official reply is any comment by the admin. feedback_board hands
--    back the latest one per post so the board can pin it under the post,
--    and feedback_thread flags each admin comment so the thread can badge
--    it. No flag column: the admin is one row in auth.users and the
--    existing _qa_admin_id() already names it.
--  * Notifications: kind 'feedback_comment' to the post's author, to
--    everyone else in the thread, and to the admin, never to the writer.
--    Bursts collapse into one unread row per post per person, as note
--    notifications do (031). Bell only, no email.
--
-- Read from production before writing, as 127 taught: the kind
-- allow-list carried four match_issue kinds in a second OR branch that
-- no migration file in this folder lists.

-- ---------------------------------------------------------------------------
-- feedback_items: two counters the board sorts and labels by
-- ---------------------------------------------------------------------------
alter table public.feedback_items
  add column if not exists comment_count int not null default 0,
  add column if not exists last_activity_at timestamptz;

update public.feedback_items
   set last_activity_at = created_at
 where last_activity_at is null;

alter table public.feedback_items
  alter column last_activity_at set not null,
  alter column last_activity_at set default now();

create index if not exists feedback_items_active_idx
  on public.feedback_items (visibility, last_activity_at desc);

comment on column public.feedback_items.comment_count is
  'Denormalised count of feedback_comments rows, kept by trigger.';
comment on column public.feedback_items.last_activity_at is
  'Posted at, then bumped by each comment. The Active sort orders by it.';

-- ---------------------------------------------------------------------------
-- feedback_comments
-- ---------------------------------------------------------------------------
create table if not exists public.feedback_comments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.feedback_items (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- Set when the author changes the text, so a thread can say "edited"
  -- rather than quietly showing words nobody replied to.
  edited_at  timestamptz
);

create index if not exists feedback_comments_item_idx
  on public.feedback_comments (item_id, created_at);
create index if not exists feedback_comments_user_idx
  on public.feedback_comments (user_id);

alter table public.feedback_comments enable row level security;

-- A comment is as visible as the post it sits under. The subquery runs
-- under the caller's own row security on feedback_items, so the one rule
-- there (board, or your own, or the admin) decides here too.
drop policy if exists "Comments follow their post" on public.feedback_comments;
create policy "Comments follow their post"
  on public.feedback_comments for select
  to authenticated
  using (exists (select 1 from public.feedback_items i
                  where i.id = feedback_comments.item_id));

-- Your own comment, or any comment if you are the admin. Adil's call
-- (2026-09-16): authors delete their own, the admin deletes any.
drop policy if exists "Author or admin deletes a comment" on public.feedback_comments;
create policy "Author or admin deletes a comment"
  on public.feedback_comments for delete
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- No insert or update policy on purpose: both go through the RPCs below,
-- which is what guarantees the other people in the thread are told and
-- that an edit stamps edited_at.
revoke all on public.feedback_comments from anon;
revoke insert, update on public.feedback_comments from authenticated;
grant select, delete on public.feedback_comments to authenticated;

-- ---------------------------------------------------------------------------
-- Counters. SECURITY DEFINER for the same reason as _feedback_vote_count:
-- feedback_items only lets the admin update it directly.
-- ---------------------------------------------------------------------------
create or replace function public._feedback_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback_items
       set comment_count = comment_count + 1,
           last_activity_at = greatest(last_activity_at, new.created_at)
     where id = new.item_id;
    return new;
  elsif tg_op = 'DELETE' then
    -- Activity is not rolled back: the post was being talked about, and
    -- one deleted comment does not make that untrue.
    update public.feedback_items
       set comment_count = greatest(comment_count - 1, 0)
     where id = old.item_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists feedback_comments_count on public.feedback_comments;
create trigger feedback_comments_count
  after insert or delete on public.feedback_comments
  for each row execute function public._feedback_comment_count();

-- ---------------------------------------------------------------------------
-- The first name the board shows. One definition, so a post, a comment
-- and a Home card all name a person the same way.
-- ---------------------------------------------------------------------------
create or replace function public._feedback_first_name(u auth.users)
returns text
language sql
stable
as $$
  select split_part(coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(u.email::text, '@', 1),
    'Player'), ' ', 1);
$$;

revoke execute on function public._feedback_first_name(auth.users)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The notification kind. Rebuilt whole, from production's current list.
-- ---------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (
    kind = any (array[
      'note', 'match_ready', 'match_failed', 'reel_ready', 'reel_failed',
      'coach_joined', 'upload_failed',
      'order_paid', 'order_submitted', 'order_accepted', 'order_declined',
      'clarification_requested', 'review_delivered', 'followup_received',
      'order_completed', 'order_refunded', 'sample_requested',
      'sample_responded', 'testimonial_left', 'clarification_answered',
      'sponsored_claimed', 'qa_bug_comment', 'qa_bug_status',
      'coach_entry', 'student_joined', 'student_match_ready',
      'student_lesson',
      'allowance_request', 'allowance_decided',
      'match_issue_reported', 'match_issue_updated',
      'match_reprocess_ready', 'match_reprocess_failed',
      -- Someone commented on a board post you wrote or joined.
      'feedback_comment'
    ])
  );

-- ---------------------------------------------------------------------------
-- feedback_post_comment — write a comment and ring the thread's bells
-- ---------------------------------------------------------------------------
create or replace function public.feedback_post_comment(p_item uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_admin   uuid := public._qa_admin_id();
  v_body    text := btrim(coalesce(p_body, ''));
  v_item    public.feedback_items%rowtype;
  v_id      uuid;
  v_actor   text;
  v_snippet text;
  v_href    text;
  v_rid     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'empty_comment' using errcode = '23514';
  end if;
  v_body := left(v_body, 4000);

  select * into v_item from public.feedback_items where id = p_item;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  -- Comments are for the board. A private row is one person's message
  -- to us, not a conversation, and it has no page anyone could reach.
  if v_item.visibility <> 'board' then
    raise exception 'not a board post' using errcode = '42501';
  end if;

  insert into public.feedback_comments (item_id, user_id, body)
  values (p_item, v_me, v_body)
  returning id into v_id;

  -- Who wrote it, as the thread will show it. The admin signs as the
  -- product, which is how the badge reads on the post.
  if v_me = v_admin then
    v_actor := 'PongLens';
  else
    select public._feedback_first_name(u.*) into v_actor
      from auth.users u where u.id = v_me;
    v_actor := coalesce(nullif(btrim(v_actor), ''), 'Someone');
  end if;

  v_snippet := left(regexp_replace(v_body, '\s+', ' ', 'g'), 140);
  v_href := '/feedback/' || p_item::text;

  -- Recipients: the post's author, everyone who has commented, and the
  -- admin, who answers on this board. Never the writer.
  for v_rid in
    select v_item.user_id
    union
    select c.user_id from public.feedback_comments c where c.item_id = p_item
    union
    select v_admin where v_admin is not null
  loop
    if v_rid is null or v_rid = v_me then
      continue;
    end if;

    -- A burst on one post is one unread row that counts up, not a row
    -- per sentence.
    update public.notifications
       set group_count = group_count + 1,
           title = (group_count + 1)::text || ' new comments on "'
                   || left(v_item.title, 60) || '"',
           body = v_actor || ': ' || v_snippet,
           actor_id = v_me,
           created_at = now()
     where user_id = v_rid
       and kind = 'feedback_comment'
       and href = v_href
       and read_at is null
       and created_at > now() - interval '6 hours';

    if not found then
      insert into public.notifications
        (user_id, kind, actor_id, title, body, href)
      values (
        v_rid, 'feedback_comment', v_me,
        case when v_rid = v_item.user_id
             then v_actor || ' replied to your post'
             else v_actor || ' commented on "' || left(v_item.title, 60) || '"'
        end,
        v_snippet,
        v_href
      );
    end if;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.feedback_post_comment(uuid, text) from public, anon;
grant execute on function public.feedback_post_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- feedback_edit_comment — the author changes their own words
-- ---------------------------------------------------------------------------
create or replace function public.feedback_edit_comment(p_comment uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'empty_comment' using errcode = '23514';
  end if;
  update public.feedback_comments
     set body = left(v_body, 4000),
         edited_at = now()
   where id = p_comment
     and user_id = auth.uid();
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.feedback_edit_comment(uuid, text) from public, anon;
grant execute on function public.feedback_edit_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- feedback_thread — the comments under one post, with who wrote them
-- ---------------------------------------------------------------------------
create or replace function public.feedback_thread(p_item uuid)
returns table (
  id            uuid,
  user_id       uuid,
  body          text,
  created_at    timestamptz,
  edited_at     timestamptz,
  author_name   text,
  author_avatar text,
  official      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._qa_admin_id();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Same door as the post itself: on the board, or yours, or you are
  -- the admin. Anything else reads as an empty thread, not an error.
  if not exists (
    select 1 from public.feedback_items i
     where i.id = p_item
       and (i.visibility = 'board' or i.user_id = auth.uid() or public.is_admin())
  ) then
    return;
  end if;
  return query
  select
    c.id, c.user_id, c.body, c.created_at, c.edited_at,
    public._feedback_first_name(u.*) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    (c.user_id = v_admin) as official
  from public.feedback_comments c
  join auth.users u on u.id = c.user_id
  where c.item_id = p_item
  order by c.created_at asc;
end;
$$;

revoke all on function public.feedback_thread(uuid) from public, anon;
grant execute on function public.feedback_thread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The board rows, once. feedback_board and feedback_item both read from
-- here so a post looks the same on the list, on its own page and on Home.
-- A named row type, because two functions returning "the same table" is
-- otherwise two lists of twenty columns kept in step by hand.
-- ---------------------------------------------------------------------------
drop type if exists public.feedback_board_row cascade;
create type public.feedback_board_row as (
  id                uuid,
  user_id           uuid,
  title             text,
  body              text,
  type              text,
  status            text,
  qa                jsonb,
  vote_count        integer,
  created_at        timestamptz,
  author_name       text,
  author_avatar     text,
  voted             boolean,
  attachments       jsonb,
  severity          text,
  environment       jsonb,
  hidden            boolean,
  comment_count     integer,
  last_activity_at  timestamptz,
  official_reply    text,
  official_reply_at timestamptz
);

create or replace function public._feedback_rows(
  p_item  uuid,
  p_sort  text,
  p_limit int
)
returns setof public.feedback_board_row
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._qa_admin_id();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return query
  select
    i.id, i.user_id, i.title, i.body, i.type, i.status, i.qa,
    i.vote_count, i.created_at,
    public._feedback_first_name(u.*) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    exists (select 1 from public.feedback_votes v
            where v.item_id = i.id and v.user_id = auth.uid()) as voted,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.attachments else '[]'::jsonb end as attachments,
    i.severity,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.environment else null end as environment,
    i.visibility <> 'board' as hidden,
    i.comment_count,
    i.last_activity_at,
    r.body as official_reply,
    r.created_at as official_reply_at
  from public.feedback_items i
  join auth.users u on u.id = i.user_id
  left join lateral (
    select c.body, c.created_at
      from public.feedback_comments c
     where c.item_id = i.id and c.user_id = v_admin
     order by c.created_at desc
     limit 1
  ) r on true
  where (p_item is null or i.id = p_item)
    and (
      i.visibility = 'board'
      or (p_item is not null and i.user_id = auth.uid())
      or (public.is_qa(i.user_id)
          and (i.user_id = auth.uid() or public.is_admin()))
    )
  order by
    case when p_sort = 'top' then i.vote_count end desc,
    case when p_sort = 'active' then i.last_activity_at end desc,
    i.created_at desc
  limit greatest(coalesce(p_limit, 200), 1);
end;
$$;

revoke all on function public._feedback_rows(uuid, text, int)
  from public, anon, authenticated;

-- The return type grows, so the old signature has to go first.
drop function if exists public.feedback_board(text);

create function public.feedback_board(
  p_sort  text default 'top',
  p_limit int  default 200
)
returns setof public.feedback_board_row
language sql
stable
security definer
set search_path = public
as $$
  select * from public._feedback_rows(null, p_sort, p_limit);
$$;

revoke all on function public.feedback_board(text, int) from public, anon;
grant execute on function public.feedback_board(text, int) to authenticated;

create or replace function public.feedback_item(p_item uuid)
returns setof public.feedback_board_row
language sql
stable
security definer
set search_path = public
as $$
  select * from public._feedback_rows(p_item, 'new', 1);
$$;

revoke all on function public.feedback_item(uuid) from public, anon;
grant execute on function public.feedback_item(uuid) to authenticated;
