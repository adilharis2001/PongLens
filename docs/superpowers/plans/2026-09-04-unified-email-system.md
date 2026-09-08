# Unified Adaptive Email System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every current PongLens email shell with one accessible,
adaptive system and provide a safe command that sends a synthetic example of
every template to the administrator's Gmail inbox.

**Architecture:** A pure TypeScript message contract, catalog, and renderer
serve Next.js, the preview sender, and the Supabase Auth Hook. A pure Python
renderer mirrors the contract for the independent worker; parity fixtures keep
the two implementations aligned. Existing trigger, suppression, idempotency,
metering, and delivery-stamp behavior stays at each current send boundary.

**Tech Stack:** TypeScript, Node test runner, Next.js 15, Resend REST API,
Supabase Edge Functions, Python 3.12 `unittest`, HTML email presentation tables

**Spec:** `docs/superpowers/specs/2026-09-04-unified-email-system-design.md`

## Global Constraints

- The authored base is light; supported clients receive the dark token set
  through `prefers-color-scheme: dark`.
- Customer email width is at most `560px`, with `16px` mobile gutters and a
  `44px` minimum primary action height.
- Normal text contrast is at least `4.5:1`; large text is at least `3:1`.
- Dynamic content is escaped and action URLs are allowlisted.
- Every delivery contains explicit HTML and plain text.
- Customer transactional mail uses `PongLens <support@ponglens.com>` with
  `Reply-To: support@ponglens.com`.
- Supabase Auth mail bypasses customer suppression so an address cannot be
  locked out by a previous delivery complaint.
- Existing business transitions never roll back because email delivery fails.
- No customer email BCCs the administrator after the new delivery telemetry is
  in place.
- Product copy uses calm, literal English and contains no em dashes.

---

### Task 1: TypeScript message contract and adaptive renderer

**Files:**
- Create: `src/lib/email/message.ts`
- Create: `src/lib/email/render.ts`
- Create: `src/lib/email/render.test.ts`

**Interfaces:**
- Produces: `EmailMessage`, `EmailBlock`, `RenderedEmail`,
  `renderEmail(message)`, and `isAllowedEmailUrl(url)`.
- Consumes: no database, framework, filesystem, or network API.

- [ ] **Step 1: Write failing renderer boundary tests**

Test a literal message and assert independently derived behavior: escaped
dynamic text, one `h1`, a visible plain-text action URL, light/dark declarations,
presentation-table roles, `lang="en"`, and rejection of a non-allowlisted URL.

```ts
const rendered = renderEmail(sample);
assert.match(rendered.html, /prefers-color-scheme:\s*dark/);
assert.match(rendered.html, /Player &lt;script&gt;/);
assert.doesNotMatch(rendered.html, /Player <script>/);
assert.match(rendered.text, /Open your match\nhttps:\/\/www\.ponglens\.com\/match\/sample/);
assert.throws(() => renderEmail({...sample, action: {
  label: "Open", url: "https://example.com"
}}), /approved PongLens destination/);
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test --experimental-strip-types src/lib/email/render.test.ts`

- [ ] **Step 3: Implement the pure contract and renderer**

Use a discriminated block union for paragraphs, lists, detail rows, compact
item cards, and diagnostics. Escape every value inside the renderer, render the
live-text wordmark, inline light fallbacks, dark selectors, a hidden preheader,
optional action, reason, and support link. Derive plain text from the same
blocks rather than stripping HTML.

```ts
export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "steps"; items: readonly string[] }
  | { type: "details"; rows: readonly { label: string; value: string }[] }
  | { type: "items"; heading?: string; items: readonly EmailItem[] }
  | { type: "diagnostic"; text: string };

export type EmailMessage = {
  templateId: string;
  templateVersion: number;
  category: EmailCategory;
  audience: EmailAudience;
  subject: string;
  preheader: string;
  eyebrow?: string;
  heading: string;
  blocks: readonly EmailBlock[];
  action?: { label: string; url: string };
  reason: string;
  support?: boolean;
};
```

- [ ] **Step 4: Run renderer tests and the email suite**

Run: `node --test --experimental-strip-types src/lib/email/render.test.ts`
Run: `npm run test:email`

