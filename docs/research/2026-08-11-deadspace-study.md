# Dead-space study — 2026-08-11

Everything run on 2026-08-10/11 against the goal of removing dead points
between rallies without losing real ones. Written so a future run can start
from the conclusions instead of repeating the work. The per-stage analyses
are copied verbatim into `2026-08-11-deadspace-assets/` — the scratchpad
they were produced in does not survive the session.

**One-line verdict: window-level scoring of mid-match junk is exhausted.
Four independent feature families (ball track, audio rhythm, player pose,
temporal context) all show real pooled signal and none of it transfers to a
held-out scene at a 99% kept-recall floor. Best defensible number: 4.6% of
mid-match junk removed. The usable salvage is a pre-selection model and a
data audit; the recommended direction is a serve detector.**

---

## 1. Problem framing

Junk = points the pipeline emitted that the owner deleted while scoring.
Scope for every headline number here: **mid-match junk only** — junk starting
at or after the first kept point of its match. Pre-match faff (players
settling who serves, delays before the match starts) is explicitly out of
scope: the owner can sweep it with one tap in the UI, and it is *not*
warm-up rallies, so no detector should be aimed at it.

Operating standard for auto-delete: keep >= 99% of real points on the
**worst** held-out scene, not the average. Everything below is measured
against that floor unless stated.

Label budget at study time: ~31 matches, 550 junk / ~2,500 kept, four-ish
venues (see §6 — the venue column lies).

### The three kinds of dead space (established earlier, still the map)

1. **Kind 1** — neighbouring-table activity leaking in. Fixed by the
   activity gate; not revisited.
2. **Kind 2** — own-table ball handling (retrieval, pre-serve bouncing)
   emitted as points. This study's target.
3. **Kind 3** — dead time *inside* kept points before the serve: 88s/match,
   29.4% of kept footage. Untouched by everything here; needs a serve
   detector.

### Where mid-match junk actually sits (456 junk, 30 matches)

Measured before the audio study, deduplication changes details but not shape:

| time since previous real point | share |
|---|---|
| under 2s | 21.7% |
| 2–5s | 34.2% |
| 5–10s | 20.0% |
| 10–30s | 16.0% |
| over 30s | 8.1% |

Median 4.0s both to the previous and to the next real point. **~76% of junk
sits within 10s of real play** — it is ball retrieval woven into the match,
not breaks. Game breaks are dense (4.4 junk per long hole vs 0.3 for short
gaps) but rare: 13 long holes across 30 matches hold only 57/456 junk.

---

## 2. Experiments run, in order, with results

### 2.1 Ball-track features (the kind2 study) — NEGATIVE, definitive

1,039 windows, 11 matches, 16 features (ball speed, span, bounce counts,
gate-fast fractions, homography projections, …), raw + rank-within-match,
singles and pairs, leave-one-venue-out at the 99% floor.

- Best single feature: 13.3% cut at 94.3% recall — fails the floor.
- Best honest pair at the floor: ~8% at 99.1%.
- Percentile-normalisation hypothesis: dead. Many "surviving" pairs were
  **degenerate** — identical cut % across different pairs means one
  threshold parked at an extreme, i.e. a single-feature rule in disguise.
  This artefact recurs in every later stage; check for it always.

### 2.2 Floor hypothesis (ball below table) — FALSIFIED twice

- Image-space: junk balls are *not* below the table; they sit higher than
  rally balls in 8/11 matches. Dead.
- Homography/metric space: real pooled signal (on-table 40.3% real vs 24.2%
  junk) but reverses sign on Jason and Yilin. Same cross-venue wall.

### 2.3 Rhythm holes / game-break detection — CEILING, then premise collapse

