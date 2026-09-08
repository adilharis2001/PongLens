# Unified Adaptive Email System — Design

**Status:** Direction approved in conversation on 2026-09-04; awaiting final
spec review before implementation planning

**Surfaces:** Next.js transactional email, Python worker email, Supabase Auth
email, and existing operational digests

## Goal

Make every PongLens email feel like one product. Customer-facing messages use
one accessible visual system that follows the recipient's light or dark
preference where the mail client permits it and remains legible when the
client ignores, transforms, or overrides those styles. Every notification says
what happened, why it matters, whether action is required, and where the one
primary action leads.

The new iPhone beta email supplies the visual direction: restrained dark
surfaces, strong hierarchy, cyan accents, generous spacing, and concise copy.
The unified system keeps that character while adding a light palette and
cross-client fallbacks.

## Scope

This project includes:

- one shared email anatomy, token set, content contract, and voice;
- authored light and dark presentations with a robust light fallback;
- migration of current customer emails from Next.js, the worker, and Supabase
  Auth;
- migration of existing feedback, QA, cost, and failure digests after the
  customer-facing messages;
- revised subject, preheader, heading, body, action, and footer copy;
- explicit plain-text output for every message;
- sender identity cleanup;
- accessibility, rendering, snapshot, and live inbox validation; and
- delivery telemetry that identifies the message type and template version.

This project does not add a newsletter, marketing automation, a new email
preference center, or new notification triggers. Existing transactional
eligibility remains unchanged. Optional marketing and beta-update mail must be
designed as a separate consented system if introduced later.

DMARC enforcement is also not changed in the initial release. PongLens
currently publishes a monitoring policy (`p=none`). Moving to `quarantine` or
`reject` happens only after production headers from every sender have been
audited.

## Current system

| Family | Runtime | Current shell | Primary examples |
| --- | --- | --- | --- |
| iPhone beta | Next.js | Dark, 560px, text wordmark | Invitation and admin notice |
| Coaching | Next.js | Light, 480px, image wordmark | Review lifecycle |
| Purchases | Next.js | Coaching light shell | Minutes, storage, sponsored reviews |
| Match outcomes | Python worker | Duplicated light, 480px | Ready, failed, export ready |
| Authentication | Supabase Auth | Separate light, 480px | Confirm account, magic link |
| Digests and operations | Python and Node scripts | Several light variants, 520–600px | Feedback, QA, cost, outreach, failures |

The useful operational behavior remains in place: most sends are idempotent,
suppressed recipients are honored, delivery is metered, and action links land
on the relevant record. This project changes presentation and language without
weakening those guarantees.

## Approaches considered

### 1. Repository-owned shared contract and renderers — selected

A small, typed message contract describes content independently from markup.
Next.js and Python each render that contract with the same versioned tokens and
golden fixtures. A Supabase Send Email Auth Hook uses the edge-compatible
TypeScript renderer and Resend API for authentication messages.

This keeps email changes reviewable beside product changes, preserves the
worker's ability to notify when the web app is unavailable, and avoids a new
network dependency. Cross-runtime snapshot fixtures prevent the two renderers
from drifting.

### 2. Resend-hosted templates

Hosted templates would make visual editing convenient, but the source of truth
would move outside Git, Python and Supabase would still need integration work,
and a template edit could ship independently of the product state that supplies
its data. This is not selected.

### 3. Central email-rendering web service

All runtimes could post a message event to one service, producing perfect
renderer centralization. It would also make match-processing notifications
depend on the web deployment and introduce a new authenticated internal API,
queue, and recovery path. That complexity is not justified at current scale.

## Visual system

### Email anatomy

Every customer email renders in this order:

1. A hidden preheader that adds context rather than repeating the subject.
2. A live-text PongLens wordmark. The cyan mark may be an optional decorative
   image, but the identity does not disappear when remote images are blocked.
3. An optional category eyebrow such as **Match review** or **PongLens for
   iPhone**.
4. One semantic `h1` describing the current state.
5. One or two short paragraphs explaining why the state matters and what
   happens next.
6. One primary action when an action is useful.
7. Optional instructions or compact key/value details separated by a border.
8. A quiet footer explaining why the recipient received the message and
   providing a support path.

The subject, preheader, and heading perform different jobs. They must not repeat
the same sentence three times.

### Geometry and typography

- Outer canvas fills the available width.
- Card width is `560px` maximum with `16px` mobile gutters.
- Canvas padding is `36px 16px`; narrow screens reduce card padding from
  `32px` to `24px`.
