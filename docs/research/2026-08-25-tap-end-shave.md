# Ending each point at the winner tap: how much it shaves

2026-08-25. Adil:

> Take the time at which the pad was hit as the end time of the point. How
> much does that help us shave across all the matches?

Measured on production, no code changed. Method: `scored_at_cut_s` (the
winner tap, 067) and `cut_t0` (each card's start inside the cut video) are
in the SAME clock, so the footage a tap-end would drop is simply
`next card's cut_t0 − tap`, no timebase conversion. Everything between two
cut positions is kept footage by construction.

## Coverage

121 ready matches, 8,977 cards. 3,015 scored points, of which **1,738 carry
a tap** (58%) across **37 matches** — only Keep score's flowing session
writes the tap; chip-strip corrections and review mode don't (by design,
067). Zero tapped points are `edited`, so split/edited cards don't
contaminate. Zero stale taps (none land before their own card's start —
no re-cut drift anywhere).

## The shave

Per tapped point, footage between the tap and the next card's start:
median **1.4s**, mean **2.2s**, p90 5.3s, p99 11.3s, max 30.3s. 12% of
points shave nothing (their card already runs into the next one's
pre-pad). The extremes are real: long detector-overrun cards (a 33.5s card
tapped 6.8s in — the rest is ball retrieval), the exact p90 failure the
2026-08-16 point-ends study measured.

Totals across the 1,723 tapped points with a following card:

| variant | minutes | % of the footage tapped points cover |
|---|---|---|
| cut exactly at the tap | 63.0 | 25.1% |
| tap + 0.5s guard | 50.8 | 20.3% |
| tap + 1.0s guard | 40.1 | 16.0% |
| tap-end AND skip deleted cards between points | 114.0 | 45.5% |

The tapped points cover 250 min of cut footage, so the honest rate on a
FULLY scored match is **~20–25% of the cut video** (per-match: 17–28% on
matches scored end to end; half-scored matches dilute their own totals).
Totals include a handful of research re-runs (recut/v2 duplicates of the
same video); the rates don't care.

## Retention framing (goal: ~30%)

Fully scored recent matches, raw → cut → cut minus tap-shave:

| match | raw | cut today | after tap-end | after +junk-skip |
|---|---|---|---|---|
| Julian 08-23 | 16.4 | 11.5 (70%) | 8.6 (52%) | 8.5 (52%) |
| Sajan 08-09 | 18.7 | 13.4 (72%) | 10.0 (53%) | 7.5 (40%) |
| Vaibhav 08-12 | 23.9 | 15.7 (66%) | 13.0 (54%) | 11.6 (49%) |

Tap-end alone moves a scored match from ~66–72% retention to ~52–54%;
with deleted-card skipping it reaches ~40–50%. Neither touches the serve
side (walking around before the serve — the Kind 3 head, which still needs
the serve detector), and unscored matches get nothing.

## Safety of cutting at the tap

From the 2026-08-16 study: the tap sits median +0.1s of the detected rally
end and median 1.1s after the last table bounce — the winning shot is
always inside. But taps can run up to ~0.7s early, so a cut at tap+0s
would occasionally clip the ball still in flight. **tap + 0.5s is the
shippable end: 51 minutes across today's 37 matches, ~20% of a scored
match's cut.**

## If built

Cheapest shape is playback skipping (the plays-cut span-jump mechanism
already in both players), which works retroactively on every scored match
with no re-rendering; a real re-cut would additionally shrink files and
exports. Applies per point only where a tap exists, so the win arrives
exactly when a match gets scored — the same moment the score bug starts
working. Not built; this document is the investigation only.
