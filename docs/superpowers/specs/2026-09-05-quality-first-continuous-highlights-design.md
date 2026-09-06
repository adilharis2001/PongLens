# Quality-first continuous highlights

**Date:** 2026-09-05
**Status:** Direction approved; written spec awaiting review

## Purpose

PongLens will generate automatic highlights only when a match contains rallies
that the ball evidence can positively identify as sustained play. It will not
add short, weak, or unmeasured points to approach a duration target.

The highlight shown on web and iOS will be one continuous video prepared by the
worker. The clients will no longer simulate a highlight reel by seeking between
distant positions in the full match cut.

The intended product result is simple:

- a short collection of genuine rallies is a valid highlight;
- a match with no trustworthy highlight rallies has no automatic highlight;
- the duration limits are ceilings, never targets;
- once playback starts, moving from one rally to the next does not perform a
  network seek.

## Why the current feature fails

The current picker in `src/app/match/[id]/highlights.ts`, mirrored in Swift,
ranks points using rally length, inferred hit count, placement candidates, and
up to two stars. A point with poor evidence is demoted rather than excluded.
The greedy pass then keeps taking lower-ranked points while they fit. The test
suite explicitly requires a suspect point to fill the remaining duration.

Production data confirms the consequence. Forty-two percent of current
one-minute match reels include a point with only one or two inferred hits. The
150-second option does so in sixty-six percent of matches. Missing hit or
placement evidence is treated as positive evidence, which makes older and
partially processed matches especially vulnerable.

Playback has a separate structural defect. Both clients open the remote match
cut and seek to the next chosen point at every boundary. Web loads only video
metadata in advance. iOS makes an exact zero-tolerance seek. A transition can
therefore require a new range request, keyframe lookup, decode, and repaint.
Closer keyframes improve this but cannot make separate remote seeks continuous.

## Product decisions

- The match screen has one automatic **Highlights** video, not separate Short
  highlight and Long highlight choices.
- The automatic video contains every qualifying rally that fits inside a
  150-second ceiling. It may be much shorter.
- Instagram Story and Instagram Reel keep their 20-second and 60-second
  ceilings. They select only from the same qualified rallies and never add
  filler.
- A match with no qualifying rally reads **No highlight rallies**. The row is
  not playable.
- Automatic membership is not affected by stars. Starred-point export remains
  the player's separate, manual collection.
- Scoring does not change automatic membership. The in-app player may continue
  to draw the current score over playback, but the stored video itself does not
  burn in a score.
- The worker prepares the continuous video during match processing when at
  least one rally qualifies. A match is not marked ready until that attempt
  finishes. Highlight failure remains fail-soft: it must not fail the match.
- The automatic video is kept with the match until the match is deleted. It is
  not part of the temporary vertical-share retention tier.

## Approaches considered

### 1. Keep client-side seeking and tune it

The clients could prefetch future byte ranges, use a second video element or
player item, and relax iOS seek tolerances. This would reduce some stalls but
would retain a transition whose success depends on network, cache, keyframe
placement, and decoder state. Web and iOS would also need separate buffering
implementations.

This is rejected as the primary fix. It can remain a fallback for development,
but it does not meet the no-seek playback requirement.

### 2. Render on first open and cache

This avoids rendering videos that nobody watches. It also makes the first press
on Highlights wait for an export job, which is the moment the feature is meant
to feel immediate. The normal worker may have other videos queued ahead of it.

This is rejected for new matches. It remains the only possible regeneration
path after a player changes point boundaries later.

### 3. Qualify and render while the match is already processing

The worker already has the source video, cut video, ball track, table
calibration, point windows, and clips locally. It can derive the evidence once,
select the points once, and render without downloading the match again. Both
clients then consume one stored result.

This is the selected approach. It is the only one that fixes quality and
playback at their common source.

## One qualification authority

The worker is the sole authority for whether a point can appear in automatic
highlights. TypeScript and Swift will stop reconstructing that answer from
partial point fields.

The pure selection and manifest code will live in a focused worker module,
separate from queue handling and FFmpeg commands. The points pipeline supplies
raw evidence. The selector supplies qualification, ranking, budgeting, and a
deterministic manifest. The renderer consumes that manifest without changing
membership.

This separates three responsibilities:

1. `points_pipeline.py` measures what happened.
2. The highlight selector decides whether the evidence is sufficient.
3. The renderer joins already-selected segments into one video.

