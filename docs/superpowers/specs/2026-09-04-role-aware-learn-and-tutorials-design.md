# Role-aware Learn guides and tutorial courses

**Date:** 2026-09-04
**Status:** Approved in chat; implementation plan pending review

## Purpose

PongLens Learn currently has one player-led library on both web and iOS.
Thirteen written guides are shared between the two apps, but only one guide
is filed under `For coaches`. The nine tutorial videos are also one
player-led course. Its only coaching chapter, `You and your coach`, explains
the relationship mainly from the player's side.

The coaching product is now a separate, roster-first workspace. Coaches can
keep students who are not yet on PongLens, connect their accounts, keep and
share lesson entries, record audio lessons on iPhone, review shared matches,
and leave feedback on exact rallies. The web also supports paid match-review
offerings and orders. Learn needs to reflect that product without weakening
the player material or showing web-only commerce in the iOS coach app.

This work will:

1. Make Learn default to the active Playing or Coaching workspace.
2. Create a full coach guide library on web and iOS.
3. Create a coach tutorial course in the same format, tone, pacing, and
   production system as the player course.
4. Audit the player guides and tutorial course against the current product,
   updating only material that is stale or materially incomplete.
5. Make audience and platform boundaries explicit in one shared catalog so
   web and iOS cannot silently drift again.

## Decisions

- Learn adapts to the active workspace on both platforms.
- A dual-role user may deliberately view the other audience's library
  without changing the active workspace.
- One catalog is authoritative for web and iOS. The iOS resource is generated
  and checked rather than copied by hand.
- Coach videos mirror the player videos: short chapters, one job per chapter,
  high-level narration, real product screens, the same voice, annotations,
  bookends, captions, and visual treatment.
- Coach audio lesson recording is included. Video lesson recording is neither
  presented as available nor mentioned as coming later.
- Paid-review help and the paid-review tutorial chapter appear on the web
  coach side only. The iOS coach Learn experience contains no paid-review
  material.
- The player course keeps its nine-chapter shape. Accurate chapters stay;
  changed scripts or materially changed screens are recaptured.
- Platform-specific details that do not belong in a shared video, such as
  Instagram sharing on iOS, live in the relevant written guide.
- No database migration is required.

## Current system and source of drift

### Written guides

- `src/app/learn/guides.ts` is the web source for guide content.
- `ios/PongLens/PongLens/Resources/guides.json` is a manually extracted copy.
- Web renders screenshots carried by guide sections.
- iOS decodes the text structure but currently ignores screenshot metadata.
- The two copies have no automated freshness check.

### Tutorial videos

- `src/app/learn/videos/chapters.ts` is the web chapter list.
- `TutorialVideosScreen` contains a second hard-coded chapter list in Swift.
- `scripts/demos/tutorial/` holds narration, flows, generated voice timing,
  captures, rendering, and publishing.
- `/api/tutorial-url` signs a flat `tutorial/<slug>.mp4` R2 key.
- One `tutorial_started` metadata flag drives both player and coach first-step
  state, even though there is only a player course today.

The correction is structural: audience and platform become data, and both
apps render the same generated catalog.

## Content model

The shared Learn catalog will define:

```ts
type LearnAudience = "player" | "coach";
type LearnPlatform = "web" | "ios";

interface LearnVisibility {
  audiences: LearnAudience[];
  platforms: LearnPlatform[];
}
```

Guides retain their existing slug, title, summary, sections, images, and
related-guide relationships, then add visibility and audience-specific group
ordering. Tutorial chapters carry the same visibility plus course, sequence,
blurb, measured duration, guide relationship, and R2 media key.

The catalog exposes tested selectors rather than making each screen repeat
filtering rules:

- groups for audience and platform;
- visible guides for audience and platform;
- visible chapters for audience and platform;
- visible related guides for one guide;
- search text over the visible set only.

An export command writes the complete iOS-decoded catalog to a committed JSON
resource. A freshness test regenerates it in memory and compares bytes with
the committed file. Unknown groups, duplicate slugs, invalid relationships,
missing media scripts, and content with an empty platform or audience set
fail the Learn tests.

