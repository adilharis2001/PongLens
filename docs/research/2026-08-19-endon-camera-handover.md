# End-on point detection — handover brief

Written 2026-08-19 by the Fable session that built the scoring bench and
the splitter, for whichever model continues. Read this whole file before
touching anything. The mission, the numbers, the open work, and the
guardrails are all here.

## Terminology, and a warning about the old names

This project spent months calling the Westchester rig a "side camera".
It is the opposite, and Adil corrected it on 2026-08-19. The words used
from here on, with the geometry that settles them:

```
match        2.74m long axis   1.525m end line
chris_rc          577px             231px      SIDE-ON
chris_b           464px             259px      SIDE-ON
kumar             441px             302px      SIDE-ON
ishan_rc          437px             335px      SIDE-ON
--------------------------------------------------------
koko              273px             474px      END-ON
tripp_rc          186px             372px      END-ON
terry             180px             394px      END-ON
```

- **SIDE-ON** — the camera sits across from the table looking at its
  length, so the 2.74 m axis covers MORE pixels than the 1.525 m end.
  This is the good case, and it is what every source-of-truth match in
  `point_boundaries` was shot on.
- **END-ON** — the camera sits behind a player looking straight down the
  length of the table, so the 2.74 m axis is squashed to a THIRD of the
  pixels the short end gets. This is Westchester: koko, terry, tripp.
  Adil calls it "behind the table" or "behind the players".

The physics follows from the geometry: end-on, the ball travels toward
and away from the camera, so it barely moves on screen, and the serve
motif becomes unrecognisable. That is the whole reason the serve
detector collapses from ~120% to ~15% and everything downstream breaks.

**Names that still carry the old error, left alone deliberately** because
renaming them touches live things for no functional gain: the route
`/research/sidecam`, the table `sidecam_review_notes`, and the lab files
`s42_sidecam.py`, `s53_sidecam_voter.py`,
`docs/research/2026-08-18-sidecam-overnight.md`. Where any of those says
"side", it means END-ON. Do not trust the word; check the foreshortening.

## The mission

Westchester's camera is end-on and FIXED — never propose moving it or
re-shooting; solve in software only. On that view the serve detector
fires at 6-15% (vs ~90% on good cameras), so production merges rallies
into fused, shredded, mis-padded cards. Adil has called today's
production output on these matches **unusable**. The end goal, in his
words: "reaching something that we can use."

The decision on the table: get end-on matches to a usable bar
(roughly ≥90% of points on one card with sane padding), or build a
confidence gate that auto-refuses and refunds the ones below the bar.
Refusal is the project's established philosophy (see table detection:
a wrong table is worse than no table).

## Ground truth available

- `public.fullmatch_labels` (Supabase): his bench labels on three
  end-on matches — koko 47 serves + 45 ends, terry 52+52, tripp_rc
  103+103. Pair them with `s54_splitter.marks()`. About 10% of Tripp
  is ±1s sloppy by his own admission; ignore that.
- `public.point_boundaries`: 277 fully-bounded points on the
  good-camera corpus (both clocks pre-converted; use `usable` flag).
- Scoring bench UI: `/research/fullmatch` (admin-gated). Videos in R2
  `research/fullmatch/{koko,terry,tripp_rc}.mp4`; signal JSONs in
  `public/research/fullmatch/`.

## Where everything lives

- Lab: `/Users/adil/Desktop/Projects/TTVid/recall-lab/` — NOT a git
  repo. Run scripts with
  `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`.
  Per-match inputs in `work/<key>/` (det.jsonl, ball.json, match.json,
  meta.json, motion.json). DB access via `lab.db()`.
- Production assembly: `worker/points_v2.py` (LIVE via
  `app_config.points_pipeline='v2'`). The lab imports it directly, so
  lab experiments always measure the real code.
- Key scripts: s20 (scorecard vs point_boundaries), s46 (bench JSON
  generator), s47 (prism), s49 (final prism exits), s50 (freeze
  z-motion), s54 (the splitter), s55 (Tripp exam + per-signal
  alignment), s56 (corpus transfer study), s57+ (this session's union
  and tuning work, see below).
- Research records: `docs/research/2026-08-17-serve-notes-analysis.md`,
  `2026-08-18-sidecam-overnight.md`, `2026-08-19-transfer-study.md`,
  and this file.

## The measured state (all against his labels)

Splitter v0 (s54, constants hand-picked, never tuned) vs shipped v2:

