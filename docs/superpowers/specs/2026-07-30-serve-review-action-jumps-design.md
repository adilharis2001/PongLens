# Serve Review Action Jumps

## Goal

Make every point faster to review by exposing the detector's best action
timestamps even when it abstains from naming a server.

## Design

- Add a point-level `likely_actions` list to the privacy-safe report data.
- Prefer accepted serve events. Otherwise use visual contact and bounce
  candidates from the geometry arm; use audio-only impacts only when no visual
  candidate exists.
- Keep at most four chronological actions per point and deduplicate nearby
  events.
- Show the actions directly below the video as clearly uncertain buttons.
- Clicking a button seeks to 0.6 seconds before the detected event and pauses,
  giving the reviewer context before the action.
- Do not change predictions, confidence, scoring, or exported references.

## Safety and Testing

- Candidate data remains anonymous and contains only event type, timestamp,
  source, and confidence.
- Renderer tests verify candidate selection, bounded output, and button text.
- Browser verification confirms buttons seek the video and do not create a
  reference label.
