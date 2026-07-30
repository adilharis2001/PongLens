# Fast Frame Stepping and Focused Serve Review

## Goal

Make event labeling responsive enough for frame-level work and reduce the
default review workload from 406 points to a representative set of about 60.

## Approved Approach

Keep one video element and one report. Do not split the report into pages,
because only the selected point's video is mounted and the 406-point list is
not the cause of media buffering.

## In-Place Frame Stepping

- Load a clip only when the reviewer selects a different point.
- Fetch the selected clip once and expose it to the video as an in-memory blob
  URL. This makes the full clip seekable even when the lightweight local HTTP
  server does not support byte-range requests.
- Revoke the previous clip's blob URL when the next clip finishes loading.
- Set the video to `preload="auto"`.
- For `−3`, `−2`, `−1`, `+1`, `+2`, and `+3`, pause the current video and set
  `currentTime` on the already-loaded media.
- Never change `src` or call `load()` during frame stepping.
- Continue clamping to frame zero and the final frame.
- Keep likely-action jumps exact using the same already-loaded clip.
- Frame stepping must not create or mutate review labels.

## Focused Review Queue

- Keep all 406 points available through an `All points` filter.
- Add a `Focused review` filter and select it by default.
- Include every `high_confidence` point from the report's primary arm. The
  current run has 30.
- Fill the remaining slots to a target of 60 from `needs_review` points.
- Make the withheld sample deterministic and representative:
  - bucket by anonymous case and withheld reason;
  - rank points inside each bucket by a stable hash of the anonymous point key;
  - select round-robin across buckets until the target is reached.
- Store the focused point keys in anonymous `report-data.json`. Regenerating
  the same run must produce the same queue.
- Existing local labels remain keyed by point key, so changing filters or
  regenerating the report cannot discard work.

## Success Criteria

- Repeated adjacent frame steps issue no media-source reload.
- `+1`, `+3`, `−2`, and lower-bound clamping produce the expected frame
  numbers in browser testing.
- The default list contains 60 points: all 30 primary high-confidence points
  plus 30 stratified withheld points.
- `All points` still exposes all 406 points.
- Existing action and custom-event labeling continues to work.
- Renderer, JavaScript parsing, privacy, and full worker tests pass.
