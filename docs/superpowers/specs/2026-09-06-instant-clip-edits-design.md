# Instant clip edits and seamless point playback

**Date:** September 6, 2026
**Status:** Approved by Adil on 2026-09-06 and implemented the same day on
branch `claude/paulins-video-edit-processing-u0wozl`. Section 16 records
what landed, what was verified, and what remains.
**Record:** `docs/research/2026-09-06-clip-edits/` holds the five deep reads of the
code this spec is built on (web player and Modify, web plus button, iOS,
worker and database, every surface that plays a clip). File and line
references in the appendices point into those reads.

---

## Summary

When a player splits, joins, adjusts or adds a rally, the scoring screen
itself already updates instantly. What waits is the small video file each
rally has: the point view, Starred, sharing, coach review and reels all play
that file, and it has to be cut again after any timing change. Today that
re-cut takes minutes and sometimes never happens, and while it is pending the
player is locked out of adjusting the same point again.

This spec changes the product so that **the timeline is the truth and the
file is a copy that catches up in the background**. In order:

0. Fix the foundations. Adjust currently breaks a point's position inside the
   match video, permanently. Re-cut requests get lost. The iOS app never
   learns a new file exists. These must land first or step 1 plays the
   wrong footage.
1. Play a changed point straight from the match video, on web and iOS, the
   moment it is saved. No spinner, no lock, nudge as many times as you like.
2. The worker cuts from storage by range instead of downloading the whole
   original, and from the smaller match video wherever possible. Minutes
   become seconds.
3. Small jobs get their own lane so a five-second re-cut never queues behind
   a forty-minute upload.
4. Re-cuts use the Mac's hardware encoder like the reels already do.
5. The iPhone cuts the file itself, using the same machinery it already uses
   to build Instagram share clips, and uploads it. The worker's job becomes a
   safety net.

The plus button gets the same treatment plus its own list of fixes, on both
platforms. Running the pipeline on Modal as a backup processor is held for
now; section 12 says what this design must not preclude so that work can
slot in later.

---

## 1. Goal

A player who corrects the footage of a point, on any surface, sees the
corrected point play back immediately, can correct it again immediately, and
is never shown a spinner for something they did not ask to wait for. Every
other reader of that point (coach, share link, reel, Starred) sees the
corrected footage within seconds when the worker is idle and within a minute
or two when it is busy, and never a permanently stuck state.

Scope: Split, Join and Adjust (the Modify sheet) and the plus button (Add a
missing rally), on iOS, web desktop and web mobile, plus the worker and the
database that serve them.

---

## 2. The pieces, in plain terms

- **The match video.** One long file per match with the dead time removed
  (the code calls it the cut). The scoring screen, the Modify sheet, the
  coach workspace and Instagram shares all play this. It is full resolution
  and has a keyframe every two seconds so seeking is quick.
- **The clip file.** One small 720-wide file per rally. The point view,
  Starred, public point links, coach review replay, tag reels and thumbnails
  play this. The original upload, the match video and the clip files are
  all kept for the life of the match (checked against the live database and
  the sweep on 2026-09-06; see the Retention section of `CLAUDE.md`). The
  only matches without an original are legacy ones processed before August
  2026 whose raw was swept back then. Every processed match has its match
  video.
- **Three clocks.** A point stores its start and end in original-video
  seconds (`t0`, `t1`). It also stores where its clip begins inside the match
  video (`cut_t0`). The clip file starts at `t0` minus a pad, so `cut_t0` is
  that padded start on the match video's clock. Every playback rule in the
  app is built on that one fact.
- **The `edited` flag.** Any timing change flips it on. Only the worker's
  re-cut flips it off, and only if the timing has not changed again since it
  started cutting. The apps treat `edited` as "this clip file is stale".
- **The re-cut job.** The apps insert a `reclip` job themselves after an
  edit. The worker downloads the entire original upload, cuts every stale
  point from it, uploads each file, and clears `edited`.

---

## 3. Why it feels slow today

Measured from the code, for one Adjust on a 45-minute match:

| Stage | Time | Where |
| --- | --- | --- |
| Web waits before even asking (debounce) | 4 s | `MatchView.tsx` |
| Worker idle poll | up to 2 s | `worker.py` |
| Worker busy with someone else's upload | the rest of that job, tens of minutes | one queue, one process |
| Download the whole original upload | 0.6 to 4.8 GB, minutes | `process_reclip` |
| Cut one clip with the software encoder | a few seconds each, one after another | `process_reclip` |
| Upload and record | seconds | `process_reclip` |
| Apps notice the new file (poll) | up to 8 s on web; iOS often never | see below |

The cutting is the smallest part. The download and the queue are the wait.

Things that read as "slow" but are stuck states, found in the reads:

- Close or reload the web page within four seconds of an edit and the re-cut
  is never requested. The card shows "Updating clip" until some later edit
  happens to request one.
- On iOS, editing from the point screen never starts the refresh poll, and
  the refresh never fetches the new file's path. The new file is invisible
  until the match is closed and reopened; Share says the rally has no video.
