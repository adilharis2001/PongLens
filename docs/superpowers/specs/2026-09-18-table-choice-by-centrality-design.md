# Choosing the right table in a crowded hall

> **OUTCOME, 2026-09-18: the design below was BUILT, MEASURED AND REJECTED.**
> What shipped instead is a crop, in sealed release `e2eb55a7…` (source
> `f28fa91a`, merged as `6485d4a0`): table detection runs in the middle 80% of
> the frame and widens only when that finds nothing. Read §0 before anything
> else; the rest of this document is kept because the two dead ends in it are
> worth more than the conclusion.

## 0. What happened, and what to believe in here

**The rule this spec proposes does not work.** Two separate failures, in order:

1. **It shipped inert.** Built, corpus-tested on 37 matches, sealed, staged,
   and taken to a cloud deploy — and on the real video it never fired. The
   corpus harness read re-encoded JPEG frames, whose per-frame scores come back
   about 0.2 high. The played-on table in the failing match scores 5.5–5.9
   against a bar of 6.0, so that 0.2 was the whole difference: the harness saw
   9 of 16 frames survive where production gets 7, and 8 was the number needed.
   **A table threshold measured on extracted or cached frames is not measured.**
2. **Making it fire broke other matches.** Lowering `MIN_INLIER_WEIGHT` to let
   the played-on table qualify made centrality pick a NEIGHBOURING table on two
   hand-marked matches — Ali's real table sits 18% off centre against a
   neighbour at 5%, Ishaan's 11% against 2%. No threshold separates the cases:
   the failing match needs 5.87 or below, Ali breaks by 5.75.

The flaw in §1's reasoning is the part worth keeping. It justifies centrality by
measuring where the **true** table sits (median 11% off centre, max 35%) and
never asks whether a **competing** table sits nearer the middle. In a club it
usually does.

**What shipped instead** — Adil's idea — is `CROP_LADDER` in
`worker/table_keypoints.py`: detect inside the middle 80%, widen to 90% then the
full frame only on refusal. It does not argue about which table is better; it
removes the neighbour from the picture and the existing rule rejecting a quad
with a corner outside the frame does the rest. Widening only on refusal is safe
for the same reason — a crop that clips a real table pushes its corners outside
and the frame is rejected, rather than a different table being named quietly.

Measured on **real video decodes** of 45 corpus matches plus the failing one:
35 correct, 1 wrong, 3 refused — identical to the full frame on every match, the
one wrong being wrong at full frame too. Julian's match, whose real table sits
34% off centre, survives the crop.

**What is still true below:** §1 (the diagnosis and the evidence), §2.4 (record
every candidate), §5.7 (the product-wide scan, and that off-centre distance —
not `tables_seen` — is the monitoring signal), §6 (the release path), and §8
(two real defects in the reprocess feature). **What is dead:** §2.1–§2.3 as a
design, and every number in §5.1–§5.3, which were taken on JPEGs.

**The release rule this proved:** a shadow replay must exercise the thing you
changed. Every single-table replay of the inert release passed; only the
crowded-venue one caught it.

---

**Original status line, left for the record:** designed, not built. Diagnosis complete and reproduced. The rule in
§2.3 has been **replayed over the 37 hand-marked corpus matches that have
cached frames** (§5.1): it is a no-op on every one of them and fixes the failing
match. An earlier, more permissive version of the rule was rejected by that
same replay — see §2.3.1, which is the part of this document most worth reading.
**Owner of the next step:** implementer picking this up cold.
**Cost:** the whole test plan is free — local CPU, already run once. Measured
cost delta of the change itself: **zero** (§5.4).

---

## 1. What is wrong

`fit_table` in `worker/table_keypoint_fit.py` decides **per frame** which of
the tables in the picture is the one being played on, by:

```python
live = [e for e in deduped if e["weight"] >= 0.90 * best_weight]
plausible = [e for e in live if e["plausible"]] or live
chosen = max(plausible, key=lambda e: e["area"])      # most keypoint support, then LARGEST
```

Both halves of that rule prefer a table nobody is using:

