# Player coaching workspace, a simpler Journal, and lessons students record

**2026-09-06.** Against `main` at `59422f24`. Decided with Adil in chat the
same day; the questions still open are at the end. Nothing here is built.

---

## 1. What this is

Players get a Coaching tab that is always there, on iOS, desktop web and
mobile web. It is where a player sees everything between them and their
coaches, filtered by coach, and where they record a lesson themselves:
written, audio on iPhone, or a lesson video imported for a recap. The
Journal keeps every note in one queryable place and gets fixed tabs. The
coach's workspace does not change shape; it gains the ability to read what a
student shares.

Decided with Adil on 2026-09-06:

- **Feed first.** The tab opens on one feed across all coaches, with coach
  filters that cannot be missed. A coach's page is one tap away.
- **Journal tabs are fixed:** All · Matches · Coaches · Stats, plus Recollect
  only when it is switched on.
- **A Journal note is a reflection.** It no longer asks who taught it. A
  lesson is made from Coaching and always answers that question, with
  "No coach" as an honest answer.
- **Sharing a lesson with the coach asks every time and defaults to not
  shared**, the rule the journal already has.
- **Only the owner edits a recap.** A coach given access reads it.
- **Every player may import a lesson video.** It counts against their
  storage allowance and nothing else for now.
- **No audio recording on the web, for anyone.** Web offers written lessons
  and video import; iPhone offers all three.
- **Stats are copied into the Journal, not moved, until they are fast.**
  Tactics stays on the Stats page.
- **The coach gets a bell** when a student shares a lesson with them.
- **Names:** Coaching for the tab, New lesson for the button, the coach's
  name for their page. The workspace switcher stops saying "Coaching":
  Coach mode / Player mode on desktop, Coach / Player on a phone.
- **The Journal's Coaches tab** holds your lessons and the entries and
  recaps coaches shared with you; coach notes on matches stay under
  Matches. **All** includes match and point notes, and every note carries
  the link to its point or match.
- **Share a match from the coach's page**, several at once, is in this
  round.
- **Chooser wording:** Write a lesson note · Audio record a lesson · Import
  a lesson video.

---

## 2. What exists today, and why it matters

- **The player Coaching tab is half built on both platforms.** Web:
  `/coaching` in player mode shows coach match notes, reviews bought and the
  coach list, and the tab appears only for players who have a coach or
  bought a review (`useStudentSide` in `AppNav.tsx`). iOS: `CoachingScreen`
  is wired as a fourth tab but gated on `AppConfig.coachMarketplace`, which
  is false, so nobody has seen it. The tab gets its own switch; the
  marketplace flag keeps gating paid reviews on iOS.
- **"From Coaches" is two sources under one name.** In the Journal it is
  entries a coach shared (`coach_shared_entries()`). On the Coaching page it
  is notes a coach left on your matches (`note_feed` rows by another
  author). Both come to the feed, labelled apart.
