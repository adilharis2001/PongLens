# Record guidance: a ghost table that knows where good cameras stand

2026-08-18. Proposal only — no code yet. The ask: replace the Record tab's
placement rectangle with guidance intuitive enough that a first-time user
puts the phone where the pipeline needs it, including when the room won't
let them stand in the ideal spot, and including the left side of the table.

---

## What we show today, and why it misleads

`PlacementGhost` in `RecordScreen.swift` draws a nearly symmetric trapezoid
across the middle of the frame with a purple net line: a straight side-on
view. Side-on is the one angle we know the pipeline handles worst — it is
the Westchester geometry, the one that needs a research program of its own.
The overlay is not just unhelpful; it teaches the exact camera position we
least want. The roll-level indicator on it is good and stays.

The angle we actually want is the one in the Chris (PingPod) match used as
the reference for this proposal: behind one corner of the table, raised to
about head height, offset to the player's side, both end lines visible,
net roughly mid-frame. That match keypoint-calibrates cleanly and its
placement maps came out well.

## The one-sentence idea

**Don't draw a diagram of a table. Draw the table as the camera would see
it from a spot we know works — and we know which spots work, because every
successfully processed match tells us where its camera stood.**

Every calibration is four corners of a known 2.740 × 1.525 m rectangle.
`worker/table_keypoint_camera.py` already recovers the camera position in
metres from exactly that (`pose_from_homography`). Run it over the 62-match
hand-marked corpus plus every production match that calibrated, keep the
ones whose points and placement came out well, and we get an empirical
distribution of proven-good camera poses — distance from the near end,
height, lateral offset, pitch. No other table tennis product has this
corpus. The overlay stops being a guess about what a good angle looks like
and becomes a render of one.

## Tier 1 — the parametric ghost (ship first)

A translucent, perspective-true table drawn from the **golden pose** (the
median of the proven-good cluster), projected through the live camera's
actual intrinsics (`AVCaptureDevice` exposes them per lens). Not a bitmap,
not an enhanced photo — a tiny 3D model of a table (2.740 × 1.525 × 0.76 m,
net 15.25 cm with posts) projected in ~30 lines of math.

- **Fill, not just outline.** Playing surface at ~10% cyan, edges solid,
  the near end line slightly heavier (near-end-lower is a pipeline
  invariant), corner dots as snap targets. The net drawn as its own
  element — posts and tape — because centring the net is half of what the
  user is aligning.
- **Flip button.** Mirror the pose across the table's long axis. One
  toggle, exact by construction. Default to the last side used at this
  venue (we already remember `pl-last-venue`).
- **Room won't allow the ideal spot.** Two honest degrees of freedom,
  both kept inside the proven envelope rather than free-form:
  - **Pinch to step back/forward** — the virtual camera slides along the
    corridor between the nearest and farthest poses that ever processed
    well. The ghost re-renders in true perspective, so "farther away"
    looks farther away, not just smaller.
  - **Suggest the 0.5× lens** when the user hits the near limit and the
    table still overflows the frame. Wider glass is the real fix for a
    cramped room, and the ghost re-renders for the wider intrinsics.
- Keep the level line. Keep the guide auto-hiding once recording starts
  (overlays clear out during play — house rule).

Why not the photo (or an OpenAI-stylised version of it) as the overlay?
A photo bakes in one venue, one lens, one distance, and it cannot flip or
step back without lying about perspective. The photo's right home is the
guide sheet: a real frame of "this is what good looks like" next to the
top-down diagram the web's CameraGuide already has. Ghost-overlay apps
(OverCam, AlignShot, GhostViewer) prove people align to translucent
references naturally — but ours can be geometry, not pixels.

## Tier 2 — the ghost that knows the phone

CoreMotion gives exact pitch and roll (we already read roll). With one
more input — camera height — the ghost stops floating and pins itself to
the true horizon: it sits where the table *would* be if the phone is held
at golden height, and coaches the difference in words:

> Raise the phone a little. · Tilt down. · Step back about two steps.

Height comes from ARKit's floor-plane detection during a brief setup
moment (LiDAR phones get it near-instantly; non-LiDAR needs a second of
device motion). One constraint shapes everything here: **ARKit and the
recording capture session cannot share the camera.** So sensing lives in
a setup phase — align, lock, then the app swaps to the recording session
with the pose frozen. The phone is on a tripod; nothing moves in the
handoff. This is also why Tier 1 must stand on its own: post-handoff and
for users who skip setup, the parametric ghost is what's on screen.

