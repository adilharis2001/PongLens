# Game-end indicator — design

**Status:** SHIPPED 2026-08-28. Two things changed from this
document during the build; both are recorded in section 12 at the end.
**Surfaces:** worker (already built), web scorekeeper, web point list, iOS
scorekeeper, iOS point list
**Kill switch:** `app_config.game_end_detection` (already exists, 140)

---

## 1. What this builds

When the worker finishes a match it already knows, from the video, where
the two players swapped ends of the table. Under the rules that is how a
game ends. This puts that knowledge on screen as a **marker between two
rallies**, in the same two places a game divider already appears:

- the **point strip in Keep score** (web `Player.tsx`, iOS `PlayerTakeover`)
- the **point-by-point list** (web `MatchView.tsx`, iOS `MatchDetailScreen`)

Tapping it opens a small sheet with two answers: the game did end here, or
it did not. Nothing else changes.

### The decision that shapes every other decision

**The marker never changes the score on its own.** It is drawn from
detector evidence, it is not folded into the boundary walk, and a match
that is never touched scores exactly as it does today.

This is a deliberate reversal of the 2026-07 design. `matchStructure.ts`
still contains `resolveMatchBoundaries`, which took v1 detector evidence
and *silently rewrote* the owner's game boundaries — inserting
`effectiveOverrides` that moved where games ended. That is dormant and
must stay dormant. A detector that is right 87% of the time and edits the
score is worse than no detector: the 13% is invisible and lands on the one
number the player came for.

So: **the detector proposes, the owner disposes.** The only way detector
evidence reaches the score is a human tapping "Game ended here", which
writes the same `game_end_override = 'end'` the owner could have written
by hand.

---

## 2. What already exists — do not rebuild it

Roughly two thirds of this is shipped and switched off. Read this section
before writing any code.

| Piece | Where | State |
| --- | --- | --- |
| The detector | `worker/side_change.py` | Done, measured |
| Frame/pose extraction | `worker/extract_side_changes_rtmpose.py` | Done |
| Post-ready worker stage | `worker/worker.py` `run_side_change_stage` (~4045) | Done, gated |
| Persistence to the DB | same, writes `matches.match_structure` | Done |
| Point-id mapping + gap times | `side_change.map_point_ids` | Done |
| Alignment guard | `side_change.assert_aligned` | Done |
| The flag | `app_config.game_end_detection` (140) | `'off'` |
| Anon read of the flag | policy in 140 | Done |
| The TypeScript type | `src/lib/types.ts` `SideChangeEvidence` | Done |

`matches.match_structure` already arrives on the client: both platforms
fetch the match row and the web one uses `select("*")`.

**What does NOT exist:** any UI, the iOS type, the dismissal column, the
shared display rule, the backfill for existing matches.

### The stored shape

`matches.match_structure.side_changes` is an array of:

```jsonc
{
  "kind": "side_change",
  "after_idx": 21,           // worker's rally index
  "before_idx": 22,
  "after_point_id": "uuid",  // absent if that rally has since been deleted
  "before_point_id": "uuid",
  "gap_t0": 631.4,           // SOURCE seconds: end of the rally before
  "gap_t1": 664.9,           // SOURCE seconds: start of the rally after
  "confidence": 0.86,
  "confirmed": true,         // false = diagnostics, never draw it
  "components": { ... }      // why it fired; never rendered
}
```

Alongside it: `status` (`"ready"` | `"withheld"`), `coverage`,
`algorithm`, `config`.

---

## 3. Copy

Per the project copy rules: plain, no subtitle under a heading, nothing
clever.

| Where | Text |
| --- | --- |
| List divider (web + iOS point list) | `Players changed ends` |
| Strip marker (Keep score, both) | a dashed hairline + `ends` |
| Sheet title | `The players changed ends here` |
| Sheet body | `This usually means the game ended.` |
| Primary button | `Game ended here` |
| Secondary button | `They just changed ends` |
| Cancel | `Cancel` |
| Flash after primary | `Game ended` (existing string) |
| Flash after secondary | `Hidden` |

### Why not "Game end detected"

