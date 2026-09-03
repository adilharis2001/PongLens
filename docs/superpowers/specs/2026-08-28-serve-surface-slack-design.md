# More slack around the table, and one serve per neighbourhood

**Status:** proposed, not built. Measured by replaying the real rule over
the real ball track on 11 matches, and judged against Adil's own review of
every card the change adds.

---

## The defect

A serve is accepted only when both of its bounces land on the playing
surface. `on_surface` allows 15 cm of slack:

```python
PAIR_SURFACE_PAD_M = 0.15

def on_surface(p, pad=PAIR_SURFACE_PAD_M):
    return bool(-pad <= p[0] <= W_M + pad and -pad <= p[1] <= L_M + pad)
```

15 cm is less than the error between where a bounce really happened and
where the pipeline puts it, so real serves are thrown away before any of
the six pair rules gets to look at them. A long serve near a line is
discarded, the card is still built by the crossing fallback, and it ends up
with no anchor, no server and no serve placement.

Anton's `25765e26` card 1 is the worked example: a good table, a clean
long serve, landing read at 25 cm past the far end line.

At least two errors are stacked inside that tolerance and only one of them
has a direction. The homography maps the **centre** of the tracked ball
onto the table plane, and the centre sits a ball radius above it, so it
always projects outward from the camera — worst at the far end, where the
camera's ray onto the table is flattest. That was the whole argument for
widening only the far end. The measurement below says it is not enough: the
quad's own corners carry error too, and a corner off by a few pixels
displaces the mapping in whatever direction it happens to be off. Widening
all four sides recovers substantially more than widening the far end alone,
and the corpus shows no penalty for it.

## The change

Two constants.

```python
PAIR_SURFACE_PAD_M = 0.45   # was 0.15
CLUSTER_S = 2.5             # was 1.5
```

The first widens the tolerance in every direction. The second says two
accepted serves closer together than 2.5 seconds describe one serve, and
the earlier one is kept. Nobody serves twice in 2.5 seconds, so the second
reading is either the same serve found twice or a return mistaken for one.

They ship together because each fixes what the other breaks. Widening the
surface alone lets in seven bad readings; the merge caps them at four
regardless of how wide the tolerance goes. The merge alone removes 25
detections and one card, which is a cost with nothing to pay for it.

## What it recovers

Eleven matches with a full evidence bundle, 914 cards between them, 541 of
which have a serve anchor today. Adil reviewed every card a 45 cm
tolerance adds and sorted them by hand: **49 right, 7 wrong.** Both
columns below are counted against that verdict.

Without the merge, mistakes climb with the tolerance:

| pad | of the 49 right | of the 7 wrong | cards gained |
|---:|---:|---:|---:|
| 30 cm | 32 | 1 | +33 |
| 33 cm | 34 | 3 | +35 |
| 35 cm | 39 | 4 | +39 |
| 37 cm | 42 | 5 | +42 |
| 40 cm | 44 | 7 | +44 |
| 45 cm | 48 | 7 | +48 |

With the merge, they stop at four and stay there:

| pad | of the 49 right | of the 7 wrong | cards gained |
|---:|---:|---:|---:|
| 30 cm | 32 | 1 | +30 |
| 35 cm | 39 | **3** | +36 |
| 37 cm | 42 | **3** | +39 |
| 40 cm | 44 | **4** | +41 |
| **45 cm** | **48** | **4** | **+45** |

That cap is the reason to go wide rather than stop at 35. Once the merge
is on, 45 cm costs the same four mistakes as 40 cm and finds four more
real serves.

**Why stop at 45 and not 60.** 60 cm is in the table above and it recovers
*fewer* of the right ones, not more: a new detection earlier in the rally
wins its cluster and displaces the real serve. The six extra cards it gains
past 45 cm are cards nobody has looked at. 45 cm is also exactly the
tolerance Adil's review covered, so every card the change adds is a card a
person has already watched.

### The neighbouring table did not turn up

The stated fear about widening the sidelines was the next table's ball
being read as a serve. It does not appear. Counting detections that land
**outside every card** — which is where a stray ball from elsewhere in the
room would show up:

| pad (with the merge) | of the 49 right | outside every card |
|---:|---:|---:|
| 30 cm | 32 | 2 |
| 37 cm | 42 | 2 |
| 45 cm | 48 | **3** |
| 60 cm | 47 | **3** |

Two or three across eleven matches, and the number barely moves as the
tolerance doubles. Most of these matches were filmed at PingPod, where
there is a live table a few metres away, so this is a fair test rather than
a lucky corpus.