- **Audio lessons already exist for players on iPhone** (`LessonRecordScreen`,
  reached from the Journal's New entry). They move; nothing is built.
- **Video lessons are coach-only in three places, none a flag.** The API
  refuses non-coaches for create, edit, retry and share; `publish_lesson_video`
  requires a student on the owner's roster; the entry it writes lands in the
  owner's journal as `kind='coach'` and reaches the student through
  `coach_entries`. The student direction is new.
- **Several coaches per player already works in the data.** `player_coaches`
  is one row per coach (partial unique on player and coach); `coach_links`
  may hold many rows per pair. Live on 2026-09-06: 8 players have a coach,
  1 has two.
- **Stats have no RPC, view or cache.** `/stats` loads every live point of
  every match in sequential pages and folds them in the browser
  (`useAggregate.ts`); Home's "Your game" card and every Ask question do the
  same; iOS walks the same points at launch (`ScoresStore`). Adil's account
  is 113 matches and 7,781 points.
- **A lesson video import is not checked against storage.** `create` only
  bounds unfinished imports at eight. The worker writes the recap, playback
  and poster to `storage_ledger`; the original, up to 20 GB, is never
  written. Delete reverses what was written.
- **Ask sees a video recap only as the link in its entry text.** The chapter
  notes live in `lesson_videos.edit` and are not in the corpus.

---

## 3. The Coaching tab

### Where it sits

- **iOS:** `MainTab.coaching` becomes permanent; `CoachingStore.showTab` no
  longer depends on the marketplace flag. Tab bar: Home · Matches · Journal
  · Coaching. The New lesson action is drawn the way the Journal's New
  entry is (`PLFab`), on this tab only.
- **Web:** Coaching joins `TABS` in `AppNav.tsx` for every player; the
  `useStudentSide` gate and its session cache go. Desktop keeps the Upload
  pill. The mobile bottom bar has four items; check at 393 that no label
  wraps.
- **Web addresses.** `/coaching` stays shared ground and renders the player
  feed in player mode, as now. Player pages live at `/coaching/coach/[id]`,
  `/coaching/lesson/new`, `/coaching/lesson/[id]` and `/coaching/import`.
  `routeTerritory` in `workspaceModel.ts` must name these as player
  territory before the rule that gives everything under `/coaching/` to the
  coach, or opening one flips a dual-role account into coach mode. That is
  the bug 157 fixed once already, arriving from the other side.

### The feed

One list, newest first, of everything between the player and their coaches:

| Item | Source | Opens |
| --- | --- | --- |
| An entry a coach shared with you | `coach_shared_entries()` | the entry sheet; a recap opens the recap |
| A note a coach left on your match or point | `note_feed`, author not you, match yours | the match at that point |
| A lesson you wrote or recorded | `lessons`, `kind='lesson'`, yours | the entry, with its coach line and share state |
| A recap you imported | `lesson_videos` you own | the lesson video page |
| A match you shared with a coach | accepted `coach_links` rows | the match |
| A review you bought (web only) | `student_review_orders()` | the order |

Each row names the coach it belongs to. Coach match notes and shared entries
read "From Jonathan"; your own lessons read "Lesson with Jonathan" or
"Lesson"; a shared match reads "Shared with Jonathan". Entry cards reuse the
Journal's dress (`SharedEntryCard`, `LessonCard`; `CoachSharedEntryCard` on
iOS) so the two places look like one product.

### Filtering by coach

A chip row directly under the title: **All**, one chip per coach from
`player_coaches_list()`, and **No coach** when any lesson has none. A chip
filters the feed. When a coach is selected, a card sits at the top of the
feed with their name, status (Connected · Invite waiting · Not on PongLens)
and access (All matches, or how many matches are shared), and a **Manage**
button to their page. The card is how the page is found; the chips are how
the feed is filtered. Both are visible without scrolling on a 393 phone.

### The coach's page

Title is the coach's name. Everything that lives today in `SharingSection`
(web) and `CoachAccessList` / `CoachLinksManager` (iOS) moves here with its
behaviour unchanged:

- status and, for a waiting invite, Copy link and Revoke;
- access: **All matches** / **Only matches I share** (`set_coach_access`, or
  `all_matches` on a pending row);
- **Matches**: the matches shared with them, each revocable
  (`CoachSharedWith`), plus **Share a match**, a multi-select over the
  library. This is the one new sharing control, the "share these five" the
  2026-09-04 spec listed as missing;
- **Entries shared**: the journal entries and recaps they can read, each
  with Stop sharing;
- **Lessons with this coach**: the feed filtered to them;
- **Manage**: Rename in your journal, Same as an existing coach
  (`merge_player_coaches`), Remove coach (`leave_coach`).

Account keeps one row, "Your coaches", that opens the Coaching tab. Web
`/coaching` in player mode stops rendering `SharingSection` inline.

### New lesson

A chooser in the same dress as the Journal's New entry (`PLChooserSheet`;
`FabButton` and a sheet on the web):

| Row | iPhone | Web | What it does |
| --- | --- | --- | --- |
| **Write a lesson note** | yes | yes | the Journal composer with a "Who taught it?" line at the top |
| **Audio record a lesson** | yes | no | `LessonRecordScreen`, unchanged, with the same coach line |
| **Import a lesson video** | yes | yes | the existing import, with a coach picker where the student picker is |

The coach line is the existing `CoachPicker` / `CoachPickerRow` with three
answers: a coach from the list, a new name typed in (creates a
`player_coaches` row, as today), or **No coach**. It must be answered before
Save. Under it, the existing share toggle, off by default, worded "Share
with Jonathan". No toggle when the answer is No coach or the coach is not
connected; the entry can be shared later from the coach's page.

**Every lesson saves `kind='lesson'`.** The 2026-09-04 rule, kind derived
from whether a coach is attached, becomes: kind is where the entry was made.
Coaching writes `lesson`, the Journal writes `practice`, coaches write
`coach`. Labels stay derived from `coach_name`: "Lesson with Jonathan",
"Lesson", "Note". Nothing else reads `kind` for display.

### Empty state

With no coaches and no lessons: "No coaches yet." with **Add a coach** (the
existing invite creation with its three scopes) and New lesson still
present, because a lesson with No coach, or with a coach who is not on
PongLens, is allowed. With lessons but no coaches: the feed, and Add a coach
where the chip row would be.

