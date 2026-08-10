# Dead space: full research review and the next round (2026-08-09)

Prompted by two matches scored today (Jacky `617a2067`, Bradley `f5a5ef16`)
where the cut kept too much between points and too much inside them.

Every number here is read from code, queried read-only from prod
(`pdycinmyfnritemrsfjf`), or measured against the shipped construction.
Where something is unmeasured it says so.

---

## The headline

**Serve detection is the right long-term lever but the wrong next step, and
the reason is measurable.** The 77 human serve-contact labels sitting unused
in `research_assignments` say `t0` is already EARLIER than the serve:

    contact minus t0, n=77, five matches, per-job pre-roll handled
    min -0.167   p25 +0.324   median +0.647   p75 +1.642
    p95 +4.424   max +12.099  mean +1.323     5 of 77 before t0

`t0` is not late. It is early, and sometimes very early: the p95 point opens
4.4s before the serve is struck, because `activity_spans` fires on pre-serve
ball handling. On top of that we add a flat 2.5s pre-pad. So the clip head
opens a median **3.15s before the serve it exists to protect**.

A better serve detector cannot recover that. A smaller number can.

## Where the boundary actually comes from

One learned model runs in the cut path: BlurBall (`worker.py:79`,
1920x1080 downscaled to 512x288, 3-frame windows). Everything after it is a
threshold on that single (x, y) track:

- `activity_spans` (`points_pipeline.py:505-545`) - 0.5s bins, a bin is
  active at >= 4 frames whose ball step exceeds `8.0 * width/1920` px, runs
  bridge exactly one dead bin.
- `split_plays` (`:809-885`) - the same rule again inside each span.
- `play_edge_windows` (`:185-200`) - folds `CLIP_PADS = (2.5, 2.0)` into
  every window, plus `serve_head_start` (cap 6.0s) and `rally_tail_end`
  (cap 2.5s), both of which also walk over **ball** motion.

So `t0`/`t1` are quantised to 0.5s and mean "the ball started or stopped
moving fast", never "the serve started" or "the point ended". No pose, no
audio, no serve model, no learned temporal model touches the boundary.

**The boundary primitive has not changed since 2026-07-20.** `STRICTNESS`
"normal" is literally `TTVid/pipeline/cut_deadspace.py`'s PRE/POST/MERGE
constants. Rounds 1 through 5 all spent their budget padding a boundary they
could not move.

## What broke on Jacky and Bradley

|                        | Bradley `f5a5ef16` | Jacky `617a2067` |
|------------------------|-------------------:|-----------------:|
| source                 |            837.58s |          872.00s |
| cut                    |  765.66s (**91.4%**) | 725.53s (**83.2%**) |
| points emitted         |                 89 |               83 |
| deleted by the owner   |     **42 (47.2%)** |   **33 (39.8%)** |
| point windows sum      |    462.72s (55.3%) |  368.33s (42.2%) |
| BlurBall detection     |  **53.2%** (worst in log) |          73.7% |
| table calibration      |             FAILED |           FAILED |

Recall was perfect. Both scores reconstruct exactly from confirmed winners
(Bradley 11-4, 11-5, 11-3; Jacky 6-11, 6-11, 4-11) with zero leftover points
and `edited` false on every row. **No point was missed.** This was a
precision collapse, not a recall failure.

Root cause chain, verified in `worker.log:9712` and `:9877`:

1. Table calibration failed on both, so `H = None` and `roi = None`.
2. `split_plays` therefore ran with no spatial constraint. Bradley's activity
   gate degenerated to (461, 1920, 0, 768), touching three frame edges, so
   the in-gate veto dropped only 10 of 101 plays (16 of 99 on Jacky).
3. Every false window still carries 4.8s of pad, and `SEGMENT_MERGE_S = 0.5`
   glues neighbours: Bradley's 101 windows collapsed to 23 segments, median
   26.8s, max 85.9s.
4. `cut_segments` is built from the PRE-veto play list
   (`points_pipeline.py:1667`, veto at `:1693`), so nothing the pipeline
   rejects and nothing the owner deletes ever leaves the video.

