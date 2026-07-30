# Serve Candidate Event Labels

## Goal

Let a reviewer identify what every likely-action candidate actually represents,
creating useful event-level training data while they inspect the clip.

## Interaction

- Each likely-action row contains its jump button plus one event-label select.
- Labels are `Serve contact`, `Serve first bounce`, `Serve second bounce`,
  `Return contact`, `Return bounce`, `Third-ball contact`, `Third-ball bounce`,
  `Fourth-ball contact`, `Fourth-ball bounce`, `Later-rally contact`,
  `Later-rally bounce`, `Non-relevant`, and `Unsure`.
- A label is stored independently for each event type and timestamp.
- `Serve contact` fills contact time. `Serve first bounce` and `Serve second
  bounce` fill the matching visibility field.
- Changing a label replaces the prior label and does not move the video.
- The lower panel is renamed `Remaining serve details`; existing server,
  contact, visibility, bounce-visibility, hard-negative, and notes fields
  remain because event labels cannot infer them all safely.
- Existing binary verdict records remain stored but are not treated as event
  labels or silently converted.

## Data

Every exported point gains:

```json
{
  "action_judgments": [
    {
      "kind": "bounce",
      "t": 2.6026,
      "source": "visual",
      "event_label": "serve_first_bounce"
    }
  ]
}
```

Labels persist in the existing browser-local review record and remain
anonymous. Prediction files and confidence are unchanged.

## Verification

- Renderer tests cover taxonomy controls and export structure.
- Browser testing labels point 008, verifies the selected state persists
  across point navigation, and verifies a label does not alter the video
  position or unrelated fields.
