# The route between the two point assemblers, audited on Anton's uploads

Written 2026-09-06 by the Fable session that ran this audit. Reads with
`docs/research/2026-08-19-endon-camera-handover.md`, whose closed doors all
still stand. Nothing here has shipped. The router, the assembler change and
the detection change below are proposals; each ships only on Adil's word.

Assets for this record live in `2026-09-06-endon-routing/` beside this
file: the quad overlays, one raw frame, the six-minute timeline strip, one
audio-mark check strip, and `corpus-routes.md` (every routed match in R2
with the camera judged by eye).

## The answer, first

Anton's two matches were not sent to the wrong assembler. They were sent
to the assembler that scores BETTER on his camera, and the cards were
unusable because both assemblers were starved upstream:

1. **His serve detector collapsed per POINT, not per minute.** 32 serves
   on 86 points (0.34 per card) and 13 on 53 (0.25). That is inside the
   end-on band on every serve-based measure, including the two the task
   asked for (per minute of active play, per candidate point). Pace of
   play did not do this; a match with a normal serve yield and slow play
   would sit at 0.7 to 1.0 serves per card whatever its rate per minute.
   No match in the corpus is a pace victim (section 3).
2. **The collapse is a detection problem.** Production ran BlurBall on the
   full 1920x1080 frame for all three of his uploads, because the table
   crop that shipped on 2026-09-01 takes its box only from the keypoint
   calibrator, and that rung declines his booth on every frame (support
   3.1 to 4.8 against the 6.0 bar; reproduced locally, 16 of 16 frames).
   The crop, cut from the vision quad the match actually used, finds 48
   serves where production found 13, and 53 where it found 32 (section 2).
3. **His camera is side-on, but his calibration is not the table.** On
   every PingPod W37 match of his, keypoint and vision alike, the stored
   quad runs far-left corner, near-side net post, far-right corner,
   far-side net post: a diamond inscribed in the table. The real four
   corners CANNOT pass `canonicalize_table_quad` from that camera (it
   sits beyond the table's left end, so the end line's corners sort the
   wrong way by x and the canonical polygon is a bow-tie). So
   foreshortening on his matches (0.49, 0.68, 0.74) measures a diamond,
   and any router that reads camera shape reads that error. This is a
   calibration finding, filed here because it decides what the router may
   trust.
4. **On his booth the end-on assembler beats the serve-anchored one,
   with the serves as they were and with them restored.** Against 86 and
   53 audio-marked points, on the detections production had: end-on 53%
   and 47% clean (what he received), serve-anchored 36% and 42%. On the
   cropped detections: end-on 64% on both matches, serve-anchored 49% on
   both. The geometry is why: the diamond puts only 42 to 48% of
   moving-ball bounces on the playing surface (60 to 85% on every other
   match in the lab), so v2's rally ends and tails are wrong even when its
   serve motif fires.

So the change to ship first is not the router. It is the end-on assembler
borrowing detected serves (section 5), which is measured safe on the bench
(74% clean, zero lost, unchanged) and ties for best on Anton's matches
while giving every one of his cards a serve to hang placement on. The crop
from the vision quad is second. The router change (section 4) is third,
and it must include a geometry-health veto or the crop will flip Anton onto
the assembler that scores fifteen points worse on his camera.

Added at the end of the day, section 7: the crop is NOT an improvement for
the end-on assembler on a genuinely end-on camera. On the Westchester
bench it takes the end-on assembler from 74% to 71% clean and loses three
rallies that full-frame detection kept, while raising serves and the
serve-anchored assembler. The crop is serve-detector medicine; the router
is what keeps it from doing harm; and the calibration bug (finding 3) is
the change with the highest ceiling on Anton's booth, because his camera
is a side view and a side view with a correct table scores 92% on the
serve-anchored path.

## 1. Anton's uploads today

Three uploads, all PingPod W37, opponent Hugo Ginoux, all 60 fps, all
"keypoint calibration unavailable; trying vision", all vision quads
accepted as "shape-ranked". Read from the match.json in R2:

| upload | duration | serves | crossings | camera (foresh) | serves/min | route | cards | serves per card |
|---|---:|---:|---:|---:|---:|---|---:|---:|
| 66c0d904 (16:32) | 8.7 min | 22 | 150 | 0.74 | 2.54 | serve-anchored | 36 | 0.61 |
| 5c90151a (17:02) | 22.0 min | 32 | 409 | 0.68 | 1.46 | end-on | 94 | 0.34 |
| 5fd822ec (17:08) | 10.6 min | 13 | 192 | 0.49 | 1.22 | end-on | 53 | 0.25 |

The first is a knock-up: its audio has 29 stretches of continuous hitting
with a median span of 11.7 s and almost no dead time. It is the control for
the detection experiment below and is not scored.

**The camera is side-on.** `anton-long-frame.jpg`: a wall-mounted wide
lens across from the table, high, the 2.74 m axis running left to right
across the frame. Not end-on and not oblique.

**The quad is a diamond through the net posts.** `anton-long-quad.jpg`,
`anton-short-quad.jpg`, `anton-first-quad.jpg` (red = stored quad, green =
prism, magenta = the crop box the stored quad would give, cyan = activity
gate). A_near_1 is the far-left table corner, B_near_2 is the near-edge net
post, C_far_2 the far-right corner, D_far_1 the far-edge net post. The same
shape appears on his 2026-08-27 keypoint quad (`anton-0827-keypoints-
quad.jpg`) and his 2026-08-28 vision quad (`anton-0828-quad.jpg`), so it is
the booth, not today.

