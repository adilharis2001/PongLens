# Player coaching workspace: build 151

Released September 7, 2026 from `player-coaching-workspace`, pushed to `main`
in seven commits from `6f2e55ca` to `449d1e58`.
Design: `docs/superpowers/specs/2026-09-06-player-coaching-workspace-design.md`.

- Players get a **Coaching tab that is always there**, on iOS, desktop web and
  mobile web: one feed of everything between a player and the people who coach
  them, newest first, narrowed by a chip per coach, with that coach's own page
  one tap behind the card the chip reveals. It replaces three sections that
  each answered part of the question and none of it in order.
- The tab used to appear only once somebody else acted, worked out with two
  queries and cached in `sessionStorage`. On iOS it was gated on
  `AppConfig.coachMarketplace`, which is false because paid reviews are
  web-only, so the free half of coaching had been hidden behind a paid flag
  and nobody had ever seen it.
- **The Journal's tabs are fixed and equal**: All · Matches · Coaches · Stats,
  plus Recollect when it is on. The fifth used to be off the edge of a 393px
  phone. There is no Notes tab; a player's own entries were never a category
  anybody asked for, and they are part of All.
- **Stats are in the Journal**, a copy of My stats mounted only when the tab
  is opened. The points walk is now shared between Home, `/stats` and the
  Journal, so a session counts them once instead of three times.
- **New entry in the Journal is a note**: no coach line, no share toggle,
  saved as `practice`. Lessons are made in Coaching and always say who taught
  them, with **No coach** as an honest answer.
- **`kind` is where the entry was made**, not whether a coach happened to be
  named. Deriving it from the coach is what let a note about your own practice
  become a lesson because you mentioned somebody in it.
- **A player can record a lesson**: written anywhere, spoken on the iPhone,
  or a video imported for a recap. Sharing it with the coach asks every time
  and is off unless they say so, and can be taken back afterwards.
- **A lesson video's original counts against the player's storage**, which it
  never did, so an import could not be refused. An over-limit import now
  offers Request more storage rather than only saying no.
- **Ask can find what a video taught.** A recap's journal entry is one line of
  URL; the twelve chapters behind it were not in the corpus at all.
- The workspace switcher names the side it goes to: **Coach mode / Player
  mode** on desktop, **Coach / Player** where the top bar also carries the
  bell and the avatar.

## Production database

Six migrations applied through the Supabase tooling and verified as recorded.
The files on `main` carry those exact versions.

| Version | Name |
| --- | --- |
| `20260907133605` | `player_coaching_workspace` |
| `20260907133730` | `player_coaching_workspace_grants` |
| `20260907134300` | `student_lesson_notification_kind` |
| `20260907140654` | `player_coaching_workspace_revoke_public` |
| `20260907141229` | `admin_allowance_counts_lesson_originals` |

The first adds `lesson_videos.coach_ref_id` with a check that a video names a
student or a coach and never both, `lesson_video_access()`, the `p_share`
branch on `publish_lesson_video`, `lesson_video_id` on
`student_shared_lessons()`, the `student_lesson` bell, the `/coaching?entry=`
href, lesson-video originals in `my_storage_state`, and the one-off `kind`
normalisation (two rows).

The other four are corrections, described below.

## Two things that were briefly wrong in production

**`publish_lesson_video` was callable by anyone, for about forty minutes.**
Adding its third argument meant dropping and recreating it, and `drop
function` takes the function's privileges with it while a new function is
granted `EXECUTE` to `PUBLIC` by default. The function is `SECURITY DEFINER`,
never reads `auth.uid()`, and takes the owner as an argument, so a caller
knowing a video id and its owner id — both of which the API hands to a
shared-with coach — could have published or re-shared somebody else's recap
and read the whole row back, transcript included.

The first correction (`..._grants`) revoked from `anon` and `authenticated`
and did not close it, because both inherit `EXECUTE` from `PUBLIC`. Worse, the
check that said it was fixed was wrong in an instructive way: it joined
`aclexplode()` to `pg_roles`, and `PUBLIC` is grantee 0 with no row in
`pg_roles`, so the join dropped exactly the grant that mattered. Read `proacl`
directly instead — the `PUBLIC` grant is the entry with an empty grantee,
`=X/postgres`.