- Corners use a `20px` radius where supported. The message remains complete if
  an Outlook version renders square corners.
- The font stack is `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif`.
- Heading size is `28px/1.2`; body is `16px/1.6`; details are `14px/1.6`; footer
  is `12px/1.6` but still meets normal-text contrast.
- The primary action has at least a `44px` visual height and descriptive text.
- Layout uses presentation tables and resilient inline fallback styles. The
  cyan button uses a table-cell background as well as an anchor background so
  it remains a button in Outlook.

### Color tokens

| Token | Light | Dark |
| --- | --- | --- |
| Canvas | `#f4f5f7` | `#08090f` |
| Surface | `#ffffff` | `#101119` |
| Primary text | `#111827` | `#f4f4f5` |
| Secondary text | `#4b5563` | `#c4c4cc` |
| Muted text | `#64748b` | `#a1a1aa` |
| Border | `#e4e4e7` | `#3f3f46` |
| Accent | `#2ac7e5` | `#2ac7e5` |
| Action text | `#071016` | `#071016` |

The accent button always uses dark text. White text on the current `#0891b2`
button is approximately `3.68:1`, which misses the `4.5:1` normal-text target.
The existing light footer (`#94a3b8` on white) is approximately `2.56:1`, and
the beta footer (`#71717a` on `#101119`) is approximately `3.89:1`. The new
muted tokens clear `4.5:1` in their authored themes.

Color is never the only indication of state or action.

### Theme behavior

The authored base is light because clients that strip the `<head>` or ignore
color-preference queries otherwise force all light-mode readers into a dark
message. The complete document declares:

- `color-scheme: light dark`;
- `supported-color-schemes: light dark`;
- a `prefers-color-scheme: dark` block that replaces every canvas, surface,
  border, text, and link token; and
- Outlook-targeted dark selectors only where inbox testing proves they help.

Colors are repeated on the HTML/body boundary, the full-width presentation
table, and the card so a client cannot expose a white strip around a dark card.
Transparent images are tested on both surfaces. The system does not attempt to
defeat a recipient's client-level theme override.

Three outcomes are deliberately supported:

1. a capable client shows the authored light or dark theme;
2. a client without theme-query support shows the light fallback; or
3. a client with forced transformation recolors the fallback while preserving
   contrast and hierarchy.

## Content contract

Each message is described before it is rendered:

```text
templateId       stable machine name
templateVersion  integer included in delivery telemetry
category         auth | beta | match | coaching | billing | digest | ops
audience         player | coach | tester | admin
subject          inbox headline
preheader        complementary inbox preview
eyebrow          optional product context
heading          outcome or current state
body             one or two plain-language paragraphs
action           optional { label, absolute PongLens URL }
details          optional ordered label/value rows
reason           why the message was sent
support          whether to show the support link
```

The renderer returns both HTML and an explicitly authored plain-text version.
No renderer queries the database or sends mail. Trigger-specific code gathers
facts, selects a catalog entry, renders it, and passes the result to the
existing delivery adapter.

Dynamic values are escaped at the content boundary. URLs must be HTTPS and
must match an allowlisted destination: `ponglens.com`, `www.ponglens.com`, or
the approved `testflight.apple.com` invitation. No raw exception, message body,
or user-supplied HTML enters a customer template.

## Voice and writing rules

PongLens email is calm, precise, and outcome-first.

- Put the person, match, or result before the PongLens brand in subjects.
- Use **match review** or **review**, not the internal noun **order**, unless the
  message is a financial receipt.
- Use active voice and sentence case.
- State whether the recipient needs to act.
- Use names when they clarify who did something.
- Use exact, descriptive actions: **Open your match**, **Answer Maya**, or
  **Continue the review**, not **Click here** or **See order**.
- Do not add false urgency, celebration, emoji, or marketing to a transactional
  event.
- Do not expose sensitive detail in the subject or preheader, where lock-screen
  previews can reveal it.
- In an error, say what failed, preserve the user's dignity, explain the safe
  recovery, and say what was not lost when that statement is true.
- If no action is needed, say so and omit the primary button unless viewing the
  record is genuinely useful.
- Dates and deadlines use the recipient-facing timezone where known and name
  the timezone otherwise.

## Customer message catalog

### Authentication

#### Confirm account

- **Subject:** Confirm your email for PongLens
- **Preheader:** Your confirmation link and code expire in one hour.
- **Heading:** Confirm your email
- **Body:** Use the button below to finish setting up PongLens. This link and
  the six-digit code expire in one hour and can only be used once.
