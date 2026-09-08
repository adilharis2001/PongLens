# One recap, one card, one way in: design

Adil, 2026-09-08, on the phone: a lesson he records and has made into a
recap shows up in Coaching as the full written entry, its only way to the
video is a link that throws him into Safari, and the only place to watch
it inside the app is the list under the importer. A coach's shared recap
looks and behaves differently again. He wants one experience: the recap
is a card with the picture on it, tapping it plays the recap, it sits in
the Coaching feed and under the coach's chip, and written entries in that
feed are a preview that opens out rather than the whole thing.

Evaluated against the code as it is. No changes made.

---

## 1. What exists today, exactly

**A player's own recap, once saved.** `publish_lesson_video` writes a
`lessons` row (kind `lesson`, `lesson_video_id` set, `coach_ref_id` from
the video) whose text is one line, `Video lesson: https://ponglens.com/
lesson-video/<id>`, and appends a "Lesson video" theme carrying that same
link to its takeaways. That is the journal entry.

*iOS Coaching feed* (`CoachingScreen.swift`). Items are built from four
lists. A saved recap arrives twice, as its `lessons` row and as its
`lesson_videos` row, and the feed keeps the **lessons** one: line 104
skips the recap row whenever a journal entry names it. So the card shown
is `LessonCardView`, the full journal card, every theme and every bullet
(`JournalScreen.swift:57`), with the appended "Lesson video" bullet at
the bottom. That bullet is the link. `LessonCardView` reads
`takeaways.themes` raw; `LessonRow.visibleThemes` (`JournalStore.swift:
213`) exists to strip exactly that theme and nothing uses it.

*Where the link goes.* `RootView.swift:95` installs an app-wide
`OpenURLAction` that recognises a first-party recap URL and opens it in
the native player. `EntryText` (`EntryComposerParts.swift:253`), which
renders every entry's text, installs its own `OpenURLAction` that returns
`.systemAction` for any `http(s)` URL. The inner one shadows the outer,
so the interception never runs and the link opens Safari. **This is a
bug, not a design gap.**

*iOS: the only in-app player.* `LessonVideoScreen`, reached through New
lesson → Import, lists the player's recaps under the importer and each
opens `LessonVideoDetailScreen`. That is the page Adil wants one tap away
from the feed.

*iOS: a coach's shared recap.* Arrives as a `CoachSharedEntry` and
renders as `CoachSharedEntryCard`: coach name, poster thumbnail (as of
build 158), title, "Lesson recap". Tap opens `CoachSharedEntrySheet`,
which shows `LessonRecapPreview` (poster, "Watch the recap") and a Watch
button that opens the same `LessonVideoDetailScreen`. One extra hop, and a
different look from the player's own.

*iOS: an unpublished own recap.* The `.recap` case draws a compact card
(poster, "Lesson recap", title, status line) that opens
`LessonVideoDetailScreen` directly. This is already the card Adil is
asking for; it is just hidden the moment the recap is saved.