```
            one-card        split      lost      fused    head/tail p50
koko   spl  39/45 87%         0          6         7      +2.3 / +1.1
       prod 38/45 84%         4          3         7      +3.7 / +3.4
terry  spl  38/52 73%         0         14         1      +2.3 / -0.1
       prod 39/52 75%         0         13         5      +5.8 / +3.1
tripp  spl  79/102 77%        5         18         7      +2.6 / +1.4
       prod 80/102 78%       17          5         1      -0.3 / -0.5
```

- Production on Tripp: 58% of cards start late, 67% end early — his
  "cards too short", quantified (s55 clipping()).
- ALL 18 splitter losses on Tripp have ZERO tracked crossings inside
  the point (s55 losses()) — tracker blindness. Production's dense
  net catches 15 of them. Hence the union (below).
- Per-signal on end-on cameras (identical definitions, s55):
  serve det 6/6/15%, freeze@serve 87/75/72%, prism-exit@end 76/77/76%,
  bounce@end 76/38/75% (koko/terry/tripp). Prism exit tolerates even
  Tripp's Sol-grade quad.
- Corpus transfer (s56): prism exit exists at only 21-58% of
  good-camera ends and leads the tap; corpus is already 273/277 whole,
  0 lost. Bench concepts are end-on medicine. Do not resurrect
  tail-trimming there: naive cut lost a point for 10% footage.

## The remaining ladder (in order)

1. **Union** — splitter spans where crossing chains exist +
   production's dense-net fallback (`V2.fallback_points`) in the
   uncovered gaps, then `V2.resolve`. Expected ~90% one-card on
   Tripp-like matches. THIS IS THE UNBLOCKING STEP.
2. **Tune** — splitter constants (CROSS_GAP_S, FREEZE_WIN_S,
   FREEZE_PCT, END_PAD_S, START_LEAD_S) via leave-one-match-out:
   tune on two, hold out the third, rotate. Never report a number
   tuned on the match it's scored on.
3. **Fused post-mortem** — koko has 7 fused spans, tripp 7. For each,
   classify: no crossing gap at his boundary (tracker/retrieval
   crossings bridge it) vs gap present but freeze guard failed. Fix
   what the classification says, nothing more.
4. **Pose at candidate boundaries** — full-skeleton via the
   rtmpose-production venv (`~/Library/Caches/PongLens/
   rtmpose-production`) ONLY at freeze valleys: "does this look like
   a serve stance?" Untried. Continuous pose was a whisper (s51) —
   do not re-run it continuously.
5. **Multi-chain tracker** — the foundation fix (track follows
   neighbor tables 67-84% of the time on end-on cameras). Scoped in the
   2026-08-18 overnight doc. Weeks, not days. Only if 1-3 plateau
   below the bar.

## Guardrails — these are Adil's rules, not suggestions

- **NOTHING ships to production without his explicit word.** Lab and
  research pages are free. He reversed one unauthorized prism deploy
  already; do not repeat that mistake.
- Tune in the lab, mirror to `worker/points_v2.py` only at ship time,
  with a faithfulness check (s41 pattern, 0.000s drift).
- Closed doors (measured dead, do not reopen): colour-based table
  detection, adaptive frame counts, audio as standalone boundary
  signal, blanket TAIL_AFTER_* reduction, prism-biased tracker reseed,
  continuous stance-height, voter/logistic blend (44-52% held-out),
  ball toss, camera moves or re-shoots.
