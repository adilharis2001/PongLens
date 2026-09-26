# Mark the points: web marker inventory for the iOS port
Read from GitHub main at 554c4a78 on 2026-09-24. Companion to 2026-09-24-ios-hand-cut-design.md; this file is the reference for exact values and copy.

**As shipped (2026-09-26):** the button that undoes an early Begin is **"Back to last point"** (it read "Reset"; renamed below). A scoring draft of a processed match being marked again (Cut again) opens at a gate rather than straight into the pass: **"Keep marking"** ("Start from the points already here and fix or score each one.") and, under it, **"Start again"** ("Clear every point and mark the whole match yourself."). The choice gate's Keep marking gains a line too: "Carry on from the last point to the end of the match." A first cut's scoring draft still opens in the pass (§3).

This covers everything in the web marker, read from the `.worktrees/ios-hand-cut` worktree at `codex/ios-hand-cut` (current main); nothing was edited or built. Three things matter most before building:
- **The web has flaws that should not be copied as they are.** There are at least five, including "Mark again" failing on any point except the last and the final 1.5 seconds of taps being lost on close. They are listed in §10.8 and flagged ⚠ where they come up.
- **Where the web has no rule, the iOS port needs a decision.** The biggest is phone landscape: the web puts its controls over the picture, and the iOS rule is solid rails beside it (§10.1).
- **Some commit messages describe behaviour that was later replaced.** §11 lists which ones; the code is the source of truth.

Everything below is exhaustive by design, because it is the reference for the port.

**File abbreviations:** MP = `src/app/match/[id]/MarkPoints.tsx` · HC = `src/app/match/[id]/handCut.ts` · RMV = `src/app/match/[id]/RawMatchView.tsx` · CP = `src/app/match/[id]/ClipPlayer.tsx` · SM = `src/app/match/[id]/SpeedMenu.tsx` · CSS = `src/app/globals.css`

---

## 0. Design tokens (exact values)

**Theme colours** (CSS:4-10):

| Token | Hex |
|---|---|
| ink | `#0a0a0f` |
| surface | `#14141c` |
| surface-2 | `#1b1b26` |
| edge | `#262633` |
| cyan-glow | `#22d3ee` (rgb 34,211,238) |
| magenta-glow | `#e879f9` |
| magenta-soft | `#f0abfc` |

**Tailwind v4 defaults** (these are defined in oklch; the hex values are approximate):

| Token | oklch | ≈ hex |
|---|---|---|
| amber-200 | 92.4% 0.12 95.7 | #fee685 |
| amber-300 | 87.9% 0.169 91.6 | #ffd230 |
| amber-400 | 82.8% 0.189 84.4 | #ffb900 |
| zinc-100 | | #f4f4f5 |
| zinc-200 | | #e4e4e7 |
| zinc-300 | | #d4d4d8 |
| zinc-400 | | #9f9fa9 |
| zinc-500 | | #71717b |
| zinc-600 | | #52525c |

Opacity suffixes (`/15`, `/60` and so on) mean alpha 0.15, 0.60.

**Effects:**
- **`glow-cta`** (CSS:52-63): box-shadow `0 0 0 1px rgba(34,211,238,.4), 0 0 24px rgba(34,211,238,.35), 0 4px 40px rgba(34,211,238,.18)`. Transition: box-shadow 200ms ease, transform 150ms ease.
  - On hover the shadow becomes `.6 / 32px .5 / 6px 56px .28`, plus `translateY(-1px)`. This is hover only.
- **`ks-fade`** (CSS:234-246): 180ms ease-out, from opacity 0 at scale(0.97) to opacity 1.
- **`animate-pulse`**: 2s `cubic-bezier(0.4,0,0.6,1)`, infinite, opacity 1 → 0.5 at 50% → 1.
- **Default Tailwind `transition-*`**: 150ms `cubic-bezier(0.4,0,0.2,1)`.
- **Reduced motion** (CSS:40-49): every animation and transition drops to 0.01ms.

**Sizes:**
- Radii: `rounded-lg` 8px · `rounded-xl` 12px · `rounded-2xl` 16px · `rounded-full` pill.
- Text: `text-xs` 12px · `text-sm` 14px · `text-base` 16px · `text-lg` 18px · `text-2xl` 24px.
- Blur: `backdrop-blur-sm` 8px · `backdrop-blur-md` 12px.
- Font: Geist Sans; `tabular-nums` is used on every number.

**Other:**
- `active:scale-[0.99]` is used on the big buttons and `active:scale-[0.98]` on the answer tiles. Both are press feedback.
- `disabled:opacity-35` on the pair and utility buttons, `/30` on the answers, `/40` on Done.

---

## 1. Constants and timing (all of them)

| Constant | Value | Where | Meaning |
|---|---|---|---|
| `REFUSE_MS` | 2000 | MP:80 | How long a refusal line stays, then vanishes. No fade. |
| `SAVE_DEBOUNCE_MS` | 1500 | MP:84 | Draft autosave debounce. Re-armed on every change to marks or mode. |
| `PAUSE_GLYPH_MS` | 340 | MP:93 | How long the picture must stay paused before the centre play glyph appears. Longer than CP's 280ms double-tap window. |
| `CLIP_PRE` | 1.2s | MP:94 | Preview starts at `t0 − 1.2`. Must match the worker's `claim_hand_cut` clip_pads. |
| `CLIP_POST` | 1.3s | MP:95 | Preview stops at `t1 + 1.3`. |
| `REDO_LEAD_S` | 3s | MP:99 | "Mark again" seeks to `max(prevEnd, t0 − 3)`. |
| `PAD_WIDTH` | 380px | MP:101 | Desktop card width and the width of the side column in landscape. |
| `PAD_POS_KEY` | `"ponglens:mark-pad-pos"` | MP:102 | Saved `{x,y}` of the desktop card. |
| `MIN_POINT_S` | 0.7s | HC:87 | A shorter rally is refused. |
| `MAX_POINT_S` | 120s | HC:94 | A longer one is allowed, but counted as `long` in the review sheet. |
| `SPLIT_LEAD_S` / `LEAD_MIN_S` / `LEAD_MAX_S` | 0.6 / 0.6 / 1.2 | HC:108-115 | Start tap lead = `clamp(0.6 × rate, 0.6, 1.2)`. Mirrors `Core/Playhead.swift`. |
| End tap lead | 0 | HC:117-122 | Measured, deliberately none. |
| `GAP_WORTH_MARKING_S` | 4s | HC:171 | The minimum hole before a "+" is offered. |
| `TAIL_S` | 45s | HC:254 | Tape left after the last point that still counts as "marked to the end". |
| Validate cap | 400 points | HC:708 | |
| Validate past-end tolerance | `durationS + 0.5` | HC:714 | |
| Insert length | `max(0.7, min(6, span − 0.4))`, centred in the gap | MP:852-855 | |
| Adjust window | `[max(prevEnd, t0 − 8), min(nextStart, t1 + 8)]` | MP:1034-1040 | `nextStart` is `durationS ?? t1 + 30` for the last point. The window is fixed when the bar opens. |
| Adjust window after an insert | `[gap.lo, gap.hi]` | MP:871 | |
| Speed list | `[0.1, 0.25, 0.5, 1, 1.5, 2]` | SM:10 | |
| ±5s nudge | 5s, clamped to `[0, duration − 0.05]` | MP:1058-1063 | |
| Round | 2 decimals on every stored t0/t1/tap | HC:139 | |
| Pad drag threshold | 3px (hypot) | MP:495 | |
| Pad clamp margin | 8px from each viewport edge | MP:449-450 | |
| Default card height (for clamping) | 480 | MP:447 | Used until the card has been measured. |

