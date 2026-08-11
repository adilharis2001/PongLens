# Crossing-rule decisive evaluation

**Verdict: DO NOT ship.** The label-blind health gate does not validate, the
rule harms 62/1088 kept points (5.7%) on the population that gate passes, and
even a label-oracle gate leaves 5 kept casualties. The pilot's 0/76 was a
small-sample result on the two matches chosen for pristine measurement. The
zero-casualty requirement fails at every level of this evaluation.

Harness: `evaluate.py` (this directory), full numbers in `evaluation.json`,
console log in `evaluate.out`. Crossing logic copied verbatim from
`kind2/crossings2.py` (dwell >= 2/side, 0.20 m net margin, 0.35 s teleport
break, lateral bounds u in [-0.7, W+0.7], v in [-1.5, L+1.5]); the only
refactor is precomputing the projected in-bounds (t, v) sequence per match,
which is exactly equivalent. fps: true container fps from `inventory.json`
(ffprobe). Pilot reproduction check passes exactly: chris_8e17 9/9 junk, 0/27
kept + kumar_a0f7 41/48, 0/49 = 50/57 junk caught, 0/76 kept harmed.

Corpus: 22 matches with track + quad (of 28 deduped labeled matches;
ali_a52a, chris_45b3, m_4481, patricia_98be, prabhas_abcd, vinay_0411 have no
track). Quad: `crossexp/quads/<key>.json` unless marked ok=false, else the
original match.json quad; may_1466 uses its ok=false refined quad because the
prod quad cannot even canonicalize (side-on camera) — it fails the gate under
any quad. Mid-match windows only (t0 >= first kept t0).

## 1. Label-blind health gate: FAILS validation

Candidate: share of the match's longest 50% of emitted points with >= 1
crossing. Threshold 0.90 was the best-looking round number; the exhaustive
scan says **no threshold separates** healthy (labeled kept-zero-rate < 3%)
from unhealthy: minimum 6 of 22 matches misclassified at the best threshold
(0.9375).

| match | quad | gate | kept zero-rate | healthy (labeled) | gate pass | junk caught | kept harmed |
|---|---|---|---|---|---|---|---|
| chris_ebbb | quads | 1.000 | 0.0% | yes | pass | 3/4 | 0/38 |
| jason_5bd2 | quads | 1.000 | 2.3% | yes | pass | 5/21 | 3/130 |
| ryuchi_16ed | quads | 1.000 | 2.0% | yes | pass | 3/11 | 1/49 |
| vinay_5721 | quads | 0.987 | 6.9% | NO | pass | 2/5 | 10/144 |
| julian_522c | quads | 0.966 | 6.9% | NO | pass | 0/1 | 12/175 |
| vaibhav_7899 | quads | 0.966 | 0.0% | yes | pass | 4/10 | 0/105 |
| chris_d3c7 | quads | 0.952 | 2.8% | yes | pass | 4/6 | 1/36 |
| julian_19a1 | quads | 0.944 | 9.2% | NO | pass | 9/12 | 12/131 |
| ishan_4c13 | quads | 0.938 | 0.0% | yes | pass | 38/49 | 0/79 |
| david_5162 | quads | 0.935 | 7.8% | NO | pass | 7/10 | 4/51 |
| nathan_cff8 | quads | 0.926 | 7.8% | NO | pass | 0/2 | 4/51 |
| jake_cb0e | quads | 0.924 | 15.2% | NO | pass | 3/7 | 15/99 |
| jacky_617a | quads | 0.897 | 0.0% | yes | FAIL | 20/28 | 0/50 |
| patrick_e009 | quads | 0.897 | 23.0% | NO | fail | 1/4 | 17/74 |
| chris_8e17 | quads | 0.889 | 0.0% | yes | FAIL | 9/9 | 0/27 |
| yilin_6a37 | match.json | 0.886 | 26.0% | NO | fail | 12/16 | 32/123 |
| alex_efff | quads | 0.867 | 16.9% | NO | fail | 0/0 | 10/59 |
| kumar_a0f7 | quads | 0.837 | 0.0% | yes | FAIL | 41/48 | 0/49 |
| bradley_f5a5 | match.json | 0.750 | 19.2% | NO | fail | 33/41 | 9/47 |
| vaibhav_9bd8 | quads | 0.619 | 47.4% | NO | fail | 3/3 | 18/38 |
| vaibhab_fd5c | quads | 0.444 | 56.2% | NO | fail | 0/1 | 9/16 |
| may_1466 | quads (ok=false) | 0.360 | 58.5% | NO | fail | 41/47 | 31/53 |

Confusion at 0.90: 6 pass-healthy, 6 pass-unhealthy, 3 fail-healthy,
7 fail-unhealthy. The failure is structural, not a threshold problem:

- **Junk-heavy matches fail the gate for the wrong reason.** The longest 50%
  of a junk-heavy match still contains real junk, and every genuinely
  zero-crossing junk window counts against the score. kumar_a0f7 — the
  pilot's best match, 41/48 caught at zero harm — scores 0.837 and fails.
  The statistic punishes exactly what the rule is supposed to remove.
- **Matches whose measurement fails only on short windows sail through.**
  vinay_5721 (0.987), julian_522c (0.966), julian_19a1 (0.944) measure their
  long points fine and their short kept points at zero crossings. The harm
  lives in short windows; a long-window statistic cannot see it.

Alternatives tried (all in `evaluation.json` under
`per_match.*.gate_alternatives`, none separate): share of dur >= 6 s windows
with a crossing (vinay_5721 = 1.00 with 10 casualties; patrick_e009 = 0.96
with 17), same at dur >= 8 s, share of the long half with >= 2 crossings,
median crossings-per-second of the long half. A per-window rescue — only
call junk when zero crossings AND low in-bounds detection density — also
fails: at density < 3 det/s corpus-wide it still kills 54 kept windows,
because broken measurement produces exactly the low-density kept windows it
assumes are junk.