- [ ] **Step 5: Commit the renderer**

```bash
git add src/lib/email/message.ts src/lib/email/render.ts src/lib/email/render.test.ts
git commit -m "Build adaptive email renderer"
```

### Task 2: Customer message catalog and fixtures

**Files:**
- Create: `src/lib/email/catalog.ts`
- Create: `src/lib/email/catalog.test.ts`
- Create: `src/lib/email/fixtures.ts`
- Modify: `src/lib/iosBeta/model.ts`
- Modify: `src/lib/iosBeta/model.test.ts`

**Interfaces:**
- Produces: builders for Auth, beta, nine coaching states, and three purchase
  variants; `typescriptEmailFixtures()` returns one deterministic example of
  every TypeScript template state.
- Consumes: `EmailMessage` from Task 1.

- [ ] **Step 1: Write failing catalog tests**

Assert recipient-visible outcomes rather than implementation strings: all
fixture IDs are unique, every fixture renders, coaching subjects name the
relevant person, clarification text never copies the question, purchase
variants explain their distinct grant, and the TestFlight action is the only
Apple invitation URL.

```ts
const fixtures = typescriptEmailFixtures();
assert.equal(new Set(fixtures.map(f => f.message.templateId)).size, fixtures.length);
for (const fixture of fixtures) assert.doesNotThrow(() => renderEmail(fixture.message));
assert.doesNotMatch(renderEmail(clarification).html, /private question text/);
```

- [ ] **Step 2: Run the catalog tests and observe the missing builders**

Run: `node --test --experimental-strip-types src/lib/email/catalog.test.ts`

- [ ] **Step 3: Implement the approved copy catalog**

Create named builders with typed fact objects. Keep all sample identities,
dates, filenames, amounts, and URLs deterministic. Change the existing beta
model functions to return `EmailMessage`; preserve email and TestFlight URL
validation.

- [ ] **Step 4: Run catalog and beta model tests**

Run: `node --test --experimental-strip-types src/lib/email/catalog.test.ts src/lib/iosBeta/model.test.ts`

- [ ] **Step 5: Commit the catalog**

```bash
git add src/lib/email/catalog.ts src/lib/email/catalog.test.ts src/lib/email/fixtures.ts src/lib/iosBeta/model.ts src/lib/iosBeta/model.test.ts
git commit -m "Add unified email copy catalog"
```

### Task 3: Shared Next.js delivery adapter and web migrations

**Files:**
- Create: `src/lib/email/send.ts`
- Create: `src/lib/email/send.test.ts`
- Modify: `src/lib/email/iosBetaEmails.ts`
- Modify: `src/lib/email/purchaseEmails.ts`
- Modify: `src/lib/email/reviewEmails.ts`
- Modify: `src/lib/email/iosBetaEmails.test.ts`

**Interfaces:**
- Produces: `sendTransactionalEmail({ to, message, idempotencyKey,
  operation, suppression, timeoutMs })` returning `sent | suppressed | failed`.
- Consumes: catalog builders and `renderEmail`.

- [ ] **Step 1: Write failing adapter tests**

Inject the fetch, suppression, and metering boundaries. Assert the actual
Resend request contains support sender, reply-to, subject, HTML, plain text,
and template headers; assert suppressed recipients make no fetch; assert a
provider failure returns `failed` without throwing into business state.

- [ ] **Step 2: Run the adapter tests and verify failure**

Run: `node --test --experimental-strip-types src/lib/email/send.test.ts`

- [ ] **Step 3: Implement the adapter and migrate all web senders**

Review and purchase functions continue gathering database facts and retaining
their existing idempotency keys. Beta retains independent invite/admin stamps.
Remove old card HTML, `noreply`, and direct Resend payload construction.

- [ ] **Step 4: Run email, review, and purchase tests**

Run: `npm run test:email`
Run: `npm run test:reviews`
Run: `node --test --experimental-strip-types src/lib/iosBeta/model.test.ts`

- [ ] **Step 5: Commit web migrations**

```bash
git add src/lib/email src/lib/iosBeta
git commit -m "Migrate web emails to shared delivery"
```

### Task 4: Python renderer and worker outcome emails

