# Web "+" (insert a missing rally) — read-only study

Repo: /home/user/PongLens. All paths below are under `src/app/match/[id]/` unless
stated. Nothing was run; every claim is from reading the code. One finding
(W2) is a behaviour inferred from the DOM/React ordering and has not been
confirmed in a browser.

**First thing to know:** what shipped is NOT what the design doc
(`docs/superpowers/specs/2026-08-30-missing-rally-insert-and-serve-rotation-design.md`)
describes. The spec planned an "Insert" tab inside the Modify sheet, a
`runInsertPlan` in `modifyOps.ts`, and a full undo entry. What exists is a
standalone sheet (`InsertPoint.tsx`) that plays the RAW upload instead of
the cut, its own geometry module (`insertGeometry.ts`), the RPC call inline
in `MatchView.tsx`, and no undo of any kind.

---

## 1. THE FLOW

### 1a. Where the "+" appears (Player.tsx)

- `insertOffers` (Player.tsx:4385-4428): for the visible timeline filtered
  to cards with `cut_t0`, one offer per seam that passes
  `gapWorthOffering(prev, next, pad)`, keyed by the NEXT card's id (so it is
  drawn before that chip). The head-of-match offer is keyed by the first
  card with `prev: null` (4403-4414).
- `gapWorthOffering` (insertGeometry.ts:232-253): a one-sided seam (start or
  end of match) ALWAYS offers; a two-sided seam offers when
  `gapTo - gapFrom >= 4` source seconds (`GAP_WORTH_OFFERING_S`, 230). The
  4s line is measured on the SOURCE gap (`next.t0 - prev.t1`), not on what
  the cut removed.
- `insertHere` (4439-4448): only the two seams touching the current card
  (`targetId` and the clip after it) actually render a button. `insertTail`
  (4463-4477): the after-the-last-card offer, only while standing on the
  last card.
- Buttons at 6513-6540 (between chips) and 6709-6737 (tail); both call
  `pauseBoth()` then `setInsertSeam(offer)`. Owner-only because
  `onInsertPoint` is `isOwner ? insertMissingPoint : undefined`
  (MatchView.tsx:2977).