**Inherited from ClipPlayer** (MP passes `mode="cut" fill readPixels={false}`, plus `playRef`, `speedRef`, `videoElRef`, `onTime`, `onLoadedMetadata`, `onClose`, `overlay`; see MP:2183-2208):

- **Hold for speed:** `HOLD_MS` 250ms. `HOLD_SLOW` is 0.25x on the left half; `HOLD_FAST` is 2x on the right half (CP:59-61).
  - It only arms while playing. Moving more than 8px (`TAP_SLOP`) cancels it.
  - Release restores `persistedSpeed`.
  - While held, a pill reading `"{rate}x"` sits top-centre (CP:1250-1254).
- **Double tap:** the window is `DOUBLE_TAP_MS` 280ms and the step is ±10s by picture half (CP:63-64, 1026-1053).
  - MP does NOT pass `onStepPoint`, so on this screen a double tap is always ±10s. ⚠ MP's comment at 346 says a double tap "walks the rallies"; that is not true here.
  - The first tap toggles play/pause at once and the second tap toggles back. That is the brief pause-and-play flicker `PAUSE_GLYPH_MS` exists to hide.
  - Acknowledgement: a flash reading `"+10s"` / `"-10s"` for 700ms, at `right-6` / `left-6`, vertically centred (CP:1300-1308).
- **Learn hint:** the text "Double-tap to skip" plus "10s" chips with chevrons.
  - Shown for 2200ms on first play, at most 3 openings per device (localStorage key `ponglens:seek-hint`).
  - Retired for good on the first real double tap (CP:74-76, 1287-1298).
- **Single tap:** play/pause.
- **Pinch zoom:** 1x to 4x, anchored at the pinch midpoint. One-finger pan while zoomed. Snaps back to 1x below 1.05. A "1x" reset pill appears top-left (CP:1240-1249).
  - The zoom persists across the session at module scope.
- **Chrome:**
  - Top-right cluster: Mute, then Close X, each a `p-1.5` circle `bg-ink/60` with a 14px icon (CP:1379-1440).
  - Bottom-right cluster at `bottom-12` (48px): the SpeedMenu pill and Zoom out / Zoom in (CP:1444-1540).
  - Cut transport pinned to the bottom (CP:1542-1606): a gradient from `ink/85`; a 16px play/pause glyph; the elapsed clock (11px, zinc-300, `w-11`); a 4px track (white/20, cyan fill); a 12px knob that grows to 16px while scrubbing; the duration clock (zinc-400).
  - `chromeFloor` = 52 in cut mode (CP:47).
- **Poster glyph:** full-bleed, a `ks-fade` circle `bg-ink/60 p-3.5` with a 28px play icon. Only shown while paused and before the first play in the session (CP:1211-1239).
- **Speed persistence:** `persistedSpeed` is module scoped (CP:18).
  - ⚠ MP's own `speed` state always starts at 1 (MP:320) and never reads from the player. The pad's bar can therefore show "1x" while the player plays at a speed chosen earlier.
  - Changing speed from the ClipPlayer pill, or by holding, also does not move MP's bar.

---

## 2. Data model and reducer (HC). Port 1:1, with shared test fixtures.

**The Mark record** (HC:30-44): `{id, t0, t1|null, winner: 'user'|'opponent'|null, isLet, starred, tap, rate}`.
- Times are in SOURCE seconds.
- `t0` already includes the lead.
- `tap` and `rate` are the raw playhead and playback rate at the start tap.
- An open rally is `t1 == null`. It can only ever be the LAST mark (`openMark`, HC:141).

**State** (HC:60-73): `{marks, undo[], selectedId, awaitingId}`.

**Undo entries** (HC:51-58): `start`, `start-over`, `end`, `outcome`, `star`, `move`, `remove`.
- The undo stack is NOT saved with the draft, so Undo is disabled when a draft is reopened.
- Every undo sets `awaitingId = null` and keeps `selectedId`, which can then point at a mark that no longer exists (HC:599-644).

**What each operation does:**
- **`startMark`** (HC:337-375): `t0 = round2(max(0, now − lead(rate)))`.
  - If a rally is open (a forgotten end), the open rally closes at the new `t0`, unscored, and a new one opens there. If `t0 − open.t0 < 0.7` it refuses `short`.
  - Otherwise, if `t0 < lastClosedEnd` it refuses `past`.
  - It clears both selection and awaiting.
  - ⚠ The forgotten-end path cannot be reached from the UI: while a rally is open the left button is Back to last point, and S does the same.
- **`resetOpen`** (HC:390-409): drops the open mark and returns `backTo = lastClosedEnd ?? 0`. It pushes a `remove` undo entry, so Undo restores the open rally.
- **`endMark`** (HC:419-438): refuses `noneOpen` or `short`. Sets `awaitingId = open.id` and `selectedId = null`.
- **`setOutcome`** (HC:449-474): the target is `awaitingId ?? selectedId`, else it refuses `noneEnded`.
  - Pressing the answer the point already has clears it (a toggle).
  - Let and a win are mutually exclusive.
  - Always clears `awaitingId`.
- **`toggleStar`** (HC:476-489).
- **`clearAwaiting`** (HC:498).
- **`selectMark`** (HC:503): selecting the id already selected deselects it; passing null deselects.
- **`setEdges`** (HC:551-581): rounds, refuses `short`, refuses `inside` if it would cross a neighbour.
- **`removeMark`** (HC:583).
- **`insertMark`** (HC:219-249): refuses `short` or `inside` (overlap with any closed mark). Keeps the list sorted by t0, selects the new mark, and pushes a `start` undo entry.
- **`gapsAround`** (HC:187-210): uses closed marks only.
  - Before the first point, the gap starts at 0.
  - After the last point, it runs to `durationS`. With no duration there is no "after" gap.
  - A side only qualifies if its gap is at least 4s.
