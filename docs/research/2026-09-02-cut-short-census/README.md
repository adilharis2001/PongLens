# Cut-short census: Adil's verdicts on 100 flagged card endings

Date: 2026-09-02. Corpus: every ready match uploaded since 22 August with
15 or more cards, all accounts (46 matches). The list Adil validated is
`verdicts.tsv` (the artifact "Points cut before they ended", 100 boundary
clips cut at each card's `t1` from the processed video).

## Result

| verdict | confirmed grade | likely grade | total |
| --- | --- | --- | --- |
| cut short, same point | 2 | 16 | 18 |
| two separate points | 11 | 70 | 81 |
| can't tell | 0 | 1 | 1 |

Both census signals were weaker than claimed. "Winner tap more than 1.5 s
after the card ends" was 11 of 13 wrong: the tap is a lagging indicator
and Adil often taps two or three seconds after the ball is dead. "You
scored this card and deleted the fragment after it" was wrong every time:
the deleted fragments were junk cards, not continuations. The likely
signature (next card within 1.6 s, no serve, crossing within 3 s) ran at
19%, not the two-in-three it calibrated at on taps. Do not reuse either
confirmed signal.

## What ended the 18 real ones

Read from `points` (tight flags, inserted indices), serves.json (per-card
crossings, table bounces, seen spans) and, where they existed, the full
evidence dumps in `/private/tmp/ponglens-inferred-bounce-eval/`.

1. **Hand-made boundaries, 3.** Chris 22 Aug #13 and #31, Louis #20: all
   three carry `tight_end`, and the card after each is a later-inserted
   index (49, 50, 142). These are Adil's own split or insert points, not
   the assembler's.
2. **Long-card split at the 20 s cap, 6.** Julian 23 Aug #19, Kyle #8,
   Anton m5 #74, Anton 26 Aug #58 and #61, Gabriel #19. `split_long`
   cuts any card over `MAX_CARD_S = 20` at the quietest moment of its
   middle half; the two halves sit exactly 1.2 s apart and the second has
   no serve, which is precisely the census signature. Corpus-wide there
   are 102 such split products in 23 matches. Where Adil's taps decide
   them, 16 are two points (the split rescued a merge) and 5 are one
   rally cut in two; the census verdicts say the same, 16 to 5. So one
   split in four cuts a live rally. Raising the cap to 30 s is not the
   lever: in the 20-25 s band it would save 3 rallies and leave 9 merged
   pairs unsplit.
   Replayed from the nine evidence dumps (34 long cards): 30 contain a
   real pause of 0.6 s or more with no moving ball, 4 do not. Kyle #8 is
   one of the 4: ball dense for all 22.2 s, smoothed minimum 0.50 (the
   `same`-mode convolution's edge artefact), cut at 25% of the card. A
   long card with no pause in it is one rally by construction.
3. **Crossing chain broke on a high or unseen ball, 9.** Anton m4 #4 and
   #65, m5 #57, m6 #17, Anton 26 Aug #60, #13, #18, Anton 27 Aug #38 and
   #49. Eight of nine are Anton's, a defender. Signature at the cut: the
   gap between the last crossing before and the first after is 3.0-4.6 s
   (`CROSS_GAP_S` is 3.0), the ball is unseen across the cut, and the
   next card opens with no serve and a crossing 1.5-2.8 s later. Two of
   them (m6 #17, m4 #65) were already proven high balls from the
   full-frame track. Crossings are ground-plane projections, so a ball
   high over the net projects outside the corridor and registers no
   crossing; the chain ends at the last low crossing and `t1` becomes
   the last chain bounce + 2.6 s, mid-rally.
   Raising `CROSS_GAP_S` is not clean: at 4.5 s the two-point pairs in
   the census have a median crossing gap of 5.0 s and 20 of 54 would be
   joined, and serves.json omits dead-space crossings so that count is
   understated.

## The rally-end playback trim (the "end-point detection" Adil remembered)

`app_config.unscored_rally_end = on`, `unscored_rally_end_buffer_s = 1.75`
(f20d3fad, switched on and tuned 2026-08-27). It stops playback of an
UNSCORED point at the last observed bounce or touch + 1.75 s. It did not
cause any of the above: it never moves `t1`, and Keep score stops an
unscored point at `pauseEnd` = the card end + the 0.4 s post pad, not at
the trim. It applies in watch mode, share links, highlights and the reel.

Exposure, measured against Adil's own winner taps on 793 scored points
(matches since 20 August): median tap is 1.46 s after the recorded rally
end, p75 2.13 s, p90 2.74 s. At 1.75 s playback stops before the tap on
40% of points and more than half a second before it on 21%. At 2.25 s
those are 21% and 10%; at 2.6 s, 13% and 1.5%.

## Two ideas measured and not worth building

- Extending the tail while table bounces or crossings continue inside it,
  restricted to cards whose next card has no serve: taps say 4 still
  going against 2 already over; census says 2 real against 6 two points.
- The 25%/75% cut position as a marker of a live rally: 25 of 102 split
  products sit at an edge, and taps split them 5 two-point to 2
  one-point, the same ratio as the middle.

## Proposal, then measured before building

Adil approved items 1 and 2 on 2 September on the condition that cut
quality does not regress, and held item 3 (the playback buffer) back.
Both were replayed on the nine evidence dumps before any code was
written. Neither survived.

### The harness

`scripts/replay.py` feeds each dump's own ball track through the
production `Evidence` class (`build_track` patched to return the dumped
track) and runs the assembly unchanged. It reproduces every dump's
crossings exactly and its cards exactly on seven of nine matches (103 of
106 and 124 of 126 on the other two), so a variant's numbers are the
production code's numbers. Serves are recomputed once without the
prior-crossing rule and filtered per variant, so a crossing change also
changes the serves it would have changed in production.

Rulers: winner taps (matches with at least 20, inside the scored span),
and Adil's census verdicts mapped onto the dumps by raw file. Anton's
m2, m4, m5 and m6 re-uploads are the same files as his 26 and 27 August
originals, and Lester 2 and Lester crop test are the same file as
Lester Pingpod, so 62 of the 100 verdicts sit on dumped footage. A row
counts as joined when one replay card covers both the flagged ending
and the next card's opening.

Baseline over the nine: 725 cards, 95.9 min, 1 card holding two taps,
13 taps in no card, 75 adjacent pairs with one tap across both, 112
with a tap in each; census rows joined 6 of 11 real, 11 of 51 no.

### Item 1: no pause, no split

Guard at 0.6 s in the middle half, cut position unchanged. Touches 4 of
34 long cards. Kyle #8 is kept whole, which is right. The other three
carry no tap and no verdict: Young 2 at 519.7 and 1034.5 (fallback
cards; production cut both stretches into two points, at a different
place from the replay), Anton 27 Aug at 715.9 (an unscored stretch).
Tap rulers identical to baseline; no census "no" row newly joined.

Calibrated against taps on 294 within-point and 285 between-point
intervals, a stretch of at least 0.6 s without fast ball motion occurs
INSIDE 31% of ordinary points and is ABSENT from 7% of between-point
gaps (1.0 s: 14% and 15%; 1.5 s: 6% and 27%). The signal cannot
separate a pause from a rally, so the guard trades about one rescued
rally for one merged pair at corpus scale. Anton 26 Aug/81 #58, a real
30 s rally, has 1.9 s of quiet and is split either way.

Cutting at the midpoint of the longest quiet stretch instead of the
smoothed argmin is worse, not better: Kyle 813-846 (taps 818.2 and
825.6) moves its cut from 821.4 to 831.3 and merges both points. The
argmin's edge bias is real but the argmin is still the better chooser.

### Item 2: crossings for high balls

The "image-space net segment" test is the same test as the ground
projection's side of the net: the homography preserves lines, so the
net line in the picture IS the projection of v = NET_V. What actually
drops a lob is the corridor filter and the 0.35 s teleport reset, so
the variants attack those. All were run with serves on the strict
crossings; feeding the extra crossings to the serve rule costs 18 to
29 serves through the prior-crossing veto and turns them into merged
fallback cards (two-tap cards 1 to 12).

- Gap-bridged crossings (the ball reappears on the other side within
  1.0 to 3.0 s of leaving the corridor, keeping its side), with or
  without a table bounce inside 1.5 s afterwards. Best form, 1.5 s
  with the bounce: real joined 6 to 7 (Anton 26 Aug/71 #60), no joined
  11 to 12 (Lester crop test #13), taps flat (lost 13 to 14).
- Bounce alternation (consecutive table bounces on opposite halves
  within 2 to 4 s with no crossing between, a crossing inserted at the
  midpoint): at 3.0 s, real +1 (#60), no +1 (Tomo #65), taps flat.
- The raw gap rule without filters: two-tap cards 1 to 12, serves -25.

Why it cannot be clean: on tapped matches the crossings the gap rule
adds are 386 in play against 230 after the tap or in dead time. The
ball handed to the server between points crosses the net exactly like
a lob; a table-bounce filter improves that to 271 against 87 and still
joins one pair for every rally it repairs.

### Every one of the eighteen, named (2 September, second pass)

The first pass grouped nine of these as crossing-chain breaks. That was
wrong, and the correction matters because the families have different
fixes. Each ending below is attributed from production's own record:
`match.json` carries the assembler's card times, its serve marks and its
rally ends, and the points table shows which boundaries a person moved
afterwards. `scripts/verdict.py` does the attribution; `causes.json` is
its output. Five causes cover all eighteen.

**A person cut it — 3.** Chris #13 and #31, Louis #20. `tight_end` set,
the next row opens at the same instant. Not the assembler's.

**The 20-second cap cut a live rally in half — 5.** Anton m5 #74, Julian
#19, Kyle #8, Anton 26 Aug/81 #58, Gabriel #19. Combined spans 21.8 to
33.3 s, halves exactly 1.2 s apart, second half serveless. The frame
sheets show unbroken play through every one, and the ball's own record
shows bounces alternating halves right across the cut.

**A serve was read while the rally was still running — 6.** Anton 26
Aug/81 #13, #18, #61, Anton 27 Aug/58 #38 and #49, Anton m4 #65. This is
the largest family and it was missed entirely the first time. A card that
opens on a detected serve must start 1.6 s before the contact, so
`resolve` pulls the previous card's tail back to leave the 1.2 s of dead
space every pair of cards needs (#13, #18, #61, #38), or squeezes two
serve cards together at 1.3 s before the later serve (m4 #65), or
compresses the earlier card to the 1.5 s minimum rally length (#49). The
rally is unaffected by any of this; only the card ends.

Why the false serves: a serve is two bounces on opposite halves with the
ball rising between them, which is also what any stroke over the net
looks like. The rule that rejects mid-rally strokes asks whether more
than one net crossing happened in the 1.5 s before the first bounce
(`PRIOR_CROSS_MAX`). These matches are shot nearly end-on (foreshortening
0.45 to 0.66), the crossing detector fires rarely, and the guard has
nothing to see. Same root cause as the serve-detector's known weakness on
end-on cameras, reaching a different part of the pipeline.

**The 2.6 s tail was measured from the wrong event — 3.** Anton m4 #4,
m6 #17, 26 Aug/71 #60. `rally_end_ev` pads the LAST TABLE BOUNCE by 2.6 s,
but only counts bounces up to the last crossing plus 2.0 s. On #60 that
window closed at 682.25 and dropped three real table bounces at 682.32,
682.58 and 682.85, so the card ended at 682.88, on the last of them. On
m4 #4 the last crossing (44.12) came after the last counted bounce
(42.65), leaving an effective tail of 1.1 s rather than 2.6 s.

**The crossing chain broke on a gap — 1.** Anton m5 #57. Crossings at
638.23 and 641.56, a 3.33 s hole against a `CROSS_GAP_S` of 3.0. Everything
past the hole was ignored, the tail was measured from a bounce at 639.76,
and the card closed at 642.36 while table bounces continued at 640.96,
642.00 and 642.23 and the next card opens with thirty consecutive samples
of the ball on the near half.

### The detection crop, measured rather than assumed

The first pass blamed the crop for m5 #57 and m6 #17 and called it a
vertical loss. `ball_crop` is on globally and every 2 September re-upload
used it (m6's box is 542x304 of a 1920x1080 frame). Against Anton's own
full-frame uploads of the same three files, `scripts/cropcheck.py`:

- the ball leaves the box SIDEWAYS, not upward — 0 samples above the top
  edge on four of five endings, 4 on the fifth;
- the cropped run ends the card earlier on m5 #57 (642.4 against 645.0)
  and m6 #17 (214.8 against 216.6). On m6 #17 Anton's own winner tap at
  216.12 falls inside the full-frame card and outside the cropped one,
  which is independent proof the rally was still alive;
- on m4 #4 and #65 the two runs land in the same place, so the crop is
  not involved there.

### Two of the eighteen still look like two points

Anton m4 #4: Anton's own winner tap on his upload of the same video sits
at 45.22, which is exactly where the card ends, and the cropped and
full-frame runs agree on that boundary. m4 #65 is the same shape. Both
were judged from an abrupt ending, which is the case Adil flagged as hard
to call from the clip.

### The admin page recomputes the serve, and that misleads

`research_serve_misses.build` recalculates each card's serve mark against
today's constants rather than reading what the job used, deliberately and
with a comment saying so. The consequence was not anticipated: a card cut
BECAUSE a serve was detected can show no serve at all on
`/admin/uploads/<id>`, so the cause of the cut is invisible exactly where
someone goes to look for it.

Anton 26 Aug/81 point 13 is the worked example. `match.json`, written the
day the match was cut, gives point 14 a serve at 3:15.65, which forces its
card to open at 3:14.02 and point 13 to end 1.2 s earlier at 3:12.82.
serves.json today shows point 14 with no serve and point 13 with one at
3:10.75 — the opposite assignment. The serve rule changed on 28 August
(surface pad 0.45 m, cluster 2.5 s), two days after this match was cut.

Replayed at today's constants, three of the six serve-family cuts do not
happen at all: 26 Aug/81 #13, #18 and #61 each come back as a single card.
m4 #65 was cut on 2 September, at today's constants, and still splits.
27 Aug/58 #38 and #49 have no evidence dump and were not re-measured.

So the serve family is smaller than six going forward, and the open case
is m4 #65 rather than the older ones. Any future reading of a cut must
come from `match.json`, never from the admin page's serve column.

### Where this leaves it

Not built, pending Adil's read of these numbers. Item 2 is a wash in
every form and the family it targets mostly evaporates on inspection.
Item 1 is harmless and nearly inert. Item 3 remains a one-line config
change with no bearing on the cut. Recorded so neither rule is
re-proposed without new evidence; the crop-box height is the open lead.

## Files

`verdicts.tsv` here. `scripts/`: `census.py`, `census2.py`, `census3.py`
(the flagged list and its grades), `cutlist_page.py` (the artifact Adil
judged), `pull_db.py` and `pull2.py` (taps and card rows from production,
Keychain credentials), `replay.py` (the faithful replay harness and every
variant above), `gapcross.py`, `bouncealt.py`, `pausecal.py` (the three
calibrations), `timeline.py` and `look.py` (per-rally timelines),
`longcards.py` and `trace_ends.py` (earlier, less faithful replays). They
expect the nine evidence dumps in
`/private/tmp/ponglens-inferred-bounce-eval/<match-id>/evidence.json`
and were run from `/tmp/serve-diag/`. The frame sheets are not committed:
they are frames of another player's footage in a public repository.