Why: measured against the real corners read off a gridded frame of the
long match (far-left 668,584; near-left 704,626; near-right 1186,602;
far-right 1188,568), `canonicalize_table_quad` rejects both end-line
pairings as "canonical table quad is not convex" and accepts only the
transposed pairing (long sides as end lines), which the handover's quad-
health note already calls the one error the net-crossing rule cannot
survive. The canonicaliser sorts each end line's corners by image x; from
a camera beyond the table's end the nearer corner of the near end line is
to the RIGHT of the farther one, and the polygon closes as a bow-tie. Both
calibrators' true-corner proposals fail that test, and the diamond is what
survives. Adil's own W37 uploads (3477975a, 6f7e3be6, c8d94769, 41a18e3d)
carry the same shape, as do the keypoint quads on gavin_16, 2bd5f1b6,
c2129d22, 1c08539e and 93a540ab (`corpus-routes.md`, and the overlays in the
session's scratch).

**Why the detector refused.** serves.json for each match records the rule
that turned down every bounce pair in every card. Long match, 67 unanchored
cards: same_side 22, no_pair 13, too_far_apart 12, backtracked 9,
on_the_net_line 5, would_have_passed 5, off_surface 1. Short match, 40
unanchored: same_side 13, no_pair 13, too_far_apart 9, backtracked 5. Under
a diamond homography "same side of the net" is a diagonal across the table,
which is what same_side leading the list looks like.

**The cut, scored.** Marks for both matches come from the microphone
(section 2, method): 86 points on the long match, 53 on the short. What
production stored (the end-on cards built on full-frame detections):

| match | points | clean | clipped | fused | split | lost | head p50 | tail p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 5c90151a long | 86 | 46 (53%) | 20 | 2 | 12 | 6 | +2.5 s | +1.3 s |
| 5fd822ec short | 53 | 25 (47%) | 11 | 4 | 8 | 5 | +2.2 s | +1.5 s |

Six and five points with no card at all, and a clipped share of 23% and
21%. That is the "nearly unusable" quantified. `anton-long-strip-0-6min.png`
is the first six minutes as a timeline: audio impacts on top, then dense
ball, crossings, detected serves, then four card lanes (production, lab v2,
lab end-on, lab end-on with serves).

## 2. Both assemblers rebuilt in the lab

Lab: `/Users/adil/Desktop/Projects/TTVid/recall-lab`, vendor venv. New
scripts this session: s68 (production-faithful cropped detection), s69
(quad overlays), s70 (router features), s71 (end-on borrowing serves), s72
(production's z-motion, cached), s73/s79 (stamp precision), s74 (Anton
rebuild), s75 (timeline strip), s76 (audio marks), s77 (mark check strips),
s78 (Anton scorecard). Inputs under `work/anton_long`, `work/anton_short`,
`work/anton_first`; cards under `out/anton/<key>.<variant>.json`.

### 2a. What starved the serve detector

Production's own note: 32 / 13 / 22 serves. Rebuilt in the lab from the
same raw with the same vision quad:

| match | production (full frame) | lab, full frame | lab, full frame, every second frame dropped | lab, crop from the vision quad | lab, crop, every second frame dropped |
|---|---:|---:|---:|---:|---:|
| long | 32 serves, 409 crossings | 32 serves, 409 crossings | 43 serves, 299 crossings | 53 serves, 849 crossings | 67 serves, 606 crossings |
| short | 13 serves, 192 crossings | 13 serves, 192 crossings | 15 serves, 139 crossings | 48 serves, 380 crossings | 46 serves, 266 crossings |
| first (knock-up) | 22 serves, 150 crossings | not run | not run | 31 serves, 298 crossings | 33 serves, 210 crossings |

The lab's full-frame builds reproduce production to the serve, the
crossing and the card on both matches: 32 serves and 409 crossings on the
long match, 13 and 192 on the short, the same camera and serves-per-minute
figures as the notes, and the 94 and 53 end-on cards they build score
identically to the stored ones (section 2c). So every difference in the
other columns is the crop or the frame rate, not the lab.

The crop is `points_endon.ball_crop_box` applied to the STORED quad, then
`vendor/blurball_infer.py` on the crop, then `points_v2.shift_detections`,
which is exactly `worker.detect_ball` with `table_crop=True` and corners
supplied. Production did not take that path: `detect_ball` asks
`keypoint_calibrate` for the box, that rung declined ("weak support" on all
sixteen frames, reproduced with the production interpreter), and the code
falls open to the full frame. The worker comment on `detect_ball` already
says Anton's frames score 3.7 to 5.6 against the 6.0 bar and that the
corners option exists so a reprocess can crop; a first-time upload from
this booth never gets there.

Frame rate is a second, smaller factor. These are the first 60 fps uploads
through the pipeline in numbers (7 of 77 matches with a v2 note). Dropping
every second frame after detection, so v2's frame-counted constants
(bounce window, reseed gap, dwell, per-frame fast threshold) see the 30 fps
they were swept at, adds 26% serves on the long match and takes 4% off the
short one. Worth a look at those constants; not the cause.

The hand-marked true quad could not be tested: it does not pass the
canonicaliser (section 1), so there is no homography to build from it.

### 2b. Ground truth for scoring: the microphone, checked against frames

Anton's matches carry no marks. No assembler reads audio, so marks derived
from it are independent of every signal both assemblers use. s76: run
`worker/card_audio.py` (the shipped 10 kHz impact detector) on the raw,
cluster impacts closer than 2.0 s, keep clusters with at least four impacts
spanning at least 1.2 s and at least two above twice the adaptive
threshold; first impact is the serve mark, last impact the end mark. 86
points on the long match (median span 6.1 s, median dead 5.4 s), 53 on the
short (4.4 s, 4.3 s), which is the pace his earlier matches show.

Checked on the footage: s77 wrote eight-frame strips around the serve and
end marks of eight randomly chosen points on the long match
(`anton-long-audio-check-012.jpg` is one). Seven show a serve stance at the
serve mark and a walk or pick-up after the end mark; one has the serve mark
about a second late (the bat contact was not the first audible impact).
The end mark is the LAST audible impact, which can be a floor bounce after
the winner, so end marks run 0.5 to 1.0 s later than a winner tap would.
Every scorecard below is therefore shown at the raw convention and with the
end marks pulled earlier by 0.5 and 1.0 s. Treat the marks as +/-0.5 s;
treat differences under five points as noise.

This is a lab measurement aid only. The 2026-08-19 closed door on audio as
a standalone production boundary signal stands.

### 2c. Which assembler is better on these two matches

Five outcomes, s60's scorecard, tolerance 0.6 s. All lab rows are built on
the cropped detections (2a), which is what production would have had with
the crop in place. "s71" is the end-on assembler with borrowed serves
(section 5).

**Long match, 86 points**

| cards | n | clean | clipped | fused | split | lost | head p50 | tail p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| production (stored, end-on on full frame) | 94 | 46 (53%) | 20 | 2 | 12 | 6 | +2.5 | +1.3 |
| lab full frame, end-on (reproduces production) | 94 | 46 (53%) | 20 | 2 | 12 | 6 | +2.5 | +1.3 |
| lab full frame, serve-anchored v2 (the other route) | 80 | 31 (36%) | 14 | 19 | 18 | 4 | +2.6 | +1.6 |
| lab full frame, end-on + serves (s71) | 94 | 46 (53%) | 19 | 2 | 12 | 7 | +2.5 | +1.3 |
| lab full frame at half rate, v2 | 83 | 31 (36%) | 21 | 9 | 16 | 9 | +2.7 | +1.7 |
| lab full frame at half rate, end-on | 89 | 40 (47%) | 25 | 0 | 13 | 8 | +2.9 | +0.8 |
| crop, serve-anchored v2 | 82 | 42 (49%) | 21 | 8 | 8 | 7 | +2.2 | +1.4 |
| crop, end-on | 103 | 55 (64%) | 12 | 2 | 13 | 4 | +2.2 | +1.4 |
| crop, end-on + serves (s71) | 104 | 55 (64%) | 11 | 2 | 14 | 4 | +2.2 | +1.4 |
| crop at half rate, v2 | 84 | 46 (53%) | 19 | 4 | 8 | 9 | +2.2 | +0.8 |
| crop at half rate, end-on | 100 | 52 (60%) | 14 | 2 | 13 | 5 | +2.5 | +1.2 |

End marks pulled earlier: at -0.5 s production 59%, v2 55%, end-on 70%,
s71 69%; at -1.0 s production 63%, v2 60%, end-on 71%, s71 70%.

**Short match, 53 points**

| cards | n | clean | clipped | fused | split | lost | head p50 | tail p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| production (stored, end-on on full frame) | 53 | 25 (47%) | 11 | 4 | 8 | 5 | +2.2 | +1.5 |
| lab full frame, end-on (reproduces production) | 53 | 25 (47%) | 11 | 4 | 8 | 5 | +2.2 | +1.5 |
| lab full frame, serve-anchored v2 (the other route) | 45 | 22 (42%) | 7 | 13 | 10 | 1 | +2.4 | +1.3 |
| lab full frame, end-on + serves (s71) | 53 | 25 (47%) | 11 | 4 | 8 | 5 | +2.2 | +1.5 |
| lab full frame at half rate, v2 | 44 | 20 (38%) | 12 | 13 | 5 | 3 | +2.3 | +0.7 |
| lab full frame at half rate, end-on | 46 | 24 (45%) | 7 | 4 | 7 | 11 | +2.4 | +1.3 |
| crop, serve-anchored v2 | 52 | 26 (49%) | 11 | 6 | 7 | 3 | +2.3 | +0.6 |
| crop, end-on | 58 | 34 (64%) | 4 | 6 | 7 | 2 | +1.9 | +1.7 |
| crop, end-on + serves (s71) | 58 | 34 (64%) | 5 | 6 | 7 | 1 | +1.9 | +1.7 |
| crop at half rate, v2 | 53 | 29 (55%) | 13 | 2 | 6 | 3 | +2.2 | +0.5 |
| crop at half rate, end-on | 56 | 31 (58%) | 5 | 6 | 9 | 2 | +2.1 | +1.5 |

End marks pulled earlier: at -0.5 s production 49%, v2 60%, end-on 68%,
s71 68%; at -1.0 s production 53%, v2 68%, end-on 66%, s71 66%.

Reading it:

- On the detections production actually had (full frame), the route it
  chose was the better one on both matches: end-on 53% against v2's 36%
  on the long match, where v2 fuses 19 of 86 points into cards holding
  two or more, and 47% against 42% on the short, where v2 fuses 13 of 53.
  Had the router sent either match serve-anchored, Anton would have
  received a worse cut than the one he complained about.
- With the serves restored by the crop, the end-on assembler still wins
  on the long match by 11 to 15 points at every convention, and on the
  short match by 15 at the raw convention and by 8 at -0.5 s; at -1.0 s
  the two tie. v2's deficit is clipped tails (its tail
  sits 0.6 to 1.1 s short of the end mark on eleven points of the short
  match, with 6 fused) and lost points (7 on the long match).
