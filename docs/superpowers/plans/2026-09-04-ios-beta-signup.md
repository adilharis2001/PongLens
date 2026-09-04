# iOS Beta Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-serve player-landing-page flow that emails a TestFlight invitation and notifies the PongLens administrator.

**Architecture:** A reusable client dialog posts a normalized email to one public Next.js route. A service-only Supabase claim RPC persists and rate-limits the request, while a focused email module sends idempotent tester and admin messages immediately and from the existing daily recovery sweep.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, Supabase/Postgres, Resend, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-ios-beta-signup-design.md`

## Global Constraints

- Email use is limited to beta access and essential beta updates; no marketing subscription is created.
- The existing **Analyze your first match** web CTA remains primary.
- The TestFlight URL is server-only and must be HTTPS on `testflight.apple.com`.
- Browser clients receive neither the TestFlight URL nor direct access to beta-request tables.
- One request may produce at most one tester email and one admin email through stable Resend idempotency keys.
- Visitor delivery failure is visible and retryable; admin-notification failure does not block visitor success.

---

### Task 1: Pure beta request and email contract

**Files:**
- Create: `src/lib/iosBeta/model.ts`
- Create: `src/lib/iosBeta/model.test.ts`

**Interfaces:**
- Produces: `normalizeBetaEmail(value: unknown): string | null`
- Produces: `parseTestFlightUrl(value: string | undefined): string | null`
- Produces: `escapeBetaHtml(value: string): string`
- Produces: `testerEmailContent(testFlightUrl: string): { subject: string; html: string }`
- Produces: `adminEmailContent(email: string, requestedAt: string): { subject: string; html: string }`

- [x] **Step 1: Write failing model tests**

```ts
test("normalizes valid addresses and rejects invalid input", () => {
  assert.equal(normalizeBetaEmail("  Player@Example.COM "), "player@example.com");
  assert.equal(normalizeBetaEmail("not-an-email"), null);
});

test("accepts only an HTTPS TestFlight invitation", () => {
  assert.equal(parseTestFlightUrl("https://testflight.apple.com/join/abc"), "https://testflight.apple.com/join/abc");
  assert.equal(parseTestFlightUrl("https://example.com/join/abc"), null);
});
```

- [x] **Step 2: Run the tests and confirm they fail because the module is missing**

Run: `node --test --experimental-strip-types src/lib/iosBeta/model.test.ts`

- [x] **Step 3: Implement the pure functions and escaped email content**

Use a conservative address grammar, a 254-character ceiling, `URL` hostname
validation, and the existing PongLens email-shell visual vocabulary. Tester
copy must contain the TestFlight CTA and install steps; admin copy must include
only the escaped normalized address and ISO request time.

- [x] **Step 4: Run the model tests and confirm they pass**

Run: `node --test --experimental-strip-types src/lib/iosBeta/model.test.ts`

### Task 2: Persisted claim and rate limit

**Files:**
- Create: `supabase/migrations/169_ios_beta_requests.sql`
- Create: `src/lib/iosBeta/claim.ts`
- Create: `src/lib/iosBeta/claim.test.ts`

**Interfaces:**
- Consumes: `createAdminClient()` from `src/lib/supabase/admin.ts`
- Produces: `hashBetaSource(ip: string, secret: string): string`
- Produces: `claimIosBetaRequest(email: string, ipHash: string): Promise<BetaClaim>`
- Produces: `BetaClaim = { id: string; email: string; requestedAt: string; inviteNeeded: boolean; adminNoticeNeeded: boolean; rateLimited: boolean }`

- [x] **Step 1: Write failing tests for stable keyed source hashing and RPC result parsing**

```ts
test("source hashes are stable but secret-specific", () => {
  assert.equal(hashBetaSource("203.0.113.4", "one"), hashBetaSource("203.0.113.4", "one"));
  assert.notEqual(hashBetaSource("203.0.113.4", "one"), hashBetaSource("203.0.113.4", "two"));
});
```

- [x] **Step 2: Run the claim tests and verify the missing implementation fails**

Run: `node --test --experimental-strip-types src/lib/iosBeta/claim.test.ts`

- [x] **Step 3: Add the migration and claim adapter**

Create `ios_beta_requests` and `ios_beta_rate_limits`, enable RLS, expose a
`claim_ios_beta_request(p_email text, p_ip_hash text)` security-definer RPC to
`service_role` only, cap each source at ten claims per hour, and return the
request plus delivery needs. In TypeScript, HMAC the source and fail closed on
malformed RPC output.

- [x] **Step 4: Run the claim tests and confirm they pass**

Run: `node --test --experimental-strip-types src/lib/iosBeta/claim.test.ts`

### Task 3: Idempotent beta email delivery

**Files:**
- Create: `src/lib/email/iosBetaEmails.ts`
- Create: `src/lib/email/iosBetaEmails.test.ts`
- Create: `src/lib/iosBeta/delivery.ts`
- Modify: `src/app/api/cron/reviews-sweep/route.ts`

**Interfaces:**
- Consumes: `testerEmailContent`, `adminEmailContent`, `parseTestFlightUrl`
- Produces: `deliverIosBetaRequest(requestId: string): Promise<BetaDeliveryResult>`
- Produces: `sendPendingIosBetaEmails(): Promise<void>`

- [x] **Step 1: Write failing delivery-orchestration tests**

Assert that tester and admin idempotency keys are distinct and request-bound,
that successful and suppressed deliveries receive the correct independent
stamps, that failures remain retryable, and that both messages begin together.

- [x] **Step 2: Run the email tests and confirm the delivery module is absent**

Run: `npm run test:email`

- [x] **Step 3: Implement delivery and the daily recovery hook**

Fetch one stored request, send each needed message with Resend, reuse suppression
and cost metering, update only the corresponding successful/suppressed stamp,
and let the cron scan a bounded batch of pending rows after its existing work.

- [x] **Step 4: Run all email tests and confirm they pass**

Run: `npm run test:email`

### Task 4: Public request endpoint

**Files:**
- Create: `src/app/api/ios-beta/route.ts`
- Create: `src/app/api/ios-beta/route.test.ts`
- Create: `src/lib/iosBeta/request.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `normalizeBetaEmail`, `parseTestFlightUrl`, `hashBetaSource`, `claimIosBetaRequest`, `deliverIosBetaRequest`
- Produces: `POST /api/ios-beta` JSON `{ ok: true }` or `{ ok: false; code: string }`