Cut composition: real rally kept 39.4% / 35.4%, false-positive rally
21.0% / 15.4%, pure dead time from pads, walks and merges 39.6% / 49.2%.

**The pad floor also makes gaps uncuttable.** Two windows cannot separate
unless the gap exceeds `2.5 + 2.0 + 0.15 + 0.15 + 0.5 = 5.30s`. Median
inter-point gap is 3.71s (Bradley) and 4.26s (Jacky), so 64 of 88 and 47 of
82 gaps are unremovable at any strictness.

## The research inheritance, and the graveyard

| Approach | Where | Verdict |
|---|---|---|
| Audio impacts as a veto | `DEADSPACE-ROUND-2026-07-29.md:33` | Dead. Toss-overs bounce loudly (conf 27); 89 of 143 kept points have `audio_max 0` at real rally frames. Production passes `audio_impacts=[]`. |
| Pose serve motion for dead space | same, `:58-85` | Dead. Serve AUC 0.626 vs 0.823 for a plain ball fast-run. Tossing a stray ball back is mechanically the same event as a serve toss. |
| Crop / zoom | same, `:87-125` | Dead. Ball uses 47-72% of frame width during kept points, capping safe zoom at ~1.15x; recall collapsed to 50.9-72.1%. |
| RTMPose match structure | `worker.py:86-88` | Shipped 2026-07-29, disabled 2026-07-30. 0 of 36 matches ready. Hard-raises without calibration. |
| `service_motion` v2 | `service_motion.py:449` | Best built: 94.1% precision at 40.5% coverage with an oracle bounce anchor, 88.9% at 21.4% automatic. 0 of 8 on the multi-table match. Research only. |
| `PairedServeGRU` | `temporal_serve_model.py` | Failed. Best dev loss 0.6877 against a chance floor of ln2 = 0.6931; train loss 0.028 while dev climbed to 1.88. |

TTVid measured the same disease: rally segmentation over-extends past the
true point end by median 1.41s, and automatic last-contact detection is off
by median 1548 ms with 0 of 18 within 100 ms. Its one robust positive is that
audio recovered 24 of 27 contacts BlurBall missed (91.5% vs 42.6% recall).
Its one robust negative, found four times independently, is that ball and
timing context beat acoustics on every semantic task, and fusing acoustics in
never beat context alone.

**Measured today: the existing serve detector is nowhere near anchor-grade.**
Against the same 77 labels it emitted a contact time on only 17 of 100 points
and overlaps a human label on 5, median absolute error 0.432s, p90 0.678s,
64 of 100 flagged `needs_review`.

## What does not exist

- **No boundary-error metric anywhere.** Nothing measures seconds between an
  emitted `t0` and a true serve contact. That is the single reason five
  rounds have not converged.
- `eval/validate_play_cut.py:76-84` asserts `pa == pb` and exits 1 on any
  `t0`/`t1` drift, so the referee fails by construction against any change
  worth making.
- The round-5c sweep that chose 2.5/2.0 was never committed.
- 77 `cut_labels`, all on one match, and **the clips they graded were re-cut
  in place by round 5c**, so that artifact no longer exists.
- No production `blurball.jsonl` is kept: `worker.py:4638` does
  `shutil.rmtree(workdir)` in a `finally`. Re-deriving one costs a full
  ~445s inference pass.

## Recommendations

Ranked by gain over effort times risk. Losing a serve is far worse than
keeping three extra seconds, so every boundary change below fails safe
toward more context and is gated on a review pass.

### This week

**1. `CLIP_PADS` pre from 2.5s to 1.5s, and cap the serve-head walk to match.**
Zero of 77 labelled serves are clipped at 1.5s; the minimum lead is 1.333s
against a maximum measured service motion of 0.889s (onset-to-contact
measured at 0.623-0.889s, median 0.729s, n=5). Round 5c jumped 0.6 to 2.5
with nothing in between measured, and derived "serves start 2-2.5s before
t0" by eye from 22 flagged points on one match. Simulated gain: Bradley
88.8% to 84.7%, Jacky 75.8% to 70.9%, about 1.0s off every clip head.
Ship only after re-cutting 30 heads and confirming none opens after the toss
begins. Fallback 2.0s still saves 0.5s per point.

