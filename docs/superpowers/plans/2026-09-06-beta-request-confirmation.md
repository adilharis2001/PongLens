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
