# Platform Cost Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an owner-only, platform-wide operating-cost dashboard with anonymous internal usage metering, versioned prices, provider totals, and a future cloud-compute scale simulator.

**Architecture:** Append anonymous billable quantities to a service-owned usage table, apply effective-dated rates inside an admin-only Postgres reporting function, and render the resulting aggregate payload in the existing admin portal. Instrument the existing Next.js and Python provider boundaries best-effort so metering can never fail a customer operation; keep provider-reported reconciliation separate from the canonical internal estimate.

**Tech Stack:** PostgreSQL/Supabase RLS and security-definer RPCs, Next.js 15 App Router, React 19, TypeScript with Node's built-in test runner, Python 3 worker with unittest, Cloudflare R2 S3 API, OpenAI Chat Completions, Deepgram REST, Resend REST.

## Global Constraints

- Cost data is platform-wide only; no user, match, coach, or team attribution.
- Only `adilharis2001@gmail.com` may read dashboard data or change cost settings.
- Usage events contain no PII, prompts, transcripts, filenames, object keys, or model output.
- Metering is best-effort and must never change a successful product operation into a failure.
- Duplicate provider retries must not double-count usage.
- Prices are effective-dated and sourced; historical rates are never overwritten.
- Provider reconciliation is displayed separately and never added to internal estimates.
- Synthetic cloud compute is never included in historical actual spend.
- Missing rates remain visible as unmapped usage and contribute `$0`.
- The first release works without any provider management credentials.

---

### Task 1: Cost Schema, Rate Catalog, and Owner Reporting RPC

**Files:**
- Create: `supabase/migrations/050_platform_costs.sql`
- Create: `src/lib/costs/costMigration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public.is_admin()` from `010_quotas.sql`, service-role inserts, and authenticated owner RPC calls.
- Produces: `cost_usage_events`, `cost_rates`, `cost_fixed_items`, `cost_provider_snapshots`, `record_cost_usage`, `get_platform_cost_dashboard`, and `admin_upsert_cost_fixed_item`.

- [ ] **Step 1: Write the failing migration contract tests**

Create `src/lib/costs/costMigration.test.ts` to read migration `050` and assert:

```ts
test("cost tables are private and usage is idempotent", () => {
  for (const table of [
    "cost_usage_events",
    "cost_rates",
    "cost_fixed_items",
    "cost_provider_snapshots",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  assert.match(sql, /idempotency_key text not null unique/);
  assert.match(sql, /quantity numeric not null check \(quantity >= 0\)/);
});

test("dashboard RPC rechecks owner and applies effective-dated rates", () => {
  assert.match(sql, /create or replace function public\.get_platform_cost_dashboard/);
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.match(sql, /r\.effective_from <= e\.occurred_at/);
  assert.match(sql, /r\.effective_to is null or e\.occurred_at < r\.effective_to/);
});

test("seed rates cover every production vendor SKU", () => {
  for (const sku of ["gpt-5-nano", "gpt-5-mini", "nova-3", "r2-standard"]) {
    assert.match(sql, new RegExp(`'${sku}'`));
  }
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test --experimental-strip-types src/lib/costs/costMigration.test.ts
```

Expected: `ENOENT` for `050_platform_costs.sql`.

- [ ] **Step 3: Implement the migration**

Create the four tables and constraints from the design. Add a single service
insertion function:

```sql
create or replace function public.record_cost_usage(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into public.cost_usage_events (
    occurred_at, provider, service, operation, sku,
    quantity, unit, source, idempotency_key, metadata
  )
  select
    coalesce((x->>'occurred_at')::timestamptz, now()),
    x->>'provider', x->>'service', x->>'operation', x->>'sku',
    (x->>'quantity')::numeric, x->>'unit',
    coalesce(x->>'source', 'internal'), x->>'idempotency_key',
    coalesce(x->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_events) x
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
```

Validate allowed units, source values, finite nonnegative quantities, short
billing labels, and a metadata key allowlist. Revoke table access from
`anon`/`authenticated`; grant owner RPC execution only.

Seed rates effective `2026-07-29` with official source URLs:

```text
OpenAI gpt-5-nano: input $0.05/M, cached $0.005/M, output $0.40/M
OpenAI gpt-5-mini: input $0.25/M, cached $0.025/M, output $2.00/M
Deepgram nova-3 prerecorded monolingual: $0.0077/minute
R2 Standard: $0.015/GB-month, $4.50/M Class A, $0.36/M Class B
R2 monthly free tier: 10 GB-month, 1M Class A, 10M Class B
Resend recipient and Mac compute: $0 variable rate
Synthetic cloud worker: editable default $1.50/hour
```

The dashboard RPC must aggregate event quantities before applying monthly
included units, return daily/provider/service arrays, fixed monthly proration,
unmapped dimensions, confidence/freshness timestamps, and aggregate simulation
coefficients derived from completed jobs, matches, points, voice usage, AI
usage, storage bytes, and compute events.

- [ ] **Step 4: Run the migration tests and confirm GREEN**

Run:

```bash
npm run test:costs
```

Expected: all cost migration tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/costs/costMigration.test.ts supabase/migrations/050_platform_costs.sql
git commit -m "feat: add platform cost accounting schema"
```

---

### Task 2: Pure Cost Types, Projection, and Scale Simulation

**Files:**
- Create: `src/lib/costs/types.ts`
- Create: `src/lib/costs/calculations.ts`
- Create: `src/lib/costs/calculations.test.ts`

**Interfaces:**
- Consumes: aggregate JSON returned by `get_platform_cost_dashboard`.
- Produces: `CostDashboardData`, `projectMonthEnd`, `simulatePlatformCost`, formatting helpers, and dashboard view models.

- [ ] **Step 1: Write failing calculation tests**

Cover:

```ts
test("month projection uses the trailing seven complete days");
test("simulation presets scale variable usage without scaling fixed items");
test("cloud paid hours divide workload by bounded utilization");
test("historical total excludes synthetic compute");
test("missing coefficients remain assumed and visible");
test("currency formatting preserves sub-cent costs");
```

Use a fixture with two vendors, one fixed item, and compute seconds so exact
expected totals can be asserted.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node --test --experimental-strip-types src/lib/costs/calculations.test.ts
```

Expected: module-not-found for `calculations.ts`.

- [ ] **Step 3: Implement pure types and calculations**

Define:

```ts
export interface SimulationInputs {
  registeredUsers: number;
  activeUserRate: number;
  matchesPerActiveUser: number;
  videoMinutesPerMatch: number;
  pointsPerMatch: number;
  voiceMinutesPerActiveUser: number;
  aiNotesPerActiveUser: number;
  retainedGbPerActiveUser: number;
  dashboardActivityMultiplier: number;
  cloudWorkerHourlyUsd: number;
  cloudWorkerUtilization: number;
  includeFixedCosts: boolean;
}

export interface SimulationResult {
  monthlyTotalUsd: number;
  costPerRegisteredUserUsd: number;
  costPerActiveUserUsd: number;
  costPerMatchUsd: number;
  syntheticComputeUsd: number;
  byProvider: { provider: string; costUsd: number; confidence: string }[];
}
```

Clamp percentages to `(0, 1]`, counts to nonnegative finite values, and user
counts to `1..1_000_000`. Keep functions deterministic and browser-safe.

- [ ] **Step 4: Run tests and confirm GREEN**