- **`draftMode`** (HC:269): the recorded mode, else "score" if any mark has a winner or is a let, else "cut".
- **`openAs`** (HC:294-306): see §3.
- **`summarize`** (HC:658): `{total (closed), unscored (closed, not let, no winner), open, long, starred}`.
- **`validate`** (HC:702-721), with messages verbatim:
  - "Nothing marked yet."
  - "That is more than 400 points."
  - "A point has no length."
  - "Too short to be a point."
  - "Two points overlap."
  - "A point runs past the end of the video."
  - "A point is both a let and a win."
- **`submittable`** (HC:674): `{t0, t1, w, let, star, tap, rate}`, closed marks only, sorted.

**Refusal copy** (HC:125-131, plus MP:735):
- "Too short to be a point."
- "No point open."
- "End the point first."
- "That's inside the last point."
- "That's before the last point ended."
- "Left uncalled."

**Score and server:** computed by the product's own `computeMatchScore` and `computeServing` on `asPoints(marks)`, closed marks only (MP:1179-1198). The next server is found by adding a dummy `__next__` point and asking the rotation who serves it. iOS must call its existing ports of these, never re-derive the rotation.

---

## 3. How the screen opens (MP:257-316)

- `resumed = initialMarks.length > 0`.
- `openedMode = resumed ? draftMode(marks, initialMode) : null`.
- `openedAs = openAs(marks, durationS, openedMode ?? "score")`.
  - `durationS` comes from RMV's own player metadata and can be null.

The four ways in:

| openAs | Condition | Mode sheet? | `started` | Selected | Gate |
|---|---|---|---|---|---|
| `fresh` | No marks | yes (`mode == null`) | false | none | "Begin Cutting" |
| `scoring` | Mode is score and not every point is called | no | **true** (pad live at once); false when a processed match is marked again | `firstUnscored` | none; on Cut again, "Keep marking" + "Start again", each with its line |
| `review` | Every point called (or cut mode), and `duration − lastEnd ≤ 45s` | no | false | `marks[0]` | "Begin review" |
| `choice` | Every point called (or cut mode) and more than 45s remain, OR no duration known | no | false | `marks[0]` | "Keep marking" + "Review the points" |

- **A cut-only draft never opens as `scoring`.** It is always `review` or `choice`, however many of its points lack a winner (HC:300-302).
- **First video metadata event:** `resumeToLastPoint`, which runs `cueReview` once (MP:658-663, 2200-2205).
  - The cue is the selected mark, else the first unscored.
  - If the cue is closed: seek to `t0 − 1.2` and set a preview stop at `t1 + 1.3`.
  - Otherwise: seek to `lastClosedEnd`, with no preview stop.
  - Playback does not start (cut-mode ClipPlayer starts paused, CP:636).
- **The serve question is asked on the way in** when `openedMode === "score"` and `tracksServe(matchType)` and the match has no first server (MP:308-312).
  - `tracksServe` (`src/lib/matchTitle.ts:88`) is true when there is no type, or the type is not a non-match type.

---

## 4. Every screen state: what is on screen, and the exact copy

### 4.1 Mode sheet (fresh only, `mode === null`; MP:2237-2274)
- **Backdrop:** `absolute inset-0 z-30`, `bg-ink/70` with an 8px backdrop blur.
  - It is bottom-anchored below 640px (`items-end`) and centred at 640px and up (`sm:items-center`).
- **Card:** `ks-fade`, full width, `rounded-t-2xl` (16px top corners), 1px edge border, `bg-surface`, padding 20px with 32px at the bottom.
  - At 640px and up: `max-w-sm` (384px), all corners rounded, 20px bottom padding.
- **Content, verbatim:**
  - H2 (16px semibold): **"Cut only, or cut and score?"**
  - Subline (12px zinc-500, 2px top margin): **"You can score it later either way."**
  - Two stacked options (16px top margin, 8px gap). Each is `rounded-lg`, 1px edge border, `bg-ink/40`, `px-4 py-3`, left-aligned; hover turns the border `cyan/40`.
    1. Title (14px semibold zinc-100) **"Cut and score"**; sub (12px zinc-500) **"Say who won each point as you go."**
    2. Title **"Cut only"**; sub **"Mark where each rally starts and ends."**
- **Behaviour:**
  - "Cut and score" sets `mode = score`, and opens the serve sheet if a rotation applies (MP:616-622).
  - "Cut only" sets `mode = cut`.
  - The sheet has no dismiss control, and the backdrop covers ClipPlayer's Close X.
  - ⚠ Pressing Space or Enter behind the sheet still fires `beginCutting` (the keyboard ignores the sheet).

### 4.2 Serve sheet ("Who served first?"; MP:2276-2319)
- **Shown:** on the way into scoring, and again when switching to scoring mid-pass (§6).
- **No backdrop:** the wrapper is `pointer-events-none`, so the video and the pad stay visible and usable.
  - The card is always bottom-anchored (`items-end`). At 640px and up it gets a 24px bottom margin and becomes a 384px rounded card.
  - Card styling otherwise matches the mode sheet, including `ks-fade`.
- **Content, verbatim:**
  - H2: **"Who served first?"**
  - Sub (12px zinc-500): **"Sets the serve rotation for the whole match. Play the start if you need to check."**
  - A two-column grid of buttons: youLabel, themLabel. Each is `rounded-lg`, 1px edge border, `bg-ink/40`, `px-4 py-3`, 14px semibold zinc-300, truncated.
    - youLabel is always **"Me"**. themLabel is the first word of the opponent's name, at most 12 characters, else **"Them"** (RMV:1309-1310).
  - A 12px-high gap, then a row justified to both ends:
    - Pill **"Play from the start"** (`rounded-full border px-4 py-2`, 12px semibold zinc-200). It seeks to 0 and plays.
    - Pill **"Not sure yet"** (12px zinc-400, hover border zinc-500).
- **Answering:** sets the local first server, saves it to `matches` through `userFirstServerUpdate`, and rolls back if the save fails (RMV:188-200). Then the sheet closes.
- **Closing:** on the way in, closing pauses the video and runs `cueReview`. For a fresh session there is nothing to cue, so the playhead stays wherever "Play from the start" left it.
  - Mid-pass, closing does nothing to playback (`serveStepCue`, MP:615-634).

