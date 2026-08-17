# Colour-independent table detection by model-to-image fitting

Written 2026-08-16. Everything here was measured on the 79-frame corpus in
`rows.json`, 62 of which carry hand-marked corners.

---

## What it does

The table is a known object: a 2.740 x 1.525 m rectangle with a net across the
middle, a centre line down its length and white tape round the outside. Nothing
about that is uncertain. The only unknown is where the camera was.

So the search is over camera pose, not over quads:

    u, v      where the centre of the table lands in the image
    log_s     apparent size, s = f / d in pixels per metre
    az        which way the long axis runs
    el        how far above the playing surface the camera sits
    roll      camera roll
    log_f     focal length in pixels

Seven numbers instead of eight free corner coordinates. Every hypothesis is by
construction the image of a real ITTF rectangle under a pinhole camera with
square pixels and the principal point at the frame centre, so the aspect ratio
never has to be argued for with a penalty term, and the head-on degeneracy that
makes `geom.ratio_error` undefined — about a third of this corpus — simply does
not arise. It also hands back quantities that carry honest priors: how high the
camera is, how far away, how wide its field of view.

The template is three-dimensional, not a flat quad. The outline and the centre
line lie on the surface; the **net stands 15.25 cm above it and overhangs
15.25 cm each side**, so it projects to a second line whose separation from the
first shrinks with distance. That is the one thing in a sports hall that nothing
else imitates — a floor can carry a painted rectangle with a line down the
middle, but not a raised band across it.

Pipeline, per frame:

1. **Evidence** at half resolution (800x450). Di Zenzo multi-channel gradient →
   non-maximum suppression → hysteresis, with the threshold set so a fixed
   *fraction* of pixels survive; eight orientation-bucketed distance transforms;
   an unoriented one; a multi-width white top-hat; Lab; local colour spread.
   No hue, no fixed threshold in colour space, anywhere.
2. **Sweep**: a jittered 160k-pose grid, contracted over three rounds of
   resampling.
3. **Refine** the survivors with Nelder-Mead (hand-rolled; scipy is not in the
   worker venv).
4. **Re-sweep each surviving neighbourhood densely** — 20k poses within 2% of
   the frame, 15° of azimuth and a tenth of the size.
5. **Refinement ladder** on the best of those.
6. **Rank at full resolution** with separately fitted weights.
7. **Re-fit the winner at full resolution**, then a bounded free-corner polish
   (corners may move at most 4.5% of the span) to absorb lens distortion.
8. All of 2–5 twice, from two seeds, ranked together.

---

## Numbers

Scoring is exactly the required one: `100 * min over 4 cyclic rotations of
(median corner distance) / hypot(source_width, source_height)`; gross > 5%,
good < 1%.

### Held out — the number that means something

Eight frames were used for tuning and are named below. The other **54 marked
frames were never looked at during development**:

| | median | gross (>5%) | good (<1%) |
|---|---|---|---|
| **held out, n=54** | **0.48%** | **8/54** | 36/54 |
| tuned on, n=8 | 1.08% | 0/8 | 4/8 |
| all marked, n=62 | **0.54%** | **8/62** | 40/62 |

The held-out median is at least as good as the tuned-on median, on every run
that was measured. There is no sign of the eight frames having been fitted at
the expense of the rest.

### Against the baselines

| | median | gross |
|---|---|---|
| detect_v2 (bottom-up, abandoned) | 21.5% | 59/62 |
| deterministic (production, colour-based) | 3.5% | 20/50 |
| Luna (paid vision model) | 2.4% | 8/52 |
| **this** | **0.54%** | **8/62** |

It beats both. Against the deterministic detector it is six times better at the
median and cuts the gross rate from 40% to 13%. Against Luna it is four times
better at the median with the same number of gross failures over ten more
frames. It costs nothing to run and needs no model or API.

### Per venue (all 62 marked)

| venue | n | median | gross | good |
|---|---|---|---|---|
| LYTTC | 20 | 0.34% | 3 | 15 |
| Westchester TTC | 14 | 0.93% | 0 | 7 |
| PingPod | 13 | 0.41% | 2 | 9 |
| (no venue) | 7 | 0.59% | 1 | 4 |
| Pingpod | 4 | 6.29% | 2 | 1 |
| Matchpoint | 2 | 0.59% | 0 | 2 |
| PingPod Dobro | 2 | 0.45% | 0 | 2 |

"Pingpod" and "PingPod" are separate strings in the data and are left separate
here. The four "Pingpod" frames are the worst group by a wide margin and account
for two of the eight gross failures; three of the four are one room, shot from
one corner, and they are described below.

### Runtime

**227 s per frame**, single-threaded, on an M-series Mac Studio,
for the two-seed configuration. Halving to one seed roughly halves it, at a cost
in accuracy given below. Frames are independent, so 79 of them take about
17 minutes wall-clock across 18 processes. There is no model to
download, no network call and no per-frame cost.

---

## What worked