## Learn behavior

### Web

The server reads `rememberedWorkspace()` on `/learn` and `/learn/videos` and
uses it as the default audience. The page passes the resolved audience and
platform to the index or video course.

A small Playing/Coaching control lets a dual-role user, as determined by the
same eligibility state used by the main workspace switcher, open the other
library. The choice is represented as `?audience=player|coach` in the Learn
URL, not written back to the workspace cookie, so looking up a guide cannot
unexpectedly replace the application's navigation or active workspace. An
invalid or ineligible audience override falls back to the active workspace.

Search, groups, related cards, tutorial chapters, total duration, and chapter
numbers all use the resolved visible set. Direct links to valid guides remain
stable; their related links are filtered for the reader's platform.

### iOS

`LearnScreen` and `TutorialVideosScreen` read `app.workspace` for the default
audience and decode the generated catalog. They no longer own separate guide
or chapter lists.

The same Playing/Coaching control is available to a dual-role user without
calling `app.setWorkspace`. Search and relationships use the visible set.
The coach course is numbered from one through eight because its ninth web
chapter is not part of the iOS catalog.

The iOS coach library must contain no paid-review or video-lesson-recording
title, summary, search hit, related link, or tutorial chapter.

## Written coach curriculum

### Available on web and iOS

1. **Use the coaching workspace**
   - Coach Home and Students.
   - Starting coach mode and switching between Playing and Coaching.
   - How the roster, recent entries, and shared matches fit together.

2. **Add and connect a student**
   - Adding someone before they have an account.
   - Sending and resetting the student's invite link.
   - The student's all-matches or selected-matches access choice.
   - Renaming, merging a connected duplicate, and removing a student while
     keeping historical entries.

3. **Keep lesson entries**
   - Type, paste, or dictate.
   - Add a photo or a web link.
   - Use `Improve with AI`, then edit the original words or prepared notes.
   - Link an entry to one of the student's matches.
   - Edit and delete entries.

4. **Record a lesson on iPhone**
   - Choose `Audio record a lesson` and select the student.
   - Put the phone near the table, record, pause, resume, and finish.
   - Review the transcript and prepared notes.
   - Correct the entry before saving it under the student.
   - This guide discusses audio only.

5. **Share an entry with a student**
   - Direct sharing into a connected student's Journal.
   - Live edits after sharing and stopping sharing later.
   - A public link for an individual entry when the student is offline.
   - Resetting or revoking public access without exposing the rest of the
     student's record.

6. **Review a student's match**
   - Open matches from the student's page.
   - Watch the cut or original upload and move point by point.
   - Read the player's score, match analysis, and placement maps.
   - Understand that the coach cannot change scores, clips, or match details.

7. **Leave feedback on a match**
   - Written and spoken point notes.
   - Draw on a paused frame.
   - Overall match notes.
   - Where the student receives the feedback and how it remains tied to the
     footage.

### Web only

8. **Set up paid match reviews**
   - Coach page and offerings.
   - Scope, price, turnaround, availability, and payments.
   - Paid reviews as optional web functionality rather than the definition of
     the coaching workspace.

9. **Complete a paid review**
   - Accept an order and read the student's brief.
   - Tie findings to points, write the included sections, and add attachments.
   - Deliver, answer included follow-up, and understand payout status.

The current catch-all `Review a player's match` guide is retired. Its useful
material is distributed between the match-review and feedback guides, and its
old slug redirects to the most relevant replacement.

## Written player audit

The player library keeps its familiar groups and task-led structure.

### Update

- **Upload a match video:** current duration and upload language, first-run
  camera guidance, and the iOS recording route where applicable.
- **Watch the full match:** middle double-tap replay and the Original video.
- **Score and review individual points:** current adjust, split, join, remove,
  and put-back-a-missed-rally tools.
- **Score Keeper:** verify every current label, the game-divider behavior, and
  the present correction controls.
- **Understand match analysis:** placement generation after initial
  processing, retry and unavailable states, current serve-placement behavior,
  and read-only coach access where it clarifies the data.