- Losing a point is unforgivable > clipped > split > fused > junk.
  85% dead footage removed with every point intact beats 98% with
  points missing (s20 docstring is the scorecard's law).
- `npm run build` gates on the compiler EXIT CODE, in a worktree with
  its own `.next` (dev server shares this checkout). Commit with a
  pathspec, never `git add -A`.
- Copy rules for anything user-facing: plain English, no em dashes,
  no "AI", no explanatory subtitles.

## Session log (2026-08-19, this session)

- Tripp labels arrived (103+103). Ran s54 (splitter held-out exam),
  s55 (per-signal + losses + clipping), s56 (corpus transfer).
- Verdict delivered to Adil: end-on cameras are fixable via union+tuning;
  corpus needs nothing; refund only behind a confidence gate.
- He approved running the ladder items 1-3 as a long-running task.
- Fable ran s57 (union) and s59 (fused post-mortem), then handed over to
  Opus mid-run at the Fable usage ceiling. Everything below is the Opus
  continuation.

---

# Results of the ladder run (Opus, 2026-08-19)

## The metric was wrong, and it was hiding the answer

s54/s57 scored "one-card": a point counted as held whenever some card
contained it. A card containing three of his points scored three
successes and is useless — he cannot score two points from one card.
s20's docstring had warned of exactly this. Worse, s58's first fix still
folded CLIPPED into clean ("sole occupant, placement counts"), which
made production look like the best system on Tripp.

The final metric (`s60_assemble.score`) has five outcomes in his
severity order: **clean** (one card holds the whole point and no other),
clipped, fused, split, lost. Every number below is clean%.

Re-scored, the s57 "91-93% one-card" results were fusion in disguise:

```
tripp_rc      one-card (old)   CLEAN (honest)   fused points
union+merge      93%               38%              50
```

**Do not reintroduce a coverage-only objective.** It optimises straight
into one card per match.

## Where the systems actually stand (his 199 bench points)

```
                       CLEAN     clip  fused  split  lost
shipped production      31%       70     26     21     21
s60 tuned (held-out)    54%       29     22     30     11
```

Per match, production: koko 44%, terry 37%, **tripp 22%** with 56 of 102
points clipped. That is the "unusable" he reported, quantified.

s60 = crossing chains (freeze-guarded, prism-sharpened ends) + dense-net
fallback cut at freeze valleys. Tuned leave-one-match-out; every number
above is from the fold that never saw the match.

## The ceiling — the finding that decides the project

s61 asks what ANY assembly could reach on these signals, with an oracle
that already knows where each point is and only has to find a candidate
boundary near it (fixed lead and pad, so the offsets stay honest).

```
freeze pct   candidates/min   per point   oracle ceiling
   20            16.0            3.6          59%
   35            24.4            5.4          77%
   50            32.2            7.2          85%
   80            45.8           10.2          90%
```

The 90% is an artefact of candidate density: it needs ten candidates per
point and an oracle to choose the right one. At an honest density the
ceiling is 59-77%, and s60 already reaches 54%.

**So the bottleneck is SELECTION, not signal existence.** The boundary
information is in the motion trace; no local rule can tell which of ten
candidates is the real one. This is why s52/s53's voter failed too — it
also chose locally.

Corollary: a further tuning pass buys single-digit points, not thirty.
Do not spend a week there.

## The answer to the selection problem: global segmentation

`s62_viterbi.py`. Score each 0.1s tick as play-like (ball_dense,
crossings, table bounces, player motion) or dead-like, then run Viterbi
over the candidate boundaries for the single alternating point/dead
segmentation that best explains the WHOLE match. A boundary is accepted
not because it looks good locally but because the segmentation
containing it beats every segmentation without it. That is precisely
what no local rule — and no per-tick voter — can do.

**Held-out, leave-one-match-out, on his 199 bench points:**

```
                     CLEAN     clip  fused  split  lost
shipped production    31%       70     26     21     21
s60 greedy            54%       29     22     30     11
s62 Viterbi           74%        9     11     32      0
```

```
per match (held out)   s62      s60    shipped
koko                   76%      38%      44%
terry                  71%      58%      37%
tripp_rc               75%      42%      22%
```

**Zero points lost across all three matches**, against 21 lost by
production. Tripp goes 22% -> 75% and its 56 clipped points drop to 3.

All three folds independently chose the SAME parameters, which is the
strongest generalisation signal available with three matches:

```
theta 1.0   lam 0.0   cand_pct 65   w_motion 0.4   lead 2.2   pad 1.4
```

74% also sits at the top of s61's honest ceiling band (59-77%), so the
global pass captured very nearly all the headroom the current signals
hold. Splits (32, i.e. 16% of points) are the only defect left of any
size, and note their character: a split point is entirely present, just
carried by two cards. Nothing is missing any more.

Two levers were tried against the splits and BOTH are closed doors:
raising the minimum dead-segment length (the tuner rejected it, picking
the 0.8s floor in every fold, and the total stayed at 74%), and the
boundary price lambda (every fold picked 0.0).

## Closed this session — do not reopen

- **Freeze-signal contamination by neighbouring tables** (s64). The
  hypothesis was good: the motion zones reach 2.2 m past each table end,
  which on a 0.25-foreshortening view is a large swath of a hall full of
  tables, and koko's near zone is 20.5% of the frame. It is wrong.
  presence.json puts every person in table coordinates, and 95-98% of
  detections already sit inside our own players' region. A
  neighbour-free freeze built from person displacement scores no better
  than the zone signal (koko 89% vs 98%, terry 94% vs 94%, tripp 81% vs
  88% at ±1.5s). The zone signal is already clean.
- **Tail trimming on the good-camera corpus** (s56): the naive cut lost
  a point to buy 10% footage; long tails were covering the next serve.

Worth recording from s64 for whoever tunes next: at percentile 50 the
freeze valleys land within ±1.5s of **88-98%** of his serve marks — but
at ~30 valleys/min against 4.5 points/min, which is seven candidates per
point. That is the selection problem again, stated in one line.

## The confidence gate is buildable — this is the commercial answer

s63 measured five pre-assembly signal-health features against achieved
clean% on all nine matches carrying his marks. Every one separates the
good cameras from the end-on cameras with no overlap:

```
match       kind  pts  CLEAN  serve/pt  foresh  cross/min  blind  prism
ishan_rc    side-on   71    94%     1.20    0.726     15.6     35%    62%
ishan       side-on   53    98%     1.64    0.732     15.9     35%    63%
prabhas_rc  side-on   50    98%     1.18    0.743     17.5     31%    63%
kumar       side-on   41    98%     1.17    0.811     16.8     37%    53%
chris_b     side-on   40    85%     1.10    0.996     17.5     15%    68%
chris_rc    side-on   23   100%     1.83    1.393     18.2      7%    39%
koko        end-on   45    44%     0.11    0.321     11.6     58%    33%
terry       end-on   52    37%     0.06    0.254     10.3     68%    16%
tripp_rc    end-on  102    47%     0.28    0.279     14.7     49%    38%
```

`serve_rate` (accepted serve contacts per point) correlates +0.95 with
clean% and splits 4x with no overlap: side-on [1.10, 1.83], end-on
[0.06, 0.28]. `blind_frac` (share of dense time with no crossing)
correlates −0.82 and splits [0.07, 0.37] against [0.49, 0.68].

A gate on serve_rate with a threshold near 0.6 separates every match in
hand with a wide margin, and it is computable straight after detection —
before any card is built, so a refusal can be issued before the user is
promised anything. Nine matches cannot fit a model; they do establish
that the separation exists.

Note this table also confirms production is HEALTHY where it should be:
85-100% clean on all six good-camera matches.

## Recommendation as the numbers stand

1. **The end-on camera is no longer a refund case.** s62 more than doubles
   production (31% -> 74% clean) and loses nothing at all. Refunding
   Westchester matches would now be throwing away a working result.
2. Ship s62 behind the existing `app_config.points_pipeline` switch —
   AFTER his explicit word, and after a faithfulness check on the good
   cameras, which must not regress from 85-100%. The natural shape is to
   run the global pass only where the gate says the serve detector has
   collapsed, leaving good cameras on today's path untouched.
3. The remaining 26% is 16% splits (point present, carried by two
   cards), 5% fusion, 4% clipped. Closing splits needs a better signal,
   not better rules — the multi-chain tracker (ladder item 5), since the
   track follows neighbouring tables 67-84% of the time on end-on views.
   That is now an improvement, not a rescue.
4. Ship the confidence gate regardless. It turns "reject all end-on
   cameras" into "reject the matches that will come out badly", which is
   the same philosophy as table detection: refuse rather than guess.

## s62 must be GATED, not substituted — measured, not assumed

Run against the six good-camera corpus matches with its held-out
parameters, s62 REGRESSES badly:

```
              s62        v2 (freshly built)
ishan_rc      66%              94%
ishan         66%              98%
prabhas_rc    82%              98%
kumar         93%              98%
chris_b       75%              85%
chris_rc      87%             100%
TOTAL      211/278 (76%)   265/278 (95%)
```

The cause is structural, not tuning: s62 does not use the serve detector
at all, because on end-on cameras it fires at 6-15% and is worthless. On
good cameras it fires at 110-183% of the point count and is the single
best signal in the system. Discarding it costs 19 points.

So the shipping shape is settled and each half is measured:

```
serve_rate >= ~0.6   ->  v2 today          95% clean
serve_rate <  ~0.6   ->  s62 global pass   74% clean (v2 would give 31%)
```

Careful when comparing on the corpus: those matches' stored
`match.json` cards are v1-era, so `mj["points"]` is NOT v2's output
there. Rebuild with `V2.build_cards` or the comparison understates v2 by
thirty points. That mistake was made and caught in this session.

## Immediate next steps for whoever picks this up

- Port `s62_viterbi.segment` into `worker/points_v2.py` behind the gate
  above, with the s41 faithfulness pattern proving 0.000s drift on the
  corpus (which must stay on the v2 path and must not move at all).
- Adil has NOT yet seen s62's cards on the bench. Regenerating the
  `/research/fullmatch` card lane from s62 would let him judge the 74%
  by eye, which is worth more than the number.
