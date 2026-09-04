-- Stages the demo coach for the /coaches showcase screenshots.
--
--   psql "$DATABASE_URL" -f scripts/demos/stage_coach.sql
--
-- Miguel Santos (miguel-demo@example.com) gets a storefront, three offerings
-- and a queue with one order in every state the coach hub groups by. Fixed
-- UUIDs throughout, so re-running updates in place rather than duplicating.
--
-- He has his OWN auth user on purpose. The landing-video flow in
-- scripts/demos/landing/flows/review.mjs stages its invented coach onto
-- f15e9358 and its cleanup deletes that coach_profiles row outright, so any
-- showcase coach parked there disappears the next time a video is shot.
-- Priya Raman (18844af1) and Tom Becker (ad8652fd) are demo students created
-- the same way, so the queue is not four rows of the same name.
--
-- Every order points at the vetted demo match efff9208 (see the
-- demo-account-staging memory: games 1 and 3, uploader on the near side).
-- Findings link only to points 3, 17, 45, 52 and 54, which are the indices
-- already cleared for publication.

begin;

-- The coach ------------------------------------------------------------

insert into player_profiles (user_id)
values ('07601580-0ce3-4a4f-82b0-10ea04cac180')
on conflict (user_id) do nothing;

update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                            || '{"is_coach":true,"full_name":"Miguel Santos"}'::jsonb
 where id = '07601580-0ce3-4a4f-82b0-10ea04cac180';

insert into coach_profiles (
  user_id, handle, display_name, headline, bio, credentials,
  stripe_account_id, charges_enabled, payouts_enabled, accepting_orders,
  published, samples
) values (
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'miguel',
  'Miguel Santos',
  'Club coach in Boston',
  'I coach at a club in Boston and I have been doing it for twelve years. '
  'Most of my players are league regulars who keep losing the same points '
  'every week and cannot see why. I watch the whole match before I write '
  'anything, and I tell you what I would change first.',
  array['USATT 2100', '12 years coaching', 'Level 2 certified'],
  'acct_demo_miguel', true, true, true, true, '[]'::jsonb
)
on conflict (user_id) do update set
  handle = excluded.handle,
  display_name = excluded.display_name,
  headline = excluded.headline,
  bio = excluded.bio,
  credentials = excluded.credentials,
  stripe_account_id = excluded.stripe_account_id,
  charges_enabled = true,
  payouts_enabled = true,
  accepting_orders = true,
  published = true;

-- The offerings --------------------------------------------------------

