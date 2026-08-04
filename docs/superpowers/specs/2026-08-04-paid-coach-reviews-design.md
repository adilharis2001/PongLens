# Paid coach reviews — design

2026-08-04, revision 3. Overnight build spec. Research inputs: full codebase
map, payments landscape (Stripe Connect charge patterns verified against
current docs), and UX patterns from Skillest, Metafy, Fiverr, Cameo,
OnForm/CoachNow, ttEDGE, Lichess. Revision 2 incorporated review feedback
(payment liability model, overdue-order exit, scoped match access, capacity
limit). Revision 3: voice notes and drawings stay in the free experience;
the paid boundary is the structured review production line, not the tools.

## What we're building

Coaches create a profile and paid review offerings, share a link, and get paid
for structured asynchronous match reviews. Students buy an offering, submit a
match with context, and receive a review built from point-anchored findings
plus the coach's written sections and attachments. Free coach invites and all
of today's note tools stay exactly as they are; the paid track adds the
structured review production line on top, and the free coach surfaces are
the funnel into it.

## The free/paid boundary

Free collaboration (fully unchanged — nothing is taken away):

- A student invites a coach with a link, as today.
- The coach can watch everything shared with them, navigate point by point,
  and leave typed comments, voice notes, and frame drawings on points and
  on the match — all of today's note tools.

Professional review (paid order required):

- The structured production line: point-anchored findings (one observation
  linked to several points), review sections shaped by the offering's
  template, attachments, a formally delivered review document, the
  clarification and follow-up machinery, order states with a promised
  turnaround, payment handling, and the order-scoped analysis-surface
  elevation for the coach.

The boundary is the deliverable, not the tools: free is a conversation in
the margins of a match; paid is a commissioned, structured review with a
defined scope and a finish line.

## Decisions locked

- **Payments**: Stripe Connect, Express-dashboard accounts, hosted
  onboarding. **Direct charges on the coach's connected account** with
  `application_fee_amount` for the platform fee, and **manual payouts** so
  the coach's money sits in their held balance until the order completes.
  Why this pattern (verified against Stripe docs):
  - The coach is the settlement merchant. Refunds and chargebacks debit the
    coach's balance, not ours. PongLens is only the backstop if a coach's
    balance goes irrecoverably negative — and since funds are held until
    completion, pre-completion refunds are always covered.
  - Delivery-gating is native: `interval = manual`, release on completion
    (US holding ceiling is 2 years, far beyond any order).
  - Tax registration burden, where any exists, sits with each coach under
    this model; async human-performed instruction is exempt-or-gray in most
    states, and marketplace facilitator obligations don't attach until
    roughly $100k per state. Not a launch problem.
  - The payments code is one module with the charge pattern isolated, so
    switching to separate charges & transfers (or Standard accounts) later
    is a contained change. Final confirmation of the pattern is a morning
    checkpoint before live keys — nothing else in the system knows about it.
- **Platform fee**: configurable in admin, snapshotted per order at purchase.
  `app_config` keys: `review_fee_mode` (`percent` | `fixed`),
  `review_fee_percent` (default 15), `review_fee_fixed_cents` (default 500).
  Not decided yet by design; changing config never changes existing orders.
  The offering editor shows the coach what they'd receive on their price.
- **Currency**: USD only.
- **No platform-imposed deadlines — but the coach's own promise has teeth.**
  Turnaround lives on the offering as the coach's declared promise, never
  enforced with penalties or auto-cancellation. The exits:
  - Before the coach accepts: the student can cancel any time, full refund.
  - After acceptance: once the order is materially overdue — accepted date
    plus the coach's own turnaround plus 7 days grace — a cancel-and-refund
    action appears on the student's order page. The coach's queue shows the
    promised-by date throughout. No penalty, no automatic action; the
    student just can't be trapped.
  - After delivery: auto-complete after 7 quiet days so payout release
    never hangs on a silent student.
- **Match access is order-scoped, not perpetual.** An active order grants
  the coach access to the submitted match. When the order completes (or
  cancels), that access ends. What the coach keeps forever: the review they
  wrote, its findings, and the point clips those findings reference —
  signed through an order-scoped resolver. Full-match access beyond the
  order only ever comes from a free coach link, which the student controls
  and can revoke, as today.
- **Capacity**: `max_active_orders` on the coach profile (empty = no
  limit). Active means paid through delivered. At the limit, purchases
  pause automatically and offerings show a quiet unavailable state; the
  manual pause toggle (`accepting_orders`) exists independently. No
  per-offering limits, no scheduling.
- **Templates are starting points, not constraints.** Serve review, receive
  review, full match review, plus a blank custom. A template prefills
  title, description, what's included, intake questions, and review
  sections; the coach can edit every word of all of it.
- **Attachments in v1** (PDF, Word, images, video — 50 MB cap per file).
  Coaches can prepare material offline and attach it to the delivered
  review.
- **Drills UI: not in v1.**
- **Kill switch**: `app_config.coach_reviews_enabled` gates all purchase
  surfaces at runtime. Coach-side building tools can stay visible.
