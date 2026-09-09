# Points from the players: the body-first assembler in the production worker

**Date:** September 8, 2026
**Status:** Adil's decision, 2026-09-08 evening: build it, then route ALL new
uploads through it for five days behind a flag, and keep it if it holds up.
Not a shadow. Not a sample. He has stated he understands the risk; this spec
exists to make that decision safe to take.
**Record:** `docs/research/2026-09-08-body-crop-and-coverage/README.md`
(sections 1 to 10) holds every measurement this design rests on, and
`docs/research/2026-09-08-body-crop-and-coverage/scripts/` the code that
produced them. The lab itself is `scratchpad/poseretest` on the Mac Studio.

---

## Summary

Today the worker turns a match into points by following the ball: it finds
the table, detects the ball, anchors each card on a detected serve, and on
cameras where that fails it hands over to the end-on assembler. Adil's
verdict on the result is blunt: good on serve-anchored side-on matches,
"absolute shit" on end-on cameras and on every match where the table was
found wrong or not at all.

The body detector reads the two players instead. Where they stand, how they
move, when they go still. It never needed the table, and on the thirteen
matches Adil has reviewed row by row it covers his scored points better than
production does, with the ball used only to sharpen what the bodies found.

This spec puts that detector into the worker as a third card assembler,
selected by the existing `app_config.points_pipeline` switch:

- `v1`, `v2`: exactly what runs today.
- `bodies`: the body-first assembler decides where the points are; the ball
  pipeline still runs and hands it serve stamps, net crossings and table
  bounces; everything downstream of the card list (cut, clips, points rows,
  placement, thumbnails) is untouched.

One UPDATE flips every new upload to `bodies`. One UPDATE flips it back. A
single match can be recut either way without touching the switch.

---

## 1. What is being decided, and what is not

**Decided by Adil.**

- All new uploads go through `bodies` for five days from the day the flag
  flips. Rollback is the flag, not a deploy.
- The source of truth for "is this good" is Adil. On the research page that
  means the rows he marked *fine as is* outrank the production card and the
  tap behind them; rows he did not mark are ones where the body card and the
  reference already agreed. During the trial it means his scoring on the new
  matches plus the same three-button call on the admin upload page.
- No switch-on criterion. He decides on the fly. If the trial holds, the
  flag stays and the ball-first assemblers become the fallback.
- The loosened decoder is in: `bias 0.5, dur_w 4, play_min 1.5` on top of the
  ball veto. He accepted about three extra junk cards a match for six of his
  eight missed points back.

**Not in scope for the trial.**

- Whole-frame skeletons and the player-continuity chooser. Measured on
  2026-09-08: fixes Julian and Anton, loses six points on Koko 2 through the
  retrained model. Nothing that loses a scored point ships. The pose window
  for the trial is the widened crop (section 4.2).
- A second machine. The pose pass is CPU on the Mac Studio, like the rest.
- Replacing the person detector's weights (licence, section 9). The same
  weights already run in production for the End changes stage, so the trial
  adds no new exposure; the swap happens before "permanent".

---

## 2. What the numbers say, with Adil's calls as truth

Thirteen matches, 973 production point rows, 303 row calls by Adil on ten of
them (Tim and both Hugo matches unreviewed). Counts are problems LEFT after
his *fine* calls are excused; "shipped" is the page as deployed at 17:10,
"trial model" is what this spec ships.

| after Adil's calls | shipped | trial model |
| --- | --- | --- |
| scored points with no card | 25 | 17 |
| cards ending more than 2 s before his winner press | 55 | 42 |
| two points in one card | 39 | 47 |
| junk cards | 77 | 114 |

Two things to hold onto when reading these. "Points" on that page are
production cards, and only rows with a winner tap are Adil's scoring: Tim,
Hugo 22m and Wayne Wei were never scored by him, and Rob only partly. And
production is the reference on that page only because it is what the page
has. Where Adil has looked, his call wins.