insert into offerings (
  id, coach_id, template_key, title, description, includes, price_cents,
  turnaround_days, followup_rounds, image, active, sort,
  intake_questions, review_sections
) values
(
  '0a5e0001-0000-4000-8000-000000000001',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'full_match',
  'Full match review',
  'I watch your full match and break down what decided it. You get the '
  'patterns behind the score, the points worth rewatching, and a clear plan '
  'for what to practice next.',
  array[
    'Every game reviewed',
    'Strengths to keep leaning on',
    'What is costing you points',
    'Tactical observations',
    'Selected points to rewatch',
    'A practice plan'
  ],
  5000, 5, 1, 'stock:full-match', true, 0,
  '[{"id":"goal","label":"What do you want out of this review?"},
    {"id":"opponent","label":"Anything I should know about your opponent?","optional":true},
    {"id":"working_on","label":"What have you been working on lately?","optional":true}]'::jsonb,
  '[{"key":"summary","label":"Summary"},
    {"key":"strengths","label":"Strengths"},
    {"key":"costing_points","label":"What is costing you points"},
    {"key":"tactics","label":"Tactics"},
    {"key":"practice_plan","label":"Practice plan"}]'::jsonb
),
(
  '0a5e0001-0000-4000-8000-000000000002',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'serve',
  'Serve review',
  'A close look at your serves across one match. Where they land, what they '
  'give away, and which changes matter most.',
  array[
    'Every serve situation reviewed',
    'Spin, placement and depth observations',
    'The serves that won and lost you points',
    'Three things to work on'
  ],
  2500, 3, 1, 'stock:serve', true, 1,
  '[{"id":"serves","label":"Which serves do you use most?"},
    {"id":"trouble","label":"What happens after your serve that you don''t like?","optional":true}]'::jsonb,
  '[{"key":"summary","label":"Summary"},
    {"key":"serves","label":"Your serves"},
    {"key":"work_ons","label":"What to work on"}]'::jsonb
),
(
  '0a5e0001-0000-4000-8000-000000000003',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'receive',
  'Receive review',
  'How you handle serve. I look at your reads, your first touch, and what '
  'each return sets up for the rest of the point.',
  array[
    'Every receive situation reviewed',
    'Reading spin and length',
    'Return choices against each serve',
    'Three things to work on'
  ],
  2500, 3, 1, 'stock:receive', true, 2,
  '[{"id":"trouble_serves","label":"Which serves give you the most trouble?"},
    {"id":"return_game","label":"How do you usually try to return?","optional":true}]'::jsonb,
  '[{"key":"summary","label":"Summary"},
    {"key":"receives","label":"Your returns"},
    {"key":"work_ons","label":"What to work on"}]'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  includes = excluded.includes,
  price_cents = excluded.price_cents,
  turnaround_days = excluded.turnaround_days,
  followup_rounds = excluded.followup_rounds,
  image = excluded.image,
  active = true,
  sort = excluded.sort,
  intake_questions = excluded.intake_questions,
  review_sections = excluded.review_sections;

-- The queue ------------------------------------------------------------
-- One order in each group the coach hub shows: your move, in progress,
-- waiting, and a finished one behind them.

