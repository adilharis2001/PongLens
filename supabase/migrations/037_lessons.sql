-- 037: lessons — long-form coaching content in Improve (Notes phase 2).
--
-- A lesson is pasted (or later, recorded) text that is too long to read as
-- a note: a coaching-session transcript, a coach's voice-memo dump. The
-- app distills it into short, tactical takeaways grouped by theme
-- (/api/lesson computes them; the row stores both), and the raw
-- transcript stays attached for reading and copying.
--
-- Private to the author: there is no match to scope coach access through,
-- so RLS is author-only on every operation. match_id exists for a future
-- "lesson about this match" link but carries no access semantics.
--
-- takeaways shape: { title: text, themes: [{ name, points: [text] }] }

create table public.lessons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  match_id   uuid references public.matches (id) on delete set null,
  transcript text not null check (char_length(transcript) between 1 and 200000),
  takeaways  jsonb,
  status     text not null default 'queued'
             check (status in ('queued', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create index lessons_user_id_idx on public.lessons (user_id, created_at desc);

alter table public.lessons enable row level security;

create policy "Authors manage own lessons"
  on public.lessons for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.lessons from anon;
grant select, insert, update, delete on public.lessons to authenticated;
