# Serve placement only

2026-08-23. Spec. No code written yet.

Placement maps become **serve placement maps**. The Serves/Rally toggle goes
away, rally landings stop being drawn, and the trust rule that decides which
landings survive is replaced with one built for serves. On the Chris match
(`ec6490f4`, 98 scored points) that moves the map from **12 points to 71**.

Two things ride along: an optional "who served first" question on the upload
forms, and the copy that currently promises rally paths.

---

## Why serves, and why only serves

The eleven-question checklist in `placement_reconstruction.py` is testing
whether we understand a *rally*. Ten of the eleven ask about who hit the ball,
when the bat touched it, in what order, and how the point finished. Only one
asks where the ball landed, which is the only thing the map draws. Any single
failure discards every landing in the point, which is why 86 of 98 points show
nothing.

The serve is the one shot that does not need any of it:

- **Its owner is known independently.** `computeServing` derives the server
  from the scored rotation. Every other shot's owner comes from counting hits
  through the rally, so one missed hit flips the parity and the wrong player
  gets the dot.
- **Its geometry is self-checking.** A serve must bounce on the server's half,
  then the receiver's. That is a free correctness test no rally shot has.
- **It is first**, so nothing upstream can have gone wrong yet. 75 of 86
  measured serve landings are exactly the 2nd bounce of the point.

