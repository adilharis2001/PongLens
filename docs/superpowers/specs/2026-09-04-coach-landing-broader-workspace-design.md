# Coach landing page: the broader coaching workspace

**Date:** 2026-09-04
**Status:** Approved in chat; implementation pending

## Purpose

The current `/coaches` page presents PongLens as a paid match-review
marketplace. That was accurate when the page was built, but the coaching
product is now broader and roster-first.

The revised page will present PongLens as the place where a table tennis
coach keeps each student's lesson entries and matches together. Paid match
reviews remain part of the product, but they move to the end as an optional
extension rather than defining the page.

## Product truth the page must reflect

The coach workspace currently supports:

- a roster containing students who are or are not yet on PongLens;
- student invite links, with the student choosing whether the coach sees all
  matches or only individually shared matches;
- a private journal under each student;
- typed and dictated entries with photos and links;
- improving and editing an entry before or after sharing;
- sharing an entry into the student's journal and stopping sharing later;
- public links to individual entries;
- linking an entry to one of the student's matches;
- watching shared matches point by point and leaving written, drawn, or voice
  feedback on the relevant rally;
- long-form audio lesson recording and transcription on iOS;
- paid match-review offerings, orders, delivery, and payouts on the web.

Video lesson recording is near-term functionality. It may appear on the page
only when it is explicitly described as coming soon until the feature ships.

## Positioning

The page is about the continuing coach-student relationship, not primarily
about selling services.

The hierarchy is:

1. Students and their records.
2. Lesson entries and recordings.
3. Sharing with the student.
4. Matches and point-specific feedback.
5. Paid reviews, when the coach wants them.

The writing remains calm, plain, and specific. It avoids business-software
language, sales framing, slogans, idiom, and unsupported promises. Each
section heading stands on its own without an explanatory subtitle.

## Page structure and copy

The current six-part rhythm remains:

1. Hero
2. Feature cards
3. Main video
4. Screenshot walkthrough
5. FAQ
6. Closing call to action

### Hero

**Heading**

> Keep every student, lesson and match in one place.

**Body**

> Add the students you coach and keep a journal for each one. Record or write
> what you worked on, share it when it is ready, and open the matches they
> send you from the same place.

**Primary action:** `Set up coach mode`
**Secondary action:** `See how it works ↓`

The primary action must enter the general coach onboarding flow rather than
requiring the visitor to create a paid-review storefront first.

The wide-screen hero composition will show the roster or a student page as
the main object, with a lesson entry or recording state as the supporting
object. It will no longer lead with a review workspace and payout screen.

### Feature cards

**Heading**

> Built around your students

Six cards:

1. **Your students**

   > Add every student you coach, whether or not they use PongLens yet. Their
   > lesson entries and matches stay together under their name.

2. **A journal for each student**

   > Keep lesson notes, drills, photos and links under the student they belong
   > to. Entries stay private until you decide to share them.

3. **Record the lesson**

   > Record a lesson on your iPhone and PongLens prepares the transcript and
   > notes while you coach. Audio recording is available now, with video
   > recording coming soon.

4. **Share when it is ready**

   > Send an entry directly to your student's journal. If you change it later,
   > they see the updated version, and you can stop sharing at any time.

5. **Their matches beside your notes**

   > The matches a student shares appear on their page. Watch them point by
   > point, then write, draw or leave a voice note on the exact rally you mean.

6. **Paid reviews when you want them**

   > Offer structured match reviews with your own price, scope and turnaround.
   > PongLens handles the order, payment and delivery.

The existing speech-to-text and point-linking animations may be adapted. The
roster, journal sharing, and lesson recording need new hand-built Motion/CSS
animations. These remain code-native animations, consistent with the current
page; they are not generated raster artwork.

### Main video

**Heading**

> See coaching on PongLens

The existing coach video cannot remain because its entire narrative is an
order moving from offering to payout. It will be rebuilt through the existing
scripted capture pipeline, with separate desktop and mobile cuts.

The replacement video follows this sequence:

1. Add students, including students without PongLens accounts.
2. Invite a student and show the student's access choice.
3. Write or dictate a lesson entry and add a photo or link.
4. Record an audio lesson and review the prepared transcript and notes.
5. Share the entry into the student's journal.
6. Open a shared match and add feedback to an exact rally.
7. Show paid match reviews as an optional extension.
8. Close on students, lesson notes, and matches staying together.

The script will use the existing coach-video rules: plain language, no idiom,
real staged accounts only, section cards covering navigation and load time,
and a full watch-through of both finished cuts before publishing.

Video lesson recording may be named as coming soon, but the video must not
show a working flow until that flow exists in the build being captured.

### Screenshot walkthrough