- **Keypoint weight** rewards a table whose eleven landmarks are all visible.
  A table in use has a player standing in front of it; an idle one does not.
- **Largest area** rewards whatever sits near the edge of a wide lens, which
  stretches it.

Neither the ball nor the players can currently break the tie, because both are
measured *downstream of this decision*: `detect_ball(table_crop=True)` calls
`keypoint_calibrate` first and only ever looks for the ball around the table it
returns, and the pose window is built from the same corners. On the failing
match the activity gate agreed with the wrong table for exactly that reason.
**Position in the frame is the only independent signal available cheaply.**

### The evidence

Knox vs Wang, match `3794e632-15f2-4e6c-a850-f4016ed541f0`, 3840×2160, eight
tables in view. The calibrator reported `16 of 16 frames agree, spread 2.2px`
and was confidently wrong: it chose the empty table 68% of the way from the
centre of the shot to the right edge. Re-running the detector and keeping every
candidate instead of only the winner (`~/Library/Caches/PongLens/calibration-study/knox-2026-09-18/diag.py`)
shows the real table was found correctly and ranked **second in 14 of 16
frames** (clearing the per-frame support bar in 9 of them), and lost on the area
tie-break even in the 3 frames where it scored *higher* than the winner.

Simulated on those 16 frames:

| Rule | Result |
| --- | --- |
| Today | Wrong table, 16/16 |
| Tie-break only: largest → most central | **Still wrong**, 11/16 |
| Decide at the pool (§2) | **Right table** |

Swapping the tie-break is not enough, because in 9 of 16 frames the right table
falls just outside the 0.90 weight band and is never considered.

### Why centrality is trustworthy here

Measured on the 57 unique hand-marked matches in `table_calibration_review`:
the true table's centre sits a **median 11% off-centre**, 90th percentile 24%,
**maximum 35%** of the frame half-width. People point the camera at their own
table.

> **Trap that cost a round already:** `corrected_corners` in that table are in
> **source** pixels (`source_width`, 1920), *not* `frame_width` (1600). Read at
> 1600 they show a fictitious uniform 30% rightward lean. Any harness touching
> this table must scale by `source_width`.

---

## 2. The change

**Decide which table at the pool, not per frame.** A single frame cannot tell a
busy table from an idle one; sixteen frames plus the frame's geometry can.

### 2.1 `worker/table_keypoint_fit.py`

Split the existing function, keeping the old behaviour available:

```python
def fit_tables(heatmap, canvas=(1920, 1080), **overrides):
    """Every table this frame supports, best-first.

    The existing body, up to and including the `deduped` list. Each entry keeps
    quad, weight, inliers, area, plausible, camera_height.
    """

def fit_table(heatmap, canvas=(1920, 1080), **overrides):
    """The single best table by the historical rule. Unchanged for every
    existing caller (placement_backfill.py and the pinned tests)."""
```

Checked, because the obvious assumption is wrong: **`fit_table` has exactly one
caller in the worker** (`table_keypoints.py:150`) and **no test pins it**. The
copy under `docs/research/2026-08-16-table-detection/detector/fit.py` is the
research harness's own and is not imported by the worker. So the split above is
for readability, not compatibility — there is no third party to keep happy, and
an implementer who finds a cleaner shape should take it.

**But one more thing does run through this path, and it is easy to miss:**
`worker/placement_backfill.py` calls `keypoint_calibrate` (not the retired pink
calibrator, despite the surrounding comments), so re-deriving placement for an
old match goes through `table_keypoints.py` and will use the new rule. That is
the desired outcome — a backfill should get the better table — but it is a
second surface and it must be stated in the release note rather than discovered.

### 2.2 `worker/table_keypoints.py`

`calibrate_video` currently judges one answer per frame. It should judge **every
candidate** of every frame:

```python
for index, image in frames:
    for candidate in detector.candidates(image):        # was: a single result
        keep, reason = fit.frame_verdict(candidate, width, height)
        if keep:
            candidate["frame_index"] = index
            kept.append(candidate)
```