- New Vercel env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `RESEND_API_KEY`. First privileged secrets in the web app — accepted.

## The coach funnel

Coaches already doing free reviews see the paid path in two quiet places:
one dismissible line with a button in the "Shared with me" section of the
match library, and a small row on the match page when viewing as a coach.
Dismissal stored in user metadata like the first-steps checklist. No
banners, no nagging.

## Data model (migration 071+)

- `coach_profiles` — user_id PK, handle (unique, lowercase), display_name,
  headline, bio, credentials (text[]), stripe_account_id, charges_enabled,
  payouts_enabled, accepting_orders bool, max_active_orders int null,
  published bool, created/updated. Public read of published rows via a
  security-definer resolver (page is unlisted: reachable by URL, linked from
  nowhere).
- `offerings` — id, coach_id, template_key, title, description, includes
  (text[]), price_cents, turnaround_days (the coach's promise),
  intake_questions (jsonb: [{id, label, optional}]), review_sections (jsonb:
  ordered [{key, label}] e.g. summary / strengths / work-ons / selected
  points / practice plan), followup_rounds int default 1, active bool, sort.
- `review_orders` — id, offering_id, coach_id, student_id, match_id (null
  until submission), status, price_cents + fee_mode + fee_cents +
  coach_share_cents (all snapshots), turnaround_days snapshot,
  intake_answers jsonb, promised_by (set at acceptance), payment refs
  (stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
  stripe_refund_id, stripe_payout_id — all nullable, only the payments
  module reads them), timestamps per transition (paid_at, submitted_at,
  accepted_at, delivered_at, completed_at, cancelled_at, cancel_reason).
- `review_documents` — order_id PK, sections jsonb (per-section rich text),
  status draft|delivered, delivered snapshot immutable after delivery.
- `review_findings` — id, order_id, title, body, audio_path, image_path,
  sort. `review_finding_points` — finding_id, point_id (one observation ↔
  several points).
- `review_attachments` — id, order_id, r2_key, filename, size_bytes,
  content_type.
- `review_followups` — id, order_id, author_id, body, created_at (capped by
  offering.followup_rounds).
- `stripe_events` — event_id PK, type, processed_at (webhook idempotency).
- `notifications.kind` check extended: order_paid, order_submitted,
  order_accepted, order_declined, clarification_requested, review_delivered,
  followup_received, order_completed, order_refunded.

House style throughout: RLS with owner predicates + column grants, state
transitions inside SECURITY DEFINER RPCs with `FOR UPDATE` (the
`placement_status` / `redeem_invite` pattern), SQLSTATE→HTTP mapping, stable
error codes in API responses, migration-contract tests.

## Order lifecycle

```
awaiting_payment → awaiting_submission → submitted → in_review ⇄ clarification
                                                   ↘ declined (auto refund)
in_review → delivered → completed (student accepts, or 7 quiet days)
exits: student cancel any time before acceptance; student cancel once
       materially overdue after acceptance; coach refund any time before
       completion. All refunds go to the original payment method. Never credits.
```

- **awaiting_submission**: paid, but the student hasn't attached a match or
  answered intake. The coach's declared turnaround starts at acceptance, and
  copy says so.
- **submitted**: in the coach queue. Coach accepts or declines with an
  optional message; decline triggers an automatic full refund. Acceptance
  stamps `promised_by = now + turnaround_days`.
- **clarification**: coach asks the student something; student reply returns
  the order to in_review. Distinct state so the student always knows the
  ball is in their court.
- **delivered**: the review document, findings, and attachments snapshot as
  the deliverable. Student gets `followup_rounds` rounds of questions; coach
  replies; student completes, or auto-complete after 7 days.
- **completed**: release the order's net amount from the coach's held
  balance (payout for the charge's balance-transaction net). Delivered
  reviews are final — no refunds after delivery except at the coach's or
  admin's initiative.
- Dispute webhook marks the order and surfaces it in admin; no automated
  clawback logic in v1.

## Money flow

Student pays via Stripe Checkout (hosted; cards, Link, Apple Pay) created on
the coach's connected account with `application_fee_amount` — the student is
visibly paying their coach, which is the truth of the relationship. Fee
computed and snapshotted at session creation. Funds settle to the coach's
balance and sit there (manual payout schedule) until completion releases
them. Webhooks handled: `checkout.session.completed` (mark paid),
`account.updated` (coach capability flags), `charge.refunded`,
`charge.dispute.created`. All webhook writes go through the `stripe_events`
idempotency table. Publishing an offering requires a connected account with
charges enabled; the buy button additionally requires
`coach_reviews_enabled`, the coach accepting orders, and capacity.

Sign-in is required before checkout (magic link or Google — same as today),
so every order has a user id from birth. Guest checkout is a later
improvement.

## Coach experience

- `/coach` — the hub. No profile yet: a short onboarding — claim handle,
  name/headline/bio/credentials, connect Stripe (hosted), create a first
  offering from a template. Has profile: the queue — new orders, in review,
  waiting on student, delivered, completed — each row carrying its
  promised-by date, plus earnings-to-date, the pause toggle, and the
  max-active-orders setting.
- `/coach/offerings` — list, create from template, edit,
  activate/deactivate. Editor shows the coach's take on their price under
  the current fee config.
- `/coach/[handle]` — the public page. Name, headline, credentials, bio, and
  offering cards: title, price, the coach's turnaround, what's included, buy
  button. Unlisted; the coach shares the link. Works logged-out.
- **Review workspace** — opens from a queue order. The match viewer with a
  review rail: browse points with the existing viewer, add a finding from
  any point (text, voice with dictation, frame drawing — existing machinery,
  now paid-side for coaches), link a finding to additional points, then fill
  the offering's review sections, attach files, and deliver. Draft
  autosaves. While the order is active the coach sees the analysis surfaces
  (analysis cards, placement) for that match — order-scoped elevation of
  today's owner-only gates, ending with the order.
- Review artifacts (voice audio, images, attachments) live under a new
  permanent R2 prefix — explicitly exempt from the 90-day voice retention
  sweep. A paid deliverable never rots.

## Student experience

- Coach page → pick offering → checkout → **submission wizard**: choose an
  existing match or upload a new one (the standard pipeline; an active paid
  order bypasses storage/daily quota for that one upload), confirm which
  player you are, answer the coach's intake questions, submit. If the
  upload is still processing, the order shows processing and flips to
  submitted when the match is ready; if processing fails, the student picks
  another video or cancels for a full refund.
- **Order page** — one screen that always answers: what state, what happens
  next, what the coach promised. Timeline of events, clarification thread
  when open, and the overdue cancel action when it applies.
- **Delivered review** — the review document rendered section by section,
  findings with tappable point clips (deep-linking into the match viewer),
  attachments, follow-up box while rounds remain, and a done button.
  Permanent part of the student's match history.
- Purchasing grants `app_access` (new source `order`) the same way accepting
  a coach invite does — a paid student is never stuck at the early-access
  gate.

## Notifications and email

In-app bell for every transition (fan-out pattern, new kinds above). Email
via Resend from Next.js (first use; `RESEND_API_KEY` on Vercel) for the
moments that matter when you're not in the app: coach — new paid order,
order submitted, follow-up received; student — order accepted, clarification
requested, review delivered, refund issued. Same visual shell as the
worker's existing emails. Stripe sends its own receipt.

## Admin

`/admin/reviews` — orders across all coaches with state and money columns,
fee config editor (mode + value), refund button, dispute flags. Follows the
existing admin subpage pattern.

## For Coaches page

`/coaches` marketing page, linked from the site header beside Features.
Content: what a review looks like (point-anchored findings on real footage),
you set the price and the turnaround, templates to start from, Stripe
handles the money, free collaboration stays free. Built last, after the
product surfaces exist, so screenshots can be real.

## Copy and UX principles (apply everywhere in this feature)

- Friendly, direct, only as many words as the idea needs. Complete
  sentences, varied rhythm.
- No explanatory subtitles under headings. No sales framing. No em dashes
  in product copy. Never the word "AI". At most one `text-cyan-glow` phrase
  per caption. Empty states are one short line.
- Don't print a number the UI already shows. State names in the UI are
  plain language ("Waiting for your match", not "awaiting_submission").
- Media-first surfaces go full-bleed (`AppNav`, not `AppShell`); compute
  layout ceilings before building; verify mobile at 393×660.

## Out of scope for v1

Drills UI, monthly plans/bundles, custom quotes, coach directory/discovery,
ratings and public reviews of coaches, telestration replay, timestamped
(sub-point) comments, guest checkout, multi-currency, per-offering
concurrency limits, automated dispute clawbacks.

## Build order tonight

1. Migrations + contract tests, TS types.
2. Payments module with the charge pattern isolated and a fake mode
   (`STRIPE_FAKE=1`) so every flow is clickable locally without keys; real
   client code behind the same interface.
3. Order RPCs + API routes (checkout, webhook, transitions, overdue exit).
4. Coach hub, onboarding, offering editor + templates, capacity setting.
5. Public coach page.
6. Student wizard, order page, delivered review page.
7. Review workspace (rail + findings + sections + attachments + deliver).
8. Notifications + emails.
9. CTA funnel touchpoint, admin subpage, For Coaches page.
10. Terms/privacy draft edits (flagged for your review, not silently
    shipped).
11. `npm run build` in a worktree, full lifecycle walked in the preview
    with the fake Stripe mode, screenshots of every surface for the
    morning.

## Morning checklist (you)

- Create the Stripe account, enable Connect, paste `STRIPE_SECRET_KEY`
  (test), add the webhook endpoint, paste `STRIPE_WEBHOOK_SECRET`.
- Create `RESEND_API_KEY` for the web app.
- Confirm the charge pattern (direct charges on Express + manual payouts)
  reads right to you — it's isolated in one module if we ever want to
  change it — then one real test-mode purchase end to end, legal copy
  review, live keys when ready.
