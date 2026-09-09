# Text is data, the file is an artifact: design

**Date:** 2026-09-09
**Status:** Approved 2026-09-09, not yet built

## Purpose

Correcting a word in a lesson recap will stop rebuilding a video. Sending a
recap to somebody without a PongLens account will become possible. Building
the self-contained video file will become something a coach asks for, once,
when they actually want a file.

Today all three are the same twenty-minute job, and the third is impossible.

---

## 1. What exists today, exactly

**Every recap is two files.** `render()` (`worker/lesson_video.py:849`) encodes
each chapter twice: `clip-{i}.mp4` at 1280x800 with a PIL-drawn text panel
overlaid, and `clean-{i}.mp4` at 1920x1080 with no text. They concatenate into
`recap.mp4` (stored as `summary_key`) and `playback.mp4` (`playback_key`), plus
a poster derived from `playback_key` by string substitution.

**The apps play the clean file and draw the text themselves.** Chapter titles
and cues come from `lesson_videos.edit`; the player seeks with
`summary_start_s` (`LessonPlayback.tsx:66`, `LessonVideoScreen.swift:1219`).
The burnt-in file is reachable only through one row: "Video with text" on web
(`LessonVideoView.tsx:691`) and "Export video with text" on iOS
(`LessonVideoScreen.swift:778`), the latter handing it to the system share
sheet.

**Both passes cost the same.** Measured on the Mac Studio, encoding one minute
of recap: burnt-in 14.9s, clean 15.5s. Every recap pays for both, every time.

**Saving any edit queues a full rebuild.** `queueLessonRender`
(`src/lib/lessonVideo/queueing.ts:1`) sets `status='queued'`,
`stage='Updating recap'`, clears the lease and resets `lease_reclaim_count`;
the handler bumps `revision` and nulls `coach_entries.shared_at`
(`route.ts:187`). The worker downloads the whole original again, up to 20 GB,
skips transcription because `row['edit']` is set, and re-encodes both files.

**A recap has no unauthenticated path.** `lesson_videos` is
`revoke all ... from anon` with one owner-only select policy;
`lesson_video_access` and `publish_lesson_video` are revoked from `anon`;
`/lesson-video/[id]` redirects to `/login`; `/api/media-url` has no
lesson-video branch.

**Three consequences worth naming.** An edit during an active render abandons
the running worker silently, because every worker write is fenced on
`lease_token` and `status='processing'`. Every rebuild orphans the previous
revision's three objects in R2 and leaves their positive `storage_ledger` rows
counted against the coach forever. And while a rebuild runs the row is not
`ready`, so `canReadVideo` gives the student a 404 on a recap they were
already reading.

---

## 2. What a coach actually wants

1. **Fix a word.** By far the most common.
2. **Send a link to somebody without an account.** A player who has not signed
   up, a parent, another coach.
3. **Send a file.** WhatsApp, email, a drive folder. The text has to travel
   inside the picture, which is exactly what the burnt-in file is for.

Only the third needs an encoder.

---

## 3. Four rules

**R1. Text is data.** Changing the recap title, a chapter title or a cue saves
at once. No job, no status change, no re-render, no unshare. Everyone on
PongLens sees the new wording on their next load.

**R2. Structure is video.** Removing a chapter changes the clean file, so it
rebuilds exactly as today.

**R3. The file is built when asked for.** The burnt-in video is not made
during normal processing and not refreshed automatically. A coach asks for it,
once, and is told when it is ready.

**R4. A link needs no render.** The public page plays the clean video and draws
the chapters itself, the same way the apps do, so sharing a link is instant and
always shows the current wording.

---

## 4. The state model

### Where the shareable file lives

A new table, not new columns on `lesson_videos`. The lesson row carries a
single lease (`lease_token`, `lease_until`, `worker_id`, `status`) and
`claim_lesson_video` selects work by `status='queued'` alone. A second job
expressed on that row would take the same lease, set `status='processing'`,
take the student's access away, share the 0..3 `lease_reclaim_count` budget,
and inflate `admin_lesson_video_health.queued_count`. The precedent for a
rendered file made for sharing is `match_reels`, and it is a separate table for
the same reasons.