**Do not change `MIN_INLIER_WEIGHT` (6.0).** At the existing bar the right table
survives in 9 of 16 Knox frames, which is enough for the rule below. Lowering it
to 5.5 raises that to 14/16, but it is a threshold measured on this detector's
own output over 660 frames and must not be moved on the strength of one match.
Change it only if §5.1 shows played-on tables routinely falling under it, and
then re-measure.

### 2.3 `pool_frames`

The governing principle, and the acceptance test for the whole change:

> **Centrality may only add a DECISION, never add an ANSWER.**

Concretely:

```
today        = pool_frames(per-frame winners)          # the existing rule, untouched
kept_frames  = DISTINCT frames contributing any surviving candidate
groups       = all candidates grouped across frames by same_table IoU
stable       = groups appearing in >= MIN_WINNER_SHARE (0.5) of kept_frames

if len(stable) < 2:      return today                  # including today's refusals
if the two most central stable groups differ by < CENTRALITY_MARGIN:
                         refuse "two tables equally central"
else:                    return medoid(most central stable group)
```

So on any match with fewer than two stable tables the output is **byte-identical
to today**, refusals included. Centrality only ever arbitrates between two
tables that are each independently well supported — the crowded-hall case this
change exists for. The answer remains a group **medoid**, a real observation,
never an average of two tables.

#### 2.3.1 Why not the simpler rule — read this before "simplifying" it back

The first draft dropped the `today` fallback and simply took the most central
stable group whenever one existed. It is the obvious rule and it is **wrong**,
and the corpus replay caught it:

| | old | first draft | as specified above |
| --- | --- | --- | --- |
| answered | 32 | 34 | 32 |
| median error | 0.21% | 0.21% | 0.21% |
| **gross failures (>5%)** | **0** | **1** | **0** |
| refused | 5 | 3 | 5 |

The regression is `patricia_98be` (Westchester): today the detector **refuses**
and the match falls through to the paid vision rung; the first draft answered
confidently with a table **28% of the frame diagonal** away from the hand mark.

The mechanism matters. Pooling *every* candidate rather than the per-frame
winners promotes tables to "stable" that today's rule would never accept, so a
protective refusal becomes a confident wrong answer. That is precisely the trade
CLAUDE.md forbids: **a wrong table is worse than no table.** The draft also
"recovered" one match today refuses (`jake_cb0e`, to 0.21%) — a real gain, but
not one worth buying with a gross failure, and a refusal is a designed outcome
that costs a fraction of a cent at the next rung.

`CENTRALITY_MARGIN` is 0.10 of the frame half-width. On the corpus it is never
the deciding factor (the only real contest is 18% vs 42%), so it is set by
judgement, not evidence; leave it alone until a match makes it matter.

Three properties this design is chosen for:

- **A frame contributes at most one candidate per group.** The per-frame IoU
  dedup already guarantees this; keep it.
- **`MIN_SURVIVING_FRAMES` and `MIN_WINNER_SHARE` must count distinct frames,
  not candidates.** Counting candidates would let one busy frame clear the bar
  alone. This is the easiest thing in the change to get wrong.
- **When fewer than two tables are stable, nothing changes.** Centrality only
  ever decides *between* stable tables. That is what keeps the blast radius to
  crowded venues — measured at 1 match in 37 (§5.2).

`frames_used` / `frames_kept` / `agreement` / `spread_px` keep their meanings
(winning group size, distinct kept frames, the ratio, medoid spread), so the
note format and everything parsing it are unaffected.

### 2.4 Store every candidate — this is not optional

From the Gemini post-mortem in CLAUDE.md: *"Only the winning proposal is stored,
so a bad calibration cannot be diagnosed after the fact. Log every proposal and
its score."* This bug is that lesson repeating: finding the runner-up needed the
6.2 GB original, a rebuilt interpreter and a re-run of the network.

Write the stable candidates into `match.json`'s calibration block (bounded by
`max_clusters`, 8, so it stays small):

```json
"candidates": [
  {"corners_px": {...}, "frames_seen": 16, "off_centre": 0.68, "mean_weight": 6.83, "chosen": false},
  {"corners_px": {...}, "frames_seen": 14, "off_centre": 0.01, "mean_weight": 6.22, "chosen": true}
]
```

