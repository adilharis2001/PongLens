# Paid coach reviews — overnight build report

2026-08-05, early morning. Everything below is on branch
`worktree-coach-reviews` in the worktree at
`.claude/worktrees/coach-reviews`. Main is untouched. The live database has
migrations 073, 074 and 075 applied; every new table is RLS-locked and the
purchase kill switch is off, so nothing is visible to real users.

## What was verified, end to end

Walked in the preview with STRIPE_FAKE=1 and the two existing test
accounts (coach-demo@example.com as coach "Alex Carter", handle
`test-coach`; uploader-test@example.com as the student):

1. Coach onboarding: claim handle → create offering from the full-match
   template → fake Stripe onboarding (capability flags flip) → publish.
2. Public storefront at /coach/test-coach, logged out and logged in.
3. Purchase: buy button → order created with the 15% fee snapshot
   ($50 → $42.50 coach share) → fake checkout → paid.
4. Submission wizard: match picker + the coach's intake questions → sent.
5. Coach queue ("Your move"), the brief, accept (promised-by stamped
   Aug 9 = accept + 5 days), the workspace: finding created from point 4,
   linked to point 18, write-up sections filled, attachment on the order,
   delivered.
6. Student's delivered review: sections, the finding with its two point
   clips playing inline (signed via /api/review-media), the attachment,
   one follow-up question sent, marked done.
7. Money and signals: order `completed` with fake payment intent, charge
   and payout ids recorded; all six bell notifications with correct
   recipients and copy; all five email dispatch points fired (logged as
   skipped — no Resend key yet).
8. `npm run build` passes; `npm run test:reviews` passes (13 tests:
   fee math mirror + migration contract).

## Bugs found by the walkthrough and fixed

- Students saw the coach's auth account name instead of their storefront
  name (migration 075 + email module fix).
- The storefront page title doubled the site suffix.
- Attachment upload errors were swallowed silently (now surfaced).

## What was NOT verified

- Real Stripe: everything ran through the fake gateway. The real client
  code exists but has never talked to Stripe.
- Dictation and drawing in the workspace: built on the existing
  transcribe/Annotator machinery but not exercised headless (no mic; the
  drawing needs a hands-on pass).
- The overdue-cancel path and the 7-day auto-complete sweep (logic
  reviewed, clocks can't be waited out overnight).
- /admin/reviews renders (requires your admin session).
- Browser attachment uploads fail until the bucket CORS change below —
  the server-side pipeline (presign → PUT → HEAD → row) was proven with
  a script instead.

## Your morning list

1. **Stripe**: create the account, enable Connect, then on Vercel set
   `STRIPE_SECRET_KEY` (test mode first) and, after adding the webhook
   endpoint (`https://www.ponglens.com/api/stripe/webhook`, listening to
   connected accounts: checkout.session.completed, account.updated,
   charge.refunded, charge.dispute.created), `STRIPE_WEBHOOK_SECRET`.
2. **Resend**: create an API key for the web app → `RESEND_API_KEY` on
   Vercel.
3. **Service role**: `SUPABASE_SERVICE_ROLE_KEY` on Vercel (webhook and
   order-money writes need it).
4. **R2 CORS**: Cloudflare dashboard → ponglens-media bucket → CORS: add
   PUT to the allowed methods for your app origins. The API token can't
   do it (object-scoped), and coach attachment uploads from the browser
   need it.
5. Review the legal drafts in
   `docs/superpowers/specs/2026-08-04-legal-draft-edits.md`.
6. Review the branch, merge to main when happy, then we run one real
   test-mode purchase end to end and flip
   `app_config.coach_reviews_enabled` when you're ready.

## Demo data left in place

The completed test order (Alex Carter ⇄ John Miller, $50) with its
review, finding, attachment and notifications — useful for showing the
feature. The test-coach page is published but unlisted; purchases are
blocked by the kill switch regardless. Delete any of it whenever.

## Known small deviations from the spec

- Coach-side routes live at /coaching (not /coach/...) so the public
  storefront and /coach-invite stay reachable logged out.
- The order-submitted email only sends when the match was ready at
  submission; a still-processing match flips to submitted via a DB
  trigger, which can't send email — the coach still gets the bell.
- The 7-day auto-complete sweep runs on coach-hub and transition-route
  visits rather than a scheduled job; a Vercel cron can take it over
  later.
- Workspace point numbers use raw point order, which can drift from the
  match page's display numbers when points were deleted; cosmetic,
  worth a follow-up.