What the remaining misses are: short points (a service fault, a receive
miss, an ace) where the players barely move. The decoder now catches most of
them; the two it still loses (Julian 386, Koko 2 196) read as dead time to
the bodies for the whole point.

---

## 3. Architecture

### 3.1 Where it sits

Nothing moves in the job flow. The media job (`deadspace_cut`, "Match
processing" on the processing page) already runs, in order: download, trim,
content checks, ball detection, points, cut, upload, publish. The points step
is a subprocess, `points_pipeline.py points --pipeline v2`, whose `cmd_points`
builds cards and writes `match.json` with `cut_segments`; the cut keeps
exactly those segments.

With `--pipeline bodies`, `cmd_points`:

1. Runs the ball side exactly as for v2: table ladder, `points_v2.build_cards`
   producing `v2_cards` and the evidence object `v2_E` (serve stamps
   `E.serves`, net crossings `E.cross`, table bounces `E.bt_table`), and the
   router's three numbers (serves per minute, serves per candidate point,
   table share). These are recorded on the match as today. They no longer
   choose the assembler.
2. Runs the pose pass (section 4) over the same video the points step reads,
   into `<workdir>/players.json`.
3. Runs the body assembler (section 5) on the poses plus the ball evidence,
   producing the card list.
4. Replaces `v2_cards` with the body cards. From here the code path is the
   existing one: plays, `cut_segments`, clip windows, `cut_t0`, points rows.

If step 2 or 3 fails for any reason, the match keeps the cards the ball side
built (serve-anchored or end-on, whatever the router chose), and the note
says so. Fail open, the same contract every switch in the worker has.

### 3.2 The switch

`points_pipeline_version(conn)` today returns `v2` or `v1`. It returns
`bodies` when `app_config.points_pipeline = 'bodies'`. A read that errors
still fails open to `v1`.

`run_points_subprocess` passes `--pipeline bodies` together with every v2
argument (surface pad, merge, evidence dump, `--endon-fallback`), because
the ball side still runs in full.

**Per-job override.** `jobs.options.points_pipeline`, when present, wins over
the config, the same way `options.ball_crop` wins over `app_config.ball_crop`.
This is how one match gets recut with the other assembler during the trial
without flipping the world (section 7.3).

### 3.3 What the match records

`match.json`:

- `"pipeline": "bodies"` when the body cards shipped; `"v2"` or `"v1"` when
  it fell back. This key is the truth about what happened.
- A new note sentence, appended AFTER the existing `points v2: ...` sentence
  (which is still written, because the ball side still ran and the admin
  page parses its front with a regex):
  `points bodies: N cards, K with a serve, pose pass Ms over W (widened
  crop|full frame), model body-v1, decoder bias 0.5 dur_w 4 play_min 1.5`.
- On fallback: `points bodies requested but fell back to <route>: <why>`.

`points` rows: unchanged schema. Every body card carries `t0`, `t1`,
`cut_t0` (derived exactly as today from the spans), `serve_s` when a stamp
fell inside it, and the existing `cut_t0` tripwire still fires if any row
lacks it.

**Both answers are kept.** The ball side's own cards (`v2_cards`, or the
end-on cards where the router chose them) are written into `match.json` as
`ball_cards` with the route the router would have taken. They never become
points; they exist so the admin portal can show, on every trial match, what
the bodies cut against what the ball would have cut (section 7.2). Cheap,
because the ball side ran anyway.

---

## 4. The pose pass

### 4.1 What it is

A new script, `worker/extract_players_rtmpose.py`, run under the existing
`rtmpose-production` venv (`RTMPOSE_PY`) like the two RTMPose scripts the
worker already has. It is the lab's `pose_match.py` made production-shaped:

- Input: the same video file the points step reads (`args.video`), so poses
  are on the source clock the cards are built in.