- **Keep a training journal:** photos, scanned pages, editing prepared notes,
  Ask your journal, Recollect, coach-shared entries, and public entry links.
- **Export and download video:** separate automatic Highlights from starred
  and tagged exports, and correct the stale original-video retention copy.
- **Invite a coach:** the current per-coach access setting and how coach notes
  and lesson entries reach Coaching and Journal.

### Add

- **Create and share highlights** on both platforms: automatic short and long
  highlights, watching before sharing, downloading, and the all-starred
  collection. The iOS rendering also explains Instagram Story and Reel
  behavior.
- **Record a match** on iOS only: match or practice, camera alignment,
  optional spoken game scores, pause and finish, and the upload handoff.

### Verify without wholesale rewriting

- Import a video from YouTube.
- Organize points with tags.
- See your stats across matches.
- Share a public link.

Labels, screenshots, and relationships in those guides are still checked
against the current product.

## Tutorial production rules

Both courses use the existing tutorial grammar:

- one chapter teaches one job;
- roughly 35 to 55 seconds, and no chapter is forced past a minute;
- Sage voice at the established speed and direction;
- narration generated first, with measured line timings driving capture;
- real staged accounts and real product screens;
- annotations recorded against the elements they identify;
- one-second PongLens intro and outro;
- the same device frame, captions, chapter header, progress treatment,
  dimming, cyan boxes, and tap markers;
- generated files in R2, never shipped in the application bundle;
- full watch-through after rendering, not spot checks.

If a chapter runs long, the words are shortened. The voice is not sped up and
the visual actions are not crowded.

## Player tutorial course

The player course stays nine chapters.

### 1. Start here

1. “PongLens takes a video of your match and turns it into something you can
   study.”
2. “Here is a quick run through what it does.”
3. “Home picks up wherever you left off, so a match you started scoring sits
   right at the top.”
4. “Under that are your recent matches and how your game is going across all
   of them.”
5. “Anything you have exported lands here too, ready to download or send on.”
6. “And the short list of things you are working on stays in view before you
   play.”

The existing narration may remain if the refreshed Home capture proves every
line still true.

### 2. Upload a match

1. “Everything in PongLens starts with a match video.”
2. “On iPhone, you can record in PongLens or choose a video you already have.
   On the web, choose a file or paste a YouTube link.”
3. “How to record shows the camera position that gives PongLens the clearest
   view of the table.”
4. “Videos can be up to 45 minutes long.”
5. “Add who you played, where, what kind of session it was, and which side of
   the video is yours.”
6. “Choose whether to break the video into points and generate placement
   maps.”
7. “You can leave when the upload finishes. PongLens lets you know when the
   match is ready.”

### 3. Watch it back

1. “Your match comes back with the time between rallies removed.”
2. “Double tap the right side to move forward one point, the left side to go
   back, or the middle to replay the point.”
3. “Hold the right side for double speed and the left side for quarter speed.”
4. “Pinch to zoom in on the table, then drag to move around.”
5. “Open the point grid when you want to jump directly to another rally.”
6. “Star a point, share it, or leave a note without closing the player.”
7. “If the cut missed something, open Original to watch the video exactly as
   you uploaded it.”

### 4. Score a point

1. “Open any point and you get that rally on its own.”
2. “Choose who won it. That is enough to build the score.”
3. “You can also record how the point ended, what happened on the serve, and
   what went wrong.”
4. “Those answers fill the match analysis and your statistics.”
5. “Notes, tags, stars and drawings stay attached to the exact rally.”
6. “If the cut is wrong, you can adjust it, split joined rallies, remove dead
   space, or put back a rally PongLens missed.”

### 5. Score Keeper

1. “Score Keeper is built for scoring a whole match far faster than watching
   it back.”
2. “It plays the match one point at a time and waits for you.”
3. “Watch the rally, then choose who won it. The score keeps itself.”
4. “The lit ball shows who is serving. Change it if the rotation needs
   correcting.”
