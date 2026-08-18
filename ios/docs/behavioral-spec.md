# Behavioral spec — match player, scorekeeper, journal, upload, stats

Extracted 2026-08-17 from the web source by a deep-dive read. This is the authority
for porting these screens. Constants were tuned against real sessions — do not
change them.

---

# SCREEN 1 — Match player

## 1.1 Route, data load, status branches

`src/app/match/[id]/page.tsx` (server component). Auth gate → login. Five parallel
reads: matches row (404 → notFound), points by idx asc, notes by created_at asc,
RPC `match_note_authors(p_match_id)`, RPC `is_admin()`.

**Branch A — raw/unprocessed** (`RawMatchView`): when `status === "uploaded"` OR
(`raw_path != null` && status processing|failed). Extra loads: presigned raw GET
(6h inline), `my_processing_state()`, latest jobs row for this match.

**Branch B — processed** (`MatchView`): plus tags, point_tags, source job's
`options.strictness` (default "normal"; coaches can't read it → fallback),
`player_profiles.handedness`, `loss_reason_labels`.

`canLabelServeStart = is_admin() && match.user_id === user.id`.

Chrome: `AppNav` directly, NOT AppShell — media-first pages go full-bleed.

### RawMatchView states
Status pill: "Processing" | "Processing failed" | "Not processed".
- Undecodable file: "This browser can't play this file." + explanation (native app:
  HEVC plays fine — drop this state).
- No file: "The video file is not available."
- Processing: heading "Processing", progress bar at max(4, job.progress)%, "You can
  leave this page. We email you when the match is ready." Poll jobs 8s;
  refresh on done.
- Failed: amber `job.user_message ?? "Processing failed, and your minutes came back."`
- "Break it into points" panel (owner, no running job, commerce on):
  duration unknown → "Play the video once so we can read its length."
  TrimBar + "Start here" / "End here" / "Reset" (start clamps ≤ end−5, end ≥ start+5).
  Toggle "Placement maps" / "Where every ball landed. Adds processing time."
  Segmented "Cut strictness" / "How much room to leave around each point." →
  Tight | Normal | Loose.
  Primary: "Process · {minutes}", disabled unless balance ≥ charge. "You have {m}."
  + "Get more minutes" → /account when short.
  POST /api/process. Errors: "Not enough minutes for this video." / "Your queue is
  full. Wait for a video to finish." / "Something went wrong. Try again."
- Match details panel: opponent (NameCombobox), venue, type chips
  (drills|practice|match|league|tournament), PickSide "Which player are you?" at 60s.
  Autosave with transient "Saved".
- Delete: two-step in place — "Delete video" → "Delete for good?" + "Keep it".

## 1.2 MatchView layout (top to bottom)

1. UpLink pill → /matches, "Matches".
2. Header: title from deriveMatchTitleParts (primary "{opponent} · {venue}",
   secondary "{date} · {type}"), pencil (owner) → details panel, gear (owner) →
   menu: "Unscore match" (disabled at 0 confirmed), "Delete match".
3. Meta line: secondary title + GamesToggle (games won); tap expands ScoreLine.
4. Details panel: "Your name", "Opponent", "Venue", type chips
   (practice|league|tournament here), "Done".
5. DownloadCard wrapping the Player poster. Footer "Full video" / "Playtime only" +
   download control. POST /api/media-url {matchId} → location.href. Error:
   "Couldn't create a download link. Try again shortly."
6. CoachCta (non-owners, dismissible).
7. Tools card (owner): "Score Keeper" + games · "Share" + "{n} link(s)"/"Not shared" ·
   "Coach" + "Shared"/"Invite your coach" · ReelRow "Export" · PlacementToolsRow +
   BetaPill + status · "Match analysis" + summary ("Score points to unlock" |
   "Finish a game to unlock" | "{n} scored · add detail" | "{d}/{n} detailed" |
   "{n} points · complete") · "Notes" + "{n} note(s)"/"Add a note" ·
   "Match details" + "{opponent} · {venue}"/"Add opponent and venue" ·
   "Your side" + "Bottom of video"/"Top of video"/"Set your side" ·
   "Report an issue" + "Something look off?" → /feedback?matchId=.
8. Side banner (owner, cut offsets, user_side null, not dismissed): "Which player
   are you?" / "So your labels and placement maps come out right." Dismissal in
   localStorage["ponglens:side-asked:{id}"]. Save failure: "That didn't save.
   Check your connection and try again."
9. First-server banner (owner, first_server null, points exist): "Who served
   first?" / "Sets the serve rotation for the whole match." Me/Them buttons, auto
   guess pre-highlighted, "Auto-detect thinks you/they served first."
10. Split view: points list left, sticky detail pane right (desktop).
11. AnalysisCards (owner): Overview, "Why you lost", "Serve".
12. Placement maps (#ball-map, owner).
13. "Overall notes" / "Notes about the whole match. Type or record a voice note."
    + NoteComposer "How did the match go?"
14. Floating match bar on scroll-out (back chevron, title, GamesToggle).
15. Floating back-to-top (conditions: scoreDetached && !playerOpen && pointsExpanded).
16. Undo snackbar (bottom center): text + "Undo" + ✕. Cmd/Ctrl+Z fires Undo.

### Points list
- Timeline = non-deleted sorted by t0 (fallback idx). Display numbers are positions
  in the full visible list — filtering never renumbers.
- Filter rows: Serve (Anyone/I served/They served), Winner (Anyone/I won/They won),
  Tag (Any tag + per-tag chips with counts), Only (Starred/Skipped/Deleted).
  Selecting Deleted resets other filters, shows removed list.
- Game checkpoint chips ("Game 1"…) scroll-jump.
- Cards: number badge, ServerChipMenu, winner text ("I won"/"They won" or names),
  duration "{x.x}s" or "View point", note glyph+count, tag glyph+count,
  "Updating clip" (pulsing) when edited.
- Owner controls: You / Them / Skip (tap-again toggles off), Tag, Star, Trash.
  Non-owners: Tag + read-only star.
- Game divider: "Game {n} ends {you}-{them} · game {n+1} begins" + ↑/↓ nudges +
  ✕ "Game didn't end here".
- POINTS_PREVIEW = 10. "Show all {n} points" ({hidden} more) / "Show first 10".
  Persists in localStorage["ponglens.pointsExpanded"] → UserDefaults.
- Empty states: "No point breakdown for this match." / "No points in the timeline."
  / "No points match these filters." / "No removed points."
- "Removed ({n})" disclosure: rows "At {m:ss} · {x.x}s" + "Restore".
- Swipe-left-to-remove: SWIPE_OPEN_PX −88, 8px direction lock → native .swipeActions.
- Deep link ?p=<n or id>; selection writes ?p={index+1} via replaceState.
- Desktop arrows navigate points when player closed.

### Point view
PointDetail shared body. Desktop: sticky aside "Point {n} · {n} of {total}" +
running ScoreLine. Mobile: PointSheet — full-screen, neighbour peeks (skeletons,
deliberately not real players), horizontal drag commit at 25% width or flick
|vx|>0.5 && >32px, 200ms slide.
Sections: clip (ClipPlayer + tag/star overlays + prev/next chevrons), action bar
(incl. Remove; "Remove the {n} points before this / warm-up" + inline confirm),
PointScorecard (owner), "Where the ball landed" + BetaPill, "Notes"
("No notes on this point yet.").
Clip fallbacks: "Updating clip…" / "Clip unavailable — the original video has
expired, but your timing edits are saved." / "Loading clip…"
Closing a sheet opened from the score pad reopens the pad on that point.

## 1.3 Playback model (playhead.ts) — carry over VERBATIM

One video element, never remounted. Poster ↔ full-screen takeover; play() must run
synchronously in the tap's call stack (iOS), currentTime survives exits.

`cut_t0` = PADDED clip start in cut seconds = max(0, t0 − effPre) in source terms.
Span: cut_t0 —effPre→ serve —(t1−t0)→ rally end —effPost→ clip end.

- clipPad(strictness, match.clip_pads): stored pads first; frozen fallback
  tight {0.5, 1.0}, normal {1.0, 1.6}, loose {1.6, 2.4}.
- effectivePad: split-born edge uses min(pad, TIGHT_PAD 0.3).
- rallyEnd = cut_t0 + effPre + (t1 − t0); paddedEnd = rallyEnd + effPost.
- pauseEnd = clamp(rallyEnd + min(effPost, PAUSE_BEAT_S 1.2), rallyEnd,
  nextStart − 0.05).
- cutToSource(p, T) = max(0, t0 − effPre) + (T − cut_t0).
- playingPointId: last point whose (cut_t0 − 0.25) is reached (WYSIWYG).
- displayTarget = review ? reviewPoint : endPausedPoint ?? targetAt(...) ?? armedPoint.
  targetAt holds the previous rally as target when hold (score/play) and this run
  started before that rally's end — kills tight-cut stutter. targetId drives chip
  ring, ticker, serve ball, tap targeting, chevrons — never disagree.

Auto-skip: deleted spans [cut_t0, paddedEnd] clamped to next visible cut_t0,
merged; jumped during playback only, never mid-scrub. Skipped (let) spans: watch
mode only, only when played into. snapLanding pushes out of deleted spans; snaps to
first visible point in the dead lead (always in score mode).

Pause-at-end (score/play): fires when playing, not scrubbing, rally unscored,
boundary inside tick (prev, t] with t−prev < 1, run started before rally end, run's
start rally not later, no play() within PLAY_GUARD_MS 500. Answered rallies stop at
paddedEnd. Re-arm: dip ≥ REARM_BACK_S 1.5 before boundary or different rally
crossed. Pause pins chip + tap targeting to endPausedId; play() clears pin.
lastTick nulled synchronously in seekTo/on seeked/pause.

### Gestures (rotation-aware, local space)
- Single tap: play/pause both modes (+ chrome). At auto-pause, plain tap resumes
  WITHOUT scoring.
- Double tap (DOUBLE_TAP_MS 250): right half next / left half previous point;
  seeks to cut_t0 + auto-plays. Flash "Next · point {n}" / "Back · point {n}".
- Hold (HOLD_MS 250): left 0.25x / right 2x while held; restore rate after.
  Pills "0.25x ◀▶" / "2x ▶▶".
- Pinch (score mode): 1x–4x (ZOOM_MAX 4) around midpoint; one-finger pan zoomed,
  clamped. Zoom persists across navigation; reset by − button, pinch out, leaving
  score mode, or close. Pan-lift swallowed (never a tap).

### Chrome
Top bar (auto-hide 2.5s): "?" gestures; watch adds Replay, SpeedMenu, Star,
"Jump to a point" grid, note button, "Score Keeper" pill; close ✕.
Bottom transport: play/pause, m:ss, scrub (buffered + cyan fill + thumb), duration,
zoom −/+, fullscreen.
Fullscreen natively: real rotation/AVKit (delete the whole fake-landscape path).
Poster tap → chooser sheet when canScore && unscored: "Watch the match" / "Play the
cut video from the start." · "Score as you watch" / "Say who won each point as it
plays. Takes about ten minutes." · footer "Tap anywhere to close".
Open/close: history.pushState/popstate → native navigation state.
Watch extras: newest note overlay top-left (author + 2-line + "+{n}"), ScoreBug
bottom-left of the PICTURE (AVPlayerLayer.videoRect natively) using enteringScore.
Buffering spinner on waiting/stalled.

## 1.4 Keep score

Mode = watch|score; Phase = play|summary|review.

Entry openScore(atPointId?): clears undo stack, phase play, unpin, reset zoom, seek
to atPointId ?? first unscored ?? current, snapped. Toast "Resuming from point {n}"
when jumped. Setup sheet: "Who's playing?" / "Names show on the scoreboard in
shares and exports." (Your name / Opponent's name) and/or "Who served first?" (auto
guess highlighted). Combined sheet when both missing. "Skip" never blocks. Playback
starts from the dismissing tap (iOS gesture). First-time hint "Tap who won this
point" at first auto-pause.

Three layouts: floating pad (≥1024 + pointer fine; iPad maybe) — 380px draggable
card, position persisted; edge bands (phone landscape): ticker+chips top, winner
buttons LEFT edge (96×184), Skip/Delete/Modify RIGHT (96 wide), mini controls above
transport, bands re-enable pointer events, taps between fall through; rail/portrait:
video strip (max 45% height) above pad.

Pad contents:
1. Ticker: serve ball (tap flips server) · running score {you}-{them} + games pill ·
   serve ball. "You serve" / "{name} serves". Running score = computeMatchScore of
   points up to target, not match total.
2. Chip strip: chip per point with cut_t0. Cyan you / magenta them / amber skipped /
   dashed grey unscored. Current chip scale 1.1 + white glow + static ring or
   countdown ring (clip progress). Spinner while edited. Chip tap: seek + play +
   "Go to point →" grows out (3s). Removed points = small red hollow dots; tap arms,
   "Restore", auto-disarm 3s. Game boundaries: hairline + bordered {you}-{them}
   pill; tap opens game-break sheet. Auto-centre via offsetLeft math, 120ms defer.
3. Control row (equal size, labelled): Back (edge), Undo, Replay, Speed, Star,
   Game ended/Didn't end, Analysis, Details, Serve start + Clear (admin), Next (edge).
4. "Match starts here?" (whole match untouched, past point 1): "Match starts here?
   The {n} earlier point(s) can go." + "Remove them" / "Keep".
5. Split nudge: "Point {n} looks like two points." / "Point {n} — two points in
   there?" + "Split" / "No".
6. Disposition row: Skip "let" (amber) · Delete "dead space" (red) · Modify
   "split · join · adjust" (cyan).
7. Winner buttons: youLabel (cyan), themLabel (magenta), full height. Opponent
   button carries "Why" pill top-right.

Tap records:
- Winner (tapSide): resolve target at tap time (pin first). Toggles off on re-tap.
  Writes confirmed_winner + scored_at_cut_s (round 2dp; only in flowing play phase,
  only when setting; cleared with winner) + is_let:false when converting skip.
  Optimistic + rollback.
- Advance: NEW answer advances; changing never advances. advanceFrom: if
  paddedEnd − now > TAIL_WATCH_S 3.5 play out clip then offer split; else jumpAfter
  → seek next visible cut_t0 + play in same gesture.
- Why pill: scores them + opens "Why did you lose it?" overlay. One chip = save +
  close + advance (loss_reasons: [value]). lossReasonsFor(servedByUser, custom).
  "Enter custom" (placeholder "Misread the pips", max 24) + "More details →" (to
  Analysis). Quiet "Skip". Hidden in neutral matches.
- Skip: is_let:true + confirmed_winner:null one write. Flash "Skipped". Advances if
  new. Skip on already-skipped jumps next.
- Delete: deleted:true, flash "Removed", jump next (prev at very end). Always
  advances. Pad undo stack owns recovery.
- Star: toggle, no advance.
- Serve start (admin): serve_start_at_cut_s (2dp) + serve_start_meta
  {paused, rate, src}. Second tap re-stamps. "Clear" separate. Decoupled from score.
- Server ball: server_override. Flash "I serve — rotation updated" / "{name} serves
  — rotation updated".

Score model (gameScore.ts): GAME_TARGET 11, CLEAR_BY 2. stepBoundaryWalk is the
single boundary authority. game_end_override: "end" closes regardless; "continue"
suppresses auto rule until later explicit end; null auto. Overrides are POSITIONAL
(read on every visible point). game_winner_override names a winner the score can't
prove; clearing the end pin clears it in the same write.

Boundary control precedence: just closed → "Didn't end"; ends at this rally →
"Didn't end"; answer crossed held-open real end → "Game ended" (attention glow);
held open → "Game ended" (last scored point); else "Game ended" (rally on screen).
Boundary overlay ~5s after a completing tap (tap < 1s ago), never on seeks; flash
"Game {n} · {you}-{them}" 2s. "Who won this game?" dialog: "The recorded score is
{y}-{t}, which doesn't decide it. Some points may be missing from the video." →
names + "Not sure". Game break sheet: "Game {n} ended here" / {y}-{t}, optional
"Who won it? The score doesn't decide.", "Game didn't end here" / "Cancel".

Undo stack (session): tap (prev winner+skip), delete (+cutT0), override, split
(rpc unsplit_point), modify-split (compound), adjust (prior t0/t1/tight), bulk-delete
(one write). Every undo except override seeks back + plays.

Modify modal: Split 2–3 (markers cut→source linear map → sequential split_point
down the tail → per-segment outcomes), Join next 1–2 (merge_points, destructive,
confirm), Adjust t0/t1 (+ reclip; locked while edited). Flashes: "Split into {n}" /
"Split" / "Joined" / "Timing saved · updating clip". Failures: "Couldn't place the
split. Try again." / "Couldn't finish the split. Undo to revert." / "Couldn't join.
Try again." / "Couldn't save the timing. Try again."

Analysis panel: slides over the PAD, never the video. "Point {n}" + "Done".
PointScorecard (when hasLossAnalysis) + Notes (tags, thread, composer "What did you
notice?"). Prefers point just scored (SCORED_NOTE_WINDOW_MS 15000). Closing resumes
held-back advance. Swipe-left on pad opens; swipe on panel closes.

End of video → summary: finalLine "{gy}-{gt} · {g1} {g2}…" or "No points scored";
"{n} unscored" + "Review"; "{n} starred"; "Done". Review phase: iterate unscored,
seek cut_t0, play to paddedEnd; answer advances after 400ms; "Next" button; last →
summary.

Keyboard (iPad hardware keyboard): watch space/←→/R/N/hold S 0.25x/hold F 2x;
score ←=you →=them U undo K skip T star D delete M modify B serve start.

## 1.5 Placement maps

Data on points.placement (v2 bounces / v3 hypotheses). Orientation invariant: drawn
from above/behind the user — user bottom, user's left = map left. Worker frame v=0
near end line, u=0 near player's image-right sideline. user-near → mirror u;
user-far → rotate 180°. Untagged: camera view, "Near player"/"Far player". Players
change ends every game: bottom side = physicalSideForGame(userSide, gameIndex).

Per point: "Where the ball landed" + BetaPill + "This point's placement map is
wrong" flag → MarkedWrongNotice + undo. Flagged points leave EVERY aggregate.

Aggregate: "Placement maps" + BetaPill, Game segmented (≥2 games), "Mapped for
{used} of {total} points.", controls {you}/{them} and Serves/Rally, deck: Landings
(dots, FH/BH labels from handedness) + Heat map. Mobile: snap carousel + dot pager.
Footer "This match's placement maps are wrong".

Absent: flagged → notice; lifecycle notice; user_side null → "Tell us which side
you played to orient the placement maps."; none → "No high-confidence placement
data is available for this match yet." Per-view: "No trusted landings in this
view." / "Not enough trusted landings in this view yet."

Lifecycle (placement_status / retry count / expiry / failure code):
- not_requested → "Generate placement maps?" / "Placement maps haven't been
  generated for this match. You can generate them from Tools."
- expired → "Placement maps unavailable" "…because the original video is no longer
  available."
- processing → "Generating placement maps…" / "…We'll email you when they're ready."
- retry_available → "Try placement again?" / "…because the table was hard to detect
  in this video. You can try once more from Tools."
- retrying → "Retrying placement maps…"
- ready → "Placement maps ready" / "Placement maps are ready to explore."
- final_failed no_table_found → "No placement maps for this match" / "We couldn't
  find the table in this video…"
Coach viewers: "The match owner can generate placement maps." Poll 10s while
pending. POST placement-generate / placement-retry; 202 accepted.

## 1.6 Share, download, delete, reprocess

- ShareSheet: whole match / one point / starred / per-tag. Title "{ownName} vs
  {opponent}". ShareWithCoachSheet: invite scoped this-match or all, revocable.
- Export sheet: "Full match" (+ "Include score" toggle), "Starred points" ("Star
  points to export them"), per-tag reels, "Raw match" ("Your original upload,
  uncut"). Row states: Create → "Rendering — we'll email you" → "Ready"/"Download".
  Errors: "Couldn't prepare the video. Try again." / "Couldn't create a download
  link. Try again shortly."
- Unscore dialog: "What should we unscore?" — "Whole match" + per-game rows. Clears
  confirmed_winner, confirmed_how, is_let, server_override, serve_spin,
  serve_sidespin, serve_length, direction, loss_reasons, misread_kind; whole-match
  also game_end_override. Per-game pins "end" on each cleared game's last point
  (except final). Chunked 100 ids. Buttons "Cancel" / "Unscore match" /
  "Unscore {n} game(s)" / "Unscoring…". Error "Couldn't unscore. Try again."
- Delete: preview bytes → "Delete this match?" / "This frees {bytes}. Clips, video,
  notes, and the scorecard are deleted. This cannot be undone." → delete →
  /matches. "Checking how much space this frees…"
- Reclip: structural edits call scheduleReclip — 4s debounce, one jobs insert
  {kind:"reclip"}, skipped when queued reclip exists. While any point edited, poll
  points 8s.

---

# SCREEN 2 — Journal

Route /journal (AppShell hasFab). Title "Journal". ?match=<id> deep-links Matches
tab filtered. /improve → permanent redirect /journal.

Data: rpc note_feed({p_limit:500}), rpc tag_stats(), lessons desc, tags, entry_tags,
focus_points.

Entry types: match notes (born in matches; NoteItem: text, voice, image, "Show full
note"/"Show less", header "{match title} · Point note|Match note" → match?p=);
lessons (kind lesson, optional coach_name); practice. LessonCard: kind pill,
takeaways as body with "+" per takeaway ("Add to Working on" → "On the Working on
list"), photo (signed via media-url {lessonId,image:true}), tag picker, footer:
"Transcript"/"Hide transcript", "Copy"/"Copied", Edit, "Delete?"/"Deleting…",
"Try again"/"Reading…" when summarize failed.

Composer (bottom sheet, FAB "New"): kind chips Practice|Lesson. Subtitles: "What
your coach gave you. Type it, speak it, or paste it." / "Drills, reflections,
anything worth keeping." Lesson: "Who taught it?" (max 80, datalist of known
coaches). Textarea "Paste the transcript, or start writing" / "What did you work on
today?" Voice: mic in textarea → record → transcribe persist=false → APPEND with
blank line. States: recording (red pulsing) → "Writing that down…". Errors:
"Microphone unavailable." / "Couldn't hear that clearly. Try again or type it."
Scan pages: ≤6 images, downscale 1600px JPEG q0.85 → journal-ocr → append.
"Reading your pages into text. The photos aren't kept." / "Those photos didn't look
like notes pages." / "Read {n} page(s); {m} didn't look like a notes page."
Add photo: single, entry-image (moderated) → 56px thumb + "Remove". "Checking the
photo…" / "Couldn't add that photo." Tag picker (shared vocab, find-or-create).
Checkbox "Condense and summarize" default ON. Save → /api/lesson. Button "Save
entry"/"Save changes"/"Reading it through…"/"Saving…". Error "Couldn't save it.
Your words are still here — try again." Edit reuses sheet, tags/photo hidden.

Search + Ask: one field "Search or ask your journal" + cyan sparkle. Token-AND
filter over everything. askable = trimmed 8–400 chars AND contains space → row
"Ask your journal ›"; Enter fires same path. Empty box → example questions.
POST journal-ask. Loading "Reading your journal…". Answer paragraphs + superscript
citations + "Where this comes from" source list (Note|Lesson|Practice|Match|
Working on|Tags|Profile · {Mon D}) + coverage note. Refusals: "That one is outside
what your journal covers." / "There is nothing in your journal to answer that from
yet." / "Your journal does not cover that yet." Errors: too_fast "Give it a moment,
then ask again."; daily_limit/token_budget "That is all your questions for today.
There will be more tomorrow."; busy "Ask is busy right now. Try again in a few
minutes."; disabled "Ask is turned off at the moment."; question_too_long "That
question is too long. Try it shorter."; no_answer "That did not come back cleanly.
Try asking it another way."; default "Something went wrong. Try again."

Tag rail: chips sorted by combined count showing point+entry counts. Selected →
tagged view: "{n} points across {m} matches · {k} entries tagged "{label}"." +
TagReelExport ("Export as one video" → "Rendering the video…" → "Download video",
poll 6s) + Entries + Points lists.

Working on: pinned card, 3–5 active cues; tick retires into "History ({n})" +
Restore. Add placeholder "One cue, e.g. racket up between strokes" + dictation.
Notices: "Already on the list." / "The list is full — tick something off first." /
"Couldn't save that. Try again."

Tabs: All | Matches | Lessons | Practice | Recollect (when enabled). FEED_CAP 30 +
"Show {n} more". Empty states: 📓 "Your journal starts here" / "Notes from your
matches collect here on their own. Add a lesson or a practice entry with New. Type
it, speak it, or paste it." · "No practice entries yet. New starts one." · "No
lessons yet. New saves your first." · "Nothing found." · "No notes on this match
yet. Open the match to add one."

Recollect: topic rows "{n} points from {m} entries · last opened {date}", "Reveal"
("Opening…"), per-point add-to-Working-On / remove, links to source entry. Errors:
"Recollect couldn't load." / "Couldn't open this one. Try again." / "Couldn't
remove this one. Try again." / "Couldn't add this one. Try again." / "Working On
is full — finish one first." / "Already in Working On" / "Added to Working On".

---

# SCREEN 3 — Upload

Route /upload: UpLink "Matches", H1 "Upload", "How to record" anchor, UploadCard.
YouTubeImport, CameraGuide, BalancesCard hidden while uploading.

Constraints: video/mp4, video/quicktime, .mp4/.mov. MAX_DURATION_S 45min (the real
limit), MAX_BYTES 6 GiB backstop. Parts 16 MiB, 4 in flight.

Flow:
1. Idle: "Upload a match" / "MP4 or MOV, up to 45 minutes." Processing decision
   visible BEFORE any bytes move. "Choose a video" (→ "Reading the video…").
2. Pick: type → "That's not an MP4 or MOV video."; size → "That file is over 6 GB.
   Trim it on your phone first, or upload it in two halves."; probe duration+poster
   (frame at min(60, d*0.5), 320px); duration → "That video is {len}. The limit is
   45 minutes, so trim it first or upload it in two halves." Wake lock, back guard.
3. Uploading: {n}% + "Uploading"/"Finishing up", bar, "{uploaded} of {total} ·
   about {n} minutes left" (ETA after 4s), file name, "Keep this screen open until
   it finishes." "Cancel upload".
4. Form stays mounted THROUGH upload and after completion (real bug once):
   Opponent, Venue (+ remembered chips), type pills
   (Drills/Practice/Match/League/Tournament), side card (PickSide on local object
   URL → "You're at the bottom/top of the video" + "Change"). Autosave "Saved" /
   "Couldn't save. Tap again."
5. API order: create → sign-part × N (PUT bytes, capture ETag) → [list-parts on
   resume] → complete with register{durationS, originalName, capturedAtMs (asset
   creation date, NOT upload time), opponent, venue, matchType, userSide} →
   {matchId}. Cancel: abort. Processing: POST /api/process (claim_processing is
   atomic — two taps cannot double-spend). Undo: rpc cancel_queued_processing.
6. Done (stays on page): "Uploaded. Processing has started." / "Uploaded, but
   processing needs more minutes than you have." / "Uploaded. It's in your
   library."; sub "{n} minutes used. You'll get an email when it's ready." /
   "You'll get an email when it's ready." / "Get more minutes in Account."
   Buttons: "Open the video" → /match/{id}, "Undo, don't process yet" ("Too late
   to undo. This one has started processing."), "Upload another".
7. Commit model: toggle "Process when the upload finishes" / "Uses {n} minutes of
   your balance." + Placement toggle + "Trim it first" ({clock} kept / "Whole
   video"). Button "Process video" / "Save video in library". Press commits —
   toggles lock, row becomes "Will process when the upload finishes" / "Will stay
   in your library" + "Not yet" escape.

Errors/quota: storage "Storage is full. Delete a video or add space in Account.";
queue "Your queue is full. Wait for a match to finish."; daily "Daily upload limit
reached. Try again tomorrow." Quota walls are not retryable (Close only). Network:
"The connection dropped." + Retry. Generic: "The upload hit a snag." + Retry.
Resume: pending record survives; interrupted card shows poster, "This video is
{n}% uploaded. Pick it again to carry on." / "Upload interrupted. Pick the same
video to continue.", "Pick video", expiry "You can resume it for {n} more days." /
"You can resume it until tomorrow." / "This one has expired. Pick the video to
start again." (R2 abandons at 7 days), "Upload a different video".
Native: background URLSession changes the "keep screen open" story; keep resume
contract. Wake lock → isIdleTimerDisabled.

---

# Stats and Improve

/improve → redirect /journal.
/stats "My game": all aggregation CLIENT-SIDE through the same pure walks as the
match page (gameScore, serving, matchStats, matchAnalysis) — never duplicate ITTF
rotation in SQL. Only user-confirmed or rotation-derived inputs. Match record
counts only fully-scored matches; neutral matches excluded entirely.
Tabs (?view=tactics): My stats — heroes (Matches W–L, Games W–L, Points won %),
"Winning points" (Serve win %, Receive win %, "At 9+ in the game", "After losing a
point", "Games past 10-10", "Best run of points", "Points won–lost"), "Results"
(form dots last 10 + rows), "Opponents" table. Tactics — "My serves" (by spin, by
length), "Against their serves" (by spin), "Why you lose" (+ "Why, in your words").
Empty: "Nothing to count yet." / "Score the points in your matches and this page
builds itself: serve and receive, pressure points, patterns across every match." +
"Go to matches"; "No patterns yet."; "No serves of yours described yet…"; "Say why
you lost a point and the pattern shows up here."

---

# Native rethink list

- Both web layouts render at once (display:none) — SwiftUI builds one; state must
  survive size-class changes.
- Fake landscape rotation path: DELETE natively; real orientation + AVKit.
  videoRect from AVPlayerLayer replaces letterbox measurement.
- Hover states → pressed/selected states or drop.
- Keyboard shortcuts: keep for iPad hardware keyboards.
- Floating pad drag: drop on iPhone; fixed rail on iPad.
- SwipeRemoveRow → .swipeActions. PointSheet paging → TabView(.page)/custom paging
  (lazy players). TrimBar → custom slider.
- history/popstate plumbing → navigation state. localStorage → UserDefaults
  (ponglens.pointsExpanded, side-asked:{id}, gesture-hints, seek-hint,
  swipe-hint-shown, pending-upload).
- window.location.reload() after Unscore → refetch.
- Canvas frame capture → AVAssetImageGenerator. MediaRecorder → AVAudioRecorder
  (preserve ephemeral persist=false for journal dictation vs persistent for match
  voice notes). Uppy → native multipart with resume contract + 4-part cap.
- Tuned constants: PAUSE_BEAT_S 1.2, REARM_BACK_S 1.5, PLAY_GUARD_MS 500,
  TAIL_WATCH_S 3.5, SPLIT_LEAD_S 0.6, TIGHT_PAD 0.3, HOLD_MS 250, DOUBLE_TAP_MS 250,
  ZOOM_MAX 4, SCORED_NOTE_WINDOW_MS 15000, GAME_TARGET 11, CLEAR_BY 2,
  POINTS_PREVIEW 10, FEED_CAP 30, SWIPE_OPEN_PX −88.
