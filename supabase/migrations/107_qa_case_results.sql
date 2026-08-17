-- 107: marking a test case run, and a weekly reset that cannot fail to run.
--
-- The tester asked for two things after a week of using the library: a way
-- to mark each case pass or fail so it is clear what still needs doing,
-- and for the weekly cases to reset at the start of each week.
--
-- The obvious build is a status column plus a job that clears it every
-- Monday. This is the other one: a result is stored against a *period*,
-- and the reset is the period key changing. Last week's marks are still
-- there and simply stop answering "has this been run", because the
-- question is now about a different week.
--
-- That buys three things. Nothing has to run at midnight on Monday, so
-- nothing can fail to run and leave a stale checklist looking complete.
-- The history is kept rather than wiped, so "did this pass last week" is
-- still answerable. And a case that moves cadence starts being asked
-- about under its new period without anyone migrating rows.
--
-- Periods come from src/lib/qa/runs.ts: week:<iso week> for anything that
-- repeats, 'once' for the run-once cases.
--
-- Marks are shared rather than per-person. There is one tester and one
-- owner, and "which ones have been tested" is a question about the
-- product, not about who happened to click. marked_by keeps provenance.

create table public.qa_case_results (
  case_id    text not null,
  period     text not null,
  status     text not null check (status in ('pass', 'fail', 'blocked', 'skipped')),
  note       text not null default '',
  marked_by  uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (case_id, period)
);

comment on table public.qa_case_results is
  'A test case marked run, scoped to a period (107). Weekly cases carry '
  'week:<iso week>, once-only cases carry ''once''. The weekly reset is '
  'the period key changing, so nothing has to run at midnight and the '
  'history is kept rather than wiped.';

create index qa_case_results_period_idx on public.qa_case_results (period);

alter table public.qa_case_results enable row level security;

create policy "QA and admin read every result"
  on public.qa_case_results for select
  to authenticated
  using (public.is_qa() or public.is_admin());

create policy "QA and admin mark as themselves"
  on public.qa_case_results for insert
  to authenticated
  with check (
    marked_by = (select auth.uid())
    and (public.is_qa() or public.is_admin())
  );

-- Either of them may change a mark, but the row records who touched it
-- last, so provenance follows the edit rather than the original.
create policy "QA and admin change a mark"
  on public.qa_case_results for update
  to authenticated
  using (public.is_qa() or public.is_admin())
  with check (
    marked_by = (select auth.uid())
    and (public.is_qa() or public.is_admin())
  );

create policy "QA and admin clear a mark"
  on public.qa_case_results for delete
  to authenticated
  using (public.is_qa() or public.is_admin());

grant select, insert, update, delete on public.qa_case_results to authenticated;
