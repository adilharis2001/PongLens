# Mark the points: cutting a match by hand

**Date:** September 7, 2026

**Status:** Design proposal. Not approved, not implemented. Written in
response to Adil's brief of the same date.

**Record:** Built from a full audit of the three surfaces this touches (the
web scorekeeper, the iOS scorekeeper, and the points / worker / billing
model), then four independent designs, eight adversarial reviews and one
synthesis. Every file and line reference below was checked against the
repository at `bb2fb45c`.

---

## Summary

Today a player who uploads a match has one way to get points out of it:
spend processing minutes and let the pipeline find the ball. This design
adds a second way. The player watches their own video and taps twice per
point, once when the serve goes up and once to say who won. Nothing pauses.
When they are done, PongLens builds a real cut video from their marks, cuts
a clip for every point, and the match opens exactly like any other match.

It costs no minutes, because the player did by hand the part the minutes pay
for. It does not get placement maps or automatic highlights, because those
are drawn from a tracked ball and nothing tracked it.

The feature appears in Tools on unprocessed matches only, on web and iOS.

---

## 1. Goal

A player can turn a raw upload into a scored, clipped match in about the
time it takes to watch it, without paying minutes and without leaving the
video.

Two taps per point. Playback never stops. The running score builds as they
go, so the number on screen can be checked against the score on the wall
behind the table.

---

## 2. The pieces, in plain terms

- **The original.** The file the player uploaded. It is already playable on
  the unprocessed match page.
- **The marks.** A list of point windows, each with a start second, an end
  second, and optionally a winner or a let. This is the player's scratch
  work and it is saved as they go.
- **The cut video.** One file per match with the dead time removed. Today
  the pipeline builds it from the ball track. Here it is built from the
  marks, by the same code.
- **The clip.** One small file per point, which the point view, Starred,
  share links, coach review and reels all play.
- **`cut_t0`.** Where a point's padded clip begins inside the cut video.
  Every playback rule in both apps is built on it.

---

## 3. The interaction

### The loop

1. **Open it.** Tools card on an unprocessed match, row **Mark the points**.
   First time only, a short sheet says what it does and what it costs. Then
   the setup sheet asks who served first, with Skip. The takeover opens on
   the original, paused.
2. **Play.** Tap the middle of the picture. Speed is on the pad. A typical
   pass runs at 1.5x or 2x.
3. **The serve goes up.** Tap **Point starts**. A dashed chip appears at the
   end of the strip and begins growing. The video does not pause, then or
   ever.
4. **The rally ends.** Tap **You**, **Them**, **Let** or **End**. The chip
   closes and takes its colour. The ticker advances. Back to step 3.
5. **Between points.** `-10s` and `+10s` sit beside Point starts. Dead time
   is 30 to 63% of a match's minutes, so these save more wall clock than the
   speed control does.
6. **Finish.** **Cut the match** opens a sheet naming what is being dropped,
   then submits.

**End** closes a point without calling it. Adil's brief makes the outcome
optional, so there has to be a control for it. An unscored point is not a
new state invented here: its chip is already dashed grey on both surfaces,
and Keep score already resumes at the first unscored point and asks.

### The start mark is led, the end mark is not

```
t0 = tapTime - clamp(SPLIT_LEAD_S * playbackRate, 0.6, 1.2)
t1 = tapTime
```

`SPLIT_LEAD_S = 0.6` is not a new constant. It is at `Player.tsx:402` and
mirrored in `Core/Playhead.swift`, written for this exact gesture: the tap
lands a beat after the thing it is marking. A third value for one human fact
is the shape of the placement mirror bug, so this reuses it. The lead scales
with the rate because a 0.3s human delay is 0.6s of video at 2x, and it is
clamped so the 1.2s pre pad is never double counted.

The end tap gets no lead. `playhead.ts:57-61` records the boundary study: a
winner tap lands at the rally's true end at the median and up to 0.7s early.
Subtracting anything would make it worse. The 1.3s post pad covers both
directions.

The raw tap and the playback rate are both kept in the draft, so the
constant can be measured later without a schema change.

### Every correction path

| Situation | What happens |
| --- | --- |
| Point starts while a point is open | You forgot the end. The open point closes at the new mark, unscored, and a new one opens at the same instant. Refused if either point would fall under 0.7s. |
| Outcome tap with no point open | Refused. Inline "No point open", error haptic on touch. Nothing is written. |
| Start earlier than the last point's end | Refused. Inline "That's inside the last point." Marks stay ordered by start, always. |
| Point under 0.7s | Refused at the tap. Nothing is dropped later, so the client and the database can never disagree about what is valid. |
| Point over 120s | Allowed, and the save sheet names the count. A forgotten end produces one and the player should see it before committing. |
| Wrong winner | Tap the chip to select it, then tap the right outcome. Selecting does not seek. |
| A mark in the wrong place | Select the chip. A small panel offers Move the start, Move the end, Play from here, Remove this point. |
| Re-watch something | Long press a chip, or right click on desktop: Play from here. The only gesture that seeks. |
| Anything else | Undo, a typed stack of start, end, outcome, star, move and remove, unbounded within the session. |