### 4.3 Gate (`!started`; pad body at MP:1730-1755; landscape at MP:1791-1833)
- The ticker, the strip and the speed bar are all visible above the gate.
- **Fresh:** one button, **"Begin Cutting"** (`glow-cta`, 64px tall, full width, `rounded-xl`, `bg-cyan-glow`, 16px bold ink text).
  - It sets `started` AND plays in the same gesture (on the web, a video may only start from a real tap).
- **Review:** the same button reads **"Begin review"**. It plays the first closed mark and walks on through the rest (MP:834-839).
- **Choice:** two buttons in a column with an 8px gap:
  - **"Keep marking"**: primary, 64px. It deselects, seeks to the last end and plays (MP:955-972).
  - **"Review the points"**: 48px, 2px edge border, `bg-surface`, 14px bold zinc-300; hover gives a `cyan/50` border and white text.
- The util row and the answer row are hidden. The footer shows the count and Done, but NOT the scoring toggle, which needs `started` (MP:2132).

### 4.4 Marking idle (started, nothing open, nothing selected)
- **Pair (left to right):**
  - **"Begin Point"**: lit (`glow-cta`, 2px cyan border, cyan fill, ink text).
  - **"End Point"**: unlit (2px edge border, `bg-surface`, zinc-400) AND disabled (35% opacity).
- **Answers (score mode only):** disabled (30%) with an edge border, `bg-surface` and zinc-500 text.
- **Util row:**
  - Undo: enabled if the undo stack is non-empty.
  - Star: enabled if any mark exists. It targets the last mark.
  - −5s and +5s: enabled.
  - Mark again and Remove: disabled.

### 4.5 Point open (a rally in progress)
- **Pair:**
  - The left button becomes **"Back to last point"** (was "Reset"), unlit (edge border, `bg-surface`, zinc-400; hover gives an `amber-400/50` border and amber-200 text).
  - **"End Point"**: lit.
- **The open chip:** a cyan border, `cyan/10` fill, cyan text, scaled to 110%, with a white glow `0 0 12px rgba(255,255,255,.35)`.
  - It grows as the rally runs (§5).
  - `aria-current="true"`.
- **Back to last point:** removes the open mark, seeks to `lastClosedEnd ?? 0`, and plays (MP:713-724).
- **Answers:** disabled. An answer during a rally is refused ("End the point first."), which can only be reached from the keyboard.

### 4.6 Awaiting an answer, picture held (score mode, right after End Point)
- **End Point** closes the rally. In score mode it also PAUSES the video and sets `pausedForAnswer` (MP:741-752).
- **Answer row:**
  - Every tile is lit: **Me** (cyan border, `cyan/15` fill, cyan text); **Them** (magenta-glow border, `magenta/15`, magenta-soft); **Let** (`amber-400/70` border, `amber-400/10`, amber-300).
  - All tiles run `animate-pulse` with a `ring-2 ring-white/60` (MP:1456-1458).
- **The awaiting chip:** 110% scale, white glow, `aria-current`.
- **Pair:** Begin Point is lit again; End Point is disabled.
- **What each input does now:**
  - **An answer:** records it, clears awaiting, and plays again only if this screen was the one that paused it (MP:699-703).
  - **Begin Point while held:** does NOT start a rally. It clears awaiting, resumes, and shows **"Left uncalled."** (MP:732-737). The player must press Begin again.
  - **Undo:** reopens the rally and resumes.
  - **Space:** clears the hold flag and toggles playback.
  - **Switching to cut-only:** releases the hold.
- **After 340ms paused**, the centre play glyph appears (§5.6).
- **Cut-only mode never holds.**

### 4.7 A point selected: review or playback
- **How a point gets selected:** tapping a closed chip, Prev/Next, the auto-walk, or the cue on reopen.
- **`playMark`** (MP:801-815): selects the point, clears the hold, seeks to `t0 − 1.2`, sets the preview stop at `t1 + 1.3`, and plays.
- **Tapping the chip that is already selected:** pauses and clears the preview stop (MP:822-826).
- **The pair's slots change meaning** (MP:1394-1411):
  - Left: **"Adjust"**, lit.
  - Right: **"Resume"**, unlit (2px edge border, `bg-surface`, zinc-300; hover gives a `cyan/50` border and white text).
- **Answers are lit, and do not pulse.**
  - Answering a selected point with nothing awaiting calls `advanceReview` (MP:761-775): select the next unscored point after this one and play its clip; if there is none, deselect and clear the preview stop.
  - ⚠ Pressing the same answer again clears the winner and STILL moves on.
- **Util row:** Mark again and Remove are enabled. Star lights amber when the selected point is starred.
- **A dashed "+" appears** before and/or after the selected chip wherever that side's gap is at least 4s.
- **Picture buttons** become **"Prev"** / **"Next"**, walking closed marks. Each is disabled at the end of the list.
- **When a clip plays out** (`onTime`, MP:2191-2199): pause, then `chainAfterPreview` (MP:901-913).
  - In score mode, if the point is not a let and has no winner, stay held (the answers are lit).
  - Otherwise play the next closed mark IMMEDIATELY, with no gap between clips.
  - If there is no next point, stay paused.
- **Resume** (MP:955-965): deselect, clear the preview stop, seek to `lastClosedEnd`, play.
- **Mark again** (MP:980-999): removes the point (undoable), deselects, closes the adjust bar, seeks to `max(prevEnd, t0 − 3)`, plays.
  - ⚠ See §10.8: on any point except the last, the next Begin is refused.
- **Remove** (MP:1499-1508): removes the point, closes the adjust bar, deselects. Playback is not touched.

### 4.8 Adjusting (the bar replaces the speed control)
- **Opening** (MP:1029-1043): sets the draft to `[t0, t1]`, fixes the window (§1), and pauses.
- **The pair:** the left button becomes **"Confirm"** (lit). **Resume is disabled** until Confirm is pressed (MP:1406).
- **The bar** (MP:1591-1670), 46px tall (36px in landscape):
  - Left label: the point number (`w-9`, 11px semibold zinc-200).
  - Track: 32px hit height. The rail is 6px, `white/10`, fully rounded, clipped. A `cyan/45` band runs between the two edges.
  - Playhead dot: 12px cyan, glow `0 0 8px rgba(34,211,238,.7)`, clamped to the track.
  - Two handles, each a 36×32 hit box centred on its edge: a 2×32 cyan line plus a 16px ring knob (2px cyan border, ink fill, glow `0 0 8px rgba(34,211,238,.6)`).
  - Right label: the duration, `"{x.x}s"` (10px zinc-400, tabular).
- **Dragging:**
  - The dragged edge is clamped to the window, and the point may never become shorter than 0.7s.
  - The video seeks to the dragged edge live ("the picture follows the handle").
  - Nothing is written until Confirm.
  - A mouse move with no button held is ignored.
