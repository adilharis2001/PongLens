-- Stages the QA coach, so the paid-review cases can actually be run.
--
--   psql "$DATABASE_URL" -f scripts/qa/stage_coach.sql
--
-- Eight cases in the test library (orders-*) were authored blocked, because
-- 092 puts a wall between the two economies: a test-mode student may only
-- buy from a QA coach, and a live coach's storefront does not exist to
-- them at all. With no QA coach anywhere, the whole paid-review lifecycle
-- was unreachable, which is most of the coach side of the job.
--
-- So: a second account carrying the QA role, with a published storefront
-- and one offering. Its charges_enabled is set here rather than earned
-- through Stripe onboarding, which is the point. Nothing about this coach
-- ever touches real money: every order it takes is stamped billing_mode
-- 'test' by create_review_order, and revenue queries filter on 'live'.
--
-- The address is a plus-alias of the tester's own, so the magic link lands
-- in the inbox of the person who needs to sign in as the coach. Change the
-- email on the auth user if that should be someone else; nothing else here
-- depends on it.
--
-- Fixed UUIDs, so re-running updates in place rather than duplicating.

begin;

-- The role. Without this the cross-mode guard in create_review_order
-- refuses a QA student with "offering not found", which is correct
-- behaviour and looks exactly like a bug if you do not know why.
insert into public.app_roles (user_id, role, note)
values ('cfdbb405-1bf7-417c-b968-8b44c6d89158', 'qa',
        'QA coach — the other side of the paid review cases')
on conflict (user_id, role) do update set note = excluded.note;

-- The storefront.
insert into public.coach_profiles (
  user_id, handle, display_name, headline, bio, credentials,
  stripe_account_id, charges_enabled, payouts_enabled, accepting_orders,
  published, samples
) values (
  'cfdbb405-1bf7-417c-b968-8b44c6d89158',
  'qacoach',
  'QA Coach',
  'The coach account for testing paid reviews',
  'This storefront exists so the paid review flow can be tested end to '
  'end. It is only visible to accounts that carry the QA role, and every '
  'order it takes runs in test mode. If you have arrived here as a '
  'player, nothing on this page is real.',
  array['Test account'],
  'acct_qa_coach', true, true, true, true, '[]'::jsonb
)
on conflict (user_id) do update set
  handle = excluded.handle,
  display_name = excluded.display_name,
  headline = excluded.headline,
  bio = excluded.bio,
  charges_enabled = excluded.charges_enabled,
  payouts_enabled = excluded.payouts_enabled,
  accepting_orders = excluded.accepting_orders,
  published = excluded.published;

-- One offering, priced low enough that a test card is boring and high
-- enough that the platform fee is a whole number of cents.
insert into public.offerings (
  id, coach_id, template_key, title, description, includes,
  price_cents, turnaround_days, intake_questions, review_sections,
  followup_rounds, active, sort
) values (
  'd3f4a1c2-0b5e-4a7d-9c3f-2e6b8a1d4f70',
  'cfdbb405-1bf7-417c-b968-8b44c6d89158',
  'full_match',
  'Full match review (test)',
  'A written review of one match, used to exercise the order lifecycle. '
  'Not a real coaching product.',
  array['Every point watched', 'Written notes in three sections'],
  2000, 3,
  '[{"id":"side","label":"Which player are you?"},
    {"id":"goal","label":"What do you want out of this review?","optional":true}]'::jsonb,
  '[{"key":"serve","label":"Your serve"},
    {"key":"receive","label":"Your receive"},
    {"key":"next","label":"What to work on"}]'::jsonb,
  1, true, 0
)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  price_cents = excluded.price_cents,
  turnaround_days = excluded.turnaround_days,
  intake_questions = excluded.intake_questions,
  review_sections = excluded.review_sections,
  active = excluded.active;

-- A profile row, so the coach account clears onboarding the same way any
-- other account does and lands on the app rather than the profile steps.
insert into public.player_profiles (user_id, handedness, grip)
values ('cfdbb405-1bf7-417c-b968-8b44c6d89158', 'right', 'shakehand')
on conflict (user_id) do nothing;

commit;