That was the requested wording and it is very nearly right. The exception
is real and it is not rare: **in a deciding game the players change ends
at 5 points.** The detector sees that swap and cannot tell it from a game
ending, because there is no score to consult — and on an unscored match we
cannot suppress it either, since we do not yet know it is the deciding
game. So `Game end detected` would be a false statement, once per
five-game match, on the screen the player uses to score.

`Players changed ends` is true in every case, is the same length, and
still tells the scorer exactly what they need to know. The interpretation
moves into the sheet where the button says `Game ended here`, which is the
user's call rather than the product's claim.

If the original wording is preferred anyway, it is one constant:
`SIDE_CHANGE_LABEL` in `src/app/match/[id]/sideChanges.ts` and
`SideChanges.label` in `Core/SideChanges.swift`. Change both.

---

## 4. The shared rule

Which markers get drawn is one rule. Per the project standard it will
exist **twice** — TypeScript and Swift — so it gets a fixture, not two
readings of this document. This is the `placementAggregate.ts` /
`Placement.swift` lesson: one rule written twice was wrong the same way in
both, for eight months.

### New file: `src/app/match/[id]/sideChanges.ts`

```ts
import type { MatchStructureEvidence, Point, SideChangeEvidence } from "@/lib/types";
import type { GameBoundary } from "./gameScore.ts";

export const SIDE_CHANGE_LABEL = "Players changed ends";

/** How near a real score boundary suppresses a detected one. */
export const SCORE_BOUNDARY_SUPPRESS = 1;

export interface SideChangeMarker {
  /** The visible point this marker is drawn AFTER. */
  pointId: string;
  confidence: number;
  /** Anchored by id, or recovered from the gap when the point is gone. */
  anchor: "point_id" | "gap_time";
}

export function visibleSideChanges(input: {
  evidence: MatchStructureEvidence | null;
  /** The same list the dividers are drawn over — deleted points excluded. */
  visiblePoints: Point[];
  /** score.boundaryAfter from the shared walk. */
  boundaryAfter: ReadonlyMap<string, GameBoundary>;
  /** app_config.game_end_detection === 'on'. */
  enabled: boolean;
  /** tracksServe(match.match_type) — games are a scored-match construct. */
  scoredType: boolean;
}): SideChangeMarker[];
```

### The eight rules, in order

Each one has cost a mistake somewhere in this project or in the research.

1. **The flag is off → nothing.** `enabled === false` returns `[]`. Read
   at display time, so one `UPDATE` rolls the feature back with no deploy
   and every already-processed match follows it. (132 / 138 pattern.)
2. **Not a scored type → nothing.** `tracksServe(match_type)` is false for
   drills and practice. Games are a score construct; players routinely do
   not change ends in practice, so a marker there is noise. The worker
   already skips these types, but a match typed *after* upload has
   evidence and must not show it.
3. **Evidence not ready → nothing.** `evidence.status !== "ready"`. A
   withheld match is one the detector refused; refusing is the feature.
4. **Unconfirmed → skip.** Only `confirmed === true` is drawn. Everything
   else is diagnostics and must never reach a screen.
5. **Anchor to a visible point.** Prefer `after_point_id` when that id is
   in `visiblePoints`. Otherwise fall back to `gap_t0`: the last visible
   point whose `t1 <= gap_t0 + 0.25`. If neither resolves, drop the
   marker. *(Both clocks are SOURCE seconds and alignment was already
   established worker-side, which is precisely why `map_point_ids` stores
   the gap times.)*
6. **A real boundary within ±1 wins.** If `boundaryAfter` has an entry on
   the anchor point or either neighbour, drop the detected marker — the
   solid divider is already there and two dividers one rally apart read as
   a bug. Beyond ±1 the marker is drawn, and that disagreement is
   deliberate: the score saying one place and the video saying another,
   two or three rallies off, is a mis-scored point and is worth seeing.
7. **An owner answer within ±1 wins.** If any of those same three points
   carries `game_end_override !== null`, drop it. The owner has already
   ruled on this stretch of the match.
8. **Dismissed → drop.** `point.side_change_dismissed === true` on the
   anchor point.

Rules 6 and 7 look alike and are not the same thing: 6 is about the score
agreeing, 7 is about the owner having spoken. A `'continue'` pin satisfies
7 and produces no boundary at all, so 6 would let it through.

