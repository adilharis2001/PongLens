# Ball detection cropped from any table, and a router that counts serves per point

**Status:** proposed on 2026-09-06 at the end of the routing audit;
agreed by Adil the same evening with all three decisions taken (the veto,
the second pass, and the crop gate for end-on tables); built on the
branch `endon-serve-borrowing` alongside the serve borrowing. What was
built and how it was verified is in "As built" at the end. Two changes
that ship together or not at all: the crop on its own flips Anton's booth
to the serve-anchored assembler, which measures 49% clean there against
64% for end-on. Nothing here touches `app_config`.

**Goal:** a first-time upload whose table came from the vision calibrator
gets the same cropped ball detection a keypoint-calibrated upload has had
since 2026-09-01; and the router stops measuring minutes of video.

The numbers are in `docs/research/2026-09-06-endon-routing.md`: section 2
(what the crop does to detection and to both assemblers on Anton's two
matches), sections 3 and 4 (the router on the corpus), and section 7 (what
the crop does on the end-on bench, added at the end of the day, which is
the reason this spec is narrower than the audit's first proposal).

---

## The problem, in one paragraph

`worker.detect_ball` crops the video around the table before running the
ball detector, but it takes its corners from the keypoint calibrator only.
The vision calibrator runs later, inside the points stage, because its
proposals are validated against the ball detections themselves (overlap
with the bounce core, `vtc.validate_generic_candidate`). So an upload the
keypoint rung declines is detected on the full frame, and the serve
detector then sees the ball at two pixels across with every neighbouring
court in the picture. That is Anton's booth: keypoints decline all sixteen
frames (support 3.1 to 4.8 against the 6.0 bar), vision finds a table, and
the serves come out at 13 and 32 where the crop finds 48 and 53. The
router, which today asks for serves per minute of video, reads that as a
serve-blind camera and sends both matches end-on. In the corpus, 26 of 164
matches with a match.json are vision-calibrated; 22 of them went
serve-anchored on full-frame detections and 4 went end-on.

---

## Part A: the crop for a vision-calibrated match

### Why it has to be a second pass

The crop needs corners before detection; the vision calibrator needs
detections before it will trust corners. Neither can go first, so the
design is: detect and calibrate exactly as today, and if the table came
from vision and the detection was full-frame, detect again on the crop and
rebuild the points from the second detection. Nothing is guessed: the
second pass uses the corners the first pass validated, through the same
`corners=` short-circuit a reprocess already uses.

### The flow, in `worker.py`, inside the `options.get("points")` branch

1. `detect_ball(...)` as today. It gains one side effect: it writes
   `ball_crop.json` beside `blurball.jsonl` in the workdir, holding
   `{"box": [x, y, w, h] | null, "corners_from": "keypoints" | "job" |
   null}`. The return value is unchanged (the path), so no caller moves.
2. `run_points_subprocess(...)` as today. `cmd_points` gains one argument,
   `--detections-note TEXT`, and appends it to `notes` verbatim, so
   match.json records what the detector saw: `detections: crop 1128x634 at
   (468,174), corners from keypoints` or `detections: full frame`. The lab
   had to reproduce production from scratch today to learn which one
   Anton's matches were; that must never be necessary again.
3. New, after step 2: read `points_out/match.json`. If `app_config.ball_crop`
   is on (the job option wins either way, as today), `ball_crop.json` says
   no box was applied, and `calibration.source == "vision"` with
   `table_corners_px` present:
   - `pulse_stage("ball_recrop")`. Progress stays at 45; it must not go
     backwards. `/admin/processing` gets the stage in `STAGE_LABELS`:
     "Finding the ball again, around the table". A job in this stage for
     twenty minutes is healthy; the page has to be able to say so.
   - Move `points_out` to `points_out.fullframe` (kept until the job ends,
     for the fail-open below and for the s41 diff).
   - `detect_ball(local_input, workdir, table_crop=True, corners=<the
     vision corners>)`. This is the existing short-circuit path; it
     overwrites `blurball.jsonl` in place and rewrites `ball_crop.json`
     with `corners_from: "vision"`.
   - `run_points_subprocess(...)` again, with two more arguments:
     `--calibration-json points_out.fullframe/calibration.json`, which
     makes `cmd_points` skip the ladder and use that quad (no second paid
     call, no second keypoint run), and the detections note for the crop.
     `cmd_points` writes `calibration.json` (the `calib` dict minus `bg`)
     into its outdir on every run so this file always exists.
   - Fail open at every step: a failed encode, a crashed second detection,
     a second points run that raises, or a second match.json with zero
     cards, and the first pass's `points_out` is restored and a note is
     appended: `second pass failed (<reason>); kept the full-frame
     points`. A match processed on full-frame detections is what we have
     today; a match that fails to process is not.
4. Everything after (cut, publish, clips) reads `points_out` as today.

### What it does not touch

- Keypoint-calibrated matches: step 3 never fires, their path is
  byte-identical.
- Reprocesses with `ball_crop_corners`: `corners_from` is `"job"`, step 3
  never fires.
- Matches with no calibration: nothing to crop to; unchanged.
- The video itself is never cropped, on either pass (the detector sees the
  crop; cards, clips and geometry read the untouched file).
- `points_v2.py`, `points_endon.py`, the router.

### What it costs

A second ball detection over the whole video, a second points run and a
second clip encode, on vision-calibrated matches only: 16% of the corpus.
On the Mac Studio the detector runs at 55 to 80 fps on the crop, so a
twenty-minute 60 fps upload pays about fifteen minutes more. The first
pass's clips are wasted; the optimisation (run the first pass with
`--no-clips` when a second pass is possible) is deliberately not in this
spec, because it changes the failure path.