**Files:**
- Create: `worker/email_templates.py`
- Create: `worker/tests/test_email_templates.py`
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_failure_emails.py`
- Modify: `worker/tests/test_placement_notifications.py`

**Interfaces:**
- Produces: Python `EmailMessage`, `RenderedEmail`, `render_email`, and
  builders for match ready, direct-upload failure, import failure, export
  ready, and admin job failure.
- Consumes: the same normalized block vocabulary and token values as Task 1.

- [ ] **Step 1: Write failing Python renderer and outcome tests**

Assert escaped input, HTML/text parity, adaptive declarations, allowlisted
URLs, and exact safe recovery behavior. Add a parity fixture matching Task 1's
literal sample.

- [ ] **Step 2: Run tests with the worker virtual environment**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_email_templates`

- [ ] **Step 3: Implement Python rendering and migrate worker outcomes**

Change `send_email` to accept a rendered message and include `text`,
`template_id`, and `template_version` metadata. Remove customer BCCs. Preserve
suppression, admin failure routing, idempotency, metering, and the rule that
placement sends no email.

- [ ] **Step 4: Run the complete affected worker email suite**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_email_templates worker.tests.test_failure_emails worker.tests.test_placement_notifications worker.tests.test_qa_closed_digest worker.tests.test_cost_alerts`

- [ ] **Step 5: Commit worker outcomes**

```bash
git add worker/email_templates.py worker/worker.py worker/tests
git commit -m "Migrate worker outcome emails"
```

### Task 5: Digest, cost, and outreach email migrations

**Files:**
- Modify: `worker/email_templates.py`
- Modify: `worker/worker.py`
- Modify: `worker/cost_alerts.py`
- Modify: `worker/tests/test_email_templates.py`
- Modify: `worker/tests/test_qa_closed_digest.py`
- Modify: `worker/tests/test_cost_alerts.py`
- Modify: `scripts/marketing/notify.mjs`
- Modify: `scripts/marketing/notify.test.ts`

**Interfaces:**
- Produces: feedback, QA, cost, and outreach messages using the unified shell.
- Consumes: safe item-card/detail blocks and the existing digest data queries.

- [ ] **Step 1: Extend tests for dense messages**

Use representative feedback, QA reply, coach-search, and cost rows. Assert the
important record links and details remain present in HTML and plain text,
dynamic values are escaped, and dense templates use the `600px` internal cap.

- [ ] **Step 2: Run affected tests and verify the old shells fail**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_email_templates worker.tests.test_qa_closed_digest worker.tests.test_cost_alerts`
Run: `node --test --experimental-strip-types scripts/marketing/notify.test.ts`

- [ ] **Step 3: Replace duplicated digest shells**

Keep existing queries, daily claiming/stamping, sorting, links, and operational
delivery rules. Generate explicit text for every digest and stop using the old
image wordmark and low-contrast footer.

- [ ] **Step 4: Re-run affected Python and marketing tests**

Run the two commands from Step 2 and require zero failures.

- [ ] **Step 5: Commit digest migrations**

```bash
git add worker scripts/marketing
git commit -m "Unify operational email digests"
```

### Task 6: Supabase Send Email Auth Hook

**Files:**
- Create: `supabase/functions/send-email/index.ts`
- Create: `supabase/functions/send-email/index.test.ts`
- Create: `supabase/functions/send-email/deno.json`
- Modify: `tsconfig.json`
- Modify: `supabase/README-SETUP.md`

**Interfaces:**
- Produces: a signed HTTP hook mapping `signup` and `magiclink` payloads to
  catalog messages and Resend deliveries; unknown action types fail closed.
- Consumes: edge-compatible catalog and renderer modules from Tasks 1–2.

- [ ] **Step 1: Write failing pure handler tests**

Inject signature verification and delivery. Assert an invalid signature sends
nothing, signup and magic-link map tokens correctly, secure email change is
rejected until explicitly enabled, Resend receives HTML and text, and provider
failure becomes a non-2xx hook response.

- [ ] **Step 2: Run the Node-side pure handler test and verify failure**

Run: `node --test --experimental-strip-types supabase/functions/send-email/index.test.ts`

- [ ] **Step 3: Implement and document the hook**

