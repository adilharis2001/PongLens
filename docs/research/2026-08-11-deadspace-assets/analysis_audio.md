# Audio-onset features vs mid-match junk — leave-one-scene-out study

Run: `analyse_audio.py` (full log in `analysis_audio_run.log`, machine
results in `analysis_audio_results.json`), addendum `floor_sweep.py`
(`floor_sweep.log`). Data: `features_audio.json` (2662 windows over 28
matches with usable clocks), deduplicated to 2387 mid-match windows =
1998 kept + 389 mid-match junk. 71 pre-match junk windows excluded from
every headline number (FYI only).

## Verdict

**Gate A fails.** At the required floor (>= 99% kept recall on the worst
held-out scene) the best honest candidate removes **4.6%** of mid-match
junk — a rank-within-match `ioi_cv` threshold (surfaced both as the RANK
single at train floor 0.995, worst held-out recall 99.07%, and as the RANK
pair `n_onsets & ioi_cv<=`, 99.10%). Nothing else passes the floor with a
non-trivial cut. Audio onsets alone do not separate mid-match junk from
kept points at this operating standard.

Relaxing the floor to 97% worst-scene recall buys ~12%: the RAW pair
`rhythmicity>= & max_gap_frac>=` cuts 12.3% (worst recall 97.22%), and the
single RAW `ioi_cv` threshold cuts 11.8% (worst recall 98.06%) —
two different feature sets landing at the same order of magnitude, so ~12%
looks like the real ceiling near that floor rather than a selection fluke.

Why the 99% floor is so brutal here: scene S03 (may_1466 alone, a cut-source
match) has only 53 kept windows, so losing a single kept point there drops
its recall to 98.1%. Any rule that ever fires on a kept window in the small,
acoustically-odd scenes fails. A pooled out-of-fold logistic score with one
global threshold cannot reach the floor at any cut above 0% — kept windows
of may_1466 score more junk-like than most junk elsewhere. This is the same
cross-scene scale failure the ball-feature study hit.

## Scene groups and the venue audit (deliverable)

Scenes were clustered from the 24-dim audio fingerprint in
`onsets/<key>.json` (cosine distance, average linkage), plus an fps-class
penalty (all videos are 1920x1080; fps splits 29.97 / 30.00 / 59.94), with
merges forbidden between two matches whose venue labels are both
*confident* and different. Confidence came from the matches table
(SELECT-only): rows with `played_at == created_at` are defaulted uploads
(the whole 2026-07-22/23 batch says "Westchester TTC" by default), so those
labels were treated as wildcards. Tree cut at 0.010; singleton scenes were
merged into their nearest cluster for holdout only (noted below).

11 scenes (S00–S10; membership in the run log). Findings:

1. **Duplicate uploads with conflicting labels (biggest surprise).**
   `vinay_2ffe` == `vinay_5721`: byte-different files, identical footage
   (duration 1442.17s, identical 2688 onsets, identical point boundaries),
   dead labels disagree on 17 of 150 windows. `chris_45b3` == `chris_d2b5`
   == `jason_9a81`: three uploads of the same 335.34s footage — one even
   labelled a different opponent (Jason vs Chris) — labels disagree on 3–5
   of 27 windows. The analysis keeps the latest scoring of each
   (`vinay_5721`, `chris_45b3`) and drops the rest. Aside from the double
   counting these would have injected, the label disagreements put a floor
   on label noise: the same owner re-scoring the same footage flips ~10% of
   junk decisions.
2. **`vaibhav_9bd8`** (labelled Westchester TTC, defaulted era): fingerprint
   distance 0.0028 to `chris_8e17` (confident PingPod). Almost certainly
   PingPod.
3. **`vinay_0411`** (labelled Westchester TTC, defaulted era): distance
   0.0036 to `chris_ebbb` (confident PingPod). Likely PingPod.
4. **`m_4481`** (venue null, different user): distance 0.0016/0.0017 to
   `chris_d3c7` / `julian_522c`. PingPod.
5. **`may_1466`, `patricia_98be`, `vaibhab_fd5c`** (all defaulted
   Westchester TTC): form their own acoustic scene; nearest confident
   neighbours are PingPod at ~0.006, just above the merge cut. Unresolved —
   could genuinely be Westchester.
6. **`nathan_cff8`, `patrick_e009`** (defaulted Westchester TTC): isolated
   pair scene (0.0057 apart, >= 0.016 from everything else). Plausibly a
   genuine venue, whichever it is.
