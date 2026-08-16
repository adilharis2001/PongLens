# Point pipeline: what to do next

2026-08-16. A flat work list for the serve-first pipeline
(`TTVid/recall-lab/s10_serve_points.py`), each item with the measurement
behind it. Nothing here is built yet.

Evidence comes from two places and they are not equally strong. **Boundaries**
means `public.point_boundaries` — 295 points where Adil marked the serve and
pressed the winner key, which bounds a point exactly. **Curation** means
`points.deleted`, which says a card was junk but nothing about where the point
inside a kept card starts or stops. Where an item rests on neither, it says so.

Baseline: a real point is **3.8s**. Production shows 6.6s per point (1.8s
before, 1.0s after); the new pipeline shows 7.3s (1.3s before, 2.2s after).

---

**1. Score every pipeline change against the boundaries before Adil sees it.**
*Boundaries.* The harness is the highest-value item because it changes how
every other item gets done: 295 human-marked points can now say, in under a
minute and with no review, whether a change clipped a point. Two of this
session's recommendations were wrong until they were checked this way — a
padding cut that would have clipped one point in eight, and a tail cap that
looked twice as safe on two matches as it does on four. Report point recall,
head slack, tail slack and junk rate per match, and refuse a change that loses
a point.

**2. Veto cards that contain no net crossing.**
*Boundaries + curation.* 97–100% of real points contain a net crossing; 72% of
deletions contain none. Charged against points rather than cards: cuts **123
of 412 cards, 122 of which Adil had already deleted by hand, and loses 0 of
201 points**. It removes whole cards and never trims one, so it cannot clip a
point. Junk rate on the new pipeline's own cards: 37% → 13%.

**3. Gate the veto on camera angle, computed at calibration time.**
*Boundaries.* Tripp's real points carry a crossing only 79% of the time
against 97–100% elsewhere, and the reason is geometry: its table projects
**0.50×** its own width on screen where every other match is 1.30–2.50. A real
table is 1.8× longer than wide, so Tripp is foreshortened three and a half
fold and the near/far separation the crossing test needs is a few pixels. The
obvious self-check is circular — serve-anchored cards are selected for having
good ball evidence and report 97% there — so use the geometry, not the cards.

**4. Head-anchor the fallback cards on the first net crossing.**
*Boundaries.* Cards built from a detected serve open 1.1s before contact and
are tight. Cards built without one have no anchor at either end and open
wherever ball motion started. The first net crossing of a point lands **+1.02s
after Adil's serve tap (p90 +1.55s)**, so `first crossing − 2.0s` covers the
serve on well over 90% of points and gives every fallback card a principled
head for the first time.

**5. Find the serves that are being missed.**
*Boundaries.* The detector is accurate where it fires — **+0.04s median
against his serve taps, p90 +0.60s** — and incomplete: it finds 65% (Prabhas)
to 83% (Chris) of the serves he marked. This one number drives both problems
at once, because cards with a serve are 0–14% junk and cards without one are
42–66% junk. Two known routes: a serve into the net never bounces on the
receiver's side so the two-bounce rule is blind to it by construction, and
ITTF rotation runs of one or three localise a miss without any labelling.

**6. Cut the false serves.**
*Curation.* 14–41% of accepted serves have no tap anywhere near them. They
matter beyond their own junk: a false serve mid-rally is what forced the
`open_until` guard, and it blocks the rally-cap work that keeps getting
reverted.

**7. Make the fallback less eager.**
*Curation.* On Chris (15 Aug) 13 rallies with no detected serve produced **62
fallback cards, 41 of them junk**. Every junk card in that match came from the
fallback. Items 4 and 5 shrink this; it may not need separate work.

**8. Break up the long fused cards.**
*Curation + boundaries.* The new pipeline emits three cards over 15 seconds on
Prabhas, one of them 24.3s, and Adil split that one by hand. Production emits
none over 15s. A card holding two points is a different defect from spillage
and none of the above fixes it. A real point is 3.8s with a p90 of 5.7s, so
anything past ~15s is holding more than one.