- iOS caches clip links for 45 minutes and never invalidates them, so
  Starred plays the old footage long after the new file exists.
- Delete a point that was edited, let the worker run, then restore it: it
  spins forever. The worker skips deleted points and nothing re-requests.
- A three-way split that fails halfway on iOS leaves the created halves
  spinning with no job.
- Any failure in the worker's loop leaves every point after it flagged
  forever, silently.
- While a point is flagged, Adjust is locked on it ("This clip is still
  updating from an earlier change"). Nudge, look, nudge again is impossible.

And one that is not slow but is wrong: **Adjust never updates `cut_t0`**.
Move a point's start three seconds earlier and the scoring screen starts it
three seconds into the rally and pauses three seconds late, on every replay,
forever. The re-cut fixes the file, not the position. This is the real reason
the Adjust lock exists: the Modify sheet's map of the match video is only
right until the first Adjust.

---

## 4. Design principle

**The timeline is the truth. The file is a copy.** Every surface the owner
uses to watch or correct a point plays from the match video using the
timeline, so it is right the instant the timeline changes. The clip file is
regenerated in the background for the surfaces that genuinely need a file,
and the owner is never asked to wait for it.

Six rules follow, and every step below serves one of them:

1. `cut_t0` always equals the padded start of the point's current `t0`, on
   the match video's clock. The database keeps it that way on every timing
   write; the apps never compute it for a save.
2. A point plays from the first available of: its clip file if current; the
   match video, windowed, if the file is stale or missing; the stale file
   with a label; a placeholder.
3. Every timing write requests a re-cut inside the database. No client
   timers, no client job inserts.
4. A re-cut reads footage by URL and byte range. It never downloads a whole
   file.
5. The owner never waits on a file to see or re-edit a point.
6. A clip file made by the phone is indistinguishable from one made by the
   worker: same key layout, same container, same pads, same accounting.

---

## 5. Step 0: Foundations

These are prerequisites. Step 1 plays the wrong window without 0a, and stays
stuck without 0b and 0c.

### 0a. Adjust re-anchors `cut_t0`, in the database

Replace the apps' direct `t0`/`t1` update with one function, `adjust_point`,
that takes the point id and the new start and end and does all of this in
one statement:

- Dissolves a tight flag on any edge that moved (today's rule).
- Re-anchors: `cut_t0 := max(0, cut_t0 + (t0_new − effPre_new) − (t0_old − effPre_old))`,
  where `effPre` is the pad actually used on that edge (0.3 s on a split
  edge, the match's pad otherwise). A point with no `cut_t0` keeps none.
- Clears the observed endings (`scored_at_cut_s`, `rally_end_cut_s`) when the
  **end** moved. Those are "the rally was over by here" observations; a
  player who deliberately extended the end has overruled them, and today the
  old tap wins again the moment the flag clears, so the extension is never
  played in Score the Match and is cut from reels.
- Leaves `edited` to the existing trigger.

Both apps call this function from the Modify sheet and the point view. The
client's ability to update `t0`/`t1` directly is withdrawn once both apps
are on the function, so no path can move a point without moving its anchor.

**Backfill.** Points adjusted before this ships have drifted. For every
original point (one that was cut by the pipeline, not born from a split or
an insert) the correct anchor is recoverable from `match.json` in storage,
which records each point's original padded start and `cut_t0`:
`cut_t0 := json.cut_t0 + ((t0_now − effPre_now) − json.clip_t0)`. Split
children and inserted cards that were later adjusted cannot be recovered
exactly and are left alone; they are re-anchored correctly on their next
Adjust. One-off script, run once, reported by count.

### 0b. Re-cut requests move into the database

A trigger on `points` requests a re-cut whenever a row ends up with
`edited = true` and `deleted = false` after a change to timing, `edited` or
`deleted`. The request is one row in `jobs` per match, enforced by a unique
partial index (kind `reclip`, status `queued`, the match id), inserted with
`on conflict do nothing`, and sent to the queue with a five-second delay so
a burst of edits becomes one job. This replaces the web's four-second timer
and iOS's immediate insert, covers Split, Join, Adjust, Insert, Unsplit and
Restore with no client code, works across tabs and devices, and cannot be
lost by closing a page.

The worker keeps its guard (claim a clip only if `t0`/`t1` are unchanged)
and adds two behaviours: when a job finishes, if any point on the match is
still flagged and not deleted, it requests another job through the same
path; and a failure on one clip records that clip's error and continues to
the next rather than abandoning the rest. A re-cut that fails twice for a
point surfaces on the admin uploads page rather than spinning in the app.

### 0c. The apps stay current

- iOS starts the pending-clip refresh from every surface that can edit,
  including the point screen, and the refresh fetches `clip_path` so a new
  file is learned without reopening the match.
- Clip link caches on both platforms are keyed by the file path, not the
  point id, so a new file is a new cache entry. The 45-minute iOS cache and
  the web Starred cache both follow.
- A signed video URL that fails after expiry (six hours for the match video,
  one hour for a clip) is re-minted once and playback resumes at the same
  position, on both platforms, instead of failing silently. This is a
  playback-seamlessness fix in its own right: leave Score the Match open for
  an hour today and inserted cards go black.
- The web refresh merges only the fields it fetched and never overwrites a
  local change that is younger than the fetch.

### 0d. Two insert corrections that belong to the same foundation

- `insert_point` marks the trimmed edge of each neighbour as tight, so the
  neighbour's re-cut clip stops 0.3 s past the new card rather than running a
  full pad into it (today's double-padded seam).
- The media URL route returns the library trim start it already knows
  (`jobs.options.trim_start_s`), so the plus sheet's original-video preview
  stops playing from the wrong place on trimmed uploads. Both apps already
  read the field; nothing produces it.

---

## 6. Step 1: Play from the match video while the file catches up

### The point view (web desktop pane, web mobile sheet, iOS point screen)

Source rule, in order:

1. `edited = false` and a clip file exists: play the clip file, as today.
2. Otherwise, if the match video is available: play the match video
   windowed to the point, from `cut_t0` to the point's effective end. The
   window is computed with the same helpers Score the Match already uses;
   nothing new is derived.
3. Otherwise, if a clip file exists: play it with the existing "Updating
   clip" label. No processed match should reach this rung (the match video
   is kept for the life of the match); it stays as a defensive fallback.
4. Otherwise: the existing placeholder.

The player component already exists on both platforms: the web
`ClipPlayer` in its "cut" mode is the host for the original-video viewer,
the coach finding editor and the share player, and the iOS Modify sheet's
bounded player is the same loop. The point view mounts it on the match video
URL, seeks to `cut_t0` when metadata arrives, and stops at the effective
end. Frame capture for drawings works unchanged: the match video and the
clip come from the same bucket with the same signing, and Score the Match
already captures frames from the match video.

Swapping from the windowed match video to the fresh clip file happens only
at a quiet moment: when the clip is paused or has ended, or on the next open.
Never mid-play, and never with an autoplay restart with sound, which is what
happens today when the file lands while the point view is open.

Layout: the box is sized on a container from the match's known aspect, not
on the video element, so the swap does not jump and the mobile sheet's
neighbour peek keeps measuring the same block. Verify at 393×660.

### Score the Match (the scoring pad)

The chip spinner goes. Nothing is waiting from the player's point of view:
the pad already plays the match video, and with 0a its window is right.
The countdown and position rings return for edited points. The "Timing
saved · updating clip" flash becomes "Timing saved".

The detour (an inserted card whose footage is not in the match video plays
its own clip file) stays, and iOS recomputes the detour set when points
change, not only at start.

### The Modify sheet

- **The Adjust lock is removed** on both platforms. With 0a the sheet's map
  of the match video is always right, so there is nothing to protect.
  Nudge, save, watch, nudge again.
- **The preview follows the handles across real footage.** Today the picture
  freezes at the clip's own edge even where the match video holds the
  neighbouring seconds, which it does on the 55 percent of seams that are
  continuous and inside the neighbour's kept footage on every seam. The
  seam helpers the plus button already uses know exactly which match-video
  seconds are real; the sheet consults them to bound the drag. Beyond real
  footage the band turns hatched with the existing amber treatment and the
  caption says the footage is not in the match video, so a player who drags
  into removed dead time knows the file will carry it but the preview
  cannot.
- After Save, the sheet shows the new window from the match video and the
  point view behind it plays the same window. No spinner, no "try again in
  a moment".
- The split markers no longer reset when a background refresh lands
  mid-drag (the web point-view path rebuilds them from the live point).

### Starred

Tiles and the sequence player use the same source rule as the point view.
A stale tile draws its still from the windowed match video, so no owner
surface shows "Updating clip" any more. The existing state stays only as
the defensive fallback for a match with no video at all.

### Copy

- Remove: "This clip is still updating from an earlier change — try again in
  a moment." (both platforms) and "Timing saved · updating clip".
- Point view while playing from the match video: no label. The player asked
  for a change and is watching it.
- Point view on a stale file (match video gone): keep "Updating clip".
- Modify sheet beyond real footage: "That stretch was cut from the match
  video. The clip will still include it."
- Learn guide tip "A corrected clip can briefly show an updating state while
  PongLens prepares it." is removed once this ships. Same for the tutorial
  narration if it mentions waiting.

---

## 7. Step 2: The worker cuts by range, from the match video first

### Source selection

For each stale point the worker chooses a source:

1. **The match video**, when the window `[t0 − effPre, t1 + effPost]` lies
   inside kept footage. For matches processed with the current cut mode,
   `match.json` carries `cut_segments`, the exact list of original-video
   spans that were kept, and the position of the window in the match video
   is a piecewise-linear map over them. For older matches (spans mode,
   before `cut_segments` existed) the only known-kept footage is each
   original point's own clip window recorded in `match.json`; the match
   video is used when the new window lies inside that, otherwise the
   original.
2. **The original upload**, by URL, when the window reaches footage the
   match video does not hold.
3. **Neither available**: only possible on a legacy match processed before
   August 2026 whose original was swept back then and whose window reaches
   outside the match video. The point keeps its previous file and `edited`
   clears, rather than nulling the file. A stale clip with a label is better
   than no clip, and the apps already label it. The copy "Clip unavailable.
   The original video for this match is no longer stored" is kept only for
   points that never had a file.

### No downloads

Both sources are read by presigned URL with an input seek, so ffmpeg fetches
only the bytes around the window. The worker already does exactly this for
vertical share renders (`_cut_video_url` and `render_story` accept an
`https://` input); the re-cut adopts the same helper. A 30-minute match
that used to cost a multi-gigabyte download per edit costs a few megabytes
per clip. Library trims are honoured by seeking `trim_start_s` further into
the original rather than remuxing a trimmed copy.

### Parity and hygiene

- The re-cut's tail matches the original cut: the pipeline pads the end
  dynamically up to 2.0 s where there is room; the re-cut uses the flat pad
  and so is up to 0.7 s shorter. The re-cut uses the same dynamic rule, so
  an edited point does not lose its tail.
- The previous re-cut object is deleted and its storage row negated when a
  new one lands. Today every re-cut leaks the old file and its bytes stay on
  the player's quota.
- Duration of each re-cut is logged, so the next conversation about
  "how long does it take" has numbers.

---

## 8. Step 3: A second lane for small jobs

A second queue, `jobs_fast`, for kinds a person is waiting on: `reclip` and
the `v:` share renders. `enqueue_job` routes by kind; nothing else about the
job row changes. A second worker process on the Mac Studio runs the same
code with a `--lane fast` flag, its own launchd label and its own log file,
and reads only `jobs_fast`.

What must stay single, and moves behind a "main lane only" guard: the daily
retention sweep, the feedback and QA digests (their markers in `app_config`
are not atomic across processes), and the cost-alert thread. Everything else
in the worker already isolates per job (temp directories, the single-row
claim, pgmq visibility).

Two re-cuts for one match landing in both lanes is harmless with the
guarded claim and the old-object cleanup from step 2; the unique queued-job
index from 0b makes it rare.

**Close while here.** The `jobs` insert policy only checks `user_id`. From
the migrations, a signed-in client can insert any kind with any input path.
With 0b the apps no longer insert jobs at all, so the policy tightens to an
allow-list of client-insertable kinds (none, once share renders also move
behind their routes) and the trigger and RPCs enqueue as definer. This is
outside the brief but touches the same surface and should not be left open
once someone is looking at it.

---

## 9. Step 4: Hardware encoder for re-cuts

The re-cut calls the software encoder directly. The worker already has a
helper that prefers VideoToolbox and falls back to the software encoder,
used by reels, stories and automatic highlights. The re-cut adopts it with a
720-wide target at a bitrate chosen to match today's quality (the software
encoder's quality setting does not map one-to-one; pick the bitrate by
comparing a few clips side by side, once). Output stays H.264 8-bit, AAC,
even dimensions, index at the front, so every reader is unaffected.

Small win, free, and it removes the last reason a re-cut takes more than a
second or two of compute per clip.

---

## 10. Step 5: Cut on the iPhone

### When and from what

After any timing edit on iOS, the app cuts the affected points itself,
immediately, from the source it already has a URL for:

- the match video by range read (the same `AVURLAsset` on a signed URL that
  the Instagram share render uses; about 10 MB out of a file that runs to
  hundreds), when the window lies in kept footage, using the same seam
  helpers as step 1;
- the original upload by range read when it does not and the original is
  still available (the plus sheet already has that URL);
- nothing, otherwise. The worker's job, already requested by 0b, covers it.

### How

`StoryRenderer` is the template: composition, `insertTimeRange` over the
window, export session, `shouldOptimizeForNetworkUse` for the front index.
Differences: no overlay, no crop, landscape 720-wide output. Use an export
preset that yields H.264 8-bit and AAC (no HEVC, no HDR: desktop browsers
will not play it). The window is `[t0 − effPre, t1 + effPost]` with the
dynamic tail rule from step 2, so a phone clip and a worker clip of the same
point are the same length.

Measured on the story path: about 0.8 s of compute for a nine-second rally
on current phones, two to four seconds on the oldest supported phone, all
fixed-function video hardware.

### Upload and claim

A new route, `/api/point-clip`, with two actions:

- `sign`: verifies the caller owns the point, returns a presigned PUT for
  `points/<owner>/<match>/<idx>-<random>.mp4` with content type `video/mp4`
  and a byte cap.
- `complete`: calls a definer function `claim_point_clip(point_id, key,
  bytes, t0, t1)` that verifies ownership and key prefix, confirms the
  object's size server-side, then in one statement sets `clip_path` and
  clears `edited` **only where `t0`/`t1` are unchanged and `edited` is still
  true**, appends the storage row (`kind = clip`), and deletes the previous
  re-cut object. If the guard fails (the point changed again, or the worker
  got there first) the function returns "not applied" and the route deletes
  the uploaded object. `register_upload` is the precedent for a presigned
  PUT followed by one definer function that validates, records and accounts.

The media URL route pins clip signing to the `points/<owner>/` prefix, as
the voice-note branch already pins its own, since `clip_path` becomes
client-influenced.

### Switch and fallbacks

`app_config.device_reclip` = `off` | `on`, allow-listed for signed-in
readers like `instagram_render`. Default `off` until verified on a real
device. Any failure on the phone (no network, export error, app
backgrounded mid-export, timeout) is silent: the worker's job is already
requested and produces the file. The phone never retries. The temp file is
deleted after upload or failure (the story renderer leaves its files behind
today; fix both).

Data use: a nine-second 720p clip is two to three megabytes up. No Wi-Fi
gate. The range read of the match video is a similar amount down.

### What every reader of clip files needs from a phone-made file

From the surfaces audit: same key layout; H.264 8-bit, AAC, even
dimensions, index at the front; frame zero at `cut_t0`'s frame (the detour
on both platforms assumes it); at least the padded tail. The worker's
RTMPose stages read only the worker's own local clips during first
processing and are unaffected. Reel and tag-reel renders take their target
format from the first clip they see, so a phone clip must carry audio when
the match has it (a silent clip mutes the whole reel).

### Web does not cut on device

Browsers have no equivalent of the export session. WebCodecs can decode and
re-encode and a JavaScript muxer can write the container, but Safari's
support is uneven, the code is a few thousand lines, and after steps 1 to 4
the web experience is already instant for the owner and a few seconds for
everyone else. Not now. Revisit only if the worker lane is ever the
bottleneck for web users specifically.

---

## 11. The plus button (Add a missing rally)

What shipped differs from its August 30 design: a standalone sheet that
plays the original upload, its own geometry, the database call inline, and
no undo. The reads found sixteen concrete gaps on web and matching ones on
iOS. The changes, both platforms:

- **Play the match video when it holds the footage.** The sheet opens on
  the match video for a continuous seam or a window inside a neighbour's
  kept footage, and on the original upload only when the window reaches
  removed dead time. The hatched band marks removed stretches on both
  sources. This makes the common case open instantly and stop needing the
  original at all.
- **The card plays immediately.** On a continuous seam the new card plays
  from the match video the moment it exists (step 1). On a removed seam the
  iPhone cuts the file on the spot from the original (step 5); on web the
  card shows the original-video window it just previewed until the worker's
  file lands, instead of the neighbour's footage under the new number.
- **Undo.** A snackbar with Undo for ten seconds after Add, backed by a new
  `uninsert_point` function that restores both neighbours' start, end and
  tight flags and deletes the card, allowed only while the card is untouched
  and its neighbours unchanged. Removing the card by hand today leaves the
  neighbours trimmed and the serve corrections cleared.
- **Say what happens to the neighbours before Add.** The caption states
  "Card 12 will end 1.4 s earlier" when the window overlaps, and the RPC
  returns the trimmed neighbours so the apps stop re-deriving them.
- **One handle-and-track component shared with Modify.** The plus sheet
  gets the ±1 s step buttons, the rotated-phone axis handling and the
  one-seek-in-flight guard the Modify sheet already has. The iOS insert
  sheet issues an exact seek per drag sample on the largest file in the
  system, the pattern the Modify sheet documents as having got the app
  killed.
- **Correct copy.** The tooltip says "The match video skips N seconds here"
  only when the cut actually removed footage; on a continuous seam it says
  "Add a rally between these two". "The original video is no longer
  stored" is shown only when the original is really gone, which is only
  possible on a legacy match (today it can be false for older rows).
- **Clamp head and tail inserts** to the file's real length; stop and move
  the playhead on the match-video fallback (today it plays on forever);
  make the winner part of the insert write; disable Cancel while the add is
  in flight.

---

## 12. Held: Modal as a backup processor

Adil wants the processing pipeline runnable on Modal as a backup when the
Mac Studio is down or saturated. That is its own spec. This design keeps
the door open by:

- moving every re-cut request into the database (0b), so a consumer on any
  machine sees the same queue;
- reading footage by URL and range (step 2), so a re-cut needs no local
  copy and no Mac-only storage;
- splitting lanes by queue (step 3), so a remote worker can subscribe to the
  fast lane, the main lane or both;
- keeping the hardware encoder behind the existing prefer-then-fall-back
  helper (step 4), so the same code runs without VideoToolbox;
- reading secrets through the existing environment-variable-or-Keychain
  helper, which already works without a Keychain.

What Modal will still need and this spec does not do: the ball detector's
interpreter and weights, the table-keypoint model that lives outside the
repo, and the YouTube importer, which must stay on a residential IP.

---

## 13. Rollout and switches

| Key in `app_config` | Values | Default | Gates |
| --- | --- | --- | --- |
| `reclip_source` | `raw`, `cut_first` | `cut_first` | Step 2: whether the worker cuts from the match video where it can. `raw` is the rollback. |
| `reclip_lane` | `main`, `fast` | `main` | Step 3: flipped to `fast` only after the second worker process is running. |
| `device_reclip` | `off`, `on` | `off` | Step 5: the iPhone cuts and uploads. |

Step 1 (playing a changed point from the match video) has no switch: the
source rule is app code and ships with the app release. Step 0 is database
functions and a trigger, applied with the migrations. The plus-button
work rides with the same app release as step 1.

Order of landing: apply the migrations (0a to 0d, the fast lane, the
device claim) and deploy the worker together; run the two backfills; ship
the web; ship the iOS build; start the fast-lane process and flip
`reclip_lane`; try `device_reclip` on one handset.

---

## 14. Verification

On desktop web, mobile web at 393×660, and native iOS, on a recent match
and on a legacy match processed before August 2026 with no original:

- Adjust the start 3 s earlier. The scoring pad starts 3 s earlier and
  pauses at the same deciding shot. The point view plays the new window
  within a second. Adjust again by 1 s without closing anything.
- Adjust the end 5 s later on a scored point. The extension plays in Score
  the Match and appears in a share render.
- Split three ways, Join two, and Undo each where Undo exists. The children
  play the right footage before any file exists.
- Add a rally on a continuous seam and on a removed seam. The card plays
  the right footage immediately in both cases on iOS; on web the removed
  case shows the previewed window until the file lands.
- Reload the web page one second after an edit. The file still arrives.
- Delete an edited point, wait, restore it. No spinner.
- Leave Score the Match open for 65 minutes with an inserted card. It still
  plays.
- With `device_reclip = on`, edit on the phone in airplane mode. Nothing
  visible fails; the worker's file arrives after reconnecting.
- Confirm a phone-made clip plays in desktop Chrome and Firefox, in a coach
  review, on a public point link and in a tag reel with sound.
- Watch a whole re-cut match, not just the edited point, on each platform.

---

## 15. Surfaces checklist

Every rule touched here exists in more than one place. The implementer
checks each row, per the working notes' "think in surfaces" rule.

| Rule | Worker | iOS | Web desktop | Web mobile |
| --- | --- | --- | --- | --- |
| `cut_t0` anchoring | `points_pipeline.py`, `process_reclip` | `Playhead.swift`, `PointExtras.swift`, `ModifySheet.swift` | `playhead.ts`, `modifyOps.ts`, `ModifyClip.tsx` | same files |
| Pads and tight edges | `CLIP_PADDING`, `TIGHT_PAD` | `Playhead.swift` | `clipEdit.ts` | same |
| Seam and kept footage | `cut_segments` in `match.json` | `InsertGeometry.swift` | `insertGeometry.ts` | same |
| Source rule for a point | | `PointDetailScreen`, `StarredScreen`, `PlayerTakeover` | `PointDetail.tsx`, `starred/` | `PointSheet.tsx` |
| Stale-state copy | | Modify sheet, point screen, Starred | `ModifyClip.tsx`, `PointDetail.tsx`, `Player.tsx` | same |
| Learn guide and tutorial | | `learn-catalog.json` | `playerGuides.ts`, `SCRIPT.md` | same |
| iOS behavioural spec | | `ios/docs/behavioral-spec.md` | | |

---

## 16. Status, 2026-09-06

Everything below is on branch `claude/paulins-video-edit-processing-u0wozl`,
one commit per step, each pushed after the checks named.

### Landed

- **Retention closed** (separate from this spec, done first): the sweep
  protects any raw or cut a live match references, the placement retry
  deadline no longer applies to a kept original, and every 30-day claim in
  code, copy and docs is corrected. `worker/backfill_raw_path.py` fills
  `matches.raw_path` for legacy rows whose file survived.
- **0a** `adjust_point` re-anchors `cut_t0` and clears observed endings on
  an end move; both apps call it and mirror it (`reanchorCutT0`, tested);
  `worker/backfill_cut_t0.py` repairs earlier drift from match.json.
- **0b** re-cut requests come from a trigger on `points`, one queued job
  per match, five-second queue delay; the worker continues past a failed
  clip and requests another pass for mid-run edits; the `jobs` insert
  policy allows only YouTube imports; flagged points with no job get one at
  migration time.
- **0c** the web refresh fetches `cut_t0` and never clobbers a local change
  under ten seconds old; both players mint a fresh link once on failure and
  resume; iOS refreshes `clip_path` and `cut_t0`, starts the refresh from
  the point screen, keys clip links by file path, reloads a changed detour
  clip and recomputes the detour set on change.
- **0d** `insert_point` tightens trimmed edges and moves the next card's
  anchor; `match_pre_pad` is the one pad lookup; the media route returns
  the library trim start.
- **1** the point view plays a stale or missing clip from the match video,
  windowed (web `ClipPlayer` `range`, iOS `ClipPlayerView` `window`);
  source decided on open, flipped on an edit, file swaps in on the next
  open; Adjust lock removed on both platforms; Modify preview follows the
  handles across contiguous footage (`contiguousCutBounds` shared with
  step 5 on iOS); chip spinner, timeline label, flashes and the Learn tip
  removed.
- **2** the worker cuts by presigned URL and range, from the match video
  where match.json proves the footage is kept (`_CutMap`, tested), from
  the original otherwise; keeps the birth tail; deletes the previous
  re-cut object; keeps the old file when no source holds a window.
- **3** `jobs_fast` queue, `--lane fast`, housekeeping main-lane only,
  launchd unit and README steps, routing behind `reclip_lane`.
- **4** re-cuts use the VideoToolbox-first helper.
- **5** `claim_point_clip`, `/api/point-clip` (sign, complete), clip
  signing pinned to the owner's folder, `ClipCutter` and
  `recutOnDevice` on iOS hooked into Adjust, Split, Join and Insert,
  behind `device_reclip`.
- **Plus button**: match video first on a continuous seam (both
  platforms); `sourceToCut` linear across a continuous seam, which also
  fixes the anchor of a card added into such a gap; correct stop and
  playhead on the cut; one-seek-in-flight guard on iOS; neighbour trims
  said in the caption; head and tail clamped to the file; honest tooltip.

### Verified here

`npm run build` after each step; `test:match-structure` (131),
`test:placement` (103), `test:learn` (36); worker unit tests for
retention, the cut map and the re-cut key rule; eslint and `tsc` on the
changed files (the repo's pre-existing lint and test-file type errors are
untouched). Nothing was run against the live database beyond read-only
queries. **The iOS changes were written without a compiler**: this
container has no Xcode. They follow the surrounding code's patterns
closely, but the first build on a Mac is the first compile.

### Not done, in order of value

- Starred (web and iOS) still plays clip files and shows "Updating clip"
  on a stale one; its rows carry no `cut_t0` or pads, so the windowed
  source needs the `starred_points` function extended first.
- Undo for Insert (`uninsert_point`) and a shared handle-and-track
  component between the Modify and Add sheets.
- A phone-made clip uses the flat tail, not the birth tail the worker
  keeps (up to 0.7 s shorter on an original point).
- Public and coach surfaces still play a stale clip of an edited point
  with no filter (Appendix A, item 6); with re-cuts now taking seconds
  this window is short, but it is not zero.
- Modal as a backup processor (section 12).

### To do on the Mac and in Supabase

1. Apply the migrations in order (they are timestamped after
   `20260906041000`). 2. Deploy the worker; restart it. 3. Run
   `worker/backfill_raw_path.py --dry-run`, then for real; same for
   `worker/backfill_cut_t0.py`. 4. Ship the web. 5. Build the iOS app on
   a Mac, fix whatever the compiler says, ship. 6. Build the fast runner
   (README "Fast lane"), load its launchd unit, then set `reclip_lane` to
   `fast`. 7. On one handset, set `device_reclip` to `on` and edit a
   point; check the file plays in desktop Chrome.

---

## Appendix A: findings from the reads, with references

Line numbers are from the tree on 2026-09-06. Full detail in
`docs/research/2026-09-06-clip-edits/`.

### Correctness

1. Adjust does not re-anchor `cut_t0`: `modifyOps.ts:170-179`,
   `MatchView.tsx:2258-2289`, `PointExtras.swift:341-378`,
   `worker.py:5338-5343`, against the anchoring fact `playhead.ts:9-34`.
   Also breaks reel segments (`reel/route.ts:413-424`) and the share render
   window (`SharePointSheet.swift:375-388`).
2. `effectiveEnd` drops the winner tap while edited and re-applies the stale
   tap after: `playhead.ts:141, 150-156`; nothing clears `scored_at_cut_s` on
   a timing edit.
3. Insert leaves trimmed neighbours untightened, double-padding the seam:
   `101_insert_point.sql:117-121`, `worker.py:5316-5317`.
4. Re-cut tail is flat while originals are dynamic: `points_pipeline.py:291,
   3040` vs `worker.py:5318`.
5. Plus sheet plays the original at the wrong offset on trimmed uploads:
   `InsertPoint.tsx:108-119`, `InsertSheet.swift:375-385` read `trimStartS`
   that `media-url/route.ts:320-347` never returns.
6. Public and coach surfaces play stale clips of edited points with no
   filter and no label: `resolve_share_link` (`153`), `resolve_share_starred`
   (`015`), `resolve_share_tagged` (`036`), `review-media/route.ts:158-173`,
   `resolve_sample_review` (`078`); tag reels render stale files
   (`tag-reel/route.ts:80-85`).

### Stuck states

7. Web re-cut request lost on navigation within 4 s: `MatchView.tsx:2176-2182`.
8. iOS poll not started from the point screen: only `MatchDetailScreen.swift:799`,
   `PlayerTakeover.swift:507, 2945` call it.
9. iOS refresh omits `clip_path` and the model field is immutable:
   `MatchDetailScreen.swift:103`, `Models.swift:253`.
10. iOS clip link cache never invalidated: `ClipFrames.swift:17-53`
    (`forget` has no callers); web Starred cache `clipUrls.ts:16`.
11. Deleted-then-restored edited point never re-cut: `worker.py:5267`,
    `MatchView.tsx:1798-1816`, `MatchView.tsx:2432`.
12. iOS mid-sequence split failure enqueues nothing: `PointExtras.swift:221-241`.
13. Worker abandons the rest of the loop on one clip's failure and leaves
    rows flagged: `worker.py:5321-5328` under `check=True`; failed re-cuts
    do not notify (`066:56-60`).
14. Dedupe only while queued, so edits during processing spawn N jobs, each a
    full download: `MatchView.tsx:2158-2168`, `PointExtras.swift:381-392`.
15. `enqueueReclip` ignores insert errors: `MatchView.tsx:2171-2173`,
    `PointExtras.swift:400-407`.

### Playback seamlessness

16. No re-mint after signed URL expiry: `Player.tsx:5300-5305`,
    `PointDetail.tsx:499-503`, `PlayerTakeover.swift:3643-3651`.
17. Refresh clobbers optimistic state: `MatchView.tsx:2436-2449`.
18. Refresh resets split markers in the point-view Modify: `ModifyClip.tsx:150-168`
    from the live point at `PointDetail.tsx:900`.
19. New file landing mid-read restarts and autoplays with sound:
    `PointDetail.tsx:347` into `ClipPlayer.tsx:569-617`.
20. Modify preview freezes at the clip's edge even where the match video is
    continuous: `ModifyClip.tsx:318-321`, `ModifySheet.swift:565-576`;
    seam helpers exist at `insertGeometry.ts:73-134`,
    `InsertGeometry.swift:75-116`.
21. Adjust lock: `PointDetail.tsx:269, 930`, `Player.tsx:8202`,
    `ModifyClip.tsx:750, 948`, `ModifySheet.swift:216-218, 758-759, 900`.
22. iOS detour set computed only at start: `PlayerTakeover.swift:3111, 3218`.
23. Insert sheet seek storm on iOS: `InsertSheet.swift:248-257, 346-351` vs
    the guard at `ModifySheet.swift:1107-1143`.
24. Insert sheet on the match-video fallback never stops: `InsertPoint.tsx:239-243`,
    `InsertSheet.swift:406-417`.
25. Insert opening autoplay starts at 0:00 on web: `InsertPoint.tsx:151-170`.

### Missing reversibility

26. No undo for Insert anywhere; no undo for Join anywhere; no undo for
    Adjust from the web point view; no Split, Join or Adjust undo on iOS:
    `Player.tsx:4754-4902`, `ScoreLogic.swift:453-463`.

### Hygiene and security

27. Every re-cut leaks the old object and its ledger bytes:
    `worker.py:5331-5345`.
28. `jobs` insert policy checks only `user_id`; `kind`, `input_path`,
    `options` unconstrained: `001_init.sql:57-60`.
29. Media URL route signs any `clip_path` without a prefix check:
    `media-url/route.ts:389`; the note branch pins its own at `260-267`.
30. Story renderer never deletes its temp files: `StoryRenderer.swift:170-172`.

---

## Appendix B: where things live

| Thing | Path |
| --- | --- |
| Re-cut job | `worker/worker.py` `process_reclip` (~5228) |
| Original clip cut, `cut_t0` stamping, `match.json` | `worker/points_pipeline.py` `cmd_points` (~3030), `cmd_cut` (~952) |
| ffmpeg by URL precedent | `worker/worker.py` `_cut_video_url` (~6518), `render_story` (~6278) |
| Hardware encoder helper | `worker/worker.py` `_run_ffmpeg_encoded` (~5820) |
| Queue and dispatch | `worker/worker.py` `read_message` (535), `process_job` (~7196) |
| Split, join, unsplit, insert, edited trigger | `supabase/migrations/023, 027, 026, 101, 007` |
| Web timeline helpers | `src/app/match/[id]/playhead.ts`, `clipEdit.ts`, `modifyOps.ts`, `insertGeometry.ts` |
| Web surfaces | `Player.tsx`, `ModifyClip.tsx`, `InsertPoint.tsx`, `PointDetail.tsx`, `PointSheet.tsx`, `MatchView.tsx`, `ClipPlayer.tsx` |
| iOS timeline helpers | `ios/.../Core/Playhead.swift`, `InsertGeometry.swift`, `PointExtras.swift` |
| iOS surfaces | `Screens/PlayerTakeover.swift`, `ModifySheet.swift`, `InsertSheet.swift`, `PointDetailScreen.swift`, `StarredScreen.swift`, `MatchDetailScreen.swift` |
| On-device render precedent | `ios/.../Core/StoryRenderer.swift`, switch in migration `136` |
| Upload precedent | `ios/.../Core/RecordingQueue.swift`, `src/app/api/upload-url/route.ts`, `register_upload` (migration `131`) |
| Signing | `src/app/api/media-url/route.ts`, `src/lib/r2.ts` |
| Retention | `worker/worker.py` `retention_sweep` (~7914), `_live_cut_paths` (~7847) |
