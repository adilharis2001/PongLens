# The placement maps are mirrored left to right

2026-08-23. A bug, its evidence, and what it does and does not touch.

Every placement map PongLens has ever drawn shows the ball on the wrong
side of the table. Not sometimes: every landing, every match, every game,
both cameras. Depth is right; left and right are swapped.

It surfaced because a player looked at a map of what his opponent served
him and said it was the opposite of what he remembered.

---

## The evidence

For every serve landing, compare **which side of the table's centre line
the ball is on in the video** with **which side of the map the app draws
it on**. Both in pixels, neither relying on a comment.

| match | camera | user | landings | drawn correctly | mirrored |
| --- | --- | --- | --- | --- | --- |
| Chris (`ec6490f4`) | side, near end at image-left | near | 79 | 8 | **71** |
| Julian (`7e02fbb9`) | side, near end at image-right | far | 37 | 5 | **32** |

The few that agree are landings within a couple of centimetres of the
centre line, where the classification is a coin toss. The mirror is
uniform across all nine games in the two matches.

Un-mirrored, the numbers match what the player remembered:

| Chris's serves to him | left (BH) | middle | right (FH) |
| --- | --- | --- | --- |
| as shipped | 1 | 18 | **24** |
| un-mirrored | **24** | 18 | 1 |

---

## The cause

The worker builds the table homography onto this destination quad, in all
three places it is built (`table_coordinates.py`,
`vision_table_calibration.py`, `placement_retry_calibration.py`):

```python
destination = [[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]]
```

against corners canonicalised as `A` near-left, `B` near-right, `C`
far-right, `D` far-left, **left and right as the camera sees them**. So:

> **`u = 0` is corner `A`: the near end, camera-left. `v = 0` is the near
> end line.**

Measured on 1,020 real bounces across the two matches: 100% of bounces
with `u < 0.3` fall on the `A–D` sideline, 0% of those with `u > 1.22`.
The `v` axis is not flipped (100% / 0% on the same test).

**Camera-left at the near end is the NEAR player's left.** The near end is
by construction the one lower in the frame, so the near player faces
roughly away from the camera and their left hand is on the camera's left.
It follows that the same sideline is the FAR player's right.

The client believes the opposite. `Core/Placement.swift` says so out loud:

```
// u across the table width (0…1.525, 0 = the near player's
// image-right sideline)
```

So `normalizePlacementCoordinates` mirrors for a near player when it
should not, and fails to mirror for a far player when it should. Both
branches are wrong the same way, which is why a match looks wrong whether
the player was near or far.

### Not the game side-swap

Worth stating because it was the first suspicion. `physicalSideForGame`
is correct: `v` is not flipped, every landing sits on the correct half,
and the mirror is uniform across games rather than alternating. A broken
end-swap would smear bounces across both halves on odd games. It does not.

### Not the handedness label

The owner's stored handedness is `right`, so BH-left / FH-right is the
correct labelling. The labels are fine; the dots are on the wrong side of
them.

---

## What does NOT change

- **No reprocessing.** The stored `u` is a correct, self-consistent table
  coordinate. Only the reading of it is wrong.
- **No worker code change, and no worker restart.** Nothing in the worker
  makes a left/right decision from `u`; `placement_reconstruction.py`
  uses `v` for its half checks and `u` only for bounds.
- **No migration, no data rewrite.** The fix is at read time, so every
  match ever processed is corrected the moment the client ships.

This is the same property that made the serve rule cheap: the placement
JSON is raw measurement, and interpretation lives in the client.

---

## The fix

Four functions carry the same mirror. They must move together.

| file | function | today | becomes |
| --- | --- | --- | --- |
| `src/lib/placement/placementAggregate.ts` | `normalizePlacementCoordinates` | near: `W - u` / far: `u` | near: `u` / far: `W - u` |
| `src/app/match/[id]/placementTable.tsx` | `makeMapXY` | `fu = near ? 1 - u/W : u/W` | `fu = near ? u/W : 1 - u/W` |
| `ios/.../Core/Placement.swift` | `normalizePlacementCoordinates` | same as web | same as web |
| `ios/.../Components/PlacementMapView.swift` | `mapXY` (line ~348) | same as web | same as web |

`v` is untouched in all four.

Splitting them is the danger: `makeMapXY` backs the per-point trajectory
map and `normalizePlacementCoordinates` backs the aggregate and the heat
map. Fix one and the same match disagrees with itself on one screen.

### Why swap constants rather than derive it

The honest fix would read the calibrated corners at draw time and work out
which sideline is the bottom player's left, so an unusual camera could not
reintroduce this. That is not available: the corners live in `match.json`
in R2, and neither the match page nor the share page loads it. Plumbing
them through, and backfilling them for every existing match, is a much
larger change than the bug warrants.

So the convention stays an assumption — but a **documented and tested**
one, which is exactly what it was not.

---

## The test that would have caught this

This is the part that matters. A test asserting `normalize(0.1, "near")
=== 1.425` passes just as happily before and after the fix; that is the
test that exists today, and it is why the bug survived.

The replacement is grounded in real geometry:

1. A fixture of **real corner pixels plus real bounces carrying BOTH**
   pixel `(x, y)` and table `(u, v)` — from both matches, so two camera
   placements and both user sides are covered.
2. For each bounce, work out from the **picture** which side of the
   centre line it is on, and which side corner `A` is on.
3. Assert the fixture's precondition: the near end line is lower in the
   frame. If a camera ever violates it, the test says so rather than
   passing quietly.
4. Derive the bottom player's left from that, and assert the production
   `normalizePlacementCoordinates` puts the bounce on that side of the
   drawn map.

Plus two more:

- **`makeMapXY` against `normalizePlacementCoordinates`**, over a grid of
  `(u, v)` and both bottom sides, so the per-point map and the aggregate
  can never disagree again.
- **The iOS port against the same fixture**, so the phone cannot drift
  from the browser.

---

## Rollout

Ship it straight. There is no flag and there should not be one: the two
states are "wrong" and "right", and gating that only prolongs the wrong
one. The serve-placement flag is unrelated and stays as it is — turning
it off would not help, because the per-point map is mirrored too and has
never been behind it.

The web is correct the moment it deploys, for every match in the library.
iOS lags by an App Store release, so phones stay mirrored until then.
That is worth saying to anyone reading a map on a phone in the meantime.

---

## What actually shipped

The fix went out on **TestFlight build 45**, archived from `a335f4d6` —
three commits after `4683ba4d`. It is in testers' hands.

A note on how that was nearly misreported, because the mistake is easy to
repeat. The commit that sets `CURRENT_PROJECT_VERSION = 45` is `6cc3e170`,
which is BEFORE the fix. Reading that as "build 45 was cut here" is wrong:
the number stays put until someone bumps it, so an archive taken anywhere
between `6cc3e170` and the bump to 46 carries version 45, fix included.

**A build number tells you when it was last bumped, not what was archived.**
To learn what is in a build, look at the archive: its `CreationDate`, the
`WorkspacePath` in its DerivedData, and the HEAD of the worktree that path
points at. For build 45 that is `.claude/worktrees/coach-side` at
`a335f4d6`, clean, with the corrected line in `Core/Placement.swift`.

Build 46 exists as a number on `main` with no archive behind it, which is
harmless — the next archive takes it.

## Not in this spec

- Deriving the orientation from calibration at draw time (see above).
- The `placement_mapped_points` column over-reporting against what the
  page shows. Cosmetic, admin-only.