**9. Cap the tail at the last on-table bounce + 3.0s.**
*Boundaries.* Bites 32% of cards, saves 0.36s per point, and pulls an end back
before his winner tap by at most **0.36s**. Restricting to bounces on the
playing surface matters: retrieval bounces land on the floor beside the table,
so the on-table list stops where the point does and saves twice as much at the
same risk. Small and safe. Worth doing, worth dropping if it complicates
anything.

**10. Do not shorten the tail padding.** *(a do-not, not a to-do)*
*Boundaries.* At today's 1.3s it cuts one point in 58 short, by 0.04s. At 0.7s
it cuts one in ten short by up to 0.64s; at 0.3s, one in six by up to 1.04s.
The earlier argument for cutting it — that production's tail is 1.0s and
nobody complains — was wrong: production reaches 1.0s by having its raw end
sit slightly *before* the tap with the pad rescuing it, which is the same tail
measured from somewhere else.

**11. Keep `LEAD_S` at or above 0.8s.**
*Boundaries.* At 1.1s (today) 2.0% of heads open after his serve tap; at 0.8s,
2.5%; at 0.6s, **10.4%**. There is about 0.3s to be had here and a cliff just
past it.

**12. Fix the serve-survival regression in `resolve()`.**
*Curation.* Serve-anchored cards surviving as their own card fell from 87% to
69% when `MIN_DEAD_S` was introduced. Gap size is not the cause — 0.25, 0.40
and 0.60 all give 69% — so it is in the same-rank branch. A serve-anchored
card is the pipeline's best output and it is being eaten by a card that is
mostly junk.

**13. Stop splitting one point across two cards.**
*Boundaries.* Production covers a point with two cards **4–16% of the time**
(16% on Prabhas), which is exactly the "points I had to join together"
complaint arriving as a number. The new pipeline is better at this already —
3% on Prabhas, 9% on Chris — so it may be fixed; it needs watching rather than
work.

**14. Solve the match with no table. This is the biggest structural gap.**
*Boundaries + curation.* One upload in four. Crossings, bounce sides and serve
motifs all need the homography, so on those matches the pipeline has none of
them, and the best veto costing no real points kills **16% of the junk against
52%** where the table is known — measured across three such matches (187 real
cards, 111 deleted) so it is not a small-sample artefact. Player presence was
the candidate rescue and failed. The routes are fixing calibration on those
matches or finding a crossing test that does not need it.

**15. Replace the recall metric in `worker/eval/score_split.py`.**
*Boundaries.* It scores the pipeline against its own cards, so it returns
100% by construction and has been reporting that as recall for months. It can
now be scored against `point_boundaries` on any match that has them.

**16. Turn the two free oracles into monitors.**
*Neither — these need no labels at all.* Game legality (a game ends at 11 with
two clear, and a pinned `game_end_override` marks a missing point) gives a
**0.97% miss floor across 70 games, 0.24% defensible**. Serve rotation should
run in twos and only 38–40% of runs do. Both run on every match, forever, with
nobody marking anything.

**17. Do not build player presence.** *(a do-not)*
*Boundaries + curation, and it is closed.* The mechanism is real — one end
goes empty 8% of the time during a rally against 38% just after a point ends —
but 41% of deleted cards have both players at their ends for the whole card,
because the ball rarely goes far and the player not fetching it never moves.
Best veto costing no real points: 10%, against 52% for frame differencing,
which is already computed for free. Detector output is cached in the lab so
nobody pays for this answer twice.

**18. Keep publishing shadow matches for review.**
*Process, not measurement.* Writing the lab's cards as real `matches` rows and
scoring them in the real Keep-score UI is what surfaced the duplicate-card bug
and the 24-second fused card. It costs no storage — the cut video is shared —
and it is the only check that catches what a metric does not.

**19. Ask for serve taps on the no-table matches specifically.**
*Boundaries.* Kumar, Ch and Ishan are the three marked matches with no
calibration, which is the unsolved case. Every match Adil marks is worth more
than the rest of the library for these questions, and marks on that group are
worth the most.
