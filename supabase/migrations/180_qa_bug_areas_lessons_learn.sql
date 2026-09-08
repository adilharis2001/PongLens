-- 180: two more testable areas, "lessons" and "learn".
--
-- The test library grew cases for the player's Coaching tab and the lesson
-- recaps coaches share (area "lessons"), and for the Learn hub and its
-- tutorial videos (area "learn"), on 2026-09-08. qa_bugs.area is a check
-- constraint rather than an enum precisely so that adding an area is one
-- migration; testLibrary.test.ts reads this file and asserts the two lists
-- agree, so a case in an area the table rejects fails the suite rather
-- than failing at 11pm when someone files a bug from it.
--
-- Same list as 106, plus the two.

alter table public.qa_bugs drop constraint qa_bugs_area_check;

alter table public.qa_bugs
  add constraint qa_bugs_area_check check (area in (
    'landing', 'auth', 'upload', 'processing', 'match', 'scoring',
    'placement', 'notes', 'journal', 'lessons', 'stats', 'sharing',
    'coaching', 'orders', 'learn', 'account', 'email', 'nav', 'feedback',
    'other'));
