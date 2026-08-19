# Do the side-camera clues transfer to the good-camera corpus?

Date: 2026-08-19. Scripts: `recall-lab/s55_tripp_exam.py`,
`recall-lab/s56_transfer.py`. Truth: his bench labels
(`fullmatch_labels`: koko 47+45, terry 52+52, tripp_rc 103+103) and
`public.point_boundaries` on the corpus (277 fully-bounded points across
six matches).

## 1. Tripp — the held-out exam

He labelled Tripp after the splitter was frozen, so nothing below was
tuned on it.

```
                     spans  one-card   split  lost  fused  head p50  tail p50
gap+freeze splitter    81   79/102 77%    5    18     7     +2.59s    +1.44s
shipped pipeline      141   80/102 78%   17     5     1     -0.31s    -0.49s
```

- The shipped pipeline's medians are NEGATIVE: on the median Tripp point
  the card starts after his serve tap and ends before his end tap. Of 97
  matched points, 58% start late and 67% end early. That is the "cards
  are too short" he reported, measured.
- Every one of the splitter's 18 losses has ZERO tracked crossings inside
  the point — tracker blindness, not splitter logic. Production catches
  15 of them with its dense-motion fallback. The fix is the union:
  splitter where crossing chains exist, dense net where they do not.
- Tripp's quad came from Sol (the last paid rung; keypoints and Luna both
  refused), and he can see it is imperfect. The prism exit still fired at
  76% of his ends — same as koko/terry — so the exit clue tolerates a
  degraded quad.

Per-signal, identical definitions across all three side matches
(serve-detector / freeze@serve / chain-gap@end / prism-exit@end /
bounce@end):

```
koko      6%   87%   58%   76%   76%
terry     6%   75%   40%   77%   38%
tripp    15%   72%   46%   76%   75%
```

## 2. The corpus transfer — his actual question

"Would it make each point there any thinner or more accurate?"

Baseline first: today's v2 on the corpus is 273/277 whole, 0 lost,
1 clipped, 3 split, 1 fused. Head slack +2.76s (target +2.0), tail slack
+2.37s (target +0.8). There is no accuracy problem to fix on good
cameras — only about 1.6s of excess tail per card.

Does the exit clue even exist there?

```
            exit@W        median offset   freeze@S
ishan_rc    15/71  21%       -0.24s        51/71
ishan       14/53  26%       -1.00s        40/53
prabhas_rc  15/50  30%       +0.12s        43/50
kumar       17/41  41%       +0.38s        40/41
chris_b     23/40  58%       -0.75s        38/40
chris_rc    21/23  91%       -0.85s        11/23
```

Mostly no. On the behind-the-table view the ball usually dies without
walking out of the prism polygon (caught, netted, drops off the end),
so the final-exit event fires at only 21–58% of his winner taps — and
when it fires it tends to LEAD the tap. On the side cameras it fired at
~76% because the prism is narrow in that projection and the ball exits
sideways visibly.

Tighten-only tail experiment, scored against his taps:

```
                whole    clipped  split  lost   tail p50   card time
base            273/277     1       3      0     +2.37s      3265s
naive exit cut  265/277     5       6      1     +1.89s      2934s  -10%
guard: crs+bnc  266/277     5       6      0     +1.90s      3057s   -6%
full guard      272/277     2       3      0     +2.24s      3182s   -2.5%
```

The naive cut buys 10% footage by losing a point and clipping four more
— the long tails were quietly covering the next point's serve, and the
exit's lead means exit+pad sometimes lands before his tap. The fully
guarded cut (region removed must hold no crossing, no bounce, no dense
tick) is essentially harmless and reclaims 2.5%. Nobody ships a point
loss for 10%.

## Verdict

The bench concepts are side-camera medicine. The corpus is already at
its practical ceiling for coverage; its only fat is the flat 2.6s
TAIL_AFTER_BOUNCE, the blanket reduction of which is a measured closed
door (s39). A witness-conditioned trim is safe but rare. If tail
thinning on good cameras is ever wanted, the path is final-bounce vs
pass discrimination with the exit as one witness, worth at most
~10–13% of card time — a polish item, not a priority.

What transfers is the direction of confidence: freeze is near-perfect
at corpus serves (kumar 40/41, chris_b 38/40), confirming it as the
strongest behavioural boundary signal on ANY camera — its production
role stays what the splitter uses it for: the guard that decides
whether a quiet gap is a real boundary.