**Heading**

> Start with one student

Seven chapters:

1. **Add a student**

   > Add their name before they have an account. You can start keeping lesson
   > entries straight away and connect them later.

2. **Send their invite**

   > The invite connects the student to the name already on your list. They
   > choose whether you see every match or only the ones they share.

3. **Write a lesson entry**

   > Type, paste or dictate what you worked on. Add a photo or a link, and
   > improve rough notes before you save them.

4. **Record the lesson**

   > Put your iPhone near the table and record the session. Review the
   > transcript and prepared notes before they are filed under the student.

5. **Share it with them**

   > An entry stays private until you share it. It then appears in the
   > student's journal, and any later edits appear there too.

6. **Open their matches**

   > The matches they share sit beside their lesson entries. Watch them point
   > by point and leave feedback on the rallies that matter.

7. **Offer a paid review**

   > Paid reviews are optional. Set what the review includes, what it costs,
   > and how many days you need.

The screenshots will be recaptured from the real current app. A new asset name
will be added for every new state instead of silently repurposing an unrelated
old capture.

### FAQ

**Heading**

> Questions

1. **What can I use PongLens for as a coach?**

   > PongLens gives you a place for every student you coach. Keep lesson
   > entries, share notes and materials, open the matches they send you, and
   > offer paid match reviews if you want to.

2. **Do my students need a PongLens account?**

   > Not for you to add them or keep private entries about their lessons. You
   > can send an individual entry as a link, or invite them to connect their
   > account. Once connected, shared entries appear in their journal and the
   > matches they share appear on their student page.

3. **What can I see from a student's account?**

   > Only the matches they give you access to. When they join, they choose
   > whether to share every match or share them one at a time. You cannot see
   > the rest of their account or their private journal.

4. **How does lesson recording work?**

   > On iPhone, put your phone near the table and record the lesson. PongLens
   > turns the recording into an editable transcript and prepares the main
   > points for you to review. Video lesson recording is coming soon.

5. **Can I edit an entry after sharing it?**

   > Yes. Shared entries are live. Your student sees the updated version in
   > their journal, and you can stop sharing whenever you need to.

6. **Does the coach workspace work on both iPhone and the web?**

   > Student management, lesson entries and shared matches are available on
   > iPhone and the web. Long lesson recording is currently on iPhone. Paid
   > review orders are managed on the web.

7. **What does it cost?**

   > Managing students, sharing lesson entries and reviewing shared matches is
   > free. If you sell a paid match review, a small platform fee comes off the
   > order. Card processing is included.

8. **Can I still offer paid match reviews?**

   > Yes. You choose the price, what the review covers and how many days you
   > need. The student sends a match and their questions, and nothing starts
   > until you accept.

9. **Can my students see each other?**

   > No. Each student sees only the entries you share with them. Their matches,
   > lesson entries and account details are not visible to your other students.

### Closing call to action

**Heading**

> Start with one student.

**Body**

> Add their name, write the first entry, and invite them when you are ready.

**Button:** `Set up coach mode`

## Metadata and navigation

The page title remains `PongLens for coaches`.

The metadata description becomes:

> Manage your table tennis students, keep and share lesson notes, record
> lessons, review their matches, and offer paid match reviews from one
> coaching workspace.

The JSON-LD service description and type will describe the broader coaching
workspace. Paid match reviews become one feature instead of the service name.

On `/coaches`, the header's feature link will target the coach feature section
instead of `/#features`. The footer will offer `For players` linking to `/`
instead of linking back to the current coach page.

## Responsive behavior

The current page measurements remain the baseline:

- `max-w-6xl` content columns and the current section rhythm;
- six-card grid on medium and larger screens;
- horizontal feature carousel with the next card visible on mobile;
- screenshot track and numbered chapter controls on mobile;
- screenshot track with chapter list on desktop;
- separate portrait and landscape video cuts selected by the existing shared
  video component;
- reduced-motion behavior for every new animation.

The finished page will be checked at desktop width and at `393 × 660`, the
project's real mobile-browser viewport.

## Verification

Before completion:

1. Run lint and the relevant landing/QA tests.
2. Build the Next.js app.
3. Render `/coaches` signed out at desktop width and `393 × 660`.
4. Confirm every anchor and call to action reaches the intended section or
   onboarding path.
5. Confirm reduced-motion variants remain understandable.
6. Confirm no section promises working video lesson recording before release.
7. Regenerate and inspect every new showcase screenshot.
8. Watch the complete desktop and mobile coach videos, including captions,
   before replacing the published files.

## Scope boundary

This work updates the public coach landing page and its marketing assets. It
does not change coach-workspace product behavior, data access, pricing, or the
release state of lesson video recording.