### Per match

| Opponent | Uploaded by | Camera | Serves now | After | Anchored now | After | Gained |
|---|---|---:|---:|---:|---:|---:|---:|
| not named | Anton Berman | 0.49 | 56 | 66 | 50 | 60 | **+10** |
| not named | Anton Berman | 0.66 | 57 | 59 | 49 | 56 | **+7** |
| Tomo | Julian | 0.78 | 32 | 43 | 31 | 36 | +5 |
| Julian | Adil | 1.63 | 61 | 63 | 52 | 57 | +5 |
| not named | Mumtaz Shabbir | 0.13 | 46 | 51 | 44 | 49 | +5 |
| Chris | Adil | 1.02 | 97 | 101 | 93 | 97 | +4 |
| not named | Anton Berman | 0.49 | 27 | 30 | 26 | 29 | +3 |
| not named | Anton Berman | 0.48 | 92 | 92 | 74 | 77 | +3 |
| Lester | Adil | 1.56 | 98 | 101 | 93 | 96 | +3 |
| not named | Anton Berman | 0.54 | 39 | 35 | 26 | 27 | +1 |
| "match 1" | Laiba Naeem | 0.32 | 20 | 21 | 17 | 18 | +1 |
| **Total** | | | **625** | **662** | **555** | **602** | **+47** |

**555 anchored becomes 602. 61% to 66%.** No match loses ground.

Anton's 0.54 match is the one to look at twice: its serve count falls by
five and it still gains a card. That is the merge collapsing serves that
were being counted twice inside a single card — a fall in the raw number
that costs nothing, because a card is only ever anchored once.

Unlike the far-end-only version, the gains are no longer confined to
middling camera angles. Adil's own square-on Pingpod matches against Julian
and Lester gain 5 and 3, where far-end-only gave them nothing at all, and
even the 0.13 camera — the flattest in the corpus, and one of the two
end-on routes — picks up 5.

### One measurement note, because it changed these numbers

`serve_motifs` measures the apex in PIXELS and scales the threshold by the
video's width. Every replay behind an earlier draft of this spec passed
`scale = 1.0` for every match, which is right for the ten 1920-wide videos
and wrong for the one 640-wide one: its serves were judged against a bar
three times too high, and it read 32 serves where production had found 46.
Corrected, the corpus baseline is 555 anchored cards rather than 541 and the
change gains 47 rather than 45.

This is why `worker/eval/serve_slack_regression.py` imports the production
function instead of restating it, and why it derives the scale from the
bundle. A private copy of a rule can be confidently wrong about a change the
shipped code does not make.

## What it does not do: convert end-on matches

The router sends a match to the end-on assembler below `SERVE_RATE_MIN =
2.1` serves per minute. **No match in the corpus changes route**, and every
end-on video on the platform is too far short for this change to reach:

| video | uploaded by | length | serves | needs | short by |
|---|---|---:|---:|---:|---:|
| — | Laiba Naeem | 1254 s | 31 | 44 | **13** |
| — | Mumtaz Jaat | 980 s | 0 | 34 | **34** |
| "match 1" | Laiba Naeem | 645 s | 20 | 23 | **3** |
| — | Anton Berman | 464 s | 0 | 16 | **16** |

Twelve end-on rows are five distinct videos, four of them real. The
closest needs three more serves and the change finds it one. Every one is
at camera 0.32 or flatter, which is the band where nothing is recovered
anywhere in this corpus — those matches are not mislocating their bounces,
they are failing to track the ball well enough to produce pairs at all.

**So this is not a route lever.** It is a serve-recovery lever inside
matches that already anchor, and it is a large one.

### The routing worry that made this two changes is gone

An earlier draft staged the merge behind the pad, because the merge on its
own drags the router's input down 5.7% and `SERVE_RATE_MIN` was calibrated
at the old clustering. Shipped together the pad more than offsets it — 625
serves become 662 — and the route was checked on all eleven: unchanged.

## Do not backfill this onto old matches

Re-running a finished match re-rolls its table, and on nearly half the
corpus that is not a stable operation. Comparing what production recorded
at upload against what the identical pipeline computed on re-run:

| calibration that answered | matches | serve count on re-run |
|---|---:|---|
| keypoint detector | 6 | 57→57, 20→20, 98→98, 61→61, 97→97, 93→92 |
| Sol (the paid vision step) | 5 | 38→**56**, 32→**39**, 39→**27**, 34→32, 42→46 |