Clients read the stored decision. They do not own thresholds.

## Per-point evidence contract

Migration 172 will add a nullable `points.highlight_evidence jsonb` column.
New v2 points write a versioned object. A representative value is:

```json
{
  "v": 1,
  "status": "ready",
  "route": "serve-anchored",
  "n_hits": 8,
  "connected_crossings": 7,
  "table_bounces": 4,
  "first_crossing_s": 124.16,
  "last_crossing_s": 128.91,
  "max_crossing_gap_s": 0.92,
  "observed_end_s": 129.44,
  "reasons": []
}
```

The contract records measured values and the reason evidence is unavailable.
It does not store a mutable numeric quality score.

Allowed `status` values are:

- `ready`: every required measurement was available;
- `unavailable`: the point came from v1, table calibration was unavailable,
  candidate detections were unavailable, no coherent crossing chain existed,
  or shot counting could not run.

For an unavailable point, unavailable fields are `null` and `reasons` contains
stable machine-readable values such as `pipeline_v1`, `no_table`,
`no_candidates`, `no_crossing_chain`, or `no_shot_count`.

### How the measurements are made

- `n_hits` is taken from the existing play classifier but is recorded even
  when winner/how classification is inconclusive. Highlight evidence must not
  disappear merely because the worker could not name the winner.
- `connected_crossings` is the longest ordered run of dwell-confirmed net
  crossings inside this card whose adjacent gaps do not exceed the existing
  `CROSS_GAP_S`. It is not the total number of crossings anywhere in the card.
- `table_bounces` counts projected bounces on the calibrated playing surface
  inside the point.
- `first_crossing_s`, `last_crossing_s`, and `max_crossing_gap_s` make the
  crossing chain reviewable without retaining or exposing the full track.
- `observed_end_s` is the existing `end_evidence_s`, constrained to the point.
- `route` records whether the card was serve-anchored, fallback, or end-on.

These values come from the same source-pixel, source-clock evidence used to
build the production card. Nothing is re-derived from the cut video, preview
clips, placement JSON, or a client clock.

## Qualification rule v1

A point qualifies only when all of the following are true:

- it is visible, is not skipped, and has a playable clip and cut position;
- `highlight_evidence.v` is `1` and `status` is `ready`;
- `n_hits >= 5`;
- `connected_crossings >= 4`;
- `table_bounces >= 2`;
- `observed_end_s` is present and lies inside the point;
- the point has not been manually edited after that evidence was generated.

Missing data fails closed. A point that cannot answer one of these questions is
not an automatic highlight.

The threshold deliberately prefers false exclusion. A great lob may be missed
when its trajectory leaves the crossing corridor. A fragmented track may miss
a genuine crossing. Those are acceptable omissions for automatic highlights;
showing a serve error, three-shot exchange, handover, or neighbouring-table
track is not.

### Ranking qualified rallies

Qualification is binary. Among qualified points, ranking uses:

1. `min(n_hits, connected_crossings + 1)`, descending;
2. `connected_crossings`, descending;
3. observed rally duration, descending;
4. point order, ascending, for deterministic ties.

The conservative first value rewards agreement between the two rally-length
receipts rather than allowing one unusually large detector count to dominate.
After the budget is applied, selected points return to match order.

Every selected point is qualified. The selector may skip a long qualified
point that no longer fits and take a shorter qualified point, but it never
crosses the qualification boundary to fill the remaining seconds.

## Duration rules

There are three ceilings over the same ranked qualified pool:

| Use | Ceiling | Product behavior |
| --- | ---: | --- |
| In-app Highlights | 150 seconds | One continuous video |
| Instagram Reel | 60 seconds | Best qualifying rallies that fit |
| Instagram Story | 20 seconds | Best qualifying rallies that fit |

The selector does not require a minimum total duration. A single qualifying
rally is enough. If the best available result is 18 seconds, the result is an
18-second video.

Clip cost uses the actual render segment length, not the point's original card
length. Each segment begins at the point's padded clip start and ends at the
earlier of its clip end or `observed_end_s + 0.75 seconds`, expressed on the cut
clock. The 0.75-second tail retains the point's finish and immediate reaction
without carrying ball collection into the highlight.

## Stored manifest

The worker writes one canonical manifest after database point IDs exist:

```json
{
  "v": 1,
  "rule": "quality-first-v1",
  "max_seconds": 150,
  "points_revision": "<sha256>",
  "points": [
    {
      "point_id": "<uuid>",
      "cut_start_s": 10.17,
      "cut_end_s": 18.42,
      "output_start_s": 0.0,
      "output_end_s": 8.25,
      "n_hits": 8,
      "connected_crossings": 7
    }
  ]
}
```

Despite the historical field names in reel manifests, automatic-highlight
segment bounds are cut-clock seconds. They are named `cut_start_s` and
`cut_end_s` in storage, types, and code so they cannot be confused with the
source clock used by point detection.

`points_revision` is a canonical digest of the selected point IDs, their
current boundaries, deletion/edit state, and evidence version. Scoring,
starring, notes, tags, and placement labels are excluded because they do not
change the automatic video.

The final manifest stores the measured output positions after crossfade
overlap. Those positions let web and iOS map a playback time to a point for the
score overlay and previous/next controls without seeking in the match cut.

## Rendering

A new `render_auto_highlights` function will be separate from `render_reel`
and `render_story`. Existing exports have different title, branding, score,
crop, and retention requirements; changing them to save code would put stable
sharing behavior at risk.

The automatic renderer will:

- read point segments from the local full-resolution cut produced by the same
  job;
- normalize all segments to one even-sized resolution, source frame rate
  clamped to 24–60 FPS, H.264 `yuv420p`, and AAC 48 kHz stereo; a segment with
  no audio receives silence so the filter graph and timeline remain uniform;
- join adjacent segments with the existing 0.3-second video and audio
  crossfade;
- include no title card, outro, watermark, or burned-in score;
- use `h264_videotoolbox` on the Mac with the existing libx264 fallback;
- set a fixed keyframe interval no greater than one second;
- write `+faststart` and verify positive, monotonic audio/video timestamps;
- return the real duration and each point's output-time bounds.

The R2 object key includes the manifest revision:

```text
reels/<match-id>-highlights-<revision-prefix>.mp4
```

Changing the revision therefore changes the URL and cannot be hidden by a
browser or AVFoundation cache. On a successful replacement, the worker deletes
the prior automatic-highlight object and negates its storage-ledger balance
before recording the new object.

## Database state

The existing `match_reels` table remains the stored-artifact authority.
Migration 172 adds the non-vertical scope `highlights`. It also replaces the
existing `match_reels_status_check` constraint so the terminal status `empty`
is accepted alongside `queued`, `rendering`, `ready`, and `failed`.

For `(match_id, scope = 'highlights')`:

- `rendering`: qualification succeeded and encoding is in progress;
- `ready`: `r2_key`, `duration_s`, `size_bytes`, and a non-empty manifest are
  present;
- `empty`: qualification completed and no point passed; `r2_key` is null and
  the manifest records the rule and empty point list;
- `failed`: highlight preparation failed; the match itself may still be ready.

The row is written directly by the trusted worker. The owner-facing
`enqueue_reel` RPC is not used for initial automatic generation.

Migration 172 also inserts a private `app_config` key,
`automatic_highlights`, initially `off`. It is not added to the anonymous
allow-list. The worker reads it once per match. Thresholds remain versioned
source code, not mutable production settings; a threshold change is a pipeline
release and receives a new rule version.

## Match-processing flow

For a new processed match:

1. BlurBall, table calibration, v2 card assembly, point fitting, and clip
   creation run as they do today.
2. The points pipeline writes `highlight_evidence` for every emitted point.
3. The worker uploads the normal cut, clips, metadata, and diagnostics.
4. The worker inserts points and maps their generated database IDs back into
   the automatic-highlight candidates.
5. If `automatic_highlights` is off, no highlight row is changed.
6. If it is on, the pure selector creates the 150-second manifest.
7. With no qualifying points, the worker records `empty` and continues.
8. With qualifying points, it records `rendering`, renders from the cut already
   in the work directory, uploads the result, and records `ready`.
9. Any qualification, render, upload, or bookkeeping failure records `failed`,
   logs the stage and rule version, and continues.
10. The match is marked ready and the normal notification is sent.

This work runs before `finish_match(..., "ready")`, so a newly ready match does
not expose a half-prepared highlight. The highlight stage has its own timing in
the existing cost meter. It consumes no additional customer processing minutes.

If the early points stage falls back to v1, the match still becomes ready but
its highlight row is `empty` because its evidence is unavailable.

## Edits and regeneration