- 10 samples a second, **by presentation time, not by frame index**: phone
  recordings are often variable frame rate, and counting frames drifts by
  seconds over a long match, which would shift every card. The lab reads a
  `.pts.json` of true frame times beside the video (`frame_pts.py`); the
  worker writes the same file once per video and the pass reads it.
  RTMDet finds the people in the window, production's own `choose_players`
  names near and far from the table corners, RTMPose gives each 17
  keypoints. Features are scale-free (normalised by body height and table
  geometry), so a 4K upload needs no special handling beyond the window.
- Output: `players.json` in the workdir, the lab's format (frame key on the
  10 fps clock, `near`/`far` each with `box` and `kp`, the `rect` of the
  window written into the file), so the frozen model reads it unchanged.
- Progress: `pulse_stage("players")` at start, and `jobs.progress` advanced
  every 500 sampled frames, because a 20-minute silent stage reads as a dead
  worker on the processing page.
- Timeout: 3 hours, under the cost meter as its own stage
  (`timed_stage("player_poses", ...)`), so `/admin/costs` shows what the
  pass costs per match rather than folding it into point clip encoding.

### 4.2 The window

The lab measured three windows on 2026-09-06: the ball crop clips the near
player at the edge in two thirds of Lester's frames; the full frame keeps him
whole but brings in bystanders at halls; the ball crop widened by one table
width each side and half a width top and bottom keeps both players whole
with the bystander problem mostly gone.

Settled 2026-09-08 after the analysis in research README section 11: the
window is defined in TABLE WIDTHS (the mean of the two end lines in pixels,
`serve_v2rule._table_w`), so it already scales with the camera's distance,
and production's chooser keeps spectators out with its own distance rule
(a person counts only within 1.1 of their own box height of the table). On
Yu Yu Lin the wrong-person rate does not move between one width and the
whole frame; on Julian's booth the near player leaves a one-width window in
one frame in ten and a 1.5-width window in one in a hundred.

- With a table: the ball crop widened by **1.5 table widths each side, one
  width below, half a width above**, clamped to the frame. The thirteen
  matches' skeletons are regenerated on this window as part of freezing the
  model (about five hours of CPU), and the frozen model is checked against
  Adil's calls before the flag flips.
- Without a table: the full frame, and a stand-in table for the chooser:
  the ball pipeline's activity gate (`activity_gate`, the box the ball
  lives in) stands in for the quad, so the same two rules run against it.
  Recorded in the note as `window full frame, no table`.

### 4.3 Cost, and where it lands in time-to-ready

Measured on the whole frame at `nice 15`: about 1.4 minutes of CPU per
minute of video (Hugo 22m, 22 minutes of video: 25 minutes of boxes plus
4.5 of poses). The widened crop is smaller than the frame, so expect less,
not more. The pass runs before the cut, so during the trial a 15-minute
match takes roughly 20 minutes longer to be ready than it does today. Adil
accepted this on 2026-09-08 ("completely okay"). Running the pass in
parallel with ball detection (both are CPU) would hide most of it and is the
first optimisation after the trial, not part of it.

---

## 5. The body assembler

A new module, `worker/body_points.py`, under the worker's own venv (numpy
only). It is the lab chain with the research scaffolding removed:

1. **Features** from `players.json`: the four families that ship, `rhythm`,
   `floor`, `snap`, `ball`, exactly the columns the frozen model was trained
   on, smoothed at 0.5 s. The `ball` family (seconds since the last net
   crossing, crossings in the last 3 s) comes from `E.cross`; when there is
   no table it is zero everywhere and the model's other columns carry the
   reading, which is the pre-ball model that covered 923 of 973 points.
2. **Play probability** from the frozen weights (section 6). Then the ball
   veto: while three or more crossings fell in the last 3 s the reading
   cannot drop below 0.6.
3. **Decode**: the hidden semi-Markov chain with the point-length prior,
   settings `bias 0.5, dur_w 4.0, play_min 1.5`, everything else at the
   lab's defaults. Boundary snapping (`snap_on 1.0`) from the frozen onset
   model.