- [x] **Step 1: Write failing endpoint behavior tests**

Run the request handler against real `Request` values with only database and
delivery boundaries replaced. Cover JSON parsing, the honeypot,
normalized-email validation, forwarded-address hashing, rate-limit handling,
fail-closed TestFlight configuration, generic duplicate success, and
delivery-failure handling.

- [x] **Step 2: Run the endpoint tests and confirm the route is missing**

Run: `node --test --experimental-strip-types src/app/api/ios-beta/route.test.ts`

- [x] **Step 3: Implement the POST route and document configuration**

Return 400 for invalid input, quiet 200 for the honeypot, 429 for source limits,
503 for unavailable configuration or tester delivery failure, and 200 for sent
or already-sent invitations. Add `IOS_TESTFLIGHT_URL`, `RESEND_API_KEY`, and
`CRON_SECRET` descriptions without adding secret values.

- [x] **Step 4: Run the endpoint tests and confirm they pass**

Run: `node --test --experimental-strip-types src/app/api/ios-beta/route.test.ts`

### Task 5: Landing-page dialog and entry points

**Files:**
- Create: `src/components/marketing/IosBetaSignup.tsx`
- Create: `src/lib/iosBeta/client.ts`
- Create: `src/lib/iosBeta/client.test.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Produces: `IosBetaSignup({ placement: "hero" | "platform" }): JSX.Element`
- Consumes: `POST /api/ios-beta`

- [x] **Step 1: Write failing signup-client behavior tests**

Run the signup client against controlled `Response` values. Assert its POST
payload and its stable success, validation, rate-limit, network-failure, and
temporary-unavailability states.

- [x] **Step 2: Run the client tests and confirm they fail on the missing module**

Run: `node --test --experimental-strip-types src/lib/iosBeta/client.test.ts`

- [x] **Step 3: Implement the responsive accessible dialog and both triggers**

Keep the web action primary. Use the hero button copy **Send PongLens to my
iPhone** with **TestFlight beta**, and the platform pill copy **iOS / beta
available / Get access**. Post only `email` and the hidden `company` field,
announce state changes, and preserve the existing Android pill.

- [x] **Step 4: Run the client tests and inspect both real entry points**

Run: `node --test --experimental-strip-types src/lib/iosBeta/client.test.ts`,
then open both triggers in the local page at desktop and 390px widths.

### Task 6: End-to-end verification

**Files:**
- Modify only files required by failures attributable to this feature.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a build-ready iOS beta signup feature awaiting only the production TestFlight URL.

- [x] **Step 1: Run focused tests**

Run: `node --test --experimental-strip-types src/lib/iosBeta/*.test.ts src/app/api/ios-beta/route.test.ts && npm run test:email`

- [x] **Step 2: Run lint**

Run: `npm run lint`

- [x] **Step 3: Run the production build**

Run: `npm run build`

- [x] **Step 4: Inspect desktop and mobile locally**

Open `/`, trigger each CTA, submit an invalid address, and verify the dialog at
desktop width and approximately 390px width. Without `IOS_TESTFLIGHT_URL`,
verify a valid submission shows the temporary-unavailability state without
revealing configuration details.

- [x] **Step 5: Review the final diff against the design**

Run: `git diff --check && git status --short && git diff --stat`