### Swift twin: `ios/PongLens/PongLens/Core/SideChanges.swift`

Same function, same rule numbers, same constants. Signature:

```swift
enum SideChanges {
    static let label = "Players changed ends"
    static let scoreBoundarySuppress = 1

    struct Marker: Equatable { let pointId: UUID; let confidence: Double
                               let anchor: Anchor
                               enum Anchor { case pointID, gapTime } }

    static func visible(evidence: MatchStructure?,
                        visiblePoints: [MatchPoint],
                        boundaryAfter: [UUID: GameBoundary],
                        enabled: Bool,
                        scoredType: Bool) -> [Marker]
}
```

### Parity fixture

`ios/Tests/fixtures/side-change-markers.json`, written by the **web**
implementation over real evidence (the same technique as
`serve-parity.json`), so the port is compared against the original rather
than against a second reading of this spec. One file, N cases:

```jsonc
{
  "cases": [
    {
      "name": "score boundary one rally later suppresses it",
      "evidence": { "status": "ready", "side_changes": [ ... ] },
      "points": [ { "id": "...", "t0": 0, "t1": 4.2, "deleted": false,
                    "game_end_override": null,
                    "side_change_dismissed": false }, ... ],
      "boundary_after": ["point-uuid"],
      "enabled": true, "scored_type": true,
      "expect": []
    }
  ]
}
```

Cases the fixture must contain, at minimum:

- flag off; not a scored type; `status: "withheld"`
- an unconfirmed change alongside a confirmed one
- anchor point deleted, recovered through `gap_t0`
- anchor point deleted, `gap_t0` recovers nothing → dropped
- score boundary on the anchor / one before / one after → suppressed
- score boundary three rallies later → **drawn** (the disagreement case)
- `game_end_override = 'end'` on the anchor → suppressed
- `game_end_override = 'continue'` on the anchor → suppressed (rule 7,
  not 6)
- `side_change_dismissed = true` → suppressed
- two confirmed changes in one match, one suppressed and one drawn

---

## 5. Database

### Migration `143_side_change_dismissed.sql`

```sql
-- 143: hiding a detected side-change marker.
--
-- The game-end indicator (140) draws a marker between two rallies where
-- the video shows the players swapping ends. It is informational: it
-- never changes the score. Two answers are offered and only one of them
-- needs storing — "Game ended here" writes the existing
-- points.game_end_override = 'end', which every surface already reads,
-- and "They just changed ends" writes this.
--
-- Deliberately NOT 'continue'. A 'continue' pin suppresses the automatic
-- 11-clear-by-2 rule from that point on, which is a real change to the
-- score; dismissing a marker must cost the owner nothing.
alter table points
  add column side_change_dismissed boolean not null default false;

comment on column points.side_change_dismissed is
  'Owner hid the detected side-change marker that sits after this point (143). Display only — never affects the boundary walk or the score.';

-- The authenticated role's UPDATE grant on points is column-scoped, so a
-- new column needs its own grant or every owner write to it is a 403,
-- silently rolled back by the optimistic writer. That is how 099 found
-- this the hard way.
grant update (side_change_dismissed) on points to authenticated;
```

**Verify after applying**, because a missing grant fails silently:

```sql
select privilege_type, column_name from information_schema.column_privileges
where table_name = 'points' and grantee = 'authenticated'
  and column_name = 'side_change_dismissed';
```

### No RLS change

`matches.match_structure` already travels on the owner's own row. The
share page (`/s/[token]`) reads through its own RPC, which does not select
`match_structure` — so shared matches show no markers, which is correct:
a marker is a control, and a stranger has nothing to answer with.

---

## 6. Web implementation

### 6.1 `src/lib/types.ts`

Add to `Point` (near `game_end_override`, ~line 416):

```ts
  // Owner hid the detected side-change marker after this point (143).
  // Display only — never read by the boundary walk.
  side_change_dismissed: boolean;
```

### 6.2 `src/lib/config.ts`

Add beside `getTapEndPlayback` (~line 161):