4. **Refine with the ball**, the four statements that survived measurement,
   with the lab's switches hard-wired: stamp the first serve inside a card
   (`serve_s`); split a card holding two serves six or more seconds apart;
   keep an end open while crossings and table bounces keep arriving with
   gaps of 1.2 s or less and the play reading stays at or above 0.3, capped
   short of the next card and the next serve; drop a card that saw no
   crossing and no table bounce (the quiet rule, kept: against Adil's
   scoring it cost one point in the corpus); no body card before the ball
   pipeline's first card.
5. **Resolve** through `points_v2.resolve`, the same ordering and
   minimum-gap logic every card already goes through.

Output: the card list in the shape `cmd_points` already consumes (`t0`,
`t1`, `serve_s`, `why`, `end_evidence_s`). `why` reads `bodies`,
`bodies, serve seen`, `bodies, serve seen, end kept open by the ball`, the
same words the research page shows, so what Adil reviewed and what ships
say the same thing.

**Guards, each falling open to the ball cards with its reason in the note:**
the pose pass produced both players in fewer than 40% of sampled frames (a
practice video with one player, a robot, a camera on the wrong table); the
decoder produced no segment at all; the feature code's hash does not match
the frozen model's. A match with one visible player is not a body-detector
match, and saying so is better than inventing cards.

Known limits, stated rather than hidden: a rally longer than 26 s is split
at the decoder's ceiling; a player fully hidden behind the other for a whole
point is invisible to it; the far player at a hall camera is 180 px tall and
the model is weakest there; the far player is confused with someone else in
7 to 13% of frames at Westchester and LYTTC whatever the window, which is
the continuity chooser's job (section 9).

---

## 6. Freezing the model

The lab refits the model from the thirteen matches on every run and saves
nothing. Production must not.

`worker/body_model/v1/` holds:

- `model.npz`: logistic weights, feature means and spreads, the ordered
  feature names, the decoder settings, trained on ALL thirteen matches (the
  lab holds four out for honest numbers; the shipped model uses everything).
- `edge.npz`: the onset and ending boundary models, same training set.
- `features.sha`: the hash of the feature code that produced the columns.
  The module refuses to run if its own feature code hashes differently.
- `fixture.json`: the cards the module itself produces for the thirteen
  matches from their stored poses and ball evidence.

`worker/tests/test_body_points_parity.py` rebuilds all thirteen from the
stored inputs and asserts the fixture, card for card, to 0.05 s. The poses
and ball evidence are too large for the repo (3 to 14 MB a match); they live
beside the other model files in `~/ponglens-models/body-poses/` on the Mac
Studio and are mirrored to R2 under `research/body-poses/`.

The research page is regenerated from this frozen model before the flag
flips, so the page Adil reviews and the cards the worker cuts come from one
model. His 303 calls are re-keyed if any row moves under a second, exactly
as on every redeploy so far, and never dropped.

---

## 7. The five-day trial

### 7.1 Day 0

In order, on the Mac Studio:

1. Parity test green.
2. One end-to-end run with `options.points_pipeline = 'bodies'` on a match
   Adil knows (re-upload one of the thirteen under the QA account), checking:
   points rows all carry `cut_t0`; clips play the right rally; the
   processing page shows "Reading the players" while the pass runs; the
   note reads `points bodies: ...`; the admin upload page draws the cards
   with their `why`.
3. Flip: `update app_config set value = 'bodies' where key = 'points_pipeline'`.
4. Confirm the next real upload's note says `bodies`.

### 7.2 What Adil sees, and how he judges

- His scoring, as always, on the new matches.
- The three-button row call (fine / wrong / unsure, plus a note) moves onto
  `/admin/uploads/<matchId>`'s card list for the trial, writing to
  `research_row_verdicts` with `page = 'production-cards'`. The key is the
  card's **birth `t0` from `match.json`**, which never changes, rather than
  the live `points.t0`, which moves the moment the player adjusts or splits
  the point and would orphan the call. Same table, same route, same
  rounding rule. This is the instrument the decision will be made with, so
  it ships with the worker change, not after.