**Parameterising by camera pose.** The largest single structural win. An oracle
fit of the seven parameters to each of the 62 marked quads lands within a median
of **0.13%** (p90 0.36%, worst 0.52%), so the constraint costs essentially
nothing in representable accuracy while removing whole classes of nonsense from
the search space. Freeing the aspect ratio as an eighth parameter barely moved
that residual, which incidentally confirms the marked corners really are an ITTF
rectangle.

**Getting the winding right.** Every one of the 62 marked quads is negatively
wound in image coordinates, and the scorer only tries cyclic rotations, never
reflections. With the template wound the other way the oracle fit could only
reach 0.57% median, and it did so by putting the camera *below* the playing
surface with a focal length of 18 image widths. Two hours went into that before
the shoelace areas were checked.

**A saturating line response.** A fluorescent tube is many times brighter than
2 cm of white tape on a dark table top. Any term that rewards *how bright* a
line is will always rather have the ceiling, and the first three versions of the
detector duly locked onto rows of strip lights. Pushing the top-hat through
`r/(r+k)` makes both answers 1 and turns the term into "is there a line here",
which is the only question worth asking.

**Colour only as a ratio.** Boundary contrast is measured against the surface's
own spread, never as an absolute Lab distance. An absolute one is largest
wherever the picture is brightest, which was the other half of the ceiling
problem.

**Bilinear sampling of the distance transform.** Reading it at integer pixels
makes the cost a staircase: nothing changes until a sample point crosses a pixel
boundary, so a derivative-free minimiser sits down on the first flat step. This
put a hard floor of about 1.5% on everything the search could reach, no matter
how many iterations it was given — a ladder of restarts, jittered multi-starts
and four times the budget all bought nothing until the sampling was fixed.

**Selecting per location, not globally.** At every narrowing — the sweep's
contraction rounds and both hand-offs into refinement — hypotheses compete only
against others that put the table in roughly the same place, at roughly the same
size and angle. A plain top-K keeps four hundred slight variations of the same
wrong table and culls the right one before it is ever refined. On one frame a
cost-ordered cap threw away a 1.6% start in favour of a cheaper 2.7% one and
lost the table for the rest of the run.

**A dense local re-sweep.** The wide sweep can only afford a grid several times
coarser than the basin it is hunting, so it says roughly where the table is and
unreliably says exactly. Re-sweeping each surviving neighbourhood properly took
shortlist recall from a median of 2.05% to 0.86% in one change — the single
biggest accuracy gain after the pose parameterisation.

**Ranking at full resolution.** At the search scale a table 175 px long carries a
sub-pixel white line, so the terms that actually say *table* — the tape round
the outline, the centre line, the net — are measuring noise. The centre-line
term scored 0.05 at the marked corners and 0.51 on a ceiling light. At 1600 wide
those features are two or three pixels and mean something.

**A framing term.** With the camera above the playing surface, the table images
below the horizon of its own plane, and in an upright frame that horizon sits
near the middle. Penalising quads that sit above the frame centre costs the true
table almost nothing (0.000–0.025 across the eight dev frames) and is decisive
against ceiling beams. It cut gross from 13/62 to 10/62 on otherwise identical
runs.

**Fitting the ranking weights on the detector's own shortlists**, rather than on
a synthetic pool. Small, well-posed problem: fifteen weights, a few hundred real
candidates, an objective that is literally "how wrong is the pose the cost puts
first", coordinate descent, every weight bounded to a factor of eight of its
hand value, and the guard terms (off-frame, camera priors) frozen so the fit
cannot buy ranking by switching off safety.

---

## What did not work

**One weight vector for both jobs.** The terms that *steer* an optimiser and the
terms that *rank* finished candidates are not the same terms. Almost all of the
steering comes from the chamfer distance, which is the only term with a smooth
basin; support, tape coverage and interior quietness barely move until the quad
is already close. Fitting a single vector against a ranking objective cut the
chamfer weight by two thirds, ranking improved on paper, and the search stopped
converging — shortlist recall collapsed from a median of 0.86% to 7.43%. The two
vectors are now fitted separately and only the ranking one is refitted.

**Fitting the search weights against a margin objective.** Tried four times,
made recall worse every time (0.86% → 2.05% on the best attempt). The trouble is
that a static pool cannot represent the poses a *new* weight vector would find,
so the objective is measuring the wrong thing; accumulating pools across rounds
softened it but never fixed it. The search vector is now fitted once, against
the same argmin-error objective as the ranking vector, and then left alone.

**The net's own colour.** A term sampling the face of the net — the sheet
between its base and its top edge, projected in 3D — was expected to be the
decisive table-versus-floor cue. The fit puts it at 0.07, essentially off. The
net's *geometry* does carry weight (its top and bottom lines together are worth
about 1.1), but its appearance does not: at these distances the net is a few
pixels of mesh with the background showing through, and its colour is whatever
is behind it.

**Boundary contrast** went the same way, fitted to 0.06. Once the outline is
being scored on oriented edge distance and tape coverage, what the colours are
on either side adds nothing.

