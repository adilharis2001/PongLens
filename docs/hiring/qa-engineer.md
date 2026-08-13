# QA Engineer (part time, ongoing) — PongLens

## About PongLens

PongLens is a performance hub for competitive table tennis, live at
ponglens.com. A player records a match on their phone, uploads the video,
and gets back the match with the dead time removed and every point cut into
its own clip. They score the points in a few minutes of tapping, and from
that scoring the app builds their stats, pressure points and placement maps.
They can write notes on any point, keep a journal, share a point or a whole
match with a link, and bring a coach in to leave notes on the work.

There is a second side to the product. Coaches set up a public page, list
paid review offerings at their own price and turnaround, and deliver written
reviews on footage that is already cut into points. Money runs through
Stripe Connect.

A few things that shape the testing:

- **It is mobile first.** Most use is a phone browser. There is no app to
  install. Desktop matters, but a bug that only shows on an iPhone is still a
  real bug and often the more important one.
- **It is a video product.** Playback, scrubbing, fullscreen, rotation and
  audio are the product, not decoration. Most of the interesting bugs live
  there.
- **Processing is asynchronous.** An upload goes into a queue, a worker
  processes it, and the player gets an email when it is ready. Testing a full
  flow means starting a job and coming back to it.
- **It is small and moves fast.** Things ship most days. We need someone who
  catches the thing that quietly broke last week.

## Scope of work

Roughly 5 hours a week, split like this.

### Player flow, end to end (about 2 hrs/week)

- Sign in, upload a match video, and import a match from a YouTube link
- Watch the job through to completion: progress, the email, failure states,
  what happens if you close the tab mid upload
- The match page: the cut video, the point list, per point clips, scoring the
  points, placement maps, notes and voice notes, tags and starred points
- Journal, stats, share links, clip export, account and storage settings
- Cross browser on desktop (Chrome, Safari, Firefox) and on a real phone
  (iOS Safari and Android Chrome)

### Coach flow, end to end (about 1 hr/week)

- Coach onboarding, public coach page, creating and editing offerings
- The full order lifecycle: a player buys a review, submits a match, the
  coach reviews it, asks for clarification, delivers, and it completes. Also
  the unhappy paths: declined, cancelled, refunded
- Coach sharing: a player shares matches with a coach, the coach leaves notes
  on points, the player revokes access
- All payments run in Stripe test mode on a QA account we set up for you. You
  will never use a real card and never handle real money

### Test suite maintenance (about 1 hr/week)

- Log every run in a shared doc: flow name, device and browser, steps,
  expected versus actual
- Keep the test cases current as the UI changes. When a flow changes, the
  case changes in the same week

### Bug reporting (about 0.5 hr/week)

Report through Upwork messages or the in app feedback link, with:

- A clear title and description
- Steps to reproduce, and how often it reproduces
- A screenshot or, better for anything involving video, a screen recording
- Device, browser and viewport
- The match ID and the timestamp in the video when it is a video or accuracy
  issue. "The cut felt wrong" is not actionable. "Match a1b2, the cut drops
  the rally at 4:12" is
- A category: functional, UX, performance, or accuracy

### Ad hoc and future scope (about 0.5 hr/week)

- Extra passes when a new feature or a significant fix ships
- Quick UX suggestions where something is confusing rather than broken
- Later: define and build automated regression scripts. We already use
  Playwright in the repo, so that is the natural starting point

## Judging computer vision output

Part of this job is not pass or fail. The cut and the point splitting come
from a vision pipeline, and they are sometimes wrong in ways only a person
watching can see. We need someone who will:

- Notice when real play was cut out, which is far worse than dead time left in
- Notice when two points were merged into one clip, or one point split into two
- Sanity check placement maps against what actually happened in the rally
- Report it with the match and the timestamp, so we can reproduce it against
  the same footage

You do not need to know table tennis to do this, but it helps a lot. If you
play, say so.

## What we are looking for

- Real QA or front end testing experience on web apps
- Comfortable testing on a real phone, not just a desktop browser resized down
- Comfortable writing and maintaining simple test suites in Sheets or Notion
- Detail oriented. Spots broken inputs, misaligned layouts, and the edge case
  nobody thought about
- Good judgement on video and model output, not only on deterministic pass
  or fail checks
- Clear written English. Reproducible steps beat long descriptions
- Proactive async communicator, responsive within 24 hours
- Owns a desktop and at least one phone. Access to both an iPhone and an
  Android device is a real advantage
- Bonus: table tennis or another racket sport
- Future scope: willing to research and bring your own automation tooling
  (Playwright preferred, Cypress or Selenium considered)

## Tools and environment

- You provide and manage your own testing tools and environment: browsers,
  devices, screen recorder, whatever framework you prefer. No software
  licenses will be provided
- We provide a QA account with test mode billing, a processing quota, and
  sample match footage if you do not have your own
- You will be testing against the live site with real data. Treat share links
  and any player footage you see as confidential

## Compensation and schedule

- Rate: up to $5 USD/hour
- Hours: up to 5 hrs/week
- Engagement: ongoing, starts immediately
- Communication: asynchronous via Upwork, with a brief weekly check in

## How to apply

In your proposal, please include:

1. A bug report you have written before, or a short one for any app you use.
   We care more about how you write it up than about what you found
2. The devices and browsers you can test on
3. Whether you have tested a video heavy or media heavy product before

## Video resources

These walk through the whole product. Watch them before your first test cycle.

1. **Product walkthroughs** — https://www.ponglens.com/videos
2. **Tutorial course** — https://www.ponglens.com/learn/videos
   (sign in first with the account we give you)