- 31.6% of mid-match junk falls in "holes" (gaps between kept points > 3x
  the match's median gap) — highly variable per match (Yilin 94%, Bradley 5%).
- High-precision "certainly a rally" anchors do not exist in these features:
  the best candidate collapsed to 89.5% precision catching 4.9% of rallies
  on the held-out venue.
- Simulation with a **perfect** anchor detector: the design caps at
  12.5% (45s holes) / 20.4% (30s holes) of mid-match junk at 0% real loss,
  and degrades fast below 90% anchor recall.
- The audio study then undercut the premise itself: after deduplication,
  **242 of 300 mid-junk runs are singletons** (mean run length 1.39). Junk
  mostly does not cluster. Do not reopen break detection.

### 2.4 Serve-onset predictors from ball motion — NEGATIVE

Nine predictors over ball and player motion for finding the serve moment
inside kept points: all fail; every recovered second clips some serves.
`t0` remains the safest anchor (0/47 owner-labelled serves clipped). The 47
serve-start taps on the Kumar match (B-key admin button, migration 089) are
seed labels for a future trained detector.

### 2.5 Audio rhythm (2026-08-11 workflow, 69 agents) — GATE FAILED at 4.6%

The one family with a physics argument (bounce-decay intervals follow the
coefficient of restitution; rally rhythm is ~0.3–0.4s steady). Prior art:
the TTVid audio-usefulness study (2026-07-27) had already shown onsets are a
**high-recall clock** (91.5% contact recall, far mic, AC noise) but a poor
semantic judge — this study asked it the timing-shaped question.

Method: all ~31 junk-bearing matches downloaded from R2 (raws carry 48kHz
AAC; 30-day retention meant 3 fell back to the cut video), in-house
spectral-flux onset detector (2–12kHz, k=6.5, `onset_cfg.json` from TTVid),
12 rhythm features per labelled window (IOI regularity, decay-slope fit,
silence fraction, within-match strength percentiles, ±10s context rates),
leave-one-**scene**-out over 11 acoustic scenes.

| candidate | floor met | junk cut | worst recall |
|---|---|---|---|
| rank `ioi_cv` (the headline) | >=99% | **4.6%** | 99.07% |
| raw pair `rhythmicity & max_gap_frac` | >=97% | 12.3% | 97.22% |
| raw `ioi_cv` alone | >=97% | 11.8% | 98.06% |

~12% at a 97% floor is the real ceiling there (two unrelated feature sets
land on it). The 99% floor is dominated by small scenes: one scene has 53
kept windows, so a single lost point costs 1.9% recall. Full table and the
degenerate-pair audit: `2026-08-11-deadspace-assets/analysis_audio.md`.

**Fusion bright spot:** on the 906 windows that also have ball features,
audio+ball reaches **17.5% at 98.51%** — best worst-scene recall in the
study, modalities genuinely complementary (+8.4pts over ball, +3.2 over
audio). Subset-sized, still under the floor: a direction signal only.

### 2.6 Pose occupancy (dormant RTMPose install) — GATE FAILED, adds nothing

Extracted COCO-17 skeletons at 3fps inside labelled windows using the
dormant `rtmpose-production` venv (production flag untouched). Features:
bilateral occupancy, persons near table, torso pitch, wrist speed, lateral
energy. Pooled signal is real — max wrist speed is higher on kept windows in
**25 of 26 matches** — but thresholds calibrated on ten scenes misfire on
the eleventh. Combined audio+pose: 4.9%, and the winning rule used **no
pose features**. Consistent with the 2026-07-30 match-structure revert:
pose on this footage does not cross-generalise.
Found in passing: `jason_5bd2`'s calibration quad is off the table despite
`calibration.ok = true` (see `check_kumar_frame.jpg` and `quads_all.jpg` in
assets for what good and bad quads look like).

### 2.7 Temporal context and smoothing — EXACTLY ZERO

Time-since-last-confident-rally, rolling score means, hysteresis. Every
floor-passing "context pair" was bit-identical to the plain audio rule.
Hysteresis lost 3 kept windows (2 stranded between junk runs — the one
unaffordable error class) for a 2.1% cut. Root causes: junk runs are
singletons (§2.3), and 106 kept windows have junk on both sides, so
neighbour-scoring attacks exactly them.

---

## 3. The data audit (the most consequential finding)

Scene grouping by acoustic fingerprint (24-band room-tone spectrum) instead
of the venue column, because the 2026-07-22/23 upload batch defaulted its
venue to "Westchester TTC" (`played_at == created_at` marks the defaulted
rows). Findings:

1. **Duplicate uploads with conflicting labels.** `vinay_2ffe` ==
   `vinay_5721` (identical 1442.17s footage, byte-different files): junk
   labels disagree on 17 of 150 windows. `chris_45b3` == `chris_d2b5` ==
   `jason_9a81` (same 335.34s footage, one names a different opponent):
   disagree on 3–5 of 27. **The same owner re-scoring the same footage
   flips ~10% of junk decisions.** That is the label-noise floor; a
   99%-recall auto-delete chases precision the labels do not contain.
2. **Wrong venues:** `vaibhav_9bd8` and `vinay_0411` (both "Westchester",
   defaulted era) sit acoustically on confident PingPod matches; `m_4481`
   (null) is PingPod. Unresolved: `may_1466`/`patricia_98be`/`vaibhab_fd5c`
   and `nathan_cff8`/`patrick_e009` form their own scenes.
3. The fingerprint separates acoustic classes, not venues (known cross-venue
   collisions ~0.005–0.007); venue-coherence needed cannot-link constraints
   on confident labels. Cosmetic: one row stores "Pingpod".

**Standing methodology rule from this: hold out scenes (fingerprint
clusters), never venue strings, and dedupe uploads before any study.**

---

## 4. What is usable in production today

- **Pre-marked cards (shippable).** Pooled out-of-fold logistic on the
  audio features, thresholded to catch half the junk: **47.7% precision at
  50.1% junk recall** (2.9x over the 16.3% base rate). Worst-scene kept
  recall at that point is 67.2%, so strictly "pre-mark for one-tap
  confirmation", never auto-delete. Pose and temporal add nothing to it;
  it ships from audio alone.
- **Nothing else.** No auto-delete rule cleared, or came near, its gate.

Shipped separately during the same period (already in production, listed so
the future reader has the full picture): clip-pad overlap fix (83% → 27% of
consecutive pairs overlapping), faststart + 2s GOP re-cuts (4.1x less decode
per seek), vision table calibration fallback (Kumar 49 → 36 junk at 100%
recall — calibration quality genuinely reduces emitted junk).

---

## 5. Lessons a future run must not relearn

1. **The recurring failure signature** is always the same: strong pooled
   separation, no cross-scene transfer. Ball (16 features), audio (12),
   pose (5), context — four families now. Any proposal whose mechanism is
   "threshold a per-window statistic" should be presumed dead on arrival.
2. **Check for degenerate winners**: identical cut % across supposedly
   different feature pairs = one threshold at an extreme. Appeared in both
   the ball and audio sweeps.
3. **The 99% floor is currently a coin flip on small scenes** (one window =
   1.9% recall). More scored matches per scene — especially confirmed
   non-PingPod — are worth more than any modelling.
4. **Label noise >= ~10%** on junk decisions (duplicate-upload evidence).
   Either clean labels or design targets that tolerate noise.
5. Cut-source fallbacks (expired raws) have broken context windows at clip
   joins and behave as mild outliers; handle explicitly.
6. Licensing constraints (verified 2026-08-11): OpenPose and madmom models
   are non-commercial; Ultralytics YOLO is AGPL; Essentia is AGPL+NC.
   Clear: RTMPose/MMPose (Apache-2.0, already installed), MediaPipe
   (Apache-2.0), V-JEPA 2 (MIT since v2), librosa (ISC), scipy, own code.
7. Prior in-house work worth reading first: TTVid
   `scoring-lab/audio-usefulness/out/findings.md` (audio = high-recall
   clock, weak judge), `docs/operations/rtmpose-match-structure.md`
   (pose rollout reverted 2026-07-30).

## 6. Recommended next steps, in order

1. **Data fixes**: dedupe the duplicate uploads, correct the defaulted-era
   venue labels (`vaibhav_9bd8`, `vinay_0411`, `m_4481` at minimum).
2. **Ship pre-marked cards** if the quality-of-life win is wanted — audio
   logistic only, human always confirms.
3. **Build the serve detector.** The one direction left with a
   mechanism-level reason to generalise: recognise the motif that starts a
   real point instead of scoring windows by their surroundings. It attacks
   Kind 3 (29.4% of kept footage) *and* gives mid-match junk a "no serve
   found inside" test. Seed labels: the 47 serve-start taps; the B-key
   labeler can mint more cheaply.
4. Stop all window-threshold work (see §5.1).

## Addendum (same day): fixed-rule pocket mining — NEGATIVE, closes the loophole

Follow-up question from Adil: do simple cross-family conjunctions exist —
e.g. "window under 4s AND no audio -> almost always junk"? Fixed round
thresholds have no fitting step, so they cannot fail cross-scene transfer;
this was the one form the sweeps had not mined. Script: `pockets.py`
(scratchpad, logic preserved here).

- The example rule is inverted: `dur<4s & zero onsets` catches 2 junk and
  kills 4 real points. All looser variants are worse (46 junk / 23 real at
  `<=2 onsets`).
- Why: junk IS short (median 2.5s vs 4.7s; 75% under 4s) but NOT silent
  (median 6 onsets — retrieval is noisy), while 35% of kept points are also
  under 4s (serve winners, quick errors) and a few are genuinely silent.
- **527 fixed conjunctions** over duration, silence, onset counts, rhythm
  irregularity, decay signature, loudness and context, with hindsight over
  all deduplicated mid-match windows (1,998 kept / 389 junk): **zero
  pockets with 0 kept casualties and >= 8 junk.** Even cherry-picking with
  the answer key cannot find a clean pocket.

This upgrades §5.1 from "fitted thresholds do not transfer" to "junk and
kept windows genuinely interleave in everything measured about a window's
appearance and sound". The separating information is what *happened* (a
serve started a point) — the serve-detector direction, §6.3.

