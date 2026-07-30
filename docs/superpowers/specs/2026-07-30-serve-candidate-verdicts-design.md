# Serve Candidate Verdicts

## Goal

Let a reviewer grade every likely-action candidate where they already inspect
it, while leaving only genuinely unanswered serve details in the lower form.

## Interaction

- Each likely-action row contains its jump button plus `Correct` and
  `Not the serve` verdicts.
- A verdict is stored independently for each event type and timestamp.
- `Correct` means the timestamp is genuinely part of the serve, not
  necessarily the contact moment.
- A correct contact candidate fills an empty contact-time field. Bounce and
  audio candidates never masquerade as contact.
- Changing a verdict replaces the prior verdict and does not move the video.
- The lower panel is renamed `Remaining serve details`; existing server,
  contact, visibility, bounce-visibility, hard-negative, and notes fields
  remain because candidate correctness cannot infer them safely.

## Data

Every exported point gains:

```json
{
  "action_judgments": [
    {
      "kind": "bounce",
      "t": 2.6026,
      "source": "visual",
      "verdict": "correct"
    }
  ]
}
```

Verdicts persist in the existing browser-local review record and remain
anonymous. Prediction files and confidence are unchanged.

## Verification

- Renderer tests cover controls and export structure.
- Browser testing grades point 008, verifies the selected state persists
  across point navigation, and verifies a verdict does not alter the video
  position or unrelated labels.