Run `npm run test:costs`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/costs package.json
git commit -m "feat: add platform cost projections and simulator"
```

---

### Task 3: Owner-Only Cost Dashboard UI

**Files:**
- Create: `src/app/admin/CostDashboardSection.tsx`
- Create: `src/app/admin/costDashboardView.ts`
- Create: `src/app/admin/costDashboardView.test.ts`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `supabase.rpc("get_platform_cost_dashboard", { p_start, p_end })` and pure calculation functions.
- Produces: summary cards, daily trend, vendor table, data-health panel, and scale simulator within `/admin`.

- [ ] **Step 1: Write failing view-model tests**

Test:

```ts
test("vendor rows sort by descending estimated cost");
test("stale sources are surfaced without hiding their estimate");
test("provider reconciliation is never added to internal total");
test("10 100 and 5000 user presets produce labeled scenarios");
test("empty data produces a ready-to-meter state");
```

- [ ] **Step 2: Run and confirm RED**

Run `npm run test:costs`; expect missing `costDashboardView.ts`.

- [ ] **Step 3: Implement the client section**

Follow existing admin styling:

- summary cards in a responsive grid;
- CSS-only SVG/polyline daily trend with accessible tabular fallback;
- vendor rows with estimated cost, share, usage summary, confidence, and
  updated time;
- range controls for 7, 30, month-to-date, and 90 days;
- credential/data health without exposing secret values;
- simulator inputs with preset buttons and immediate deterministic results;
- loading, empty, stale, and RPC-error states local to this section.

Do not add a chart dependency.

- [ ] **Step 4: Mount it in the existing admin page**

Import `CostDashboardSection`, update the intro copy to mention platform costs,
and place Cost first because it is the owner's primary operational view. Keep
the existing email redirect and database security boundary unchanged.

- [ ] **Step 5: Run tests, lint, and build**

```bash
npm run test:costs
npm run lint
npm run build
```

Expected: tests and build pass; no new lint warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin
git commit -m "feat: add owner platform cost dashboard"
```

---

### Task 4: Best-Effort Next.js Usage Meter and OpenAI Instrumentation

**Files:**
- Create: `src/lib/costs/meter.ts`
- Create: `src/lib/costs/meter.test.ts`
- Modify: `src/app/api/lesson/route.ts`
- Modify: `src/app/api/journal-ocr/route.ts`
- Modify: `src/app/api/entry-image/route.ts`
- Modify: `src/app/api/feedback/assist/route.ts`

**Interfaces:**
- Consumes: OpenAI Chat Completions response `usage` objects and the service-role Supabase REST endpoint.
- Produces: anonymous token events through `recordUsage` and `openAIUsageEvents`.

- [ ] **Step 1: Write failing meter tests**

Test exact parsing of:

```json
{
  "prompt_tokens": 100,
  "completion_tokens": 20,
  "prompt_tokens_details": { "cached_tokens": 40 }
}
```

Expected events are 60 noncached input tokens, 40 cached input tokens, and 20
output tokens. Also assert invalid quantities are dropped, metadata rejects
PII-like keys, stable idempotency suffixes differ per token class, and an
insert rejection resolves without throwing.

- [ ] **Step 2: Run and confirm RED**

Run `npm run test:costs`; expect missing meter module.

- [ ] **Step 3: Implement the server-only meter**

Use a dedicated Supabase client created from
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. If the service role is
not configured, log once per process and return. Never accept user-provided
metadata. Call `record_cost_usage` with a bounded array of normalized events.

- [ ] **Step 4: Instrument every Next.js OpenAI response**

After each successful `res.json()`, call:

```ts
void recordUsage(openAIUsageEvents({
  usage: data.usage,
  model: MODEL,
  operation: "lesson_summary",
  idempotencyKey: `openai:${data.id}:lesson_summary`,
}));
```

Use operation names `lesson_summary`, `journal_ocr`, `entry_image_validation`,
and `feedback_triage`. For OCR, one response ID per page naturally prevents
double counting. The meter call must not be awaited by response-critical
logic beyond the best-effort recorder's own bounded request.

- [ ] **Step 5: Run tests and build**

Run `npm run test:costs && npm run lint && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/costs src/app/api
git commit -m "feat: meter Next.js OpenAI usage"
```

---

### Task 5: Deepgram, R2, and Email Metering

**Files:**
- Modify: `src/lib/costs/meter.ts`
- Modify: `src/lib/costs/meter.test.ts`
- Modify: `src/app/api/transcribe/route.ts`
- Modify: `src/lib/r2.ts`
- Create: `src/lib/costs/r2Operations.ts`
- Create: `src/lib/costs/r2Operations.test.ts`

**Interfaces:**
- Consumes: Deepgram `metadata.duration`, successful R2 helper operations, and successful email responses.
- Produces: `audio_second`, `class_a_operation`, `class_b_operation`, and `email_recipient` events.

- [ ] **Step 1: Add failing Deepgram and R2 classification tests**