Rally landings do not get the same treatment and are not worth showing at the
current confidence. Finishing shots ("the last ball you landed before the point
ended your way") measured 70 of 98 and are the natural next feature, but they
need a trajectory rather than a dot and a name that does not overclaim — three
quarters of them are opponent errors, not winners. **Out of scope here.**

---

## Correction to an assumption

**The public share link does not show placement maps today.**
`src/app/s/[token]/` renders `SharePlayer`, `ScoreBug` and `MatchScore` only —
there is no placement surface in `ShareView.tsx` or `shareData.ts`.

The shared experience that *does* show placement is **a coach opening
`/match/[id]`**. `has_match_access()` grants the owner plus any accepted coach,
and they get the same `MatchView`. So there is no separate share build, but the
coach path must be tested, and it is read-only for clip editing while the
placement UI is identical.

If placement should also appear on `/s/[token]`, that is a new feature and
needs its own spec.

---

## 1. The serve trust rule

New collector alongside the existing one. A serve landing is drawn when **all**
of these hold:

| # | condition | drops (of 98) |
| --- | --- | --- |
| 1 | the point has a server from the scored rotation | 0 |
| 2 | the serve shot has a landing with numeric `u`,`v` | 3 |
| 3 | the landing is on the **receiver's** half | 9 |
| 4 | the landing is inside the physical table | 6 |
| 5 | the landing is the 1st or 2nd detected bounce of the point | 9 |
| 6 | the serve's own first bounce, when found, is on the server's half | 0 |

**Result: 71 of 98.**

Deliberately **not** required: `hypothesis.status === "ready"`,
`confidence >= 0.7`, `hard_reasons.length === 0`, and any of the eleven rally
blockers.

Condition 6 costs nothing on this match but is the guard against the one
failure mode that would be invisible: if `first_server` is wrong, **every**
serve flips to the wrong player at once. A systematic error is far worse than a
scattered one, and rule 6 is an independent read of who served that does not
come from the rotation.

Condition 5 needs the point's candidate list, which `PlacementV3.candidates`
already carries; it is not in the shot model today, so the collector reads
candidates directly.

### Where it goes

`src/lib/placement/placementAggregate.ts`. Add
`collectServePlacementObservations()` beside the existing collector rather than
mutating it — the old one still backs the point-level `PlacementMap` and must
keep working unchanged.

`PLACEMENT_AGGREGATE_TRUST_THRESHOLD` stays where it is and stops being applied
to serves.

---

## 2. Web surfaces

| file | change |
| --- | --- |
| `src/lib/placement/placementAggregate.ts` | new serve collector; keep the old one |
| `src/lib/placement/placementAggregateView.ts` | drop `rally` from the shot axis; `PlacementAggregateFilter` keeps only `myServes` / `theirServes` |
| `src/app/match/[id]/PlacementAggregate.tsx` | remove the Serves/Rally segmented control; `mappedPointCount` counts serve points |
| `src/app/match/[id]/PlacementToolsRow.tsx` | section title → "Serve placement" |
| `src/app/match/[id]/PlacementHeatMap.tsx` | heat map fed by serve observations only |
| `src/app/match/[id]/MatchView.tsx` | caption and the mapped-count line |
| `src/app/match/[id]/AnalysisCards.tsx` | wherever the placement card is titled or counted |
| `src/lib/placement/placementHeatMap.ts` | zone classification unchanged, inputs narrowed |

The **Me / opponent** toggle stays — it is the useful axis now, and the
opponent's name is already in it (the screenshot shows "Me | Julian").

`PlacementMap.tsx` — the single-point trajectory drawn inside a point — is
**unchanged**. It is a different feature and still shows the whole rally.

---

## 3. iOS surfaces

| file | change |
| --- | --- |
| `ios/PongLens/PongLens/Core/Placement.swift` | `PlacementAggregateFilter` → `myServes` / `theirServes`; port the serve rule so it matches the web exactly |
| `ios/PongLens/PongLens/Components/PlacementAggregateView.swift` | remove the `[("Serves"), ("Rally")]` segmented control (line ~98); update the per-filter captions (lines ~147–150) |
| `ios/PongLens/PongLens/Screens/MatchTools.swift` | row label and the four empty/failure strings (lines ~436–462) |

The iOS aggregate is a hand port of the web collector. **The two must agree
point for point on the same match**, and that is a test, not an assumption
(see §6).

---

## 4. The "who served first" question

**Not at record time.** Explicitly rejected: the answer is not reliably known
then, and a guessed value is worse than none because it suppresses both the
fallback and any prompt to fix it.

**At upload/submit only, optional, on both platforms.**

- Web: `src/app/dashboard/UploadCard.tsx` (used by `/upload` and the dashboard)
  and `src/components/YouTubeImport.tsx`.
- iOS: `MatchDetailsSheet` in `ios/PongLens/PongLens/Screens/RecordScreen.swift`,
  which the upload flow presents — the same sheet, not a new one.

Shape: a question that reads "Who served first?" with **the two player names**
as the choices, not "near/far" and not "me/them". Names come from what the form
already collects; when the opponent name is blank, fall back to "You" and "Your
opponent". Skippable, with no default selected — an unanswered question must
leave `first_server` null so the existing guess still runs.

Writes `matches.first_server` and `matches.first_server_source = 'user'`.

**Do not re-ask once answered**, with one exception. `worker/first_server_decoder.py`
already decodes first server from the physical-server point calls and is wired
only into research scripts today. Where the decoder disagrees with the stored
answer, surface the correction once in the scoring UI. That preserves "asked
once" without letting a confidently wrong value stand forever. Wiring the
decoder into production is a **separate change** and can land after this one.

Known limit worth writing down: first server is per *game* and the rotation
assumes it alternates. One answer fixes game 1 and assumes the rest. Casual
club play often does not alternate; `points.server_override` remains the escape
hatch.

---

## 5. Copy

Per the house rules: plain, no em dashes, no explanatory subtitle under a
heading, no "AI".

| where | today | becomes |
| --- | --- | --- |
| match section title | "Placement maps" | "Serve placement" |
| mapped count | "Mapped for 2 of 77 points." | "Serves mapped for 71 of 98 points." |
| iOS `MatchTools` row | "Placement maps" | "Serve placement" |
| iOS empty state | "Placement maps show where every ball landed." | "Serve placement shows where each serve landed." |
| `src/app/page.tsx:192` | "Placement maps of serves, receives, and rally paths" | must stop promising rally paths |
| `src/app/learn/guides.ts` (3 places) | "where the ball lands", "maps serves and rally landings" | serves only |

The BETA chip stays.

The upload toggle is still called "Placement maps" in five entry points. Either
rename it everywhere or leave it — but it must not say one thing at upload and
another on the match page. **Decision needed** (§8).

---

## 6. Test plan

Nothing here ships on a claim that two implementations agree; it ships on a
test that they do.

**Unit, web** (`placementAggregate.test.ts`)
- each of the six conditions rejects on its own, with a fixture that fails only
  that one
- a point blocked by every one of the eleven rally reasons still yields its
  serve
- a serve landing on the server's own half is dropped
- `first_server` flipped inverts every serve's owner — pins the systematic risk

**Unit, iOS** (`PlacementTests`)
- the same fixtures, asserting the same six conditions

**Parity, and this is the one that matters**
- a checked-in fixture built from the Chris match: run the web collector and
  the iOS port over it and assert an identical set of (point, u, v, owner).
  A silent divergence between platforms is the likeliest bug in this change.

**Visual, web** at 393×660 and desktop
- the Serves/Rally control is gone, Me/opponent remains
- the count line reads correctly
- empty state when a match has no serves mapped

**Visual, iOS** on a real device, not only the simulator
- same three checks in `PlacementAggregateView`
- `MatchTools` row and every empty/failure string

**Coach path**
- an accepted coach opens `/match/[id]` and sees the identical serve map
- confirm nothing placement-related leaks into `/s/[token]`, which has none
  today and should still have none

**Regression**
- `PlacementMap.tsx`, the per-point trajectory, is untouched and still draws
  the full rally
- placement generation, retry and failure states are untouched
- `npm run build` clean, in a worktree with its own `.next`

**Data check before shipping**
- re-run the yield on two or three more matches. 71 of 98 is one match, one
  venue, one camera, one player's scoring.

---

## 7. Rollout

The UI narrowing and the trust-rule change are separable and should not land
together.

1. **Trust rule behind a flag**, defaulting off. `app_config` key, same shape as
   `points_pipeline`. Off, the serve collector reproduces today's numbers.
2. **Verify by eye.** The per-point page
   (`docs/research/placement-review.html`) shows every point with its video.
   Filter to the newly admitted serves and confirm the dots sit where the ball
   actually landed. This is the gate: nothing ships before it.
3. **Flip the flag**, web and iOS together. Split platforms and the same match
   shows two different maps.
4. **Copy and the upload question** can land independently at any point.

Rollback is one `app_config` UPDATE. No data is rewritten: the rule is applied
at read time, so every existing `match.json` works under either setting and
nothing needs reprocessing.

---

## 8. Decisions needed

1. **The upload toggle's name.** It says "Placement maps" in five entry points
   (web upload, YouTube import, iOS record settings, iOS upload sheet, iOS match
   detail). Rename to "Serve placement" everywhere, or leave it and accept that
   the upload and the match page use different words?
2. **The landing page** currently sells "placement maps of serves, receives, and
   rally paths". Rewrite to serves only, or hold the page until finishing shots
   ship?
3. **Old matches.** A match processed before this keeps its `match.json`, so the
   new rule applies to it for free. Confirmed no backfill — worth stating out
   loud since it is the usual assumption otherwise.
4. **Heat map.** With serves only, is the heat map still worth two views, or does
   the exact-landings view carry it alone?

---

## Not in this spec

- Finishing shots / "the ball that won the point" (70 of 98, needs trajectories
  and an honest name)
- Wiring `first_server_decoder.py` into production
- Placement on the public share link
- Any change to `placement_reconstruction.py`. The eleven questions keep running
  and keep being stored: they are the raw material for a point-winner detector,
  and this spec only stops them from gating the map.