- **Action:** Confirm email
- **Secondary label:** Using the iPhone app? Enter this code.
- **Reason:** If you didn't request this, you can ignore this email. Your
  account remains unchanged.

#### Magic-link sign-in

- **Subject:** Your PongLens sign-in link
- **Preheader:** Sign in securely; this link expires in one hour.
- **Heading:** Sign in to PongLens
- **Body:** Use this secure link to return to your matches. It expires in one
  hour and can only be used once.
- **Action:** Sign in to PongLens
- **Secondary label:** Using the iPhone app? Enter this code.
- **Reason:** If you didn't request this, you can ignore this email. Your
  account remains unchanged.

### iPhone beta

#### Requested beta invitation

- **Subject:** Your PongLens iPhone beta is ready
- **Preheader:** Install PongLens through TestFlight in a few taps.
- **Eyebrow:** PongLens for iPhone
- **Heading:** PongLens is ready for your iPhone
- **Body:** Open the invitation on your iPhone to install PongLens through
  TestFlight.
- **Action:** Install PongLens beta
- **Instructions:** Install TestFlight if needed; open this invitation on the
  intended iPhone; tap **Accept**, then **Install**.
- **Reason:** You requested the PongLens iPhone beta. This invitation does not
  subscribe you to marketing email.

#### Admin beta notice

- **Subject:** `{email} joined the iPhone beta`
- **Preheader:** Their TestFlight invitation was sent automatically.
- **Heading:** A player requested beta access
- **Details:** Email and request time
- **Action:** None
- **Reason:** The invitation and setup instructions were sent automatically.

### Match processing

#### Match ready

- **Subject:** Your PongLens match is ready
- **Preheader:** Watch `{filename}` point by point.
- **Heading:** Your match is ready
- **Body:** `{filename}` is ready to watch point by point. Score it, add notes,
  or share it with your coach.
- **Action:** Open your match
- **Reason:** You received this because PongLens finished processing a video
  you submitted.

#### Upload or import failed

- **Subject:** We couldn't process your video
- **Preheader:** Review the issue and try the upload again.
- **Heading:** This video couldn't be processed
- **Body:** The approved plain-language failure reason, followed by **Your
  original video on your device is unchanged.**
- **Action:** Try another upload
- **Reason:** You received this because a video you submitted could not finish
  processing.

The subject is the same for a direct upload and a YouTube import. The body names
the source and the actual recovery when that distinction matters.

#### Match export ready

- **Subject:** Your match export is ready
- **Preheader:** Your shareable video has finished rendering.
- **Heading:** Your export is ready
- **Body:** Your shareable match video has finished rendering. Open the match
  to save it or share it.
- **Action:** Open your match
- **Reason:** You received this because you asked PongLens to create an export.

### Coaching lifecycle

#### New booking for a coach

- **Subject:** `{student} booked {offering}`
- **Preheader:** We'll let you know when their match is ready.
- **Eyebrow:** New booking
- **Heading:** `{student} booked a review`
- **Body:** They booked **{offering}**. No action is needed yet; we'll email you
  when their match is ready to review.
- **Action:** View booking

#### Match submitted to a coach

- **Subject:** `{student}'s match is ready for review`
- **Preheader:** Accepting starts your `{turnaround}`-day turnaround.
- **Eyebrow:** Match review
- **Heading:** `{student}` sent their match
- **Body:** **{offering}** is ready when you are. Accepting the review starts
  your `{turnaround}`-day turnaround.
- **Action:** Open review request

#### Coach accepted

- **Subject:** `{coach} started your review`
- **Preheader:** Your review is now in progress.
- **Eyebrow:** Match review
- **Heading:** Your review is underway
- **Body:** `{coach}` started **{offering}**. It is expected within
  `{turnaround}` `{day|days}`, and we'll email you when it is ready.
- **Action:** Track your review

#### Coach asked for clarification

- **Subject:** `{coach} has a question about your review`
- **Preheader:** Your answer will help them continue.
- **Eyebrow:** Match review
- **Heading:** `{coach}` needs your answer
- **Body:** Your coach has a question before they can finish **{offering}**.
  The question itself is not copied into the email or lock-screen preview.
- **Action:** Answer `{coach}`

#### Student answered

- **Subject:** `{student} answered your question`
- **Preheader:** Their answer is waiting on the review.
- **Eyebrow:** Match review
- **Heading:** `{student}` answered
- **Body:** Their answer is on **{offering}**, so you can continue the review.
- **Action:** Continue the review

