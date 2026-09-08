# Beta request email follow-up

Approved scope: new admin notification subjects include the submitter's email;
new applicants immediately receive a short request confirmation explaining
that the separate TestFlight invitation arrives within 24 hours. Use the
existing shared email layout and logo. No resends or backfill for old requests.

## Implementation

- Admin notice v3: `iPhone beta request: <email>`. The applicant's email also
  remains in the body. Strip line breaks from the subject field.
- New `beta.request-received` template, with no invitation URL or install CTA.
- One `receipt` outbox job per new request, with its own stable idempotency key.
  Existing leases, retry persistence, suppression, delivery webhooks and
  metering apply. A receipt's delivery cannot mark the invitation delivered.
- Confirmation failures are independent of both admin notices. Repeating a
  signup keeps the original invitation, deadline and receipt job.

## Rollout order

1. Deploy the receipt-aware application first. Until the migration, it continues
   to handle the existing three jobs normally.
2. Apply only `20260906020000_beta_request_receipt.sql`, then record it in
   migration history. New rows get four jobs; existing rows are untouched.
3. Verify a new controlled signup receives the confirmation immediately while
   its invitation remains scheduled. Check the two admin subjects and repeat
   submission identity. Do not backfill confirmations or resend old notices.

Do not roll back to pre-receipt application code after step 2: old code treats
any non-invite job as an admin notice. Retain receipt-aware sending on rollback.

## Verification

Tests for submitter subjects, confirmation contents and one receipt per new
request failed before implementation and passed afterward. Actual PostgreSQL
tests verify no historical backfill, privacy, deduplication, unchanged 23-hour
invitation scheduling and that receipt delivery does not stamp the invitation.
A separate regression confirms receipt failure cannot misreport admin delivery.

All 20 package test scripts passed. Full `npm run build` passed with 151 pages;
existing lint/module warnings remain. Focused beta/email/admin/database run:
142 tests passed with no failures or skips. Preview catalog tests passed after adding the receipt
and repairing the previously missing allowance preview expectation.

## Production verification

Released application commit `e82b3a40` to production deployment
`dpl_2PG3c62vibR3dwoAJDB5q9y3k5D7`. Confirmed Ready and aliased to
`www.ponglens.com` before applying migration `20260906020000`.

A new official Resend test-address signup returned 200. Provider readback and
signed delivery events confirmed both admin notices delivered with the test
submitter's email in their subjects, and the applicant confirmation delivered
immediately with no TestFlight link. The separate invitation remained scheduled
23 hours after signup. Repeating the signup preserved all four provider IDs and
the original deadline. The existing real applicant's three jobs and scheduled
invitation were unchanged; no historical receipt was created or sent.

The shared confirmation was visually inspected at 393×660 in light and dark
browser rendering with no horizontal overflow. This is not a claim of testing
every native email client's dark-mode transformation. The official test mailbox
retains its scheduled invitation and audit record; it is not a real applicant.
