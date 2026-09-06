# Web player + Modify (Split / Join / Adjust): engineering read

Read-only study of `src/app/match/[id]/` (Player.tsx, ModifyClip.tsx, modifyOps.ts, playhead.ts, clipEdit.ts, MatchView.tsx, PointDetail.tsx, PointSheet.tsx, ClipPlayer.tsx, useVideoFullscreen.ts, page.tsx), `src/app/api/media-url/route.ts`, `src/lib/types.ts`, plus the DB functions and worker step they call (`supabase/migrations/007, 020, 023, 026, 027, 101`, `worker/worker.py process_reclip`). All line numbers are from the files as of this read.

Three clocks are used throughout, and every finding below comes back to them:

- **source seconds**: `points.t0` / `t1` (the rally, measured in the raw upload after trim).
- **cut seconds**: `points.cut_t0`, `scored_at_cut_s`, `rally_end_cut_s`, `serve_start_at_cut_s`; positions in `matches.cut_path`. The cut keeps source durations intact inside one activity span and removes footage between spans.
- **clip-file seconds**: 0 = the first frame of `points.clip_path`, which the worker cuts at `max(0, t0 - effPre)`.

---

## 1. Video sources per surface

### Summary table

| Surface | File played | How the URL is obtained | Expiry |
|---|---|---|---|
| Player (poster, watch, Keep score pad, chip strip) | **whole cut video** (`matches.cut_path`, falling back to `jobs.result_path` when `status='done'`) | `Player.tsx:1807-1825` POST `/api/media-url` `{ matchId, preview: true }` once per `matchId` on mount | 6 h (`route.ts:415-427`) |
| Player highlights tape | a separate worker-rendered highlight mp4 | `openHighlights` swaps `video.src = asset.url` (`Player.tsx:2740-2758`), restored on close (`2660-2664`) | whatever HighlightsRow signed |
| Player detour surface (insert-born cards only) | **per-point clip** (`points.clip_path`) | `Player.tsx:1764-1788` `{ matchId, pointId }` for every id in `ownClipSet` | 1 h (`route.ts:382-398`) |
| Modify modal (from the pad) | **whole cut video** | `videoUrl` prop = the Player's own preview URL (`Player.tsx:8189`) | 6 h |
| Modify modal (from the point view) | **whole cut video** | `PointDetail.tsx:278-294` lazy fetch on first open, `{ matchId, preview: true }`, held in `cutUrl` state | 6 h; refetched per point because PointDetail is keyed by `point.id` (`PointSheet.tsx:503`, `MatchView.tsx:4168`) |
| PointDetail (desktop pane) | **per-point clip** via `ClipPlayer` | `PointDetail.tsx:322-347` `{ matchId, pointId: point.id }`, re-run when `point.id` or `point.clip_path` changes | 1 h |
| PointSheet (mobile) | same as PointDetail (it wraps it, `PointSheet.tsx:502-546`) | same | 1 h |
| InsertPoint ("Add a missing rally") | **raw upload** (`rawPreview`), falling back to the cut | `InsertPoint.tsx:99-134` | 6 h |

### media-url body shapes (`route.ts:13-45`, dispatch order 131-434)

`{ lessonId, image }` → journal photo; `{ tagReel }`; `{ thumbs: [matchId] }` batch posters (1 h); then `matchId` is required and the match row is read under RLS (`239-246`, this is the access check); `{ noteId, image? }` voice/sketch (1 h); `{ reel, scope, download? }` (1 h, attachment unless `v:` share scope); `{ rawPreview }` raw upload inline, HEAD-checked, `{ available:false }` if gone (6 h, `320-347`); `{ raw }` raw download (1 h); `{ pointId }` → `points.clip_path` signed inline (1 h, `382-398`; "Clip not found" 404 when null); bare `{ matchId }` → cut as attachment (1 h); `{ preview: true }` → cut inline 6 h (`415-427`). `presignGet` defaults to 3600 s (`src/lib/r2.ts:112-120`).

Note the `pointId` branch re-reads `points.clip_path` on every call, so once the reclip has landed a fresh fetch returns the new file; the client only refetches when `point.clip_path` changes in React state, which happens through the pending-clips poll (§4).

### Expiry handling

- **Player**: none. The `<video onError>` (`Player.tsx:5300-5305`) only flips `corsOff` once (retry without `crossorigin`, position restored by the effect at `1250-1261`). A second error, which is what an expired signature produces, is ignored: no re-mint, no message. The route comment explains why the link is 6 h ("this URL is HELD, not clicked", `route.ts:416-421`).
- **ClipPlayer**: `onError` (`ClipPlayer.tsx:1062-1105`) retries once without `crossorigin`, restoring position and (clip mode) replaying; the second error calls `onMediaError(state)`. **PointDetail does not pass `onMediaError`** (`499-503`), so a sheet left open past an hour dies silently. The only consumers that re-mint are outside this set (coach workspace).
- **Modify modal**: none; it shares whichever URL its host holds.

---

## 2. Timeline math

### The anchoring fact (`playhead.ts:9-34`)

`points.cut_t0` is the cut-video position of the **padded clip start**, `max(0, t0 - effPre)`, not of the serve. In cut seconds a point spans:

```
cut_t0 ──effPre──> serve ──(t1 - t0)──> rally end ──effPost──> clip end
```

The worker anchors it that way (`points_pipeline.py`, quoted in the comment) and cuts the clip file at the same `c0` (`worker.py:5316-5319`):

```python
p_pre  = min(pre, TIGHT_PAD) if tight_start else pre
p_post = min(post, TIGHT_PAD) if tight_end else post
c0   = max(0.0, float(t0) - p_pre)
span = (float(t1) + p_post) - c0
```

### Pads (`clipEdit.ts`)