## Tier 3 — table lock (the smart bet)

Detect the actual table during the setup phase and close the loop:

- **How, without shipping a model we can't ship:** the GPL keypoint
  network stays server-side, non-negotiable. But ARKit horizontal-plane
  detection needs no model at all: the table is a large horizontal plane
  ~0.76 m above the floor plane with extent ~2.7 × 1.5 m. Filter planes
  by height-above-floor and extent and the table falls out, colour-blind
  and licence-clean. Vision's rectangle detection on the preview frames
  is the cross-check where ARKit is thin.
- **Auto-sizing, solved honestly:** with the real table located, the
  ghost snaps to the table's true distance and stops asking the user to
  judge scale — the "how far am I" question answers itself. Cues become
  directional and concrete: *step back*, *move left*, *raise the phone*.
- **The lock moment:** a fit ring fills as the detected table converges
  on the ghost; at threshold it goes green with a haptic — "Locked. Tap
  record." (HomeCourt and SwingVision both converge on this shape: a
  named spot, a live check, a clear yes.)
- **Drift watch:** while recording, a whisper-level check that the frame
  hasn't slumped (tripods sag, someone kicks a leg). Warn within seconds,
  not after 40 wasted minutes.
- **The flywheel, the quietly biggest win:** at lock we hold four table
  corners in the recording's own frame. Ship them with the upload as a
  calibration prior. The worker's ladder gets a strong hint before it
  samples a single frame — fewer paid Sol calls, better placement maps,
  and in-app recordings become the best-calibrated matches in the whole
  library. Guidance stops being UI and starts feeding the pipeline.

## What the outside world does (research notes)

- **SwingVision** (tennis): mount behind the baseline, at least ~5 ft up,
  both baselines and alleys visible, sun behind the camera. A named spot
  plus requirements the app can check.
- **HomeCourt** (basketball): tripod 3–5 ft, sideline near half court,
  device must see player, backboard and the whole 3-point line. Their
  setup UX — position, live validation, then play — is the canonical
  shape for this feature.
- **Rephotography/ghost apps** (OverCam, AlignShot, GhostViewer): the
  translucent-overlay alignment pattern is well-worn and intuitive;
  users physically move until reality matches the ghost.
- **Coaching community** (tennis and table tennis forums): chest-to-head
  height behind the playing area, tripod always; too low hides feet and
  exaggerates upward motion, too high flattens depth.
- Nobody we found renders the guidance from an empirical distribution of
  poses that verifiably processed well. That part is ours alone.

## Copy (house voice, draft)

- "Stand behind the right corner, about head height."
- "Line the table up with the guide."
- "Can't step back farther? Switch to 0.5×."
- Locked: "That's the angle. Tap record."
- Drift: "The camera has moved. Check the tripod."

## How we'd know it worked

The measurement exists already: the share of in-app recordings that
keypoint-calibrate on the first rung of the ladder, plus quad_health.
Compare recordings made with the old rectangle (builds ≤ 7) against the
ghost. Target: >95% first-rung calibration on in-app recordings, paid
fallback near zero, zero side-on recordings from the app.

## Status

2026-08-18, same day: steps 1 and 2 are built. `worker/mine_record_poses.py`
mined 61 hand-marked matches (golden: 2.82 m behind, 2.74 m lateral, 0.90 m
above the surface; corridor behind 1.49–4.09 m; sides split 51/49) and
`ios/.../Components/TableGhost.swift` renders the ghost with flip, pinch
corridor and the level line, replacing the side-on trapezoid. Verified in
the simulator through the theme gallery (`--theme-gallery` launch argument).
Tiers 2 and 3 remain.

## Build order

1. **Corpus mining script** (worker side, half a day): poses for every
   calibrated match, filtered by outcome quality → golden pose + envelope
   as a small JSON the app bundles.
2. **Tier 1 ghost** (a day): projection math, fill/edges/net, flip,
   pinch-along-corridor, lens suggestion. Replaces `PlacementGhost`.
3. **Tier 2 sensors** (1–2 days): pitch-pinned horizon, worded cues,
   ARKit height in a setup phase with session handoff.
4. **Tier 3 lock** (the bet, ~a week): plane-based table find, fit ring,
   lock haptic, drift watch, calibration prior on upload.

Each tier ships value alone; none blocks the next.