Manual boundary edits, splits, joins, or deletion invalidate the edited
point's `highlight_evidence`. Database write paths that perform those changes
must set the affected evidence to null. Unedited qualifying points remain
eligible.

When Highlights is opened, the server compares the stored manifest revision
with a revision derived from current points:

- equal and `ready`: return the existing asset;
- current points produce no qualifying result: record/return `empty`;
- different and the cut still exists: enqueue one normal `reel` job for the
  `highlights` scope and return `rendering`;
- different and the cut is gone: return `unavailable` and do not serve a stale
  video whose point boundaries are no longer true.

Scoring and starring do not invalidate the asset. Reprocessing the match
replaces points and always rebuilds the automatic highlight when the switch is
on.

## Legacy matches

Legacy points have no `highlight_evidence`, so they do not qualify. The old
client-side picker is removed rather than kept as a fallback. This immediately
stops old matches from producing the same low-quality automatic reels.

The first release does not infer highlight evidence from placement candidates
or `suggestion.n_hits` alone. Fifty-three existing matches have richer
`serves.json` diagnostics, but current database points may have been split,
joined, moved, or deleted since that artifact was written. A separate backfill
may be designed later using the production-card overlap rules and human review.
Until then, no automatic highlight is preferable to a false one.

Existing starred, tagged, full-match, and vertical share exports are unchanged.

## Server API

A focused authenticated endpoint returns the automatic-highlight state for one
owned match. It performs the freshness check and signs the ready R2 object
inline. The response shapes are:

```json
{ "status": "ready", "url": "https://...", "durationS": 32.4,
  "manifest": { "v": 1, "points": [] } }
{ "status": "rendering" }
{ "status": "empty" }
{ "status": "unavailable" }
{ "status": "failed" }
```

The ready manifest contains the real non-empty point list; the abbreviated
example above shows only the envelope. The route relies on the existing owner
RLS boundary and validates that the stored key is inside the media bucket's
`reels/` prefix before signing it. It does not expand access to coaches or
public share viewers in this release.

Instagram actions ask the server for 20-second or 60-second derivatives of the
stored qualified pool. They may reuse the existing vertical reel job and
renderer, but their manifests come from `highlight_evidence`, not the removed
client picker.

## Web behavior

The existing Highlights row remains inside the match Tools card and keeps the
shipped styling. Its states are:

- ready: `4 rallies · 0:32`, playable;
- rendering: `Preparing highlights`, not playable;
- empty or legacy unavailable: `No highlight rallies`, not playable;
- failed: `Highlights unavailable`, not playable.

There is no Short/Long chooser. Tapping a ready row opens the existing watch
takeover in a dedicated highlight source mode. That mode uses the continuous
asset URL and output-time manifest, disables deleted-span and highlight-tape
jumps, and maps score/point chrome through the output timeline.

The underlying video uses automatic metadata loading as today, but there are no
future disjoint ranges to prefetch. Removing the video pauses it. Desktop and
mobile web share the state and source; each responsive branch must not create
its own active player.

## iOS behavior

The Tools row uses the same four states and copy as web. A ready row fetches the
signed asset and passes one URL and output timeline to `PlayerTakeover` in a
dedicated highlight source mode.

Highlight mode creates one `AVPlayerItem` and plays it from beginning to end.
It does not install boundary observers that seek to the next original cut
position. Score and previous/next controls map through the output timeline.
Share opens the existing highlight share sheet, whose Story/Reel manifests are
server-authoritative qualified subsets.

The web and iOS clients do not decode or interpret `highlight_evidence`; they
consume the stored manifest.

## Failure handling and rollback

- Highlight preparation never changes a match from ready to failed.
- No qualifying rally is an `empty` result, not an error.
- A renderer or upload failure is visible in worker logs and
  `match_reels.error`, capped as it is today.
- The `automatic_highlights` switch stops new generation without a deploy.
- Turning the switch off makes clients hide automatic highlights, including
  already-rendered ones, but does not delete the stored files.
- Rollback restores the previous web/iOS presentation only if it can do so
  without restoring the low-quality picker. The safe rollback is to hide
  automatic highlights, not to resume filler selection or remote tape jumps.

## Testing

### Pure qualification and selection

Python tests cover:

- every required field missing individually;
- exact rejection at four hits, three crossings, or one table bounce;
- exact acceptance at five hits, four connected crossings, and two table
  bounces;
