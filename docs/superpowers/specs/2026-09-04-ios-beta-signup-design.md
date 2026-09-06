# iOS Beta Signup — Design

**Status:** Approved in conversation on 2026-09-04

**Surface:** Player landing page (`/`)

## Goal

Let a visitor request the PongLens iPhone beta without making Adil a
middleman. The visitor supplies one email address, PongLens immediately sends
the public TestFlight link and concise installation instructions, and Adil
receives an operational Gmail notification that a new person requested access.

The address is used for beta access and essential beta operations only. This
flow does not subscribe the visitor to marketing mail.

## Experience

The web product remains the primary action. The hero uses **Upload your first
match** as a filled cyan primary action and replaces the generic **See it work**
secondary action with the single-line, cyan-outlined **Get the iPhone beta**.
Both controls have the same height and typography; their fill establishes the
hierarchy. TestFlight is explained in the dialog instead of adding a second
line to the trigger. The closing web action uses the same upload wording. The
walkthrough remains reachable through the page itself and navigation.

The hero description stays short enough to leave room for those two choices:
**Upload a match video. PongLens removes the time between points, then gives
you every point as a clip to score, review and share with your coach.**

At the closing CTA, Web remains **available now**. The static iOS **coming
soon** pill becomes an interactive **iOS beta / Get access** control. Both iOS
controls open the same dialog; neither navigates away from the landing page.

The dialog uses the current dark PongLens visual language:

- eyebrow: **PongLens for iPhone**;
- title: **Send PongLens to your iPhone.**;
- explanation: **Enter your email and we'll send the TestFlight link and setup
  instructions.**;
- one labeled email field;
- primary action: **Email me the beta link**;
- privacy line: **Beta access and essential beta updates only. No marketing.**

After a successful request, the dialog changes in place to **The beta is
headed your way.** and tells the visitor to check the supplied address. It does
not expose the TestFlight URL in page markup or the API response. Invalid
addresses receive an inline correction; temporary delivery failures receive a
retry message without losing the stored request.

The FAQ answer about phones is updated to acknowledge both the browser product
and the iPhone beta. Android remains **coming soon**.

## Request and abuse boundary

`POST /api/ios-beta` accepts JSON with `email` and a visually hidden honeypot
field. It normalizes the address by trimming and lowercasing, rejects malformed
or oversized values, and returns the same success shape for a first request and
an already-delivered request.

The browser never talks directly to the beta tables. A server-only Supabase
service client calls a security-definer claim function. The database allows at
most ten requests per hashed source address in a rolling one-hour window.
Source addresses are HMAC-SHA256'd before storage using the already-required
service-role secret, and old rate-limit rows are pruned. The honeypot returns a
quiet success without creating a row.

## Data and delivery

`ios_beta_requests` stores one normalized email per row with creation time,
last-request time, request count, tester-delivery time, suppression time, and
admin-notification time, and suppression stamps for either recipient. RLS is
enabled with no browser policy. The claim RPC is executable only by
`service_role`.

The TestFlight link comes from the server-only `IOS_TESTFLIGHT_URL` environment
variable. It must be an HTTPS URL on `testflight.apple.com`; the endpoint fails
closed when it is absent or invalid. `RESEND_API_KEY` remains the delivery
credential and `ADMIN_EMAIL` remains the notification destination.

Each claim attempts two independent Resend messages:

1. The visitor receives **Your PongLens iPhone beta is ready**, an **Open
   PongLens in TestFlight** button, and three short install steps.
2. Adil receives **New PongLens iOS beta request**, including the normalized
   address and request time.

Each message has a stable request-specific Resend idempotency key. A successful
send stamps its column. A suppressed visitor address is stamped separately so
the daily sweep does not retry it forever. The visitor message determines the
API result; an admin-notification failure never blocks beta access. The existing
daily cron retries either unstamped message as a safety net.

## Accessibility and responsive behavior

The trigger is a real button. The dialog is native, labeled by its heading,
closes with Escape and a visible close control, focuses the email field, and
announces errors and success. Loading disables duplicate submission. The dialog
fits a narrow mobile viewport. At 393×660 the two hero actions stack at the
same 320px maximum width and 56px height, with at least 72px between the
actions and the table illustration. At wider breakpoints they return to one
row and content-driven widths.

## Configuration and rollout

The application documents `IOS_TESTFLIGHT_URL` in `.env.example`. The feature
can be merged before the URL is known, but it must not be released as an active
CTA until that production variable contains the approved public invitation
link. The TestFlight external group must contain an approved build and have an
active public link.

## Validation

Automated tests cover normalization and validation, TestFlight URL validation,
email copy and escaping, rate-limit/claim integration boundaries, endpoint
responses, client response states, and delivery orchestration. Verification
also includes feature-file lint, a production build, and real desktop and
mobile checks of both entry points against the local site. With that site
running on port 4010, `node scripts/qa/home-hero-layout.mjs` enforces the hero's
393×660 and 1440×900 layout contract.