7. **Fingerprint collisions across confident venues** cap what this audit
   can claim: `jacky_617a` (LYTTC) sits 0.0049 from `julian_19a1` (PingPod)
   and `yilin_6a37` (Westchester) sits 0.0070 from `ali_a52a` (LYTTC).
   Same-venue distances run 0.000–0.010, so the fingerprint separates broad
   acoustic classes, not venues. Cannot-link constraints on confident
   labels are what kept the scenes venue-coherent.
8. Cosmetic: `julian_522c` is stored as "Pingpod", every other PingPod row
   as "PingPod".

Singleton merges for holdout (noted per instructions): `alex_efff` ->
kumar's scene (0.0110, cross-venue), `jacky_617a` -> julian_19a1's scene
(0.0049, cross-venue), `jason_5bd2` -> vaibhav_7899's scene (0.0134),
`vinay_0411` -> chris_8e17's scene (0.0122). Cross-venue fold merges only
make the holdout stricter.

## Numbers

Leave-one-scene-out, threshold/model fitted on train scenes only, pooled
cut over held-out scenes, recall = worst held-out scene.

| candidate | floor met | junk cut | worst recall |
|---|---|---|---|
| RANK `ioi_cv` low (tf 0.995) | >=99% | **4.6%** | 99.07% |
| RANK pair `n_onsets & ioi_cv<=` | >=99% | 4.6% | 99.10% |
| RAW pair `n_onsets<= & onset_rate<=` | >=99% | 0.5% | 99.18% |
| RAW pair `rhythmicity>= & max_gap_frac>=` | >=97% | **12.3%** | 97.22% |
| RAW single `ioi_cv` high | >=97% | 11.8% | 98.06% |
| RAW 3-feat logistic (n_onsets, max_gap_frac, onset_rate) | no (96.7%) | 9.5% | 96.72% |
| RANK 3-feat logistic | >=97% | 7.5% | 97.54% |
| depth-2 tree (RAW and RANK) | degenerate | 0.0% | 100% |

**Degenerate winners flagged** (the ball-study artefact reappeared):
five+ RANK pairs share the identical 4.6% cut — they are all the single
rank-`ioi_cv` rule with the partner threshold parked at an extreme.
Several RAW pairs at the 97% train floor share an identical 23.1% cut the
same way (and all fail the floor). The depth-2 tree emits so few distinct
leaf scores that the floor budget forces its threshold above every leaf:
0% cut, not a real result.

**Pre-selection operating point** (pooled out-of-fold logistic score,
threshold at 50% of junk caught): catches 50.1% of mid junk at
**47.7% precision** (195 junk / 409 flagged), against a 16.3% base rate —
a 2.9x enrichment. Worst-scene kept recall at that point is 67.2%, so this
is strictly a "pre-mark the cards for human review" tool, never an
auto-delete.

**Cut-source matches** (`may_1466`, `patrick_e009`, `vaibhav_9bd8` — the
only three with source "cut"; their pre/post-context features are
unavailable because clip joins break the context): excluding them the RAW
logistic moves 9.5% -> 12.5% (worst recall 96.72 -> 96.94) and RAW `ioi_cv`
moves 11.8% -> 12.8%. may_1466 is consistently the hardest scene, so
cut-source rows are mild outliers that drag results down but do not flip
any conclusion; with or without them the 99% floor is out of reach.

**Fusion with ball features** (906 joined windows across 11 matches, join
on key + t0 within 0.2s, 154 junk, 8 scenes; 3-feature logistics fitted at
train floor 99%):

| feature set | junk cut | worst recall |
|---|---|---|
| ball only | 9.1% | 97.20% |
| audio only | 14.3% | 97.39% |
| audio + ball (3 picked from 28) | 17.5% | 98.51% |
| audio + ball (6 features) | 14.3% | 97.20% |

Audio adds +8.4pts over ball; ball adds +3.2pts over audio; the modalities
are genuinely complementary and the combined model has the best
worst-scene recall seen anywhere in the study (98.51%) — still short of
99%. On this small subset that is a direction signal, not a shippable rule.

**Pre-match junk (FYI):** 71 windows, excluded everywhere above.
The earlier extraction counted 72; deduplication removed one.

## What would change the answer

- The 99%-floor bottleneck is small scenes where one kept window costs >1%
  recall. More scored matches per scene (especially non-PingPod venues)
  would make the floor measurable rather than a coin flip on one window.
- Label noise is >= ~10% on junk decisions (the duplicate-upload
  disagreement), which alone caps how clean any 99%-recall separation can
  look.
- Audio clearly carries signal (best single modality in fusion, 2.9x
  pre-selection enrichment). Its failure mode is cross-scene scale, the
  same as the ball features. A per-scene calibration (or the serve
  detector the Kind-3 note calls for) is the plausible route to 20%+, not
  more global thresholds on these 12 features.
