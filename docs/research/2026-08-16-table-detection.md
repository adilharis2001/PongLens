# Table detection, measured against ground truth for the first time

Adil marked the true corners on 62 production matches through
`/research/table-calibration`. This is the first time any table calibration
has been compared against a trusted answer. Everything below is measured
against those marks.

Error is the median corner distance as a percentage of the frame diagonal,
after trying all four cyclic alignments so a naming difference is not read
as an error. **1% of a 1080p diagonal is about 22px.** "Gross" means the
median corner is more than 5% out, roughly 110px, which is a quad that is
not on the table.

## 1. The deterministic detector and the vision models are complementary

| Venue | deterministic | | Luna | |
|---|---|---|---|---|
| | median | gross | median | gross |
| LYTTC | **0.5%** | **1/14** | 4.7% | 4/15 |
| PingPod | 7.6% | 11/15 | **0.0%** | **2/14** |
| Westchester | 6.1% | 8/13 | **2.1%** | **0/13** |
| unlabelled | 0.6% | 0/6 | 1.7% | 2/6 |
| **All** | 3.5% | 20/50 (40%) | 2.4% | 8/52 (15%) |

Sol ran only where Luna failed consensus: 7 samples, median 0.0%, 0 gross.

**The deterministic detector is not broadly broken. It is excellent at LYTTC
and bad at PingPod, and the vision models are the other way round.**

## 2. Why, exactly

The detector keys on a hard-coded HSV window — hue 130-179 or 0-10,
saturation ≥50, value ≥80 — at `points_pipeline.py:1035`, then takes the
convex hull of the surviving components.

PingPod's rims *are* magenta. So are the PINGPOD wall signage, the neon, the
barrier banners and every neighbouring table. Colour cannot separate them,
so the hull swells across the room. That is the 5bd279f4 failure: a quad
spanning the hall, latched onto wall banners, shipped as
`placement_status = 'ready'` with 135 mapped points on it.

LYTTC works because the only magenta in that hall is on the table.

**The failure is not "pink does not generalise". It is that colour alone
cannot reject same-coloured things that are not tables.** Generalising the
colour without fixing that would make PingPod worse, not better, because a
learned colour has the same blindness with a wider net.

## 3. What Adil's verdicts were actually judging

Adil reported PingPod accurate and LYTTC poor. The page shows Luna's
consensus as the prominent green quad, so those verdicts track *Luna*, and
they match it closely: Luna is 0.0% at PingPod and 4.7% at LYTTC.

His impression was right about what he was shown. It is the opposite of the
deterministic detector's behaviour, which is why "the detector is
consistently wrong" and "the detector is our best component at LYTTC" are
both true.

## 4. Three things tried, three negative results

### 4a. The known table ratio, as a score — works in aggregate, too noisy per quad

An ITTF table is 2.740 x 1.525 m, ratio 1.7967. Zhang & He (2006) recover a
rectangle's aspect from its four image corners alone, with no calibration.

Recovered ratios: **Adil's marks median 1.79**, deterministic 1.78, Luna
0.93. The physics is sound and the ground truth confirms it.

But as a per-quad gate it is unusable. It is ill-conditioned on near
fronto-parallel views, so even Adil's own marks only land in a generous
1.55-2.10 band 71% of the time. Gating on it:

| Gate | catches bad | loses good |
|---|---|---|
| production, >0.35 | 4/12 | 8/25 |
| luna, >0.35 | 4/4 | 21/33 |

Throwing away a third of good quads to catch a third of bad ones is not a
trade worth making.

### 4b. A colour-free line detector — fails to find the table at all

Built `detect_v2`: Canny → probabilistic Hough → two vanishing points by
RANSAC → quads from line intersections → scored on shape, interior
uniformity and white-line support. No colour constant anywhere.

Result on 62 frames: **median error 21.5%, 59/62 gross.** Worse than
everything it was meant to replace.

The oracle test says why. Taking the *best* candidate in each frame's set
rather than the top-scored one:

- candidates per frame: median 20
- top-1 pick: median 21.5%, good (<3%) on 1/62
- **best in set: median 13.1%, good on only 14/62**

**The right quad is usually not in the candidate set at all.** This is a
candidate-generation failure, not a ranking failure, so better scoring —
including ball evidence — would not rescue it. Hough finds the barriers, the
floor seams and the neighbouring tables; the table's own far edge is faint
and often loses.

### 4c. Corner ordering — not the problem

Luna's ratios looked bimodal around 0.55 and 1.80, which would be the
signature of corners named in the wrong cyclic order. Testing all four
rotations, no single rotation improves the population and the best rotation
is scattered evenly. Luna's quads are the wrong shape, not the wrong
labelling.

## 5. What I would do instead

**Do not replace the detector, and do not generalise its colour yet.** The
evidence does not support either. What the numbers do support:

**(a) Run both and arbitrate.** They fail in different places and neither
fails often at the same venue. An arbiter that picks correctly would land
near 1% median with a handful of gross failures, better than either alone.

**(b) The arbiter should be ball evidence, not geometry.** This is the one
signal not yet tested, and it is the one thing that distinguishes a table
from an identically-coloured banner: the ball bounces on the table and
nowhere else. The pipeline already computes it (`gate_core`,
`_projection_support`) and my line detector drowned in false rectangles
precisely because it threw that away. Concretely: project detections through
each candidate quad, and score on bounce density inside versus outside, plus
symmetry about the net line. A wall banner scores zero.

**(c) Re-run the deterministic detector's *selection* step, not its colour.**
Its components are probably right at PingPod; the hull is what swells. Ball
evidence at the component level would keep the rim and drop the banner.

**Why this and not more model work:** Sol is 0/7 gross and Luna 15% gross, so
the vision path is already the better of the two and it costs money per
match. The deterministic path is free and already the best component at one
venue. Fixing selection is cheaper than either optimising prompts or paying
Sol everywhere.

## 6. Caveats

- 62 matches, one frame each, drawn from 5 venues and heavily weighted to
  one owner's uploads.
- The frame is the median of 24 samples, so it is what the model saw but is
  blurrier than a real frame; Adil marked corners on that same composite,
  with no zoom, so his marks carry their own placement error. Treat
  differences under about 1% (~22px) as noise.
- `detect_v2` was written from geometric priors and inspection of three
  frames. It was scored against the marks only after the blind run, and was
  never tuned against them.
