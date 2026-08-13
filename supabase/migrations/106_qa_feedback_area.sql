-- 106: /feedback becomes a testable area.
--
-- qa:affected reported src/app/feedback/* as mapping to no area on its
-- first real run, which was correct: the library covered sixteen surfaces
-- and the one every player can reach to tell us something was broken was
-- not one of them.
--
-- The area vocabulary is a check constraint rather than an enum precisely
-- so that adding a surface is one migration. testLibrary.test.ts asserts
-- the two lists agree, so a case in an area the table rejects fails the
-- suite rather than failing at 11pm when someone files a bug from it.

alter table public.qa_bugs drop constraint qa_bugs_area_check;

alter table public.qa_bugs
  add constraint qa_bugs_area_check check (area in (
    'landing', 'auth', 'upload', 'processing', 'match', 'scoring',
    'placement', 'notes', 'journal', 'stats', 'sharing', 'coaching',
    'orders', 'account', 'email', 'nav', 'feedback', 'other'));
