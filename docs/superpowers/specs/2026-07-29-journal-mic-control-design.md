# Responsive Journal Mic Control

**Date:** 2026-07-29

## Goal

Make the microphone control in the Journal's **Working on** composer feel
intentional and polished without shrinking the cue input or primary Add action
on narrow phones.

## Design

The control has one behavior and two responsive presentations:

- At `sm` widths (640px and wider), show a compact outlined pill containing a
  refined microphone icon and the label **Dictate**.
- Below 640px, hide that pill and show the same action as an icon-only button
  inside the right side of the cue input.
- Reserve right padding in the narrow input so entered text never runs beneath
  the microphone.
- Keep the Add button outside the field and visually primary at every width.

The two presentations share the same recording handler and state. They are
responsive views of one action, not separate workflows.

## Interaction states

- **Idle:** microphone glyph; accessible name “Speak the cue”.
- **Recording:** a small stop-square replaces the microphone. The desktop label
  changes to **Stop** and the control uses a restrained red treatment.
- **Transcribing:** a compact spinner replaces the glyph. The desktop label
  changes to **Writing…** and both presentations are disabled.

The control keeps a minimum 36-by-36-pixel target, visible keyboard focus, and
the existing screen-reader labels. Recording, transcription, and ephemeral
audio behavior do not change.

## Scope

The visible behavior change is limited to `WorkingOn.tsx`, with a focused
presentation helper under `src/lib/journal` for state tests. It does not
redesign the full Journal entry editor microphone or alter the transcription
API.

## Verification

- Add a small pure presentation helper and unit tests for all three labels and
  disabled states.
- Run the Journal tests, lint, and a production build.
- Check that the regular-width pill and narrow icon render from the same
  recording state and that the input retains usable space below 640px.
