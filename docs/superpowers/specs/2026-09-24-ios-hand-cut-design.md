# Mark the points on iPhone, and placement and highlights for every match

**Date:** September 24, 2026. Replaces the draft of September 23.

**Status:** Approved by Adil on 2026-09-24, including the landscape mockups. Not implemented. Built from reads of GitHub
`main` at `554c4a78`: the web marker line by line, the hand-cut worker job,
the placement and highlight request flows, and what a hand-marked match looks
like on every surface today.

**As shipped (2026-09-26):** "Reset" is **"Back to last point"**; a scoring draft of a processed match marked again opens at a
**"Keep marking"** / **"Start again"** gate, each with its one-line caption, rather than straight into the pass; and nothing
offers to cut on the Mac instead: the server takes a phone cut over silently after 15 minutes without a report (60 while the
phone is uploading). Details in the lines changed below.

**Companion:** `2026-09-24-ios-hand-cut-marker-inventory.md` lists every
value, colour, timing, animation and word of the web marker. It is the
contract for the iPhone port; this spec says what to build and why.

---

## Summary

The iPhone gets the web's "Mark the points" screen exactly as it is, both
"Cut only" and "Cut and score", and when the phone holds the video it cuts
the match itself so the Mac only checks and saves the result. Hand-marked
matches stop being second class: on web and iPhone the player can request
placement maps and highlights through the same buttons, rules and Mac jobs
as an automatically processed match. A handful of copy and state bugs that
hand-marked matches expose today are fixed on both platforms along the way.

---

## 1. Decisions

| Question | Decision | Who |
| --- | --- | --- |
| Why cut on the phone | Take load off the Mac Studio; move toward a SwingVision-style app | Adil, 09-23 |
| The player's footage | Recordings are saved to Photos; the app never deletes the player's copy | Adil, 09-23 |
| The marker on iPhone | The web marker replicated: copy word for word, the same states, animations, timings and nuances, both modes | Adil, 09-24 |
| Placement and highlights for hand-marked matches | Requestable by the player on web and iPhone, run by the Mac, same rules and code as automatic matches | Adil, 09-24 |
| Ball tracking and the table | Stay on the Mac. The Mac's own table ladder serves hand-marked matches as it serves every match, so this does **not** wait on the table-model experiment | Correction: the Sep 23 draft tied placement to that experiment, which only matters if the table is found on the phone |
| Who and which phones | The two admin accounts. iPhone 12 and later; an admin's iPhone 12 is the test device | Adil, 09-23 |
| Phone landscape | Redesigned on **both mobile web and iPhone** in the Scorekeeper landscape language. **Approved** as drawn in the mockups (section 3a) | Adil, 09-24 |
| Cut only in landscape | Option A: the same layout as Cut and score, with Me / Alex / Let greyed out | Adil, 09-24 |
| Photos permission wording | Unchanged: "Recordings are saved to your Photos so your footage is never only in one place." | Adil, 09-24 |
| Gestures while marking on iPhone | The iPhone player's own gestures, not the web's. Adjust later if something feels wrong | Adil, 09-24 |
| Practice and drills | "Cut and score" is shown but greyed out; only "Cut only" is available. No rotation, no answers. Matches, tournaments and leagues get both | Adil, 09-24 |
| Where hand-cut analysis runs | The hand-cut lane on the Mac, not the main lane | Adil, 09-24 |
| How much of the video is tracked | Only inside the marked points (plus a margin), for hand cuts only | Adil, 09-24 |
| Point length card | Hand cuts get it, from the marks where the ball gave no serve time | Adil, 09-24 |
| Design principle | A hand-cut match should behave like an automatic one wherever it can | Adil, 09-24 |
| Keeping the video | Every player: recordings saved to Photos. Only accounts that can hand cut: the app also keeps its own copy until the match is cut or processed | Adil, 09-24 |
| Copy | No explanatory paragraphs or subtitles. Greyed-out controls and short labels carry the meaning | Adil, 09-24 |

---

## 2. End to end, as the player sees it