5. “Open Analysis when you want to record what happened.”
6. “You can also add a note or tag without breaking your rhythm.”
7. “Correct a game ending when the real match does not match the automatic
   score.”
8. “Skip a let, remove dead space, or modify a clip that contains the wrong
   footage.”
9. “Every point you score feeds the scorecard, analysis and statistics.”

The chapter keeps its present shape if current-label verification confirms
the existing capture. Any renamed control or visibly changed screen triggers
a fresh render.

### 6. Read your match

1. “Once the points are scored, the match reads itself back to you.”
2. “See how the match swung, how you performed serving and receiving, and what
   happened at the tight ends of games.”
3. “The reasons you chose while scoring show what cost you points.”
4. “Placement maps show where the camera could follow the ball.”
5. “Move between your serves, their serves, individual landings and the heat
   map.”
6. “If placement was not generated with the original processing, you can
   request it from Tools while the original video is still available.”
7. “Placement is still in beta, so you can mark a result that looks wrong and
   it stops counting.”

### 7. Highlights, export and share

1. “PongLens builds a short and a longer highlight from the best rallies in
   the match.”
2. “Watch either one first, then download or share the version you want.”
3. “Stars let you keep your own collection of rallies across matches.”
4. “Tags gather points under the words you use, such as backhand receive or
   third-ball attack.”
5. “You can export the full match, starred rallies, or every point carrying
   one tag.”
6. “Turn on Include score when you want the running scoreboard added to the
   video.”
7. “A public link lets someone watch a match, point or collection without
   making an account.”
8. “The original upload remains available from the match while you keep it in
   your library.”

Instagram instructions remain in the iOS written guide rather than this
cross-platform video.

### 8. You and your coach

1. “Invite a coach with one link and choose whether they see every match or
   only the matches you share.”
2. “They open the same points, score and analysis that you do.”
3. “They can leave written or spoken feedback on a point and draw directly on
   a frame.”
4. “A coach can also keep lesson entries for you and share them when they are
   ready.”
5. “Their point notes and shared lesson entries arrive in your Journal.”
6. “Your coach cannot change your score, clips or match details.”
7. “You remain in control of which matches they can open.”

### 9. The Journal

1. “Your Journal brings together match notes, practice entries, lessons and
   entries shared by your coach.”
2. “Write, dictate, add a photo, or scan pages from a paper notebook.”
3. “Improve with AI can turn rough notes into clear points, and you can edit
   those points directly afterwards.”
4. “Search finds the words you saved, while Ask your journal answers from your
   own notes and match record.”
5. “Tags connect related entries and rallies across different matches.”
6. “Working on keeps your current cues visible until you tick them off.”
7. “Recollect brings older advice back when it is useful again.”

## Coach tutorial course

The web coach course has nine chapters. iOS renders chapters one through
eight only and renumbers that visible set.

### 1. Start here

1. “PongLens gives every student one place for lesson entries, shared material
   and matches.”
2. “Coaching Home shows the students and entries you have worked with
   recently.”
3. “Students is your full roster, including people who do not have a PongLens
   account yet.”
4. “New entry is where you write or record what happened in a lesson.”
5. “If you also use PongLens as a player, the switch at the top moves between
   Playing and Coaching.”

### 2. Add a student

1. “A student does not need a PongLens account before you add them.”
2. “Open Students, choose Add a student, and enter their name.”
3. “Their page starts with a private journal for your lesson entries.”
4. “Once they connect, the matches they share appear on the same page.”
5. “You can rename a student or remove them from your active list without
   losing the lesson history you already kept.”

### 3. Connect their account

1. “When the student is ready, send the invite link from their page.”
2. “The invite connects their account to the name and entries already on your
   roster.”
3. “They choose whether you can see every match or only the matches they share
   individually.”
4. “You see only the matches covered by that choice, not the rest of their
   account or private Journal.”
5. “If the same student joined as a second row, merge the two and keep the name
   and history you already entered.”

### 4. Write a lesson entry

