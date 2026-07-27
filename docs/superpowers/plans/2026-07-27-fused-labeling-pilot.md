# Authenticated fused-labeling pilot implementation plan

> Approved source design:
> `/Users/adil/Desktop/Projects/TTVid/docs/research/audio-labeling-app-100-200-points.md`

## Goal

Ship a private Pong Lens reviewer at `/research/fused-labeling` with 30 review
assignments (20 unique point clips plus 10 hidden repeats), permanent R2 media,
one-pass audio/BlurBall/ending labels, autosave, explicit uncertainty, and an
admin export. The 2022 Vaibhav match is excluded.

## Task 1: Research domain and security

- Add pure TypeScript domain helpers and red/green unit tests.
- Add research batches, reviewers, sources, and assignments.
- Enable RLS, revoke public access, and grant only the columns reviewers need.
- Let active allowlisted reviewers read/update only their own assignments.
- Let the existing Pong Lens administrator manage the pilot.
- Add `/research` to authenticated middleware protection.

## Task 2: Deterministic curation and permanent media

- Query the existing production matches and points with service credentials.
- Exclude the 2022 Vaibhav match, deleted/unusable points, duplicate source
  uploads, and public/test clips.
- Select 20 unique points across noisy and quiet venues, ending types, players,
  and rally lengths.
- Copy each clip into the non-expiring
  `research/fused-labeling/v1/sources/` R2 prefix.
- Hash the source clip and manifest.
- Generate the 10 ms waveform, permissive >10 kHz audio candidates, and
  BlurBall proposal events without copying proposal semantics into human
  labels.
- Seed 30 assignments, including 10 hidden repeated assignments.

## Task 3: Authenticated reviewer

- Add a server-gated, no-index research page.
- Fetch only the signed-in reviewer's assignments.
- Mint short-lived URLs only after assignment access is verified.
- Synchronize video, waveform, audio candidates, BlurBall events, and table
  placement.
- Preserve the existing keyboard style: playback, stepping, speed control,
  event keys, insertion, C marker, review-end marker, undo.
- Collect the full approved event, table-bounce, and point-ending schema.
- Autosave after actions, display the saved label on reviewed dots, show last
  saved text, validate completeness, and allow explicit unsure values.

## Task 4: Admin and export

- Show pilot progress and consistency metrics to the admin.
- Export raw assignments without overwriting duplicate reviews or leaking
  hidden target fields into the reviewer UI.

## Task 5: Verification and release

- Run research, auth, and placement tests.
- Run lint and a production Next.js build.
- Verify migration security and pilot counts against production.
- Exercise sign-in, video loading, keyboard labeling, autosave, reload, and
  export in a browser.
- Push the verified Pong Lens main branch so the existing Vercel production
  workflow deploys it.