insert into review_orders (
  id, offering_id, coach_id, student_id, match_id, status,
  price_cents, fee_mode, fee_cents, coach_share_cents,
  turnaround_days, followup_rounds,
  intake_questions, review_sections, intake_answers,
  promised_by, paid_at, submitted_at, accepted_at, delivered_at,
  completed_at, review_viewed_at, testimonial, testimonial_at,
  testimonial_featured, sample_consent, created_at
) values
-- In progress: the order the workspace screenshots are taken from.
(
  '0a5e0002-0000-4000-8000-000000000001',
  '0a5e0001-0000-4000-8000-000000000001',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4',
  'efff9208-abf2-4a20-a498-18cc5a5130b3',
  'in_review',
  5000, 'percent', 750, 4250, 5, 1,
  (select intake_questions from offerings where id = '0a5e0001-0000-4000-8000-000000000001'),
  (select review_sections  from offerings where id = '0a5e0001-0000-4000-8000-000000000001'),
  '[{"id":"goal","label":"What do you want out of this review?","answer":"I keep losing the third game after being level. I want to know what changes in my game once it gets tight."},
    {"id":"opponent","label":"Anything I should know about your opponent?","answer":"Alex blocks everything back and waits for me to miss. We have played about ten times and it is always close."},
    {"id":"working_on","label":"What have you been working on lately?","answer":"Stepping around to use my forehand from the backhand corner."}]'::jsonb,
  '2026-08-09 18:00:00+00', '2026-08-04 15:12:00+00', '2026-08-04 15:14:00+00',
  '2026-08-04 19:40:00+00', null, null, null, null, null, false, 'none',
  '2026-08-04 15:12:00+00'
),
-- Completed, with the testimonial and the public sample.
(
  '0a5e0002-0000-4000-8000-000000000002',
  '0a5e0001-0000-4000-8000-000000000002',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4',
  'efff9208-abf2-4a20-a498-18cc5a5130b3',
  'completed',
  2500, 'percent', 375, 2125, 3, 1,
  (select intake_questions from offerings where id = '0a5e0001-0000-4000-8000-000000000002'),
  (select review_sections  from offerings where id = '0a5e0001-0000-4000-8000-000000000002'),
  '[{"id":"serves","label":"Which serves do you use most?","answer":"A short backspin to the middle most of the time, and a long one to his backhand when I want to catch him standing."},
    {"id":"trouble","label":"What happens after your serve that you don''t like?","answer":"The long serve keeps coming back at me faster than I am ready for."}]'::jsonb,
  '2026-07-27 18:00:00+00', '2026-07-24 14:02:00+00', '2026-07-24 14:03:00+00',
  '2026-07-24 16:20:00+00', '2026-07-26 21:15:00+00', '2026-07-28 08:30:00+00',
  '2026-07-27 07:45:00+00',
  'Miguel found the thing I could not see on my own. My long serve went to the same corner all match and he showed me the four points where it cost me. I stopped doing it and the next league night went a lot better.',
  '2026-07-28 08:31:00+00', true, 'approved',
  '2026-07-24 14:02:00+00'
),
-- Your move: a new order waiting on accept or decline.
(
  '0a5e0002-0000-4000-8000-000000000003',
  '0a5e0001-0000-4000-8000-000000000003',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '18844af1-9030-4507-bbbb-a488b5164294',
  null,
  'submitted',
  2500, 'percent', 375, 2125, 3, 1,
  (select intake_questions from offerings where id = '0a5e0001-0000-4000-8000-000000000003'),
  (select review_sections  from offerings where id = '0a5e0001-0000-4000-8000-000000000003'),
  '[{"id":"trouble_serves","label":"Which serves give you the most trouble?","answer":"Anything short with sidespin. I either push it long or pop it up, and there is no third option yet."},
    {"id":"return_game","label":"How do you usually try to return?","answer":"I push almost everything and hope to get into the rally."}]'::jsonb,
  null, '2026-08-06 11:20:00+00', '2026-08-06 11:22:00+00', null, null, null,
  null, null, null, false, 'none', '2026-08-06 11:20:00+00'
),
-- Waiting on them: paid, no match sent yet.
(
  '0a5e0002-0000-4000-8000-000000000004',
  '0a5e0001-0000-4000-8000-000000000002',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'ad8652fd-6da7-4f19-95bc-7e175c8e3fc5',
  null,
  'awaiting_submission',
  2500, 'percent', 375, 2125, 3, 1,
  (select intake_questions from offerings where id = '0a5e0001-0000-4000-8000-000000000002'),
  (select review_sections  from offerings where id = '0a5e0001-0000-4000-8000-000000000002'),
  '[]'::jsonb,
  null, '2026-08-07 09:05:00+00', null, null, null, null,
  null, null, null, false, 'none', '2026-08-07 09:05:00+00'
)
on conflict (id) do update set
  status = excluded.status,
  match_id = excluded.match_id,
  price_cents = excluded.price_cents,
  fee_cents = excluded.fee_cents,
  coach_share_cents = excluded.coach_share_cents,
  intake_questions = excluded.intake_questions,
  review_sections = excluded.review_sections,
  intake_answers = excluded.intake_answers,
  promised_by = excluded.promised_by,
  paid_at = excluded.paid_at,
  submitted_at = excluded.submitted_at,
  accepted_at = excluded.accepted_at,
  delivered_at = excluded.delivered_at,
  completed_at = excluded.completed_at,
  review_viewed_at = excluded.review_viewed_at,
  testimonial = excluded.testimonial,
  testimonial_at = excluded.testimonial_at,
  testimonial_featured = excluded.testimonial_featured,
  sample_consent = excluded.sample_consent,
  created_at = excluded.created_at;

update coach_profiles
   set sample_order_id = '0a5e0002-0000-4000-8000-000000000002'
 where user_id = '07601580-0ce3-4a4f-82b0-10ea04cac180';

-- The work itself ------------------------------------------------------

delete from review_findings
 where order_id in ('0a5e0002-0000-4000-8000-000000000001',
                    '0a5e0002-0000-4000-8000-000000000002');