```ts
/**
 * The game-end indicator (2026-08-26, 140).
 *
 * On, a marker is drawn between two rallies where the video shows the
 * players swapping ends, in Keep score's strip and the point list. Off —
 * or on any fetch failure — no marker anywhere, and every match scores
 * exactly as it did. Applied at read time, so it covers matches
 * processed before the flag existed and rollback is one UPDATE.
 */
export const getGameEndDetection = cache(async (): Promise<boolean> => {
  return (await getConfigValue("game_end_detection")) === "on";
});
```

### 6.3 `src/app/match/[id]/page.tsx`

Call it alongside the other flags and pass the boolean into `MatchView`.
`select("*")` on `matches` already brings `match_structure`, and
`select("*")` on `points` already brings the new column once the migration
is applied — no select-list edits needed on the web.

### 6.4 New: `src/app/match/[id]/sideChanges.ts`

Section 4. Pure, no React, unit-tested.

### 6.5 `src/app/match/[id]/MatchView.tsx`

**a. Compute the markers** near `gameStarts` / `gameSegments` (~line 1244):

```ts
const sideChangeMarkers = useMemo(
  () => visibleSideChanges({
    evidence: match.match_structure,
    visiblePoints,
    boundaryAfter: score.boundaryAfter,
    enabled: gameEndDetection,
    scoredType: scored,
  }),
  [match.match_structure, visiblePoints, score.boundaryAfter,
   gameEndDetection, scored]
);
const sideChangeByPoint = useMemo(
  () => new Map(sideChangeMarkers.map((m) => [m.pointId, m])),
  [sideChangeMarkers]
);
```

**b. The writer**, beside `setGameWinnerOverride` (~line 1602). Same
optimistic shape as its neighbours — patch locally, write, roll back on
error:

```ts
const dismissSideChange = useCallback(
  async (point: Point) => {
    updatePoint(point.id, { side_change_dismissed: true });
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ side_change_dismissed: true })
      .eq("id", point.id);
    if (error) updatePoint(point.id, { side_change_dismissed: false });
  },
  [updatePoint]
);
```

**c. The list divider.** In the point map, immediately after the existing
`nextGame` divider block (~line 3638; `nextGame` itself is computed at 3364). It is an `else` — rule 6 already
guarantees they never both appear, and writing it as `else if` makes that
impossible to break by accident:

```tsx
{scored && !pfActive && nextGame === undefined &&
 sideChangeByPoint.has(point.id) && (
  <div className="mt-3 flex items-center gap-3">
    <span className="h-px flex-1 border-t border-dashed border-edge" />
    <button
      type="button"
      onClick={() => setSideChangeSheet(point)}
      className="rounded-full border border-edge px-2.5 py-1 text-xs
                 font-semibold uppercase tracking-wider text-zinc-500
                 transition-colors hover:border-cyan-glow/50 hover:text-zinc-300"
    >
      {SIDE_CHANGE_LABEL}
    </button>
    <span className="h-px flex-1 border-t border-dashed border-edge" />
  </div>
)}
```

**Dashed, not solid.** The solid hairline already means "a game ended
here, the score proves it". A detected marker is a different claim and
must not borrow the settled one's appearance. Dashed is the vocabulary the
strip already uses for *not yet answered* (unscored chips are
`border-dashed`), which is exactly what this is.

**The label is a real button**, not grey text — the project rule about
tappable things.

**d. The sheet.** Section 6.7.

### 6.6 `src/app/match/[id]/Player.tsx` — Keep score

**a. Props.** Add beside `onSetGameOverride` (~line 716):

```ts
    /** Detected side-change markers, keyed by the point they follow. */
    sideChanges?: ReadonlyMap<string, SideChangeMarker>;
    /** Hide a marker (143). Absent = the feature is off. */
    onDismissSideChange?: (point: Point) => void;
```

**b. The strip marker.** In the chip loop, beside `const ends =
score.boundaryAfter.get(p.id)` (~line 5782):

```ts
const changed = ends ? undefined : sideChanges?.get(p.id);
```

and after the existing `{ends && ( ... )}` block (~line 5903):