- separated crossing clusters use the longest connected chain, not their sum;
- one unusually high detector count is capped by the conservative agreement
  value;
- only qualified points enter Story, Reel, and in-app manifests;
- budgets may return unused time and never admit an unqualified point;
- selected points return in match order;
- edited, skipped, deleted, clipless, and cut-position-less points are excluded;
- the same inputs produce the same manifest and revision.

### Pipeline contract

Fixture tests run the points pipeline without clip encoding and verify that:

- v2 points contain complete v1 highlight evidence;
- inconclusive winner classification still records `n_hits`;
- v1/no-table/no-candidates paths record unavailable evidence;
- source and cut clocks remain separate;
- web types and Swift decoding accept ready and unavailable evidence rows even
  though clients do not interpret them.

### Renderer

Synthetic clips with different frame rates and audio layouts verify:

- one continuous MP4 is produced;
- output audio/video timestamps are positive and monotonic;
- real duration matches the manifest after crossfade overlap;
- each output point boundary maps to the correct source frame within one frame;
- H.264/yuv420p, AAC when available, one-second-or-shorter GOP, and fast-start
  metadata are present;
- a missing audio stream produces a valid silent video rather than a broken
  filter graph.

The existing local visual render harness gains an automatic-highlight mode.
The full rendered video is watched, including every transition.

### Clients

- Web tests prove highlight playback changes the video source once and never
  assigns `currentTime` at rally transitions.
- Swift tests prove highlight mode installs no boundary-seek observer and maps
  output times to the expected point.
- Existing match play, scoring, editing, starred export, and Story/Reel sharing
  tests remain green.
- Web and iOS fixtures consume the same server manifest. The old duplicated
  picker parity fixture is removed.

### Required verification before release

- Run the complete worker test suite relevant to points, highlights, storage,
  rendering, and reel jobs.
- Run `npm run test:match-structure` and the other affected web suites.
- Run the real `npm run build` in an isolated worktree with its own `.next` if
  the current checkout has a development server.
- Run `ios/Tests/run.sh` and the native app build/test command.
- Verify web on desktop and at 393×660.
- Verify native iOS separately on a real device or simulator; a web viewport is
  not evidence for native playback.

## Acceptance criteria

The release is acceptable only when all of these are true:

- no selected point has fewer than five inferred hits;
- no selected point has fewer than four connected net crossings;
- no selected point has fewer than two table bounces;
- no selected point has missing or unavailable highlight evidence;
- a result shorter than a ceiling remains short;
- a match with no qualifying point exposes no playable automatic highlight;
- web and iOS play one continuous asset and perform no rally-boundary seek;
- after initial playback begins, every rally transition adds less than one
  displayed frame of unintended pause in the rendered file;
- fifty randomly sampled selected rallies contain no serve error, handover,
  neighbouring-table track, or known one/two-hit point, and at least forty-five
  are judged worth including by a human reviewer;
- the feature adds no customer processing-minute charge;
- a highlight failure does not prevent the match from becoming ready.

## Rollout

1. Ship migration 172 with `automatic_highlights = off`.
2. Release the worker evidence, selection, rendering, storage, and retry paths.
3. Process the existing private fixture corpus and review every selected rally
   plus a sample of rejected long rallies.
4. Confirm the selection and renderer acceptance criteria.
5. Release the web and iOS consumers while the switch remains off; both must
   treat absent highlight rows as unavailable.
6. Restart the production Mac worker on the released source and confirm its
   startup/version line before enabling the switch.
7. Keep cloud dispatch disabled unless the Modal worker exists and reports the
   same pipeline release and model checksums. The current repository contains
   the Modal design and plan but no deployed Modal implementation, so there is
   no second active execution lane to update today.
8. Enable `automatic_highlights` for internal/canary accounts, process at least
   five new matches across two venues, and inspect every selected rally and the
   complete rendered videos on web and iOS.
9. Enable it globally only after the canary has zero false inclusions and zero
   transition stalls.
10. Keep the old client picker deleted. Rollback uses the switch and hides the
    feature rather than restoring filler.

## Out of scope

- Rebuilding automatic highlights for every historical match.
- Improving the underlying BlurBall, table-calibration, bounce, contact, or
  crossing detectors.
- Giving coaches or public share viewers new access to owner highlight files.
- Changing starred, tagged, or full-match export membership.
- Adding music, slow motion, titles, captions, or generative editing.
- Charging storage or processing minutes for automatic highlights.
