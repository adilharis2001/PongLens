-- 104: the tester's bug table.
--
-- feedback_items is a suggestion board: one free-text body, a vote count,
-- and a status the author reads as news. 102 made a QA author's rows
-- private, which fixed the wrong-audience problem and left the wrong-shape
-- one. A tester's report is not a paragraph. It is steps, what should have
-- happened, what did, on which device, in which match, at which second.
--
-- So this is a separate table rather than more columns on feedback_items.
-- The two have different authors, different lifecycles and different
-- readers, and the one thing they share (a screenshot) is a jsonb column
-- either can carry. /feedback keeps working for anyone who prefers it.
--
-- What makes this not a generic tracker is the middle block of columns.
-- "The cut dropped a rally" is unactionable; "match <id> at 4:12" can be
-- opened. Those columns are the whole reason for building rather than
-- buying.

create table public.qa_bugs (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,

  title        text not null check (char_length(btrim(title)) between 1 and 200),
  -- Three fields, not one body. A tester who is asked for "what happened"
  -- writes a paragraph; one who is asked for steps, expected and actual
  -- writes something reproducible. Steps is the only required one: a
  -- visual bug often has nothing to say about expected behaviour beyond
  -- the screenshot.
  steps        text not null default '',
  expected     text not null default '',
  actual       text not null default '',

  -- 'accuracy' is deliberately its own kind. "Two points merged into one
  -- clip" is not a defect anyone fixes in a component; it is evidence for
  -- the dead-space work, and it wants filtering away from the queue of
  -- things that need code.
  kind         text not null default 'functional'
               check (kind in ('functional', 'accuracy', 'visual',
                               'performance', 'copy')),
  -- Kept in step with TestArea in src/lib/qa/testLibrary.ts. A text check
  -- rather than an enum so adding a surface is one migration, not a type
  -- rewrite plus a migration.
  area         text not null default 'other'
               check (area in ('landing', 'auth', 'upload', 'processing',
                               'match', 'scoring', 'placement', 'notes',
                               'journal', 'stats', 'sharing', 'coaching',
                               'orders', 'account', 'email', 'nav',
                               'other')),
  severity     text not null default 'major'
               check (severity in ('blocker', 'major', 'minor')),

  -- open -> triaged -> fixed -> verified -> closed, and the three exits.
  -- 'fixed' is the one that earns its keep: it hands the row back to the
  -- tester instead of ending the conversation, which is the difference
  -- between a suggestion box and a test loop.
  status       text not null default 'open'
               check (status in ('open', 'triaged', 'fixed', 'verified',
                                 'closed', 'rejected', 'duplicate',
                                 'deferred')),

  -- Where it was seen. Captured by the form, not typed, except device.
  device       text not null default '',
  browser      text not null default '',
  viewport     text not null default '',
  url          text not null default '',
  build_sha    text,

  -- The objects this product is made of. All nullable: a landing-page
  -- typo has none of them. on delete set null so deleting a match tidies
  -- itself up without taking the report with it — the report may be the
  -- only remaining record of why the match was deleted.
  match_id     uuid references public.matches (id) on delete set null,
  point_id     uuid references public.points (id) on delete set null,
  order_id     uuid references public.review_orders (id) on delete set null,
  job_id       uuid references public.jobs (id) on delete set null,
  -- Seconds into whichever video the report is about. The single most
  -- useful field on the table for anything involving the cut.
  video_seconds numeric(10, 2) check (video_seconds is null or video_seconds >= 0),
  billing_mode text check (billing_mode is null or billing_mode in ('live', 'test')),

  -- The library case being run when this was found, e.g. 'upload-yt-link'.
  -- Free text rather than a foreign key: the library lives in TypeScript,
  -- and a case that is later renamed should leave the old id readable on
  -- the report rather than failing a constraint.
  case_id      text not null default '',

  -- [{ key, kind: 'image'|'video', w?, h? }] under qa/<reporter>/ in R2.
  attachments  jsonb not null default '[]',
  duplicate_of uuid references public.qa_bugs (id) on delete set null,
  -- Where the row came from, so a CSV import is distinguishable from
  -- something typed into the form when the two disagree.
  source       text not null default 'portal'
               check (source in ('portal', 'csv', 'feedback')),

  -- Triage notes. One field rather than a comments table: there are two
  -- people here, and a thread neither of them reads is worse than a note
  -- one of them writes.
  resolution   text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  -- Same contract as feedback_items (103): null means the reporter has
  -- not been told this closed.
  closed_notified_at timestamptz
);

create index qa_bugs_status_idx on public.qa_bugs (status, severity, created_at desc);
create index qa_bugs_reporter_idx on public.qa_bugs (reporter_id);
create index qa_bugs_match_idx on public.qa_bugs (match_id) where match_id is not null;
create index qa_bugs_close_pending_idx on public.qa_bugs (reporter_id)
  where closed_notified_at is null and status in ('closed', 'rejected', 'duplicate');

-- ---------------------------------------------------------------------------
-- updated_at / status_changed_at. Written here rather than trusted from the
-- client: the table is read directly under RLS, so anything the client can
-- set, the client can also set wrongly.
-- ---------------------------------------------------------------------------
create or replace function public._qa_bugs_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    -- Re-closing after a reopen should tell the reporter again.
    if new.status in ('closed', 'rejected', 'duplicate')
       and old.status not in ('closed', 'rejected', 'duplicate') then
      new.closed_notified_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger qa_bugs_touch
  before update on public.qa_bugs
  for each row execute function public._qa_bugs_touch();

-- ---------------------------------------------------------------------------
-- RLS. One tester and one owner, so everyone who can see the table sees all
-- of it: a shared queue is the point. The write rules are where they differ.
-- ---------------------------------------------------------------------------
alter table public.qa_bugs enable row level security;

create policy "QA and admin can read every bug"
  on public.qa_bugs for select
  to authenticated
  using (public.is_qa() or public.is_admin());

create policy "QA and admin file as themselves"
  on public.qa_bugs for insert
  to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (public.is_qa() or public.is_admin())
  );

-- The admin triages anything.
create policy "Admin updates any bug"
  on public.qa_bugs for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- The reporter keeps their own row while it is theirs to work on: before
-- triage (fixing their own typos) and after a fix (verifying or reopening).
-- Once it is closed it is history, and history does not get edited.
create policy "Reporter updates their own open bug"
  on public.qa_bugs for update
  to authenticated
  using (
    reporter_id = (select auth.uid())
    and public.is_qa()
    and status in ('open', 'triaged', 'fixed')
  )
  with check (
    reporter_id = (select auth.uid())
    and public.is_qa()
    and status in ('open', 'triaged', 'fixed', 'verified')
  );

create policy "Admin deletes bugs"
  on public.qa_bugs for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update on public.qa_bugs to authenticated;
grant delete on public.qa_bugs to authenticated;

-- ---------------------------------------------------------------------------
-- qa_bug_counts() — the hub's headline numbers in one round trip, so the
-- landing page of the workspace does not pull the whole table to count it.
-- ---------------------------------------------------------------------------
create or replace function public.qa_bug_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_qa() or public.is_admin() then
    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
       from (select status, count(*) as n from public.qa_bugs group by status) s)
  else '{}'::jsonb end;
$$;

revoke all on function public.qa_bug_counts() from public, anon;
grant execute on function public.qa_bug_counts() to authenticated;