### Everything that pointed at the Journal for coach things

- `coach_entries_notify` writes `href` `/journal` for a note. It becomes
  `/coaching?entry=<id>`; a recap keeps `/lesson-video/<id>`. Older iOS
  builds that do not know the new href fall back to the Journal, which still
  lists the entry under Coaches.
- `/join/[token]` lands on `/coaching` instead of `/journal?from=coach`.
- iOS Home's unseen-shared-entry card opens the Coaching tab.
- `NotesFeed` drops `?from=coach`.

---

## 4. The Journal

### Tabs

    All · Matches · Coaches · Stats [· Recollect]

Fixed, equal-width segments in one row, no horizontal scroll, on both
platforms (`JournalScreen.tabs`, the tab bar in `NotesFeed.tsx`). Five short
words should fit a 393 phone at the current pill size; verify, do not
assume. Recollect appears only when `recollect_preferences` has it on, as
now.

| Tab | Shows |
| --- | --- |
| All | everything you can read: your notes, your lessons, entries and recaps coaches shared, match and point notes |
| Matches | match and point notes, yours and your coaches', grouped by match as now |
| Coaches | your lessons (`kind='lesson'`) and the entries and recaps coaches shared with you; coach match notes stay under Matches |
| Stats | My stats, below |
| Recollect | unchanged |

**Every match or point note carries its link.** In All, in Matches and in
the Coaching feed, a note on a point opens that point and a note on a match
opens that match, on every platform. That is how a coach's remark and the
rally it is about stay one tap apart.

The tag rail, search, Ask and the Working on card do not change. Ask's
corpus already includes coach-shared entries; it gains recap chapter text
(section 5).

### New entry is a note

The Journal's New button opens the composer titled **New note** with no
coach line and no share toggle, saving `kind='practice'`. Dictation, Scan
pages, Attach photo, tags and Improve with AI stay. On iPhone the New entry
chooser goes: the button opens the composer directly. Editing an existing
entry (`NoteEditor`, `JournalNoteEditor`) shows the coach line and share
toggle only for `kind='lesson'` rows.

One-off normalisation in the migration: `kind='lesson'` where
`coach_ref_id is not null or coach_name <> ''` and `kind='practice'`, so the
few notes that gained a coach after the 2026-09-04 change read as lessons.
`MoveToCoach.tsx` and the unused imports at the top of `NotesFeed.tsx` are
deleted.

### Stats

A copy of **My stats** from `/stats`, rendered inside the Journal. Rules:

- **Nothing is fetched until the tab is opened**, so the Journal's own load
  does not slow down.
- **The tab paints a skeleton the instant it is tapped**, then fills.
  "Nothing happens for a moment" is the defect being avoided.
- **Web:** `useAggregate` runs on first open and its result is kept for the
  session (module cache keyed by the newest `matches.updated_at`), so Home,
  Stats and the Journal share one walk per session instead of three.
- **iOS:** the sections come from `ScoresStore.aggregate`, which is already
  walking at launch; the tab shows the sections that are ready and one line,
  "Counting points…", until the walk finishes.
- Tactics, the Stats page, Home's Your game card and Account's link all stay.

Making stats fast is its own spec: a per-match summary written when a match
is published or edited, read by Home, Stats, the Journal and Ask. Once that
exists the copy becomes a move. Not part of this work.

---

## 5. Lessons students record

### Written and audio

Nothing new in the database. A written or audio lesson is a `lessons` row
with `kind='lesson'`, `coach_ref_id` set or null, and `shared_with_coach_at`
when the share toggle was on. `student_shared_lessons()` already gives the
coach the shared ones on the student's page, and `lessons_coach_normalise`
keeps `coach_name` right.

### Video

**Schema.** `lesson_videos.coach_ref_id uuid references player_coaches(id)`,
with a check that `student_id` and `coach_ref_id` are not both set. RLS
stays owner-only.

**API** (`/api/lesson-video`). `create` takes `coachRefId` (a live row of
the caller's) or `studentId` (on the caller's roster, as now). The `is_coach`
gate applies only to `studentId`. `edit`, `retry`, `delete`: owner. `share`
and its reverse: owner. For a player-owned video, publishing writes the
`lessons` row with `kind='lesson'`, `coach_ref_id`, `lesson_video_id`, and
sets `shared_with_coach_at` when the owner said share; taking it back clears
it. `publish_lesson_video` branches on whether `student_id` or
`coach_ref_id` is set; a video with neither is a private lesson in the
owner's journal, as a coach's private lesson is today.