*Web* (`PlayerCoaching.tsx`). Same four lists, same dedupe (line 284),
same outcome: a saved recap is the full `LessonCard` with the link
bullet. `LinkedText` renders same-origin paths as in-app links, so the
web does **not** leave the site; the web's fault is only the look.
`SharedEntryCard` (a coach's) already shows `RecapPreview` and links to
`/lesson-video/<id>`; the own `recap` card links there too, with a
poster since build 158.

*Both journal cards have no collapsed mode.* `LessonCardView` and
`LessonCard` render whole, in the Journal tab and in the Coaching feed
alike.

*Home.* Renders the latest shared entry as `CoachSharedEntryCard` in a
button that opens the sheet, the same as the Journal's Coaches tab.

## 2. Three rules

**Rule 1 — A recap is one thing, wherever it appears.** The compact
recap card: poster on the left, then a small line saying whose it is
("Lesson with Jonotan · Sep 7" for your own, the coach's name for one
shared with you), the title, and "Lesson recap" with the chapter count
and length. Tapping the card opens the recap page,
`LessonVideoDetailScreen` on the phone and `/lesson-video/<id>` on the
web, the one page both directions already share. No sheet in between,
no link bullet, no full journal card. It sits in Coaching under All and
under the coach's chip, and on Home when it is the latest thing.

**Rule 2 — In Coaching, a written or spoken entry is a preview.** The
same journal card, collapsed: the top line, the title, and the first four
bullets, then "Show more" that opens it out in place. The Journal tab
keeps the full card as it is. One component with one flag, so the two
cannot drift.

**Rule 3 — A first-party link never leaves the app.** The app-wide
handler already says so; the inner one stops overriding it. And the
player's own card stops drawing the link bullet at all, because with
Rule 1 the card is the way in.

## 3. What changes, by surface

**iOS**

- `CoachingScreen.swift` `items`: when a `lessons` row has
  `lessonVideoId`, build a `.recap` item from it rather than a `.lesson`
  item, carrying the entry's coach line and shared state, and let the
  `lesson_videos` row fill the poster and status. The existing skip at
  line 104 inverts: the recap presentation wins. Unpublished recaps keep
  the status line ("Preparing your recap"); saved ones show the coach
  line and "Shared with …" when it is.
- `CoachingScreen.swift` `.shared` case: if `entry.recapId` is set, a
  `NavigationLink` to `LessonVideoDetailScreen(id:)`; otherwise the
  button-and-sheet it has now (a text entry's sheet holds the linked
  match and Report, which have nowhere else to live).
- `HomeScreen.swift` and `JournalScreen.swift` Coaches tab: the same
  rule for a shared card that is a recap.
- `LessonCardView` (`JournalScreen.swift`): a `collapsed` parameter,
  default false. Collapsed shows the top line, title, and the first four
  points across themes, then "Show more"; expanded is the card as it is.
  Coaching passes `true`; the Journal tab and the coach's page do not.
  It reads `lesson.visibleThemes` instead of `takeaways.themes`, which
  removes the link bullet on a recap wherever the card is drawn.
- `EntryText` (`EntryComposerParts.swift:253`): the inner handler asks
  the environment's `openURL` for anything it does not discard, instead
  of returning `.systemAction`. First-party recap links then reach
  `RootView`'s interception and open in the player; everything else
  behaves as now.

**Web**

- `PlayerCoaching.tsx` `items`: the same inversion; a journal entry with
  `lesson_video_id` renders as the `recap` card, with the coach line.
- `PlayerCoaching.tsx` `FeedRow`, `lesson` case: `LessonCard` with
  `collapsed`.
- `LessonCard.tsx`: a `collapsed` prop with the same behaviour, reading
  `entryThemes(themes, recap)` so the link bullet is not drawn on a
  recap.
- `SharedEntryCard` (`CoachShared.tsx`): already right; no change.

**Worker, database, API:** nothing.

## 4. What stays as it is

- The Journal tab: full cards, every theme, every bullet.
- The recap page itself, on both surfaces.
- The list under the importer, which is where imports in progress live.
- A coach's student page and the coach's own recap flow.
- The "Lesson video" theme in the stored takeaways: older app versions
  still need the link, so it is hidden, not removed.

## 5. Decisions (Adil, 2026-09-08)

1. **Preview depth: four bullets**, across themes in order, plus the
   title.
2. **Home follows Rule 1.** The latest shared entry on Home opens the
   recap page when it is a recap, the same as everywhere else.
3. **A tap on a collapsed entry jumps to the Journal**, landing on that
   entry. The preview is a doorway, not a card that opens in place: on
   the phone the Journal tab is selected and scrolled to the entry, on
   the web `/journal?entry=<id>` does the same, at both widths.

One rule for the preview lives in one place per surface, tested on both:
the first four points across the visible themes in order, with the link
theme already gone. `previewPoints` in `Core/LessonPreview.swift` and
`src/lib/journal/preview.ts` are twins, and their tests carry the same
cases.

## 6. Size

Six files on the phone, three on the web, one build. No migration, no
worker release. The Safari fix is one line and could ship alone.
