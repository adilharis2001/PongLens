# Refusing broadcast footage

2026-08-22.

Professionally produced match footage kept arriving as YouTube imports and
going through the whole pipeline. It cannot work. The camera cuts between
points, so the table, the players and the venue all change every few
seconds, and calibration, point assembly and placement are each looking at
a different match by the time they finish. It also costs real compute, and
none of it is the uploader's own game.

The five long ones in the corpus below are 21 to 30 minutes each.

## What shipped

`looks_like_broadcast` in `worker/worker.py`, wired into all three places
the content gate already runs: the upload-time check (097), the library
import, and the processing-time backstop. It refuses with its own message,
separate from the "not table tennis" one, and it fails open everywhere.

**Two signals, and both must fire.**

| | what it measures | cost |
| --- | --- | --- |
| cuts | frames clearing an ffmpeg scene score of 0.30, over four 60s windows | CPU on an already-local file |
| vision | per-frame production markers, median of three trials | one call ×3, only if cuts fired |

The cheap signal runs first, so an ordinary upload returns before any API
call is made.

## Why it is an AND

Because each signal on its own rejected a video a real person uploaded.
That is measured, not cautious:

- **vision alone called a real under-13 tournament a broadcast**, 12 frames
  of 12. It is a parent's tripod at a zonal qualifier in Indore: a human
  umpire at a manual flip scoreboard, STAG equipment-sponsor barriers,
  other tables in shot. Nothing about it is televised. The first prompt
  explicitly excluded exactly that case and the model ignored it.
- **cuts alone flagged a player's own highlights reel** at 14 frames,
  inside the broadcast band of 13 to 34.

Each signal's blind spot is the other's strong suit. Widening either one on
its own re-opens a rejection of real footage, which is a far worse outcome
than passing a broadcast through.

## The corpus

`corpus.tsv`. 26 videos a real person would upload, 6 broadcasts.

- 22 phone recordings, 2 different users, 7 venues (LYTTC, Westchester,
  Matchpoint, PingPod, PingPod Dobro), 428s to 2370s
- 1 real grassroots tournament (Indore U13)
- 3 synthesised videos of a player editing their own footage, built by
  `build_adversarial.py`: three games joined end to end, a 16-cut
  highlights reel across four venues, and continuous handheld shake
- 6 broadcasts: Ma Long vs Calderano, Ma Long vs Lebrun, Lebrun vs
  Calderano, Batra vs Ito, Top 14 Impossible Rallies, and a 10s Shorts clip

## Measurements

Cut scores, every frame, 4×60s windows at 5fps and 320px
(`measure_cuts.py`, results in `cut_scores.json`):

| | frames ≥0.30 | peak score |
| --- | --- | --- |
| 22 real recordings | **0, every one** | 0.26 |
| Indore U13 | 1 | 0.32 |
| own concat of 3 games | 2 | 0.46 |
| own handheld | 0 | 0.28 |
| own highlights reel | **14** | 0.63 |
| 5 long broadcasts | **13 to 34** | 0.40 to 0.85 |
| Shorts (10s) | 0 | 0.08 |

Counting frames rather than taking the peak is load-bearing. By peak,
handheld (0.28) and the tournament (0.32) are inseparable from anything.
By count they are 0 and 1 against a broadcast's 13.

Vision, median of 3 trials of 12 frames (`measure_vision.py`,
`prompt.txt`, results in `vision_votes.json`):

| | median | trials |
| --- | --- | --- |
| 22 real recordings | **0, every one** | one hit 3 once |
| Indore U13 | 0 | 1/0/0 |
| own highlights reel | **0** | 0 on 9 trials of 9 |
| 4 full broadcasts | 12 | 9 to 12 |
| Top 14 Impossible Rallies | 7 | 4/5/5/6/7/7/8/8/12 |
| Shorts (10s) | 0 | 2/0/0 |

## Thresholds

`BROADCAST_CUT_FRAMES = 5` sits between a real maximum of 2 and a broadcast
minimum of 13.

`BROADCAST_MIN_VISION = 3`. Note what this number actually separates: only
videos that already cleared the cut half ever reach it, so it is not
dividing amateur from broadcast, it is dividing **a player's own edit from
a broadcast**. The only legitimate video in the corpus that reaches it is
the 16-cut highlights reel, which scored 0 on 9 trials of 9.

It was first set to 4, from a single 3-trial reading of 4/6/7 on Top 14
Impossible Rallies. The end-to-end run then read the same video at 8/3/3,
median 3, and let it through. Nine trials on the canonical frames gave a
median of 7 and a minimum of 4, so the video is genuinely near the line and
the frame sample moves it. Three is above every legitimate reading observed
(the highest was a median of 1, on a video that never reaches this call)
and below every broadcast reading observed.

A compilation of professional rallies is the thin case on this signal
because most of its frames are wide rally shots with no graphic laid over
them. It is not thin on the cut signal, which is the point of the AND.

## Three things the measurements corrected

- **0.4 was the wrong scene threshold.** It was the first guess. At 0.4,
  Ma Long vs Lebrun scores 1 frame and slips through; at 0.3 it scores 13.
  Low-bitrate sources compress the score range, and that match is 640×360.
- **Folding the question into the existing content-check prompt broke the
  existing gate.** It was meant to make the broadcast check free. One trial
  looked perfect. Three trials showed Batra-Ito's table-tennis score going
  12/4/3 of 12, against a `CONTENT_CHECK_MIN_POSITIVE` of 3. It would have
  started calling table tennis "not table tennis". The broadcast question
  is now its own call and the content prompt is untouched.
- **One vision call is not a safe reading.** A real PingPod session came
  back 12 of 12 on one trial of three: the wall screens reading "Table 2"
  and the neon venue logo look like a score bug and a channel watermark.
  The batch flips all at once, so the trials are not independent votes
  within a call. Three calls, take the median.

## Known miss, left deliberately

A very short highlight clip. The 10s Shorts video is one continuous rally,
so there are no cuts to find, and its burned-in sponsor boards are physical
venue advertising rather than overlaid graphics. It bills one minute.
Catching it would mean widening a signal, which is how real footage starts
getting rejected.

## Measure on local files, not on presigned URLs

`_camera_cut_frames` seeks four times. Against a local file those seeks are
exact. Against a presigned R2 URL they are byte-range seeks that land on
whatever the server returns, and the first frames decoded after one can be
garbage, which scores as a scene change.

It is not a small effect. The same three local files that measure 14, 2 and
0 cuts measured 14, 13 and 13 when the identical function was pointed at a
URL, and every real recording in the corpus moved from 0 to 13 or 14. The
verdicts happened to survive it, because the vision half held, but the cut
numbers from a URL run are not evidence of anything.

Production always downloads first and both gates run on the local copy, so
this is a property of the harness rather than of the gate. Anything
re-measuring this must download too. Confirmed on seven raws pulled to
disk: four phone recordings and the Indore tournament at 0 cuts, Top 14 at
14, Batra vs Ito at 30.

## Limits worth stating

- 26 legitimate videos from 2 users. Real-world diversity is wider.
- Low-bitrate sources compress cut scores. A very low-resolution broadcast
  could fall under the threshold.
- A highlights compilation of professional rallies is the one broadcast
  that sits near the vision threshold rather than far above it. Three
  separate readings gave medians of 7, 4 and 3.
- `validate_end_to_end.py` runs the shipped function over the corpus and is
  the check to re-run after any change to either signal. Point it at
  downloaded files; see above.
