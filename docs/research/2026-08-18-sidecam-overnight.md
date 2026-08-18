# Overnight: boundary signals for the fixed side-on camera

2026-08-18, run while Adil slept, per his brief: the Westchester camera
cannot move, ever — point boundaries must come from software. Probe the
prism-exit idea against every boundary he has tapped, probe the pre-serve
freeze, probe pose, build him a scoring bench, and fuse whatever survives
into a first boundary voter. Ground rule: read the existing research
first and re-try nothing that already failed (the 2026-08-11 study closed
absolute-threshold window classification for audio, pose and temporal
context; everything below is boundary TIMING with per-match
normalisation, which is the failure mode's complement).

Scripts: TTVid/recall-lab s49–s52. Truth: the 278 double-tapped points on
six good-camera matches, plus the seams he split by hand on Koko/Terry.

---

## What's ready for him this morning

**The scoring bench** is live on /research/fullmatch: B marks a serve
start, the arrows call the winner (and the end), E ends without a call,
U undoes, comma/period nudge 0.15s. Marks save to `fullmatch_labels`
(121) in the processed video's clock and draw on the timeline. This
exists because the side-on matches are too badly cut to score in the app,
and every mark he makes is training data on exactly the geometry being
solved.

## Probe verdicts, one line each

| Probe | Verdict |
| --- | --- |
| Prism-exit as point end | Real but partial: covers 46% of endings at median −0.85s from his tap; the bounce baseline covers 99%. A voter feature, not a rule. |
| Extended prism (player zones) | Wrong shape for exits (coverage drops to 23%) but the right shape for motion-gating; the two prisms have different jobs. |
| Netted-ball endings | His pre-sleep caveat held: the "died inside" class exists; my detector for it found 0 because post-point pickup keeps in-prism samples alive. Needs a rest-detector, not a presence test. |
| Pre-serve freeze | Real class-level signal: median z −0.58 pre-serve vs +0.87 mid-rally, and stiller than generic dead time (−0.06). All 5 Koko seams show a freeze valley. Standalone detector: too noisy (9–72% per match). |
| Crouch via apparent height | A whisper: −0.20 pre-serve vs +0.25 mid-rally, heavy overlap at 0.5s sampling. Full-skeleton pose (rtmpose venv located, healthy) deferred to voter v2. |
| Boundary voter v0 | Leave-one-match-out: 44% of all 556 tapped boundaries found, ~4.5 false candidates/min. Applied blind to Koko: 3 of 5 hand-split seams hit within ~1s. |

## Details that will matter later

- **Prism-exit timing**: exit lands median 0.85s BEFORE the winner tap
  (p10 −1.75, p90 +1.65); 43% within a second. Mid-point "final-looking"
  exits: 0.10/point — the clipping risk if ever used as a hard rule.
- **Freeze contrast** (per-match z of summed end-zone motion, s5's
  zones): pre-serve −0.58 / retrieval −0.08 / deep dead −0.06 /
  mid-rally +0.87. The freeze is distinguishable from the rally
  trivially, from retrieval only weakly (63/37 split at the joint
  median) — as the 2026-08-11 study's 1.42-vs-4.77 pooled numbers
  already implied.
- **Voter weights**: "time to next crossing" dominates (−0.41) — the
  strongest boundary tell is that play is about to resume — then
  since-cross and dense. Freeze added little (+0.03) once crossing
  features were present; the signals overlap more than they complement.
- **Voter evaluation is candidate-based** (local maxima ≥0.5, one per
  2.5s, hit = within 1s of a tap), not tick AUC, because ticks flatter.

## What I did NOT do

- No production changes. The prism motion-gate remains reverted per his
  instruction; nothing here ships until he says so.
- No multi-chain tracker yet — it stays the deep foundation. Scope
  sketch: keep every candidate chain alive in parallel (the four
  stored candidates per frame), score chains by prism residency +
  crossing production + ballistic smoothness, emit the best chain per
  window with pauses instead of thefts. Measured the usual way; the
  reseed-bias shortcut already failed (loses 3 corpus points), so the
  real version is the only version.
- No far-side serve asymmetry work (he deprioritised it).

## The v1 plan, once his labels exist

1. He scores Koko and Terry on the bench (serve starts AND ends).
2. Voter v1 trains WITH side-camera labels and richer features
   (bidirectional windows, audio tick recency, per-side motion), and the
   card assembler learns to consume voter boundaries where serves are
   missing — split a fallback card at any voter peak above a confidence
   floor, never delete on one.
3. Full-skeleton stance features from the rtmpose venv as the next
   feature family, at 2–3fps around candidate boundaries only (cheap).
4. Multi-chain tracker in parallel: it raises every signal's floor.
