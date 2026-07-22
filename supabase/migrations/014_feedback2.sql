-- 014: Feedback 2.0 — public idea board + private reports + app_config.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * app_config      — tiny key/value store for NON-SECRET app settings
--                      (support_email, digest_recipient, digest_last_sent).
--                      Readable by everyone, writable by admin + service
--                      role only.
--  * feedback_items  — one row per piece of feedback. AI assist (route
--                      /api/feedback/assist) fills title/type/visibility
--                      after insert; follow-up answers append to qa.
--                      vote_count is denormalized and maintained by a
--                      trigger on feedback_votes.
--  * feedback_votes  — one row per (item, voter); toggled via RPC.
--  * feedback_board() — SECURITY DEFINER read of the public board joined
--                      with the author's first name + avatar from
--                      auth.users (no direct grants on auth.users).
--  * Existing public.feedback rows are migrated in as private items; the
--    old table is kept (read-only history) but the app writes here now.

-- ---------------------------------------------------------------------------
-- app_config
-- ---------------------------------------------------------------------------
create table public.app_config (
  key   text primary key,
  value text not null
);

alter table public.app_config enable row level security;

-- Values are non-secret (support email etc.); anyone may read.
create policy "Anyone can read app config"
  on public.app_config for select
  to anon, authenticated
  using (true);

create policy "Admin can write app config"
  on public.app_config for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.app_config (key, value) values
  ('support_email', 'adilharis2001@gmail.com'),
  ('digest_recipient', 'adilharis2001@gmail.com');

-- ---------------------------------------------------------------------------
-- feedback_items
-- ---------------------------------------------------------------------------
create table public.feedback_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  match_id   uuid references public.matches (id) on delete set null,
  body       text not null check (length(body) between 1 and 5000),
  title      text not null check (length(title) between 1 and 120),
  type       text not null default 'idea'
             check (type in ('bug', 'idea', 'improvement', 'private')),
  visibility text not null default 'board'
             check (visibility in ('board', 'private')),
  status     text not null default 'open'
             check (status in ('open', 'planned', 'building', 'done', 'declined')),
  qa         jsonb not null default '[]',
  vote_count int not null default 0,
  created_at timestamptz not null default now()
);

create index feedback_items_user_id_idx on public.feedback_items (user_id);
create index feedback_items_board_idx
  on public.feedback_items (visibility, vote_count desc, created_at desc);

alter table public.feedback_items enable row level security;

-- Board rows are visible to any signed-in user; private rows only to their
-- owner (and the admin).
create policy "Signed-in users can view board items"
  on public.feedback_items for select
  to authenticated
  using (
    visibility = 'board'
    or user_id = (select auth.uid())
    or public.is_admin()
  );

-- Inserts are owner-only and always start in the default state; the AI
-- assist route reshapes title/type/visibility afterwards through
-- feedback_apply_assist().
create policy "Users can create own feedback items"
  on public.feedback_items for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and vote_count = 0
  );

-- Direct updates are admin-only (status/type triage from the board).
-- Owners change their items only through the SECURITY DEFINER RPCs below.
create policy "Admin can update feedback items"
  on public.feedback_items for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- feedback_votes (+ denormalized vote_count trigger)
-- ---------------------------------------------------------------------------
create table public.feedback_votes (
  item_id    uuid not null references public.feedback_items (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create index feedback_votes_user_id_idx on public.feedback_votes (user_id);

alter table public.feedback_votes enable row level security;

create policy "Users can view own votes"
  on public.feedback_votes for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can vote"
  on public.feedback_votes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.feedback_items i
      where i.id = feedback_votes.item_id and i.visibility = 'board'
    )
  );

create policy "Users can remove own votes"
  on public.feedback_votes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- vote_count maintenance. SECURITY DEFINER so the update isn't blocked by
-- the admin-only update policy on feedback_items.
create or replace function public._feedback_vote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback_items
       set vote_count = vote_count + 1 where id = new.item_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.feedback_items
       set vote_count = greatest(vote_count - 1, 0) where id = old.item_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger feedback_votes_count
  after insert or delete on public.feedback_votes
  for each row execute function public._feedback_vote_count();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Toggle the caller's vote on a board item; returns the new state.