An outcome tap never retargets a previous point on its own. `FullMatch.tsx`
does that, but it writes an admin research timeline that is read back
afterwards. Here it would flip an already-called point's winner and lose the
rally that was actually playing, both silently, from the single likeliest
error in the loop.

### Keys on desktop

The listener is `window.addEventListener("keydown", onKey, true)`. Capture
phase. A focused video element swallows keys, which is written down at
`FullMatch.tsx:751-757` and has already cost this repository a round.

| Key | Action |
| --- | --- |
| `S` | Point starts |
| Left arrow | You |
| Right arrow | Them |
| `K` (legacy `L`) | Let |
| `E` | End, no winner |
| `U` | Undo |
| `T` | Star |
| Space | Play and pause |
| Shift with an arrow | Seek 10 seconds |
| `,` and `.` | Nudge the selected mark 0.15s |
| `[` and `]` | Speed down and up |

`B` is deliberately unbound. It is the admin serve-start label in both
`FullMatch.tsx` and `Player.tsx` and it means something else.

### Drills and practice

`tracksServe(match.match_type)` already decides on both platforms whether a
score means anything for this footage. When it returns false the marker
hides the ticker, skips the setup sheet, and shows only Point starts, End,
Undo, Star and the seek pair. Cutting a drill session is about getting the
rallies out, not about scoring, and the product contradicts itself if one
screen shows score furniture the next one hides.

### The game boundary

The ticker shows the running score, the games pill and the serve indicator,
driven by `computeServing` and `gameScore` over the marks.

There is no Game ended control here, because that control writes
`game_end_override` on a points row and no points row exists yet. A game
that ends off the 11-point pattern reads wrong in the marker and is fixed in
Keep score afterwards, where the control lives. The entry sheet says so in
one line rather than leaving it to be discovered.

---

## 4. What the screen looks like

Ceilings computed first, per surface, before anything is placed.

### Web mobile portrait, 16:9 source

Viewport 393 x 660. Browser chrome takes roughly 180px of an 844pt device,
and 844 is not the number to design against.

The takeover is `fixed inset-0` with no `AppShell` and no `AppNav`.
`AppShell` brings a max-width column, its own padding, and a `.page-enter`
transform that would capture a fixed child for 200ms.

The video box is sized on a div, never on the video element:

```css
height: min(100vw / var(--ar), 40dvh);
```

16:9 at 393 wide gives `min(221, 264) = 221`. The picture is 393 x 221 and
the pad gets 439.

| Band | px |
| --- | --- |
| Ticker | 40 |
| Chip strip | 48 |
| You and Them, side by side | 64 |
| Point starts, full width | 56 |
| Let, End, Undo, seek pair | 48 |
| Transport | 44 |
| Gaps and bottom inset | 48 |
| Total | 348 |

91px spare. At 393 x 844 the extra height goes entirely into the video box,
because the limit is a `min()` of two real limits and never a fixed
subtraction from a variable viewport.

### Web mobile portrait, 9:16 source

A 9:16 picture needs 699px of height to be full width at 393. That does not
exist on this viewport, and capping the box at 40dvh would give a picture
148px wide, 38% of screen width, which is the exact failure CLAUDE.md
records.

So portrait-shot footage does not use the stacked layout. The picture goes
full bleed and height bound, 660 tall by 371 wide, and the pad becomes
overlay slabs: ticker and chip strip at the top, a 176px slab at the bottom
above the transport. The lower sixth of a 9:16 phone video is floor, not
table.

This is a reasoned departure from "anything overlaid on a video must clear
out while it plays". That rule exists because the native scrubber fights
anything on the bottom edge. `ClipPlayer` renders no native controls and
draws its own, and here the pad is the feature rather than decoration.

### Web mobile landscape

The predicate is copied verbatim from `Player.tsx:896-902`:
`(orientation: landscape) and (pointer: coarse) and (max-height: 500px)`.
Copying the string means the two scorekeepers can never disagree about what
a phone in landscape is.

852 x 348 after chrome. `ClipPlayer` is mounted with its `overlay` render
prop, which hands the overlay the picture's measured box plus its own chrome
floor. In cut mode that floor is 52px and the speed control and clock live
in it, so the usable band height is 296px, not 348.

- Left band, 88 wide, bottom anchored: Point starts 88 x 88, then +10s and
  -10s at 88 x 48.
- Right band, 88 wide, bottom up: You 88 x 80, Them 88 x 80, Let 88 x 40,
  End 88 x 40.
- Top: ticker 40, chip strip 36, at 55% ink, fading to 20% while playing and
  back to full on pause and for 1.2s after every mark.
- The middle of the frame is untouched picture.

**Nothing in the pad ever moves.** Point starts and the You and Them pair
keep constant frames for the life of a session. They do not resize with a
label, do not shift when the chip strip grows, and do not appear or
disappear between states: when no point is open, You, Them, Let and End are
dimmed and inert but keep their boxes. A target that moves is a target you
have to look at, and this tool is used without looking away from the ball.

### Web desktop

`(min-width: 1024px) and (pointer: fine)`. Video centred, box capped at
`min(70vh, 100vw - 2rem)` on a wrapper div, and a fixed pad bar below it 96
tall, with the key legend lifted from the floating pad.