- `CLIP_PAD` (`13-17`) is the **frozen** pre-048 table: tight 0.5/1.0, normal 1.0/1.6, loose 1.6/2.4. `clipPad(strictness, stored)` (`19-34`) returns `matches.clip_pads` when present, else the table. MatchView builds it once (`1043-1046`) from `strictness` (page.tsx `171-184`, read off the source job's options; coaches fall back to "normal") and `match.clip_pads`.
- `TIGHT_PAD = 0.3` (`42`), mirrored at `worker.py:5225`.
- `effectivePad(pad, tightStart, tightEnd)` (`50-59`): `pre = tightStart ? min(pad.pre, 0.3) : pad.pre`, `post` likewise. Every cut-time derivation goes through this, because a split-born edge was cut with the sliver, not the full pad.

### The maps

- **cut → source** (`playhead.ts:329-334`):
  ```ts
  export function cutToSource(p, t, pad) {
    const eff = effectivePad(pad, p.tight_start, p.tight_end);
    const anchor = Math.max(0, Number(p.t0) - eff.pre);
    return anchor + (t - Number(p.cut_t0));
  }
  ```
  Exported, tested, mirrored on iOS, and **not called anywhere in the web app** (only a comment at `Player.tsx:165`); `modifyOps.ts:60-68` re-derives the same map inline.
- **source → cut** (`ModifyClip.tsx:192-198`): `cutOf(src) = geo.rallyStart + (src - t0)` with `rallyStart = cut_t0 + eff.pre` (`geometryOf`, `60-78`); `srcOf` is the inverse. Same map as `insertGeometry.spanOf` (`44-51`) and `fusedPoint.ts:69-71`.
- **clip-file → source**: `clipTime + max(0, t0 - effPre)`. Nothing in the current PointDetail uses it any more (timing fixes moved to the modal, `ClipPlayer.tsx:110`).

### Every exported helper in `playhead.ts`

| Helper | Lines | Formula / rule |
|---|---|---|
| `rallyEnd(p, pad)` | 41-47 | `cut_t0 + eff.pre + max(0, t1 - t0)`; null without offsets |
| `paddedEnd(p, pad)` | 52-56 | `rallyEnd + eff.post` — the clip file's extent and the reel route's `seg_end` |
| `TAP_END_GUARD_S` | 61 | 0.5 s kept after the winner tap |
| `RALLY_END_MAX_TAIL_S` | 83 | 2.7 s: a detected rally end further than this before the point's own end is refused |
| `effectiveEnd(p, pad, opts)` | 131-171 | clamp-only end. **`if (p.edited) return padded`** (141) — a hand-edited point ignores both trims. Scored (tap present): `opts.tapEnd && tap >= cut_t0 ? min(padded, tap + 0.5) : padded`, never falls through to the rally rung. Unscored: `min(padded, rally + bufferS)` iff `opts.rallyEnd.on`, `rally >= cut_t0`, and `rallyEnd(p) - rally <= 2.7` |
| `tapeMove(spans, t)` | 196-205 | stay / jump-to-next-start / end, 0.05 s entry lead, 0.01 s end epsilon. **Unused on web** (only tests + the iOS mirror) |
| `SKIP_MERGE_GAP_S`, `EDGE_EPS_S` | 238-240 | 1 s fuse tolerance, 0.01 s slop |
| `mergeSkipSpans(spans, visibleStarts)` | 250-271 | fuse spans within 1 s unless a kept rally's `cut_t0` lies in the gap |
| `skipSpans(rows, pad, opts)` | 273-314 | deleted cards `[cut_t0, min(paddedEnd, next visible cut_t0)]` + trimmed tails `[effectiveEnd, max(next visible cut_t0, eff)]` when `> eff + 0.05`; sorted; merged. Used by the share page and coach workspace, not the match page |
| `cutToSource` | 329-334 | above |
| `PAUSE_BEAT_S` | 342 | 1.2 s |
| `pauseEnd(p, pad, nextStart?)` | 354-368 | `rallyEnd + min(eff.post, 1.2)`, clamped to `[rallyEnd, nextStart - 0.05]` |
| `nextCutStart(points, p)` | 372-380 | next visible `cut_t0` after p |
| `playingPointId(points, t)` | 393-401 | last point with `t >= cut_t0 - 0.25` (WYSIWYG chip resolver) |
| `armedPointId(points, t, pad)` | 410-423 | last point with `t >= rallyEnd - 0.15` (legacy fallback) |

MatchView keeps its own copy of the deleted half (`deletedSpans`, `1056-1077`): `[cut_t0, paddedEnd]` clamped to `visibleStarts.find(s > start + 0.01)`, then `mergeSkipSpans`. The Player builds the tap-tail half separately as `tapSpans` (`1649-1664`) and the let spans as `letSpans` (`1615-1624`).

### A child's `cut_t0` on split (`modifyOps.ts:56-82`)

```ts
const eff    = effectivePad(pad, A.tight_start, A.tight_end);
const cutT0  = Number(A.cut_t0);
const anchor = Math.max(0, t0 - eff.pre);
const raw    = cutTimes.map((T) => anchor + (T - cutT0)).sort();   // marker cut s → source at_t
// clamped to [t0 + 0.3, t1 - 0.3], >= 0.3 apart, rounded to 0.01
const childCutT0Of = (at) =>
  Math.round((cutT0 + (at - Math.min(pad.pre, TIGHT_PAD)) - anchor) * 100) / 100;
```

`at - min(pad.pre, 0.3)` is the child's own padded start (a child is always `tight_start = true`), mapped through the parent's anchor. It is passed as `child_cut_t0` to `split_point` (`94-98`), which stores `greatest(child_cut_t0, 0)` and nulls it when the parent has no `cut_t0` (`023_split_child_cut_t0.sql:59-65, 80`). The parent's `cut_t0` is untouched; the parent gets `t1 = at_t, edited = true, tight_end = true` (`66-68`), the child `[at_t, orig.t1]`, `edited = true`, `tight_start = true`, `tight_end = orig.tight_end`, `clip_path` null, `idx = max + 1` (`69-83`). Splitting a second time uses the child as parent (`modifyOps.ts:112`), so the anchor math is re-run against the child's own `cut_t0`.

`insert_point` follows the same rule client-side: `cutT0For` (`insertGeometry.ts:207-210`) = `sourceToCut(seam, t0) - effPre` with both edges tight.

### Is `cut_t0` recomputed on Adjust? No.

`adjustPatch` (`modifyOps.ts:170-179`) writes only `t0`, `t1`, and dissolves `tight_start` / `tight_end` on the edge that moved. `adjustPointTiming` (`MatchView.tsx:2258-2289`) writes exactly that patch. The DB trigger sets `edited` (`007:26-43`). The worker's reclip (`worker.py:5338-5343`) writes only `clip_path` and `edited`. `insert_point` says so in words: "Their tight flags and cut_t0 are deliberately left alone, following adjustPatch … cut_t0 anchors the span in the CUT video, which is not regenerated" (`101:118-121`).

The consequence is the single most important thing in this read (§9 item 1). After an Adjust that moves the **start** edge, `cut_t0` still points at the OLD padded start, but every helper now computes `rallyStart = cut_t0 + effPre_new` and treats that as the NEW serve. The true cut position of the new clip's first frame is

```
cut_t0_correct = cut_t0 + (t0_new - effPre_new) - (t0_old - effPre_old)
```

and nothing writes it. Adjusting only the **end** edge is safe (t0 unchanged, so the anchor still holds), except that dissolving `tight_end` grows `effPost` from 0.3 to the full pad, which merely lengthens `paddedEnd`.

---

## 3. Edit operations: RPC / write, optimistic state, `edited`, `scheduleReclip`

### `scheduleReclip` itself (`MatchView.tsx:2158-2182`)

`scheduleReclip` clears and re-arms a 4 000 ms `window.setTimeout` in `reclipTimer`; on fire it calls `enqueueReclip`, which selects `jobs` where `kind = 'reclip' and status = 'queued' and options ⊇ { match_id }` and, if none, inserts `{ user_id, kind: 'reclip', options: { match_id } }`. A `processing` job does not suppress a new one (deliberate, `2158-2160`). The insert's error is not checked. The timer is never cleared on unmount (see §9 item 2). The worker (`process_reclip`, `worker.py:5228-5350`) then re-cuts **every** `edited and not deleted` point of the match from the raw, writing `clip_path` and `edited = false` only `where t0 = %s and t1 = %s` (so a point edited again mid-cut stays `edited`), or, when the raw is gone, `clip_path = null, edited = false` (`5298-5310`).

### Split

**Pad path.** `tapModify` (`Player.tsx:4111-4117`, key M `5146-5150`, button `7229-7243`) pauses both surfaces and sets `modifyPoint` from `resolveTargetPoint()` → `<ModifyClip>` (`8185-8204`) → "Split into N" → `doSplit` (`ModifyClip.tsx:448-451`) → `performSplit` (`Player.tsx:4134-4244`):
1. `runSplitPlan` (`modifyOps.ts:41-117`): per marker, `supabase.rpc("split_point", { p_id, at_t, child_cut_t0 })` (`94-98`); after each success `onChild(parent, { t1: at, edited: true, tight_end: true }, child)` (`103`). `onChild` is the Player's `onSplit` prop = `MatchView.tsx:2987-2991`: `updatePoint(parent)`, `addSplitPoint(child)` (`2184-2188`, dedup by id), **`scheduleReclip()`** (once per child; harmless, debounced).
2. Outcomes: `onSetSkipped` / `onSetWinner` per segment (`4196-4200`) → MatchView `setSkipped` (`1615-1638`) / `setWinner` (`1539-1566`), both optimistic `points.update` with rollback.
3. Undo entry `{ type: "modify-split", unsplits, rootId, rootPrevWinner, rootPrevSkipped, rootCutT0 }` (`4202-4212`); partial failure keeps what landed reversible (`4171-4192`) with toast "Couldn't finish the split. Undo to revert."
4. Land: `seekTo(landing.cut_t0); playNow()` (`4225-4230`).

`edited`: set by the RPC on the parent and born true on the child; mirrored optimistically. Child has `clip_path = null` until the worker runs, so the point view shows "Updating clip…" and the child cannot be played from its own file at all.

**Point-view path.** PointDetail "Modify" (`421-432`) → `openModify` (`278-294`) → portal `<ModifyClip>` (`894-934`) → `onSplit` → `modifySplitFromDetail` (`MatchView.tsx:2320-2403`): same `runSplitPlan` with `onChild: updatePoint + addSplitPoint`; `if (created.length > 0) scheduleReclip()` (`2337`); outcomes; snackbar (10 s) "Split into N" / "Split partly failed — Undo reverts what landed" whose `undoSplit` (`2345-2383`) runs `unsplit_point` per record, patches the parent `{ t1, tight_end, edited: true }`, restores the root's winner/skip, and **`scheduleReclip()`** again. Cmd/Ctrl-Z presses the snackbar (`2294-2312`).

### Join

**Pad.** Two-tap arm in the modal (`ModifyClip.tsx:453-460`) → `performJoin` (`Player.tsx:4253-4302`) → `runJoinPlan` (`modifyOps.ts:126-162`) → `supabase.rpc("merge_points", { p_ids })` (`150`) → `onMerge(A.id, { t1, tight_end: false, edited: true }, mergedIds)` = `MatchView.tsx:3000-3008`: `setPoints` drops the merged rows and patches the survivor, **`scheduleReclip()`**. Then winner/skip on the survivor. **Not pushed to the undo stack** (`4249-4251`). Lands after the merged range (`4280-4287`).

**Point view.** `modifyJoinFromDetail` (`MatchView.tsx:2407-2427`): same plan, `setPoints`, `scheduleReclip()`, winner/skip. No snackbar.

`merge_points` (`027_merge_points.sql:70-81`) grows the survivor's `t1` to `max(t1)`, sets `tight_end = false, edited = true`, hard-deletes the rest. The survivor keeps its old, now-short `clip_path` until the reclip; the deleted rows' notes, tags, stars, overrides go with them.

### Adjust

**Pad.** "Save timing" (`ModifyClip.tsx:944-952`, disabled unless `adjDirty && !busy && !adjustLocked`) → `performAdjust` (`Player.tsx:4308-4332`): snapshot prev `t0/t1/tight_*` from `pointsRef`, `onAdjustTiming(A, t0New, t1New)` → **`adjustPointTiming`** (`MatchView.tsx:2258-2289`):
```ts
const patch = tight ? { t0: t0New, t1: t1New, ...tight } : adjustPatch(point, t0New, t1New);
updatePoint(point.id, { ...patch, edited: true });      // optimistic
const { error } = await supabase.from("points").update(patch).eq("id", point.id);
if (error) { updatePoint(point.id, prev); return false; }
scheduleReclip();
```
Client grants cover `t0, t1, deleted` (`007:24`) and `tight_start, tight_end` (`020:25`); the trigger `points_mark_edited` (`007:38-43`) sets `edited = true` server-side. Player then pushes `{ type: "adjust", prevT0, prevT1, prevTightStart, prevTightEnd }` (`4327`), closes the modal, flashes "Timing saved · updating clip" (`4329`). No seek.

**Point view.** `onAdjust` (`PointDetail.tsx:923-929`) calls `adjustPointTiming` directly (`MatchView.tsx:4223`, `4547`). **No snackbar and no undo of any kind** on this path (the only snackbar producers are `deletePoint` 1832, `deleteAllBefore` 1882, `modifySplitFromDetail` 2385).

### Delete / restore

- Timeline card, swipe row, PointDetail "Remove": `deletePoint` (`MatchView.tsx:1819-1848`): optimistic `deleted: true`, advances `activePointId`, snackbar "Point removed" 6 s → `undoDelete`, then `points.update({ deleted: true })`, rollback on error. No `edited`, no reclip.
- Pad Delete / key D: `tapDelete` (`Player.tsx:4050-4102`) → `onDeletePoint` = `deletePointQuiet` (`1855-1866`, no snackbar; the takeover sits above it) + undo entry `{ type: "delete", cutT0 }` + seek to next (or prev at the end).
- Bulk: `deleteAllBefore` (`1873-1900`, snackbar 8 s) and the pad's `deleteAllBeforeQuiet` (`1905-1924`) via `tapStartHere` (`4923-4944`, undo entry `bulk-delete`).
- Restore: `undoDelete(ids)` (`1798-1816`): `points.update({ deleted: false }).in(ids)` with rollback. Callers: snackbar, Player `undo` for `delete`/`bulk-delete` (`4758-4767`, `4854-4861`), `RemovedDot` in the strip (`554-594`, `6510-6512`, `6706-6708`), timeline "Restore" (`3604-3611`, `4132-4139`). No `edited`, no reclip.

### Winner change

`setWinner(point, next, scoredAtCutS?)` (`MatchView.tsx:1539-1566`): patch `{ confirmed_winner, scored_at_cut_s: next === null ? null : (scoredAtCutS ?? existing), is_let: false when clearing a let }`, `points.update`, rollback of winner and let. Callers: timeline `tapWinner` (`1605-1609`), Player `tapSide` (`3855-3977`) via `onSetWinner` with the cut-clock stamp (`3898-3903`), the scorecard's `onPointUpdate`. Undo entry `tap` in the pad only (`3868-3876`). No `edited`, no reclip.

### Server override

`setServerOverride` (`1659-1686`): optimistic clear of every downstream override, `supabase.rpc("set_server_override", { p_id, p_value })`, rollback of all. Callers: `ServerChipMenu` (`3697`), PointDetail scorecard (`4190`, `4493`), Player `setServerTo` (`4345-4362`). Not undoable, no `edited`.

### Game-end / game-winner override

`setGameEndOverride` (`1695-1725`): patch `{ game_end_override, game_winner_override: null when next !== 'end' }`, `points.update`, returns bool. Callers: PointDetail `pickGameEnd` (`309-320`), timeline divider nudges `moveGameBoundary` (`1769-1787`) and the "didn't end" X (`4018`), side-change sheet (`4726`), Player `applyGameOverride` (`4510-4523`, undo entry `override`). `setGameWinnerOverride` (`1730-1743`). No `edited`, no reclip.

### Undo (pad stack, `Player.tsx:4754-4902`)

| Entry | Inverse |
|---|---|
| `tap` | `onSetWinner`/`onSetSkipped` back, seek to the point and play (`4878-4888`) |
| `delete`, `bulk-delete` | `onUndoDelete`, seek to stored `cutT0` |
| `override` | `onSetGameOverride(prev)` |
| `split` (legacy in-pad split) | `unsplit_point` RPC → `onUnsplit` = `MatchView.tsx:2992-2999` (`setPoints` + **`scheduleReclip`**) |
| `modify-split` | loop `unsplit_point` newest-first, `onUnsplit` each, restore root winner/skip, seek (`4811-4853`) |
| `adjust` | `onAdjustTiming(p, prevT0, prevT1, { tight flags })` — itself an edit: `edited: true` + **`scheduleReclip`** (`4862-4877`) |

`unsplit_point` (`026:77-84`) restores `t1`/`tight_end`/`edited` and hard-deletes the child; growing `t1` re-fires the trigger so the parent ends `edited = true` regardless (`026:19-23`). The stack is emptied on every `openScore` (`2774`).

---

## 4. Everything `edited` drives, and the poll

### Consumers of `p.edited`

- `playhead.effectiveEnd` (`141`): returns the full `paddedEnd` for an edited point, discarding the winner-tap and rally-end trims. That propagates to the Player's `stopAt` for scored points (`2093-2096`), `chipSpans` (`1738`), `tapSpans` (`1656`), review stop (`2205`), detour stops (`2240-2260`), `advanceFrom` (`3430`), `skipSpans` on the share/coach pages, and the reel route's `seg_end` (`reel/route.ts:421`).
- MatchView timeline card: pulsing "Updating clip" (`3749-3753`). `hasPendingClips = points.some(p => p.edited && !p.deleted)` (`2432`) starts the poll.
- PointDetail: `clipLocked = point.edited` (`269`) → `adjustLocked` (`930`); placeholder "Updating clip…" when `!clip_path && edited` (`504-507`); badge "Updating clip" over a playing clip (`520-524`).
- ModifyClip: `adjustLocked` disables the ±1 s steps (`750`) and Save (`948`), shows the amber line (`770-775`). It does **not** stop handle drags (`369-406`) and does not touch the Split or Join tabs.
- Player chip strip: spinner replaces the countdown ring (`6578-6595`, `6596`), the current-chip scale/glow is suppressed while edited (`6553`), aria "…, updating clip" and title (`6563-6566`); `adjustLocked={modifyPoint.edited}` (`8202`) where `modifyPoint` is the snapshot taken at `tapModify` (`4116`), so the pad's modal stays locked until reopened even after the poll clears the flag. Flash "Timing saved · updating clip" (`4329`).

### The pending-clips poll (`MatchView.tsx:2429-2452`)

```ts
const hasPendingClips = points.some((p) => p.edited && !p.deleted);
useEffect(() => {
  if (!hasPendingClips) return;
  const iv = window.setInterval(() => { void (async () => {
    const { data } = await supabase.from("points")
      .select("id, t0, t1, clip_path, edited, deleted, tight_start, tight_end")
      .eq("match_id", match.id);
    if (!data) return;
    setPoints((ps) => ps.map((p) => { const fresh = data.find((d) => d.id === p.id);
                                      return fresh ? { ...p, ...fresh } : p; }));
  })(); }, 8000);
  return () => window.clearInterval(iv);
}, [hasPendingClips, match.id]);
```

- Interval 8 s, only while some visible point is edited; torn down when the flag clears.
- It refetches **all** points of the match and overwrites seven fields on **every** point, not only the edited ones. `cut_t0` is not fetched (it never changes server-side).
- Races: (a) any optimistic write whose commit lands after the poll's select started is reverted for one cycle: `deleted` (a removed card reappears for ≤8 s), `t0/t1/edited` from Adjust, `t1/tight_end` from split/unsplit; (b) `clip_path` replacement re-runs PointDetail's URL effect (`347`) → `ClipPlayer` `src` change → autoplay with sound (`ClipPlayer.tsx:569-617`) while the reader is mid-sheet; (c) in the point view the modal receives the live `point` (`PointDetail.tsx:900`), so a poll merge rebuilds `geo` (`ModifyClip.tsx:133`) and the marker-defaulting effect (`150-168`, deps `[parts, geo, initialCut]`) **resets dragged split markers** every 8 s; Adjust's `adjT0/adjT1` are local state (`188-189`) so the handles keep their values, but `cutOf` shifts if `t0/tight_start` changed underneath. In the pad path `modifyPoint` is a stable snapshot, so no reset there.
- If `edited` never clears (no job ever enqueued, raw gone and job never ran, or an edited point that was deleted before the job ran and later restored), the poll runs every 8 s for as long as the page is open.

---

## 5. How the Modify modal plays video

- Own `<video src={videoUrl} playsInline preload="auto">` (`ModifyClip.tsx:562-574`); `onLoadedMetadata` seeks to `spanStart` (`567-569`). No `crossOrigin`, no native controls; a centre play/pause button (`581-599`).
- **Geometry** (`geometryOf`, `60-78`): `spanStart = cut_t0`, `rallyStart = spanStart + eff.pre`, `rallyEnd = rallyStart + (t1 - t0)`, `spanEnd = paddedEnd(p)`, `markerLo/Hi = rally ± EDGE_S (0.3)`. `splittable = markerHi - markerLo > MIN_GAP_S (0.4)` (`134-135`).
- **`videoSpan`** (`224-232`): Split/Adjust → `[spanStart, spanEnd]`; Join → `[spanStart, paddedEnd(last joined point)]`.
- **`trackSpan`** (`238-244`): equals `videoSpan` except on Adjust: `[min(dragLoCut, cutOf(adjT0) - 1), max(dragHiCut, cutOf(adjT1) + 1)]`, so the ruler grows to follow handles the ±1 s buttons push out.
- **`adjustReach`** (`214-216`): `min(8, max(2.5, (spanEnd - spanStart) * 0.3))` seconds of draggable margin either side; `dragLoCut = spanStart - reach`, `dragHiCut = spanEnd + reach` (`217-218`). Fixed for the point so the bound never moves under a finger.
- **`beyondClip`** (`219-220`): `cutOf(adjT0) < spanStart - 0.05 || cutOf(adjT1) > spanEnd + 0.05` → the copy flips to "The band now runs past this clip's own footage. That part arrives when the clip updates." (`766-767`).
- **Seeking**: `seek(t)` (`251-255`) sets `playheadT` and `currentTime` when `readyState >= 1`. An effect re-seeks to `spanStart` whenever it changes (`259-262`): open, tab flip, join-count change. `togglePlay` (`264-273`) restarts from `videoSpan.start` when at the end. `onTime` (`275-285`) pauses and clamps at `videoSpan.end`.
- **Marker band**: default markers evenly spaced in `[markerLo, markerHi]`, `initialCut` seeds the single 2-way marker (`150-168`); drags clamp to the band and keep `MIN_GAP_S` from neighbours (`337-355`) and scrub the video to the finger.
- **Adjust handles**: `onEdgeMove` (`378-406`) clamps start to `[max(0, srcOf(dragLoCut)), adjT1 - 0.5]` and end to `[adjT0 + 0.5, srcOf(dragHiCut)]`, then `seek(playable(cutOf(clamped)))`; `playable` (`318-321`) clamps to `videoSpan`, so the picture freezes at the clip's edge while the handle keeps going. `nudgeEdge` (`415-429`) steps ±1 s with no outward ceiling. Track paints the clip's own stretch lighter (`618-629`), the draft band in cyan (`632-650`), tick marks at the span edges (`663-671`).
- **What the user sees dragging past footage**: the handle enters the darker margin, the video holds the last frame of the span, the label reads "+N.Ns" in cyan, and the hint says the footage "arrives when the clip updates".

### What stops the modal previewing the new t0/t1 from the cut right now

Nothing about the file. The element already holds the whole cut, and the reel route proves the cut contains every point's window at `[cut_t0, effectiveEnd]` (`reel/route.ts:413-423`, rendered by the worker from `matches.cut_path`, `worker.py:5359-5364`). The blockers are in the modal's own rules:

1. `playable()` (`318-321`) and `onTime` (`275-285`) clamp playback to `videoSpan`, which on Adjust is the **original** `[cut_t0, paddedEnd]`, never the draft `[cutOf(adjT0) - effPre, cutOf(adjT1) + effPost]`.
2. The clamp exists because the modal cannot tell whether cut time just outside the span is contiguous source footage or the tail of a different activity span ("the cut video jumps to a different part of the match there", `391-394`). The information it lacks is the neighbour's geometry: `insertGeometry.seamBetween(prev, next, pad)` (`73-102`) already computes `removed` and `continuous` for exactly that question, and `playableAt` (`128-134`) answers it per source second. 55% of seams are continuous (`insertGeometry.ts:19-21`), so most Adjust drags could preview truthfully.
3. After Save, the point's `cut_t0` is not re-anchored (§2), so a follow-up preview would be built on a wrong anchor; the `adjustLocked` gate accidentally prevents that compounding.

---

## 6. Point playback inside the Player

- **Seek to a point** is always `seekTo(Number(p.cut_t0))`, i.e. the padded start: `tapChip` (`2958-2972`), `doubleTapSeek` (`3008-3071`), `jumpAfter` (`3401-3420`), `replayRally` (`3482-3492`), `tapSkip`/`tapDelete` advances (`3991-3993`, `4078-4094`), `undo` (`4763`, `4805`, `4848`, `4857`, `4886`), review (`4965-4971`), point picker (`7890-7896`), `openScore` (`2793-2804`), and PointDetail's "In match" → `openWatch(Number(cut_t0))` (`MatchView.tsx:4229-4235`, `4553-4560`; `Player.tsx:2707-2738`). `seekTo` (`1897-1922`) routes insert-born cards into the detour and nulls the crossing detector's previous tick.
- **Stop** (score mode, play phase, `2079-2198`): `stopAt(p) = isUnscored(p) ? pauseEnd(p, pad, nextCutStart) : effectiveEnd(p, pad, ends)` (`2093-2096`); a boundary is honoured when it lies in `(prevTick, t]`, the run started before that rally's `rallyEnd` and not inside a later span (`2156-2190`), not within 500 ms of `play()` (`2140-2141`), and not already consumed (`endPauseFiredRef`); then `pinEndPause(p.id); v.pause()` (`2191-2196`). Re-arm only ≥1.5 s before the consumed boundary (`2129-2138`) or when a different boundary is crossed. Watch mode never stops.
- **Auto-advance** (`advanceFrom`, `3422-3440`): if `effectiveEnd - now > TAIL_WATCH_S (3.5)` the answered clip's tail plays out (`playTailRef`) and `onTime` advances when it ends (`2107-2128`; 2 s hold when the split nudge is up), else `jumpAfter` seeks the next `cut_t0` and plays. Triggered by any **new** answer (`tapSide` `3958-3961`; `tapSkip` `4022-4033`; `tapDelete` `4067-4094`).
- **Countdown ring**: `chipSpans` (`1730-1744`) = `[cut_t0, min(effectiveEnd, next cut_t0)]`; `remaining = 1 - (playheadT - start) / (end - start)` (`6493-6504`); SVG ring `6596-6626`. **Position ring**: the static white ring on the current chip when no countdown is running (`6553-6557`). Both are replaced by the spinner while `p.edited`.
- **Deleted-span skip**: `deadSpanEnd` (`1597-1603`) over `deletedSpansRef` (MatchView's `deletedSpans`, `1056-1077`, built from `paddedEnd` with the current pads/tight flags), applied only while playing and not scrubbing (`1999-2006`); `snapLanding` (`1678-1695`) pushes seeks out of spans and, in score mode, forward to the first visible point.
- **Watch-only skips**: tap-trimmed tails (`tapSpans` `1649-1664`, applied `2012-2027`) and let spans (`2034-2048`, crossing-only).
- **Detour** (insert-born cards the cut cannot show): `ownClipSet` (`1751-1756`, `insertGeometry.ownClipIds`), second `<video>` (`5405-5476`), `enterDetour`/`exitDetour` (`1864-1895`), `onDetourTime` (`2221-2302`), `onDetourDone` (`2311-2337`); the virtual clock is `cut_t0 + clipTime` (`1838-1847`).

### Does the Player play the new window right after an Adjust?

Partly. The optimistic patch is `{ t0, t1, tight_start?, tight_end?, edited: true }` (`MatchView.tsx:2265-2275`); Player reads `points` (`visiblePoints`, `2951`) and `pointsRef` (`1582-1583`) on the next render, so `rallyEnd`/`paddedEnd`/`pauseEnd`/`chipSpans`/`deletedSpans` re-derive immediately from the new `t1 - t0` and flags, and `effectiveEnd` now returns the full padded end (edited). But:

- the seek target is unchanged (`cut_t0`), and `rallyStart = cut_t0 + effPre` is computed with the new flags against the old anchor. Move the start 3 s earlier and the Player still starts at the old padded start, 3 s into the new rally, and every boundary is 3 s late; move it later and the Player starts 3 s early. This is not fixed by the reclip (the worker never touches `cut_t0`), so it is permanent for that point.
- `performAdjust` does not seek (`4308-4332`); playback stays paused where `tapModify` left it.

Other optimistic patches the Player consumes: split parent `{ t1: at, edited, tight_end }` + child row (`modifyOps.ts:103`); join survivor `{ t1, tight_end: false, edited }` (`154-159`); insert neighbours `{ t1: t0 }` / `{ t0: t1 }` + `edited` (`MatchView.tsx:2225-2230`); unsplit `{ t1, tight_end, edited: true }` (`2363`, `2994-2996`).

---

## 7. PointDetail / PointSheet playback (ClipPlayer)

### ClipPlayer (`ClipPlayer.tsx`)

- Element: `<video poster src playsInline preload="metadata" crossOrigin={corsOff || !readPixels ? undefined : "anonymous"} disablePictureInPicture controlsList="nodownload noplaybackrate noremoteplayback">` (`1036-1045`, `1108-1110`). No `controls` attribute anywhere: the transport is custom (hairline tap-to-seek in clip mode `1571-1583`, a real scrub bar with clock in cut mode `1511-1569`).
- **Autoplay**: the `[src]` effect (`569-617`) resets plays, re-applies the module-level persisted zoom and speed, unmutes, and unless `mode === "cut"` or `startPausedRef.current` calls `tryPlay()` (`530-540`: play with sound, on refusal mute and retry, else stay paused with the poster glyph).
- **`startPaused`** (`265-268`, `274`, `610-614`): consumed once, so only the clip on screen at mount is held back; later `src` changes autoplay. MatchView passes `startPaused={selectedPoint === null}` for the desktop pane's default point (`4174`); PointSheet never passes it.
- **Loop**: `onEnded` (`1124-1146`): a host `onEnded` wins; cut mode pauses; clip mode rewinds and plays a second time (`playsRef < 2`), then rests on frame 0 with `progress = 0`.
- **Poster**: only what the caller passes; PointDetail passes none.
- Gestures on the wrapper (`822-999`): tap = play/pause, double-tap = ±10 s in halves when no `onStepPoint` (PointDetail passes none) or prev/replay/next thirds when it does, press-and-hold 0.25×/2×, pinch 1–4× with pan; speed pill, zoom buttons, mute, optional close and landscape (`1327-1503`).
- **Error path** (`1062-1105`): first error → drop `crossorigin`, `load()`, restore position (`errorStateRef`), autoplay in clip mode; second error → `onMediaError(state)`.

### PointDetail

- `ClipPlayer src={videoUrl} videoElRef={clipVideoRef} startPaused={startPaused}` (`499-503`) inside a `data-peek="clip"` box (`494-497`). Render order: video if URL, else "Updating clip…" when `!clip_path && edited`, else "Clip unavailable — the original video has expired, but your timing edits are saved." when `!clip_path && hasTiming`, else `videoError`, else "Loading clip…" (`498-519`). The "Updating clip" badge overlays a playing clip while `edited` (`520-524`).
- **Frame capture** (`startDrawing`, `236-257`): pauses the element, draws it to a ≤1280-wide canvas, `getImageData(0,0,1,1)` as the taint probe, error "This browser couldn't read the frame.", then `<Annotator>` portaled to body (`851-876`) uploads to `/api/note-image`. Readability depends on `crossOrigin="anonymous"` succeeding, i.e. the media bucket answering with `Access-Control-Allow-Origin`.
- **Would the cut URL change CORS/taint?** No. Both the clip and the cut are `presignGet` on the same R2 bucket (`route.ts:393-396` vs `422-425`; clips live at `points/<uid>/<match>/…` in `R2_MEDIA_BUCKET`, `worker.py:5313-5335`), so the same bucket CORS policy governs both. The Player already captures frames from its cut `<video>` today (`Player.tsx:3523-3542`, `crossOrigin` at `5299`). The one practical difference is that the cut retry reloads a much larger file's metadata; `preload="metadata"` plus range requests keep that cheap. Note the two comments disagree about whether R2 serves CORS at all (`ClipPlayer.tsx:207-214` says presigned URLs carry no ACAO; `Player.tsx:1243-1247` assumes they do).

### PointSheet (`PointSheet.tsx`)

- Full-screen dialog `fixed inset-0 z-[60]` (`438-447`), header "Point N · N of total" with the running `ScoreLine` (`448-482`), body `p-4` with `translateX(slide.dx)` (`484-499`).
- **Neighbour peek**: `NeighbourPeek` (`84-124`) draws skeleton blocks (dark for the clip, card colour for cards) 10 px wide with a 6 px page-colour channel (`42-43`); `measure` (`310-342`) reads every `[data-peek]` block's `offsetTop/offsetHeight` plus the clip's width, re-measured by a `ResizeObserver` on the clip and the body, keyed to `point.id`.
- **Swipe** (`344-435`): 8 px axis lock, follow 0.55 (0.2 at an edge), commit past 25% width or a flick (`|vx| > 0.5 px/ms` and `> 32 px`); ignores touches starting on `video, input, textarea, select, audio, [data-noswipe]`. `commitTo(dir)` (`394-412`) slides 35% for 200 ms, then calls `onNext`/`onPrev` and snaps back without animating; the chevrons go through the same `commitTo` (`523-528`). Escape closes (`267-273`); a one-per-session nudge (`278-303`).
- **prev/next** come from MatchView `goToIndex` (`1467-1477`, `4521-4530`): `setActivePointId` + `scrollIntoView`.

---

## 8. Other "waiting on the worker" states and every related copy string

Reclip / edited / missing clip:

| Where | String |
|---|---|
| `MatchView.tsx:3751` | "Updating clip" (timeline card, pulsing) |
| `MatchView.tsx:2386-2388` | "Split into N" / "Split partly failed — Undo reverts what landed" |
| `MatchView.tsx:1833`, `1883` | "Point removed" / "N points removed" |
| `PointDetail.tsx:506` | "Updating clip…" |
| `PointDetail.tsx:510-511` | "Clip unavailable — the original video has expired, but your timing edits are saved." |
| `PointDetail.tsx:522` | "Updating clip" (badge) |
| `PointDetail.tsx:327` | "No clip for this point." (unreachable in practice: the two branches above render first) |
| `PointDetail.tsx:341` | "Couldn't load the clip. Try again." |
| `PointDetail.tsx:517` | "Loading clip…" |
| `PointDetail.tsx:239`, `255` | "The clip isn't ready yet." / "This browser couldn't read the frame." |
| `ModifyClip.tsx:577` | "Loading…" |
| `ModifyClip.tsx:767` | "The band now runs past this clip's own footage. That part arrives when the clip updates." |
| `ModifyClip.tsx:768` | "The lighter stretch is what this clip holds. Drag or step an edge past it to take in more of the match." |
| `ModifyClip.tsx:772-773` | "This clip is still updating from an earlier change — try again in a moment." |
| `ModifyClip.tsx:809` | "This point is too short to split." |
| `ModifyClip.tsx:931-932` | "Tap Confirm to join — this can't be undone." / "Join can't be undone from here." |
| `ModifyClip.tsx:951`, `960`, `974` | "Saving…" / "Splitting…" / "Joining…" |
| `Player.tsx:4329` | "Timing saved · updating clip" |
| `Player.tsx:4174`, `4190` | "Couldn't place the split. Try again." / "Couldn't finish the split. Undo to revert." |
| `Player.tsx:4266`, `4324` | "Couldn't join. Try again." / "Couldn't save the timing. Try again." |
| `Player.tsx:4800`, `4829`, `4874` | "Couldn't undo the split. Try again." / "Couldn't fully undo. Try again." / "Couldn't undo the timing change. Try again." |
| `Player.tsx:4498`, `4502` | "Couldn't add that rally. Try again." / "Rally added. Serve rotation updated." |
| `Player.tsx:6564`, `6566` | aria ", updating clip" / title "Updating clip" |
| `Player.tsx:5395`, `5775` | "Loading preview…" / "Buffering" |
| `InsertPoint.tsx:326`, `334-336`, `439` | "Loading the footage…" / "The original video for this match has expired, so this stretch can't be shown. You can still add the rally." / "· Ns not available" |
| `OriginalVideo.tsx:74` | "The original is no longer available." |

Placement (rendered through `placementNotice` at `MatchView.tsx:1167`, `4196-4201`, `4499-4504` → `PointDetail.tsx:746-755` under "Where the ball landed"; strings in `src/lib/placement/placementRetry.ts`): "Placement maps haven't been generated for this match. You can generate them from Tools." (`272-274`), "Placement maps couldn't be generated because the original video is no longer available." (`291-293`), "Placement maps are generating. We'll email you when they're ready." (`309-310`, the only polling state), "Placement maps couldn't be generated because the table was hard to detect in this video. You can try once more from Tools." (`327-329`), coach variants "The match owner can generate placement maps." / "The match owner can try again." (`203-205`). `usePlacementLifecycle` (`MatchView.tsx:547-553`) owns that poll.

Silent waits: a split child or fresh insert has `clip_path = null` and cannot be played in the point view until the worker runs; an insert-born card stays on the cut (possibly showing the wrong footage) until its clip exists (`Player.tsx:1746-1750`); highlights carry `rendering|empty|unavailable|failed` (`highlights.ts:28-30`) on the Tools row.

---

## 9. Weaknesses (each with a one-line repro)

1. **Adjusting the start edge desynchronises `cut_t0`, permanently.** `adjustPatch` (`modifyOps.ts:170-179`), `adjustPointTiming` (`MatchView.tsx:2258-2289`) and the worker (`worker.py:5338-5343`) never write `cut_t0`, yet every helper assumes `cut_t0 = cut(t0 - effPre)` (`playhead.ts:9-34`). Repro: Adjust a point's start 3 s earlier, save, tap its chip in Keep score → playback starts 3 s into the rally; wait for the reclip → clip file correct, Player still wrong; reel `seg_start` (`reel/route.ts:420`) also wrong. Fix is one line of the same map the split uses: `cut_t0 += (t0_new - effPre_new) - (t0_old - effPre_old)`, but `cut_t0` is not in the client update grants (`007:24`, `020:25`), so it needs a grant or an RPC.
2. **Reclip enqueue lost on a hard reload within 4 s.** `reclipTimer` (`MatchView.tsx:2176-2182`) is a bare `setTimeout` with no unmount cleanup and no `beforeunload` flush; SPA navigation still fires it, a reload or tab close does not. Repro: Adjust, reload immediately → `edited` true forever, chip spins, Adjust locked, 8 s poll forever, until some later edit on the match enqueues a job.
3. **Poll clobbers optimistic state** (`MatchView.tsx:2436-2449`, merges seven fields on every point). Repro: with any point pending, tap Remove on another point while a poll fetch is in flight → the card comes back for up to 8 s, then vanishes. Same for Adjust (`t0/t1/edited` flip back), unsplit, restore.
4. **Poll resets split markers in the point-view modal.** `ModifyClip.tsx:150-168` re-defaults `markers` whenever `geo` changes identity; `geo` is rebuilt from the live `point` prop (`133`, `PointDetail.tsx:900`) on every poll merge. Repro: adjust point 3, open point 7 → Modify → Split, drag the marker, wait ≤8 s → marker snaps back to the midpoint.
5. **Adjust lock forbids iterative nudging.** `PointDetail.tsx:269/930`, `Player.tsx:8202`, `ModifyClip.tsx:750/948`. Repro: save an Adjust, notice it is 1 s off, reopen Modify → "still updating…", Save disabled until the worker clears `edited` (debounce + queue + ffmpeg from the raw; never, if the raw is gone and the job was lost per item 2). The pad's copy stays locked even after the poll clears the flag, because `modifyPoint` is a snapshot (`4116`). The lock guards nothing the modal shows (it plays the cut, not the clip); it only happens to stop item 1 compounding.
6. **Point-view Adjust has no undo.** `adjustPointTiming` from `PointDetail.tsx:923-929` sets no snackbar (`MatchView.tsx` producers are `1832`, `1882`, `2385` only). Combined with item 5 the user cannot correct a mis-drag from the point view at all until the reclip lands. The pad has an `adjust` undo entry (`4327`) but it dies with the session (`2774`).
7. **Join is not undoable anywhere** (`027_merge_points.sql:19-23`, `modifyOps.ts:119-125`, `Player.tsx:4249-4251`, `MatchView.tsx:2405-2406`). Merged-away rows are hard-deleted with their notes, tags, stars, server and game overrides. Repro: Join 2, change your mind → only Split remains, which cannot restore the lost rows' data.
8. **`effectiveEnd` discards the winner tap while `edited`, then re-applies the stale tap once the worker clears it** (`playhead.ts:141`, `150-156`). Repro: score a point (tap at T), Adjust its end 5 s later, wait for the reclip → `effectiveEnd = T + 0.5` again; the 5 s the owner added are never played in Keep score, watch mode jumps them (`Player.tsx:2012-2027`), and the reel cuts them (`reel/route.ts:421`). Nothing clears `scored_at_cut_s` on a timing edit.
9. **Deleted-span skip inherits item 1.** `deletedSpans` (`MatchView.tsx:1056-1077`) = `[cut_t0, paddedEnd]`; a deleted card whose start was adjusted earlier has a span that starts late, so the first seconds of its footage still play in watch mode.
10. **Edited-then-deleted points are never re-cut and never unflag.** The worker skips `deleted` rows (`worker.py:5267`), `hasPendingClips` ignores them (`2432`), and `undoDelete` (`1798-1816`) does not schedule a reclip. Repro: Adjust point 4, delete it, let the job run, restore it → spinner and Adjust lock forever, 8 s poll forever, until an unrelated edit enqueues a job.
11. **`adjustLocked` does not lock the handle drags** (`ModifyClip.tsx:369-406`); the handles move and the video scrubs while Save is disabled.
12. **A reclip landing mid-read restarts and autoplays the clip with sound.** The poll swaps `clip_path` → `PointDetail.tsx:347` refetches → `ClipPlayer.tsx:569-617` autoplays (`startPausedRef` was already consumed).
13. **Detour can play a stale clip.** `ownClipSet` requires a `clip_path` (`Player.tsx:1751-1756`); an insert-born card that was later Adjusted keeps its old file until the reclip and the detour plays the old window.
14. **No re-mint after a signed URL expires** in the Player (`5300-5305`) or the point view (no `onMediaError`, `PointDetail.tsx:499-503`). Repro: leave a match page open 6 h, press play → dead player, no message.
15. **`enqueueReclip` ignores insert errors** (`2171-2173`): a failed enqueue looks identical to a successful one.
16. **InsertPoint expects `trimStartS` that `/api/media-url` never returns** (`InsertPoint.tsx:108-119` vs `route.ts:320-347`; grep finds no producer). On a trimmed library upload the raw preview seeks `trim_start_s` too early. Adjacent to the brief rather than in it, but the spec may reuse this raw-preview path.
17. Cosmetic: "No clip for this point." is unreachable (`PointDetail.tsx:327` vs `504-513`); the timeline's plain "Updating clip" text and the strip's spinner are two visual languages for one state.

---

## 10. Precedents for "play a window of the cut video"

- **`ModifyClip` itself** (`ModifyClip.tsx:224-285`): `videoSpan` + `seek` + `togglePlay` (restart at end) + `onTime` (pause and clamp at end) is a complete, dependency-free "play `[start, end]` of the cut" loop on a plain `<video>`.
- **Player review phase** (`Player.tsx:4965-4971`, `2202-2208`): seek to `cut_t0`, play, pause at `effectiveEnd`. **`replayRally`** (`3482-3492`) and the crossing detector's `stopAt` (`2093-2096`) are the canonical "one point from the cut" behaviour, with `pauseEnd`/`effectiveEnd` as the stop rule.
- **Player detour** (`1446-1474`, `1855-1895`, `2221-2337`): two `<video>` elements, one clock (`activeVideo()`, `nowT()`, `detourBaseRef`), pinned target. It is the mirror image of the spec (clip over cut) and the surface-swap machinery would carry "cut over clip" unchanged.
- **Highlights tape**: `openHighlights` (`2740-2758`), `highlightPointIdAt` (`highlights.ts:57-67`), and the unused `tapeMove` (`playhead.ts:196-205`) for a spans → stay/jump/end resolver.
- **`ClipPlayer mode="cut"` with `onTime` / `onReplay` / `onStepPoint` / `onEnded` / `playRef` / `videoElRef`** (`ClipPlayer.tsx:118-269`): already the host for the raw upload (`RawMatchView.tsx:506`, `OriginalVideo.tsx:206`), the admin tape (`UploadTape.tsx:235-244`), the coach finding editor (`FindingEditor.tsx:370-378`), the share player (`SharePlayer.tsx:176`) and lesson playback. Mounting it on the cut URL, seeking to `cut_t0` in `onLoadedMetadata`, and pausing at `effectiveEnd` in `onTime` gives the point view a cut-backed player with the same chrome, gestures and frame capture it has now.
- **ShareView / CoachOrder** (`ShareView.tsx:111-231`, `CoachOrder.tsx:102-243`): "ONE video — the full cut — and every point jump is a seek"; `seekToIdx` to `cut_t0`, WYSIWYG resolver `(cut_t0 <= currentTime + 0.05)`, skip-span jumps in `onTime`, dead spans from `skipSpans` computed server-side (`coaching/orders/[id]/page.tsx:144-158`, `s/[token]/page.tsx:145-154`).
- **Reel segment math** (`reel/route.ts:413-423`): `seg_start = max(0, cut_t0)`, `seg_end = effectiveEnd(p, pad, ends)` — the server's own definition of a point's cut window, and the worker renders reels from the cut with those bounds.
- **`insertGeometry.seamBetween` / `playableAt` / `sourceToCut`** (`73-134`): the only code that knows whether cut footage beyond a point's own span is contiguous with it; required to bound a preview of a widened Adjust band.
- **`cutToSource` (`playhead.ts:329-334`) and `childCutT0Of` (`modifyOps.ts:80-82`)**: the exact linear map for re-anchoring `cut_t0` after an Adjust (item 1); `cutT0For` (`insertGeometry.ts:207-210`) is the insert twin.
- **`skipSpans` / `mergeSkipSpans`** (`playhead.ts:250-314`) for the dead-footage list a cut-backed point player should jump.
- **PointDetail "In match"** → `playerRef.openWatch(Number(cut_t0))` (`MatchView.tsx:4229-4235`, `4553-4560`): the existing hop from a point to its moment in the cut.