#### Review delivered

- **Subject:** Your review from `{coach}` is ready
- **Preheader:** Watch the points your coach selected.
- **Eyebrow:** Match review
- **Heading:** Your review is ready
- **Body:** `{coach}` finished **{offering}**. The points and feedback they
  selected are ready to watch.
- **Action:** Watch your review

#### Follow-up received

- **Subject:** `{student} has a follow-up question`
- **Preheader:** Reply on the review to close the loop.
- **Eyebrow:** Match review
- **Heading:** `{student}` followed up
- **Body:** They have a question about **{offering}**. The question itself is
  not copied into the email preview.
- **Action:** Reply to `{student}`

#### Coach invites another review

- **Subject:** `{coach} invited you to send another match`
- **Preheader:** Book another review whenever you're ready.
- **Eyebrow:** From your coach
- **Heading:** `{coach}` is ready for your next match
- **Body:** Book another **{offering}** whenever you have a match you want them
  to review.
- **Action:** Book another review

#### Refund issued

- **Subject:** Your refund is on the way
- **Preheader:** The full amount for `{offering}` was returned.
- **Eyebrow:** Refund
- **Heading:** Your refund has been issued
- **Body:** The full amount for **{offering}** was returned to your original
  payment method. Your bank determines when it appears on your statement.
- **Action:** View refund details

### Platform purchases

#### Receipt

- **Subject:** Receipt for `{title}`
- **Preheader:** `{title}` · `{amount}`
- **Eyebrow:** Purchase confirmed
- **Heading:** `{title}` is on your account
- **Body:** One product-specific sentence explaining what was added, how long
  it lasts, and any non-expiration guarantee.
- **Details:** Item, amount, purchase date, and payment reference when the
  provider makes a safe display value available.
- **Action:** **See your minutes**, **See your storage**, or **Use your review
  credits**, depending on the purchase.
- **Reason:** You received this receipt because you made a purchase on
  PongLens. Contact support if you don't recognize it.

## Digest and operational catalog

Internal and tester digests use the same shell but allow a `600px` maximum when
a table needs it.

- Feedback digest subject: **PongLens feedback · `{count}` new
  `{item|items}`**.
- QA digest subject: **`{count}` updates to your PongLens reports**. The email
  opens with the changes, not an explanation of the QA system.
- Cost alert subject: **PongLens costs crossed `{threshold}` this month**.
- Outreach subject keeps the run result and search term but removes verbose
  system phrasing.
- Admin job failure subject: **[Action needed] Match processing failed ·
  `{shortJobId}`**. The card shows the failed stage, user or match link, time,
  and a direct admin action. The raw escaped exception appears in a secondary
  diagnostic block, never as the whole email.

Admin-only templates may include denser detail, but they still require a clear
heading, severity, next action, and plain-text alternative.

## Sender and consent policy

All current customer-facing transactional mail uses:

- **From:** `PongLens <support@ponglens.com>`
- **Reply-To:** `support@ponglens.com`

Using the already monitored support address avoids a visible `noreply`
identity and requires no new mailbox. It also keeps the transactional sender
stable while volume is small.

If PongLens later introduces marketing or optional product/beta updates, those
messages use `PongLens Updates <updates@ponglens.com>`, require explicit
consent, include a preference or unsubscribe path, and support RFC 8058
one-click unsubscribe when applicable. They do not use the transactional
sender or templates.

The TestFlight invitation and narrowly operational beta-access notices are
transactional because the recipient explicitly requested beta access and the
form promises essential beta updates. General release notes, product news, or
promotions are optional updates and are not authorized by that wording.

Security, payment, refund, requested beta, match outcome, export outcome, and
actionable coaching-state messages remain transactional. Existing QA and
feedback digests remain limited to their current expected recipients; a future
general-audience digest would require preferences.

## Rendering architecture

### Shared assets

The repository owns:

- a single token module or data file;
- the message contract;
- a catalog of stable message IDs and content builders;
- one fixture per message state;
- a Next.js renderer producing HTML and text;
- a Python renderer consuming the same tokens and fixture shape; and
- a Supabase Auth Hook that verifies Standard Webhooks signatures and invokes
  the edge-compatible TypeScript renderer.

The TypeScript and Python renderers are intentionally pure. Given the same
normalized message contract, they produce semantically equivalent output.
Golden tests compare normalized HTML structure, visible text, action target,
and plain-text output rather than byte-for-byte whitespace.