## Addendum 2 (same day): net-crossing events — THE POCKET EXISTS

Adil's observation that much mid-match junk is a serve HANDOVER (lobbing the
ball to the new server, often never crossing low over the table) prompted an
event-level test the window statistics could never see: count genuine net
crossings per window (homography-projected track, dwell >= 2 detections per
side, lateral table bounds, no teleports). Scripts: `crossings.py` /
`crossings2.py` (assets).

Pooled over 9 matches with calibration: 0 crossings = 70.5% junk share,
3+ crossings = 3.5%. The 59 "kept points with zero crossings" concentrate in
matches with broken quads (yilin 26% of KEPT points measure zero crossings,
bradley 19% — physically impossible, so the quad is lying; jason's quad was
already known-bad). On the two healthy-measurement matches (chris_8e17
auto-quad, kumar_a0f7 vision-calibrated):

**50/57 junk caught, 0/76 kept harmed.**

Key properties: a lobbed handover arcs high and projects off-table, so it
never counts as a low crossing — the measurement is "did a ball travel low
over the net like a shot". And measurement health is self-diagnosing without
labels: real points must cross, so a match where many points measure zero
crossings indicts its own quad — a deployable per-match gate.

This refines the pocket-mining conclusion: no clean pocket exists in window
STATISTICS, but event-level geometry holds one, gated on calibration health.
Caveat: two healthy matches, 57 junk — a pocket to validate, not a proven
rule. Next: vision-calibration backfill on unhealthy matches, then re-run
over all 31.