- **Confirm** (MP:1045-1056): calls `setEdges` if anything changed, which is undoable and can refuse. The bar closes.
- **Leaving without confirming discards the drag.** Any change of selection closes the bar (MP:1222-1229).
- **While adjusting**, the answers, the util row and Prev/Next all still work.

### 4.9 Inserting a missed rally ("+")
- The button: 24×32, fully rounded, 1px dashed zinc-600 border, zinc-500 text, 14px plus icon (stroke 2.5).
  - Hover: `cyan/60` border and cyan text. Title: "Add a rally here".
  - Position: immediately left or right of the selected chip.
- **`insertAt`** (MP:850-875): inserts at the centre of the gap, with the length from §1.
  - Then pauses, seeks to `t0 − 1.2`, and opens the adjust bar on the new point with the window set to the gap.
  - The new point is left uncalled. Confirm writes the edges; leaving it keeps the guess; Undo removes it.

### 4.10 Review sheet (Done; MP:2321-2368)
- **Done button:** a pill with a 1px edge border, `px-4 py-2`, 12px semibold zinc-200; hover border `cyan/50`. Disabled at 40% when there are no closed points.
  - Pressing it pauses the video and opens the sheet.
- **Overlay:** `z-20`, centred on every screen size, `bg-ink/70` with an 8px blur, 16px padding.
  - Card: `max-w-sm`, `rounded-2xl`, 1px edge border, `bg-surface`, 24px padding.
  - **No entrance animation** (no `ks-fade`).
- **Lines, in order, verbatim:**
  1. **"{N} point marked."** / **"{N} points marked."** (18px semibold).
  2. Score mode with unscored points only: **"{U} has no winner yet. You can score it from the match."**, or with more than one: **"{U} have no winner yet. You can score them from the match."** (14px zinc-400, 8px top margin).
  3. If a rally is still open: **"One point has no ending and will not be included."** (14px `amber-300/90`).
  4. If any point is over 120s: **"{L} point is over two minutes long. Check you did not miss an ending."**, or **"{L} points are over two minutes long. …"** (amber).
  5. Always: **"This match cannot be processed automatically afterwards."** (14px zinc-400, 12px top margin).
  6. A submit error, if there is one (amber, 12px top margin).
- **Primary button:** **"Cut the match"**, which reads **"Sending"** while busy.
  - `glow-cta`, full width, pill, `bg-cyan-glow`, `py-3`, 14px semibold ink, 20px top margin, 50% opacity while disabled.
- **Secondary button:** **"Keep marking"** (pill, 1px edge border, `py-2.5`, 14px semibold zinc-200, hover `bg-surface-2`). It closes the sheet and does NOT resume playback.
- **Keyboard shortcuts are disabled** while the sheet is open (MP:1069).

### 4.11 Sending and errors (MP:1243-1255; RMV:395-430)
- `validate` runs first; a failure shows its reason in the sheet.
- Otherwise: busy, then the `claim_hand_cut` RPC with `p_match_id` and `p_marks: submittable(marks)`.
- **RPC error messages, verbatim** (RMV:404-415):

| Server code | Message |
|---|---|
| `already_cut` | "This match already has points." |
| `already_processing` | "Something is already running on this match." |
| `queue_full` | "Your queue is full. Wait for a video to finish." |
| `check_pending` | "Still checking the video. Try again in a moment." |
| `invalid_marks` | "Some marks are not valid. Check for very short points." |
| anything else | "That didn't send. Check your connection and try again." |

- **On success:** the marker closes, the job is set locally to `{kind: "hand_cut", status: "queued"}`, the page refreshes, and the ordinary Processing card appears with its progress bar.

### 4.12 Entry row and failure section (RMV)
- **Entry row:** inside the "Break it into points" card (headline "Break it into points", sub "Every rally as its own clip"). After the "Automatically" row there is (RMV:983-1008):
  - A row with title (14px semibold zinc-100) **"Mark the points yourself"** and sub (12px zinc-500) **"You tap where each point starts and who won."**
  - On the right: **"{N} marked"** when the draft has closed points, else **"Free"** (14px semibold zinc-300), followed by the chevron.
  - Disabled when there is no video URL or the file cannot be decoded.
  - Shown only when `handCutEnabled && handCutReady`. It hides itself if the `hand_cut_drafts` read errors (RMV:356-374).
- **Failure section** (RMV:746-758): shown when the latest job is a failed `hand_cut`. The processing card opens by itself (RMV:130-133).
  - Heading (12px uppercase, tracking-wider, zinc-500): **"Marked by hand"**
  - Body: `job.user_message` or **"The cut didn't finish."** (14px zinc-300).
  - Then: **"Your marks are saved. Open them, check them and send them again."** (14px zinc-400).
- **Frozen URL:** the marker keeps the signed URL it opened with for the whole session (RMV:139-149). This stops a page refresh from reloading the video to 0.
- **Background video:** while the marker is open, the page's own player is swapped for an empty 16:9 box, so the file is not streamed twice (RMV:660-664).
- **Draft storage:** `hand_cut_drafts` upsert of `{match_id, user_id, marks, mode, updated_at}`, keyed on `match_id` (RMV:376-393).
  - ⚠ The save effect also runs on mount, so opening the marker writes an empty draft row straight away.

---

## 5. Animations and visual states (exact)

### 5.1 Chips (MP:142-219)
- **Size:** 32px tall. 32px wide when closed. When open, the width is `min(60, 32 + grow)` px, where `grow = playhead − open.t0` in seconds, so it widens 1px per second and caps at 28s.
- **Shape:** fully rounded, 1px border, 12px semibold tabular text, `overflow-hidden`.
- **Transition:** `transition-[width,transform,box-shadow]`, 150ms, default easing.
- **Open fill:** an absolute span at `cyan/25`, width `min(100, grow × 3)`% (full at about 33s), with a 300ms linear width transition.

**Colour by state:**

| State | Border | Fill | Text |
|---|---|---|---|
| open | cyan | cyan/10 | cyan |
| let | amber-400/50 | amber-400/10 | amber-300/90 |
| you won | cyan/60 | cyan/20 | cyan |
| they won | magenta-glow/60 | magenta-glow/20 | magenta-soft |
| not called | **dashed** zinc-600 | transparent | zinc-500 |