### Next.js flow

```text
route or lifecycle event
  -> fetch and normalize facts
  -> select message catalog builder
  -> produce EmailMessage
  -> render HTML + text
  -> existing Resend adapter
  -> meter, stamp, suppress, or retry
```

Review, purchase, and iPhone beta messages all use this path. Their existing
idempotency keys and database delivery stamps remain unchanged.

### Worker flow

The worker keeps its local send capability:

```text
job outcome
  -> normalize safe facts
  -> build EmailMessage-compatible mapping
  -> Python renderer
  -> existing Resend send function
  -> existing idempotency and metering
```

The worker never calls the website to render an email. User-facing failure
messages accept only approved plain-language reasons; admin diagnostics accept
escaped exceptions.

### Supabase Auth flow

Supabase's Send Email Auth Hook replaces SMTP rendering for authentication
messages:

```text
Supabase Auth event
  -> signed Send Email Hook payload
  -> verify the Standard Webhooks signature before reading user data
  -> map email_action_type to an auth catalog entry
  -> TypeScript renderer produces HTML + text
  -> Resend API
  -> success response to Supabase Auth
```

The hook is selected instead of dashboard-managed HTML because it gives Auth
the same reviewed templates, explicit plain text, sender policy, and delivery
telemetry as the rest of PongLens. It lives in a Supabase Edge Function and
imports only the edge-compatible content, token, and rendering modules. It
does not call the Next.js deployment.

The handler supports every Auth action enabled in the project, including
secure email change's two-recipient token mapping; an unknown action fails
closed rather than sending a generic or broken link. It uses the verified
Standard Webhooks message identifier as the Resend idempotency key. A Resend
error is returned to Supabase so the initiating Auth request does not falsely
report that its email was sent.

The existing checked-in Supabase HTML remains the rollback path until inbox
validation is complete. Deployment requires setting the Resend API key and
hook-signing secret as Edge Function secrets, deploying the function, enabling
the Send Email Hook in Supabase, and then testing real links and one-time codes.

### Preview gallery

A development-only preview command renders an index of every fixture in light
and dark themes. It must not be reachable in production or contain production
user data. Each preview shows subject, preheader, HTML, and plain text and can
be captured at desktop and narrow widths.

## Delivery and observability

- Every Resend request retains a stable idempotency key.
- Every event records `templateId` and `templateVersion` with the existing cost
  event or delivery record.
- HTML and text are sent together.
- Customer action URLs use the production PongLens host and land on the
  relevant record.
- Bounce, complaint, and suppression webhooks continue to prevent repeat sends.
- Customer emails are not BCC'd to the administrator. Operational success is
  visible through delivery telemetry; only failures that require intervention
  produce an admin alert.
- A failure to send never rolls back a completed purchase, review transition,
  or processing result. Existing outbox/retry behavior remains the recovery
  boundary.
- Security-sensitive messages do not use open or click tracking. Tracking
  configuration is audited in Resend before rollout.
- HTML remains comfortably below Gmail's clipping threshold.

## Accessibility requirements

Every rendered email must:

- include `<html lang="en" dir="ltr">`, a meaningful `<title>`, and one `h1`;
- mark layout tables `role="presentation"`;
- preserve a logical reading order without CSS;
- provide meaningful alt text for informative images and empty alt text for
  decorative images;
- use descriptive link labels that make sense out of context;
- reach at least `4.5:1` contrast for normal text and `3:1` for large text in
  both authored themes;
- remain readable at 200% text size;
- remain complete with images disabled;
- include an equivalent plain-text message; and
- keep sensitive content out of subject lines, preheaders, and remote image
  URLs.

## Validation

### Automated

- Unit tests for every catalog builder and plural/date branch.
- Escaping and URL-allowlist tests for all dynamic fields.
- HTML structure and accessibility lint.
- Programmatic contrast tests for every foreground/background token pair.
- TypeScript/Python golden parity tests.
- Snapshot coverage for every message fixture in both themes.
- Plain-text snapshots with the action URL visible.
- Existing idempotency, retry, suppression, webhook, and metering tests.
- Production builds for the web app and worker test suite.

### Inbox matrix

Before migration is complete, seed messages are inspected in:

| Client | Light | Dark | Images blocked |
| --- | --- | --- | --- |
| Apple Mail on iPhone | Required | Required | Required |
| Gmail on iPhone | Required | Required | Required |
| Gmail web | Required | Required | Required |
| Outlook web | Required | Required | Required |
| Outlook desktop | Required | Required | Required |

