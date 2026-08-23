# Do the serve dots land where the ball did?

2026-08-23. The gate the serve-placement spec set for itself: before the
rule ships, look at the landings it newly admits, against the video.

Match `ec6490f4` (Chris, PingPod, 22 Aug, 98 scored points). The old rally
rule draws 12 points. The serve rule draws **79** in the harness and 80 in
the app — the same off-by-one the earlier yield study saw, one detected
game-end override moving a boundary and so moving which hypothesis a point
is judged against. **70 of the 79 are points the old rule showed nothing
for.**

## What was checked, and how

Every candidate bounce carries the pixel it was detected at (`x`, `y`) and
the frame it came from, so the check does not depend on the projection
being right: extract the frame the detector measured, mark that pixel, and
look for the ball.

Frames come from the per-point clips (720x406, 30fps) with `-ss` AFTER
`-i` — a fast seek can be a frame or two out, and at 30fps a served ball
moves far enough in one frame to make a correct landing look like a miss.
The marker box is 13 clip-pixels across against a ball of about 5.

## Result

| | |
| --- | --- |
| ball plainly inside the marker, on the landing frame | ~74 of 79 |
| ball passing through the marker across neighbouring frames | 5 |
| marker off the table, on the wrong half, or on a player | **0** |

The five that read as empty on a single frame were checked over a six-frame
strip either side. In each one the ball approaches, crosses the marker and
leaves — it is lost to motion blur against a dark blue table at 720p on the
one frame, not absent. Two are in `sheets/strip_009.png` and
`strip_092.png`.

Nothing is drawn anywhere a ball could not have been. That is the finding
that mattered: the failure this rule could plausibly have had is a
systematic one, every serve on the wrong half or the wrong player at once,
and there is no sign of it.

## What this does NOT establish

- **One match, one venue, one camera.** A second match (`7e02fbb9`,
  Julian, camera behind the players) goes from 2 of 77 to 41, but its
  landings have not been eyeballed.
- **On-table is not accurate to the centimetre.** This checks that the
  detected pixel is the ball and that the projection puts it somewhere
  real. It does not measure how far the dot is from the true landing.
- **The clips are 720p downscales** of a 1080p source. The detector ran on
  the source; the reviewer did not.

## Reproducing

Scripts are in the session scratchpad and copied beside this note:
`serve_frames.ts` (dump every admitted serve with its pixel), `make_crops.py`
(marked crops), `sheets.py` (contact sheets), `strip.py` (frame strips for
a doubtful landing).
