# Platform Cost Dashboard Design

**Date:** 2026-07-29

## Goal

Give the PongLens owner a trustworthy, platform-wide estimate of operating
costs without requiring invoice imports or per-user attribution. The admin
dashboard must answer:

1. how much PongLens has cost this month;
2. which vendors and services are responsible;
3. what the current month is likely to cost;
4. how complete and fresh each estimate is; and
5. what the platform would cost at 10, 100, or 5,000 users, including a
   synthetic future cloud-compute worker.

The dashboard is available only to `adilharis2001@gmail.com`. It never exposes
cost data, management credentials, or provider responses to ordinary users.

## Scope

The first release covers:

- OpenAI token usage for every production OpenAI call;
- Deepgram transcription duration;
- Cloudflare R2 storage, Class A operations, and Class B operations;
- successful Resend email recipients;
- measured Mac worker stage runtime and a separately priced synthetic cloud
  worker;
- manually configurable Vercel and Supabase usage estimates until provider
  reconciliation is configured;
- effective-dated pricing;
- daily and monthly platform totals;
- provider breakdowns;
- projection and scale simulation;
- optional provider-reported reconciliation snapshots; and
- credential-health and data-confidence states.

The first release does not:

- allocate cost to a user, match, coach, or team;
- reconcile invoices, taxes, credits, negotiated discounts, or account
  balances;
- place provider management credentials in Postgres or the browser;
- make usage-meter writes part of a user-facing operation's success path; or
- choose or provision a future cloud-compute vendor.

Fixed monthly subscriptions are supported by the data model and simulator but
may be entered later.

## Chosen Architecture

An internal usage meter is the canonical source of estimated cost. Each
billable action records a small, anonymous usage event. An effective-dated
price catalog converts quantities into USD. Provider usage APIs are optional
reconciliation inputs and are displayed separately; they never get added to
the internal estimate and therefore cannot double-count spend.

```text
application and worker operations
        |
        v
anonymous usage events -----> effective-dated prices
        |                              |
        +------------------------------+
                       |
                       v
              daily cost rollups
                       |
             +---------+----------+
             |                    |
             v                    v
       owner dashboard      scale simulator

provider usage APIs -------> reconciliation snapshots
```

## Data Model

### `public.cost_usage_events`

One row represents one measured billable quantity:

```text
id                  uuid primary key
occurred_at         timestamptz
provider            text
service             text
operation           text
sku                  text
quantity             numeric
unit                 text
source               internal | provider
idempotency_key      text unique
metadata             jsonb
created_at           timestamptz
```

Events deliberately contain no `user_id`, `match_id`, email address, filename,
R2 key, transcript, prompt, or model output. `metadata` is restricted to
non-identifying billing dimensions such as cached-token count, request count,
compute stage, or R2 storage class.

Initial units are:

- `input_token`
- `cached_input_token`
- `output_token`
- `audio_second`
- `gb_month`
- `class_a_operation`
- `class_b_operation`
- `email_recipient`
- `compute_second`
- `request`
- `monthly_subscription`

Usage events are append-only to authenticated clients. Only the service role
and narrowly scoped security-definer functions can insert them. Ordinary
authenticated users have no select access.

### `public.cost_rates`

```text
id                  uuid primary key
provider            text
service             text
sku                  text
unit                 text
price_per_unit_usd  numeric
included_units      numeric
effective_from      timestamptz
effective_to        timestamptz nullable
source_url           text
source_label         text
created_at           timestamptz
```

The applicable rate is the row matching provider, SKU, unit, and event time.
Rate intervals cannot overlap for the same billing dimension. Rates are never
updated in place after they have been used; a changed vendor price closes the
old interval and creates a new one.

The seed catalog includes the exact production SKUs:

- OpenAI `gpt-5-nano` input, cached input, and output tokens;
- OpenAI `gpt-5-mini` input, cached input, and output tokens;
- Deepgram `nova-3` prerecorded audio seconds;
- Cloudflare R2 Standard GB-month, Class A, and Class B operations;
- Resend email recipients with a zero variable rate until a paid tier is
  configured; and
- a configurable `cloud-worker-medium-high` compute-second rate.

All seeded vendor rates include an official source URL and an as-of date.

### `public.cost_fixed_items`

Supports later fixed subscriptions without changing the dashboard:

```text
id                  uuid primary key
provider            text
label                text
monthly_cost_usd     numeric
effective_from       date
effective_to         date nullable
enabled              boolean
created_at           timestamptz
updated_at           timestamptz
```

Only the owner can read or edit these rows through owner-checked RPCs.

### `public.cost_provider_snapshots`

Stores optional provider-reported totals:

```text
id                  uuid primary key
provider            text
period_start         timestamptz
period_end           timestamptz
reported_cost_usd    numeric nullable
usage                jsonb
status               success | error
error_code           text nullable
fetched_at           timestamptz
unique(provider, period_start, period_end)
```