- **Rings:** playing gives `ring-2` cyan. Otherwise selected gives `ring-2` `white/90`. Playing wins over selected.
- **Scale and glow:** open or awaiting gives `scale-110` with a white glow (12px, .35). Otherwise playing gives `scale-110` with a cyan glow `0 0 12px rgba(34,211,238,.55)`.
- **"Playing"** is derived from the PLAYHEAD, not from what was tapped: the first closed mark with `t0 − 1.2 ≤ playhead ≤ t1 + 1.3` (MP:1205-1213).
- **Star:** a ★ at 8px amber-300, absolute top-right (`right-0.5 top-0`).

### 5.2 Strip scrolling
- When the number of marks changes, the strip scrolls smoothly to its right end (MP:1215-1219).
- When the selected or playing point changes, that chip scrolls smoothly into view, centred horizontally (MP:1232-1239).
- ⚠ The chip lookup uses `el.children[i]`, and the "+" buttons are extra children, so the index can be off by one once a "+" is showing. iOS should scroll by id.
- The strip's scrollbar is hidden; the gap between items is 6px.

### 5.3 Answer row
- `transition-all` at 150ms. `animate-pulse` plus `ring-2 ring-white/60` only while awaiting.
- Lit and unlit swap instantly apart from the colour transition.

### 5.4 Buttons, lit and unlit
- The lit state is `glow-cta` plus cyan fill. The swap is `transition-colors` at 150ms; the glow's box-shadow has its own 200ms transition.

### 5.5 Refusal line
- Plain text, instant in and instant out, 2000ms. Any new refusal restarts the timer.
- Style: 12px semibold `amber-300`, centred, `role="status"`.
- ⚠ In portrait it is inserted in the flow above the pair, so it pushes the controls down for 2 seconds.

### 5.6 Centre play glyph (MP:2047-2072)
- **Shown when** `started && everPlayed && stopped`, where `stopped` means paused for at least 340ms (MP:665-696). Hidden instantly on play.
- **Style:** 48px circle, 1px `white/15` border, `bg-ink/60`, 8px blur, centred on the picture. A 24px play path offset 2px right. `active:bg-ink/80`.
- Before the first play of the session, ClipPlayer's own poster glyph shows instead.

### 5.7 Speed bar (MP:1521-1585)
- **Layout:** label `"{speed}x"` (`w-9`, 11px semibold zinc-200); track; then the word **"speed"** (`w-10`, right-aligned, 10px zinc-500).
- **Track:** a 6px rail at `white/10`. Six ticks (2×8px) placed **evenly by index, not by value**; ticks at or below the current one are `cyan/60`, the rest `white/25`.
- **Knob:** 20px ring (2px cyan border, ink fill, glow 8px at .6). No transition, so it snaps.
- **Input:** pointer down jumps to the nearest index, dragging snaps between indices, and the rate is applied through `speedApi.set`.
- The bar always shows the speed control except while adjusting, when it shows the range bar; the swap is instant. In phone landscape the speed bar is never shown (§7.3).

### 5.8 Sheets
- The mode and serve sheets use `ks-fade` (180ms, fade in from 0.97 scale). The review sheet has no animation.

### 5.9 Picture skip buttons (MP:2003-2046)
- **Portrait and desktop:** 40px circles, 1px `white/15` border, `bg-ink/60`, blur, 11px semibold zinc-100.
  - Left one at `picture.left + 10`; right one at `picture.left + picture.width − 50`; both vertically at `picture centre − 20`.
- **Landscape:** 48×32 pills at `top: 2`, centred with a 24px gap between them (`translateX(-60px)` and `translateX(12px)`).
- **Labels:** "−5s" / "+5s" (U+2212 minus) while marking; "Prev" / "Next" while a point is selected, disabled at 30% at either end.
- They are shown in every state, including behind the gate.

### 5.10 Desktop card
- `rounded-2xl`, 1px edge border, `bg-ink/90`, 12px blur, shadow `0 25px 50px -12px rgba(0,0,0,.25)` darkened to black/50.
- Grab bar: 20px row with a centred 36×4 `white/20` pill; cursor grab, and grabbing while dragging.

### 5.11 Utility buttons (MP:112-137)
- 40px tall, sharing the width equally, `rounded-lg`, 1px border, 10px semibold, tight leading, allowed to wrap to two lines.
- Off: edge border, `bg-surface`, zinc-400; hover `cyan/40` border and zinc-100 text.
- Lit (Star only): `amber-400/60` border, `amber-400/15` fill, amber-300 text.

---

## 6. Behaviour rules (the complete list)

1. **The three-tap rhythm:** Begin Point → End Point → Me / Them / Let. In score mode the video pauses only for the answer; in cut mode it never pauses.
2. **Always read the live clock:** every tap reads `currentTime` from the video at that moment, never the last time-update event (MP:531-535).
3. **Start taps store the lead** `clamp(0.6 × rate, 0.6, 1.2)`, plus the raw `tap` and `rate`. End taps get no lead.
4. **Only a pause this screen caused is one it undoes** (the `pausedForAnswer` flag). A player who paused by hand is not pushed back into motion by an answer.
5. **Begin while held** means carry on: the point is left uncalled with "Left uncalled.", and no rally is started.
6. **Back to last point** is Begin's replacement while a rally is open. It rewinds to the last end and plays.
7. **Undo** always resumes playback if this screen paused it.
8. **Chip tap:** plays that point's clip; tapping the selected chip again pauses it.
9. **Auto-walk:** a clip that plays out chains straight into the next closed point, except in score mode when the point it ended on is uncalled, in which case it holds.
10. **An answer given in review** moves on to the next unscored point and plays it.
11. **Adjust:** only Confirm writes; Resume is disabled until then; changing the selection discards the drag.
12. **Mid-pass mode switch** (MP:928-952), shown only after the session has started:
    - **To cut:** clear awaiting and release a held picture.
    - **To score:** if a rotation applies AND there is no first server AND no rally is open, show the serve sheet without moving the playhead. If a rally is open it is never asked, not even later.
    - Winners already called are always kept.
13. **Autosave:** 1.5s after the last change, silent on failure.
    - ⚠ Closing within 1.5s of the last tap loses those taps, because the pending save is cancelled when the screen closes (MP:1167-1169). iOS should save immediately on close.
14. **Close (X)** closes straight away, with no confirmation and no final save.

### Keyboard (MP:1067-1153)
- The listener runs in the capture phase so a focused video cannot swallow keys.
- It ignores key repeats, anything typed into a field, and everything while the review sheet is open.

| Key | Before the session starts | After it starts |
|---|---|---|
| Space / Enter | The gate's primary action: `beginMarking` on choice, `beginReview` on review, `beginCutting` otherwise | (Enter does nothing) |
| Space | | Clears the hold flag, then toggles play/pause |
| S | | Back to last point if a rally is open, else Begin |
| E | | End |
| ← | | Cut mode, or with Shift: −5s. Otherwise: answer Me |
| → | | Cut mode, or with Shift: +5s. Otherwise: answer Them |
| K / L | | Let (ignored in cut mode) |
| U | | Undo |
| T | | Star |

