# Serve Review Frame Navigation

## Goal

Let a reviewer inspect contact and bounce timing without fighting the native
video scrubber.

## Interaction

- Add `−3`, `−2`, `−1`, `+1`, `+2`, and `+3` frame buttons directly below
  the video.
- Every button pauses the video and seeks by exactly the selected number of
  frames using the prepared clip's recorded FPS.
- Show a live `Frame N · T seconds · FPS fps` readout.
- Clamp navigation to frame zero and the final clip frame.
- Refresh the readout after native scrubbing, likely-action jumps, custom-action
  jumps, and frame-button navigation.
- Frame navigation never creates or changes labels.

## Data and Accuracy

- Add `fps` and `frame_count` to each anonymous report point.
- Frame indices are zero-based and calculated as `round(currentTime * fps)`.
- The prepared clips are treated as constant-frame-rate. This control does not
  claim sub-frame timing accuracy.

## Verification

- Renderer tests verify safe FPS/frame-count propagation and all six controls.
- Browser testing verifies `+1`, `+3`, and `−2` from a known timestamp and
  confirms the contact field remains unchanged.
