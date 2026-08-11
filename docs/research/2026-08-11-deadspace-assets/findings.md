# Dead-space audio experiment — findings

All work lives in this scratchpad directory. No production code, worker code,
or database rows were changed; the database was touched with SELECT only.

## 1. Verdict

No stage cleared its gate. Audio onsets (Gate A: needed 20%, got 4.6%), pose
on top of audio (Gate B: needed 14.6%, got 4.9% and the winning rule was pure
audio), and temporal context on top of the audio model (gain: exactly 0.0
points, verified window-by-window as bit-identical to the base rule) all
failed. The single best defensible number is **4.6% of mid-match junk removed
at a 99.07% worst-held-out-scene kept recall** — a rank-within-match `ioi_cv`
threshold, reproduced independently in the audio and temporal harnesses.
No separate verification pass ran on these results (the verification slot
came back empty), so 4.6% is the stage runs' own leave-one-scene-out number,
cross-checked between two harnesses but not independently re-derived. By your
own success criteria this is a failure: nothing came close to the goal, and
the one recurring pattern — real pooled signal, no cross-scene transfer, the
same signature as the ball study and the reverted match-structure work — is
now confirmed across three more modalities. Relaxing the floor to 97%
worst-scene recall buys roughly 12% (audio), which is still far short of
useful.

## 2. The venue column lies, and uploads duplicate

The acoustic-fingerprint audit of 11 scenes found:

- **Duplicate uploads with conflicting labels.** `vinay_2ffe` and
  `vinay_5721` are the same footage uploaded twice; the junk labels disagree
  on 17 of 150 windows. `chris_45b3`, `chris_d2b5` and `jason_9a81` are three
  uploads of the same 335s footage, one even naming a different opponent;
  labels disagree on 3-5 of 27 windows. The analysis kept the latest scoring
  of each. Side effect worth knowing: the same person re-scoring the same
  footage flips about 10% of junk decisions, which caps how clean any
  99%-recall separation can ever look on these labels.
- **Wrong venues from the defaulted-upload era.** `vaibhav_9bd8` and
  `vinay_0411` say "Westchester TTC" but sit acoustically on top of confident
  PingPod matches; both are almost certainly PingPod. `m_4481` (venue null)
  is PingPod.
- **Unresolved.** `may_1466` / `patricia_98be` / `vaibhab_fd5c` and
  `nathan_cff8` / `patrick_e009` form their own acoustic scenes and could
  genuinely be Westchester.
- **Caveat.** The fingerprint has cross-venue collisions between confident
  labels, so it resolves acoustic scenes, not venues; venue coherence was
  enforced with cannot-link constraints on confident labels.
- Cosmetic: one match stores "Pingpod" instead of "PingPod".

## 3. Per-stage numbers

All numbers are leave-one-scene-out over 11 scenes, mid-match junk only,
recall measured on the worst held-out scene.

**Audio (Gate A, needed >= 20%): failed at 4.6%.** Best at the 99% floor:
rank `ioi_cv`, 4.6% cut at 99.07% recall. At a 97% floor the ceiling is
about 12% (two different feature sets land there, so it is not a selection
fluke). Degenerate winners (pairs that are a single-feature rule in
disguise) were flagged and excluded. The floor is dominated by small scenes:
one scene has 53 kept windows, so losing one kept point there costs 1.9%
recall. Fusion with the earlier ball features on the 906 joinable windows is
the one bright spot: audio+ball reaches 17.5% at 98.51%, the best worst-scene
recall anywhere in the study, and the modalities are genuinely complementary,
but it is a small subset and still misses 99%.

**Pose (Gate B, needed >= 14.6%): failed at 4.9%, and the winning rule uses
no pose features.** The pose signal is real pooled (max wrist speed is higher
on kept windows in 25 of 26 matches, and every fold's model wants it) but
thresholds calibrated on ten scenes misfire on the eleventh. One calibration
defect found and worked around: `jason_5bd2`'s table quad is not on the table
despite `calibration.ok = true`.

**Temporal context: contributed zero windows at the floor.** Every
floor-passing "context pair" is bit-identical to the plain audio rule. Worse,
hysteresis smoothing lost 3 kept windows, 2 of them stranded between junk
runs — real points swallowed by run extension, the one error class the
product cannot afford — for only a 2.1% cut. Root cause: 242 of 300
mid-junk runs are singletons (mean run length 1.39), so the "junk comes in
clusters" premise is mostly false in the deduplicated labels, and 106 kept
windows have junk on both sides, so neighbour-scoring attacks exactly them.

**Pre-match junk** (71 windows) was excluded from every headline number, as
specified. It exists and is easy to find, but it is out of scope.

## 4. Pre-selection: the one usable operating point

A pooled out-of-fold logistic on the audio features, thresholded to catch
half the mid-match junk, flags windows at **47.7% precision** against a
16.3% base rate — a 2.9x enrichment. Neither pose (48.4%) nor temporal
context (44.9%, slightly worse) improves it. As product: in the scoring
flow, roughly every second pre-marked card would really be junk, and half
the junk would arrive pre-marked. Worst-scene kept recall at that point is
67.2%, so this is strictly "pre-mark for the human to confirm", never
auto-delete. It is a modest quality-of-life option, not progress toward the
30% retention goal.

## 5. What to do next

1. **Stop threshold work on window features.** Three modalities and a
   context layer all show the same no-transfer signature. More features or
   smarter thresholds on 8-second windows are exhausted.
2. **Build the serve detector** (the Kind-3 note). It is the one remaining
   direction with a mechanism-level reason to generalise: detect the motif
   that starts a real point instead of scoring windows by their
   surroundings.
3. **Fix the data before the next study**: dedupe the duplicate uploads,
   correct the defaulted-era venue labels (at least `vaibhav_9bd8`,
   `vinay_0411`, `m_4481`), and get more scored matches from non-PingPod
   venues so the 99% worst-scene floor stops hinging on one window in one
   small scene.
4. If the pre-marked-cards idea is wanted, it can ship from the audio
   logistic alone; nothing later in the ladder improved it.

## What was and was not verified

Verified: leave-one-scene-out evaluation with fitting on train scenes only;
the audio baseline reproduced bit-identically in the temporal harness;
degenerate rule-pairs checked window-by-window; nine of ten calibration
quads checked visually; duplicate uploads confirmed by identical durations,
onsets and point boundaries. Not verified: no independent verification pass
re-derived the headline numbers; the fusion result rests on a 906-window
subset; the venue audit is acoustic-class evidence, not proof of venue.

Full details: `analysis_audio.md`, `analysis_pose.md`,
`analysis_temporal.md`, plus the run logs and `*_results.json` beside them.