insert into review_findings (id, order_id, title, body, sort) values
-- In progress: the full match review Miguel is writing now.
(
  '0a5e0003-0000-4000-8000-000000000001',
  '0a5e0002-0000-4000-8000-000000000001',
  'The long serve is landing where he wants it',
  'Both of these are the same serve to his backhand at the same depth, and '
  'both times he steps around and opens on it. Watch how early he starts '
  'moving. Keep the serve, change where it finishes: wide to his forehand '
  'makes him reach, and a reaching player gives you the weak return you are '
  'waiting for.',
  0
),
(
  '0a5e0003-0000-4000-8000-000000000002',
  '0a5e0002-0000-4000-8000-000000000001',
  'You give up the table after the first block',
  'You block the first ball well and then take two steps back. From there '
  'every rally is his to shape and you are covering twice the width. Hold '
  'your ground and take the second ball early. It will feel rushed for a '
  'week and then it will feel normal.',
  1
),
(
  '0a5e0003-0000-4000-8000-000000000003',
  '0a5e0002-0000-4000-8000-000000000001',
  'The step around works, so go looking for it',
  'This is the point you want more of. You read the serve, step around, and '
  'the rally is over in two shots. You did it once in the whole match. Any '
  'serve that lands short in the middle is the same invitation.',
  2
),
-- Completed: the serve review he delivered in July.
(
  '0a5e0003-0000-4000-8000-000000000011',
  '0a5e0002-0000-4000-8000-000000000002',
  'Short to the middle is your best serve',
  'He never opens on this one. You get a passive push back almost every '
  'time, which is exactly what you want. This should be your default, not '
  'your variation.',
  0
),
(
  '0a5e0003-0000-4000-8000-000000000012',
  '0a5e0002-0000-4000-8000-000000000002',
  'The long serve always goes to the same corner',
  'Same speed, same depth, same corner. By the third game he was standing '
  'there before you served. Keep it in the match, but send it wide to his '
  'forehand and use it once or twice a game.',
  1
),
(
  '0a5e0003-0000-4000-8000-000000000013',
  '0a5e0002-0000-4000-8000-000000000002',
  'Be ready for the long push after the short serve',
  'The push comes back deep to your backhand nearly every time. You are '
  'still finishing your serve motion when it arrives. Recover a step earlier '
  'and this is a ball you can step around and finish.',
  2
);

insert into review_finding_points (finding_id, point_id) values
  ('0a5e0003-0000-4000-8000-000000000001', '06128a30-88a3-4330-8ab5-a5c002d1b4e8'),
  ('0a5e0003-0000-4000-8000-000000000001', '57b910d8-cda0-46ba-9557-533599ae45f9'),
  ('0a5e0003-0000-4000-8000-000000000002', '6855b8b6-9d49-45ea-b795-3c7163e8a31c'),
  ('0a5e0003-0000-4000-8000-000000000002', 'bcc69836-6692-4989-9da0-47fd62aa55e1'),
  ('0a5e0003-0000-4000-8000-000000000003', 'da63c438-9c8e-4917-9031-523003228a11'),
  ('0a5e0003-0000-4000-8000-000000000011', '06128a30-88a3-4330-8ab5-a5c002d1b4e8'),
  ('0a5e0003-0000-4000-8000-000000000011', 'da63c438-9c8e-4917-9031-523003228a11'),
  ('0a5e0003-0000-4000-8000-000000000012', '57b910d8-cda0-46ba-9557-533599ae45f9'),
  ('0a5e0003-0000-4000-8000-000000000012', '6855b8b6-9d49-45ea-b795-3c7163e8a31c'),
  ('0a5e0003-0000-4000-8000-000000000013', 'bcc69836-6692-4989-9da0-47fd62aa55e1')
on conflict do nothing;

-- The write-ups --------------------------------------------------------
-- The in-progress one is deliberately half written: two sections done,
-- three still blank, which is what the workspace looks like in real use.