- The route production chose was the right one of the two. What made the
  cards unusable was the full-frame detection underneath both.
- Even so the crop alone would make the ROUTE worse: at 2.41 and 4.51
  serves per minute the shipped rule sends both matches to v2, which the
  measurement above puts at 49% clean on this booth against 64% for end-on.
  That is why section 4's rule carries a geometry veto.
- s71 equals end-on on clean% and gives 44 of 104 and 35 of 58 cards a
  serve, right to within 1.5 s of the audio serve mark on 35 of 44 and 30 of
  35 (section 5).

## 3. The router measured on every match in R2

Every match with a match.json in R2 was pulled (164). 77 carry a "points
v2" note, 62 of those a recorded route (the note gained the route and the
serves/min on the day the router shipped; 15 v2 matches predate it). Six
are 10-second test clips and are excluded. The camera of each of the
remaining 71 was judged by eye from one frame of its cut video: 47 side-on,
17 end-on, 7 oblique (corner camera, long axis diagonal). The full table is
`corpus-routes.md`.

"Active play" here is the stored cut segments, which in plays mode are the
per-point card windows; "serves per card" is serves over stored cards.
Both are what R2 holds for every match without re-running detection. For
the seventeen lab matches with real detections the exact features follow.

### 3a. Distributions by camera, stored corpus (71 matches)