### Measured before it ships

- Anton's two matches through the whole worker flow: 48 and 53 serves,
  route end-on under Part B, 64% clean against the audio marks (section
  2c). The note reads `detections: crop ... corners from vision`.
- Four side-on lab matches with Adil's marks (ishan_rc, prabhas_rc,
  chris_b, kumar) re-detected on the crop from their stored quad, scored
  with s60: v2 clean% not down on any of them. Their production quads
  came from Sol, so they are exactly the population this change reaches.
- The s41 pattern on one keypoint-calibrated match: match.json
  byte-identical apart from the new detections note.

---

## Part B: the router counts serves per point

### The rule

```
serve_yield = len(E.serves) / max(len(v2_cards_before_routing), 1)
table_share = len(E.bt_table) / max(len(E.bt), 1)
wants_endon = serve_yield < SERVE_YIELD_MIN            # 0.42
              or table_share < TABLE_SHARE_MIN          # 0.57, the veto
```

`serve_yield` asks what the router was always trying to ask: on what share
of the points the serve-anchored assembler found, did the serve detector
actually see a serve? A break between games adds no cards and no serves,
so it cannot move the number; serves per minute of video can, and on the
seventeen lab matches dead time is 30 to 63% of the video even after the
dead-space cut. Serves per ACTIVE minute is not the fix: Tripp's match
reads 2.22 per active minute and would go serve-anchored, where it scores
46% instead of 75%.

`table_share` is the share of moving-ball bounces the homography puts on
the playing surface. On every real quad in the lab it is 60 to 85%; on a
net-post diamond it is 42 to 53%, because half the surface projects off
the table. It is the one label-free number that says "the geometry the
serve-anchored assembler is about to trust is not the table". Without it,
Part A sends Anton's booth serve-anchored at 49% clean. With it, the booth
stays on the assembler that measures 64% there.

Thresholds: 0.42 sits in the gap between tripp_rc (0.34, the highest end-on
yield) and gavin_16 (0.50, the lowest side-on); on the stored corpus the
nearest values are 0.39 and 0.47. 0.57 sits between anton_first (53%) and
terry (60%). Both are drawn through gaps in seventeen matches, the same
honesty caveat `SERVE_RATE_MIN` carries today, and the same remedy: both
numbers go into the note on every match from the first day, so the next
revision has the whole corpus to draw from.

### What it changes today

Nothing. `serve_yield < 0.42` reproduces the shipped route on all 62
matches the router has handled in production. The veto cannot be checked
on the stored corpus (it needs the bounce lists, which only the lab holds
for seventeen matches plus Tim's), which is why it is the part of this
spec to argue about.

### Where it lives

`points_endon.wants_endon(E, cards)` gains the cards argument; the call
site in `points_pipeline.cmd_points` already has `v2_out` built before the
router runs. `serve_rate` stays, for the note. The note gains `serves/card
0.34, table share 0.48` after `route ...`; the admin uploads page's regex
(`uploadView.ts`) parses the front of the note up to the route and keeps
matching. `SERVE_RATE_MIN` is deleted, not left as a second rule.

### Measured before it ships

The s41 pattern on the six corpus matches with marks: route unchanged,
cards byte-identical. Tim's match (1c08539e): stays end-on (yield 0.33,
table share 48%). Anton's two: end-on with or without the crop.

---

## Section 7's finding: the crop is not medicine for the end-on assembler

Measured today on the end-on bench, which was built before the crop
existed (18%, 41% and 28% of its detections lie outside the box production
would use):

| match | end-on, full frame | end-on, crop | lost | fused | serves |
|---|---:|---:|---:|---:|---:|
| koko | 76% | 78% | 0 → 0 | 0 → 4 | 5 → 13 |
| terry | 71% | 69% | 0 → 3 | 2 → 4 | 4 → 7 |
| tripp_rc | 75% | 69% | 0 → 0 | 9 → 17 | 31 → 49 |
| total (199 points) | 74% | 71% | 0 → 3 | 11 → 25 | 40 → 69 |

On terry the three rallies the crop loses are short points (3 s) during
which 69 of 79, 36 of 59 and 65 of 68 full-frame detections lie outside
the box, to its left and right. The crop raises serves everywhere and
fixes a serve-blind SIDE view; on a camera behind the players it changes
what the segmentation sees and, on the evidence so far, not for the
better. Two consequences:

- Part A is still right for the population it reaches (vision-calibrated
  matches, 22 of 26 serve-anchored), but it should not be sold as an
  end-on improvement. It is a serve-detector improvement that the router
  in Part B keeps from doing harm.