Also rediscovered: the temporal serve experiment (2026-07-31 plan) RAN and
published held-out results on 2026-08-01 (`serve-detection-temporal-results-v1`
research batch; worker/temporal_serve_*.py, trained checkpoint, score-rotation
truth). It predicts serve SIDE with a conservative withhold-when-unsure
fusion. Its extractor/model/fusion bones are the starting point for a
"did a serve happen at all" detector, which is an easier question.

## Addendum 3 (same day): crossing-rule validation at scale — DO NOT SHIP

The full validation workflow (40 agents, ~2.2h: calibration backfill,
BlurBall backfill, label-blind health gate, struck-vs-lobbed extension;
artifacts `findings2.md` / `evaluation.md` in assets) killed the pocket:

- **Pilot reproduced exactly** (chris+kumar: 50/57 junk, 0/76 kept) and the
  vision backfill genuinely worked (healthy matches 3 -> 9). But at scale:
  22 matches evaluated, best label-blind gate passes 12, and on those the
  rule harms **62/1088 kept points (5.7%)**. Even a label-ORACLE healthy
  gate (unusable in prod) leaves 5/563 kept harmed (0.89%): real points with
  50-80 in-bounds detections where the measured track never crosses —
  crossing RECALL failures, not junk.
- **No label-blind gate exists.** Structural, not a tuning miss: the
  longest-points statistic punishes junk-heavy healthy matches (kumar, the
  pilot star, FAILS its own gate at 0.837 because its genuine junk sits in
  the long half) while matches broken only on short windows pass. Five
  alternative statistics fail the same way. The harm lives in short, sparse
  windows — exactly the rule's operating regime — so no per-match statistic
  can certify safety.