## 2. Rule on the gate-passing population

12 matches pass at 0.90. Zero crossings -> junk gives **junk caught 78/138
(56.5%), kept harmed 62/1088 (5.7%)**. The 62 casualties (details with
timestamps and detection counts in `evaluation.json.rule_on_passing.
casualties`) are concentrated in the moderately-unhealthy matches the gate
wrongly passes (jake_cb0e 15, julian_19a1 12, julian_522c 12, vinay_5721 10)
but do not vanish on the labeled-healthy ones: jason_5bd2 3, ryuchi_16ed 1,
chris_d3c7 1. Many casualties have plenty of in-bounds ball detections
(50-80) and simply never register a crossing — measurement misses on real
points, not empty windows.

Oracle reference (production cannot do this — it needs the labels): restrict
to the 9 labeled-healthy matches. Junk caught 127/186 (68.3%), kept harmed
**5/563 (0.89%), not zero**:

| key | t0 | t1 | dur | in-bounds det | raw det |
|---|---|---|---|---|---|
| chris_d3c7 | 0.97 | 3.47 | 2.5 | 0 | 40 |
| jason_5bd2 | 1218.02 | 1220.02 | 2.0 | 55 | 55 |
| jason_5bd2 | 1342.48 | 1346.49 | 4.0 | 71 | 103 |
| jason_5bd2 | 1515.49 | 1518.49 | 3.0 | 19 | 87 |
| ryuchi_16ed | 682.00 | 684.80 | 2.8 | 52 | 68 |

A "healthy" label of kept-zero-rate < 3% permits up to 3% harm by
construction, and that is what materializes once the population grows beyond
the two pilot matches. Only 6 of 22 matches are actually zero-harm at
reference parameters (chris_8e17, chris_ebbb, ishan_4c13, jacky_617a,
kumar_a0f7, vaibhav_7899), and no label-blind statistic we tested isolates
that set — their gate scores (1.000 down to 0.837) interleave with harmed
matches (0.987, 0.966, 0.944...).

## 3. Projected production impact

Mid-match junk in the deduped labeled corpus: 428 windows (335 in the 22
evaluable matches). Literal phase-3 number — junk sitting in gate-passing
matches AND caught: **78/428 = 18.2%**. But that figure ships 62 kept
casualties with it, so under the zero-casualty requirement **the shippable
junk cut today is 0%**. For scale: the oracle-healthy population would cut
127/428 = 29.7% at 0.89% kept harm — also disqualified, and unreachable
without labels anyway.

## 4. Struck vs lobbed (audio time-lock): does not extend the pocket

For windows with exactly 1-2 crossings, a crossing is "time-locked" if a raw-
clock audio onset falls within [-0.30 s, +0.15 s] of it (matches with
cut-clock onsets skipped: patrick_e009 among passing). On the gate-passing
population: junk 35 locked / 10 silent, kept 286 locked / 22 silent. The
proposed extension "silent single crossing -> junk" would add 10 junk and
**kill 22 kept points**. On the oracle-healthy population it is still 9 junk
for **6 kept casualties** (ishan_4c13 x3, jason_5bd2 x2, ryuchi_16ed x1).
Fails the zero-casualty bar everywhere.

It is also close to uninformative: onset rates on these videos run 96-169
per minute, so the chance that a random 0.45 s window contains an onset by
pure coincidence is 0.52-0.72 per crossing. "Time-locked" is mostly noise —
78% of junk crossings are "time-locked" too.

## 5. Robustness sweep (dwell 1-3, margin 0.10-0.30, teleport 0.175-0.525)

The negative result is **not parameter-brittle** — no combination rescues
it. On the gate-passing population, kept harm ranges 46-117/1088 across all
27 combinations (best: dwell=1, margin=0.10, teleport=0.525 at 46 harmed,
still 4.2%). On the oracle-healthy population harm never drops below 5/563.
On the zero-harm 6 (a set selected by the outcome, so this is confirmation
of stability, not an independent result), zero harm holds across dwell x
margin <= 0.20 x teleport >= 0.35 (8 of 27 combos, including the reference)
and breaks at teleport 0.175 (-50%) or margin 0.30 (+50%). fps=30 vs true
fps moves individual matches (julian_522c 23 -> 12 kept-zero) but changes no
conclusion.

## Why this happened, and what could change it

The rule's safety depends on per-window measurement quality in exactly the
low-signal regime it operates in: short points with sparse or
marginally-projected detections. A per-match health gate — any of them —
averages over the whole match and cannot certify the short-window tail. The
pilot pair looked perfect because those two matches were selected for
pristine measurement; at 22 matches the tail is visible.

Paths that could genuinely reopen this (in rough order of leverage):

1. **Fix the measurement, not the gate**: the casualties with 50-80
   in-bounds detections and zero crossings indict crossing recall (net-line
   placement, dwell interaction with sparse tracks), and several matches
   show heavy in-bounds attrition (raw 195 vs in-bounds 1 on julian_19a1
   windows — quad drift or mid-match camera movement). Time-varying
   calibration or a crossing detector with sub-margin interpolation would
   attack the actual failure.
2. **Per-window abstention that is provably safe** — we found none among
   duration, in-bounds count, and density; anything shipped needs a
   statistic whose zero-harm property survives a corpus this size.
3. More labeled matches with healthy measurement, to bound the healthy-tail
   casualty rate honestly (currently 0.89% on 563 kept points, which at
   PongLens scale is far from "never eats a real point").