**2. Stop losing the corpus (irreversible, has a deadline).**
10 raws are already deleted, including Faye and Patricia, which are the
round-1 and round-3 ground truth and 31 of the 77 serve labels. 16 more
expire within 14 days, first on 2026-08-21. Also upload `blurball.jsonl.gz`
beside `match.json` (about 8 lines in `run_points_stage`) so no future sweep
needs a 445s re-inference.

**3. Build `worker/eval/score_cut.py` and retire the parity gate.**
One command over a frozen manifest: recall, precision, retention, dead-time
survival, uncuttable-gap census, head error against the 77 labels, tail error
against the uncensored `scored_at_cut_s` subset, plus a degradation row
(calibration ok, detection rate). Acceptance test: reproduce Bradley 91.41%
/ 47.2%, Jacky 83.20% / 39.8%, `d4593f8a` 72.28% / 0%.

**4. Persist the per-frame signals we already pay for.**
`OnlineTrackerBlur.update` returns `{x, y, angle, length, visi, score}`;
`blurball_infer.py:162-167` writes only `{f, x, y, conf}`. Blur length is a
per-frame speed proxy that does not depend on frame-to-frame association,
which is exactly what fragments at multi-table venues. Five lines, no new
compute, but it must land before the corpus pass or that pass repeats.

### Multi-week

**5. Move `cut_segments` below the vetoes.** Worth up to 21.9s (Bradley),
64.8s (Jacky), 148.7s (Thanakorn m2). This is the one change that can make
the product worse rather than merely fail to improve it: a wrongly vetoed
rally would vanish from the video. Gate on a footage-level metric, and
re-tune `MIN_INGATE_FAST = 12`, whose 40% safety margin was chosen when a
false veto cost nothing.

**6. Attack precision with the ball track before adding any sensor.**
Every FP veto rejected in rounds 1-3 was a global hard threshold, and the
stated failure was cross-match scale. There is no normalisation of any kind
in `points_pipeline.py` today. Do the one-day experiment first: frame-level
rally-vs-not AUC per feature, with and without per-match percentile
normalisation, on the two multi-table matches. If normalisation does not
compress the cross-match spread, stop.

**7. Colour-independent table calibration.** 15 failures against 27 successes
in the log, and the last five logged attempts all failed. We only detect a
JOOLA pink rim. This is now the modal failure, not an LYTTC quirk.

**8. Then the tail pad.** The uncensored `scored_at_cut_s` labels say `t1`
already sits a median 0.72-0.91s past the decision, but they are a biased
subset and round 5c measured 9 of 70 endings clipped at 0.9s post. Measure
before moving.

## What not to do

- Do not build a per-point serve anchor yet. `points` has no pad column,
  `effectivePad` is two-valued, nine consumers derive `rallyEnd` from a
  match-level pad, and `process_reclip` would silently revert any anchored
  point on the first Adjust. The prize over a measured flat pad is ~0.6s.
- Do not retrain or scale `PairedServeGRU`. It is at chance.
- Do not re-enable RTMPose as the `t0` anchor: it hard-raises without
  calibration, which failed on both bad matches.
- Do not give audio a veto or an endpoint decision. Killed twice with
  numbers. Soft evidence inside a decoder that cannot fire alone is the
  untested framing; a hard rule is not.
- Do not re-propose crop, zoom, or a bigger BlurBall input.
- Do not plan work against the 77 `cut_labels`: round 5c destroyed the clips
  they grade.
- Do not adopt a 98% recall target. We hold >= 99% and it is 100% on both
  bad matches. That constraint is exactly what rejected every FP veto ever
  built.

## The third-party proposal, audited