Assert:

```text
PutObject, CreateMultipartUpload, UploadPart, CompleteMultipartUpload -> Class A
ListParts, ListObjects, HeadObject, GetObject -> Class B
DeleteObject and AbortMultipartUpload -> no billable event
Deepgram metadata.duration -> audio seconds
```

- [ ] **Step 2: Run and confirm RED**

Run `npm run test:costs`; expect missing helpers.

- [ ] **Step 3: Instrument Deepgram**

Record `dg.metadata.duration` as `audio_second` with SKU `nova-3`. If duration
is unavailable, derive duration only when the media container provides it;
otherwise surface a `request` event with no fabricated seconds.

- [ ] **Step 4: Instrument R2 helpers**

Meter completed server-side operations and the creation of presigned
operations. Presigned PUT/GET events represent an authorized operation and
may be marked `estimated` because the browser might not use the URL. Multipart
parts use their unique upload ID and part number for idempotency. Never put
bucket names or object keys in metadata.

- [ ] **Step 5: Run tests and build**

Run `npm run test:costs && npm run lint && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/costs src/lib/r2.ts src/app/api/transcribe/route.ts
git commit -m "feat: meter transcription and R2 usage"
```

---

### Task 6: Python Worker AI, Compute, R2, and Email Metering

**Files:**
- Create: `worker/cost_meter.py`
- Create: `worker/tests/test_cost_meter.py`
- Modify: `worker/worker.py`
- Modify: `worker/README.md`

**Interfaces:**
- Consumes: existing worker Postgres connection, OpenAI response usage, timed pipeline boundaries, boto3 responses, and Resend success.
- Produces: best-effort service-owned usage events with stable idempotency.

- [ ] **Step 1: Write failing standalone worker meter tests**