create or replace function public.feedback_toggle_vote(p_item uuid)
returns table (vote_count int, voted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.feedback_items i
                 where i.id = p_item and i.visibility = 'board') then
    raise exception 'item not found';
  end if;

  delete from public.feedback_votes v
   where v.item_id = p_item and v.user_id = auth.uid();
  get diagnostics removed = row_count;
  if removed = 0 then
    insert into public.feedback_votes (item_id, user_id)
    values (p_item, auth.uid());
  end if;

  return query
  select i.vote_count, (removed = 0)
  from public.feedback_items i where i.id = p_item;
end;
$$;

revoke execute on function public.feedback_toggle_vote(uuid) from public, anon;
grant execute on function public.feedback_toggle_vote(uuid) to authenticated;

-- Owner appends one follow-up Q&A pair ({q, a}) to their item.
create or replace function public.feedback_append_qa(
  p_item uuid, p_question text, p_answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_question is null or trim(p_question) = ''
     or p_answer is null or trim(p_answer) = '' then
    raise exception 'question and answer required';
  end if;
  update public.feedback_items
     set qa = qa || jsonb_build_array(jsonb_build_object(
                'q', left(trim(p_question), 300),
                'a', left(trim(p_answer), 2000)))
   where id = p_item
     and user_id = auth.uid()
     and jsonb_array_length(qa) < 10;
  if not found then
    raise exception 'item not found';
  end if;
end;
$$;

revoke execute on function public.feedback_append_qa(uuid, text, text)
  from public, anon;
grant execute on function public.feedback_append_qa(uuid, text, text)
  to authenticated;

-- The AI assist route (running as the item's owner) applies the model's
-- title/type/visibility. Owner-only; values re-validated by the checks.
create or replace function public.feedback_apply_assist(
  p_item uuid, p_title text, p_type text, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.feedback_items
     set title      = coalesce(nullif(left(trim(p_title), 120), ''), title),
         type       = coalesce(p_type, type),
         visibility = coalesce(p_visibility, visibility)
   where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item not found';
  end if;
end;
$$;

revoke execute on function public.feedback_apply_assist(uuid, text, text, text)
  from public, anon;
grant execute on function public.feedback_apply_assist(uuid, text, text, text)
  to authenticated;

-- "Similar item" merge: the duplicate goes private + declined (kept, never
-- deleted) after the owner moves their vote to the original.
create or replace function public.feedback_decline_duplicate(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.feedback_items
     set visibility = 'private', status = 'declined'
   where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item not found';
  end if;
end;
$$;

revoke execute on function public.feedback_decline_duplicate(uuid)
  from public, anon;
grant execute on function public.feedback_decline_duplicate(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- feedback_board(sort) — board rows + author first name/avatar + whether the
-- caller voted. SECURITY DEFINER so the author fields come from auth.users
-- without granting clients anything on that schema.
-- ---------------------------------------------------------------------------
create or replace function public.feedback_board(p_sort text default 'top')
returns table (
  id            uuid,
  user_id       uuid,
  title         text,
  body          text,
  type          text,
  status        text,
  qa            jsonb,
  vote_count    int,
  created_at    timestamptz,
  author_name   text,
  author_avatar text,
  voted         boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
  select
    i.id, i.user_id, i.title, i.body, i.type, i.status, i.qa,
    i.vote_count, i.created_at,
    split_part(coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      split_part(u.email::text, '@', 1),
      'Player'), ' ', 1) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    exists (select 1 from public.feedback_votes v
            where v.item_id = i.id and v.user_id = auth.uid()) as voted
  from public.feedback_items i
  join auth.users u on u.id = i.user_id
  where i.visibility = 'board'
  order by
    case when p_sort = 'top' then i.vote_count end desc,
    i.created_at desc
  limit 200;
end;
$$;

revoke execute on function public.feedback_board(text) from public, anon;
grant execute on function public.feedback_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Migrate legacy public.feedback rows (accuracy telemetry) in as private
-- items. Old table stays for history; the app now writes feedback_items.
-- ---------------------------------------------------------------------------
insert into public.feedback_items
  (user_id, match_id, body, title, type, visibility, status, created_at)
select
  f.user_id,
  f.match_id,
  f.body,
  left(coalesce(nullif(array_to_string(
    (regexp_split_to_array(trim(f.body), '\s+'))[1:8], ' '), ''),
    'Feedback'), 120),
  'private',
  'private',
  'open',
  f.created_at
from public.feedback f;