- **Struck-vs-lobbed is unusable at these venues**: onset rates of
  96-169/min make a random 0.45s window contain an onset with p=0.52-0.72,
  so 78% of junk crossings are "time-locked" by coincidence. The extension
  killed 22 kept for 10 junk.
- Parameter sweep (27 dwell/margin/teleport combos): the negative is
  measurement-driven, not parameter-driven. Six untracked matches deferred.

Lesson to carry forward: the zero-casualty auto-delete standard fails not
on discrimination but on **measurement recall** — the track+quad pipeline
misses real crossings in short windows.

**Sequential gating also tested and failed** (`crossexp/sequential_gate.py`,
Adil's negative-control idea): certify a match from the user's own first N
scored points, then apply the rule to the tail. Best config (16 clean kept)
still harms 4.1% of tail kept — julian_19a1 is spotless for its first 16
kept points then bleeds 12 casualties. Within-match health is not
stationary; that is the sixth and final gate to fail. Note the oracle
number itself (5/563 = 0.89%) PASSES the program's 99% floor — the blocker
was never the rate, it is that no deployable gate reaches that population.

**The upgraded shippable item:** ungated, as a PRE-MARK signal (wrong flag
= one glance, not a lost point), the zero-crossing rule flags **71.0% of
junk at 55.9% precision** (238/335 junk, 188/1624 kept flagged) across all
22 matches — better than the audio logistic (50% at 47.7%) on both axes,
and a different signal, so combining raises coverage further. Pre-marked
cards should be built on crossings first, audio second.

## Artifacts

- `2026-08-11-deadspace-assets/findings.md` — the workflow's own report.
- `2026-08-11-deadspace-assets/analysis_audio.md` — scene audit + full
  audio sweep (the most detailed of the three).
- `2026-08-11-deadspace-assets/analysis_pose.md`, `analysis_temporal.md`.
- `2026-08-11-deadspace-assets/quads_all.jpg` — calibration quads across
  matches (jason_5bd2's defect visible).
- `2026-08-11-deadspace-assets/check_kumar_frame.jpg` — pose extraction
  sanity frame.
- Ephemeral (scratchpad, gone after the session): raw onsets, features
  JSONs, videos, the workflow scripts. Everything needed to re-derive them
  is described above; labels come from the points table, audio from R2.

Run mechanics for the record: single background workflow, 69 agents, ~86
minutes, ~3.2M subagent tokens. Production untouched throughout — DB
SELECT-only, no worker or app changes, no flags flipped.