| feature | side-on (47) | end-on (17) | oblique (7) |
|---|---|---|---|
| serves per VIDEO minute | min 0.00, p25 3.08, median 4.25, max 6.59 | min 0.00, median 0.53, max 1.48 | 1.31 to 1.86 |
| serves per minute of ACTIVE play (card time) | min 0.00, p25 4.62, median 6.24, max 8.97 | median 0.71, max 2.70 | 1.85 to 2.57 |
| serves per candidate point (per card) | min 0.00, p25 0.65, median 0.78, max 2.00 | median 0.13, max 0.34 | 0.19 to 0.39 |
| foreshortening | min 0.21, p25 0.54, median 0.68, max 2.17 | min 0.12, median 0.24, max 0.71 | 0.32 to 0.53 |

Three side-on matches sit at the bottom of every serve column and they
are all Anton's: 5c90151a (1.46 / 2.34 / 0.34), 5fd822ec (1.22 / 1.85 /
0.25) and d5ca61f8, his first-ever upload on 2026-08-24 (0 serves, vision
quad, foreshortening 0.21, also sent end-on). Every other side-on match is
at 2.11 serves per video minute or more, 2.71 per active minute or more,
0.47 per card or more; the closest is his own 47b83b9b (2.11 / 2.71 /
0.47), which went serve-anchored.

### 3b. Misroutes under the shipped rule (serves per video minute < 2.1)

Matches under 2.1 whose camera the per-active-minute rate or the camera
shape says is side-on:

| match | serves/video-min | serves/active-min | serves/card | foreshortening | camera by eye | verdict |
|---|---:|---:|---:|---:|---|---|
| 5c90151a Anton | 1.46 | 2.34 | 0.34 | 0.68 | side-on | misroute by camera; per-active-minute rate says end-on |
| 5fd822ec Anton | 1.22 | 1.85 | 0.25 | 0.49 | side-on | misroute by camera; per-active-minute rate says end-on |
| d5ca61f8 Anton | 0.00 | 0.00 | 0.00 | 0.21 | side-on | side-on camera, wrong quad, zero serves: nothing to anchor either way |
| c2129d22 mumtazjaat | 1.31 | 1.85 | 0.19 | 0.53 | oblique | foreshortening says side-on; the camera is a corner |
| 1c08539e timothycudjoe | 1.37 | 1.87 | 0.26 | 0.61 | end-on | foreshortening from a net-post quad; the camera is behind a player |
| 5b8a031d, 8c206597 (broadcast) | 0.00 | 0.00 | 0.00 | 0.49, 0.71 | end-on | zero serves; foreshortening from a wrong quad |

