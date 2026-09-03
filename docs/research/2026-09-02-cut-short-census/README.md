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

## The 20-second cap: why it exists and what should replace it

Asked on 3 September to fix this permanently, because a rally over twenty
seconds is exactly the footage the product is for.

### Why it exists

The lab's own comment beside `MAX_CARD_S = 20.0` in `s21_pipeline.py`:
"A real point is 3.8s with a p90 of 5.7s, so a card past this is holding
more than one of them. Cutting at the quietest ball moment inside halves
the fused count for two points of 'held whole' — worth it, because a card
with two points in it cannot be scored at all."

Both halves of that are true and neither is the whole story. The premise is
a statement about the population, and it is wrong for the sub-population
that matters: lobbers, choppers and anyone good. And the mechanism it
guards against is not length, it is FUSION. Across the nine matches, 30 of
the 32 cards over twenty seconds carry no detected serve — they are
fallback cards, built from bursts of ball motion because serve detection
failed. `fallback_points` merges bursts up to `FALLBACK_MERGE_S` 3.5 s
apart, which is LOOSER than the 3.0 s `CROSS_GAP_S` the rally-extent rule
uses to decide a rally has ended. The assembler holds three different
definitions of "play stopped" — 3.5 s of no motion for merging, 3.0 s of no
crossing for extent, and 20 s of length for splitting — and the third
exists to undo the damage of the first.

### What the cap actually scores

Of the hundred endings Adil judged, **25 were made by this rule**: he called
19 right, 5 wrong, 1 unsure. So it is right about four times in five, and it
is also the single largest producer of wrong cuts in the census.

### The replacement: cut on evidence, never on length

A rally in progress keeps producing events — a bounce on the table or a
crossing of the net roughly every 0.6 to 1.0 seconds (measured: 1.0 to 1.9
events per second in play, on every camera in the corpus including the
0.48-foreshortening end-on ones). Between two points it stops. So:

1. Never split on length. Split only where the evidence shows play stopped.
2. Define a break once — no table bounce and no net crossing for G seconds —
   and use that same definition for merging, for extent and for splitting.
3. Put the cut where a normal card would end: 2.6 s after the last event,
   the next opening 2.0 s before the next one.
4. Split at EVERY break in the card, not once, so a card holding three
   points becomes three cards.
5. Keep a length ceiling only as a runaway guard, far higher (60 s), and log
   when it fires rather than trusting it.

### Measured (scripts/capfix.py, capfix2.py)

Against the 11 cap-made boundaries Adil judged that sit on a replayable
match:

| variant | agrees with Adil | cards | 2-tap cards | 1-point splits |
| --- | --- | --- | --- | --- |
| today | 7 of 11 | 725 | 1 | 76 |
| guard only, today's cut position | 8 of 11 | 722 | 1 | 76 |
| guard, cut once at the break | 9 of 11 | 715 | **3** | 77 |
| guard, cut at every break (2.5 s) | **10 of 11** | 746 | 1 | 82 |
| guard, cut at every break (3.0 s) | 9 of 11 | 743 | 1 | 81 |

Both cut-short cases on replayable matches — Kyle #8 and Anton 26 Aug #58 —
are kept whole by every variant with the guard. Cutting once at the largest
break is the one shape to avoid: it triples the fused cards, because a card
holding three points needs two cuts.

### Choosing G

Measured on 294 within-point and 285 between-point intervals bounded by
Adil's own taps:

| G | real points wrongly split | true boundaries missed |
| --- | --- | --- |
| 2.5 s | 6.5% | 23.5% |
| 3.0 s | 2.0% | 34.4% |
| 4.0 s | 2.0% | 48.1% |
| 5.0 s | 0.7% | 60.7% |

3.0 s is the knee, and it is the number the rally-extent rule already uses.
One caveat: on Kyle, whose detection ran inside a table crop, event gaps
inside a live point reach p90 3.3 s and p99 4.6 s, against p90 1.8–2.9 s
everywhere else. The crop starves the event stream, so on cropped matches a
3.0 s threshold is closer to the edge than the pooled figure suggests.

### Tested across the scored corpus, and REFUTED (3 September)

Adil asked for the change to be proven on the standard corpus before it was
proposed, not on the nine matches that produced it. It does not survive.

