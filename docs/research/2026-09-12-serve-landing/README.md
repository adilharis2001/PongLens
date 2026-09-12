# Recovering the serve's landing from a V3 serve

**Question (Adil, 2026-09-12):** the map draws the old bounce-pair rule's
two bounces, borrowed. V3 has no second bounce of its own — it qualifies a
serve on the FIRST bounce, the one on the server's own half, and not
needing a pair is the whole point of it. Can the landing — the second
bounce, on the receiver's half — be *derived* afterwards, anchored on the
serve V3 already found?

**Answer: yes. 82% of V3 serves get a landing, against 60% today, and where
it can be checked like for like it is right 94% of the time.**

## The search

The first bounce after V3's arrival that is on the playing surface and on
the OTHER half of the table. That is the whole rule.

Every gate the bounce-pair rule applies — the apex, the backtrack test, the
prior-crossing veto — exists to answer *is this a serve*. V3 has already
answered that. What is left is only *which bounce is the landing*, and that
needs geometry, not qualification. Dropping the gates is the point, not a
shortcut.

## Corpus

Seven matches carrying V3 serves, **438 anchored cards**: Gui 11 Sep (two
uploads), Chris W37, Brian at the Nationals, Koko and Terry after the crop
fix (both end-on Westchester), and Sohum at the US Open Teams. Three more
matches were pulled and dropped because they carry no V3 serves at all
(Anton 7 Sep, Wayne, David Oh).

| match | V3 serves | landing today | landing anchored | new |
| --- | ---: | ---: | ---: | ---: |
| Brian (Nationals) | 102 | 75 | 97 | 23 |
| Chris (W37) | 72 | 70 | 71 | 1 |
| Gui 11 Sep (a) | 64 | 52 | 61 | 10 |
| Gui 11 Sep (b) | 59 | 41 | 55 | 14 |
| Koko (crop fix) | 51 | 7 | 24 | 17 |
| Terry (crop fix) | 46 | 7 | 21 | 14 |
| Sohum (Teams) | 44 | 10 | 30 | 20 |
| **total** | **438** | **262 (60%)** | **359 (82%)** | **99** |

The gain is not spread evenly, and where it lands is the interesting part:
**the end-on Westchester cameras go from 14 landings to 45.** Those are
exactly the matches where the bounce-pair rule finds almost nothing,
because on an end-on camera a serve's two bounces are foreshortened into
each other. Anchoring on a serve somebody else already found sidesteps that
entirely.

## Is it right?

Checked against the bounce-pair rule's own second bounce — but only after
throwing out the comparisons that were never valid.

Of the 262 cards where both detectors spoke, the motif's FIRST bounce
matches V3's arrival on **201** (median gap 0.03s): same flight, so its
landing is a fair ruler. On the other **61** the motif is describing a
different flight altogether, and its pair was never a statement about V3's
serve.

- Against all 262: **82%** agreement.
- Against the 201 that describe the same serve: **189/201 = 94%**.

The first number is the wrong one. It is measuring how often two detectors
picked the same serve, not how often the landing is right.

## What did not work

**Requiring a net crossing between the two bounces.** Physically a serve
must cross, so this looked free. Measured, it costs coverage (82% -> 70%)
and buys no accuracy (81.9% -> 79.1%): crossings are not detected reliably
enough on a low serve to be used as a gate. Do not re-propose it.

## Open question for Adil

The dot would be DERIVED, not detected, and the standing rule on placement
is accuracy over coverage — fewer dots that are almost always right
([[placement-dot-accuracy-over-coverage]], his call 2026-08-29). 94% is
close to that bar but it is not the same thing as a bounce the detector
saw. Whether a derived landing belongs on the map, and whether it should be
drawn differently from a detected one, is his call rather than a
measurement.

Reproduce with `probe.py` (coverage), `ruler.py` (the 94%), `probe2.py`
(the net-crossing test) and `diag.py` (the disagreements), against
`serves.json` bundles pulled into `sj/`.