Every keypoint match reproduces. Every Sol match drifts, by up to +47% and
−31%, because Sol is a model proposing corners and it proposes different
ones each time. `74542390` moved from 3.14 serves/min to 2.18 on a re-run
that changed nothing.

A backfill would hand a slice of users a visibly different match and the
difference would mostly not be this change. **New uploads only.** If a
specific old match is worth rebuilding, rebuild it deliberately and look at
it, the way `recalibrate_from_clips.py` already works.

## Implementation

### Files

| file | change |
|---|---|
| `worker/points_v2.py` | `PAIR_SURFACE_PAD_M` and `CLUSTER_S` stay module-level and keep today's values as their defaults; both become overridable by the CLI |
| `worker/points_pipeline.py` | `--serve-surface-pad` and `--serve-merge-s` on the `points` subcommand, defaulting to 0.15 and 1.5 so an unflagged run is bit-identical; assign into `points_v2` before `build_cards`; add both to the `points v2:` note |
| `worker/worker.py` | read `app_config.serve_surface_pad_m` and `serve_merge_s`, defaulting to `"0.15"` and `"1.5"`; pass them through the same call site as `--endon-fallback` |
| `supabase/migrations/` | one migration inserting `serve_surface_pad_m = '0.45'` and `serve_merge_s = '2.5'`; **not** added to the `app_config` public allow-list (107) — nothing on a public page renders them |

Defaults match today's behaviour at every layer, so the code is inert until
the config rows say otherwise, and rollback is one `UPDATE`.

### Why config keys rather than constants

Same reason `points_pipeline` and `points_endon_fallback` are keys. These
are numbers that will be re-tuned when there is more evidence, and the
alternative to a key is a deploy plus a worker restart to move one of them.

### Tests

- **Unit, `worker/tests/test_serve_motif_tolerances.py`:** `on_surface`
  accepts a bounce 40 cm past each of the four edges and refuses one at
  50 cm; six real serve neighbourhoods trimmed out of the bundles
  (`fixtures/serve_slack.json`, 15 KB) pin what each setting finds; the
  config read falls back on a missing row, a non-numeric row and a failed
  query; and the flags are asserted to reach the child command, which is
  the half that fails silently.
- **Regression on the bundles:** `worker/eval/serve_slack_regression.py`
  replays the real `serve_motifs` over a directory of evidence bundles and
  prints old against new. On the 11-match corpus: 625 serves and 555
  anchored cards become 662 and 602, and at the OLD settings it reproduces
  what all 11 bundles recorded when production built them, exactly. It imports the production function
  rather than restating it, because a reimplemented rule agreeing with
  itself is exactly how the first pass at these numbers went wrong.
- **Faithfulness:** one full pipeline run at `--serve-surface-pad 0.15
  --serve-merge-s 1.5`, diffed against current output on the same match.
  Byte-identical cards, or the defaults are not actually inert.
- **Router non-regression:** assert the route is unchanged on all 11.

### Rollout

1. Ship the code with the config rows absent, so nothing changes.
2. Re-run the 11 bundles at the new settings through
   `research_reprocess.py` into a fresh prefix, and publish before/after on
   `/research/serve-misses` so the 45 recovered cards can be watched rather
   than counted.
3. Insert the two config rows, restart the worker.
4. Watch the `points v2:` note on the next ten uploads. Serve rate and
   route are printed on every match either way, which is the evidence the
   next revision argues from.

### Rollback

```sql
update public.app_config set value = '0.15' where key = 'serve_surface_pad_m';
update public.app_config set value = '1.5'  where key = 'serve_merge_s';
```

Then restart the worker. New uploads revert; matches already processed keep
whatever they were built with, which is the same property every other
pipeline switch has.

## What this spec does not know

- **Whether the four end-on videos would convert at any tolerance.** Three
  have no bundle. All four raws are still in R2, so this is four
  `research_reprocess.py` runs, and it should be done before anyone claims
  the change does or does not help those users.
- **What the four remaining mistakes cost in practice.** They are serves
  read mid-rally, so the card gets a slightly wrong head and possibly the
  wrong server. Adil called this class forgivable; it has not been measured
  against scoring.
- **Nine more videos in the corpus have no bundle**, including the Rowel
  and Gui matches, 467 cards between them. They are unmeasured, not
  unaffected.
- **Anything about matches that predate v2.** 102 of the 157 uploads,
  including 55 with scoring on them, never ran a serve detector at all.
  This change cannot reach them.