- The pages, by name: `/admin/players` lists players; `/admin/players/<id>`
  lists a player's matches and already links each to `/admin/uploads/<matchId>`,
  whose timeline (`CardTimeline`, `CardReview`) is the comparison view that
  gains the second row and the buttons. The player page's match list gains
  the one-line summary.
- **Where he reads the trial: the admin portal's Players page** (Adil,
  2026-09-08). Click a player, see their matches; open a match and the
  existing comparison view shows, for that match, how both approaches did:
  the body cards that shipped and the ball cards the old assemblers would
  have cut (`ball_cards`, section 3.3), each against his scoring where he
  has scored, with his row calls on the body cards. No new page; the
  existing match view gains the second column and a one-line summary per
  match in the player's list (cards, cards with a serve, fell back or not).
  The daily digest gains only a one-line count of matches cut by `bodies`.

### 7.3 Kill switch and repair

- **Everything back to today:** `update app_config set value = 'v2' where
  key = 'points_pipeline'`. Takes effect on the next upload; no deploy, no
  restart. Matches already cut by `bodies` keep their cards.
- **One match recut the other way:** the admin "process again" action
  passes `options.points_pipeline` on the job, so a match Adil hates is
  recut by the ball assemblers without leaving the trial, and a match the
  ball assemblers ruined last month can be recut by the bodies before the
  flag ever flips. **With one hard rule, found on review:** a reprocess of
  an existing match runs `delete from public.points where match_id = ...`
  (`create_match`, `existing=True`), and every reference cascades: the
  scoring, the notes, the tags, the share links, the cut labels. So the
  recut action refuses a match that has any scored point, with the reason
  on screen, until the score-preserving recut in section 9 exists. During
  the trial that means: recut a match before scoring it, or live with it.
- **A stuck pose pass:** the 3-hour timeout ends it, the match falls back to
  the ball cards, and the note and the digest both say so.

### 7.4 What to watch for, and what covers it

| risk | what covers it |
| --- | --- |
| The pose pass fails or runs long | fail open to the ball cards; timeout; digest line |
| Matches take longer to be ready | accepted for the trial; parallel pass afterwards |
| A venue nobody has seen reads as dead time throughout | the digest shows a match with few cards; per-match recut; the flag |
| No table found | body-only model on the full frame; no serve stamps, so no placement seed, which the match would not have had anyway |
| A lob rally longer than 26 s | split at the ceiling; a one-keystroke join |
| The cloud twin picks up a media job | it must not while the flag says `bodies` (section 8) |
| A card's evidence view on the admin page is thinner | body cards carry no per-card ball evidence beyond the serve stamp; the page shows `why` instead |
| Fewer placement dots, because a card that opens after the serve hides the serve from placement | the player page summary carries "serves drawn" per match; compare with the match's card count; the loosened decoder opens cards earlier, not later |
| Junk cards reach the auto-highlights picker | same exposure as today's junk; the picker's rally-length rule is unchanged; watch the reels of trial matches |

---

## 8. The other surfaces

Every change here has a mirror somewhere else, per the working notes.

- **Processing page.** `STAGE_LABELS` gains `players: "Reading the players"`
  and `body_points: "Building the points from the players"`. The kind is
  unchanged. An unrecognised stage renders raw with a marker, which is how
  a forgotten label announces itself; do not leave it to that.
- **Admin upload page.** `uploadView.ts` learns the `points bodies:`
  sentence and `pipeline: "bodies"`, and shows "Points from the players" as
  the assembler, with the ball router's numbers still displayed as what the
  ball side would have chosen.