1. “Open a student and start a new lesson entry.”
2. “Type, paste, or dictate what you worked on.”
3. “Add a photo or include a useful link in the text.”
4. “Improve with AI can prepare rough notes as clear points for you to review.”
5. “You can edit the original words or correct the prepared notes directly.”
6. “Link the entry to one of the student's matches when the lesson refers to
   it.”
7. “The entry stays private until you decide to share it.”

### 5. Audio record a lesson

1. “On iPhone, choose Audio record a lesson and select the student.”
2. “Put the phone near the table where it can hear both sides of the session.”
3. “Start recording and leave it running while you coach.”
4. “You can pause when the lesson stops and continue when it starts again.”
5. “When you finish, PongLens prepares the transcript and the main lesson
   points.”
6. “Review and edit them before the entry is saved under the student.”

### 6. Share it with the student

1. “A lesson entry stays in your private coaching record until you share it.”
2. “For a connected student, Share with sends it directly to their Journal.”
3. “If you edit the entry later, the version in their Journal updates too.”
4. “You can stop sharing at any time.”
5. “For someone without an account, copy a public link to that individual
   entry.”
6. “The link does not expose the rest of the student's record.”

### 7. Review their matches

1. “Matches a student shares appear beside their lesson entries.”
2. “Open one to watch the cut video or the original upload.”
3. “Move through the match point by point and follow the score the student
   recorded.”
4. “You can also read their match analysis and placement maps.”
5. “The match remains theirs. You cannot change their score, clips or details.”
6. “If they change your match access, the list updates to match their choice.”

### 8. Leave feedback

1. “Open the point that shows what you want to explain.”
2. “Write a note or record a voice note on that rally.”
3. “Pause on a useful frame and draw directly onto it.”
4. “Use Overall notes when the feedback applies across the whole match.”
5. “The student receives your feedback in the match and in their Journal.”
6. “Keeping the note beside the footage makes it clear which moment you
   meant.”

### 9. Paid match reviews

Web only:

1. “Paid match reviews are optional and are managed on the web.”
2. “Build your coach page and create an offering with your own scope, price
   and turnaround.”
3. “The player sends a match, their questions and the information you asked
   for.”
4. “Nothing starts until you accept the order.”
5. “Review the match point by point and connect findings to the rallies that
   demonstrate them.”
6. “Add the written sections and attachments included in your offering.”
7. “Deliver the finished review through PongLens and answer any included
   follow-up.”
8. “Payment and payout status remain with the order.”

## Media identity and delivery

Player and coach media use distinct R2 prefixes:

- `tutorial/player/<chapter>.mp4`
- `tutorial/coach/<chapter>.mp4`

Existing player slugs stay stable within the player course. Coach slugs are
course-specific and cannot collide with player files. The media endpoint
accepts a course, platform, and optional slug, validates that combination
against the catalog, then signs only the exact known keys. The platform value
controls catalog visibility rather than authorization; it prevents the iOS
client from requesting the web-only coach chapter. A request for a chapter
outside the requested course-platform set, or an unknown chapter, is
rejected.

The old flat player files remain during rollout. The application changes to
the new keys only after the corresponding new files are published and
verified. They can be cleaned up separately after the release is stable.

## Progress tracking

Tutorial progress becomes audience-specific:

- `player_tutorial_started`
- `coach_tutorial_started`

The legacy `tutorial_started` value counts as player progress so existing
players do not lose a completed first-step item. It never counts as coach
progress. Starting a player chapter cannot complete the coach checklist and
vice versa.

The player and coach first-step components read the corresponding flag and
link to the corresponding course. iOS uses the same metadata keys.

## Capture and rendering

The shared capture, cue, narration, and Remotion engine remains under
`scripts/demos/tutorial/`. Player and coach course inputs are namespaced so
identical chapter names cannot overwrite one another.

### Browser chapters

Playwright signs in as staged player, coach, or student accounts and drives
the real application. Coach staging from the completed coach-landing work is
reused. Existing guard and cleanup behavior is extended to every chapter that
creates a note, invite, share state, or other row.

### Native iOS footage

Two parts require real native UI:

- the player's in-app recording route;
- the coach's audio lesson recorder.

The simulator is launched into the real screens through debug-only capture
hooks. The capture uses deterministic staged state so it can show the timer,
pause/resume, transcript, and prepared-note states without leaving customer
or demo data behind. `simctl` records the actual app surface. The resulting
clip is composed through the same Remotion treatment as browser footage.

No mock screen or still image is presented as a working flow. Debug capture
state is excluded from release behavior.

### Screenshot guides

The Learn screenshot capture gains current coach screens for Home, Students,
student detail, invite, entry composition, audio recording, shared entry,
shared match, point feedback, coach profile, offering, and paid-review order.
Verified current assets from the coach-landing work may be reused rather than
copied under misleading names.

Player screenshots are replaced only when a current guide would otherwise
show an obsolete control or fail to show the workflow being explained.

## Error handling and rollout

- An empty filtered library is treated as a catalog error in tests, not an
  empty state shipped to users.
- If tutorial URLs cannot be loaded, the existing playback failure treatment
  remains and names the failed chapter without exposing storage details.
- The media endpoint never converts arbitrary input into an R2 key.
- Generated iOS content is decoded in tests before it reaches the bundle.
- Old player media stays available until the new catalog, API, and R2 objects
  have been verified together.
- No current user progress is deleted or rewritten.

## Verification contract

### Catalog and content

- Guide and chapter slugs are unique in their course.
- Every visibility set contains at least one audience and platform.
- Every related guide exists and is reachable for at least one shared
  audience-platform combination.
- Every guide begins with useful quick steps.
- Every web screenshot path exists.
- The generated iOS catalog matches its source byte for byte.
- iOS coach selectors return no paid-review or video-lesson-recording
  material.
- Web coach selectors include both paid-review guides and the ninth chapter.
- Search and related links never return hidden content.

### Web behavior

- Playing and Coaching workspaces open the correct Learn audience.
- The audience control does not rewrite the active workspace.
- Tutorial totals and numbering come from the visible chapter set.
- The signing endpoint accepts valid course chapters and rejects unknown or
  mismatched keys.
- Player and coach first steps use separate progress.
- Relevant Learn, workspace, authentication, coach, journal, upload,
  highlights, and sharing tests pass.
- ESLint and the Next.js production build pass.

### iOS behavior

- Both workspace libraries decode, filter, search, navigate, and play.
- The coach course contains eight chapters and no commerce content.
- The player course preserves legacy completion and coach progress stays
  separate.
- Swift unit tests and the application build pass.
- Playing and Coaching are inspected in the simulator.

### Visual and media review

- Web Learn is inspected at desktop width and `393 × 660`.
- Current screenshots are checked for obsolete labels, loading states,
  private data, cropping, and broken media.
- Every new or replaced video is checked with `ffprobe` for dimensions and
  duration.
- Narration metadata, subtitles, and chapter metadata agree.
- Every changed chapter is watched from its first frame through its outro.
- Annotation boxes point at the intended control for their full lifetime.
- Native inserts visibly come from the real iOS app and use the same tutorial
  frame and caption treatment.
- Only verified files are published to the new R2 prefixes.

## Expected implementation areas

- `src/app/learn/` catalog, index, guide pages, video course, and tests.
- `src/app/api/tutorial-url/route.ts`.
- Player and coach first-step components and their metadata reads.
- `ios/PongLens/PongLens/Screens/LearnScreen.swift` and supporting catalog
  models.
- The generated iOS Learn resource.
- Debug-only iOS capture entry points for the two native recordings.
- `scripts/demos/learn_shots.mjs` and verified screenshot assets.
- `scripts/demos/tutorial/` course manifests, flows, guards, native capture,
  rendering, and publishing.

## Scope boundary

This work updates Learn content, Learn navigation, tutorial progress, tutorial
production, screenshots, and published tutorial media. It does not change the
underlying player or coach product capabilities, match access, lesson
processing, commerce behavior, pricing, or storage policy. It does not ship
video lesson recording or advertise it as future functionality.