**Who can read.** One SECURITY DEFINER function,
`lesson_video_access(p_video_id)`, returns `owner`, `coach`, `student` or
nothing. `coach` requires the lesson row shared with the coach AND the coach
link still accepted, the two conditions `student_shared_lessons()` applies.
The API uses it for both directions in place of today's `shared()`; the
source stays owner-only and `publicVideo()` keeps scrubbing.

**Where the coach sees it.** `student_shared_lessons()` returns
`lesson_video_id` (added if it does not already); the coach's student page
(web `StudentView`, iOS `CoachStudentScreen`) shows the recap preview on
those cards and opens the recap.

**Editing.** Owner only. The coach gets the reader, the chapter index and
the audio. A coach edit later would be a write RPC guarded by the same
access function; not built.

**Review.** The owner reviews before sharing, as a coach does today. Copy
that assumes the reviewer is a coach ("share with your student") becomes
role-aware: "Share with Jonathan".

**Storage.** `create` refuses when `file_size` exceeds the remaining storage
from `my_storage_state()`, with the same over-limit sentence and **Request
more storage** control the upload card uses (`AllowanceRequest`).
`complete_lesson_video` writes the verified original size to
`storage_ledger`; the worker's writes for the outputs stay; delete already
reverses. Processing minutes are not charged. The bound of eight unfinished
imports stays.

**Bell.** New notification kind `student_lesson`: to the coach when
`shared_with_coach_at` flips on for any lesson (written, audio or video),
titled "<Student> shared a lesson" or "shared a lesson recap", href the
student's page. Trigger on `lessons`; the bell on both platforms learns the
kind.

**Worker.** No processing change. The recap is still a coach explaining,
whoever pressed record. Two places to check: `student_warning()` and the
review strings in `worker/lesson_video.py` that address the coach. The queue
is one Mac working one lesson at a time; opening imports to every player
makes the Processing page's queue depth the thing to watch. Nothing new to
name there.

**Ask.** The corpus adds recap chapter titles and cues from
`lesson_videos.edit` for recaps in your journal and recaps shared with you,
cited as "lesson recap". Without this, "what did Jonathan tell me to work
on" cannot find anything a video taught.

---

## 6. The workspace switcher

The pill in the top bar says "Coaching" on the playing side and "Playing"
on the coaching side, on both platforms (`AppNav.tsx` `sideSwitch`,
`PLTopBar(switchTo:)`). Beside a Coaching tab that reads as two doors to one
place. It names the side it switches to. On desktop web: **Coach mode** on the
playing side, **Player mode** on the coaching side. On mobile web and on
the iPhone, where the top bar also holds the bell and the avatar, the pill
reads **Coach** and **Player**. Same width class as today on the phone;
check the 393 top bar.

---

## 7. Surfaces

### Web

| File | Change |
| --- | --- |
| `src/components/AppNav.tsx` | Coaching always in `TABS`; delete `useStudentSide`, `COACHING_TAB` gating and the session cache; switcher label |
| `src/lib/workspaceModel.ts` | player territory for `/coaching/coach`, `/coaching/lesson`, `/coaching/import` |
| `src/app/coaching/page.tsx`, `CoachHub.tsx` | player branch renders the feed (`PlayerCoaching.tsx`, new); `FromYourCoaches` folds into it; `SharingSection` no longer inline |
| `src/app/coaching/coach/[id]/` (new) | the coach's page, from `SharingSection` + `CoachSharedWith` + Share a match |
| `src/app/coaching/lesson/new/` (new) | Write a lesson note: `JournalEditor` in lesson mode, coach line required, share toggle |
| `src/app/coaching/import/` (new) or `videos/page.tsx` role-aware | `LessonVideos.tsx` with a coach picker; the `is_coach` redirect goes |
| `src/app/journal/NotesFeed.tsx` | `Section` = `all\|matches\|coaches\|stats\|recollect`; fixed tab row; drop `?from=coach`; delete unused imports |
| `src/app/journal/JournalEditor.tsx` | note mode has no `CoachPicker`, saves `practice`; lesson mode used by Coaching |
| `src/app/journal/NoteEditor.tsx` | `CoachPicker` gate becomes `kind === "lesson"` |
| `src/app/journal/MoveToCoach.tsx` | delete |
| `src/app/stats/StatsView.tsx`, `useAggregate.ts` | extract the My stats panel; session cache |
| `src/app/join/[token]/JoinCoach.tsx` | land on `/coaching` |
| `src/app/account/page.tsx` | "Your coaches" row to `/coaching` |
| `src/app/api/lesson-video/route.ts` | `coachRefId`; gate only `studentId`; storage check; `lesson_video_access` |
| `src/lib/lessonVideo/model.ts` | `canReadVideo` takes the access result |
| `src/app/coaching/students/[id]/StudentView.tsx` | recap preview on student-shared cards |
| `src/app/api/journal-ask/route.ts`, `journal/AskPanel.tsx` | recap chapters in the corpus; "lesson recap" source label |
| notification bell | `student_lesson` kind |