`usage` contains aggregate billing dimensions only. Secrets and raw
request-level payloads are not persisted.

### Database reporting function

An owner-only security-definer function:

```sql
public.get_platform_cost_dashboard(
  p_start timestamptz,
  p_end timestamptz
) returns jsonb
```

checks `public.is_admin()` and returns one compact payload containing:

- period total and current-month total;
- daily cost series;
- provider totals;
- service totals;
- usage quantities and the rate applied;
- fixed items;
- provider reconciliation snapshots;
- unmapped usage dimensions;
- first and last event timestamps; and
- last provider synchronization timestamps.

Pricing and aggregation are performed in Postgres so the browser does not
receive raw usage events and all dashboard surfaces share one calculation.

## Metering Interfaces

### Next.js meter

`src/lib/costs/meter.ts` exposes a best-effort server-only interface:

```ts
type UsageEvent = {
  occurredAt?: string;
  provider: string;
  service: string;
  operation: string;
  sku: string;
  quantity: number;
  unit: CostUnit;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean>;
};

export async function recordUsage(events: UsageEvent[]): Promise<void>;
export function openAIUsageEvents(args: OpenAIUsageArgs): UsageEvent[];
```

`recordUsage` catches and logs insertion failures. A provider request that
succeeded remains successful even when its cost event cannot be recorded.

Every Next.js OpenAI route records the response's input, cached-input, and
output token counts. Deepgram records exact billed duration when supplied by
the response and otherwise the uploaded media duration. Resend records
successful recipients. R2 helper methods record one operation only after the
provider operation succeeds.

### Python worker meter

`worker/cost_meter.py` provides:

```python
record_usage(events: list[dict]) -> None
timed_compute(stage: str, idempotency_key: str)
openai_usage_events(response, *, operation: str, idempotency_key: str)
```

It uses the existing Supabase service-role connection. Failures are logged and
swallowed. Worker events use stable job/stage/request identifiers only in the
idempotency key; those identifiers are not copied into event metadata or
returned to the dashboard.

The worker meters:

- OpenAI content validation;
- conditional YouTube metadata extraction;
- BlurBall inference runtime;
- pure-cut encoding runtime;
- point-clip encoding runtime;
- thumbnail and upload runtime where separately measurable; and
- reel encoding runtime.

Compute time is shown as measured usage but costs `$0` in the actual-spend
total while the Mac remains owner-operated. The simulator can reprice the same
seconds using the synthetic cloud-worker rate.

### Storage snapshots

R2 storage is a time-weighted quantity rather than an upload-event cost. A
daily worker task records the aggregate bytes stored in both production
buckets. The dashboard converts daily byte snapshots into GB-month using the
vendor's billing convention. Internal R2 operation events supplement the
snapshot.

Existing `storage_ledger` data is used as an initial historical estimate.
Current bucket totals are used to correct the baseline because the ledger does
not cover every prefix.

## Provider Reconciliation

Provider adapters run independently from metering. Each adapter has a
bounded date range, timeout, cursor, and idempotent upsert. One provider's
failure cannot block another provider or the dashboard.

Initial adapters:

- OpenAI organization Usage and Costs APIs;
- Deepgram project usage/request-cost APIs;
- Cloudflare GraphQL R2 analytics;
- Vercel Billing Charges API; and
- Supabase Management API usage endpoints.

Resend remains internally metered because no dependable billing-cost endpoint
is required for the first release.

Reconciliation credentials live in macOS Keychain:

```text
PONGLENS_OPENAI_ADMIN_KEY
PONGLENS_DEEPGRAM_USAGE_KEY
PONGLENS_CLOUDFLARE_ANALYTICS_TOKEN
PONGLENS_VERCEL_ACCESS_TOKEN
PONGLENS_SUPABASE_MANAGEMENT_TOKEN
```

Additional non-secret identifiers such as organization, project, account, and
team IDs may be stored in the existing worker configuration. Management
credentials are never stored in Postgres, sent to Vercel, or exposed to the
browser unless a future deployment design explicitly changes that boundary.

## Dashboard

The existing `/admin` page gains a Cost section visible only after the current
server-side admin check succeeds. The database function independently checks
`public.is_admin()`.

The section contains:

1. **Summary**
   - estimated month-to-date spend;
   - projected month-end spend based on the trailing seven-day daily average;
   - trailing 7-day and 30-day spend;
   - synthetic cloud-compute cost shown separately.
2. **Daily trend**
   - one line for estimated total;
   - optional stacked vendor view;
   - selectable 7-day, 30-day, current-month, and 90-day windows.
3. **Vendor breakdown**
   - vendor;
   - estimated cost;
   - share of total;
   - primary usage quantities;
   - data-confidence badge; and
   - last updated time.
