-- 142: one mark per case per week, per surface.
--
-- 107 keyed a result (case_id, period), which reads as "has this case been
-- run this week". It quietly assumes there is one place to run it. There
-- are four: the site on a desktop, the site on a phone, the iOS app, and
-- the Android app when it exists. They are separate builds and separate
-- layouts, so a pass on one says nothing about the others.
--
-- With the old key, marking match-seek Pass on a PC and Fail in the app
-- meant the second write replaced the first. The tester had nowhere to put
-- the second answer, which is the whole reason this migration exists.
--
-- The surface joins the key rather than replacing anything. Every existing
-- row takes 'web-desktop', which is true rather than convenient: all 46
-- marks recorded so far were made in a desktop browser on a Windows PC.
--
-- Surfaces are text with a check constraint rather than an enum, matching
-- how area and status are stored on qa_bugs. The vocabulary lives in
-- src/lib/qa/testLibrary.ts (TEST_SURFACES) and the two must agree: a mark
-- against a surface this table rejects fails to save.

alter table public.qa_case_results
  add column surface text not null default 'web-desktop';

alter table public.qa_case_results
  add constraint qa_case_results_surface_check
  check (surface in ('web-desktop', 'web-mobile', 'ios', 'android'));

-- Swap the key. Nothing references qa_case_results, so there are no
-- foreign keys to rebuild.
alter table public.qa_case_results
  drop constraint qa_case_results_pkey;

alter table public.qa_case_results
  add constraint qa_case_results_pkey
  primary key (case_id, period, surface);

comment on column public.qa_case_results.surface is
  'Where the case was run (142): web-desktop, web-mobile, ios or android. '
  'Part of the primary key, so the same case in the same week can carry a '
  'different answer on each.';

comment on table public.qa_case_results is
  'A test case marked run, scoped to a period and a surface (107, 142). '
  'Weekly cases carry week:<iso week>, once-only cases carry ''once''. The '
  'weekly reset is the period key changing, so nothing has to run at '
  'midnight and the history is kept rather than wiped.';

-- Reading "everything on this surface" is the page's main query now.
create index qa_case_results_surface_idx
  on public.qa_case_results (surface, period);