- Tooltip/aria (4451-4459): "Add a rally before the first one." / "Add a
  rally after the last one." / `The video skips ${round(next.t0 - prev.t1)}
  seconds here. Add a missing rally.`

### 1b. What opens and what video it plays (InsertPoint.tsx)

- Mounted at Player.tsx:8206-8223 inside the Player root, as a z-30
  `absolute inset-0` overlay (InsertPoint.tsx:294). Title "Add a missing
  rally", Cancel, "New card" chip between the two neighbour number chips
  (343-354), Replay/Pause, the track, a caption, "Who won it?" (Not sure
  yet / you / them), "Add card".
- On mount it POSTs `/api/media-url` with `{ matchId, rawPreview: true }`
  (103-107). The route (`src/app/api/media-url/route.ts:320-347`) resolves
  `matches.raw_path` ONLY (not the source job's `input_path`), HEAD-checks
  R2, and returns `{ url, available: true }` with a 6-hour inline presign;
  otherwise `{ available: false }`.
- If available: `source = { kind: "raw", url, offset: Number(data.trimStartS ?? 0) || 0 }`
  (114-119). If not available, or the fetch throws: falls back to the cut
  video (`videoUrl` prop = the Player's presigned cut preview, Player.tsx:1807-1825)
  with `offset: 0` (120-126).
- The `<video>` is muted, `playsInline`, `preload="metadata"` (312-322).
  Once `source` is set, an effect seeks to `win.t0` and calls `play()`
  (164-170).
- `videoTimeFor(s)` (137-143): raw → `s + offset`; cut → `sourceToCut(seam, s)`.
  `canWatch` (145-149): raw → always true; cut → `playableAt(seam, s)`.
- The "not in this video" overlay (329-338, copy: "The original video for
  this match has expired, so this stretch can't be shown. You can still add
  the rally.") and the hatched amber band (390-401) only appear on the cut
  fallback.

### 1c. How the user picks the window

Coordinate space is SOURCE seconds throughout (insertGeometry.ts:14-23).

- `seam = seamBetween(prev, next, pad)` (InsertPoint.tsx:75; insertGeometry.ts:73-102):
  ```
  spanOf(p):  rallyStart = cut_t0 + effPre      (effPre = tight_start ? min(pad.pre, 0.3) : pad.pre)
              rallyEnd   = rallyStart + max(0, t1 - t0)
  gapFrom = prev ? prev.t1 : next.t0 - 15        (OPEN_END_S = 15)
  gapTo   = next ? next.t0 : prev.t1 + 15
  removed = prev && next ? max(0, (next.t0 - prev.t0) - (next.rallyStart - prev.rallyStart)) : 0
  continuous = removed < 0.25                    (CONTINUOUS_S)
  from = prev ? prev.t0 : gapFrom ;  to = next ? next.t1 : gapTo
  ```
  A neighbour with null `cut_t0`/`t0`/`t1` cannot anchor (`spanOf` returns
  null, 44-51); with neither anchor the seam is null and the sheet renders
  nothing (InsertPoint.tsx:250).
- Default window (`defaultWindow`, 155-160): the gap itself when
  `gapTo - gapFrom >= 1.5`; otherwise a 1.5s window centred on the gap's
  midpoint, clamped. (Smeared-rally case: the missing rally is inside the
  neighbours, so the window straddles the seam.)
- Limits (`bounds`, 163-168):
  ```
  lo = prev ? prev.t0 + 0.3 : seam.from        (EDGE_S = 0.3)
  hi = next ? next.t1 - 0.3 : seam.to
  ```
  i.e. the window may reach INTO either neighbour's rally but must leave it
  at least 0.3s. Min length `MIN_LEN_S = 0.5` (142). No clamp to the raw
  file's real duration exists (see W8).
- Handles: exactly two pointer-drag handles (410-428), plus tap-anywhere on
  the track to seek (371-374). Drag = `onHandleDown` (pointer capture,
  pauses the video, 192-204) → `onHandleMove` → `moveHandle` (insertGeometry.ts:182-195):
  ```
  start: t0 = min(max(to, lo), w.t1 - 0.5)
  end:   t1 = max(min(to, hi), w.t0 + 0.5)          (both rounded to 0.01)
  ```
  and `seek(s)` scrubs the video to the finger. There are NO step buttons
  (−1s/+1s), no keyboard nudges, no split-style markers. Track shows the two
  neighbours' rally bands (377-389), the cyan window (402-409), a white
  playhead line (429-433). Caption (436-442):
  `${len.toFixed(1)}s[ · Ns not available] · drag the handles to where the rally starts and ends`.
- Playback: `togglePlay` (225-234) plays from `win.t0` if the playhead is
  outside the window; `onTime` (236-248) pauses at `win.t1` on the raw.
- "Add card" is disabled when `busy || len < 0.5 || win.t0 < lo - 0.01`
  (483). Label "Adding…" while busy.

### 1d. What is written

`confirm()` (263-267): `w = clampWindow(seam, win)`; `onInsert(w.t0, w.t1, cutT0For(seam, w, pad), winner)`.

→ Player `doInsert` (4479-4505): guards `insertBusy`, awaits
`onInsertPoint(prev, next, t0, t1, cutT0, winner)`; on false shows toast
"Couldn't add that rally. Try again." and leaves the sheet open; on true
closes the sheet and flashes "Rally added. Serve rotation updated."

→ MatchView `insertMissingPoint` (2203-2251):
```
supabase.rpc("insert_point", { p_prev_id, p_next_id, p_t0: t0, p_t1: t1, p_cut_t0: cutT0 })
```

→ `public.insert_point` (`supabase/migrations/101_insert_point.sql`), SECURITY DEFINER:
1. auth required (39-41); at least one neighbour (42-44); `t1 > t0` and
   `t1 - t0 >= 0.5` (45-51).
2. Locks each neighbour `for update` through `matches.user_id = auth.uid()`
   (54-80); both must be the same match.
3. Swallow guards: `p_t0 >= prev.t0 + 0.3`, `p_t1 <= nxt.t1 - 0.3` (84-89).
   Mirrors `bounds()`.
4. INSERT (91-115): `idx = max(idx)+1`, `t0/t1`, `cut_t0 = greatest(coalesce(p_cut_t0,0),0)`,
   `edited = true`, `tight_start = (prev exists)`, `tight_end = (next exists)`.
5. Neighbour trims (122-131): `prev.t1 := p_t0` if `prev.t1 > p_t0`;
   `nxt.t0 := p_t1` if `nxt.t0 < p_t1`; each set `edited = true`. Their
   `tight_*` flags and `cut_t0` are deliberately untouched (117-121). Note
   the spec (§4.1 step 3) said the moved edge would be TIGHTENED; the
   migration chose the opposite ("following adjustPatch").
6. Clears serve corrections (136-142):
   `server_override = null` on every non-deleted point of the match with
   `(coalesce(t0, 9999999), idx) > (p_t0, new.idx)`.
7. Returns the new row only (144). The spec's "plus the neighbours'
   patches" was not built; the client re-derives them.

There is no later migration touching `insert_point` (grep over
`supabase/migrations` finds only 101).

### 1e. Client mirror after the RPC (MatchView.tsx:2221-2242)

- `addSplitPoint(created)` appends the returned row (2184-2188); ordering
  comes from `sortPoints` (gameScore.ts:292-299: by `t0`, then `idx`).
- `updatePoint(prev.id, { t1: t0, edited: true })` if `prev.t1 > t0`;
  `updatePoint(next.id, { t0: t1, edited: true })` if `next.t0 < t1`.
- Locally nulls `server_override` on visible points with `t0 > t0` (2231-2236).
- `scheduleReclip()` (2240) — a 4s debounced enqueue of one `kind='reclip'`
  job for the match (2176-2182; `enqueueReclip` 2161-2174 skips if a
  `queued` reclip job already exists for the match).
- `setWinner(created, winner)` as a SECOND write if a winner was chosen
  (2241; 1539-1566).

---

## 2. AFTER INSERT

- **clip_path:** null. The RPC's insert list (101:91-92) has no clip_path.
- **edited:** true from birth (101:109). Also on any neighbour whose edge
  moved (101:124, 130).
- **Reclip:** scheduled by the client only, after the 4s debounce
  (MatchView.tsx:2176-2182). The worker's `process_reclip`
  (`worker/worker.py:5228-5350`) selects `edited and not deleted` points
  (5264-5271), downloads the source job's `input_path` (5282-5288), applies
  the library trim so timestamps line up (5296 → `apply_source_trim`
  3558-3573), ffmpeg-cuts `[t0 - p_pre, t1 + p_post]` with
  `p_pre = min(pre, 0.3) if tight_start else pre` (5315-5329), uploads to
  R2, and sets `clip_path` + `edited = false` only if `t0/t1` are unchanged
  (5338-5343). Raw gone → `clip_path = null, edited = false` (5298-5310).
- **What the new card shows until then:**
  - Strip chip (Player.tsx:6541-6595): renders (it has a `cut_t0`) with a
    spinning cyan ring; `title="Updating clip"`; aria-label suffix
    ", updating clip"; the current-chip glow/ring is suppressed while
    `edited` (6553). Countdown ring is replaced by the spinner (6596).
  - Point list row: "Updating clip" pulse (MatchView.tsx:3749-3753).
  - Point view (PointDetail.tsx:504-512): "Updating clip…" placeholder while
    `!clip_path && edited`; once the worker gives up (raw gone) it becomes
    "Clip unavailable — the original video has expired, but your timing
    edits are saved."
  - Poll: MatchView.tsx:2432-2452 refreshes `t0,t1,clip_path,edited,deleted,tight_*`
    every 8s while any visible point is `edited`.
- **Playback of the new card before its clip exists:** `ownClipSet` keeps
  only flagged cards that already HAVE a `clip_path` (Player.tsx:1751-1756),
  so the card plays from the CUT at its `cut_t0`. Correct on a continuous
  seam; wrong footage on a removed seam (comment at 1746-1750 calls this
  "today's behaviour until processing finishes"). Once `clip_path` lands
  through the poll, `ownClipIds` (insertGeometry.ts:326-367, retrofit rule:
  `idx` larger than a later card's) flags it and the detour surface plays
  its own clip (Player.tsx:1855-1895 enter/exit, 1963-1992 hand-off during
  play, 5405-5460 the element, 2221-2337 its end handling).
- **Can the user Modify the inserted point before its clip exists?** Yes,
  partly. Pad Modify (`tapModify` 4111-4117) opens `ModifyClip` with
  `adjustLocked={modifyPoint.edited}` (8202). Only Adjust locks
  (ModifyClip.tsx:948 disables Save; 750 disables the step buttons; 770-775
  copy "This clip is still updating from an earlier change — try again in a
  moment."). Split (957) and Join (966) stay ENABLED on an `edited` card.
  Point view: same (`clipLocked = point.edited`, PointDetail.tsx:269) and the
  Modify button shows whenever the card has timing (421-424). Note
  ModifyClip has no detour awareness (grep for ownClip/detour: none), so it
  plays the CUT at `geometryOf(point)` (133, 192-199): for an inserted card
  on a removed seam the Modify sheet shows the wrong footage, before AND
  after the clip exists.
- **Can the user insert again immediately?** Yes. `insertBusy` only guards
  the in-flight RPC (4486-4496). After success the offers recompute from
  the new `points` (memo deps 4428); the new card has a `cut_t0` and
  becomes a neighbour. Nothing locks a seam whose neighbours are `edited`
  (spec §4.5 "the tab locks exactly as Adjust does" was not built; the RPC
  has no such check).

---

## 3. THE SERVE ROTATION

Plain terms: who served is never stored per point (except an explicit
correction). `computeServing` (serving.ts:108-226) walks the visible cards in
order and counts: two serves each, alternating; one each from 10-10; the
first server swaps at each game boundary (from the same boundary walk the
score uses, gameScore.ts). A card that goes missing shifts every later card
one serve earlier, so from the gap on the app is wrong on every OTHER card.
Putting the card back restores the count, and everything downstream (server
chips, the score line, the deuce switch, where games end) comes right by
itself.

- **Where it re-runs:** `serving = useMemo(() => computeServing(visiblePoints, firstServer), ...)`
  (MatchView.tsx:1130-1133) and `score = computeMatchScore(visiblePoints)`
  (1034-1037). Both depend on `visiblePoints`, which is `sortPoints(points)`
  minus deleted (1003-1007). `addSplitPoint` and the two `updatePoint`
  trims mutate `points`, so the next render recomputes both and passes them
  to the Player as `serving`/`score` props (2959-2960). **The strip's
  chips, serve balls and ticker re-render immediately, with no refetch.**
- **Why corrections after it are cleared:** a `server_override` is a pin
  against the old count. After the insert every later card's expected
  server flips, so an old override that "fixed" the symptom now contradicts
  the corrected walk and, because a contradicting override restarts a
  two-serve block and flips the game's first-server parity
  (serving.ts:147-155), it would double-correct. Same rule as
  `set_server_override` (100_server_override_anchor.sql:54-70). Overrides
  BEFORE the new card stand. The RPC clears by `(t0, idx)` tuple
  (101:142); the client mirror clears by `t0 > t0` only (2231-2236) — same
  result except on an exact `t0` tie.
- **Asymmetry worth knowing:** deleting or restoring a card also changes the
  count, but neither clears any correction (`undoDelete` 1798-1816 flips
  `deleted` only; migration 100:57 keeps deleted rows' overrides "in case
  they are ever restored"). So a delete followed by hand-taped overrides,
  then a restore, produces exactly the double-correction insert guards
  against.

---

## 4. cut_t0 FOR THE INSERTED CARD

`cutT0For` (insertGeometry.ts:207-210):
```
eff    = effectivePad(pad, !!seam.prev, !!seam.next)   // pre = prev ? min(pad.pre, 0.3) : pad.pre
cut_t0 = max(0, round((sourceToCut(seam, w.t0) - eff.pre) * 100) / 100)
```
`sourceToCut` (113-125) is the only source→cut map, and it is piecewise:
```
s <= prev.t1            → prev.rallyStart + (s - prev.t0)      // inside prev's rally: exact
s >= next.t0            → next.rallyStart + (s - next.t0)      // inside next's rally: exact
otherwise (in the hole) → prev ? prev.rallyEnd : next ? next.rallyStart : 0   // HOLD at the seam
```

Cases:
- **Window starts inside prev (dragged back):** `cut_t0 = prev.rallyStart + (t0 - prev.t0) - 0.3`.
  Footage is genuinely in the cut.
- **Window starts in the gap (the default):** `cut_t0 = prev.rallyEnd - 0.3`.
  Jose fixture: `30.32 - 0.3 = 30.02` (test 144-154). This is the same
  shape as a split child (`modifyOps.childCutT0Of`, 80-82: anchor +
  `(at - min(pad.pre, 0.3))`), i.e. 0.3s before prev's deciding shot,
  INSIDE prev's span.
- **Head insert (no prev):** `sourceToCut` returns `next.rallyStart`, `eff.pre = pad.pre`
  → `cut_t0 = next.cut_t0 + next.effPre - pad.pre`, which equals
  `next.cut_t0` unless `next` is `tight_start`.
- **Tail insert (no next):** `prev.rallyEnd - 0.3`.
- The RPC then applies `greatest(coalesce(p_cut_t0, 0), 0)` (101:107).

**Seams.** The written `cut_t0` never depends on `removed`. Only `w.t0` is
mapped; the card's length is the source length `t1 - t0`. Its virtual span
on the cut clock (`spanOf`) is therefore `cut_t0 + 0.3 + (t1 - t0)`, which
OVERHANGS `next.cut_t0` by about `removed` seconds on a removed seam. That
overhang is exactly what `needsOwnClip` measures (274-306):
```
prev && next:   next.rallyStart - prev.rallyEnd + 0.5 < (t1 - t0)   → play own clip
prev only:      cutDuration - prev.rallyEnd + 0.5 < needed
next only:      next.rallyStart + 0.5 < needed
```
(Terry 2 card 45: 690.6+1.0 - (670.5+1.0+8.4) + 0.5 = 12.7 < 14.5 → true.)
`ownClipIds` (326-367) only lets a RETROFITTED card (idx > some later
card's idx) take a two-sided detour, so the insert's virtual span never
flags a real neighbour. `playableAt` (128-134) and the "hold" branch of
`sourceToCut` exist for the sheet's cut-fallback preview only; nothing in
the DB records that the seam had footage removed.

**Clocks.** `t0/t1` are in the TRIMMED-source timebase (the pipeline cuts a
library upload to its trim window first, worker.py:7475-7482, 3558-3573);
`cut_t0` is in the cut's timebase; both independent of trim. Only the raw
PREVIEW needs `trim_start_s` added (InsertPoint.tsx:30-33) — see W1.

---

## 5. WORKER DEPENDENCY, EXACTLY

**Instant (no worker involved):** the row; its place and number in the
strip; the score; the serve rotation and game boundaries; the neighbours'
`t0/t1` trims; the cleared corrections; the winner write; deleted-span
maths; Keep-score playback of the card from the cut video — which shows the
right footage only when the seam is continuous (`removed < 0.25s`, 55% of
seams per the migration header).

**Waits on the Mac Studio worker** (polls every 2s, `POLL_SLEEP_S`
worker.py:301, one job at a time; and only after the client's 4s debounce
has actually fired, W6):
- the inserted card's `clip_path` — so: the point view's player, share/reel
  of that card, and the Keep-score DETOUR that shows the right footage on a
  removed seam (Player.tsx:1751-1756 requires `clip_path`);
- the trimmed neighbours' re-cut clips;
- clearing `edited` on all three — the chip spinner, "Updating clip"
  labels, the Adjust lock, and the 8s poll all persist until then.
If the raw is gone the worker nulls `clip_path` and clears `edited`; the
card is permanently clipless (PointDetail.tsx:508-512).

**Never happens:** the cut video is not re-assembled (insertGeometry.ts:257-265;
spec §5). Placement/scoring pipelines are not re-run for the card.

---

## 6. WEAKNESSES (bugs, races, UX gaps)

**W1. The raw preview plays at the wrong offset on every trimmed upload.**
InsertPoint.tsx:108-119 reads `data.trimStartS`; the route's `rawPreview`
branch (route.ts:320-347) returns only `{ url, available }`. `trim_start_s`
lives in `jobs.options` of the source job (096_commerce.sql:746;
worker.py:3569), which the route never reads (it selects `job_id` at 241
but not options). So `offset` is always 0 and the footage shown is
`trim_start_s` seconds EARLY (the file's own comment cites 236.6s on the
match it was built against). Marks and the written `t0/t1` are unaffected;
only the picture lies. Repro: any library upload with a trim start, tap
"+", compare what plays with the chip numbers.

**W2. The opening auto-play starts at 0:00 of the file, not at the gap.**
`seek()` (151-158) only sets `currentTime` when `readyState >= 1`; the
effect that seeks-and-plays (164-170) runs in the same commit that mounts
the `<video>` (311-323), before metadata can have arrived; there is no
`onLoadedMetadata` pending-seek (the Player and ModifyClip both have one:
Player.tsx:1827-1828, 1946-1948). `play()` starts at 0, then `onTime`
(239-243) drags the playhead to ~0 and the white line pins to the left
edge. Recovery: press Replay (232 seeks because `playhead < win.t0`). Not
confirmed in a browser, but the ordering is deterministic.

**W3. No undo, and no inverse.** `doInsert` pushes no `UndoEntry` (the
eight `setUndoStack` sites are 3868, 3999, 4053, 4178, 4202, 4327, 4512,
4930; none is insert); `insertMissingPoint` sets no snackbar; Cmd/Ctrl+Z
does nothing; there is no `uninsert` RPC (split has `unsplit_point`). The
only way back is Delete on the new card, which leaves `prev.t1`/`next.t0`
trimmed, both neighbours re-cut, the downstream corrections cleared, and a
Removed dot. Spec §4.4 promised a fully reversible entry.

**W4. Neighbours are trimmed without the user being told.** The sheet draws
the neighbour bands (377-389) but no copy says "this shortens card 2 by
1.3s"; after confirm the only trace is the neighbour chip's spinner. And
because the RPC leaves tight flags alone (101:117-121), the trimmed
neighbour is re-cut with its FULL pad on the moved edge (worker.py:5316-5317):
prev's new clip runs `pad.post` (1.6s at normal) into the inserted rally
while the inserted clip starts 0.3s before it — the double-padded shared
moment that `TIGHT_PAD` exists to prevent (clipEdit.ts:36-42).

**W5. Between insert and reclip, a removed seam plays the wrong footage under
the new card's number, and the pause lands inside a later rally.**
`ownClipSet` needs `clip_path` (1755), so the detour is off. The card's
`cut_t0 = prev.rallyEnd - 0.3`, the WYSIWYG resolver flips 0.25s early
(playhead.ts:397) so the chip shows the new card 0.55s BEFORE prev's
deciding shot, then next's footage plays under it. The crossing detector's
ownClip skip (2169) is also off, so the card's stop (`pauseEnd` = virtual
rallyEnd + beat; Jose: 30.02 + 0.3 + 24.1 = 54.42 vs next's rallyStart
31.32) fires `removed` seconds later, mid-way through some later rally,
pinned to the inserted card (the pinned id wins the target, 2429/3047).
Acknowledged in the comment at 1746-1750. Repro: insert on a seam with >4s
removed and press play from the previous card straight away.

**W6. The reclip is lost if the page goes away within 4s.** `scheduleReclip`
holds a `window.setTimeout` in a ref (2176-2182) and nothing else enqueues;
there is no unmount flush and no server-side trigger. Repro: "+" → Add card
→ back/refresh within 4s. Result: `edited = true`, `clip_path = null`
forever — spinner, "Updating clip…", Adjust locked, and the 8s poll running
indefinitely (2433-2452) — until some other edit schedules a job.

**W7. Delete then Restore strands the card the same way.** `process_reclip`
excludes deleted rows (5267) and `undoDelete` (1798-1816) only flips
`deleted`, scheduling nothing. Repro: insert, Delete the new card before the
worker runs, Restore later.

**W8. Head/tail inserts are not clamped to the file.** insertGeometry.ts:246-249
says "the sheet clamps the handles to the file's real length once it loads";
InsertPoint never reads `video.duration`. `bounds().hi = prev.t1 + 15` on a
tail seam (81-82, 166). The RPC has no duration check (101:84-89). The
worker's `-t` past EOF yields a short clip; the card's virtual span runs past
the cut's end.

**W9. Cut fallback: playback never stops at the window and the playhead never
moves.** On the cut source `onTime` uses `s = playhead` (state, 239-243), so
`setPlayhead` never runs while playing and the `s >= win.t1` stop compares a
constant. Repro: expired-raw match, Replay — the cut plays on through the
rest of the match with the line standing still.

**W10. Rotated iPhone fullscreen: handles track the wrong axis.** The sheet is
a child of the Player root (8206 inside the root div at 5250), which in
`fakeLandscape` is the 90°-rotated box (5254-5262). `ModifyClip` is told
`rotated` (8191) and maps `clientY` there (ModifyClip.tsx:298-302);
`pointerToSource` (InsertPoint.tsx:181-190) uses `clientX` only.

**W11. "The video skips N seconds here" is not what the video skips.** N is
`next.t0 - prev.t1` in SOURCE seconds (Player.tsx:4455), not `seam.removed`.
On a continuous seam over 4s (the 4s test is also on the source gap) the
tooltip claims a skip the cut does not make. Conversely on the raw path the
user is never told how much the cut is missing (the hatched band is
fallback-only, 255-261), which is exactly the case where Keep-score playback
will be wrong until the reclip (W5).

**W12. "Expired" can be false.** The route's `rawPreview` reads `raw_path`
only (334-337; the reason is documented) while the worker reclips from
`jobs.input_path` (5236-5239, 5282-5288). An older row with a null
`raw_path` and a live `input_path` shows "The original video for this match
has expired, so this stretch can't be shown" and then gets a perfectly good
clip.

**W13. Affordance and cost.** The "+" exists only at the two seams touching
the current card, and at the tail only while ON the last card (4439-4448,
4468); nothing on the rest of the strip says a rally can be added. Each open
does a fresh HEAD + presign and the `<video>` fetches metadata of the whole
raw file (99-134).

**W14. Second write for the winner is unguarded.** `setWinner` runs after the
RPC as a separate update (2241); on failure it silently rolls back
(1562-1563) and the card stays unscored with no message.

**W15. RPC edges.** `p_cut_t0` null becomes 0, not null (101:107), which
would sort the card to the cut's start on every time-based surface; a
deleted neighbour is accepted (no `deleted` check, unlike `split_point`,
023:52-54); `idx = max+1` is read without a lock (95-96) under
`unique (match_id, idx)` (003_match_experience.sql:72), so two tabs
inserting at once can hit a unique violation — surfaced as the generic toast.

**W16. Cancel is live while busy** (300-306, 473-479 are not disabled by
`busy`). The RPC still lands and the flash fires (4497-4502); nothing is
corrupted, but the user who cancelled gets a card anyway.

---

## 7. THE "REMOVED" LIST, RESTORE, AND "DELETE ALL BEFORE"

All deletes are soft (`deleted = true`); nothing here touches `clip_path`
or `edited`, and nothing schedules a reclip.

- `deletePoint` (MatchView.tsx:1819-1848): optimistic, snackbar "Point
  removed" 6s with Undo; advances the open point view to the neighbour.
- `deletePointQuiet` (1855-1866): the pad's Delete; no snackbar (takeover
  sits above it); the Player pushes a `delete` undo entry that restores and
  seeks back (Player.tsx:4758-4767).
- `deleteAllBefore` (1873-1900): one batched `.in("id", ...)` update on every
  visible point before the chosen one; snackbar "N points removed" 8s with
  Undo. Point view entry at MatchView.tsx:4216 and 4540 (PointDetail's
  inline confirm, 296-298).
- `deleteAllBeforeQuiet` (1905-1930): the pad's "match starts here" sweep
  (Player.tsx:4923-4944) with a `bulk-delete` undo entry (4854-4861).
- Restore = `undoDelete` (1798-1816): accepts one id or a set, optimistic
  `deleted:false`, single `.in()` write, revert on error. Entry points: the
  snackbar/undo stack, the strip's `RemovedDot` (Player.tsx:554-575, two
  taps: arm then "Restore", auto-disarm 3s; positioned by `removedDots`
  1714-1728 and rendered at 6511/6706), the collapsible "Removed (N)"
  section (MatchView.tsx:4082-4145) and the filtered "removed" list
  (3581-3616), rows reading "At m:ss · N.Ns" + Restore.
- **Clips:** deleting needs no reclip (the clip file stays; the cut still
  holds the footage; the Player skips it at playback through
  `deletedSpans` MatchView.tsx:1056-1070 / Player.tsx:1993-2006). Restoring
  an untouched card needs no reclip either. The one exception is a card
  that was `edited` when deleted (W7).
- `ownClipIds` runs over `[...points, ...removedPoints]` (Player.tsx:1752)
  so deleted cards still bracket room correctly.
- Rotation: delete/restore do not clear downstream corrections (see §3).

---

## 8. SHARED WITH MODIFY vs DUPLICATED

**Shared (one implementation):**
- `effectivePad` / `TIGHT_PAD` (clipEdit.ts:42-59) — used by `spanOf`,
  `cutT0For`, `modifyOps`, `ModifyClip.geometryOf`, and the worker's twin.
- `ClipPad` type and the same `pad` prop from MatchView (1043-1046).
- MatchView plumbing: `scheduleReclip`/`enqueueReclip`, `updatePoint`,
  `addSplitPoint` (2184-2188, reused by insert at 2222), `setWinner`, the
  8s pending-clips poll, the `edited` trigger (007:38-43).
- Player plumbing: `pauseBoth`, `showFlash`, `showToast`, the cut preview
  URL (`videoUrl`) as the fallback.
- PointDetail's "Updating clip" states and `clipLocked`.

**Duplicated (a second statement of the same rule):**
1. Handle drag: InsertPoint.tsx:192-222 vs ModifyClip.tsx:369-406 + 356-364
   (pointer-capture try/catch, `dragEdge` ref, seek-while-drag). InsertPoint's
   copy lacks `rotated` (W10) and the ±1s step buttons (ModifyClip
   415-420, 745-755).
2. Track maths: `pct`/`pointerToSource` (172-190) vs
   `timeToPct`/`pointerToTime` (293-315).
3. cut_t0 arithmetic: `cutT0For` (207-210) vs `modifyOps.childCutT0Of`
   (80-82) — same "shared edge keeps min(pad.pre, 0.3)" rule, written
   twice. The spec's `runInsertPlan` in `modifyOps.ts` does not exist; the
   RPC call is inline in MatchView (2213-2219), unlike split/join which go
   through `modifyOps`.
4. Source↔cut mapping: `sourceToCut` (113-125) vs `playhead.cutToSource`
   (329-334) vs ModifyClip `cutOf`/`srcOf` (192-199) — three statements of
   the anchoring fact.
5. Neighbour trims: the client re-derives what the RPC did (2225-2230)
   instead of receiving patches.
6. Video element: InsertPoint owns its own `<video>` with no pending-seek
   on `loadedmetadata` (W2), where Player and ModifyClip both have one.
7. Undo: split, adjust, delete, bulk-delete and overrides all push
   `UndoEntry`; insert pushes nothing (W3).

Insert is not a `ModifyClip` tab (`type Tab = "split" | "join" | "adjust"`,
ModifyClip.tsx:36), contrary to spec §4.3. For the other surface: iOS has
its own `InsertSheet.swift`, `InsertGeometry.swift` and
`InsertGeometryTests.swift` (not reviewed here).