```tsx
{changed && (
  <button
    type="button"
    onClick={() => setSideChangeBreak({ pointId: p.id })}
    aria-label="The players changed ends here — tap to answer"
    title="Players changed ends"
    className="group flex h-8 shrink-0 flex-col items-center justify-center gap-1 rounded px-1"
  >
    <span className="block h-3 w-px border-l border-dashed border-zinc-600" />
    <span className="block rounded-full border border-dashed border-zinc-600
                     bg-ink/60 px-1.5 py-0.5 text-[9px] font-semibold
                     leading-none text-zinc-400 transition-colors
                     group-hover:border-cyan-glow/50 group-hover:text-zinc-200
                     group-active:border-cyan-glow group-active:text-cyan-glow">
      ends
    </span>
  </button>
)}
```

`ends` is the whole word the strip can afford. The existing divider's pill
holds `11-7`, four characters at 9px; anything longer changes the strip's
rhythm and pushes chips off screen on a 390px phone. The full sentence
lives in the sheet and in the accessibility label.

**c. The sheet**, modelled on the `gameBreak` sheet (~line 6932) and
sharing its scaffold:

```tsx
{open && sideChangeBreak && (
  <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 p-4 backdrop-blur-sm sm:items-center">
    <div className="ks-fade w-full rounded-2xl border border-edge bg-surface p-5 sm:max-w-xs">
      <h2 className="text-base font-semibold">
        The players changed ends here
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        This usually means the game ended.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button type="button" onClick={confirmSideChangeEnd}
          className="rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-4 py-2.5 text-sm font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20">
          Game ended here
        </button>
        <button type="button" onClick={hideSideChange}
          className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white">
          They just changed ends
        </button>
        <button type="button" onClick={() => setSideChangeBreak(null)}
          className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
```

**d. `confirmSideChangeEnd` calls the existing path, it does not copy it.**
`pinEndAt` (~line 3961) is already documented as *"every 'Game ended' path
lands here"*, and it does four things, not two: it pins the override
(undoably), stamps `explicitEndRef` so the "did it though?" overlay is
skipped for an end the user asked for, stamps `lastScoreTapRef` so the
score flash confirms, and asks who won when the closed score cannot say.
Re-implementing two of those four is how the marker's path would drift
from the flag button's.

```ts
const confirmSideChangeEnd = useCallback(() => {
  const id = sideChangeBreak?.pointId;
  setSideChangeBreak(null);
  const p = pointsRef.current.find((pt) => pt.id === id);
  if (p) pinEndAt(p);
}, [sideChangeBreak, pinEndAt]);
```

So a game ended from a marker is indistinguishable afterwards from one
ended by the flag button — undo, the winner question, the overlay
suppression and serve rotation all included.

Note the ordering consequence: pinning `'end'` makes `boundaryAfter` fire
on that point, so rule 6 removes the marker on the next render and the
solid divider takes its place. No extra bookkeeping.

### 6.7 The list sheet (`MatchView.tsx`)

The point list has no takeover, so this is a plain modal with the same
three buttons. `Game ended here` calls the existing `setGameEndOverride(
point, "end")`; `They just changed ends` calls `dismissSideChange`.

The list already asks the 099 winner question through the point detail
scorecard, so the sheet does not ask it again here.

---

## 7. iOS implementation

### 7.1 `Core/Models.swift`

**a.** Add to `MatchPoint` (after `gameWinnerOverride`, ~line 89):

```swift
    /// Owner hid the detected side-change marker after this point (143).
    /// Defaulted, matching `suggestion` above: `MatchPoint` is built
    /// memberwise in `CoachModels.swift` (~334) and a non-defaulted field
    /// breaks that call site.
    var sideChangeDismissed: Bool = false
```

plus `case sideChangeDismissed = "side_change_dismissed"` in
`CodingKeys`, and `side_change_dismissed` appended to `matchSelect`
(~line 146). **Both**: a `CodingKey` without the select column decodes as
missing, and `Bool` without a default then throws for the whole row.

**b.** New `MatchStructure` type. The app has never decoded this column:

```swift
/// The slice of matches.match_structure the app reads. Mirrors
/// src/lib/types.ts MatchStructureEvidence; per-point diagnostics stay
/// server-side.
struct MatchStructure: Codable, Hashable {
    let status: String?
    let sideChanges: [SideChange]?

    struct SideChange: Codable, Hashable {
        let afterPointId: UUID?
        let gapT0: Double?
        let confidence: Double?
        let confirmed: Bool?
        enum CodingKeys: String, CodingKey {
            case confidence, confirmed
            case afterPointId = "after_point_id"
            case gapT0 = "gap_t0"
        }
    }
    enum CodingKeys: String, CodingKey {
        case status
        case sideChanges = "side_changes"
    }
}
```