Closed by `..._revoke_public` and confirmed from outside the database:
`publish_lesson_video`, `lesson_video_access` and `student_shared_lessons` all
answer an anonymous caller holding the site's own anon key with `42501
permission denied`, and `publish_lesson_video`'s ACL now matches
`complete_lesson_video`'s exactly. Nothing in the logs shows a call.

**Sharing a lesson with a coach failed outright, for about seven minutes.**
`notifications.kind` is an allow-list and `student_lesson` was not on it. The
bell's trigger fires AFTER the write on `lessons`, so the constraint did not
merely lose the notification: it failed the share. Found by review before any
user reached it. Fixed by `student_lesson_notification_kind`, then walked end
to end inside a rolled-back transaction: a lesson shared with a connected
coach writes "&lt;Student&gt; shared a lesson" to that coach, pointing at their
student page.

## Review

Six reviewers over the diff — authorisation, correctness, runtime failure,
the four surfaces, copy and layout, and the migration read as if it had to be
applied to a live database tonight — with every finding judged by three
skeptics each told to refute it. Twenty survived. All twenty are fixed. The
two above were the serious ones; the rest:

- The iOS coaching feed listed **every published recap twice**. The guard that
  skips a recap whose journal entry is already in the feed reads
  `lesson_video_id`, and the journal's own query never selected it, so the
  guard could not once have matched.
- The Journal's Stats tab said **"Counting points…" for ever** on an account
  with no matches, which is the account most likely to open it first: the walk
  returned before recording that it had finished. It also showed that line
  above the sections' own "nothing to count yet", which is two answers to one
  question.
- A dual-role account saw its **students' notes** in the feed of what its own
  coach had said. `note_feed` carries every match the viewer may read, and
  only the author was being checked, not the owner.
- The bell sent a coach's "your student shared a lesson" to the **player's**
  Coaching tab, because `/coaching/students` starts with `/coaching`.
- An **interrupted lesson import from the phone could never resume**. The
  create call compares the ids as strings, and Foundation encodes a Swift
  `UUID` in upper case while Postgres hands its `uuid` columns back in lower,
  so the retry compared the row against itself, decided it was a different
  video and returned 409 for ever, with a 20 GB file stranded on the phone.
  The student id beside it had the same fault and the same fix. Pre-existing
  for a coach's import; this change would have extended it.
- `my_storage_state` counts a lesson video's original now and
  **`admin_allowance_players` did not**, so the page an admin opens to answer
  a storage request showed 11.6 GB less than the number that refused the
  upload. The two statements of one rule now move together, and agree.
- Ask learned to cite a lesson recap and **neither surface knew the word**:
  the web rendered no label at all and the phone rendered "Lesson_Recap" and
  would not open it.
- A **source-contract test** still asserted a recap sends a reader to the
  Journal. It goes to Coaching now.
- The Journal's per-tab empty line still named two tabs this change deleted,
  so the Coaches tab said "Nothing found." to a player who has no coach yet.
- A match shared with two coaches was two feed rows under one React key.
- "Nothing with this coach yet." was shown with no coach selected;
  "Not on PongLens · Not connected" said one fact twice; the bell's deep link
  re-scrolled the feed on every render; the coach's page listed the lessons on
  the phone and not on the web; `/coaching/coach` had no heading; and
  "Sees only the matches you share with them from a match page" stopped being
  true when Share a match arrived on the coach's own page.

## Web

`main` deploys to `www.ponglens.com` through Vercel. `/coaching/coach`,
`/coaching/coach/[id]` and `/coaching/import` are live and resolve.

The full `npm run build` passes. Every suite passes: journal 81, ask 33,
commerce 29, qa 71, reviews 31, match-structure 133, costs 179, starred 11,
upload 27, email 48, placement 103, coach-landing 2, and lessonVideo 19.
`workspaceModel.test.ts` gains four cases pinning the player's rooms under
`/coaching` as player territory, so opening a coach's page cannot flip a
dual-role account into coach mode. That is the bug 157 fixed once already,
arriving from the other side.

## iOS

`ios/Tests/run.sh` passes 683/683 and `ios/Tests/LessonVideo/run.sh` passes.
Version 1.0 build **151** archived and uploaded to App Store Connect.

Build 150 was uploaded first and is superseded: it was archived before the
review's last iOS fix landed. **Install 151.**

Archive: `/tmp/PongLens-coaching-1.0-151.xcarchive`.
Logs: `/tmp/ponglens-151-archive.log`, `/tmp/ponglens-151-export.log`.

## Not verified

- **Nothing behind sign-in was exercised.** The iPhone 17 Pro simulator is
  signed out, and signing in needs a one-time code, which is Adil's to enter.
  The app builds, installs, launches and reaches the sign-in screen; every
  signed-in flow — the Coaching feed, the chips, the coach's page, New lesson,
  the Journal's five tabs, the Stats tab — has been read and compiled but not
  seen running against a real account. The same is true of the web: the pages
  resolve and redirect correctly, but no signed-in page was rendered.
- **No lesson video was imported end to end as a player.** The schema, the
  API, the access function and the share path were each checked directly
  against production, and the bell was walked end to end in a rolled-back
  transaction, but no file was uploaded.
- **The 393×660 layout was reasoned about, not photographed.** The Journal's
  five tabs are equal `flex-1` cells: at 393px the column is 353px, five cells
  are 69px each, and "Recollect" needs about 64 at 13px, which is why the
  horizontal padding is `px-0.5` below `sm`. `truncate` is the fallback on a
  narrower phone than any we test.
- **A shared-note notification written from now on carries
  `/coaching?entry=<id>`.** Build 151 and the deployed web open it. An iOS
  build older than 151 matches none of its href prefixes, so the bell row does
  nothing when tapped; the entry is still in the Journal's Coaches tab and in
  the Coaching feed. This affects a student on an old build whose coach shares
  a written note, until they update.
- **Reviews bought are not in the iOS coaching feed**, by design — paid
  reviews are web-only on iOS. They were on the old Coaching screen, which
  nobody could reach.
