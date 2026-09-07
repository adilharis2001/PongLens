# Personalized beta invitations

The approved email keeps the existing logo, palette, typography and single
card. The installation button sits directly below the heading, before the
TestFlight steps. It fills the content width on mobile.

New invitation payloads use the applicant's saved role and interests. Selected
features are expressed as short invitations; up to three other relevant ideas
follow without duplicates. Player and coach selections get separate lists for
people who selected both roles. Old requests without answers get a short starter
list without claiming they chose those features.

The generic placement wording follows Adil's explicit preference not to add a
serve-only qualifier. It does not promise placement coverage for every shot.

## Scope and safety

- Only newly prepared invitation emails change. Frozen payloads and messages
  already scheduled with Resend remain untouched.
- No change to request confirmations, admin notifications, invitation timing,
  suppression, permissions or retry behavior. No database migration required.
- Plain bullet lists, no nested feature cards. HTML and plain-text order agree.
- Testing samples go only to Adil, never Anton. Do not test this template by
  creating production signups that send admin notifications to Anton.

## Verification

- Five new invitation regressions failed before implementation and passed after.
- 153 focused email, beta, admin, preview and actual PostgreSQL tests passed
  with no failures or skips.
- Full production build passed. Existing lint/module warnings remain.
- The 17 other TypeScript email fixtures render byte-identical HTML/text and
  metadata compared with the pre-change baseline.
- Browser QA rendered player, coach, both-role and all-selected variants at
  393×660, 320×660 and 1000×660 in light and dark mode. All 24 checks passed:
  install button visible in the first viewport, mobile full-width action,
  44px minimum target, no horizontal overflow, no nested panels, HTML below
  clipping size. Images/theme-CSS-disabled fallback also passed.
- Visually inspected mobile light/dark and desktop renderings. Browser theme
  emulation is not verification of every native mail client's color rewriting.
- Three labeled previews (player, coach, both) were sent only to Adil's Gmail.
  Resend reported all delivered; recipient readback confirmed no CC/BCC.

Preview fixtures: `scripts/email/beta-invitation-previews.ts`.
Reproducible browser checks: `scripts/qa/beta-invitation-email.mjs`.