```text
 Record in the app ─► saved to Photos ─► uploads as today ─► content check (Mac)
 (or pick from Photos)                                          │
                                                                ▼
 Raw match page: "Break it into points" ─► "Mark the points yourself"
                                                                │
              ┌─────────────── "Cut only, or cut and score?" ───┘
              ▼
 Marking screen (identical to the web) ─► Done ─► review sheet ─► "Cut the match"
              │
              ├─ phone has the video ─► phone cuts + uploads ─► Mac checks (seconds) ─┐
              └─ it doesn't          ─► Mac cuts (as from the web today) ─────────────┤
                                                                                      ▼
 Match page: points, clips, score. "Generate detailed analysis" and "Generate highlights"
 appear under the same conditions as on an automatic match, and run on the Mac.
```

---

## 3. The marker on iPhone

### The contract

Everything in the inventory is replicated unless it is on the deviation list
below. That covers, among the rest:

- **Both modes.** The first question is "Cut only, or cut and score?". Cut
  and score asks "Who served first?" where a rotation applies, holds the
  picture after End Point until Me, Them or Let is tapped, pulses the answers
  while it waits, and stops the review walk on an uncalled point. Cut only
  never pauses, hides the answers and the serve question, and shows a point
  count instead of a score. "Stop scoring" and "Score them too" switch modes
  mid-pass and keep every winner already called.
- **The three-tap rhythm and its safety nets.** Begin Point, End Point, then
  the answer. "Back to last point" (it read "Reset") while a rally is open. Begin while the picture is held
  leaves the point uncalled and says "Left uncalled."
- **Review.** Tap a chip to play its clip, tap again to pause, clips chain
  with no gap, Prev and Next on the picture, Adjust with the two-handle bar
  and Confirm, the "+" to add a missed rally into a gap of 4 s or more, Mark
  again, Remove, Resume.