insert into review_documents (order_id, sections, status) values
(
  '0a5e0002-0000-4000-8000-000000000001',
  '[{"key":"summary","label":"Summary","body":"Close match and it could have gone either way. The difference was the first three balls. He got to attack first far more often than you did, and almost every time it started from your long serve."},
    {"key":"strengths","label":"Strengths","body":"Your block is steady and you read his short serve well. When you commit to the forehand you win the point more often than not, and you are quicker across the table than he is."},
    {"key":"costing_points","label":"What is costing you points","body":""},
    {"key":"tactics","label":"Tactics","body":""},
    {"key":"practice_plan","label":"Practice plan","body":""}]'::jsonb,
  'draft'
),
(
  '0a5e0002-0000-4000-8000-000000000002',
  '[{"key":"summary","label":"Summary","body":"Your serve is doing its job whenever it is short. The long one is what turns the point over, and it went to the same place all match."},
    {"key":"serves","label":"Your serves","body":"Short to the middle is the one to build on. He pushed it back passively nearly every time and you had the first attack whenever you wanted it. The long serve to his backhand is the problem. Same speed, same depth, same corner, three games in a row, and by the end he was moving before the ball crossed the net."},
    {"key":"work_ons","label":"What to work on","body":"Make the short middle serve your default and serve it more than you think you need to. Move the long serve to his wide forehand and keep it to once or twice a game so it stays a surprise. Then practice the ball after it: the push comes back deep to your backhand, and if you recover a step earlier that is a ball you can finish."}]'::jsonb,
  'delivered'
)
on conflict (order_id) do update set
  sections = excluded.sections,
  status = excluded.status;

-- The roster-first coaching workspace --------------------------------
-- These rows are the story the coach landing page now leads with. John
-- is connected and has shared a match; Maya can be coached before she
-- creates an account; Priya shows a second connected student.

insert into coach_students (
  id, coach_id, player_id, display_name, name_from_account, created_at
) values
(
  '0a5e0004-0000-4000-8000-000000000001',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4',
  'John Miller', true, '2026-09-01 14:00:00+00'
),
(
  '0a5e0004-0000-4000-8000-000000000002',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  null,
  'Maya Chen', false, '2026-08-29 17:30:00+00'
),
(
  '0a5e0004-0000-4000-8000-000000000003',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '18844af1-9030-4507-bbbb-a488b5164294',
  'Priya Raman', true, '2026-08-26 12:15:00+00'
)
on conflict (id) do update set
  player_id = excluded.player_id,
  display_name = excluded.display_name,
  name_from_account = excluded.name_from_account,
  archived_at = null;

insert into lessons (
  id, user_id, transcript, takeaways, status, kind, created_at
) values
(
  '0a5e0006-0000-4000-8000-000000000001',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'Keep the elbow in front on the backhand block. Start with two controlled blocks, then change direction on the third ball. Finish with five minutes of short serve and receive.',
  '{"title":"Backhand block and first change","themes":[{"name":"Backhand block","points":["Keep the elbow in front and meet the ball earlier.","Make two controlled blocks before changing direction."]},{"name":"Next lesson","points":["Repeat the short serve and receive drill for five minutes."]}]}'::jsonb,
  'ready', 'coach', '2026-09-02 18:30:00+00'
),
(
  '0a5e0006-0000-4000-8000-000000000002',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'The forehand timing was better once the first step became smaller. Keep the body low and recover through the middle after the wide ball.',
  '{"title":"Forehand timing","themes":[{"name":"Timing","points":["Use a smaller first step so the swing starts on time.","Recover through the middle after the wide forehand."]}]}'::jsonb,
  'ready', 'coach', '2026-08-27 16:20:00+00'
),
(
  '0a5e0006-0000-4000-8000-000000000003',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  'Serve practice. Keep the same preparation for short backspin and long topspin. The contact point should stay hidden until the last moment.',
  '{"title":"Serve variation","themes":[{"name":"Serve","points":["Use the same preparation for both serves.","Hide the contact point until the last moment."]}]}'::jsonb,
  'ready', 'coach', '2026-08-29 17:45:00+00'
)
on conflict (id) do update set
  transcript = excluded.transcript,
  takeaways = excluded.takeaways,
  status = excluded.status,
  kind = excluded.kind,
  created_at = excluded.created_at;