4. **Data health**
   - latest internal event;
   - latest storage snapshot;
   - provider sync state;
   - unmapped usage or missing rates; and
   - discrepancy between internal and provider-reported cost.
5. **Scale simulator**
   - preset user counts of 10, 100, and 5,000 plus a custom value;
   - active-user percentage;
   - matches per active user per month;
   - average uploaded video minutes;
   - average points per match;
   - voice-note minutes per active user;
   - AI-note operations per active user;
   - retained GB per active user;
   - dashboard activity multiplier;
   - cloud-worker hourly price;
   - cloud-worker utilization; and
   - optional fixed monthly costs.

Simulation results include monthly total, cost per registered user, cost per
active user, cost per match, vendor breakdown, and cloud-compute share.

The simulator is deterministic and runs in the browser from aggregate
baseline coefficients returned by the owner-only RPC. It does not save or
inspect individual-user behavior.

## Simulation Model

The default baseline is computed from platform-wide historical usage:

```text
usage per active user
usage per completed match
usage per uploaded video minute
usage per retained GB
usage per voice minute
usage per AI note operation
```

The selected scenario multiplies those coefficients by the requested scale
and applies the current rate catalog. Compute uses measured stage seconds per
video minute and per point. A utilization factor accounts for paid idle time:

```text
monthly paid compute hours =
  workload compute hours / utilization
```

Utilization is bounded to `(0, 1]`. The result is explicitly labeled
“synthetic cloud compute,” never mixed into historical actual spend.

If a coefficient has no observed data, the simulator uses a documented
conservative default and marks that row `assumed`.

## Accuracy and Confidence

Every vendor row receives one of:

- `metered`: based on complete internal provider response usage;
- `estimated`: based on measured activity and a published rate;
- `provider-reported`: a separately displayed reconciliation value;
- `assumed`: based on a simulator default or manually entered quantity; or
- `stale`: the source has not updated within its expected interval.

The UI displays the pricing effective date and official source link. Missing
rates appear as a visible data-health issue and contribute `$0` rather than
silently using an unrelated rate.

Free tiers are applied at the provider/month level after aggregating usage,
not per event. Provider rounding is modeled where it materially affects the
estimate. Promotional credits and taxes are intentionally excluded.

## Security

- The browser never receives service-role keys or provider credentials.
- Admin access is checked both in Next.js and inside reporting/edit RPCs.
- Cost tables have RLS enabled with no ordinary-user policies.
- Internal insertion is service-role only.
- Fixed-item updates use an owner-checked function rather than direct table
  writes.
- Provider snapshots store aggregate values only.
- Logs redact credentials and provider response bodies.
- API and RPC date ranges are bounded to prevent unbounded reporting queries.

## Failure Handling

- Usage-meter failure is non-fatal and logged.
- Duplicate events are ignored by `idempotency_key`.
- Invalid, negative, NaN, or infinite quantities are rejected.
- Unknown units or SKUs are retained as unmapped usage and surfaced in Data
  Health.
- Provider adapters use timeouts and store a sanitized error code.
- A stale reconciliation source never suppresses internal estimates.
- Dashboard loading errors affect only the Cost section, not the rest of the
  admin portal.

## Migration and Backfill

The feature starts with a one-time aggregate backfill:

- R2 current bucket size and historical `storage_ledger` changes;
- existing `ai_usage` page and image counts as `assumed` usage where exact
  tokens are unavailable;
- completed worker logs for content-check tokens and compute-stage timings
  when parseable; and
- existing completed-job counts for simulator coefficients.

Backfilled rows use a dedicated `backfill:` idempotency prefix and are labeled
`estimated` or `assumed`. The backfill never fabricates exact token counts for
calls whose response usage was not retained.

## Testing

The implementation requires:

- SQL contract tests for RLS, admin checks, rate interval behavior, free tiers,
  fixed costs, idempotency, and aggregation;
- TypeScript unit tests for OpenAI usage parsing, Deepgram duration parsing,
  R2 operation classification, projections, and simulations;
- Python unit tests for worker event creation, stage timing, failure swallowing,
  and idempotency;
- route tests proving metering failure does not change successful API
  responses;
- admin UI tests for access denial, empty state, stale state, provider totals,
  and simulator presets; and
- production build, lint, focused Node tests, and focused Python tests before
  completion.

## Delivery Order

1. schema, rates, RLS, and owner reporting RPC;
2. shared TypeScript cost calculation and simulation library;
3. owner-only dashboard UI;
4. Next.js OpenAI, Deepgram, R2, and email instrumentation;
5. Python worker AI and compute instrumentation;
6. aggregate historical backfill;
7. provider reconciliation adapters and credential setup guide; and
8. end-to-end verification.

