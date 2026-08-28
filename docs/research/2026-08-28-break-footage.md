# What the break between rallies knows about changeovers

**Status: research, nothing shipped.** Numbers below are measured on 22
matches with surviving source video and human-judged changeovers.

The shipped detector never opens the footage where a changeover
physically happens. It samples seven frames from the rally before a
break and seven from the rally after, and compares what the two ends
look like. The break itself — a median of about eighteen seconds where
the players actually walk around the table — is never decoded.

This study opens it, and asks what is in there.

## Corpus

| | |
| --- | --- |
| Matches with judged changeovers | 38 |
| …whose source video still existed on 2026-08-28 | 23 |
| …that could be calibrated | 22 |
| Break windows sampled (gaps ≥ 4s between live rallies) | see results |

Raws are swept at 30 days, so the 15 missing matches are gone for good.
This corpus is a snapshot and cannot be rebuilt.

**Nine of the 22 had no table at all.** They predate the keypoint
calibrator and their point clips could not recover a quad. Run against
the SOURCE video instead — full resolution, and free to sample anywhere
rather than only inside a rally — the keypoint detector recovered all
nine, several at 100% frame agreement. That is a finding in its own
right: *the clips were the limitation, not the detector.*

## Method

`break_extract.py` walks each source video once, decoding only the
frames inside break windows, and records for every person RTMDet finds:
their box, their position on the table plane in metres, and the median
Lab colour of five horizontal bands of their body. One pass, so
appearance experiments need no second decode.

`break_signals.py` turns each break into ~45 candidate signals across
five families — occupancy, tracks, lateral movement, appearance and
trivial baselines — and scores each against truth.

### Three things that had to be fixed first

Each of these produced confident, plausible, wrong numbers before it was
caught.

**Projective depth is not distance.** The first coordinate interpolated
between the two end lines and called the ratio depth. It explodes
towards the camera: a near player standing a normal two metres behind
his own end line read 5.08 on a scale where the far player read 0.00, so
a "sensible" band threw the near player away on the cameras that see him
best. Replaced with a homography into metres.

**The table hides the far player's feet.** Their box stops at the table
edge, so the foot point projects to the *near* end line and both players
come out on the same side of the net — eight windows in ten on the first
match checked. Box height does not have this problem; it is read off the
person's own box and needs no ground plane.

**A matching tolerance is not a label.** The ±3 rallies that let a fire
count as finding a changeover, reused as a label, made every break within
three rallies of a boundary a positive: three real changeovers became ten,
and seven of them were breaks where nobody moved. Each boundary now claims
its single closest break and the rest are dropped as ambiguous.

### Truth

Positives are Adil's own review of 141 breaks, extended with proven game
boundaries from fully scored matches. Negatives are breaks in *fully
scored* matches far from every known boundary — where the score itself
proves no game ended — rather than merely breaks nobody reviewed.

Every comparison is against `prod_swap_margin`: the shipped detector's
own same-versus-swap margin for the same break. The question is not
whether break footage separates changeovers, but whether it separates
them for reasons production does not already have.

## Results

904 break windows over 22 matches: 67 changeovers, 455 breaks proven quiet
by the score, 289 too close to a boundary to call and dropped.

**The shipped detector, on this exact corpus: 57 of 67 changeovers, no
false fires.** 85.1% recall at 100% precision. That is the bar.

**Nothing found in the break footage comes close.**

| | AUC | recall at 100% precision |
| --- | --- | --- |
| `scale_exchange` (one grew while one shrank) | 0.832 | 0.045 |
| `walk_min_of_top2_m` | 0.829 | 0.060 |
| `duration` — the trivial baseline | 0.799 | 0.060 |
| appearance on break frames, normalised | 0.804 | 0.000 |
| best 6-signal model, leave-one-match-out | 0.897 | 0.220 |

### Most of what the break knows is that it was long

Duration alone reaches 0.799. Compared only against breaks of the same
length, the best movement signal falls to 0.806 and appearance to 0.770.
There is a real residual, but it is small, and no threshold on it is
trustworthy: the best single signal fires on 4.5% of changeovers before
it starts producing false ones.

### The idea this study was built to test does not work

Following a player through the break and seeing which end they come out
at — the proposal that motivated the whole exercise — measured dead:

| | AUC |
| --- | --- |
| `held_player_flipped` — one player tracked start to end, changed ends | 0.586 |
| `n_crossings` — tracks crossing the net line | 0.640 |
| `n_spanning_tracks` | 0.369 |
| `crossing_pair` — one each way | ~0.50 |

The tracking is not the problem: tracks routinely run 40+ frames
unbroken. The problem is that **"which end is this person at" is only
defined while play is happening.** During a break players stand beside
the table, behind the camera-side corner, anywhere. On the frame checked
by eye, the far player was standing level with the NEAR end line, three
metres off to the side, and the geometry was right — he really was
there. A positional role through the break is not a well-posed question.

### The one apparent win was a bystander artefact

`max_lateral_excursion` looked like it could recover 3 of the 6 long
misses production leaves behind, at 1 false fire under leave-one-match-
out. It does not. The threshold separating them was 2.29 against a false
fire at 2.30 and a true recovery at 2.35 — five hundredths of a table
width — and the detections driving all of it were 84 to 128 pixels tall:
**people at the neighbouring tables**, in a hall with six of them. Killed
after rendering the frames.

This is the second time in this project that a colour-blind-to-context
signal has scored well by measuring something other than the players.
Any future break signal must be gated on the person being one of the two
players, and that gate has to be checked on frames, not assumed.

### Where production's ten misses actually are

Five are long breaks (12.5s to 51.5s) with plenty of movement. Five are
gaps of 4 to 9.5 seconds where there is no break footage worth opening.
So even a perfect break-footage detector could address at most half of
what is left.

### Break footage is scarcer than expected

The median gap between rallies ranges from 1.0s to 5.0s across the 22
matches, depending on how tightly each match's rallies were bounded. Two
matches carry under two minutes of break footage in total; the corpus as
a whole has 116 minutes. A signal that needs a long break to work is not
available on every match.

## What was worth having

**Calibrating from the source video instead of the clips recovered all
nine matches that had no table.** Several came back at 100% frame
agreement. `recalibrate_from_clips.py` was built because clips were all
that survived; where the raw still exists, the source is a far better
input, and 9 of 9 is not a marginal difference. This is unrelated to
changeovers and worth acting on separately.

## Verdict

Do not build a break-footage detector. The break carries a weak signal,
most of it is break length, the specific mechanism proposed does not
survive contact with where people actually stand, and the shipped
detector already does better than anything measured here.