**Key legend** (MP:1685-1714): only shown at 1024px and up.
- Style: `kbd` keys with a 1px edge border, `bg-surface`, 9px mono zinc-400; labels 10px zinc-500.
- Cut mode: S "Begin" (or "Back to last point" when a rally is open) · E "End" · U "Undo" · T "Star" · Space "Play".
- Score mode adds: ← youLabel · → themLabel · K "Let".

---

## 7. Layouts and the conditions that select each

Media queries are evaluated in JavaScript, not CSS (MP:408-430):
- `floating` = `(min-width:1024px) and (pointer:fine)`
- `overlayPad` = `(orientation:landscape) and (pointer:coarse) and (max-height:500px)`, copied verbatim from Player.tsx
- `portrait` = `(orientation:portrait)`

The root is a full-screen overlay (`fixed inset-0 z-[80]`, `bg-ink`) with the bottom safe-area inset as padding (MP:2157-2161).

### 7.1 Desktop floating card (`floating`)
- **Video:** fills the whole screen.
- **Card:** 380px wide, height up to the viewport minus 32px, scrolls vertically.
  - Default position: 24px from the right edge, vertically centred.
  - It can be dragged from any dead space, never from a button, link or field.
  - While dragging it is clamped 8px inside the viewport. On release the position is saved to localStorage, and re-clamped when read back (MP:434-524).
- **Fixed row heights:** the pair is 64px, the answers 56px.
- **Card contents, top to bottom:** grab bar → ticker → strip → bar → a padded 12px column (10px gap) holding: refusal, gate or (pair, answers, utility row), footer row, legend.

### 7.2 Mobile portrait (not floating, not overlay, portrait)
- **Video box:** full width, height `min(100vw ÷ aspect ratio, 42dvh)`.
  - The aspect ratio is read from the file's metadata, defaulting to 16:9 (MP:2173-2181).
- **Pad** below it, filling the rest of the screen, in this order:
  1. Ticker: its own row with a bottom border (`edge/60`), 12px horizontal padding.
  2. Strip: at least 52px tall.
  3. Bar: 46px.
  4. Controls: a 12px-padded column with 10px gaps: refusal → pair (3 parts of the leftover height, at least 64px) → answers (2 parts, at least 56px; score mode only) → utility row (40px) → footer.
- The pair and the answers grow to fill the remaining height in a 3:2 ratio.

### 7.3 Phone landscape bands (`overlayPad`; MP:1768-1987)
Everything sits over the video, which fills the screen. `base = chromeFloor + 6 = 58`; `baseRight = chromeFloor + 34 = 86`, which clears ClipPlayer's speed and zoom pills.

- **Top-left** (at 4px, 4px): the ticker. 30px tall pill, `bg-ink/50` with blur, 16px score, the server shown as a dot only with no text.
- **Top band:** the chip strip or, while adjusting, the range bar.
  - Placed 116px from the left, 176px from the right, 38px from the top.
  - The strip is 32px tall; the range bar sits in a 36px panel.
  - **The speed bar is never shown here.** Speed is reachable only through ClipPlayer's own pill and the hold gesture.
- **Done:** 76px from the right, 4px from the top, clearing the Mute and Close buttons.
- **±5s / Prev·Next pills:** top-centre, 2px from the top.
- **Gate:**
  - Fresh or review: one centred cyan button, 200×56, bottom at 98px.
  - Choice: "Keep marking" 200×52 with its bottom at 110px, and "Review the points" 200×40 (`ink/70` fill, `white/15` border, 14px zinc-200) with its bottom at 62px.
- **Left column** (4px from the left, 100px wide). Bottom offset and height of each button:

| Slot | Bottom | Height | Label |
|---|---|---|---|
| 1 | 58 | 62 | "End Point", or "Resume" in review |
| 2 | 126 | 62 | "Begin Point" / "Back to last point", or "Adjust" / "Confirm" in review |
| 3 | 194 | 34 | "Undo" (11px, `ink/60`) |
| 4 (review only) | 232 | 34 | "Mark again" |
| 5 (review only) | 270 | 34 | "Remove" |

  - **The vertical order is the opposite of portrait's left-to-right order:** End is at the bottom and Begin is above it.
  - Lit rules: slot 1 is lit only while marking with a rally open. Slot 2 is lit when in review OR when no rally is open. Unlit is an edge border, `ink/70` fill, zinc-300.
- **Right column** (4px from the right, 104px wide), score mode only. Bottom offset and height of each tile:

| Tile | Bottom | Height |
|---|---|---|
| Me (cyan/20) | 192 | 60 |
| Them (magenta/20) | 126 | 60 |
| Let (amber/15) | 86 | 34 |

- **Refusal:** centred, 78px from the top.
- **Missing in landscape:** Star, the in-pad ±5s buttons, the scoring toggle, the footer count text, the legend and the speed bar.
- Tiles use `backdrop-blur-sm`, `rounded-xl`, bold text and 98% press scale.

### 7.4 Landscape side column (landscape, not a phone, not `pointer:fine` at 1024px or wider)
Examples: a tablet in landscape, or a small or touch laptop.
- The root lays out as a row: the video fills the full height, and the pad is a fixed 380px column beside it with a left border, scrolling if needed.
- The rows still use the portrait fill rules (3:2).

---

## 8. Cut only versus cut and score: every difference

| Aspect | Cut and score | Cut only |
|---|---|---|
| Ticker | "{you} - {them}" (cyan, zinc-600 "-", magenta-soft), a games pill "{a}-{b}" once any game is complete, and "{label} serves" with a dot, right-aligned (dot only in landscape) | "{N}" (24px bold zinc-200) + "point" / "points" (11px zinc-500); no server |
| Answer row (portrait and desktop) | shown | hidden |
| Answer tiles (landscape) | shown | hidden (MP:1915) |
| End Point | pauses and holds for the answer | never pauses |
| Auto-walk | holds on an uncalled point | never holds |
| ← → keys | answer Me / Them (Shift: ±5s) | ±5s |
| K / L | Let | ignored |
| Legend | 8 entries | 5 entries |
| Footer text | "{N} point(s) · {U} to score" when U > 0, else "{N} point(s)" | "One point still open" when a rally is open, else "{N} point(s)" |
| Review sheet | the unscored line is shown | no unscored line |
| Serve sheet | on the way in, and on switching back to scoring | never |
| Toggle pill | **"Stop scoring"**, aria "Stop calling who won each point" | **"Score them too"**, aria "Also call who won each point" |
| Opening a draft | uncalled points open in the scoring pass (on Cut again: the "Keep marking" / "Start again" gate) | always the gate (review or choice) |
| Draft `mode` column | "score" | "cut" |