So: no match in R2 fell under 2.1 while its per-active-minute rate said
side-on. The per-active-minute rate tracks the per-video-minute rate on
every match (the maximum end-on value, 2.70, is a broadcast clip; the
minimum side-on value above Anton's three is 2.71). Camera shape flags six
matches, of which two are real (Anton's) and four are wrong quads or an
oblique camera. Adil's hypothesis is right in principle, wrong on this
corpus: nobody has yet been routed end-on for playing slowly, and the two
matches that prompted it were routed end-on for detecting few serves per
point.

### 3c. Exact features, seventeen lab matches with real detections

`s70_router.py`. dense = `E.ball_dense`; blind = share of dense time with
no crossing (s63's definition); table share = moving-ball bounces the
homography puts on the playing surface, over all moving-ball bounces
(the geometry-health signal of section 4); crossings per minute is
dwell-confirmed net crossings per video minute. Anton's rows use the
cropped detections.

| match | camera | min | serves | v2 cards | foresh | serves/video-min | serves/dense-min | serves/card-min | serves/card | dense share | blind | table share | crossings/min |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ishan_rc | side-on | 17.9 | 87 | 101 | 0.73 | 4.86 | 6.90 | 7.30 | 0.86 | 70% | 35% | 78% | 15.6 |
| ishan | side-on | 17.9 | 88 | 100 | 0.73 | 4.91 | 6.97 | 7.58 | 0.88 | 71% | 35% | 77% | 15.9 |
| prabhas_rc | side-on | 12.7 | 60 | 74 | 0.74 | 4.71 | 7.17 | 6.86 | 0.81 | 66% | 31% | 78% | 17.5 |
| kumar | side-on | 12.5 | 46 | 67 | 0.81 | 3.68 | 5.86 | 5.03 | 0.69 | 63% | 37% | 80% | 16.8 |
| chris_b | side-on | 11.4 | 43 | 59 | 1.00 | 3.76 | 7.45 | 5.46 | 0.73 | 50% | 15% | 83% | 17.5 |
| chris_rc | side-on | 7.9 | 40 | 41 | 1.39 | 5.05 | 13.64 | 8.59 | 0.98 | 37% | 7% | 83% | 18.2 |
| chris_a | side-on | 17.8 | 93 | 91 | 1.05 | 5.24 | 11.84 | 8.21 | 1.02 | 44% | 7% | 85% | 22.0 |
| julian_rc | side-on | 29.1 | 88 | 140 | 0.50 | 3.02 | 5.92 | 4.37 | 0.63 | 51% | 12% | 84% | 29.6 |
| julian_16 | side-on | 12.6 | 29 | 51 | 0.51 | 2.30 | 3.98 | 3.76 | 0.57 | 58% | 31% | 83% | 14.9 |
| gavin_16 | side-on | 39.5 | 64 | 127 | 0.33 | 1.62 | 2.73 | 2.71 | 0.50 | 59% | 48% | 78% | 15.6 |
| rowel | side-on | 15.9 | 82 | 85 | 0.46 | 5.17 | 10.27 | 8.12 | 0.96 | 50% | 20% | 82% | 22.3 |
| koko | end-on | 9.4 | 5 | 34 | 0.32 | 0.53 | 0.80 | 0.71 | 0.15 | 66% | 58% | 73% | 11.6 |
| terry | end-on | 12.9 | 4 | 29 | 0.25 | 0.31 | 0.50 | 0.56 | 0.14 | 63% | 68% | 60% | 10.3 |
| tripp_rc | end-on | 22.0 | 31 | 91 | 0.28 | 1.41 | 2.22 | 1.86 | 0.34 | 64% | 49% | 83% | 14.7 |
| anton_first (crop) | side-on, diamond quad | 8.7 | 31 | 37 | 0.74 | 3.58 | 7.96 | 5.76 | 0.84 | 45% | 14% | 53% | 34.4 |
| anton_long (crop) | side-on, diamond quad | 22.0 | 53 | 82 | 0.68 | 2.41 | 4.63 | 3.94 | 0.65 | 52% | 18% | 48% | 38.6 |
| anton_short (crop) | side-on, diamond quad | 10.6 | 48 | 52 | 0.49 | 4.51 | 9.62 | 7.12 | 0.92 | 47% | 14% | 42% | 35.7 |

Two things this table settles:

- **gavin_16 is the match the shipped rule gets wrong on the lab side.**
  Side-on, 1.62 serves per video minute (under 2.1), but 0.50 per card and
  2.73 per dense minute, both on the side-on side of the gap. Any
  serve-per-point rule keeps it on v2. It never went through the router
  in production (it predates it).
- **Anton's booth has a signature nothing else has.** Table share 42 to
  53% against 60 to 85% everywhere else (terry, the worst real camera, is
  60%), and 34 to 39 crossings per minute against 10 to 30. Both are the
  diamond: half the surface projects off the table, and the diagonal "net"
  fires on shots that never crossed it. This is what a router can read to
  know v2's geometry is untrustworthy before it builds a card.

### 3d. The cost matrix, refreshed today (s67, lab, his marks)

| match | camera | points | v2 clean | end-on clean |
|---|---|---:|---:|---:|
| ishan_rc | side-on | 71 | 93% | 66% |
| ishan | side-on | 53 | 83% | 57% |
| prabhas_rc | side-on | 50 | 98% | 82% |
| kumar | side-on | 41 | 98% | 93% |
| chris_b | side-on | 40 | 85% | 75% |
| chris_rc | side-on | 23 | 100% | 87% |
| koko | end-on | 45 | 44% | 76% |
| terry | end-on | 52 | 37% | 71% |
| tripp_rc | end-on | 102 | 46% | 75% |
| anton_long (crop) | side-on, diamond | 86 | 49% | 64% |
| anton_short (crop) | side-on, diamond | 53 | 49% | 64% |

Side-on total 278 points: v2 92%, end-on 74% (the handover measured 95%
and 76%; today's surface pad and merge settings account for the drift).
End-on total 199: v2 43%, end-on 74%. Anton's rows are audio-marked and
belong with the end-on rows on the decision, not the side-on ones.

## 4. The router: proposal

Three candidates were asked for. Measured on the stored corpus (3a, 3b)
and the lab table (3c):

| rule | corpus misroutes | lab misroutes | Anton after the crop |
|---|---|---|---|
| shipped: serves/video-min < 2.1 | 3 (Anton x3) | gavin_16 to end-on | both to v2 (49% vs 64%) |
| serves per ACTIVE minute < 3.0 | 4 (Anton x3, 47b83b9b) | tripp_rc at 1.86 vs gavin 2.71: holds | both to v2 |
| serves per candidate point < 0.42 | 3 (Anton x3) | none (gap 0.34 to 0.50) | both to v2 |
| two-signal: rate < 2.1 AND foreshortening < 0.40 | 4 (d5ca61f8; three end-on left on v2: 1c08539e and two broadcast clips) | none | both to v2 |
| serves per candidate point < 0.42 OR table share < 0.57 | 3 (Anton x3, all correctly end-on by the measurement) | none | both stay end-on (64%) |

"Corpus misroutes" counts Anton's three because the task's camera-based
definition counts them; section 2 shows the end-on route is the better
one for them, so the last row has no real misroute.

**Pick: serves per candidate point, with a geometry veto.**

```
serve_yield  = len(E.serves) / max(len(v2 cards), 1)      # v2 already ran
table_share  = len(E.bt_table) / max(len(E.bt), 1)         # already in E
wants_endon  = serve_yield < 0.42 or table_share < 0.57
```

- `serve_yield` replaces minutes of video with v2's own candidate points,
  which v2 has already built by the time the router runs (the call site in
  `points_pipeline.cmd_points` computes `v2_out` first). It is the measure
  the handover found separates clean% (+0.95) and it removes the pace
  conflation by construction. Threshold 0.42 sits in the middle of the gap
  between tripp_rc (0.34, the highest end-on) and gavin_16 (0.50, the
  lowest side-on) on the lab table; on the stored corpus the nearest
  values are 0.39 (an oblique corner camera, laibascaleforte's STAG video)
  and 0.47 (Anton's 47b83b9b). It reproduces today's route on every one of
  the 62 routed matches.
- `table_share` is the veto that keeps a match off v2 when the calibration
  is not the table. 0.57 sits between anton_first (53%) and terry (60%).
  Two thresholds, each drawn through a gap in seventeen matches: the same
  honesty caveat the current SERVE_RATE_MIN carries, and the same remedy,
  which is that both numbers are already computable from `E` and should be
  written into the match.json note beside the route so the next revision
  has more than seventeen.
- On the whole corpus with labels: every side-on corpus match stays on v2
  (yield 0.57 to 1.02, table share 77 to 85%; v2 83 to 100%), every bench
  match goes end-on (yield 0.14 to 0.34; end-on 71 to 76%), Anton's two go
  end-on with or without the crop (64% vs 49%), gavin_16 stays on v2.
  No side-on match with a real quad is sent end-on, no end-on match is
  left on v2.

Not chosen, and why: per-active-minute alone moves the threshold and fixes
nothing here (it sends 47b83b9b end-on and Anton's two to v2 after the
crop); the foreshortening two-signal rule trusts a number that on Anton's
booth measures a diamond, and it leaves 1c08539e (behind-the-player
camera, net-post quad reading 0.61) on the serve-anchored path where its
0.26 serves per card would give it the bench's 37 to 46%.

What ships with it, if Adil says yes: the two new numbers in the "points
v2" note; the s41 faithfulness pattern on the six corpus matches (route
unchanged, cards byte-identical); nothing in `app_config`.

## 5. The end-on assembler borrowing detected serves

`s71_endon_serves.py`; two changes to `worker/points_endon.py`.

1. **Serve contacts as boundary candidates.** `boundaries()` gains
   `E.serves` (minus a lead) alongside freeze valleys, prism exits and
   chain gaps. The Viterbi still decides; nothing forces a serve to open
   a card.
2. **Stamping.** After `V2.resolve`, each card gets `serve_s` = the first
   accepted contact inside `[t0, t1]`, else None. `serves_inside` is kept
   on the card for diagnosis (a card with two is a fusion candidate).

**Faithfulness.** With borrowing off, s71 reproduces `points_endon.
build_cards` to the tick on koko, terry and tripp_rc (identical card lists),
and reproduces the handover's held-out result:

| match | points | cards | clean | clipped | fused | split | lost | head p50 | tail p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| koko | 45 | 60 | 34 (76%) | 2 | 0 | 9 | 0 | +2.2 | +0.8 |
| terry | 52 | 74 | 37 (71%) | 5 | 2 | 8 | 0 | +1.9 | +1.9 |
| tripp_rc | 102 | 120 | 76 (75%) | 3 | 9 | 14 | 0 | +2.2 | +1.6 |
| total | 199 | | 147 (74%) | 10 | 11 | 31 | 0 | | |

**Serve candidates, leave-one-match-out.** The one new number, the lead
subtracted from the contact, was swept over 0.0, 0.3, 0.6 and 1.0 s on two
matches and scored on the third. Every fold chose 0.0. Held-out clean is
unchanged in every fold (koko 34/45, terry 37/52, tripp_rc 76/102; total
147/199, 74%, zero lost). The bench detects 5, 4 and 31 serves for 45, 52
and 102 points, so there is little to borrow there; the point of the
measurement is that borrowing costs nothing where the detector is blind.
On Anton's matches, where the detector finds 53 and 48 serves, s71 also
equals end-on on clean% (section 2c), with the long match's head moving
0.1 s earlier and one fewer lost point on the short one.

**Stamping precision** (a stamp is right when a marked serve lies within
0.8 s on the bench, 1.5 s on Anton's audio marks):

| where | cards stamped | right | with a 4.5 s cap on (contact - t0) |
|---|---:|---:|---:|
| bench (koko 5, terry 4, tripp_rc 26 stamped) | 35 of 254 | 17 (49%) | 13 of 22 (59%) |
| Anton long + short (crop) | 79 of 162 | 65 (82%) | 61 of 71 (86%) |

On an end-on camera half the detector's serves are mid-rally pairs and the
stamp inherits that; on a side-on camera the stamp is right four times in
five. Right stamps cluster at 2.2 s from t0 (the card's lead, when the
serve boundary was used) and inside 4 s; wrong ones spread to 9 s. A 4.5 s
cap (lead 2.2 + HEAD_LEAD 1.6 + slack) trades four right stamps for nine
fewer wrong ones on the bench and four for four on Anton. Recommended,
with the honesty note that it is one threshold on five matches.

**Port notes.** Mirror s71's `boundaries`, `segment` (verbatim body, wider
candidate set) and `stamp_serves` into `points_endon.py`; keep CONFIG
untouched; keep `serve_s` None wherever no contact lies in the card, so the
downstream contract in the docstring still holds; the call site already
copies `serve_s` into `v2_serves` for any card that has one, so placement
and the serve statistics start working on end-on cards with no further
change. Faithfulness check: s71 with `serve_lead=None` must equal the
shipped module to 0.000 s on the three bench matches before the port is
committed.

## 6. What to ship first, in plain words

Revised at the end of the day, after section 7.

1. **The end-on assembler borrowing serves (section 5).** Built on the
   branch `endon-serve-borrowing` the same day; faithfulness passed to
   0.000 s on the bench (lab s82) and the match.json diff is in its spec.
   Safe on the bench (same 74%, zero lost), ties for best on Anton's two
   matches, and gives his cards serves to place from. It changes nothing
   on the serve-anchored path except a trailing "N stamped" in the note.
   It does not change the clean rate anywhere; it is the pipe through
   which whatever the separate serve-detection work finds reaches end-on
   matches.
2. **The router (section 4) together with the crop for vision-calibrated
   matches (section 2).** One spec, `docs/superpowers/specs/2026-09-06-
   crop-any-calibration-and-per-point-router-design.md`, agreed and built
   the same evening (its "As built" section), because the crop
   alone flips Anton's booth to the assembler that measures 49% there.
   Serves per candidate point replaces serves per minute (dead time is 30
   to 63% of the video minutes on the lab matches and per-active-minute
   misroutes Tripp); the table-share veto is the part to argue about. On
   Anton's booth the pair takes the long match from 53% clean, 6 lost, 20
   clipped to 64%, 4 lost, 11 clipped, and the short from 47%, 5 lost to
   64%, 1 lost, on the audio marks.
3. **The crop on genuinely end-on cameras (section 7).** Decided and
   built the same evening (`points_endon.crop_allowed`): production had
   cropped keypoint-calibrated end-on matches since 2026-09-01 and the
   bench says that cost the end-on assembler three points and one rally in
   sixty-six. The remedy is to skip the crop when the quad's foreshortening
   is under 0.40
   (Westchester 0.25 to 0.32; every real side-on quad 0.46 to 1.39; the one
   diamond that reads under 0.40, gavin_16 at 0.33, would simply keep its
   pre-September behaviour). Seventeen quads; the 2026-09-01 crop corpus
   would need re-checking with the gate before it ships.
4. **The calibration bug.** The canonicaliser cannot express a table whose
   end line is nearly vertical in the picture, which is every true side
   view; a few pixels flip the left/right sort and both calibrators fall
   back to the net-post diamond. Its own research record, the 62-match
   calibration corpus behind it, and a product decision about which end is
   "near" on a side view. Highest ceiling on Anton's booth, least certain,
   most work.
5. **Ground truth.** Every end-on decision above rests on 199 points from
   one hall; the bench could not see the 20-point gap to Anton's booth. The
   corpus holds seven serve-blind matches with cards and no marks: Adil's
   two Westchester uploads of 2026-09-01 (2eab3e3d, f3237587), two of
   mumtazjaat's (c2129d22, 3901dea4), arungupta's 39-minute match
   (93a540ab), Tim's (1c08539e) and Anton's two. Marks on five of those,
   by hand or by the audio method with spot checks where the room is
   quiet, are what make items 2 to 4 trustworthy outside Westchester.

## Closed doors and caveats from this session

- Audio-derived marks are a lab measurement aid, verified on eight sampled
  points; they are not a production signal and do not reopen the 2026-08-19
  door.
- Camera shape (foreshortening, the stored length axis, the activity
  gate's axis) is not a usable router input on this corpus: it inherits
  the calibrator's net-post quads on at least nine matches, and separates
  end-on from side-on only where the quad is right.
- A hand-marked true quad for Anton's booth cannot be tested until the
  canonicaliser can express a camera beyond the table's end.
- anton_first is a knock-up and is not scored anywhere above.
- The lab's full-frame detections of Anton's matches reproduce production
  exactly (section 2a); every scored row says which detections it used.
- Anton's first upload of the day (66c0d904) was processed with the crop
  never applied either; its 22 serves became 31 with the crop. It went
  serve-anchored at 2.54 per minute. Its cards are not scored because it
  is a knock-up.

## 7. The crop on the end-on bench

Measured last, because it was the audit's highest-leverage hypothesis:
the bench (koko, terry, tripp_rc) was built in August, before the crop
existed, on full-frame detections; 18%, 41% and 28% of its top-1
detections fall outside the box production would use today. The handover
named the tracker following neighbouring tables 67 to 84% of the time as
the foundation problem on end-on cameras and scoped a multi-chain tracker
at weeks. The crop removes those tables from the picture for free. If it
helped the end-on assembler, it would have been the finding of the day.

`s81_bench_crop.py`: production's own crop (`ball_crop_box` from the
stored keypoint quad, ffmpeg crop, `blurball_infer`, positions shifted
back), the same motion signal as the bench, prism exits from the new
track exactly as `cmd_points` does, scored against Adil's marks with s60's
five outcomes at 0.6 s.

| match | points | detections | serves | end-on clean | clipped | fused | split | lost | v2 clean | v2 lost |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| koko | 45 | full frame | 5 | 34 (76%) | 2 | 0 | 9 | 0 | 44% | 3 |
| koko | 45 | crop | 13 | 35 (78%) | 1 | 4 | 5 | 0 | 56% | 1 |
| terry | 52 | full frame | 4 | 37 (71%) | 5 | 2 | 8 | 0 | 37% | 13 |
| terry | 52 | crop | 7 | 36 (69%) | 4 | 4 | 5 | 3 | 56% | 5 |
| tripp_rc | 102 | full frame | 31 | 76 (75%) | 3 | 9 | 14 | 0 | 46% | 4 |
| tripp_rc | 102 | crop | 49 | 70 (69%) | 9 | 17 | 6 | 0 | 55% | 0 |
| total | 199 | full frame | 40 | 147 (74%) | 10 | 11 | 31 | 0 | 43% | 20 |
| total | 199 | crop | 69 | 141 (71%) | 14 | 25 | 16 | 3 | 55% | 6 |

Reading it:

- Serves rise on every match and the serve-anchored assembler gains
  twelve points, which is what the crop was built and measured for on
  2026-09-01. Even so the end-on assembler stays the better one on every
  bench match under either detection (78 vs 56, 69 vs 56, 69 vs 55).
- The end-on assembler LOSES three points and three rallies. Splits halve
  (31 to 16) and fusions more than double (11 to 25): with the neighbour
  balls gone and the ball found in two frames of three, the dead time
  between points reads as play more often, so two points become one
  card. Terry's three lost rallies are short points (about 3 s) during
  which 69 of 79, 36 of 59 and 65 of 68 full-frame detections lie
  outside the box, to its left and right.
- Production has been applying this crop to keypoint-calibrated end-on
  matches since 2026-09-01. Adil's two Westchester uploads of that day
  (2eab3e3d, f3237587; keypoints, route end-on) were processed on cropped
  detections. Expected from the bench: three points of clean and one
  rally in sixty-six. Not measured on them; they carry no marks.
- The crop is therefore serve-detector medicine, not end-on medicine, and
  section 6 is ordered accordingly. The one place it lifts the end-on
  assembler is Anton's booth (53 to 64%), which is a side view whose
  ball was two pixels across on the full frame, not an end-on camera.

Serve borrowing (s71) on the cropped bench: 73%, 69%, 67%, so it does
not rescue the crop either; the extra serves the crop finds on an end-on
camera are the mid-rally kind.

## 8. The second pass, end to end, on Anton's short match

`s84_second_pass.py`, against the build on branch `endon-serve-borrowing`:
a workdir set up the way the job flow leaves it after a full-frame
detection and a vision calibration (the stored quad, replayed through
`--calibration-json`), then `worker.rerun_points_on_vision_crop` called
exactly as the job flow calls it. Real ffmpeg crop, real BlurBall on the
crop, real points command.

| pass | detections | serves | cards | serves/card | table share | route | stamped |
|---|---|---:|---:|---:|---:|---|---:|
| 1 | full frame (no table) | 13 | 53 | 0.29 | 0.76 | end-on, on the yield | 10 |
| 2 | crop 930x524 at (616,132), corners from the vision quad | 47 | 58 | 0.94 | 0.42 | end-on, on the veto | 30 |

The second pass reused the first pass's calibration (the ladder did not
run), kept the first pass at `points_out.fullframe`, and wrote both
sentences into match.json: `detections: crop 930x524 at (616,132), corners
from job, second pass` and `calibration reused from the first pass
(vision)`. Two things to read off it: the table share is 0.76 on the
full-frame detections and 0.42 on the cropped ones, so the veto is a
statement about the geometry as the serve-anchored assembler would see it
after the crop, which is when the router runs; and the yield rule alone
would have sent this match serve-anchored at 0.94, which is the 49%
against 64% the veto exists for. (The two passes show different surface
pad and merge values only because the lab script passed the module
defaults to one and the worker's defaults to the other; in production
both passes get the same `app_config` values.)

## 9. The four uploads of the day, through the merged code

Lab replay of the whole worker flow on the branch (`s85_reprocess.py`,
scored by `s86_report.py`): the crop decision `detect_ball` now makes, the
points stage on the detections that decision implies, then
`second_pass_wanted` and, where it says yes, the points stage again on
detections cropped from the vision table with the first pass's calibration
handed back. app_config's live values (surface pad 0.45, merge 2.5 s) on
every run. Ball detections come from the lab cache, which was cut with the
same box and reproduces production's stored numbers exactly; the script
compares the box it would cut against the box the cache was cut with and
refuses if they differ. Clips and placement skipped. Nothing in production
was reprocessed.

| match | route | serves | cards | stamped | clean | lost | kept |
|---|---|---:|---:|---:|---:|---:|---:|
| 5c90151a (22 min) production | end-on | 32 | 94 | 0 | 46 (53%) | 6 | 70% |
| 5c90151a first detection | end-on | 32 | 94 | 23 | 46 (53%) | 7 | 69% |
| 5c90151a after the second detection | end-on | 53 | 104 | 38 | 55 (64%) | 4 | 77% |
| 5fd822ec (10.6 min) production | end-on | 13 | 53 | 0 | 25 (47%) | 5 | 75% |
| 5fd822ec first detection | end-on | 13 | 53 | 10 | 25 (47%) | 5 | 75% |
| 5fd822ec after the second detection | end-on | 48 | 58 | 33 | 34 (64%) | 1 | 81% |
| 1c08539e (Tim, 10.9 min) production | end-on | 15 | 57 | 0 | not scored | | 84% |
| 1c08539e new code | end-on | 15 | 59 | 7 | not scored | | 84% |

Scored against the audio marks of section 2b (86 and 53 points, tolerance
0.6 s). Anton's two land exactly where section 2c predicted from the
cards alone: 64% clean on both.

Reading it:

- **The second detection is what moves the cut.** With the same detections
  production had, the new code scores the same 53% and 47%; the crop cut
  from the vision table is what takes both to 64%. On the long match it
  costs one lost point at the first-detection stage (6 to 7) and then
  recovers to 4; on the short match lost falls from 5 to 1. Two points on
  the long match and four on the short go from having no card at all to
  having one, and no point that had a card loses it.
- **The veto is doing the work on the route.** After the crop, serves per
  point are 0.65 and 0.92, well over the 0.42 threshold; both matches stay
  end-on only because the table share falls to 0.48 and 0.42. Without the
  veto the crop would have moved both to the serve-anchored assembler,
  which section 2c measures at 49% on this booth.
- **The serve dots are usable on this camera.** 38 of 104 and 33 of 58
  cards carry a serve, and 87% and 85% of those sit within 1.5 s of a
  serve the microphone heard.
- **Tim's match barely moves, and that is correct.** His table is found by
  the free rung at shape 0.61, so the crop applied before and applies now;
  the detections are identical and the route is unchanged. The only
  difference is two more cards and seven serve stamps. His venue has eight
  tables in view and 2007 audio impacts that merge into five spans of up
  to 251 s, so the microphone cannot mark his points and this match has no
  accuracy number.
- **The keypoint rung declines Anton's booth on every frame** (0 usable of
  16 on both matches, reproduced here), which is what sends him down the
  vision path and is why the second pass exists.

The review page for these four (tables, and the video with the card lanes
to play them against) is generated by `s87_page.py`.