Keep Deno startup behind `if (import.meta.main)` so Node tests exercise the
real handler. Verify Standard Webhooks before parsing user fields. Derive a
stable idempotency key from the webhook message ID. Exclude Supabase functions
from Next's `tsconfig` because the Deno `npm:` import map is not part of the web
build.

- [ ] **Step 4: Run hook tests and a local type/load check**

Run: `node --test --experimental-strip-types supabase/functions/send-email/index.test.ts`
Run: `npx supabase functions serve send-email --env-file supabase/functions/send-email/.env.example` only if the local CLI and Docker runtime are available; otherwise record it as unverified and rely on the pure handler test until deployment.

- [ ] **Step 5: Commit the Auth Hook**

```bash
git add supabase/functions/send-email tsconfig.json supabase/README-SETUP.md
git commit -m "Add unified Supabase auth email hook"
```

### Task 7: Preview gallery and complete seed-delivery command

**Files:**
- Create: `scripts/email/preview-catalog.ts`
- Create: `scripts/email/preview-catalog.test.ts`
- Create: `scripts/email/send-preview-catalog.ts`
- Create: `scripts/email/README.md`
- Modify: `package.json`
- Modify: `worker/email_templates.py`

**Interfaces:**
- Produces: `npm run email:preview` for a local HTML gallery and
  `npm run email:send-samples -- --to <approved-admin-address>` for one sample
  of every active template.
- Consumes: TypeScript fixtures and Python fixture JSON emitted by
  `worker/email_templates.py --fixtures-json`.

- [ ] **Step 1: Write failing catalog completeness tests**

Assert the combined catalog has no duplicate IDs, contains every active send
site discovered in the repository, orders messages deterministically, and
refuses a non-admin destination. Assert the preview sender prefixes every
subject with `[Preview n/N]` and gives every request a batch-scoped idempotency
key.

- [ ] **Step 2: Run the preview test and verify failure**

Run: `node --test --experimental-strip-types scripts/email/preview-catalog.test.ts`

- [ ] **Step 3: Implement preview and sending commands**

The gallery writes generated artifacts under ignored `build/email-preview/`.
The sending command requires an explicit `--to`, confirms it is in
`ADMIN_EMAILS`, loads the Resend key from the existing environment or
`openclaw/ponglens-resend-key` Keychain item without printing it, and sends
sequentially with a short timeout. It prints only template ID, provider message
ID, and success/failure.

- [ ] **Step 4: Generate and inspect the gallery at desktop and 393px width**

Run: `npm run email:preview`
Open the generated gallery in the browser and inspect light and dark fixtures.

- [ ] **Step 5: Commit preview tooling**

```bash
git add scripts/email package.json worker/email_templates.py
git commit -m "Add complete email preview catalog"
```

### Task 8: Full verification and controlled Gmail delivery

**Files:**
- Modify only defects found by verification.

**Interfaces:**
- Produces: a clean build, complete automated email suites, and accepted
  preview deliveries to the administrator's Gmail.

- [ ] **Step 1: Run all TypeScript and Python email tests**

Run: `npm run test:email`
Run: `node --test --experimental-strip-types src/lib/iosBeta/model.test.ts scripts/marketing/notify.test.ts scripts/email/preview-catalog.test.ts supabase/functions/send-email/index.test.ts`
Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_email_templates worker.tests.test_failure_emails worker.tests.test_placement_notifications worker.tests.test_qa_closed_digest worker.tests.test_cost_alerts`

- [ ] **Step 2: Run the real production build**

Run: `npm run build`
Expected: exit code 0. Existing unrelated warnings are recorded rather than
described as new failures.

- [ ] **Step 3: Generate the final gallery and inspect responsive layout**

Run: `npm run email:preview`
Inspect at desktop width and `393x660`; ensure no horizontal overflow, exposed
canvas strip, missing identity, or obscured action.

- [ ] **Step 4: Send the full synthetic catalog to Adil's Gmail**

Run: `npm run email:send-samples -- --to adilharis2001@gmail.com`
Expected: every catalog entry receives a Resend message ID and no real product
record is created or changed.

- [ ] **Step 5: Record the outcome without deploying**

Do not enable the Auth Hook, change the production sender, merge, or deploy
until Adil reviews the inbox samples and approves the visual/copy result.