Not the draggable floating card. That card exists because on a processed
match the pad must not cover the rally being inspected. Nothing is being
inspected here, and a pad whose position has to be re-found between sessions
is the opposite of the promise. Its drag maths, pointer capture and stored
position all go.

`SpeedMenu`'s `drop` prop is load-bearing: up on the desktop bar and the
portrait pad, down in the landscape top strip. The wrong way opens off
viewport and the control reads as dead.

### iOS landscape, the primary surface

iPhone 15 and 16 Pro, 852 x 393pt, safe insets 59 left, 59 right, 21 bottom,
so 734 x 372 usable. A 44pt transport leaves 328pt of band height. Bands are
96pt wide, sit in the safe-area gutters and are both bottom aligned so they
end where thumbs rest: left column Point starts 96 x 96 then the seek pair
at 96 x 48; right column bottom up You 96 x 80, Them 96 x 80, Let 96 x 44,
End 96 x 44.

Haptics, all generators prepared on session start and re-prepared after each
fire: light for a start, medium for You, Them and Let, soft for End, rigid
for Undo, success when a game closes, error for a refused mark. Three
weights the thumb tells apart without looking is the point. The game-close
haptic says a game closed. It is not a correctness proof and is not sold as
one.

### iOS portrait

393 x 852, safe 59 top and 34 bottom. Same box rule, same 9:16 fall-through
to full bleed with overlay slabs. Form and action buttons fill the content
width at 44pt minimum, per the approved baseline in
`AllowanceRequestRow.swift`; chips, segmented pieces and the speed control
keep their compact patterns.

No "turn your phone sideways" nudge. Portrait works, and nagging is a
subtitle in disguise.

---

## 5. What is copied, deleted, imported and new

### Web

**New files**

- `src/app/match/[id]/HandCut.tsx`, the takeover and its four layouts.
- `src/app/match/[id]/handCut.ts`, the pure reducer, the lead arithmetic and
  the validator. No `cut_t0`, no segments.
- `src/app/match/[id]/handCut.test.ts`
- `scripts/handcut-fixture.ts`, which writes the iOS parity fixture.

Not a third mode inside `Player.tsx`. 8324 lines is how a third mode ends.

**Copied from `Player.tsx` and edited**

`PadControl` (`:244`). The chip strip (`:6499-6795`): numbered pill chips,
cyan, magenta, amber and dashed grey, `scale-110` and a white glow on the
current chip, auto-centring. One real change, the countdown ring becomes a
growing pill, because a ring drains when a padded clip's length is known and
an open rally's is not. The ticker (`:6402`) including the "You serve" line.
The winner tiles (`:7320-7396`) minus `WhyPill`. The setup sheet
(`:8180-8240`) reduced to "Who served first?" plus Skip, whose Skip is
`text-xs` grey today, which the design rules forbid for anything tappable,
so it becomes a `text-sm` text button. The four-layout `matchMedia` scaffold
and its predicate strings.

**Deleted**

Pause-at-point-end and its pin, advance-on-any-new-answer, the review phase,
the detour player, `RemovedDot` and soft delete, the dashed insert offers,
the game-boundary hairline and its score pill, the side-change pill, "Go to
point", Analysis, Details, Delete-as-dead-space (everything unmarked is
already dead space), the Modify row, `WhyPill`, split-while-watching, and
the `tapZone` thirds, because a tap on the picture here is play and pause.

**Imported unchanged**

`ClipPlayer` in cut mode with its overlay render prop. `SpeedMenu` with
`drop` threaded per layout. `serving.ts`, `gameScore.ts` and `sides.ts`,
because the ITTF rotation is never re-derived. `gestureHints.ts`, with
`HintName` gaining `"mark"`.

`RawMatchView.tsx` already mounts `ClipPlayer` on the original at
`:503-520`, so tap play and pause, hold for speed, pinch zoom, the transport
and fullscreen are already solved on web. Nothing here rebuilds them.

**Touched elsewhere**

`RawMatchView.tsx` gets the Tools row, a draft line on the process card, and
the hand-cut failure branch. `MatchView.tsx` hides the Placement and
Highlights rows when the match was cut by hand.
`src/app/api/highlights/route.ts` adds the same condition at `:175`, because
hiding a row does not gate an endpoint. `placementRetry.ts` likewise.

### iOS

**New files:** `Screens/HandCutScreen.swift`, `Core/HandCut.swift` (pure
Foundation so `ios/Tests/run.sh` compiles it), `ios/Tests/HandCutTests.swift`.

**The two hard blockers stay exactly as they are.** The assert at
`PlayerTakeover.swift:3109` and the empty points at `:317` are correct: Keep
score writes `scored_at_cut_s` off that player's clock, and emptying points
does not empty the dead spans, which read the model and come out wider.
`HandCutScreen` is a separate screen with its own `AVPlayer` and no point
array at all, so neither guard is reached. One line is added to each guard's
comment naming the new screen as the surface that marks the original and
deliberately does not come through here, so the next reader does not
re-litigate it.

**Copied and edited:** `chipStrip` (`:2151`) with its auto-centring and
`tickerChip` (`:2473`) become `MarkChip`, keeping the dashed unscored ring
and turning the shrinking arc into a growing one. `chipTint` (`:2539`)
unchanged. The pad control primitives (`:2554`), the speed menus
(`PlayerTakeoverScore.swift:789`, `:832`) with the speeds verbatim, and
`beginHold` and `endHold` (`:1102`).

