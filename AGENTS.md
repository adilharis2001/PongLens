# PongLens — start here

**Read `CLAUDE.md` before doing anything else in this repo.** It is the
single source of truth for how this project is built and how to write to
Adil, and it is kept current. This file exists so an agent that looks
for `AGENTS.md` finds its way there; the checklist below highlights the
approved UI baseline. The full rules remain in CLAUDE.md so future updates
have one canonical reference.

What is in it, so you can go straight to the part you need:

| Section | When you need it |
| --- | --- |
| Talking to Adil | Every reply. He knows the product completely and the code barely at all. |
| Reports and pages | Any artifact. Three sentences at the top, evidence below it, and the evidence is visual — never walls of prose. |
| Judgement | Before agreeing, before objecting, before reversing a position. |
| Think in surfaces | Any change. There are four surfaces and they drift apart quietly. |
| One processing pipeline, two execution locations | Anything touching the worker or the models. |
| Copy | Any user-facing words. |
| Design and layout | Any UI, and the traps specific to this codebase. |
| Tutorial videos | The narration and capture pipeline. |
| Finding the table | Calibration, the detector ladder, corner conventions. |
| Placement maps | Where a ball landed, and what has already been measured dead. |
| Ground truth: score, winner and who served | What Adil's own scoring proves, and what it cannot. |
| **Reconstructing production's cards** | **Any experiment scored against the scorekeeper — how to read his cards, his taps and his ends back out.** |
| What we refuse to process | The two gates before anything expensive runs. |
| Support email | Anything touching mail, in or out. |
| What the public can read | Anything touching RLS or `app_config`. |
| Working style | Verification, builds, worktrees. |

Two things that catch every new session, both covered in full there:

- **Never claim a change is safe on a filtered typecheck.** Run the real
  `npm run build`, and in a `git worktree` with its own `.next` if a dev
  server is already running in this checkout.
- **State what you verified and what you did not.** "Typecheck passed" is
  the sentence most often used to skip a real check, so it is the one that
  must never be wrong.

## Required design and copy checkpoint

Adil approved the inline allowance screens on 2026-09-05 as the reference
for PongLens's existing application theme. Read `CLAUDE.md` sections
**Copy**, **Design and layout**, and **Think in surfaces** before any UI
or wording changes. These are requirements, not optional inspiration.

- Reuse the existing colors, typography, spacing, inputs and button styles.
  Inspect a comparable shipped screen before editing; do not invent a
  separate visual language.
- Keep related content inside its existing card. Do not wrap a message,
  its form and its actions in multiple nested bordered panels.
- Use one clear primary action, with existing cyan styling, and outlined
  secondary actions. Left-align inline messages and forms.
- On mobile web and iOS, form/action buttons fill the available content
  width and have at least a 44px/44pt touch target. Stack them with spacing.
  Desktop buttons may be content-width. This does not turn chips, segmented
  controls or icon controls into full-width buttons.
- Copy is plain, natural, calm, specific English. No hype, clever phrases,
  dramatic fragments, unnecessary subtitles, em dashes or invented product
  claims. Name the action directly: “Request more storage”, “Send request”.
  Follow the narrow “Improve with AI” exception in `CLAUDE.md`; do not
  generalize it to other copy.
- For beta allowances, say that PongLens is in beta and players can request
  more storage or processing minutes for free. Do not say purchases are
  “paused”: they were never enabled.
- Preserve a player's selected video, entered link and draft when showing
  a limit. Requests, pending confirmations and manual retries belong where
  the limit is encountered, not behind an Account detour.
- Verify desktop and mobile web at 393×660, not just a tall phone viewport.
  Check native iOS separately; a web screenshot does not verify native UI.
  State exactly what was tested and what was not.

Approved implementation references: `src/components/AllowanceRequest.tsx`,
`src/components/AllowanceRecovery.tsx`, and the corresponding iOS
`AllowanceRequestRow.swift` / `AllowanceRecoveryView.swift` components.
The local preview URL is temporary; these committed sources and the
standards above are the durable reference for future tasks.

## Mandatory visual-reference gate

This gate applies to every user-visible UI change. It is a release
requirement, not a suggestion, and it still applies when a shared design
component appears close enough.

1. Before editing, name the exact shipped screen or component that will be
   used as the visual reference. Inspect its rendered state and its source.
2. If Adil names or shows a reference screen, that specific screen outranks
   a generic design-system component. Reproduce its hierarchy, spacing,
   alignment, sizing, container treatment and button treatment. Do not
   substitute a different existing pattern merely because it is reusable.
3. Before touching SwiftUI, read `ios/AGENTS.override.md`. Before touching
   web UI, read `src/AGENTS.override.md`. Root-started tasks do not discover
   nested instruction files automatically, so this explicit read is
   mandatory.
4. If no shipped analogue exists, or two plausible references conflict,
   stop and ask Adil which direction to use before inventing a pattern.
5. Render every changed state on every affected surface. For web, verify
   desktop and 393×660 mobile. For native iOS, use the simulator; a web
   screenshot does not count as native verification.
6. Show Adil screenshots of the rendered change and obtain approval before
   publishing web UI or uploading an iOS build, unless he explicitly waives
   screenshot review for that change.
7. Tests that search source code for a style or component name do not prove
   visual consistency. Use rendered or snapshot coverage where practical,
   and always perform the screenshot comparison above.