**c.** Add to `MatchRow`:

```swift
    let matchStructure: MatchStructure?
```

with `case matchStructure = "match_structure"` and `match_structure`
appended to `librarySelect` (~line 55).

> **Cost note.** `librarySelect` is also the library list's query, so this
> adds a JSONB blob to every row on the Matches screen. `compact_evidence`
> keeps it to the side-change array — a few hundred bytes for a typical
> match, since per-point summaries and pair verdicts go to R2 instead. If
> the library screen ever feels slower, split a `detailSelect` rather than
> trimming what the detail screen reads.

### 7.2 `Core/AppState.swift`

Mirror `tapEndPlayback` exactly (~line 84):

```swift
    /// app_config game_end_detection (140): a marker where the video
    /// shows the players swapping ends. False on any failure — a build
    /// that cannot reach the config behaves like the build before the
    /// flag existed.
    var gameEndDetection = false
```

and in `refreshConfigFlags`, add `"game_end_detection"` to the `.in(...)`
list and:

```swift
        gameEndDetection = rows?.first {
            $0.key == "game_end_detection"
        }?.value == "on"
```

### 7.3 New: `Core/SideChanges.swift`

Section 4's Swift twin. Pure, no SwiftUI.

### 7.4 `Screens/MatchDetailScreen.swift` — the point list

Compute markers where `score` is computed (~line 459), then in the
`ForEach` after the existing divider (~line 1374), as an `else if`:

```swift
if tracksServe, !filtersActive, let boundary = score.boundaryAfter[point.id] {
    Text("Game \(boundary.game) ends \(boundary.you)-\(boundary.them) · game \(boundary.game + 1) begins")
        ...
} else if tracksServe, !filtersActive, markers[point.id] != nil {
    Button { sideChangeSheet = point } label: {
        HStack(spacing: 8) {
            dashedRule()
            Text(SideChanges.label)
                .font(.plCaption)
                .foregroundStyle(PL.text400)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .overlay(Capsule().strokeBorder(
                    PL.text600, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
            dashedRule()
        }
    }
    .buttonStyle(.plain)
    .frame(maxWidth: .infinity)
    .padding(.vertical, 2)
}
```

`filtersActive` is already excluded for the same reason as the score
divider: with a filter on, the neighbouring rally on screen is not the
neighbouring rally in the match, so a between-rallies marker is a lie
about what sits either side of it.

### 7.5 `Screens/PlayerTakeover.swift` — Keep score

Beside `gameDivider` (~line 2092), and called from the ticker loop
(~line 2010) in the same `else` position:

```swift
if let ends = full.boundaryAfter[p.id] {
    gameDivider(p, ends)
} else if markers[p.id] != nil {
    sideChangeDivider(p)
}
```

```swift
    /// The video says they swapped ends and the score has not said so.
    /// Dashed, because the solid divider means "a game ended here and the
    /// score proves it" and this is a different claim.
    func sideChangeDivider(_ p: MatchPoint) -> some View {
        Button { sideChangeBreak = SideChangeBreak(pointId: p.id) } label: {
            VStack(spacing: 3) {
                Rectangle().fill(PL.text600)
                    .frame(width: 1, height: 10).opacity(0.6)
                Text("ends")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(PL.text400)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .overlay(Capsule().strokeBorder(
                        PL.text600, style: StrokeStyle(lineWidth: 1, dash: [2, 2])))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("The players changed ends here — tap to answer")
    }
```

The sheet reuses the `GameBreak` sheet's scaffold (~line 332) with the
three buttons from section 6.6c. `Game ended here` routes into the
existing `pinGameEnd` path (~line 2668) so undo, the winner question and
the flash all behave identically.

### 7.6 The dismissal write

`PointActions.swift` already owns every optimistic point-column write
through one `patch(point:fields:apply:)` helper, which handles the local
mutation, the update and the rollback. Add one function beside
`setBoundary` (~line 253) and write nothing by hand:

```swift
    /// Hide the detected side-change marker after this point (143).
    /// Display only: deliberately NOT a 'continue' override, which would
    /// suppress the automatic boundary rule and change the score.
    func dismissSideChange(_ point: MatchPoint) async {
        await patch(point, fields: ["side_change_dismissed": .bool(true)]) {
            $0.sideChangeDismissed = true
        }
    }
```

The equivalent on the web is its own `useCallback` because `MatchView`
has no such helper — see 6.5b.

> **Watch for the silent failure.** A missing column grant returns a 403
> that the optimistic writer rolls back with no visible error, and an
> expired preview session makes the update return 204 while changing
> nothing. Verify a dismissal survives a full refetch before calling this
> done.

---

## 8. Rollout

Four steps, in order. Steps 1 and 2 are not optional and neither produces
anything a user sees.

**1. Fix the tables first.** 22 of 62 sampled matches carry a quad from
the retired pink-rim calibrator, and near/far — which is what the whole
detector rests on — is decided by which side of that quad a player stands
on. `worker/recalibrate_from_clips.py --force` recovered 14 of 22 in the
research corpus and the other 8 were refused by the keypoint model, which
is the correct behaviour. Shipping the indicator on top of the bad quads
means shipping worse accuracy than has been measured.
See `docs/research/2026-08-26-game-end-detection.md`.

**2. Backfill existing matches.** The worker stage only runs post-ready,
so every match already in the library has no evidence at all — turning the
flag on shows nothing to anyone until they upload again. Run
`python3 -m worker.eval_side_changes --match <ids...> --persist`, which
extracts and writes `match_structure` without touching `first_server`.
Roughly 4 minutes of CPU per match, 138 ready matches.

**3. Ship the code with the flag off.** Every rule reads the flag at
display time, so the deploy is inert.

**4. Turn it on:** `update app_config set value = 'on' where key =
'game_end_detection';`

Rollback is the same statement with `'off'`. No deploy, no reprocess, and
dismissals already written stay harmlessly in their column.

---

## 9. Tests

**Web** — `src/app/match/[id]/sideChanges.test.ts`, one case per rule in
section 4, plus the fixture cases. Run with the existing `npm run test`
target.

**iOS** — `ios/Tests/SideChangeTests.swift`, loading
`fixtures/side-change-markers.json` and asserting the Swift port produces
the same markers as the web implementation on every case. This is the file
that catches a divergence; the per-rule unit tests do not, because both
sides would be written from the same misreading.

**What the tests must not do.** Do not assert what
`visibleSideChanges` returns for hand-made input and call that coverage —
that is the mistake `normalizePlacementCoordinates`'s test made, passing
for the entire eight months the maps were mirrored. At least the anchor
rules should be driven off real stored evidence with known point ids.

**Manual, before shipping:**

- A match with no `match_structure` renders exactly as today.
- Flag off → no marker on either platform.
- `status: "withheld"` → no marker.
- Pin a game end from the marker → marker becomes the solid divider.
- Dismiss → marker gone after a full page refresh (not just optimistically).
- A practice-typed match shows nothing.
- Web mobile at **393×660**, not 393×844 — the strip is the tightest
  layout in the product and the marker adds width between chips.
- iOS in landscape takeover, where the ticker is shortest.

---

## 10. Deliberately not in this change

- **`resolveMatchBoundaries` stays dormant.** It rewrites the owner's
  boundaries from detector evidence. It is not called by anything in this
  design and must not be revived by it.
- **No marker on the share page.** A stranger has no answer to give.
- **No marker in the point detail sheet.** Two surfaces was the request;
  a third would be a third place to keep in sync.
- **Nothing on the match card or library list.** A count of detected game
  ends is a different feature (section 11).
- **No notification, no email, no badge.**
- **First-server detection stays off.** 051's user-authority rules are
  untouched and the v2 stage never writes those columns.

---

## 11. Three ideas that would make this earn more

Ranked by usefulness to a person actually scoring a match. All are
additive to the above and none is needed for it.

### A. Show the disagreement, not just the detection (recommended)