**Named as work, not free: the iOS playback chrome.** There is no
`ClipPlayer` on iOS. `PlayerLayerView.swift` is a bare `AVPlayerLayer` host
whose own comment is that the app draws all its own chrome, and
`InsertSheet.swift:114-484` already builds an `AVPlayer`, a periodic
observer and a scrubber to play the original at an offset. `HandCutScreen`
borrows that scaffolding, plus the single periodic observer at 0.2s and the
`liveT` pattern that reads the player's current time directly, because at 2x
a 0.2s tick is 0.4s of video and a mark taken off a stale tick is visibly
wrong. This is roughly a day of work that is easy to miss when costing the
feature.

**Imported unchanged:** `Core/Serving.swift`, `Core/GameScore.swift`,
`Core/GestureHints.swift`, the `PL` theme tokens, the PL button styles,
`PLSheetScaffold`, and the existing first-server prompt.

**Touched elsewhere:** `RawToolsSection` (`MatchTools.swift:1461`) gets the
row and its omission comment gets a matching sentence.
`MatchDetailScreen.swift` hides Placement and Highlights on a hand-cut
match.

### Parity

`handCut.ts` and `Core/HandCut.swift` are one rule written twice, which is
exactly how the placement mirror survived eight months. The mitigation is to
keep the shared rule as small as possible: **the clients never compute
`cut_t0`, the cut segments or the kept windows.** They compute the lead, the
reducer and the validator. The worker alone does the cut-clock geometry,
once, and the apps read back the rows it wrote.

What remains shared is checked the way `serve-parity.json` and
`rally-end-parity.json` check placement. `scripts/handcut-fixture.ts` emits
`ios/Tests/fixtures/handcut-parity.json` from the web reducer, covering a
clean run at 1x, a clean run at 2x where the lead scales, a start while a
point is open, a refused outcome with nothing open, a refused start inside
the last point, a refused short point, a let clearing a winner, chip
selection retargeting the outcome buttons, undo across every action type,
and an open point at submit. The Swift test replays the identical action
list and compares every number. Two hand-written suites agreeing proves only
that two authors read the same sentence the same way.

---

## 6. The data model

### Migration

```sql
alter table public.matches
  add column if not exists cut_source text not null default 'auto'
  check (cut_source in ('auto', 'manual'));
-- No client grant. Only the RPC and the worker write it.

create table public.hand_cut_drafts (
  match_id     uuid primary key references public.matches(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  marks        jsonb not null default '[]'::jsonb,
  device_id    text,
  updated_at   timestamptz not null default now(),
  submitted_at timestamptz
);

alter table public.hand_cut_drafts enable row level security;

create policy "own drafts readable" on public.hand_cut_drafts
  for select using (user_id = (select auth.uid()));
create policy "own drafts insertable" on public.hand_cut_drafts
  for insert with check (user_id = (select auth.uid()));
-- Once submitted the row is frozen: the worker must read the same set the
-- user agreed to, not one they kept editing while it ran.
create policy "own drafts updatable" on public.hand_cut_drafts
  for update using (user_id = (select auth.uid()) and submitted_at is null)
             with check (user_id = (select auth.uid()));
create policy "own drafts deletable" on public.hand_cut_drafts
  for delete using (user_id = (select auth.uid()) and submitted_at is null);

grant select, insert, delete on public.hand_cut_drafts to authenticated;
grant update (marks, device_id, updated_at)
  on public.hand_cut_drafts to authenticated;
```

`submitted_at` is not in the update grant, so only the RPC sets it, and the
update policy freezes the row the moment it is set.

A mark is `{"t0": 132.44, "t1": 149.1, "w": "user"|"opponent"|null,
"let": false, "star": false, "tap": 133.0, "rate": 2}`.

### `claim_hand_cut(p_match_id uuid, p_marks jsonb) returns jsonb`

`security definer`, execute granted to `authenticated` only. Guards in
order, each raising the house dialect so `mapRpcError` passes the slug
through:

1. No session, `42501 not_authenticated`.
2. `select ... from matches where id = p_match_id and user_id = v_me
   for update`. The row lock is the serialization point, before any other
   check, exactly as `claim_processing:664` does it. Not found, `P0002`.
3. Status not in `uploaded, failed`, `P0001 bad_state`.
4. `cut_path is not null`, `P0001 bad_state`. This is load-bearing beyond
   tidiness: `matches.job_id` is only ever written in the same statement as
   `cut_path` (`worker.py:3850`), so a null `cut_path` is the only thing
   guaranteeing a null `job_id`, which is what guarantees no stale trim
   offset reaches a later re-cut.
5. `raw_path` missing or not under the caller's own prefix, `P0001 no_source`.
6. `duration_s` missing or not positive, `P0001 duration_unknown`.
7. `content_checked_at is null`, `P0001 check_pending`.
8. Any existing points row, `P0001 already_cut`.
9. Any queued or processing job for this match, `P0001 already_processing`.
10. Four or more active non-reclip jobs for this user, `P0001 queue_full`.
    The same fairness rule `claim_processing` applies.