**Corpus** (`scripts/corpus/`): every match with at least 15 winner taps —
42 of them. The cap only exists in v2, so the 23 cut by v1 drop out, leaving
19; 17 of those contain splits the cap made. **97 splits in total**, judged
by where Adil's own winner taps fell:

| what his scoring says | n |
| --- | --- |
| both halves scored — the split was right | 42 |
| only the SECOND half scored — the first holds a rally with no winner | 10 |
| only the first scored, second deleted — the second was junk | 8 |
| only the first scored, second kept unscored | 4 |
| neither half scored | 33 |

So of the 60 with scoring evidence the cap is right about 70% of the time
and cuts a live rally about 17% of the time — more often than the census
sample suggested, and worth fixing. But not this way.

**The break test does not separate the two.** Time with no bounce and no
crossing at the cut:

| | n | p25 | median | p75 |
| --- | --- | --- | --- | --- |
| the split was right | 38 | 4.3 s | 6.0 s | 7.8 s |
| a rally was cut in half | 8 | 4.6 s | 4.7 s | 6.6 s |

The distributions sit on top of each other, and the useful direction is
backwards — correct splits are the QUIETER ones. Swept as a threshold over
the 55 judged splits that carry evidence:

| threshold | wrong splits prevented | good splits lost |
| --- | --- | --- |
| 3.0 s | 1 of 17 | 6 of 38 |
| 4.0 s | 1 of 17 | 8 of 38 |
| 5.0 s | 9 of 17 | 13 of 38 |

Every setting trades away more good splits than it saves. **The reason is
the thing the nine-match sample could not show: inside these cards the ball
goes untracked for seconds at a time while the rally is still being played.
"No events" means "the detector lost the ball", not "play stopped."** The
nine-match set happened to contain two well-tracked long rallies (Kyle #8,
Anton 26 Aug #58), which is why the idea looked good there. Note also that
the gaps measured here span the 1.2 s of dead space the split itself
inserted, so each is an upper bound — the true separation is even weaker.

**No other axis works either** (`scripts/corpus/axes.py`), comparing correct
splits against cut rallies: events per second inside the card 0.91 against
0.88, card length 23.8 s against 25.9 s, camera foreshortening 0.64 against
0.60, serves per minute 3.18 against 2.50. Nothing separates them.

**The one signal that points somewhere.** The first half opens on a detected
serve in 18 of 42 correct splits but only 2 of 10 cut rallies. That is the
same fact as "30 of the 32 long cards carry no serve": the cap is a patch
for failed serve anchoring, and the way to stop it cutting rallies is to
stop cards reaching it.

### What to do instead

1. **Leave the cap alone** until there is a signal that beats it. Recorded
   here so the quiet-gap idea is not re-proposed.
2. **Work on serve anchoring for these cameras.** A card anchored on a serve
   is bounded by the rally rule and never reaches the cap.
3. **Two mitigations that need no new signal**, because which cards the cap
   split is known exactly and deterministically:
   - mark them, and offer joining the pair in the app — about 6 a match, of
     which roughly one is a real cut rally, so it is a high-yield review
     queue rather than a silent error;
   - when ranking for highlights and the reel, score a split pair by their
     combined length. `src/app/match/[id]/highlights.ts` ranks by rally
     length, so a 30-second rally cut in half currently loses its place in
     the reel — which is the harm Adil actually cares about, and this fixes
     it without touching scoring.

All 97 are on a review page for Adil to check by eye — clip across each
cut, my reading of it, and buttons to disagree:
https://claude.ai/code/artifact/bea37f6e-46d7-43b6-8563-53d228657e78
(`scripts/corpus/clips.py` cuts the clips, `page.py` builds it).

**Limits of this test.** Ten harmful cases is a small number; the
classification rests on which side of the split the winner tap fell; 33
splits sit in unscored stretches and cannot be judged at all; and only one
v2 match (Rowel) carries the serve-start marks that would bound a point at
both ends, so the stronger ruler was unavailable.

### Not built

Proposed, measured, awaiting Adil's decision. The open questions are G
(3.0 pooled, but the crop argues higher), whether to align
`FALLBACK_MERGE_S` with it at the same time, and whether the 21 extra cards
the every-break variant creates are real points or over-splitting — the tap
corpus has only three long cards with a winner tap in them, so that number
is not settled by measurement.

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