Use only the standard library and mocks. Cover OpenAI usage parsing, no PII in
metadata, elapsed-stage timing, duplicate-safe keys, nonfinite quantity
rejection, and database exceptions being logged but swallowed.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
python3 -m unittest worker.tests.test_cost_meter
```

Expected: module-not-found for `worker.cost_meter`.

- [ ] **Step 3: Implement the independent worker meter**

Keep database insertion injectable so tests do not import `worker.py` or
require boto3/OpenCV. `CostMeter.record()` calls `public.record_cost_usage`
through the existing psycopg2 connection. `timed_stage()` records elapsed
seconds in `finally` only when a stage actually started.

- [ ] **Step 4: Instrument worker boundaries**

Add usage events for:

- OpenAI video content validation from returned token usage;
- OpenAI YouTube metadata parsing;
- BlurBall subprocess elapsed seconds;
- pure-cut elapsed seconds;
- points pipeline elapsed seconds;
- reel encoding elapsed seconds;
- successful worker R2 uploads/downloads as Class A/B;
- successful Resend recipients.

Reuse current job/stage/request IDs only to create a one-way stable hash for
the idempotency key. Do not persist raw IDs in metadata.

- [ ] **Step 5: Document worker metering**

Explain that `SUPABASE_SERVICE_ROLE_KEY` is already sufficient for event
insertion, metering is fail-open, and no provider management key is required
for the dashboard.

- [ ] **Step 6: Run focused tests**

```bash
python3 -m unittest worker.tests.test_cost_meter
```

Also run existing worker tests in the documented production Python
environment when its dependencies are available. Record the current local
environment limitation if the native suite still cannot import boto3/OpenCV.

- [ ] **Step 7: Commit**

```bash
git add worker
git commit -m "feat: meter worker AI and compute usage"
```

---

### Task 7: Storage Snapshot, Provider Reconciliation, and Credential Guide

**Files:**
- Create: `worker/cost_reconcile.py`
- Create: `worker/tests/test_cost_reconcile.py`
- Modify: `worker/worker.py`
- Create: `docs/platform-cost-credentials.md`

**Interfaces:**
- Consumes: macOS Keychain credentials, OpenAI Usage/Costs, Deepgram project usage, Cloudflare GraphQL Analytics, Vercel Billing Charges, Supabase Management usage, and R2 bucket listings.
- Produces: daily storage usage events and `cost_provider_snapshots`.

- [ ] **Step 1: Write failing adapter parsing tests**

Use saved minimal JSON fixtures in test code for each provider. Assert date
window normalization, aggregate-only snapshot payloads, timeout/error codes,
and that reported cost never creates an internal usage event.

- [ ] **Step 2: Run and confirm RED**

Run `python3 -m unittest worker.tests.test_cost_reconcile`; expect missing
module.

- [ ] **Step 3: Implement credential-optional adapters**

Each adapter:

- is skipped when its key or required ID is absent;
- uses a 15-second timeout;
- requests only the previous complete UTC day;
- strips request IDs and PII before persistence;
- upserts by provider and period;
- stores a sanitized error code on failure; and
- cannot raise into the worker loop.

Add R2 bucket-size collection independent of Cloudflare Analytics so actual
storage estimation works with the existing R2 S3 credentials.

- [ ] **Step 4: Schedule daily reconciliation**

Call the reconciliation runner from the existing daily cleanup cadence after
retention cleanup. A failure must not delay queue polling.

- [ ] **Step 5: Write the exact credential setup guide**

Document console steps, least-privilege scopes, Keychain commands, and
verification commands for:

```text
OpenAI organization Admin key
Deepgram project key with usage:read
Cloudflare token with Account Analytics:Read
Vercel access token plus Team ID
Supabase fine-grained token with analytics_usage_read
```

Explicitly state that none are required to launch the internal dashboard.

- [ ] **Step 6: Run tests**

Run:

```bash
python3 -m unittest worker.tests.test_cost_meter worker.tests.test_cost_reconcile
```

- [ ] **Step 7: Commit**

```bash
git add worker docs/platform-cost-credentials.md
git commit -m "feat: add cost reconciliation and storage snapshots"
```

---

### Task 8: Historical Aggregate Backfill and Final Verification

**Files:**
- Create: `worker/backfill_cost_usage.py`
- Create: `worker/tests/test_backfill_cost_usage.py`
- Modify: `docs/platform-cost-credentials.md`

**Interfaces:**
- Consumes: `storage_ledger`, current R2 totals, `ai_usage`, completed jobs and matches, points, and parseable worker log aggregates.
- Produces: idempotent `backfill:` usage events and documented backfill execution.

- [ ] **Step 1: Write failing backfill transformation tests**

Test that:

- current R2 size corrects but does not double-count the storage-ledger
  baseline;
- AI counts with no token usage are labeled assumed and never fabricated as
  tokens;
- parseable worker token lines create aggregate events;
- rerunning produces identical idempotency keys; and
- no source record identifiers appear in metadata.

- [ ] **Step 2: Run and confirm RED**

Run `python3 -m unittest worker.tests.test_backfill_cost_usage`; expect missing
module.

- [ ] **Step 3: Implement dry-run-first backfill**

Default behavior prints aggregate counts and dollar estimates without writes.
`--apply` inserts events in batches of 250 through `record_cost_usage`.
`--start` and `--end` bound source dates. The script never reads or emits
prompt, transcript, filename, or user content.

- [ ] **Step 4: Run all focused tests**

```bash
npm run test:costs
npm run test:auth
npm run test:learn
npm run test:placement
npm run test:research
python3 -m unittest \
  worker.tests.test_cost_meter \
  worker.tests.test_cost_reconcile \
  worker.tests.test_backfill_cost_usage
```

- [ ] **Step 5: Run static and production verification**

```bash
npm run lint
npm run build
git diff --check
git status --short
```

Expected: no test or build failures, no new lint warnings, and only intended
feature files changed.

- [ ] **Step 6: Perform security review**

Search for prohibited fields and credential exposure:

```bash
rg -n "user_id|match_id|email|prompt|transcript|object_key|api_key" \
  src/lib/costs src/app/admin worker/cost_*.py worker/backfill_cost_usage.py
```

Review every match; types and input-source queries may mention a prohibited
field, but no persisted event metadata or dashboard payload may contain one.

- [ ] **Step 7: Commit**

```bash
git add worker docs
git commit -m "feat: backfill aggregate platform cost usage"
```