11. Marks must be an array of 1 to 400. Each: start at or after zero, end
    after start, length between 0.7 and 120 seconds, end within the
    duration, start at or after the previous end, winner one of the two
    values or null, never a let with a winner. Otherwise `23514
    invalid_marks`. The client enforces the identical bounds at tap time, so
    this raise is unreachable in practice. It is a backstop, not a path, and
    nothing is silently dropped.

Then, in one transaction: upsert the draft with `submitted_at = now()`; set
`cut_source = 'manual'` and `clip_pads = '{"pre": 1.2, "post": 1.3}'`;
insert a `hand_cut` job carrying the match id; return the job id and the
point count.

**`matches.status` is deliberately not touched.** Nothing in the worker's
generic failure handler flips a non-`deadspace_cut` match out of
`processing` (`worker.py:8908`), so a hand-cut job that died while the match
sat in `processing` would brick both the match and its own retry. Leaving it
`uploaded` means a dead job is fully recoverable, and `RawMatchView`'s
running check already reads the job rather than the status, so the page
still shows work in progress. `claim_processing`'s own in-flight check
refuses a Process tap while the hand cut is queued, at no cost.

**No trim offsets in the job options, on purpose.** `process_reclip`
computes its trim offset only when both the match id and an end offset are
present (`worker.py:5677-5680`). Leaving them out keeps every future re-cut
at offset zero against absolute source seconds.

### Also in this migration

Placement needs ball landings against a calibrated table and a hand-cut
match has neither, so `request_placement_generation` and
`request_placement_retry` are recreated with `and m.cut_source is distinct
from 'manual'`. This goes in the functions, not only the UI, because the
anonymous key is in the client bundle and "only our own code calls this" is
never what keeps a call from happening.

### No change to the ready notification

The flip to ready rings the bell, and that is right: the job takes minutes
and the player has usually left the page. Suppressing it would also mean
rewriting `matches_notify`, whose live body is at
`161_roster_names_and_coach_access.sql:108-162` and carries the coach
notification loop. Editing it against the superseded original would silently
delete that loop.

### The guard goes at the deletion, not the caller

`create_match(existing=True)` deletes every points row before inserting, and
every reference cascades. The jobs insert policy is user-id only by
deliberate decision, so `claim_processing` is not the only way a processing
job can be created. The guard therefore goes in `create_match`
(`worker.py:3846`), immediately before the delete, raising `UserFacingError`
so the existing handler refunds the minutes and fails the job rather than
retrying into the same wall.

### The worker job

Dispatched beside `reclip`. Stages, each pulsed: **marks, cut, upload,
points, publish**. Only `marks` is new to `STAGE_LABELS`.

**marks.** Load the match and the frozen draft. Verify ownership. Refuse if
any points row exists. Re-validate with the same bounds the RPC used, clamp
to the duration, reindex from 1.

**cut.** The segments come from the pipeline's own arithmetic, called rather
than restated, and mirroring the automatic path exactly:

```python
windows  = [(max(0.0, m.t0 - 1.2), min(dur, m.t1 + 1.3)) for m in marks]
segments = play_cut_segments(windows, dur, 0.15, 0.15)   # SEGMENT_PADS
offsets  = segment_cut_offsets(segments)
cut_t0_i = cut_position(segments, offsets, max(0.0, marks[i].t0 - 1.2))
```

The clip pads go inside each window and the 0.15s segment pads are the head
and tail, which is what `cmd_points` does at `points_pipeline.py:2967-2988`.
That 0.15 is described in its own comment as a rounding whisker, and it is
what keeps each clip's anchor inside its segment rather than exactly on the
boundary. `play_cut_segments` then sorts, pads, clamps and merges anything
within 0.5s, which is what stops two marks two seconds apart producing
segments that concatenate the same footage twice.

Write `points_out/match.json` with `cut_segments`, and per point `idx`,
`t0`, `t1`, `cut_t0`, `clip_t0`, `clip_t1` and `clip`. Those per-point keys
are what `_CutMap.born` reads (`worker.py:5545-5556`), so every later re-cut
takes the flat-pad branch and never consults the dynamic tail.

`pipeline` is **`"hand-v1"`, not `"v2"`**. Labelling it v2 to switch off
dynamic tails would make `readAssembly` (`uploadView.ts:394-399`) count
serve marks, find none, and infer the end-on assembler ran on a match no
detector touched. A status surface asserting a detector ran is the sin
CLAUDE.md records. The label plus the born keys gets flat tails with no lie.

Then `points_pipeline.py cut --segments <match.json> --video <presigned
url> --out cut.mp4`. Verified: in segments mode `cmd_cut` never opens the
ball detections file, so `--blurball` becomes optional when `--segments` is
given, one line. The seek flag sits before the input, so a presigned URL is
a ranged fetch. Wrapped in a cost meter stage, so the one free path is not
also the one invisible path.

**upload.** To `results/<user_id>/<job_id>.mp4`, the same key shape the
automatic path uses, so the sweep, the retention rules and the delete
preview all behave identically with no special case.

