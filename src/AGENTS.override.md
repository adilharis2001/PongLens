# PongLens web UI rules

Read the repository-root `CLAUDE.md` sections **Copy**, **Design and
layout**, and **Think in surfaces** before changing web UI. The mandatory
visual-reference gate in the root `AGENTS.md` applies in full.

## Before implementation

- State the exact shipped web screen and source file being copied.
- Inspect the rendered reference and its source before editing.
- Reuse the reference's actual component structure and styling. A generic
  utility class or shared component is not proof that it is correct for the
  surface being changed.
- When Adil supplies a screenshot or names a screen, it is the authority for
  hierarchy, spacing, alignment, sizing, container treatment and controls.
- If the reference cannot be reproduced or conflicts with another pattern,
  stop and ask before inventing a third treatment.

The approved inline form references are `src/components/AllowanceRequest.tsx`
and `src/components/AllowanceRecovery.tsx`. A more specific reference named
by Adil takes priority over this general baseline.

## Verification and release gate

- Render every affected state on desktop and at a 393×660 mobile viewport.
- Compare the result directly with the named reference, including button
  height, width, alignment, typography, surrounding inset and container.
- Admin-only UI, including research pages restricted to admins, does not
  require screenshot approval before publishing. Keep the rendering and
  visual comparison checks above. For player-, coach- or public-facing web
  UI, show Adil screenshots and wait for approval before publishing, unless
  he explicitly waives screenshot review for that change.
- A source assertion that a particular class or component name appears is
  not visual verification and must not be used as the release gate.