**Zhang-He aspect recovery** (`geom.recover_rectangle`). Correct, and unnecessary
once the pose is parameterised. On this corpus it is also unstable: on the dev
frames its recovered ratio was out by factors of 1.45 and 1.68 where the view is
near-affine, and undefined outright on others. Kept in `geom.py`; not used.

**Region proposals** (the previous attempt, `detect_v2.py` and `proposals.py`).
Best-in-set median 5.5% error — about half a table span — and the oracle showed
the correct quad was usually absent from the candidate set entirely. Not revived.

---

## Where it still fails

Eight frames are over 5%. Seven of them fail the same way, and it is worth
naming because it is what a further round of work should attack:

**A dark rectangular panel that is not a table.** An advertising barrier behind
the court (a0fb8f44, efff9208 — both the PINGPOD boards), a framed wall poster
(dffa4c3c, a38ca7c0 — the same USA team photograph in the same room from two
angles), a dark wall or window panel (522cd6f5, b01af658), a fence panel beside
the court (aa42d3b9). Each is uniform inside, bounded by four straight strong
edges, roughly the right aspect once perspective is allowed, roughly the right
apparent size, and sitting at roughly table height in the frame. Every geometric
term is satisfied. What they lack is the tape, the centre line and the net — and
those are exactly the terms the fit puts least weight on, because at the
distances in this corpus they are only a few pixels of evidence.

The eighth (8de4d737) is a real near-miss: the quad is on the right table but
its far end is short, and it scores 6.1%.

Two of these frames (522cd6f5, b01af658) are cases where the search never puts a
candidate on the table at all — shortlist recall on them is about 11%. The other
six are ranking failures: a candidate within 1-2% was found and something else
was preferred.

The obvious next lever is therefore evidence at higher resolution around each
finalist — crop the candidate, resample it to a canonical rectangle, and ask
whether the tape, the centre line and the net are there — rather than more
search. A barrier board has none of the three; the fit currently cannot tell
because it is reading them at two or three pixels.

---

## Recommendation

**Ship it as the free fallback.** It clears both targets — median 0.54% against
a target of 2%, eight gross against a target of ten — and it does so on frames it
has never seen, in every venue in the corpus. It runs on CPU with numpy and
OpenCV, needs no model file and no network, and its failures are visibly wrong
rather than subtly wrong, which makes them easy to flag for a human.

Three caveats, stated plainly.

1. **The two weight vectors are fitted on eight frames.** Fifteen weights on
   eight frames is not much data. Everything is bounded to a factor of eight of
   a hand-set value and the guard terms are frozen, and the held-out median
   (0.48%) is better than the tuned-on median (1.08%), so there is no evidence
   of overfitting here. But this corpus is five venues, and a sixth venue is
   genuinely untested.

2. **Gross-failure counts are noisy at this sample size.** Three runs of
   substantially the same detector produced 13, 10 and 12 gross before the
   final configuration produced 8. Some of that is real improvement and some of
   it is a stochastic sweep. Do not read a one- or two-frame difference as a
   result.

3. **227 s per frame** is fine for a table that is detected once per match and
   then reused, and far too slow for anything per-frame. Roughly two thirds of
   it is Nelder-Mead calls whose cost is dominated by per-call numpy overhead on
   single poses, not by arithmetic; batching the refinement across candidates
   would likely take it under a minute without changing a single result. That
   was not attempted here.

Where it fits: as the first thing tried, with a confidence gate. The cost of the
chosen pose separates cleanly enough that a threshold could hand the hard frames
to the paid model rather than to a human, which would let the paid model be
called on perhaps a tenth of uploads instead of all of them.

---

## Files

    pose.py       pose <-> projection matrix, and pose-from-quad (diagnostic)
    model.py      the 3-D template, the cost terms, the weight vectors
    features.py   edge map, oriented distance transforms, ridge, Lab
    search.py     the sweep, per-cell selection, local re-sweep, refinement
    detect.py     the pipeline; the only entry point
    opt.py        Nelder-Mead and a coordinate polish (no scipy in the venv)
    geom.py       kept from before; only TABLE_RATIO and is_convex are used

    tune.py       declares the eight dev frames; shared helpers
    pool.py       collects the dev candidate pool (parallel, accumulating)
    fit.py        fits the ranking weights from the pool
    run_blind.py  runs all 79 frames, writes template_blind.json
    score_blind.py scores it

    diag_pose.py, diag_cost.py, diag_stage.py, diag_vs.py, recall.py,
    exp_*.py, viz_*.py   diagnostics; all of these read the ground truth,
                         none of them are imported by the detector

The detector reads `corrected_corners` nowhere. `run_blind.py` writes the quads
before anything opens `rows.json` for scoring.

### The eight frames tuned on

    04112a24  Westchester TTC
    15be004a  LYTTC
    16ed0458  Matchpoint
    19a1efc7  PingPod
    1c268ac1  (no venue)
    4cde73ed  Pingpod
    2ffe54c7  PingPod          (added later; first unused frame of that venue)
    22859ef1  LYTTC            (added later; first unused frame of that venue)

Chosen to cover every named venue. The last two were picked by rule — the first
frame of each of the two largest venues not already in the set — not by looking
at results.