**points.** Cut every clip from the finished cut video by presigned range
with `process_reclip`'s encode ladder. Name them `NN.mp4`, not the hex form:
`_RECUT_KEY_RE` (`worker.py:5507`) matches only the hex form and
`process_reclip` deletes and ledger-negates anything matching it, so an
original clip must stay outside that regex, exactly as `run_points_stage`
keeps it. Reuse `insert_points` unchanged, then one update per point for the
answers. A let is `is_let = true, confirmed_how = 'let', confirmed_winner =
null`, because the `points_let_never_scored` constraint forbids both and the
reason is what makes the chip read "Let serve" rather than a bare "Skipped".
Report progress inside the loop, so a 90-clip run reads as moving rather
than frozen.

**Neither `serve_start_at_cut_s` nor `scored_at_cut_s` is written.** Two
reasons, either sufficient. `point_boundaries` (`117`) selects every row
where those two and `cut_t0` are all present, with no source filter, so one
90-point hand-cut match is a 30% dilution of a 295-row corpus the backlog
calls ground truth, and the labels would be circular because the start
reduces to the very number the cut was built from. Separately, here the end
tap **is** `t1`, so writing it would make `effectiveEnd` trim every clip to
`t1 + 0.5`; the boundary study says that tap can be 0.7s early, so the clip
would end before the deciding ball on every point.

**publish.** Set `cut_path`, `match_json_path`, `duration_s` and status
ready. Before publishing, a tripwire re-derives every `cut_t0` through
`_CutMap.locate`, which is a second independent implementation and the one
every later re-cut uses, and checks the cut's probed duration against the
segment sum. A mismatch fails the job with the draft intact rather than
publishing a wrong match.

On failure: delete what was written, reset `cut_source` to auto, clear
`submitted_at`, leave the marks, and let the player try again.

A clip that fails to encode leaves its row with a null path and `edited =
true`. The existing `points_request_reclip` trigger then queues exactly one
re-cut for the match and the shipped machinery finishes it. That is the
right use of the trigger: as the retry, not the main path.

### Admin

`KIND_LABELS` gains `hand_cut: "Hand cut"`, `STAGE_LABELS` gains `marks`,
and `uploadView.ts` gains a branch for the `hand-v1` note so the uploads
page renders it instead of failing the points regex. A kind is not finished
when the worker handles it; it is finished when the page names it.

---

## 7. What a hand-cut match has and does not have

**Has:** the cut video, a clip per point, scores with winners already
filled in, the rotation and running score, Starred, Share, Coach review,
Notes, Tags, Reels, Export, the Original video, and all four timing editors,
Split, Join, Adjust and Insert.

**Does not have:**

| | Why |
| --- | --- |
| Placement maps | Drawn from ball landings against a calibrated table, and neither exists. A wrong map is worse than no map. Refused in both RPCs, not just hidden. |
| Automatic highlights | Selection runs on ball evidence, which is empty, so the row is hidden and the endpoint refuses rather than enqueueing an empty reel. Starred clips are the manual version and they work. |
| Match structure and side changes | Both need the ball detections file. |
| Rally-end trimming | No observed rally end, so clips end at the tap plus the post pad. |
| Automatic processing afterwards | Not in v1, said twice: in the entry sheet before any work starts, and in the save sheet at the irreversible tap. |
| A place in the research corpus | Deliberate, so hand marks never dilute the ground truth. |

---

## 8. The decisions

**Build a real cut video. Rejected: pointing `cut_path` at the original.**
It is simpler in the worker and fails everywhere else. Skipping dead time
would need a gap rule in three implementations, `skipSpans` in
`playhead.ts:273`, the match page's own builder at `MatchView.tsx:1052-1081`
and `deletedSpans` in `Core/ScoreLogic.swift:61`, and the comment at
`playhead.ts:242-248` records that two of those have already drifted once on
exactly this rule. Beyond that: the full-video card would print "Playtime
only" over an uncut upload, the Original pill would offer the identical
bytes under a second name, every reel would download a multi-gigabyte
original, and the delete preview would omit the largest object.

**The marks are a draft, submitted once. Rejected: a points row per tap.**
`cut_t0` cannot exist before the cut, so a real cut forecloses it anyway. It
is also worse: it fires the re-cut trigger on every tap, giving uncapped
free encoding with no throttle in the way; an undo leaves an orphan clip
whose bytes stay booked; and it puts scored points on a match still marked
uploaded, which the library card and the coach surfaces have never been
asked about.

**Cut the clips inside the job. Rejected: routing them through the trigger.**
Inserting with `edited = true` and letting the trigger do the work is
elegant, and it flips the match to ready with every clip path null. Owner
surfaces degrade gracefully, but share links, coach review and reels all
filter on the clip path.

**An outcome tap with nothing open is refused. Rejected: scoring the most
recent point.** That would flip an already-called point's winner and lose
the rally that was actually playing, both silently, from the likeliest human
error in the loop.

**No new "declined to call" state. Rejected: a new column.** Unscored is
already first class: the chip is dashed, the save sheet counts them, and
Keep score resumes at the first one and asks.

**A fixed desktop pad. Rejected: the draggable floating card.** It exists so
it can be moved off a rally being inspected. Nothing is being inspected.

**The Tools row is hidden until the content check has run.** The rejection
path deletes the raw object and nulls its path with no status guard, and the
raw page deliberately hides the content-check job, so an invitation to mark
could appear while the gate was still queued.