and show them on `/admin/uploads/<matchId>`, drawn on a frame, with the chosen
one marked. A wrong table must be diagnosable from the admin page in a minute,
not a day.

**Note format:** `uploadView.ts` reads the front of the calibration note with a
regex. Anything new goes at the **end** of the sentence.

**`tables_seen` is not a crowded-venue signal — do not use it as one.** It is
`len(deduped)`, capped by `max_clusters` (8), so it counts surviving *candidate
hypotheses*, not real tables. Measured across all 99 keypoint-calibrated
production matches (§5.7) it reads 8 on 90 of them, 7 on 8, 6 on 1 — saturated,
and useless for telling a booth from a tournament hall. The real signal is the
chosen table's distance from the frame centre, which is why §5.7 recommends
monitoring that instead.

---

## 3. What this does NOT change

- **The ladder.** Keypoints, then Sol, then Luna, then refuse.
- **Sixteen frames, and the count stays fixed.** Escalate models, not frames.
- **`frame_verdict`.** The geometry half of the design is untouched; the two
  mechanisms still cover each other's blind spots.
- **Anything a player sees.** No web or iOS change is required; the only new
  surface is the admin candidate list in §2.4. The worker release and that web
  deploy are independent, and the web side must tolerate a `match.json` with no
  `candidates` key, because every match processed before this release has none.

---

## 4. Explicitly rejected

- **Using the ball or the players to pick the table.** Circular today: both are
  measured inside a window derived from the table. Making the ball independent
  means detecting full-frame first and calibrating second, which is a much
  larger change to the two-pass order. Worth considering later; not here.
- **A second vision model.** Forbidden without first reading
  `docs/research/2026-09-10-gemini-table-calibration/`.
- **Colour.** Dead, and the reason is in `calibrate()`'s docstring.
- **Lowering the frame count or stopping early on agreement.** On this very
  match sixteen wrong frames agreed to 2.2px.

---

## 5. Test plan

Everything here is local CPU on assets already on the Mac. The keypoint network
is free and runs at ~0.39 s/frame, so the whole corpus is ~7 minutes of compute.
**No paid API call is made anywhere in this plan.**

Assets:

- `table_calibration_review` — 76 rows, **57 unique** with hand-marked corners
- `~/Library/Caches/PongLens/calibration-study/` — cached frames and detections
- `~/Library/Caches/PongLens/calibration-study/knox-2026-09-18/` — the failing
  match's 16 frames, the candidate dump and the diagnostic script
- `docs/research/2026-08-16-table-detection/CONVERGENCE_FINDINGS.md` — the
  660-frame study the thresholds came from

### 5.1 Corpus regression — ALREADY RUN

Harness: `~/Library/Caches/PongLens/calibration-study/knox-2026-09-18/corpus_test.py`
(free; ~4 minutes; re-run it against the real implementation once built).

37 of the 57 hand-marked matches have cached frames. Replaying both rules:

| | old (today) | new (§2.3) |
| --- | --- | --- |
| answered | 32 | 32 |
| median corner error | 0.21% | 0.21% |
| gross failures (>5%) | 0 | 0 |
| refused | 5 | 5 |
| refusal flips | — | **0** |
| matches whose answer moved | — | **0** |

**Identical on all 37.** The gate for the built version is that it reproduces
this: no new gross failure, no refusal flip, no regression. A single new gross
failure kills the change.

The 20 marks without cached frames are not a gap worth closing with money —
extracting their frames means pulling originals from R2. Do it only if §5.2's
count of multi-table matches looks implausibly low.

### 5.2 Blast radius — MEASURED

Exactly **1 of 37** matches has two stable tables, i.e. is a match this change
can move at all:

- `nathan_cff8` (Westchester TTC): centrality chose the table 18% off centre
  over one 42% off centre, and agrees with the hand mark at 0.15% — the same
  answer today's rule gives.

On the other 36 the new code returns today's answer by construction. This is the
number that makes the change safe to ship: the rule is dormant on ordinary
footage and only wakes in a crowded hall.

### 5.3 Positive control — PASSES