- **Toggle pill style:** pill, 1px edge border, `px-3 py-2`, 11px semibold zinc-400; hover `cyan/50` border and zinc-100 text. It sits in the footer to the left of Done.
- **Same in both modes:** Star, Undo, Adjust, insert, Mark again, Remove, the chips (chips still show winners called earlier), and the selected-point answer target.

---

## 9. Accessibility labels (verbatim)

- **Chip:** `aria-label="Point {n}, {in progress|let|you won|they won|not called}"`, with `", playing"` appended when playing. `aria-current="true"` when open or awaiting.
  - The words "you won" and "they won" are fixed and do not use the player labels.
- **Plus:** `title="Add a rally here"`; aria-label "Add a rally before this point" / "Add a rally after this point".
- **Speed:** `role="slider"`, aria-label "Playback speed", `aria-valuemin` 0.1, `aria-valuemax` 2, `aria-valuenow` = the speed. It has no keyboard focus or operation.
- **Range handles:** "Start of point" / "End of point".
- **Picture buttons:** "Back five seconds" / "Forward five seconds" / "Previous point" / "Next point". The centre glyph is "Play".
- **Toggle:** as in §8. The refusal line is `role="status"`.
- **Hidden from assistive tech:** the grab bar (`aria-hidden`, with `title="Drag to move"`), the server dot, the star glyph, the chip fill and the SVG icons.
- **ClipPlayer:** "Play" / "Pause", "Mute" / "Unmute", "Close", "Zoom in" / "Zoom out", "Reset zoom".
- **The sheets have no `role="dialog"`, no `aria-modal` and no focus trap.**

---

## 10. Hard or ambiguous to replicate on iOS

### 10.1 Phone landscape conflict (decision needed)
The web puts every control over the picture as translucent tiles, and it drops the speed bar, Star, the in-pad ±5s buttons and the scoring toggle in landscape. The iOS rule (memory: `landscape-scorer-off-picture.md`) is solid bars and rails, never over the video.

Suggested mapping onto the iOS rails:
- Left rail: the pair, Undo, Mark again, Remove.
- Right rail: Me, Them, Let.
- Top band: ticker, strip or range bar, Done.

Whether landscape on iOS regains the speed bar, Star and the toggle is a product call. "Replicate exactly" and the iOS rule cannot both hold here.

### 10.2 Hover and keyboard
- Every `hover:` style is desktop only and has no iOS counterpart. Drop them.
- The keyboard map and legend have no counterpart unless hardware keyboards on iPad are supported. If they are, use `UIKeyCommand`.

### 10.3 Desktop floating draggable card
Not needed on iPhone. On iPad it is a choice: the web gives iPad the side column (§7.4) or bands, not the card, because iPad has a coarse pointer.

### 10.4 Picture geometry
Several positions depend on ClipPlayer's measured picture box and `chromeFloor` (52): the skip buttons, the play glyph and the landscape offsets. iOS needs its own AVPlayer layer rect and must reserve room for its own transport.

### 10.5 Gestures copied from ClipPlayer
- Double tap is ±10s by half, and the first tap toggles play/pause immediately. That flicker is the reason for the 340ms glyph delay.
- The web comment claiming the double tap walks the rallies is wrong; see CP:1026-1053.
- Hold for 0.25x / 2x, pinch zoom and the learn hint must all be matched.

### 10.6 Speed state is out of sync on the web
MP's speed bar starts at 1x and ignores the persisted speed, the ClipPlayer pill and the hold gesture. The iOS port should read and write one speed source of truth, not copy this.

### 10.7 CSS-only effects
- `glow-cta` is a multi-layer box shadow. Copy the values in §0.
- `animate-pulse` is an opacity loop, 2s at 1 → 0.5 → 1 with `cubic-bezier(.4,0,.6,1)`.
- Backdrop blurs of 8px and 12px.
- `ks-fade` is 180ms from 0.97 scale.
- The ring utilities are a 2px outer stroke outside the border, not an inner one.

### 10.8 Web bugs not to copy
1. **"Mark again" on any point except the last** removes it, then Begin is refused with "That's before the last point ended.", because `startMark` checks against the last point's end (HC:361-362). Only the last point can actually be re-marked. iOS should either insert-sort the re-marked point or restrict the feature.
2. **Closing within 1.5s of a change drops unsaved taps.**
3. **The strip's scroll-into-view index is off** once "+" buttons are shown.
4. **Undo can leave the selection pointing at a mark that no longer exists.** This is harmless on the web but should be handled deliberately.
5. **Re-pressing an answer in review clears it and still moves on.**
6. **Space or Enter behind the mode sheet starts cutting.**
7. **Opening the marker writes an empty draft row.**

### 10.9 Undo is not persisted
The undo stack is lost when a draft is reopened. Keep this for parity unless the owner says otherwise.

### 10.10 Frozen video URL
Freeze the signed URL for the whole session, as the web does, so a refresh cannot reload the video to 0.

### 10.11 Pieces to reuse, not re-implement
- Pad layout reads the video's aspect ratio from its metadata. Portrait height is `min(width ÷ aspect ratio, 42% of the dynamic viewport height)`; for iOS use the safe area.
- The reducer (HC) should be ported 1:1 with shared test fixtures.
- Score and server must come from the existing Swift ports of `computeServing` and `computeMatchScore`, per CLAUDE.md.

### 10.12 iOS pad buttons
The iOS rule is full width with at least 44pt tap targets. The web's pad buttons are 64px, 56px and 40px tall, and the utility buttons are 40px. That is fine on the web but below 44pt on iOS; decide the sizes.

---

## 11. Commit-message wording that was later replaced (do not port it)

- **e95fb598:** "SpeedMenu in the utility row". Replaced by the speed bar (694e3555).
- **1fa2f01a:** an Adjust sheet with "Mark it again" and "Remove point". Replaced by the bar (694e3555), and the labels are now "Mark again" and "Remove".
- **694e3555:** "Every release applies at once". Replaced by Confirm (c1c3fcce).
- **0e1f9c23:** "waits a beat" before the next clip. Replaced by no gap between clips (27f14d52).
- **936f237c:** "two rows of three". Replaced by one row of six (1f963cbe).
- **c133583b:** "opens … in scoring mode" for every draft. Replaced by the recorded mode (bc180eba); a cut-only draft never opens as scoring.
- **c306f103:** the landscape bands had offered answers on cut-only passes; that is now fixed.