**No frame sampling to find boundaries.** `RawMatchView` mounts the player
with pixel reading off because R2's presigned URLs answer a CORS request
with nothing, so the canvas is tainted. iOS could sample through
AVFoundation, which would put the two platforms on different evidence for
one rule.

---

## 9. Build order

1. **Pure logic and parity.** The reducer, its tests, the fixture generator,
   the Swift port, its tests, and the test-runner wiring. Nothing
   user-visible. Both green before any UI, so neither platform can drift.
2. **The worker, shipped first.** The job, its five stages, the tripwire, the
   argparse change, the `create_match` guard, the failure arm. Shipping
   before the migration means a running daemon never meets an unknown job
   kind, which is the shape of the 2026-07-22 incident.
3. **Migration and RPC**, verified by hand end to end against a scratch
   upload.
4. **Admin**, in the same commit as 2 and 3.
5. **The refusals**: placement guards in both RPCs, the highlights gate, the
   hidden rows on both platforms.
6. **Web.** Desktop bar first, because the keys are the fastest way to run a
   real match end to end and find out whether the lead is right. Then phone
   landscape, then portrait. Screenshots at 393 x 660 and 852 x 348. A real
   `npm run build`, in a worktree with its own build directory if a dev
   server is running.
7. **iOS.** Landscape first, then portrait. Test runner green. TestFlight,
   and Adil marks a real match on a phone before anything else is polished.
8. **Measure the accuracy.** Hand-cut one of the twelve matches that already
   carry boundary rows and compare each marked start against the existing
   record. This turns "is marking at 2x accurate enough" into a number using
   data that already exists. If 2x is too fast, the fix is capping this
   screen's speeds at 1.5, one constant.
9. **Ship behind a config flag**, added to the public read allow-list by a
   new migration. A key left off that list is admin-only, and the tool would
   silently never appear.

---

## 10. Risks

| Risk | What stops it |
| --- | --- |
| `cut_t0` drift, where every chip and every share link land at the wrong second and nothing errors | The pre-publish tripwire re-derives every value through the independent `_CutMap` implementation and fails the job with the draft intact. This is the one check not to ship without. |
| Free heavy compute on the shared lane | The 400-mark cap, the four-job fairness cap and the in-flight refusal, all in the RPC, plus a cost-meter stage so the spend is visible |
| A worker on old code meets the new job | The worker ships before the migration that can create it |
| The content gate deletes the raw mid-session | The row is hidden until the check has run, and the RPC refuses |
| A dead job leaves a stuck match | Status is never moved at claim, so the match stays recoverable and both Try again and Process work |
| Marks lost to a crash | Debounced save plus a local mirror; the strip renders from local state so no tap waits on the network |
| Two devices on one draft | Last write wins. A marking pass is one sitting. Stated assumption, not a discovered surprise. |
| Accuracy at 2x is unmeasured | Build step 8 measures it against 295 existing hand-marked boundaries |
| `cut_source` is match-level and processing versions puts identity on a version | Noted in the migration comment: it moves to the version as a producer field, and all four readers move with it |

---

## 11. What we are deliberately not building

Two cuts of one match. Marking a match that has already been processed. A
timing editor inside the marker beyond nudge, move and remove. Placement,
automatic highlights, match structure or side-change detection on a hand-cut
match. The two research timestamp columns. A cloud twin of the job.
Auto-arming the next point after an outcome tap, because real gaps exist
between points and auto-arming puts every one of them inside a rally. A
resume prompt, because the strip already shows where you are.

---

## 12. Copy

**Tools row:** `Mark the points`, trailing `Not started` / `24 points
marked` / `Cutting`

**Entry sheet**, once per player, Not now always available:

- `Mark the points`
- `You watch the match and tap where each point starts and who won. Your
  marks become a cut match with a clip for every point.`
- `Placement maps and automatic highlights need the ball tracked, so a match
  you mark by hand does not get them. Scores, clips, stars, notes, sharing
  and coach review all work.`
- `A match you mark by hand cannot be processed automatically afterwards.`
- `Start marking` / `Not now`

**Setup sheet:** `Who served first?` `You` `Them` `Skip`

**Pad:** `Point starts`, `You`, `Them`, `Let`, `End`, `Undo`, `Star`,
`-10s`, `+10s`, Speed

**Empty strip:** `Nothing marked yet.`

**Chip panel:** `Move the start`, `Move the end`, `Play from here`,
`Remove this point`

**Refusals**, inline for two seconds, no dialog: `Too short to be a point.`
`No point open.` `That's inside the last point.`

**Save sheet:**

- `48 points marked.`
- `6 have no winner yet. You can score them from the match.`
- `One point has no ending and will not be included.`
- `This match cannot be processed automatically afterwards.`
- `Cut the match` / `Keep marking`

**Process card, when a draft exists:** `You have 24 points marked.
Processing will not use them.`

**If the cut fails:** `The cut didn't finish. Your marks are still here.`
with `Try again`.

**When it is done:** nothing new. The existing notification already says the
match is cut into points and ready to review, and here that is true.

---

## 13. Questions for Adil

1. **Should hand cutting stay free, or cost minutes at a reduced rate?**
   This design assumes free, with the caps above as the throttle. Charging
   instead means the RPC grows a balance check and a ledger row, and the raw
   page grows a price, an insufficient-minutes path and a refund path.