```sql
create table public.lesson_share_renders (
  lesson_video_id uuid primary key references public.lesson_videos(id) on delete cascade,
  owner_id        uuid not null references auth.users(id) on delete cascade,
  revision        integer not null,       -- the edit revision this file was built from
  r2_key          text,
  bytes           bigint,
  status          text not null default 'queued'
                  check (status in ('queued','processing','ready','failed')),
  stage           text,
  error           text,
  lease_token     uuid,
  lease_until     timestamptz,
  worker_id       text,
  release_id      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

### The three states a coach sees

Read against the lesson's current `revision`:

| State | Condition |
| --- | --- |
| Not prepared | no row, or a row with no `r2_key` |
| Ready | `status='ready'` and `revision` equals the lesson's |
| Behind your latest wording | `status='ready'` and `revision` is lower |

`status='queued'` or `'processing'` shows the stage. `'failed'` shows the
error to the owner only and keeps any earlier file.

### Backfill

Existing recaps already have a burnt-in file that is current. The migration
inserts one `ready` row per `lesson_videos` with `summary_key is not null`,
carrying that key, the row's `revision`, and the byte count from
`storage_ledger` where it can be found.

---

## 5. What changes, by surface

### 5.1 The API: classifying an edit

The `'edit'` action compares the incoming chapters' `(start_s, end_s)` list,
in order, against the stored edit's.

**Identical (a text-only edit).** Update `edit` and `revision` and nothing
else. Do not touch `status`, `stage`, the lease or the keys. Do not clear
`coach_entries.shared_at`: fixing a typo must not silently retract a recap
from the student who is reading it. Allowed whenever the row is `review`,
`ready`, or `failed` with an edit, and additionally while a shareable file is
being built, because that build does not hold the lesson's lease.

**Different (a structural edit).** Today's path unchanged: `queueLessonRender`,
revision bump, `shared_at` cleared, the "Updating your recap" card, the Edit
row greyed.

A text-only edit marks any shareable file behind by arithmetic alone. Nothing
is written to `lesson_share_renders`.

### 5.2 The worker

`render()` gains a keyword argument saying which outputs are wanted, and
normal processing asks for the clean file and the poster only. That halves
every recap render and every structural rebuild.

The share build is a second claim. When `claim_lesson_video` returns nothing,
the worker calls `claim_lesson_share_render(p_release, p_worker, p_cloud)`,
which takes its own lease on the new table. It builds the burnt-in file
**from `playback.mp4`, not from the original**, cutting each chapter at its
`summary_start_s`/`summary_end_s` and overlaying the panel. The original
averages 3.7 GB and the clean recap averages 150 MB, and for a 16:9 source the
geometry is identical: both paths reach 1280x720 inside a 1280x800 frame. This
needs one visual comparison against a current file before it ships.

It writes `r2_key`, `bytes`, `status='ready'`, and the `revision` **captured at
claim time**, never the row's current value. It must not write
`lesson_videos.edit`. It deletes the previous `r2_key` and writes the negative
`storage_ledger` row, which is the first place in this pipeline that cleans up
after itself.

Stages, in plain English: `'Preparing the video file'`, then
`Adding text to chapter N of M`, then `'Saving the video file'`.

### 5.3 The database

- `publish_lesson_video` gates on `summary_key is not null`
  (`20260907133605:175`). It must move to `playback_key`, or publishing breaks
  for every recap made after this change.
- `share_links` gains `lesson_video_id uuid references lesson_videos(id) on
  delete cascade` and a new `kind`, plus a partial unique index on
  `(lesson_video_id) where kind = '<kind>' and revoked_at is null`, mirroring
  `share_links_active_entry_uniq`. The existing `lesson_id` column is not
  reused: a recap has no `lessons` row until it is published, and a coach may
  want a link before that.
- The owner policy's `with check` gains a `lesson_video_id` leg alongside the
  `match_id` and `lesson_id` ones.
- New `resolve_share_lesson_recap(p_token text)`, `language sql stable security
  definer set search_path = public`, gated on
  `sl.token = p_token and sl.revoked_at is null and sl.kind = '<kind>'`,
  `revoke execute from public; grant execute to anon, authenticated`. It
  returns the recap title, the chapters as title, cues and summary clock, the
  `playback_key`, the poster key, and the shareable file's key **only when that
  file is current**. It returns no themes, no student name, no owner email and
  no `source_key`. The parameter is `p_token` and the comparison is
  `sl.token = p_token`; a parameter named `token` is shadowed by the column and
  matches every row.

### 5.4 The public page

A branch at `/s/[token]`, beside the existing entry branch. Bare
`<main className="bg-arena flex min-h-screen flex-col">` with the logo, no
`AppNav` and no `AppShell`, `robots: {index:false, follow:false}` in its own
metadata, and the existing `LinkOff()` for a revoked or unknown token.

It shows the poster, the clean video full width, and the chapter list with its
cues, which is the same reading experience the apps give. A "Download the
video" button appears only when a current shareable file exists. A viewer never
sees the words "behind" or "stale"; the button is simply absent.

Media is signed by a new branch in `/api/share/media`, which takes no session
because the token is the credential. The key is pinned to
`lesson-video/<owner_id>/` and rejected if it contains `..`, matching the
entry-photo treatment. **The 15-minute TTL there is too short for a recap of up
to 15 minutes and no share page has a refresh loop.** See decision D3.

Revocation, the account page listing and the "Revoke all" kill switch all work
already; the new kind needs one line in `kindLabel`
(`src/app/account/ShareLinksSection.tsx:32`).

### 5.5 Web and iOS, together

The match side already settled this vocabulary, and its spec is explicit that
"Share" alone is not a usable label because it does not say whether the result
is a link, a file or a permission. Lessons adopt the same two rows.

The Manage list becomes:

1. **Edit recap**
2. **Share a link**, trailing `Not shared` or `1 link`
3. **Export**, trailing `Video files`
4. **Watch original recording**
5. **Delete lesson video**

**Share a link** opens a sheet: one switch that creates or revokes the link, the
URL with a copy control, and one sentence saying anyone with the link can watch
without an account. iOS adds the system share sheet; web uses `navigator.share`
where it exists and copies otherwise.

**Export** opens a sheet with two entries. "Video with text", carrying its state
and the file size when there is one, and "Original recording". Draft copy, which
needs Adil's eye:

| State | Line | Control |
| --- | --- | --- |
| Not prepared | The video with your words on it has not been made yet. | Prepare the video |
| Queued or building | the worker's stage | none |
| Ready | Ready. 128 MB. | Download, Share |
| Behind | This file still shows your earlier wording. | Prepare it again, Download anyway |
| Failed | the error | Try again |

`lessonStatusLabel` and `statusLabel(hasRecap:)` need no new state: the
shareable file has its own status and never moves the lesson's.

### 5.6 The admin processing page

CLAUDE.md is explicit that a lane is not finished until this page names it, and
that a lane switched off by decision must never look like one that died.

The lesson rows today are built from heartbeats alone and carry no job, stage
or percentage (`processingView.ts:566`). This change adds a real second lane,
so it needs: a `KIND_LABELS` entry, plain-English `STAGE_LABELS` phrases for the
three stages above, a row in `buildWorkerRows` including the case where nothing
is running it, and tests beside the existing lesson ones. Because
`lesson_share_renders` is its own table, `admin_lesson_video_health`'s
`queued_count` stays a count of recap work, which is what it means.

### 5.7 The cloud twin

Modal's `dispatch_once` is release-scoped: it asks one boolean and spawns one
generic worker. `lesson_video_cloud_dispatch_ready` decides from queued
lessons, and its eligibility predicate must **not** learn about share renders,
or a coach asking for a file would trigger the cloud fallback as if a recap
were overdue. The first release ships with share renders on the Mac only, and
`claim_lesson_share_render` refuses when `p_cloud` is true.

`verify_media_parity` asserts that one `render()` call produces both files. It
needs a second arm once `render()` is parameterised, and any new module has to
go into both `RELEASE_FILES` and `WORKER_FILES` or the worker will start, beat,
and claim nothing.

---

## 6. Edge cases

1. **Text edited while a file is building.** The build finishes stamped with
   the revision it claimed, so it lands reading "behind". Honest, and the coach
   is not blocked from typing.
2. **Chapter removed while a file is queued or building.** The clean video is
   being rebuilt, so the file would be made from a stale source. The structural
   edit cancels a queued build and lets a running one finish as "behind".
3. **Two requests to prepare.** The primary key is the lesson id, so the second
   is a no-op while one is queued or running.
4. **Build fails.** `status='failed'`, the previous file and its key are kept,
   the error shows to the owner only.
5. **The clean file is missing.** Legacy rows exist with only `summary_key`.
   Refuse with plain copy and offer the recap rebuild instead.
6. **A link is live and the coach removes a chapter.** The link keeps working
   through the rebuild, showing the new text; the download disappears until the
   file is prepared again. Nothing 404s.
7. **Presigned URL expires mid-watch.** The public page re-mints on a media
   error rather than dying. No share page does this today.
8. **The lesson is deleted.** `on delete cascade` takes the render row and the
   share link; the existing delete action already sweeps the whole
   `lesson-video/<owner>/<id>/` prefix and writes negative ledger rows.
9. **The account is deleted.** `sweep_owner` already covers the prefix. The new
   table cascades from `auth.users`.
10. **A revoked link.** `LinkOff()`, and any URL already signed dies within the
    TTL, which is the argument in D3.
11. **iOS falls back to the burnt-in file** when `playback_key` is null
    (`LessonVideoScreen.swift:818`). Keep the fallback for legacy rows; it is
    never reached by a recap made after this change.
12. **`playbackUrl` falls back to `summaryUrl`** in the API (`route.ts:57`) and
    `watchable` is keyed on `summary_key` for the owner (`route.ts:55`). Both
    move to `playback_key`.
13. **Search engines.** `/s/*` is kept out of the index by per-page metadata,
    not by robots.txt, so the new branch sets its own.
14. **Storage.** A prepared file is one object per lesson, replaced in place,
    with the old one deleted and the ledger corrected. Text edits stop creating
    objects at all, which removes the largest current source of orphans.

---

## 7. What stays as it is

The transcription ladder, the outline and cue prompts, chapter selection, the
16-chapter and 15-minute limits, the editor built on 8 September, the "Updating
your recap" card for structural rebuilds, the journal entry copy of the notes,
`lesson_video_access`, and the retention policy. No sweep tier is added for
`lesson-video/`; if one ever is, it needs a protect list built from
`summary_key`, `playback_key` and `lesson_share_renders.r2_key`.

---

## 8. Decisions (Adil, 2026-09-09)

**D1. The burnt-in file is not made during normal processing.** Accepted. It
halves every render and every structural rebuild. The first export waits
instead of being instant, which is the point: a coach asks for a file when
they want one.

**D2. A stranger with the link sees the video and the chapter cues.** Accepted.
The written lesson notes stay private. They are the fuller record and often
name how a student is struggling.

**D3. Nothing expires. The signed media address lasts one hour.** The question
as first written was misread as being about the link, so to be unambiguous:

- The share link never expires. It works until the coach revokes it, exactly
  like a journal entry link.
- No file is ever deleted on a clock. `lesson-video/` is covered by no sweep
  tier, and this spec does not add one. A coach opening a recap years later
  finds everything still there.
- The only lifetime in play is the presigned R2 address the page mints to play
  the video, invisible to the viewer. Fifteen minutes is shorter than a recap,
  so a viewer who pauses can find playback dead on return. It becomes one hour,
  with a re-mint when playback errors.
- The cost is that a revoked link keeps working for whoever is already watching
  until their address lapses, up to an hour rather than fifteen minutes.

**D4. Whoever holds the link can download the file.** Accepted, when a current
file exists. That is what the file is for.

**Storage is not a constraint here, and this change improves it.** Measured on
production, 2026-09-09: originals average 3.7 GB and hold 32.4 GB; clean recaps
average 150 MB and hold 5.4 GB; videos with text average 128 MB and hold
2.4 GB. The originals are the whole story. This change makes no video with text
unless somebody asks for one, and deletes the superseded copy when one is
rebuilt, which nothing does today.

## 9. Size

One migration, a new claim function and resolver, a worker change with a
parameterised render and a second claim loop, a public page branch, a media
branch, two sheets on each of web and iOS, and the admin lane. Larger than the
8 September work: two sessions, with the worker and the public page as the two
halves. It reduces the storage leak and removes the student's 404 during an
edit as side effects.