- **Cloud twin.** `cloud_enabled` is false and stays false for the trial.
  The twin's bundle does not carry the pose stack, so `points_pipeline =
  'bodies'` must make its claim refuse media jobs outright until a bundle
  that does is installed on both machines and its parity accepted. One
  line in the claim, tested.
- **Fast lane.** Untouched; media jobs are the slow lane.
- **iOS and web apps.** Nothing to change: points rows, clips and `cut_t0`
  keep their contract.

---

## 9. Before "permanent"

Not blocking the trial. Blocking the word permanent.

1. **Detector weights.** The person detector's weights were trained on a
   non-commercial dataset. Swap to the COCO-only checkpoint of the same
   architecture (one URL), regenerate the thirteen matches' poses (about
   five hours of CPU), re-freeze, re-run parity. The End changes stage uses
   the same weights and gets the same swap.
2. **The pose pass beside ball detection**, to give back the trial's extra
   minutes.
3. **The player-continuity chooser and whole-frame skeletons**, scored on
   coverage against Adil's calls, adopted only if no scored point is lost.
4. **The end-on assembler and the per-point router** retire once the trial
   is permanent; the serve-anchored v2 path stays as the fallback the body
   path fails open to.
5. **A score-preserving recut**, before any scored match in the library is
   recut by the bodies. Today a reprocess deletes every point row and what
   hangs off it. The recut has to snapshot each point's winner press time,
   winner, notes, tags and stars, cut the new cards, and re-attach each
   record to the new card whose window holds its press time, flagging the
   ones that land nowhere for Adil to place by hand. This is its own small
   spec; the Westchester matches he wants redone wait for it.

---

## 10. Build order and verification

| step | what | verified by |
| --- | --- | --- |
| 1 | Freeze the model, write the fixture, parity test | test green on the Mac Studio |
| 2 | `extract_players_rtmpose.py` | runs on one stored raw; output loads in the parity test |
| 3 | `body_points.py` | parity test rebuilds all thirteen |
| 4 | `cmd_points --pipeline bodies`, switch, per-job override, note, fail-open | one end-to-end run with the override; a forced pose failure falls back and the note says so |
| 5 | Processing page labels, admin page sentence, cloud claim guard | `npm run build` clean; processing page shows the stage during step 4's run |
| 6 | Row calls on the admin upload page; digest block | a call round-trips from the page to the table |
| 7 | Regenerate the research page from the frozen model, re-key calls | `verdicts_check` finds every call |
| 8 | Flip | the next upload's note |

Estimate: steps 1 to 3 two days, 4 to 6 two days, 7 and 8 the fifth. Every
build goes through `npm run build` in a fresh worktree off `origin/main`;
the worker is restarted from the same commit and its startup line names it.

---

## 11. Gaps found on the completeness review (2026-09-08 night)

Each was checked against the worker's code, not assumed.

| gap | where it is closed |
| --- | --- |
| Phone videos are variable frame rate; counting frames drifts by seconds over a match | 4.1: sample by presentation time, `.pts.json` written once per video |
| A practice video with one player, or a camera on the wrong table, would still get body cards | 5: guard, fewer than 40% of frames with both players falls back to the ball cards |
| Without a table the chooser has no quad | 4.2: the ball's activity gate stands in |
| Adil's calls on trial matches would break the moment he adjusts a point | 7.2: keyed by the card's birth `t0` in `match.json` |
| "Recut the other way" deletes the scoring, notes, tags and share links of a scored match | 7.3: refuses scored matches; 9.5: score-preserving recut before library matches are redone |
| The pose pass's cost would hide inside point clip encoding on `/admin/costs` | 4.1: its own cost-meter stage |
| A card opening after the serve hides the serve from placement | 7.4: serves-drawn per match on the player page |
| Nothing shows what the ball would have cut on a trial match | 3.3: `ball_cards` kept in `match.json`; 7.2 shows them |
| The research page and the shipped model could diverge | 6: the page is regenerated from the frozen model before the flip |

Not closed, and known: the far player's identity at hall cameras (7 to 13%
of frames, every window), rallies over 26 s, a player hidden behind the
other for a whole point. All three are named in section 5 and none has a
fix that does not lose a scored point somewhere today.

## 12. Open points for Adil

None. All three settled on 2026-09-08: matches may take longer during the
trial; the trial is read from the admin Players page (section 7.2); the
pose window is 1.5 table widths each side, one below, half above (section
4.2, analysis in research README section 11). Implementation starts at
step 1 of section 10.
