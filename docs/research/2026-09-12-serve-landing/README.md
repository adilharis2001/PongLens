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

---

## Judged by eye (Adil, 2026-09-13)

24 cases reviewed on the artifact, with a fourth verdict added partway
through because he hit a failure the three original buttons could not
express: the LANDING was wrong because the SERVER was wrong.

| | right | landing wrong | server wrong | couldn't tell |
| --- | ---: | ---: | ---: | ---: |
| new (old rule silent) | 6 | 0 | 3 | 1 |
| agrees with old rule | 4 | 1 | 1 | 0 |
| disagrees with old rule | 0 | 1 | 4 | 0 |
| no landing found | 0 | 0 | 0 | 3 |
| **total** | **10** | **2** | **8** | **4** |

**Four in five failures are upstream.** The landing search itself is wrong
twice in twenty. Given a server read that is right, it lands 10 of 12.

**Every case where it disagreed with the old bounce-pair rule was a
failure — 5 for 5.** Where that rule gives a landing and this search gives
a different one, this search is the one that is wrong. If a landing is
ever shipped, prefer the old rule's where it has one and derive only where
it is silent. That is exactly the "new" column, which he marked 6 right
out of 9 judged.

**His unprompted read: "some of the ones in the beginning were quite
spectacularly correct."** Those were all "new" — landings that did not
exist at all before.

### The two signals, against his ruler

**Flight time.** A real serve pair is ~0.4s. Median 0.43s on the ones he
called right, 0.94s on the wrong-server ones. At a 0.8s threshold it
catches 5 of 8 failures and costs 2 of 10 good ones. A flag, not a gate.

**Net crossing order.** A bounce before the first crossing after contact is
on the server's own side. Caught **6 of the 8** wrong server reads, and
disputed **3 of the 10** that were right. Shipped as a "?" on the admin
chip rather than as a correction: a second opinion wrong three times in
ten must not overrule a detector on a page used to decide what to trust.

### Not a measurement of V3

The sample was deliberately weighted to failure cases, so 8 wrong server
reads in 20 is NOT V3's server accuracy. The corpus figure stands at the
worker's own measurement (81% on 126 cards). Do not quote this table as a
rate.