- Production has been cropping keypoint-calibrated END-ON matches since
  2026-09-01, including Adil's two Westchester uploads of 2026-09-01. Whether
  that cost them rallies is a question for the bench, not this spec. The
  research record's section 7 carries the numbers and the diagnosis; the
  decision it asks for is separate.

---

## Decisions this spec needs from Adil

1. **The veto.** Ship `table_share < 0.57` alongside the yield rule
   (recommended: without it Part A makes Anton's cuts worse), or ship the
   yield rule alone and accept 49% on his booth until the calibration bug
   is fixed.
2. **The second pass.** Fifteen extra minutes on one upload in six, for
   serves that go from 13 to 48 on the booth that started this.
3. **Not in this spec, raised by section 7:** whether the shipped crop
   should keep applying to end-on cameras at all. The bench says it costs
   the end-on assembler three points and three rallies in 199. The
   cheapest remedy measured is to skip the crop when the keypoint quad's
   foreshortening is under 0.40 (research record, section 6, item 3).

---

## Out of scope, named so they are not assumed

- The end-on assembler borrowing serves: its own spec, built on this
  branch, faithfulness passed.
- The crossed-table calibration bug (the net-post diamond): a
  `table_coordinates.canonicalize_table_quad` change with the 62-match
  calibration corpus behind it and a product decision about which end is
  "near" on a true side view. Its own research record.
- Widening the end-on bench beyond three Westchester matches.

---

## As built (2026-09-06, branch `endon-serve-borrowing`)

**Router** (`points_endon.py`): `SERVE_YIELD_MIN = 0.42`,
`TABLE_SHARE_MIN = 0.57`, `serve_yield(E, cards)`, `table_share(E)` (None
when there are no moving-ball bounces, which disables the veto),
`wants_endon(E, cards)`. `SERVE_RATE_MIN` is gone; `serve_rate` stays for
the note. The note gains `serves/card 0.15, table share 0.73` after the
route; the admin uploads page reads both and explains the route in those
terms (`SERVE_YIELD_MIN`, `TABLE_SHARE_MIN` mirrored in `uploadView.ts`).

**Crop gate** (`points_endon.crop_allowed`, `CROP_MIN_SHAPE = 0.40`): the
worker skips the crop when the quad's shape reads end-on, from any corner
source. On the seventeen lab quads plus Tim's: koko 0.32, terry 0.25,
tripp_rc 0.28 and gavin_16 0.33 skip it; every other quad (0.46 to 1.39,
Anton's diamonds 0.49 to 0.74, Tim 0.61) keeps it.

**Detection record** (`worker.detect_ball`): writes `ball_crop.json`
beside the detections (`box`, `corners_from`, `reason`, `shape`), and the
job flow turns it into a note in match.json: `detections: crop 1128x634 at
(468,174), corners from keypoints` or `detections: full frame (no table)`.

**Second pass** (`worker.rerun_points_on_vision_crop`, decision in
`second_pass_wanted`): runs when the crop is on, the first pass was full
frame for a reason other than an end-on table, and the points stage
calibrated through vision on a table that does not read end-on. It sets
the first pass aside (`points_out.fullframe`, `blurball.jsonl.fullframe`),
detects on the crop with the vision corners, and runs the points command
with `--calibration-json` (the ladder is skipped; no second paid call) and
the detections note plus "second pass". Any failure restores the first
pass and appends `second pass failed (...); kept the full-frame points`.
Stage `ball_recrop`, labelled "Finding the ball again, around the table"
on `/admin/processing`. Progress holds at 45 during it.

**Verified:**

- 38 worker unit tests (`test_ball_crop`, `test_endon_router`,
  `test_second_pass`, `test_points_pipeline`, `test_points_v2_rally_end`),
  33 uploads-page tests and 32 processing-page tests pass.
- Router against production's routes: all 18 lab matches land where
  production put them or where the audit measured they belong (Anton's
  three end-on through the veto, Tim end-on, every real side-on quad
  serve-anchored); on the stored corpus 59 of 62 routed matches are
  reproduced by the yield alone, and the three others (5ff02073 at 0.39 on
  a 0.32-shaped camera, and two matches with zero serves) were routed
  before the end-on fallback was switched on and would go end-on today
  under either rule.
- The whole points command, production code against this branch, on
  ishan (side-on): identical apart from the notes. On koko (end-on): the
  one card the borrowed serve moves, as in the serve-borrowing spec.
  Handing the calibration back through `--calibration-json` on koko:
  identical to the ladder run apart from the reuse note; the keypoint
  detector did not run.
- The second pass end to end on Anton's short match (lab s84): see the
  research record, section 8.

**Not verified:** the whole web build. `npm run build` fails at main's
HEAD on two files this branch does not touch
(`src/app/admin/uploads/[matchId]/CardTimeline.tsx` and `ServeMissView.tsx`
import `inferredBounceMarkerTitle` and `tableTrailAt`, which
`serveMiss.ts` does not export at HEAD). The two TypeScript files changed
here compile in the Next compile step and are covered by their tests.