| Element | Verdict |
|---|---|
| Detect positive rally evidence, not dead play | ALREADY-BUILT. That is `activity_spans` since 2026-07-20. |
| Table calibration per video | ALREADY-BUILT, and since round 4 it runs before the cut. |
| Manual 4-corner fallback | WRONG-FOR-US. Upload-and-walk-away product; no corner UI exists. |
| Colour-independent calibration | VALID-AND-NEW. This is the real gap. |
| Near/far player crops | VALID-AND-NEW as a stream. Our crop failure cropped the frame and re-ran the BALL detector, so it does not apply. But the pose test that did probe player evidence lost to the ball on a semantic confound, and `build_player_regions` raises without calibration. |
| Audio impact candidates | ALREADY-FAILED as a judge; VALID-AND-NEW as soft evidence in a decoder. |
| 7-class sound-role taxonomy | WRONG-FOR-US. The easier 3-class version measured 64.5% balanced accuracy, 57.1% terminal recall. |
| Four-state temporal decoder | VALID-AND-NEW and our biggest architectural gap, but MISCOSTED: two of four states have zero supervision and the emission is one (x, y) at 53-74% coverage. |
| Per-video adaptive weighting | WRONG-FOR-US at 36 matches. The cheap 5%: we already compute calibration success and detection rate and change nothing based on either. |
| Metric suite | VALID-AND-NEW, priority inverted. Boundary error genuinely does not exist. But its 98% recall target would RELAX the >= 99% we already hold. |
| Ball tracking last | WRONG-FOR-US. BlurBall is sunk, MIT-licensed, running, and beat acoustics on every held-out task TTVid measured. |
| 30-50 matches, split by venue | ALREADY-BUILT (36 matches, 2,524 points, 5 venues). It misses that those are keep/delete verdicts on windows the detector already proposed, so they cannot teach where a rally starts. |
| Merge under 2s, keep dead regions over 4-6s | WRONG-FOR-US. Would raise the 5.30s uncuttable floor above the median inter-point gap. |

Where it is genuinely ahead of us: the metric suite, and the temporal state
decoder. Its instinct to split train and test by venue is also right.

## The paid labelling question

The platform already exists: `research_batches` / `research_sources` /
`research_assignments` / `research_gold_labels` / `research_reviewers`, with
`duplicate_group` and `is_repeat` for agreement, `review_metrics` and
per-assignment timing, and gold adjudication. Five batches, one complete
(`serve-detection-cross-match-v1`, 100/100).

**Do not sign a contract yet, for one reason: we have never used the 77
labels we already own.** They alone justify recommendation 1. Buying
thousands more before extracting value from 77 is premature, and the
historical failure mode here is abandonment rather than error
(`fused-labeling-pilot-v1` 0 of 30 submitted, `temporal-serve-results` 8 of
100). A paid external labeler does fix abandonment, which is the real
argument for Adil's proposal.

If it goes ahead, the target is the **rally end**, which has zero labels
anywhere in either repo, and the ask is small: about 1,000 items, roughly 19
labeler-hours, $400-600. Three timestamps per existing point clip (toss
release, serve contact, last paddle contact), keyboard-driven, snapping
contact and last-contact to audio peaks but never the toss. Seed 60 of the
existing 77 into the queue as hidden gold, which is free QC.

**The binding constraint is footage, not labels.** One user owns 29 of 36
matches and 78.6% of points; two venues hold 73% of them. Every negative
result in this project is a cross-venue transfer failure. A thousand points
from these two clubs is worth less than three hundred from ten. Buy
recordings before labels.

## Open questions

1. Does a 1.5s clip head feel right? The evidence says no labelled serve is
   clipped. Thirty re-cut heads settles the feel.
2. The Keep-score auto-pause freezes 0.6s past `t1`, censoring 109 of 195
   rally-end labels. Extending it uncensors them permanently at the cost of a
   longer freeze on most points.
3. Fewer cards to delete, or a shorter video? Item 1 is a week, item 6 is a
   month.
4. Ten Westchester raws were deleted on 2026-07-29, seven days after upload,
   not by the 30-day sweep. What removed them?
5. Perfect point selection with zero pad still retains 36.0% (Bradley) and
   29.4% (Jacky). Reaching 25-30% means shrinking the rally windows
   themselves, which is a separate problem from padding.