The valuable case is not "the video says a game ended". It is **"the score
says the game ended here and the video says two rallies later"** — because
that gap is almost always a mis-scored point, and it is the one error a
scorer cannot find by re-reading their own score.

Rule 6 already draws these (it only suppresses within ±1). This idea is
to give them their own copy and a one-tap fix: `The score ends the game
two rallies earlier` with a `Move it here` button, which is exactly the
existing `moveGameBoundary` walk.

Cheap, because the machinery all exists, and it turns the indicator from
something you look at into something that corrects your scoring.

### B. Jump between games before anything is scored

An unscored match is one long undifferentiated strip. The detected
changeovers are the game boundaries, so they can drive the existing
`gameStarts` chips immediately — before a single point is scored. Scoring
a five-game match currently means scrolling; this makes "take me to game
3" work on a match you have not touched.

Small, and it is the change most likely to be felt on a long match.

### C. Offer the game end at the moment you reach it

In Keep score, when playback crosses a detected changeover the scorer has
not answered, surface the same two buttons inline for a few seconds rather
than waiting to be found in the strip. This is the highest-value version
and also the most intrusive; it should only be built after A and B have
been used for a while, and it needs a rule for never interrupting twice.

**My recommendation:** A, then B. A is nearly free given what rule 6
already does, and it is the only one of the three that makes the player's
score more accurate rather than just easier to navigate.


---

## 12. What actually shipped, and where it differs from above

Built and deployed 2026-08-28. Migration is **146**, not 143 — another
session took 143, 144 and 145 while this was being written.

### The suppression window is 3, not 1

Section 4 rule 6 proposed silencing a detected marker only when a real
boundary sat within ±1, and showing the ±2/±3 disagreement as a feature.
Adil's instruction on reading the spec was the opposite, and it is the
better call:

> "when we reach the actual game boundary, you can replace that indicator
> or separator with the end of the score... Even if it's not the exact
> end, if it's some other point... You can automatically delete the
> separator that's close by."

`SCORE_BOUNDARY_SUPPRESS = 3`, which is not a round number picked to
please: it is the owner's own measured scoring drift. Over 49 confirmed
fires, six landed one to four rallies from the scored boundary and every
one of those six fired on a LONGER break than the score had. The
changeover is the long gap; the score is what moved.

The idea in section 11A — surfacing the disagreement and offering to move
the boundary — is not dead, it is just no longer the default. It would
now be an explicit second state rather than a side effect of the
suppression window.

### The label is "Players changed ends"

Shipped as recommended, for the deciding-game reason in section 3.
`SIDE_CHANGE_LABEL` / `SideChanges.label` is one constant per platform if
that is ever revisited.

### Verified end to end on production

On `b7a01f05` (Lester 2, 118 rallies, 45 scored, five detections):

| | result |
| --- | --- |
| markers drawn in the point list | 3 |
| score dividers | 2 |
| detections silenced by a nearby boundary | 2 |
| Keep score strip | the same 3 and 2 |

"They just changed ends" wrote `side_change_dismissed`, the marker count
went 3 → 2, and it stayed 2 through a full reload — so the column, the
grant and the read path all work. "Game ended here" wrote
`game_end_override = 'end'` and the marker turned into a score divider:
3 → 2 markers, 2 → 3 dividers, in one tap. Both were undone afterwards;
the match carries only the two pins it had before.

### Two things bit during the build, both worth remembering

**A long transaction blocked the migration for twenty minutes.** Another
session's `research_reprocess.py` held an hour-long transaction on
`public.points`, and `ALTER TABLE` needs an exclusive lock. Waiting for it
without a `lock_timeout` would have queued AHEAD of every other query on
that table and stalled the app and the worker behind it, so the fix was a
3-second timeout and a retry every minute — it landed on attempt 20. Then
`backfill_side_changes` did the same thing to itself: psycopg2 holds a
transaction open from the first statement until a commit, so the
eligibility read was still holding a lock four minutes into a four-hour
run. It commits that read now.

**Two uncommitted scripts were deleted mid-session** by another session's
`git clean`, and a commit was lost to another's `git reset`. Both were
recovered, but the rule stands and it is already in CLAUDE.md: with
concurrent sessions on one checkout, commit early and check `git log`
before pushing.