2. **Should a hand-cut match be processable automatically later, keeping
   both cuts?** This design assumes no and says so twice in the copy.
   Answering yes needs a second cut path, a points-preserving reprocess and
   an active-cut pointer, which is most of the processing-versions spec
   brought forward.
3. **Is the entry point right in Tools?** The brief says Tools, and that is
   what this specifies. The genuine decision point is the process card,
   which is where a player already chooses what to do with an unprocessed
   upload, so a second entry there is worth considering.

---

## 14. As built, after using it

The design above was written before anyone had marked a real match. Adil
used the first build and three things changed. They are recorded here
because the reasoning above is now wrong in these places.

**Three taps per rally, not two.** The spec argued that the answer tap
should also end the point, on the grounds that two taps beat three. In use
it did not: ending a rally meant crossing the pad to the winner tiles, and
the two actions never became one rhythm. Begin Point and End Point are now
their own pair, side by side and the largest controls on the pad, and the
three answers sit on one row below. The separate "End" control is gone,
since End Point already closes a point without calling it.

**The answer row asks.** When End Point closes a rally the three answers
light up and pulse until one is chosen. The reducer carries an `awaitingId`
for exactly this: after a point ends, who won it is the only thing the pad
wants.

**The session opens on a question.** "Cut only, or cut and score?", in the
scorekeeper's own sheet dress. Cut only drops the answer row, the score and
the server line, because a scoreboard nobody is filling in is furniture.
Then one "Begin Cutting" button starts playback, because a browser only
lets a video play from a real user gesture and the button that says begin
should be the one that does it.

**Two smaller corrections from the same session.** Reopening a draft seeks
to the end of the last rally that was cut, so a refresh does not cost the
place in a forty minute video. And the pad carries the app's own speed
control: the picture gestures work, but the floating card covers part of
the frame, and whichever half it sits on loses its hold gesture.

**The picture stops for the answer.** In scoring mode End Point pauses the
video and it stays paused until the point is called. Watching the next
rally begin while still deciding who won the last one is what made a pass
feel rushed. Only a pause this screen caused is one it undoes, so a player
who paused by hand to look at something does not have the video yanked
back into motion by an answer. Cut-only mode never stops, because it has
nothing to ask.

That change needed one more: pressing Begin Point while the picture is held
cannot start a rally, because the video has not moved since the last one
ended and the new start would fall before that end and be refused. It
carries on instead, leaving the point uncalled and saying so. Without it the
session strands with the picture frozen and no way forward.

**A marked point can be watched back and fixed.** Tapping a chip seeks to
that point's clip start, padded exactly as the worker will cut it, plays,
and stops where the clip stops. A number on a strip tells nobody whether
the cut is any good, and that is the one thing worth checking before
committing eighty of them.

While a marked point is selected the pair changes meaning: Begin and End
say nothing about a rally whose edges are already set, so they become
Adjust and Resume, in the same two boxes so nothing moves under a thumb.
The three answers stay live, because changing a winner is the commonest
correction. Adjust opens a sheet modelled on the scorekeeper's own Modify
(`ModifyClip.tsx`): the same cyan band for what the clip keeps, the same
handle as a line with a ringed knob, and the same rule that the picture
follows the handle so the frame under your finger is the one you are
judging. Its window is fixed when the sheet opens rather than derived from
the draft, or the track rescales under the finger and slides the other
handle. The sheet also carries "Mark it again", which drops the point and
puts the playhead three seconds before it began, never back inside the
previous rally.

**Speed is a rail, not a menu.** A menu costs two deliberate acts, and
during a pass the speed is something you lean on and let go of. The rail
(`SpeedRail.tsx`) is pressed anywhere to jump there and followed with the
finger to keep changing, with the app's own six rates as evenly spaced
detents and the knob carrying the value so no separate readout is needed.
It is the same gesture with a mouse, a finger or a stylus, because it is
all one pointer.

That change required a small addition to the shared player: `ClipPlayer`
owns the playback rate and re-applies its own on every load, so a host
writing `playbackRate` on the element had it silently reverted on the next
render. Its `speedRef` now exposes `set` alongside `hold` and `release`,
and the rail drives that, which also keeps the player's own speed pill in
step.

**Beginning too early has its own way out.** While a rally is open the left
button reads Reset, not Begin Point. It throws the open rally away and
rewinds to where the last finished point ended, then plays, so the run-up
to the serve comes round again. Pressing Begin a beat early happens
constantly, and until this the only way to fix it was to end a rally that
had never started. Undo brings the open rally back.

**The marking session holds the video URL it opened with.** `page.tsx`
re-signs the raw object on every server render, so any `router.refresh()`
during a session (the job poll does one, saving match details does one)
hands the player a different-looking `src` for the same file. ClipPlayer
reloads on a src change, and the video jumps back to zero mid-session.
Measured: a src re-signed every two seconds produced four reloads in seven
and pinned the picture at zero; frozen, zero reloads. A presigned link is
good for six hours, so holding the one the session opened with is both safe
and the fix. The page also stops mounting its own player while the marker
is open, rather than streaming the same file into two elements at once.

The data model, the worker job and the cut-clock arithmetic are unchanged.