insert into coach_entries (
  id, coach_id, student_id, lesson_id, shared_at, created_at
) values
(
  '0a5e0007-0000-4000-8000-000000000001',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '0a5e0004-0000-4000-8000-000000000001',
  '0a5e0006-0000-4000-8000-000000000001',
  '2026-09-02 19:00:00+00', '2026-09-02 18:30:00+00'
),
(
  '0a5e0007-0000-4000-8000-000000000002',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '0a5e0004-0000-4000-8000-000000000003',
  '0a5e0006-0000-4000-8000-000000000002',
  '2026-08-27 17:00:00+00', '2026-08-27 16:20:00+00'
),
(
  '0a5e0007-0000-4000-8000-000000000003',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '0a5e0004-0000-4000-8000-000000000002',
  '0a5e0006-0000-4000-8000-000000000003',
  null, '2026-08-29 17:45:00+00'
)
on conflict (id) do update set
  student_id = excluded.student_id,
  lesson_id = excluded.lesson_id,
  shared_at = excluded.shared_at,
  created_at = excluded.created_at;

insert into coach_student_invites (
  id, coach_id, student_id, token, created_at
) values (
  '0a5e0008-0000-4000-8000-000000000001',
  '07601580-0ce3-4a4f-82b0-10ea04cac180',
  '0a5e0004-0000-4000-8000-000000000002',
  '0a5e0008-0000-4000-8000-000000000099',
  '2026-08-29 17:50:00+00'
)
on conflict (id) do update set revoked_at = null;

commit;

-- A second coach, part way through setup -------------------------------
-- The "Set up your payouts" chapter needs the checklist in the state a
-- coach actually meets it, and Miguel is finished. Elena Duarte
-- (setup-demo@example.com) has one offering and nothing else, which is
-- what puts the coach hub into setup mode.

insert into player_profiles (user_id)
select 'c02832b6-cdb1-4417-bc85-228ee46a1083'
where exists (
  select 1 from auth.users
  where id = 'c02832b6-cdb1-4417-bc85-228ee46a1083'
)
on conflict (user_id) do nothing;

insert into coach_profiles (
  user_id, handle, display_name, headline, bio, credentials,
  stripe_account_id, charges_enabled, payouts_enabled, accepting_orders,
  published, samples
) select
  'c02832b6-cdb1-4417-bc85-228ee46a1083', 'elena', 'Elena Duarte',
  'Club coach', '', array[]::text[],
  null, false, false, true, false, '[]'::jsonb
where exists (
  select 1 from auth.users
  where id = 'c02832b6-cdb1-4417-bc85-228ee46a1083'
)
on conflict (user_id) do update set
  handle = excluded.handle,
  display_name = excluded.display_name,
  stripe_account_id = null,
  charges_enabled = false,
  payouts_enabled = false,
  published = false;

insert into offerings (
  id, coach_id, template_key, title, description, includes, price_cents,
  turnaround_days, followup_rounds, image, active, sort,
  intake_questions, review_sections
) select
  '0a5e0001-0000-4000-8000-000000000011',
  'c02832b6-cdb1-4417-bc85-228ee46a1083',
  'full_match', 'Full match review',
  'A game by game read of one scored match.',
  array['Every game reviewed', 'A practice plan'],
  4000, 5, 1, 'stock:full-match', true, 0,
  '[{"id":"goal","label":"What do you want out of this review?"}]'::jsonb,
  '[{"key":"summary","label":"Summary"},{"key":"notes","label":"Notes"}]'::jsonb
where exists (
  select 1 from coach_profiles
  where user_id = 'c02832b6-cdb1-4417-bc85-228ee46a1083'
)
on conflict (id) do update set active = true;
