# Serve Follow-up Playback Design

**Status:** Approved by the user's requested behavior on 2026-07-30

## Problem

Marking a follow-up anchor changes the assignment's human label. Autosave then
replaces that assignment object in React state. The media-loading effect
currently depends on the whole assignment object, so it runs again, clears the
media URL, and resets playback to zero after every mark.

The follow-up also opens each clip at zero even when the reviewer already
provided an exact first serve-contact timestamp.

## Design

- Define a media session by assignment ID, not by the mutable assignment
  object.
- Autosave and follow-up label changes must not reload the protected media URL,
  remount the video, or change the current playback position.
- When a new follow-up assignment loads, derive its initial playback time from
  the saved exact `actual_serve_contact_s`.
- Clamp the initial time to the clip bounds, seek to it once metadata is
  available, and attempt playback.
- If browser autoplay policy rejects playback, keep the video paused at the
  exact serve-contact frame.
- Original-review mode and follow-up clips without an exact contact start at
  zero.

## Verification

- A pure media-session key remains stable when autosave replaces an assignment
  object with the same ID and changes when navigating to another assignment.
- Initial follow-up playback uses and clamps exact contact truth.
- Existing serve label, queue, lint, and production-build checks remain green.
- Production route continues to require authentication.