Each client is also checked at a `320px` content width. Authentication links,
one-time codes, TestFlight, match deep links, review actions, and support links
are clicked only in controlled test records.

## Rollout order

1. Introduce tokens, message contract, pure renderers, fixture gallery, and
   automated validation without changing production sends.
2. Migrate the iPhone beta invitation first because it already represents the
   visual direction; verify that output is intentionally different only by
   adaptive-theme and accessibility improvements.
3. Deploy and validate the Supabase Send Email Auth Hook, then migrate
   match-ready, upload-failed, and export-ready messages.
4. Migrate coaching lifecycle and purchase receipts.
5. Migrate QA, feedback, cost, outreach, and admin failure messages.
6. Change the visible sender from `noreply@ponglens.com` to
   `support@ponglens.com`, send controlled messages through every runtime, and
   verify SPF, DKIM, and DMARC pass in received headers.
7. Remove administrator BCCs only after delivery telemetry is visible and
   verified.
8. Observe bounce, complaint, and support-reply behavior before considering a
   stricter DMARC policy in a separate change.

Each stage can be rolled back by restoring the previous renderer for that
message family. Trigger eligibility and business-state transitions are not
coupled to the visual migration.

## Standards and platform references

- [Gmail CSS support](https://developers.google.com/workspace/gmail/design/css)
  documents width, orientation, and resolution media queries but not
  `prefers-color-scheme`; this is why the design has a complete light fallback
  instead of promising native theme matching in every Gmail surface.
- [Microsoft's Outlook dark-mode guidance](https://support.microsoft.com/en-US/Outlook/mail/dark-mode-in-outlook)
  documents recipient-controlled message backgrounds and the ability to reveal
  original formatting; the template therefore tolerates both client
  transformation and the authored presentation.
- [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  defines the `4.5:1` normal-text and `3:1` large-text thresholds used in the
  token tests.
- [Resend deliverability guidance](https://resend.com/docs/dashboard/emails/deliverability-insights)
  recommends plain text, a reply-capable sender, compact HTML, and disabling
  tracking for sensitive transactional messages.
- [Supabase Send Email Hook guidance](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
  defines the signed hook flow selected for Auth; [Supabase Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)
  lists Send Email availability on Free and Pro plans.
- [Supabase production email guidance](https://supabase.com/docs/guides/auth/auth-smtp)
  supports separating authentication from future marketing traffic, keeping
  Auth content focused, and avoiding link tracking that can rewrite secure
  links.

## Acceptance criteria

- Every current outbound PongLens email is represented in the catalog or is
  explicitly classified as a raw internal diagnostic.
- Customer messages share the same structure, tokens, sender, footer, and
  language rules.
- All customer templates have HTML and controlled plain-text output.
- The authored light and dark palettes pass contrast tests.
- The required inbox matrix has no unreadable text, missing action, horizontal
  overflow, exposed white strip, or disappearing identity.
- Subjects and actions match the catalog in this specification.
- The TestFlight invitation, authentication, match, coaching, purchase, and
  export links reach the intended controlled records.
- Existing idempotency, suppression, retry, and delivery-stamp behavior remains
  green.
- No customer message BCCs the administrator after replacement telemetry is
  verified.
- Production headers pass SPF, DKIM, and DMARC for Next.js, worker, and
  Supabase Auth sends.

## User actions and decisions

No account action is required to begin implementation. Before production
rollout, Adil provides or confirms:

1. **Inbox QA:** access to one iCloud/Apple Mail inbox and one Outlook inbox, or
   a person who can return screenshots from the required light/dark checks.
   Gmail is already available.
2. **Sender confirmation:** `support@ponglens.com` is monitored and may be used
   as the visible From address for transactional messages. If not, the rollout
   pauses before the sender change while a monitored alternative is chosen.
3. **Resend settings:** if account settings are not accessible through the
   existing tooling, disable open and click tracking for transactional mail in
   the Resend dashboard when prompted.
4. **Supabase Auth Hook:** if the current Supabase credentials cannot configure
   it through the CLI or Management API, create the hook signing secret, add it
   and the Resend API key to Edge Function secrets, and enable the deployed
   Send Email Hook in the Auth Hooks dashboard when prompted. No email HTML is
   pasted into dashboard fields.
5. **Visual sign-off:** review the fixture gallery in both themes before any
   production sender or template is switched.

DMARC does not require an action during this project. A future request will
present the observed authentication evidence and exact DNS change before any
enforcement policy is tightened.
