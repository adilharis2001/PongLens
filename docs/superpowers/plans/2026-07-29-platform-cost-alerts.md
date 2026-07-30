# Platform Cost Threshold Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the PongLens owner once for every $100 of internally metered month-to-date platform spend.

**Architecture:** A private Supabase delivery ledger and trusted database functions calculate month-to-date spend, atomically claim crossed thresholds, and record delivery outcomes. A focused Python module renders and delivers alerts through the existing Resend sender, while the worker invokes it once per minute without blocking video jobs.

**Tech Stack:** PostgreSQL/Supabase migrations, Python 3.12 worker, Resend, Node migration-contract tests, Python unittest.

## Global Constraints

- Thresholds are $100, $200, $300, and every additional $100.
- The ladder resets at 00:00 UTC on the first day of each month.
- Internally metered variable costs and effective-dated fixed costs count.
- Provider reconciliation and synthetic compute do not count.
- Every crossed threshold receives its own email.
- Failed email delivery remains retryable; successful delivery is never duplicated.
- The alert recipient is `adilharis2001@gmail.com`.

---

### Task 1: Private monthly alert ledger

**Files:**
- Create: `supabase/migrations/055_platform_cost_alerts.sql`
- Modify: `src/lib/costs/costMigration.test.ts`

**Interfaces:**
- Produces: `public.claim_platform_cost_alert(numeric, timestamptz) returns jsonb`
- Produces: `public.complete_platform_cost_alert(uuid, boolean, text) returns void`
- Stores: `public.platform_cost_alert_deliveries`

- [ ] **Step 1: Write failing migration contract tests**

Add tests that load migration 055 and assert:

```ts
assert.match(alertSql, /create table public\.platform_cost_alert_deliveries/);
assert.match(alertSql, /unique \(period_start, threshold_usd\)/);
assert.match(alertSql, /enable row level security/);
assert.match(alertSql, /revoke all on public\.platform_cost_alert_deliveries/);
assert.match(alertSql, /create or replace function public\.claim_platform_cost_alert/);
assert.match(alertSql, /provider_costs/);
assert.match(alertSql, /for update skip locked/);
assert.match(alertSql, /create or replace function public\.complete_platform_cost_alert/);
```

- [ ] **Step 2: Run the cost tests and confirm RED**

Run: `npm run test:costs`

Expected: failure because migration 055 does not exist.

- [ ] **Step 3: Implement migration 055**

Create a private ledger with `pending`, `sending`, and `sent` states, a five-minute claim lease, attempt count, sanitized error code, observed spend, and aggregate provider totals. Implement a service-role-only claim function that:

1. Calculates UTC month-to-date priced usage using the existing rate and included-unit logic.
2. Adds prorated fixed daily costs.
3. Inserts every missing threshold at or below current spend.
4. Requeues expired claims.
5. Atomically claims the lowest pending threshold with `for update skip locked`.
6. Returns one aggregate JSON alert or `null`.

Implement a completion function that marks success as `sent` or returns failure to `pending`.

- [ ] **Step 4: Run cost tests and confirm GREEN**

Run: `npm run test:costs`

Expected: all tests pass.

### Task 2: Alert delivery module

**Files:**
- Create: `worker/cost_alerts.py`
- Create: `worker/tests/test_cost_alerts.py`

**Interfaces:**
- Produces: `PostgresCostAlertStore(connection)`
- Produces: `deliver_cost_alerts(store, send_email, recipient, dashboard_url, logger, max_alerts=20) -> int`
- Consumes: database functions from Task 1 and existing `send_email(to, subject, html)`

- [ ] **Step 1: Write failing delivery tests**

Cover:

```python
def test_sends_each_claimed_threshold_once(): ...
def test_failed_delivery_is_released_for_retry(): ...
def test_email_contains_threshold_total_vendor_breakdown_and_admin_link(): ...
```

Use a small in-memory fake store that implements `claim`, `mark_sent`, and
`release`; assert on state transitions and the rendered message.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `python3 -m unittest worker.tests.test_cost_alerts`

Expected: import failure because `worker.cost_alerts` does not exist.

- [ ] **Step 3: Implement the delivery module**

Create an immutable `CostAlert` dataclass, the Postgres store adapter, escaped
HTML rendering, currency formatting, and a bounded delivery loop. Stop the loop
after a delivery failure so the same failed alert is retried on the next worker
check rather than repeatedly in one cycle.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `python3 -m unittest worker.tests.test_cost_alerts`

Expected: all tests pass.

### Task 3: Worker scheduling

**Files:**
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_cost_alerts.py`

**Interfaces:**
- Consumes: `PostgresCostAlertStore` and `deliver_cost_alerts`
- Adds: `COST_ALERT_CHECK_EVERY_S = 60`
- Adds: `maybe_send_cost_alerts() -> None`
- Adds: `start_cost_alert_monitor() -> threading.Thread`

- [ ] **Step 1: Add a failing worker integration contract**

Read `worker/worker.py` in the test and assert it imports the alert module,
sets a 60-second interval, starts a daemon alert monitor, gives each check its
own database connection, and catches failures without affecting the main loop.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `python3 -m unittest worker.tests.test_cost_alerts`

Expected: failure because the worker has no alert scheduler.

- [ ] **Step 3: Integrate the scheduler**

Add the module import in both package and script import branches. Add a
best-effort `maybe_send_cost_alerts` wrapper using `ADMIN_EMAIL`,
`https://www.ponglens.com/admin`, and the existing `send_email`. Start a daemon
monitor that opens a dedicated database connection for each check, invokes the
wrapper immediately and every 60 seconds, and catches non-fatal failures. This
keeps alerts timely while the main worker is occupied by a long video job.

- [ ] **Step 4: Run worker tests and confirm GREEN**

Run:

```bash
python3 -m unittest \
  worker.tests.test_cost_alerts \
  worker.tests.test_cost_meter \
  worker.tests.test_cost_reconcile
```

Expected: all tests pass.

### Task 4: Deploy and production-safe verification

**Interfaces:**
- Deploys migration 055 to the connected Supabase project.
- Reloads the launchd worker after active jobs finish.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run test:costs
python3 -m unittest worker.tests.test_cost_alerts worker.tests.test_cost_meter worker.tests.test_cost_reconcile
npm run lint
npm run build
git diff --check
```

- [ ] **Step 2: Apply migration 055**

Apply only `supabase/migrations/055_platform_cost_alerts.sql` through the
existing direct Postgres connection. Confirm the migration finishes without
printing credentials.

- [ ] **Step 3: Verify below-threshold production state**

Call `public.claim_platform_cost_alert(100, now())` and confirm it returns
`null` while current month-to-date spend is below $100. Query the delivery
ledger and confirm no production alert row or email was created.

- [ ] **Step 4: Commit, push, and reload safely**

Commit implementation on `main`, push to `origin/main`, wait for the production
deployment to become ready, and reload the worker only when it is not inside a
video-processing child job.

- [ ] **Step 5: Verify runtime**

Confirm the worker startup log references the new commit and no cost-alert
exception appears after the first scheduled check.