### iOS

| File | Change |
| --- | --- |
| `App/MainTabView.swift` | permanent fourth tab; FAB on Coaching; switcher label; href routing for the new kind |
| `Core/CoachingStore.swift` | `showTab` always; feed loading (shared entries, coach notes, lessons, lesson videos, links) |
| `Screens/CoachingScreen.swift` | rewritten as feed + chips; marketplace parts stay behind the flag |
| `Screens/CoachPageScreen.swift` (new) | from `CoachAccessList` + `CoachSharedWith` + Manage rows + Share a match |
| `Screens/JournalScreen.swift` | fixed tabs; `NewEntrySheet` goes; composer without the coach line; Coaches and Stats tabs |
| `Screens/JournalNoteEditor.swift` | coach line only for `lesson` |
| `Screens/LessonRecordScreen.swift` | reached from Coaching; coach line required |
| `Screens/LessonVideoScreen.swift`, `Core/LessonVideoQueue.swift` | player variant taking a `PlayerCoach`; sends `coachRefId`; storage check via `AccountStore` |
| `Screens/StatsScreen.swift` | My stats sections reusable by the Journal tab |
| `Screens/CoachStudentScreen.swift` | recap preview on `StudentSharedCard` |
| `Screens/AccountScreen.swift`, `HomeScreen.swift` | Your coaches row and the unseen card open the tab |
| `Core/AppRoute.swift` | routes for the coaching pages |

### Database (one migration)

`lesson_videos.coach_ref_id` and its check; `lesson_video_access()`;
`publish_lesson_video` branch; `complete_lesson_video` ledger write;
`student_lesson` notification trigger on `lessons`; `coach_entries_notify`
href; `student_shared_lessons()` returning `lesson_video_id`; the `kind`
normalisation.

### Worker

`worker/lesson_video.py` copy check only. No processing change. No new job
kind, so `KIND_LABELS` and `STAGE_LABELS` on the Processing page are
untouched.

---

## 8. Order of work

1. Journal: fixed tabs, note-only composer, the kind rule and
   normalisation. Both platforms.
2. Coaching tab: feed, chips, the coach's page, New lesson for written and
   audio, the redirects, the switcher rename.
3. Stats copied into the Journal.
4. Student video: schema, API, access, the coach's view, storage, bell,
   Ask.
5. Web deploys from `main` as each lands; iOS ships one build after 1 to 3
   and another after 4, to the Team group first.

Rough size: 1 and 2 together about a week across three surfaces; 3 a day
or two; 4 three to four days.

---

## 9. Verification

Desktop at 1280×850, mobile web at 393×660, and the phone. On each:

- Journal: the tabs fit at 393 without scrolling; each tab lists the right
  entries; a note saved from the Journal has no coach and reads "Note"; an
  older lesson reads "Lesson with X"; Recollect hides when off; every
  match or point note in All, Matches and the feed opens its point or match.
- Coaching: with no coaches, the empty state; with one coach, the chip
  filters and the card opens the page; a lesson written with No coach shows
  under No coach; the share toggle is off by default; a shared lesson
  appears on the coach's student page.
- Video: a player imports a short clip; an import over storage is refused
  with Request more storage; the owner reviews and shares; the coach opens
  the recap, the reader and the chapter index; unshared, the coach cannot;
  the coach cannot edit; Ask finds a chapter cue.
- Bell rows open the right place on web and iOS; `/join` lands on Coaching.
- Stats tab paints a skeleton at once; the second open is instant.
- A dual-role account opens a coach's page and stays in player mode.

---

## 10. Settled on the second pass (Adil, 2026-09-06)

1. The Coaches tab holds your lessons and the entries and recaps coaches
   shared with you. Coach notes on matches stay under Matches.
2. All includes match and point notes, and each note links to its point or
   match.
3. Switcher: Coach mode / Player mode on desktop; Coach / Player on mobile
   web and iPhone, for space.
4. Share a match from the coach's page, several at once: in this round.
5. Chooser: Write a lesson note · Audio record a lesson · Import a lesson
   video.

No questions remain open. Work starts with the Journal, step 1 of section 8.