Knox's 16 cached frames, amended rule: `CHOSE most central of 2 (2% vs 68%)` →
the centre table. Today's rule returns the empty side table at 68%. Make this a
committed test fixture so it stays fixed.

### 5.4 Cost delta — MEASURED: zero

No match on the corpus changes its refusal state, so no additional match falls
through to the paid vision rung. The change costs nothing to run.

### 5.5 Two real uploads, end to end

Before sealing: one crowded venue (Knox's, or an LYTTC match) and one
single-table match. The second exists to prove nothing moved for the ordinary
case.

### 5.6 Suites, and the one existing test this change deliberately reverses

`worker` tests (213 plus subtests) must pass. `worker/tests/test_table_keypoint_fit.py`
holds seven `pool_frames` tests; six of them state invariants that **must still
hold unchanged**:

- too few frames refuses (`need 3`)
- agreeing frames give one answer with `agreement == 1.0`
- a plurality short of half refuses (`disagree`)
- the winner must hold half (`disagree`)
- the largest agreeing group wins, not the middle
- the answer is an observation, not an average (medoid is a real frame)

**`test_a_dead_heat_refuses` is the exception, and it is a deliberate
reversal — do not "fix" it by reverting the behaviour.** It asserts that three
frames on one table and three on another refuses, and its docstring gives the
reason: *"answering anyway is how a placement map ends up on the wrong table
while looking perfectly normal."*

That reasoning was correct **when there was nothing to break the tie with**.
The convergence study's own note says as much: refusing ties "closes the one
case where the rule as written would have answered without evidence." Centrality
is that missing evidence. A 3–3 split where one table is dead centre and the
other is at the frame edge is no longer a coin toss.

So the test must be rewritten into two:

- a dead heat where one table is clearly more central → **answers**, with that table
- a dead heat where both are similarly central (inside `CENTRALITY_MARGIN`) → **still refuses**

If that reversal ever looks uncomfortable, the fallback is to keep the dead-heat
refusal and let centrality arbitrate only a genuine plurality. It costs nothing
on the corpus (no corpus match is a dead heat) and it would still fix Knox
(16 vs 9 is not a dead heat).

Add new unit tests for: distinct-frame counting, **the single-stable-table
no-op** (§2.3.1 — the one that would have caught the rejected draft), and the
centrality margin refusal.

---

### 5.7 What the corpus does NOT prove, and the product-wide scan

Be clear about the asymmetry, because it is easy to read §5.1 as stronger than
it is:

- **"Does this break anything?" — well tested.** 37 hand-marked matches,
  provably identical output, plus the scan below. Confident.
- **"Does centrality pick the right table when it fires?" — thinly tested.**
  The new path executes on **two** matches in total: `nathan_cff8` in the corpus
  and Knox's. Everything else is a no-op by construction. n = 2.

That thinness is not fixable by testing harder, and the reason is worth knowing.
Every stored `match.json` was scanned (200 ready matches, 99 keypoint-calibrated,
free, no inference — `prod_scan.json` in the knox-2026-09-18 directory). The
chosen table's distance from the frame centre:

| | median | p90 | max |
| --- | --- | --- | --- |
| production (99 matches) | 7% | 18% | **21%** |
| owner hand marks (57) | 11% | 24% | 35% |
| **Knox, before the fix** | | | **68%** |

**No other stored match is anywhere near the failure signature**, and nothing in
production exceeds 21%. So the crowded-hall population this rule exists for
barely exists yet — which is simultaneously the good news (nobody else has been
hurt) and the reason the benefit cannot be broadly measured today.

The right responses to that are in this spec already, and they are the ones that
matter more than another test pass: keep the rule conservative so a thin
positive case cannot cost anything (§2.3), and store every candidate so the next
occurrence is diagnosable in a minute instead of a day (§2.4).

**Monitoring after release.** Watch the off-centre distribution, not
`tables_seen`. A newly processed match whose chosen table sits beyond ~35% from
the centre is outside everything ever seen in production *and* outside every
owner hand mark; that is the alarm worth wiring, and re-running the scan is
free.

Worker code, so the sealed-release procedure is mandatory and its order is
absolute. Read `worker/cloud_release/README.md` §"Packaging a new release for
the cloud" and follow it rather than any command copied here:

1. build, verify and stage the **Mac** release
2. build and probe the **Linux twin** from the staged directory
3. **shadow-replay** two or three recent uploads and compare
4. deploy and register the twin
5. **only then** activate the Mac release

**The shadow replay must include a crowded-venue match** (Knox's, or an LYTTC
one). On a single-table upload the new code path never executes, so a replay of
ordinary footage would prove only that nothing broke — not that the change
works, and not that Mac and Modal agree about it. Accepted T4 parity is ~3% of
threshold-edge ball detections; two platforms choosing *different tables* would
be a far larger divergence than that budget covers, and this is the one replay
that can detect it.

`pipeline_id` must be identical across Mac and Linux; `release_id` differs. The
dispatcher refuses with `release_mismatch` if they disagree, which leaves the
backup unavailable rather than running the wrong pipeline.

Carry-overs that must not be forgotten in the next seal:

- the three `worker.py` changes already on `codex/cloud-twin` (`PONGLENS_WORKER_HOST`
  identity, `PONGLENS_HOUSEKEEPING`, pgmq visibility renewal from the pulse thread)
- the release must be built on the **current macOS build**; an OS update stops
  every earlier package with "macOS build changed"
- never import Python from a staged or live release without `-B` /
  `PYTHONDONTWRITEBYTECODE=1`; a bytecode cache changes the payload and the
  workers refuse claims
- never edit anything under `worker/cloud_release` while Modal is uploading

Branch: `codex/table-choice-by-centrality`, built in its own worktree.

---

## 7. Matches already affected

Knox's match was reprocessed by hand on 2026-09-18 with the correct table
supplied, and published silently (ops directory
`~/Library/Caches/PongLens/knox-reprocess-20260918/`). It is not waiting on this
work. What the wrong table had cost, measured on the same video:

| | wrong table | correct table |
| --- | --- | --- |
| points | 24 | **119** |
| serves detected | 2 | **111** |
| serve placement dots | 23, on a table nobody used | **117** |
| match kept | 3m 40s of 26m (14%) | **19m 01s (72%)** |
| assembler route | end-on fallback | serve-anchored |

The old version is retained as `superseded` with all its artifacts, so it can be
restored from `/admin/issues/<id>` if anything about the new one is wrong.

Once the fix ships, the `candidates` record from §2.4 makes it possible to ask
which *other* stored matches had a second stable table — worth a one-off query
before deciding whether anything else needs re-running.

---

## 8. Defects found on the way, not fixed here

### 8.1 A reprocess candidate never runs the body-first assembler

In `run_match_processing_workflow`:

```python
if active and points_kwargs.get("pipeline") == "bodies":
    outdir = run_body_points_pass(...)
```

`active` is `destination.activates_match`, which is **False for every reprocess
candidate**. So a candidate is always assembled by the ball side (v2) even when
`app_config.points_pipeline` is `bodies`, which is what production uses today.

Two consequences: a candidate is not a like-for-like re-run of the active
version, so the admin comparison is not comparing the same pipeline; and
publishing one silently moves the match from `bodies` to `v2`. It did not hurt
Knox — his original had *also* fallen back to v2, because the body pass refused
on the wrong table's player window — but on any match where the body pass
succeeds, a reprocess would be a downgrade.

Fix before reprocessing is offered to players, or the comparison misleads.

### 8.2 A published version strands the original upload on the player's Home

Publishing a reprocessed version moves `matches.job_id` to the new job, and the
web Home page's "Processed videos" list keys off exactly that
(`HomeOverview.tsx`, `downloadJobs`): `!matchJobIds.has(j.id)`. The **original**
upload job therefore stops being recognised and appears to the player as a
stray "Done · Playtime only" card offering the superseded cut. iOS is unaffected
(its list only holds queued/processing jobs). No notification or email is
involved. Nobody had published a reprocessed version before, so this had never
run in production. It should be fixed before the reprocess feature is offered to
players — track separately.