- **How a draft reopens.** Straight into the scoring pass, into "Begin
  review", or into "Keep marking" / "Review the points", by the same rules.
  As shipped, a scoring draft of a processed match marked again (Cut again)
  opens at a gate instead of the pass: "Keep marking" ("Start from the points
  already here and fix or score each one.") over "Start again" ("Clear every
  point and mark the whole match yourself.").
- **Every visual detail.** Chip colours, the open chip growing 1 pt a second
  up to 60, the cyan fill behind it, the rings for playing and selected, the
  110% scale and glows, the star, the 2 s pulse on the answers, the 2 s amber
  refusal line, the play glyph after 340 ms paused, the sheet fade (180 ms
  from 97% scale), the speed bar with six evenly spaced ticks, lit and unlit
  buttons with the cyan glow.
- **Every word.** Buttons, sheets, refusals, the review sheet, the footer,
  accessibility labels.
- **Gestures.** Not copied: marking on iPhone uses the iPhone player's own
  gestures (deviation 2 below).

The rules themselves (the web's `handCut.ts`) are ported to Swift and proved
identical with a shared fixture: a script runs the web code over scripted tap
sequences, and the Swift tests replay them and demand the same state after
every tap.

### Where the phone must differ, and why

| # | Web | iPhone | Why |
| --- | --- | --- | --- |
| 1 | Phone landscape puts every control **over the picture** as translucent tiles, and drops the speed bar, Star, the ±5 s pad buttons and the mode switch | **Both platforms change** to a new landscape layout (section 3a) | Adil: landscape follows the Scorekeeper landscape, on mobile web and iPhone alike |
| 2 | Double-tap ±10 s, hold for 0.25x / 2x, pinch zoom (the web player's) | The iPhone player's own gestures (tap zones, swipe ±5 s, hold, pinch) | Adil's call; one gesture set per app beats two in one player |
| 3 | Utility buttons 40 px tall | 44 pt | Apple's minimum touch target, already the iOS rule in this app |
| 4 | Hover styles, the keyboard map and its legend, the draggable desktop card | Left out | No mouse or keyboard on a phone |
| 5 | The pad's speed bar can show 1x while the player plays at another speed | One speed, shown truthfully | Web defect, not a design |
| 6 | Seven small defects (below) | Fixed on the web first, then ported fixed | Porting a bug makes it a rule in two places |

Web defects fixed before the port:

1. "Mark again" only works on the last point; on any other the next Begin is
   refused.
2. Closing within 1.5 s of a tap loses that tap (no save on close).
3. The strip scrolls to the wrong chip once a "+" is showing.
4. Undo can leave the selection pointing at a point that no longer exists.
5. Tapping the same answer again during review clears it and still moves on.
6. Space or Enter behind the first sheet starts cutting.
7. Opening the marker writes an empty draft.

Plus two found earlier: a draft handed back after a failed cut reads every
point as called, and the "Cut only / Cut and score" choice may not be
saving.

### Where it lives on iOS

A marking mode of the existing full-screen player (`PlayerTakeover`), not a
second player. Entry is the same two rows the web shows inside "Break it into
points" on the raw match page: "Automatically", and "Mark the points
yourself" with "Free" or "N marked" on the right. The draft is the same
`hand_cut_drafts` row the web uses, so a pass started on one continues on the
other, plus a copy on the phone so a crash loses nothing. **The phone never
overwrites a draft saved more recently than its own copy**: on reconnect it
compares `updated_at` and, if the server's is newer, takes the server's. The
web gets the same rule, and both save immediately on close instead of losing
the last 1.5 s of taps.

### 3a. Phone landscape, both platforms

The web's current phone-landscape marker (controls floating over the video)
is replaced on **mobile web and iPhone together** by a layout in the
Scorekeeper landscape language: a top bar, side rails and a bottom transport,
all solid, the picture fitted into the box they leave. It is not a copy of
Scorekeeper, whose controls do different things; it borrows the zones,
proportions, button treatments and the rule that nothing sits on the
picture.

**Approved 2026-09-24** from the mockups at
https://claude.ai/artifact/J7kQo15ZN2SFAZBvfeLJrt (iPhone 12 at 844 × 390,
mobile web rotated at 852 × 348 and full screen at 660 × 393). Both codebases
build against those boards; the source of each board is kept with the
canvas.

| Zone | Contents |
| --- | --- |
| Top bar (42) | Score, games pill and "{name} serves" (Cut only: "{N} points"); the chip strip; Done; close |
| Left rail | Me, {opponent}, Let. In Cut only they stay, greyed out (option A) |
| Picture | 16:9, fitted by Scorekeeper's formula; only temporary things on it (play glyph, scrubber, messages) |
| Right rail | The pair: Begin Point / End Point, Back to last point / End Point, Adjust / Confirm with Resume; Begin Cutting, or Keep marking and Review the points, before starting |
| Bottom bar (41) | −5s (Prev when a point is selected), Undo, Speed, Star, Mark again, Remove, Stop scoring / Score them too, +5s (Next). While adjusting, the two-handle bar replaces the tools until Confirm |

The four controls the web dropped in landscape (speed, Star, ±5 s, the mode
switch) are back, in the bottom bar. Sizes follow Scorekeeper: rails at least
96 wide, tiles at least 44 tall.

### 3b. Practice and drills

On a match whose type is practice or drills (`tracksServe` false, the same
test on both platforms):

- The first sheet still shows both choices. **"Cut and score" is greyed out
  and cannot be tapped**; its sub line becomes "Matches only". No other
  explanation.
- The mode switch in the footer ("Score them too") is hidden, since it has
  nowhere to go.
- No answers, no serve question, no score ticker: exactly the Cut only pass.
- If the type is changed to a match later, the player scores it through Keep
  score, like any match.
- The three live practice hand cuts keep their stored winners untouched.

This applies on web and iPhone at the same time.

---

## 4. What the match looks like after cutting

Today a hand-marked match already looks almost exactly like an automatic one
in the same scoring state, because nearly every screen asks "is it scored?",
not "how was it cut?". After this spec the remaining differences are only the
ones a hand cut genuinely cannot have.

### Cut only (points, no winners)

| Where | What the player sees |
| --- | --- |
| Library and Home card | "N points", the "Add score" pill, the "Score it" nudge |
| Point list | Every point with its length; You / Them / Skip to call it; a dashed "Server" pill until they say who served first |
| Tools | "Score the Match". Highlights: "Score at least 75% of the points before generating highlights. You've scored 0 of N." Match analysis: "Score points to unlock" |
| Analysis section | "What's next": "Score the match", progress bar, "0 of N points scored" |
| Keep score | Opens on point 1, asks who served first, walks every point |
| Point detail | Clip, notes, tags, star; the "Where the ball landed" card empty until detailed analysis has run, as on an automatic match that has not generated it |
| Practice or drills | Points and clips; "Generate detailed analysis" offered straight away, as on an automatic practice match |

### Cut and scored (winners called while marking)

| Where | What the player sees |
| --- | --- |
| Library and Home card | Games pill with the score, "Scored. Star your best points" |
| Point list | Called winners, lets as "Let serve", stars already on; serve chips from the rotation |
| Tools | Score, "Generate highlights" (75% or more scored), "Generate detailed analysis" |
| Analysis section | Overview card; "Why you lost" and Serve cards if tagged; "What's next": Generate detailed analysis, and "Which end did you play from?" if the side is unknown |
| After detailed analysis | Serve maps, point length, serve speed, endings: the same cards as an automatic match |
| After highlights | The highlights reel, shareable, the same as an automatic match |

### What stays different, on purpose

| Missing on a hand cut | Why |
| --- | --- |
| The detector's guess of who served each point | Nothing watched the serves; the player sets the first server once and the rotation does the rest |
| "Players changed ends" markers | They come from the automatic cut's own tracking |
| A clip ending exactly where the ball died | Clips end at the End Point tap plus 1.3 s, which the player chose |
| Automatic reprocessing | Reprocessing would delete the player's own points; still refused |

---

## 5. Placement and highlights for hand-marked matches

### The request is the same as for any match

No new buttons, no new rules. On web and iPhone:

- **Detailed analysis** ("Generate detailed analysis"): offered on a scored
  match type once 75% of points are scored, straight away on practice.
  Retried once through the existing retry with the paid table step.
- **Highlights** ("Generate highlights"): once 75% of points are scored, not
  on practice or drills, rendered by the existing worker job with the
  existing rule.
- Neither charges processing minutes, exactly as today for every match.

### What has to change

| Layer | Change |
| --- | --- |
| Database | Remove the hand-cut refusal from `request_placement_generation` and `request_placement_retry`. Keep the refusal on automatic reprocessing and the worker guard against overwriting a hand cut's points |
| Highlights endpoint | Remove the two hand-cut refusals (GET "unavailable", POST 409) |
| Queue routing | `enqueue_job` sends `placement_generate`, `placement_retry` and highlight `reel` jobs for a hand-cut match to `jobs_hand`; automatic matches keep their lanes. The hand lane's sealed release must carry the same placement and highlight code as main |
| Cloud backup | `cloud_worker_decision()` must not count jobs routed to `jobs_hand` as work waiting, or a queued hand-cut placement job starts a Modal run that finds nothing to do and still costs money. Today it only excludes `kind = 'hand_cut'` |
| Which release changes | Only the **hand lane's** sealed release. Main and fast never see hand-cut jobs, so their release, the cloud twin's pairing and the players' uploads are untouched |
| Worker, placement | Drop the hand-cut refusal. Hand-cut `match.json` lacks frame rate, width and height, which placement reads, so the job probes the original and fills them in. New hand cuts write them from the start |
| Worker, highlights | Drop the skip that stops the evidence refresh on hand cuts |
| Worker, highlight end | **Bug:** the fallback end for a clip is placed about 1.2 s early on a hand cut, because it ignores the start padding. Fix it in `highlights.py` and its mirror `endPolicy.ts` together, or have the hand cut record its rally end from the End Point tap |
| Web | Remove every `handCut` condition that hides the analysis notice, the Match analysis row, the Highlights row and the placement controller |
| iOS | The same, in the Tools card, the analysis deck and the "What's next" card |

### Hand-cut specifics, so the output matches an automatic match

| Rule | Why |
| --- | --- |
| **Hand-cut analysis runs on the hand-cut lane** (`jobs_hand`), not the main lane | Players' uploads are never queued behind it; the hand lane is nearly idle once phones do the cutting |
| **Track the ball only inside the marked points**, from 1.2 s before each mark to 1.3 s after (the clip window), merged where windows touch | Dead time is 30 to 63% of a video, so this roughly halves the Mac's work. Automatic matches unchanged |
| **Read each point from the clip start, not the mark** | A late Begin tap (easy at 2x) puts the serve's first bounce before the mark, and the serve rule then drops the dot. Placement's own "two consecutive bounces" rule already copes with extra footage at the front |
| **Find frames by their real timestamps, not seconds × frame rate** | Placement turns a point's seconds into frames by multiplying by one frame rate (`placement_backfill.py:188`). Automatic times come from counting frames, so they agree; hand marks are playback seconds. On a variable-frame-rate video (common from the iPhone camera app in low light) the two drift apart as the match runs and the maps are drawn from the wrong moment, silently. Recordings made in the PongLens app lock the frame rate and are safe. First measure how many uploads vary |
| **Ask "Who served first?" before offering detailed analysis** | Maps decide whose serve each dot is from the rotation. With no first server every point is skipped and the maps come out empty with no reason given. One live hand cut (`06deeba4`) is scored with no first server. The "What's next" card asks it, as it already asks "Which end did you play from?" |
| **Point length card from the marks** | The card measures from the serve's first bounce to the point's end. Where the ball gave a serve time, a hand cut uses it exactly as an automatic match does; where it did not (or before detailed analysis), the start mark is the start. The end is the End Point tap. It does not need the player's side. Same card, same bands, on web and iPhone (`scoredCards.ts` and its Swift twin) |
| **Changes stay behind "is this a hand cut"** | Every worker change is branched on `cut_source = 'manual'`, and the release's shadow replays prove automatic output is byte-identical |

### One ball-tracking run, not two

The highlights evidence refresh is the expensive part: a median of 86
minutes on the Mac when it has to track the ball, against about 8 minutes
for detailed analysis on a 13-minute video. It first looks for a saved
tracking result beside the match, and hand cuts never saved one. So:

- **Detailed analysis saves its tracking and table** (`serves.json`) the way
  the automatic path does, so a later highlights request reuses it and
  finishes in about a minute.
- **Highlights requested before detailed analysis** does the tracking once
  and saves it, so detailed analysis reuses it the other way round.

### What a hand cut loses in the rules, measured, not assumed

| Rule input | Hand cut | Effect |
| --- | --- | --- |
| Hit count from the automatic cut | Absent | One of the three ways a rally qualifies for highlights is closed; crossings and landings still work |
| A card the detector formed over the rally | Only where the detector finds one | A rally it never formed a card for does not qualify |
| The ball in `[t0, t1]` of the mark | Read with no padding | A mark that starts after the serve loses that serve's landing. Worth measuring on the first matches; widening to the clip window is its own change |

### The eight hand-cut matches already live

All eight still have their original. Five are matches past 75% scored and
can request both; three are practice (detailed analysis only). Two need
their first server or side set before maps can draw.

### The Mac load this adds

Before these rules: about 8 minutes for detailed analysis and 40 to 75
minutes for a highlights refresh on a 20-minute video, both tracking the
whole original. With tracking limited to the marked points and one run
shared by both, a hand-cut match with maps and highlights should cost the
Mac less than today's detailed analysis alone (an estimate). Measured on the five
eligible live matches before it is called done. All of it on the hand-cut
lane.

---

## 6. Where the video comes from

| Source | Today | After |
| --- | --- | --- |
| Source | Today | Every player, after | Accounts that can hand cut, also |
| --- | --- | --- | --- |
| Picked from Photos | The app uploads a copy and deletes the copy; the original stays in Photos | Unchanged | The app keeps its copy until the match is cut or processed |
| Recorded in the app | Lives only in the app; deleted after upload; saved to Photos only on a failed upload (since 2026-08-18, reason not recorded, most likely storage) | Saved to Photos when recording stops; the app's own copy deleted after upload as today | The app keeps its own copy until the match is cut or processed |

- The Photos permission text ("Recordings are saved to your Photos so your
  footage is never only in one place") becomes true again. Its wording stays as it is (Adil, 09-24).
- The hand-cut accounts' working copy exists because reading a video back
  out of Photos later needs library read access, and an iCloud-optimised
  library may not have the full file on the phone. Cost: that video takes
  space twice while it waits to be marked.
- Settings gains "Videos on this iPhone" for those accounts: each copy, its
  size, Delete.
- If a player refuses Photos, today's behaviour applies: the copy is deleted
  after upload (for hand-cut accounts, after the cut).
- iCloud upload of those videos is the player's own Photos setting.

The Photos save changes things for **every** player who records in the app,
so it ships in its own TestFlight build.

---

## 7. Cutting on the iPhone

Unchanged from the September 23 draft; summarised here.

- **Two cutters, one screen.** If the phone has the video, the phone cuts.
  If not, the marks go to the Mac hand lane exactly as from the web.
- **Same arithmetic, checked by the Mac.** The phone plans segments and each
  point's position in the cut with a Swift port of the Python rules, proved
  against a fixture generated by the Python over the live hand cuts.
- **Encoding matches the Mac.** H.264 at source resolution, a keyframe every
  60 frames, index at the front, AAC; clips 720 wide. AVAssetReader and
  AVAssetWriter, because the export session cannot set the keyframe
  interval, and a long one is what made the cut stutter in August.
- **Survives the background.** iOS 26 continued processing with visible
  progress; each finished file kept; heat pauses at "serious" and hands off
  at "critical", as does Low Power Mode or a full disk. **Unverified:** iOS
  normally withdraws the hardware video encoder from a backgrounded app, and
  whether continued processing keeps it on an iPhone 12 is exactly what step
  0 tests, with the app in the background and the screen locked. If it does
  not, the player keeps the app open while it cuts, and the screen says so.
- **One end-of-video rule.** Phone and Mac can read a video's length a
  fraction apart. The phone clamps the last mark with the same rule the Mac
  uses, and a test covers a point ending in the final second, so the publish
  check (marks and points agree within 0.06 s) never fails on it.
- **The Mac stays the only thing that publishes a hand cut.** The phone
  uploads the cut, clips and a manifest; the Mac checks the length, re-derives
  every point's position, makes the thumbnail and saves the match with the
  code it uses today, then sends the ready email. Any mismatch and the Mac
  cuts it itself from the same marks. The player never sees a phone-caused
  failure.
- **New encoding also writes frame rate, width and height** into the
  manifest, so detailed analysis works on these matches from day one.

Server pieces: a claim for a phone cut that does not queue the job, a
progress report from the phone, a submit that hands the job to the Mac, a
release that hands the marks back or switches to the Mac, a
`device_hand_cut` kill switch on the public config list, and a 72-hour
release for a phone that never comes back.

---

## 8. Every surface that has to say it

| Surface | Change |
| --- | --- |
| `/admin/processing` | "Hand cut on iPhone" with the phone's stage ("Cutting on the iPhone", "Uploading from the iPhone"); new Mac stage "Checking the iPhone's cut"; a quiet phone is grey "Waiting for the iPhone", never amber |
| Web raw page, desktop and mobile | The same stage names as any hand cut, with progress; never where it runs. As shipped, the server takes a phone cut over silently after 15 minutes without a report, 60 while the phone is uploading; the player is not told |
| Home, library, raw page (web and iOS) | Hand-cut stage names ("Reading the marks", "Cutting the video", "Building the points") instead of the automatic ones ("Finding the points", "Removing dead time") |
| Processing notices (web and iOS) | Promise the ready email for a hand cut; the worker already sends it |
| Ready email | Does not say "Score it" to a player who scored while marking |
| A failed hand cut (web and iOS) | Shows as failed, with "Your marks are saved" and a way back into them, not as an untouched upload offering automatic processing |
| Share page and coach view | Unchanged; they already follow the scored state and placement status |

---

## 9. Build order

| Step | What | Reaches |
| --- | --- | --- |
| 0 | **Measure on the iPhone 12**: encode a 10- and a 45-minute recording, 1080p and 4K, in the foreground and with the app backgrounded and the screen locked; time, heat, battery, file size against the Mac's. **Result (2026-09-26):** iPhone 12 Pro (iPhone13,3, iOS 26.6.2), foreground, 1080p30 HEVC 7:44 source, 4:00 kept: cut 41 s (5.9x real time), 12 clips 16 s, total 57 s, battery 90% → 85% unplugged, thermal nominal, start drift 0.000 s; background run not measured. The speed test was then removed from the app | Admins |
| 0a | **Landscape mockups** (section 3a): every state, both modes, iPhone and mobile web. **Adil approves before step 1 touches landscape** | Adil |
| 0b | **Measure frame-rate variation** across recent uploads, to size the timestamp fix | — |
| 1 | **Web fixes**: the nine marker defects, the draft rules, practice (section 3b), the approved landscape layout on mobile web, and the section 8 copy and state fixes | Admins for the marker; everyone for copy |
| 2 | **Placement and highlights for hand cuts**: worker first (a new sealed release for the hand lane only; main, fast and the cloud twin untouched), then database, then web, then iOS. Hand lane, tracking inside the marks, real frame timestamps, clip-start windows, shared tracking result, first-server ask, Point length from marks. Try it on the five eligible live matches; compare dot coverage with automatic matches (62%) | Admins (only admins have hand cuts) |
| 3 | **Keep the video**: recordings to Photos for everyone; working copy and "Videos on this iPhone" for hand-cut accounts | Everyone, own TestFlight build |
| 4 | **The marker on iPhone, Mac cuts**: Swift rules and fixture, the marking mode with the iPhone's gestures, the approved landscape layout, practice rules, entry rows. Built against the inventory, screen by screen beside mobile web at 402 pt, both modes | Admins |
| 5 | **The phone cuts**: planner and fixture, encoder, background work, server pieces, admin page | Admins, behind `device_hand_cut` |
| 6 | **Check it**: three real matches on the iPhone 12, including 45 minutes; every point's position against a Mac cut of the same marks; seeking on the web | — |

Step 2 no longer waits for anything and gives hand-marked matches on the
web their maps and highlights before the iPhone work begins.

---

## 10. Risks

| Risk | What stops it |
| --- | --- |
| The iPhone marker drifts from the web | The inventory as the checklist; the shared rule fixture; side-by-side screenshots of every state in both modes |
| The phone's cut arithmetic drifts | Python-generated fixture; the Mac re-derives every position at publish and cuts it itself on a mismatch |
| Highlights refresh ties up a lane for over an hour | Hand-cut lane only; tracking inside the marks; one result shared by both features |
| A hand mark starting after the serve loses its landing | Measured on the first hand cuts before anyone reads the maps as complete |
| A long encode is killed in the background | Per-file checkpoints; the Mac as fallback |
| Heat on older phones | Measured in step 0; pause and hand off |
| Saving recordings to Photos surprises a player | The permission prompt says so; its own build, checked on a real phone |
| Maps drawn from the wrong moment on a variable-frame-rate video | Real frame timestamps; measured first (step 0b) |
| Serves lost to a late Begin tap | Clip-start windows; dot coverage compared with automatic matches |
| Background encoding refused on older phones | Tested in step 0; fall back to "keep the app open" |
| The phone overwrites newer web marks | Newer draft always wins, on both platforms |
| Landscape built before it is agreed | Mockups approved first (step 0a) |

---

## 11. Not in this design

Ball or table models on the phone. A player corner tap. A second highlight
rule. Hand cutting for players beyond the two admins. Marking a match that
has already been processed. Cutting on the cloud twin.

---

## 12. Questions for Adil

None open on design. What is still needed before or during the build is in
the handover message of 2026-09-24: the iPhone 12 session, go-aheads for each
production step, and coordination with other chats touching the worker.

---

## 13. Changed after approval (Adil, 2026-09-25)

These supersede the matching lines above and in the marker inventory.

| Was | Now |
| --- | --- |
| The marker opens with "Cut only, or cut and score?" | No first question. "Mark the points yourself" opens in place on the raw page like "Automatically", with a **Score** switch and "Start marking" / "Keep marking". Score is also a switch inside the marker (footer; landscape bottom-bar tile). On by default for matches; off, greyed, "Matches only" on practice and drills; a resumed draft keeps its mode |
| Done as an outlined pill | Done is the primary cyan button (footer and landscape top bar) |
| "This match cannot be processed automatically afterwards." | Removed; see `2026-09-25-cut-again-design.md` |
| "Free" on the row | Never used; "{N} marked" or nothing |
| "Cut on the Mac instead", "Cutting on your iPhone", "Keep PongLens open while it cuts." | Players never see where a cut runs. A phone cut that can't finish hands over silently; the server also takes over a phone quiet for 15 minutes, or 60 when its last report was the upload (migrations `20260925105830`, `20260926141940`). Player labels are the same wherever it runs: "Cutting the video", "Uploading the result", "Saving the match" |
| "Me serves" | "You serve" |
| Row line "You tap where each point starts and who won." | "You mark where each point starts and ends." |
